/**
 * `TranscribeSession` — one session per channel, one clock for both.
 *
 * The microphone is the rep and the system loopback is everyone on the far end
 * (VISION.md §5), so this module never diarizes and never has to. What it does
 * do is give the two independent providers a shared meeting clock, because a
 * span cited by the extraction has to be locatable in a transcript that
 * interleaves both channels (DEC-21).
 *
 * It owns no audio. `modules/capture/` emits frames; `app/` hands them here.
 * Neither module imports the other — that is the boundary rule, and it is also
 * what lets a replay fixture drive transcription with no audio device present.
 */
import { EventEmitter } from 'node:events'
import type { Channel, TranscriptSegment } from '../../core/contracts/transcript.ts'
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { SttSession, SttSessionOptions, SttTranscript } from './SttSession.ts'
import { RestSttSession } from './RestSttSession.ts'
import type { RestProviderId } from './RestSttSession.ts'
import { LocalWhisperSession } from './LocalWhisperSession.ts'
import { descriptorFor } from './registry.ts'
import { configuredSttProviders, sttCredentialFor } from './config.ts'
import type { SttCredentialSource } from './config.ts'
import { DEFAULT_MODEL_ID, isModelCached } from './whisper/catalog.ts'
import { resolveInferenceConfig } from './whisper/inference.ts'
import { electronPaths, resolveModelsDir } from './whisper/paths.ts'

export * from './SttSession.ts'
export * from './registry.ts'
export {
  RestSttSession,
  isValidRegion,
  isSilent,
  downsampleToMono16k,
  wavHeader,
} from './RestSttSession.ts'
export type { RestProviderId } from './RestSttSession.ts'
export { LocalWhisperSession } from './LocalWhisperSession.ts'
export type { LocalWhisperOptions, WorkerLike } from './LocalWhisperSession.ts'
export { prewarmEngine } from './whisper/engine.ts'
export { MODELS, DEFAULT_MODEL_ID, isModelCached } from './whisper/catalog.ts'
export type { WhisperModel } from './whisper/catalog.ts'

export interface TranscribeOptions extends SttSessionOptions {
  providerId: string
  /** Milliseconds since epoch when the recording started. Segment times are relative to it. */
  startedAt: number
  /**
   * Where transcription goes when the provider in use fails repeatedly — in
   * practice `local-whisper`, the engine that cannot be taken away by a network.
   *
   * Only reached when the rep opted into a cloud engine (DEC-30): coming back
   * here is a **return to the default**, not a downgrade, which is why the swap
   * is not announced as one.
   *
   * The caller decides, because "can I use it" is an on-disk question this
   * module answers with `isLocalWhisperReady` and only `app/` should act on:
   * naming a provider whose weights are not cached would start a
   * several-hundred-megabyte download during the meeting it exists to rescue.
   * Omitted, or equal to `providerId`, means no failover.
   */
  fallbackProviderId?: string
  diagnostics?: DiagRecorder
  clock?: () => number
  /**
   * Injected so a test can run the whole path with no network. It is handed the
   * provider id rather than closing over one, because failover changes it: a
   * factory that ignored the argument would report the replacement working when
   * it had never been built.
   */
  createSession?: (channel: Channel, options: SttSessionOptions, providerId: string) => SttSession
}

/**
 * Consecutive failed results on one channel before the session gives up on its
 * provider.
 *
 * One failure is a blip, and the swap is one-way: switching on it would spend
 * the rest of the call on the other engine — two vocabularies in one transcript
 * with nothing marking the seam — to survive a network that came back a second
 * later. Three is roughly fifteen to thirty seconds of speech for a batch
 * provider, the point where "the network came back" has stopped being the
 * likely explanation.
 */
const FAILOVER_AFTER_ERRORS = 3

const REST_PROVIDERS = new Set<string>([
  'azure-fr',
  'groq-whisper',
  'openai-whisper',
  'elevenlabs',
])

/**
 * Builds the adapter for a provider id.
 *
 * `boostAllowed` comes from the registry descriptor, not from the caller: a
 * provider that cannot take hotwords must not be handed them (DEC-17). Azure
 * over the short-audio REST endpoint is exactly that case.
 */
export const createSttSession = (providerId: string, options: SttSessionOptions): SttSession => {
  if (REST_PROVIDERS.has(providerId)) {
    const boostAllowed = descriptorFor(providerId)?.boost !== 'none'
    return new RestSttSession(providerId as RestProviderId, { ...options, boostAllowed })
  }
  if (providerId === 'local-whisper') return new LocalWhisperSession(options)
  throw new Error(`fournisseur de transcription non implémenté: ${providerId}`)
}

/**
 * Whether `local-whisper` may be offered to `selectProvider` as configured.
 *
 * For a cloud provider "configured" means a stored credential; for this one it
 * means the weights are on disk *for the dtype this machine will ask for*. The
 * distinction is the whole point: a checkpoint downloaded under a different
 * quantization is present, unusable, and — if this returned true — selected,
 * whereupon transformers silently starts a several-hundred-megabyte download
 * during the meeting it was supposed to be the safe choice for.
 */
export const isLocalWhisperReady = (modelId: string = DEFAULT_MODEL_ID, modelsDir?: string): boolean => {
  try {
    const dir = modelsDir ?? resolveModelsDir(electronPaths())
    return isModelCached(dir, modelId, resolveInferenceConfig().dtype)
  } catch {
    // No Electron, no `userData`, nothing on disk — all mean "not available",
    // and none of them may throw out of a capability probe.
    return false
  }
}

/**
 * The providers this machine can actually run, which is not the same list as
 * the ones it is configured for.
 *
 * `configuredSttProviders` answers from the environment alone, and for
 * `local-whisper` that answer is always yes — it has no credential to be
 * missing (HR-4). Being *installed* is a separate, on-disk question, and the
 * gap between the two is where the worst failure lives: a selector handed
 * "local-whisper is configured" on a machine whose weights were never
 * downloaded picks it, and transformers starts a several-hundred-megabyte
 * transfer during the meeting.
 *
 * Every caller choosing or displaying a provider goes through this, so the
 * Réglages panel and the running meeting cannot name different engines.
 */
export const usableSttProviders = (source: SttCredentialSource = {}): string[] =>
  configuredSttProviders(source).filter(
    (id) =>
      id !== 'local-whisper' ||
      isLocalWhisperReady(sttCredentialFor('local-whisper', source)?.model),
  )

/**
 * Events: `segment` (TranscriptSegment), `health` (ConnectorHealth), `error`
 * (channel, unknown).
 */
export class TranscribeSession extends EventEmitter {
  #sessions = new Map<Channel, SttSession>()
  #options: TranscribeOptions
  #diagnostics: DiagRecorder
  #clock: () => number
  #counter = 0
  #running = false
  /** Which provider is producing text *now* — not necessarily the one asked for. */
  #providerId: string
  #consecutiveErrors = new Map<Channel, number>()
  #failedOver = false

  constructor(options: TranscribeOptions) {
    super()
    this.#options = options
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
    this.#providerId = options.providerId
  }

  get running(): boolean {
    return this.#running
  }

  /** The provider actually in use, which failover can change mid-meeting. */
  get providerId(): string {
    return this.#providerId
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#open(this.#providerId)
    this.emit('health', { state: 'ok' } satisfies ConnectorHealth)
  }

  /** Builds and starts one session per channel on `providerId`. */
  #open(providerId: string): void {
    const create =
      this.#options.createSession ??
      ((_channel: Channel, options: SttSessionOptions, id: string) => createSttSession(id, options))

    for (const channel of ['rep', 'far'] as const) {
      const session = create(channel, this.#options, providerId)
      session.on('transcript', (result: SttTranscript) => this.#onTranscript(channel, result))
      session.on('error', (error: unknown) => this.#onError(channel, error))
      this.#sessions.set(channel, session)
      session.start()
    }
  }

  /**
   * Moves both channels onto the replacement provider, for the rest of the
   * meeting.
   *
   * **Both channels, on one channel's failures.** What takes a cloud provider
   * down — the network, an expired key, a rate limit — is not a property of a
   * microphone, and leaving the other channel on a dead provider would keep
   * silently dropping half the conversation.
   *
   * **One-way, never back.** A fail-back would reload a model each way and give
   * one transcript two engines' vocabularies with nothing marking the seam. The
   * old sessions are stopped without being awaited, because the thing that
   * failed is exactly the thing `stop()` would block on.
   */
  #failOver(reason: string): void {
    const fallback = this.#options.fallbackProviderId
    if (this.#failedOver || !this.#running) return
    if (!fallback || fallback === this.#providerId) return

    this.#failedOver = true
    const from = this.#providerId
    this.#providerId = fallback
    this.#consecutiveErrors.clear()

    const stale = [...this.#sessions.values()]
    this.#sessions.clear()
    for (const session of stale) {
      session.removeAllListeners()
      // Fire and forget: awaiting a dead provider's flush is the one thing that
      // could keep the meeting untranscribed while we wait to rescue it.
      void Promise.resolve(session.stop()).catch(() => {})
    }

    this.#diagnostics.record({
      severity: 'warn',
      code: 'transcribe.failover',
      module: 'transcribe',
      message: `transcription reprise par ${fallback} après l'échec de ${from}`,
      detail: { from, to: fallback, reason },
    })

    try {
      this.#open(fallback)
    } catch (error) {
      // No floor left. Capture keeps running regardless (DEC-26) — this only
      // says the words are gone, which the rep has to be told.
      this.emit('health', {
        state: 'down',
        reason: 'plus aucun moteur de transcription disponible',
        since: this.#clock(),
        retryable: false,
      } satisfies ConnectorHealth)
      this.#diagnostics.record({
        severity: 'error',
        code: 'transcribe.failover.failed',
        module: 'transcribe',
        message: error instanceof Error ? error.message : String(error),
        detail: { to: fallback },
      })
      return
    }

    /*
     * `ok`, and this is DEC-30 rather than optimism.
     *
     * Transcription is running on the engine this product treats as its
     * default, so there is nothing degraded to report — and `state` is the
     * machine-readable half: `degraded` moves the header's general status off
     * *Tout fonctionne* for the rest of the meeting (DEC-32), whatever French
     * the `reason` beside it were softened to. Announcing a return to the
     * default as a downgrade is exactly what DEC-30 forbids.
     *
     * It is also not silence. The failing provider already raised `degraded`
     * on its way out (`#onError`), and that statement is now false: words are
     * arriving again. Emitting `ok` *clears* a stale complaint rather than
     * making a new claim. What actually changed stays on the record — the
     * diagnostic above, and `provider` on every segment from here on, which is
     * what Historique reads to show which engine produced which line.
     */
    this.emit('health', { state: 'ok' } satisfies ConnectorHealth)
  }

  /** Frames arrive here from `app/`, already tagged by `modules/capture/`. */
  write(channel: Channel, chunk: Buffer, sampleRate: number): void {
    if (!this.#running) return
    this.#sessions.get(channel)?.write(chunk, sampleRate)
  }

  speechEnded(channel: Channel): void {
    if (!this.#running) return
    this.#sessions.get(channel)?.notifySpeechEnded()
  }

  /**
   * Resolves once both providers have flushed. Both are stopped even if one
   * throws — a failure on the far channel must not leave the rep's tail
   * un-uploaded.
   */
  async stop(): Promise<void> {
    if (!this.#running) return
    this.#running = false
    const sessions = [...this.#sessions.values()]
    this.#sessions.clear()
    const settled = await Promise.allSettled(sessions.map((s) => s.stop()))
    for (const result of settled) {
      if (result.status === 'rejected') {
        this.#diagnostics.record({
          severity: 'warn',
          code: 'transcribe.stop.failed',
          module: 'transcribe',
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          detail: {},
        })
      }
    }
  }

  /**
   * Stamps a provider result with the meeting clock and the channel.
   *
   * The timing is the arrival time of a batch, not the acoustic time of the
   * words in it — a batch provider cannot tell us the latter. That is why
   * `TranscriptSpan.quote` is the load-bearing field for verification and the
   * timings are documented as hints (DEC-21): a span is checked by finding the
   * text, never by trusting the range.
   */
  #onTranscript(channel: Channel, result: SttTranscript): void {
    // A result is the only proof the provider is alive, so it is what clears the
    // count. Interim results count too: they come from the same round trip.
    if (result.text.trim().length > 0) this.#consecutiveErrors.set(channel, 0)

    const receivedAt = this.#clock()
    const elapsed = Math.max(0, receivedAt - this.#options.startedAt)
    const segment: TranscriptSegment = {
      id: `${channel}-${++this.#counter}`,
      channel,
      text: result.text,
      startMs: elapsed,
      endMs: elapsed,
      isFinal: result.isFinal,
      // The engine that produced *this* segment, which after a failover is not
      // the one the meeting started on. Historique shows it per segment for
      // exactly that reason.
      provider: this.#providerId,
      receivedAt,
    }
    this.emit('segment', segment)
  }

  #onError(channel: Channel, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.#diagnostics.record({
      severity: 'error',
      code: `transcribe.${channel}.error`,
      module: 'transcribe',
      message,
      detail: { provider: this.#providerId },
    })
    this.emit('error', channel, error)

    const failures = (this.#consecutiveErrors.get(channel) ?? 0) + 1
    this.#consecutiveErrors.set(channel, failures)

    // Degraded, never down: capture keeps running and the audio keeps being
    // recorded, which is the half of DEC-26 that survives a transcription
    // outage. A meeting with a gap in the transcript is recoverable; a meeting
    // that stopped recording is not.
    this.emit('health', {
      state: 'degraded',
      reason:
        channel === 'rep'
          ? `transcription du micro dégradée — ${message}`
          : `transcription de l'audio système dégradée — ${message}`,
      since: this.#clock(),
      retryable: true,
    } satisfies ConnectorHealth)

    // …but a gap that never closes is not recoverable either, because the audio
    // it would be recovered from was discarded as it was transcribed (DEC-12).
    // Past this point the outage stops being a gap and starts being the rest of
    // the meeting, so take the floor.
    if (failures >= FAILOVER_AFTER_ERRORS) this.#failOver(message)
  }
}

export {
  configuredSttProviders,
  offlineOnlyStt,
  preferCloudStt,
  sttCredentialFor,
} from './config.ts'
export type { SttCredential, SttCredentialSource } from './config.ts'
export { ModelDownloads } from './ModelDownloads.ts'
export type { DownloadWorkerLike, ModelDownloadsOptions } from './ModelDownloads.ts'
export { modelById } from './whisper/catalog.ts'
export { resolveModelsDir, resolveWorkerPath, electronPaths } from './whisper/paths.ts'
export { resolveInferenceConfig } from './whisper/inference.ts'
