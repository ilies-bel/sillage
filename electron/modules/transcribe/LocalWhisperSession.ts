/**
 * The offline floor (HR-4). Whisper, on the rep's own machine, over the same
 * `SttSession` port every cloud provider implements.
 *
 * This is the provider that exists to be the one that cannot fail for an
 * external reason. No key, no endpoint, no residency question — the audio never
 * leaves the laptop. Local is the *default*, not a fallback (DEC-30).
 *
 * **This class owns one channel's audio, not the model.** The worker, the ONNX
 * session behind it, the load mutex and the crash sentinel all live in
 * `whisper/engine.ts`, shared by every channel that wants the same checkpoint.
 * They used to live here, which meant a meeting loaded the same weights twice —
 * 15.2 s and 2.1 GB where 7 s and 1.1 GB would do. See that file for the
 * measurements; the short version is that it made short meetings transcribe
 * nothing at all, because the model was still loading when they ended.
 *
 * **What was dropped from the version this is ported from, and why.** The old
 * class ran a second inference every 1.5 s over the still-open utterance and
 * reconciled consecutive passes with LocalAgreement-2, to put words on screen
 * before the speaker had finished saying them. That is the right design for an
 * assistant that must answer live, and the wrong one here: interim text is
 * never persisted and never citable (DEC-21), the transcript pane is a
 * read-only side surface (DEC-5), and on a laptop that is also running Teams
 * the second inference is not free — it is the *same* inference, run repeatedly
 * on a growing window. This emits finals only, which is exactly what the
 * registry already declares: `streaming: false`.
 */
import { EventEmitter } from 'node:events'
import type { SttSession, SttSessionOptions } from './SttSession.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import { Vad } from './whisper/vad.ts'
import { resampleToF32 } from './whisper/resample.ts'
import { filterHallucination } from './whisper/hallucinations.ts'
import { DEFAULT_MODEL_ID } from './whisper/catalog.ts'
import { acquireEngine, forgetEngine, type WhisperEngine, type WorkerLike } from './whisper/engine.ts'

export type { WorkerLike }

export interface LocalWhisperOptions extends SttSessionOptions {
  modelsDir?: string
  /** Where the crash-loop sentinel is kept. Defaults to Electron's `userData`. */
  stateDir?: string
  workerPath?: string
  /** Test seam. A session given one gets a private engine, never the pool's. */
  spawn?: (workerPath: string) => WorkerLike
  /** How long `stop()` waits for the tail of the meeting to come back. */
  drainTimeoutMs?: number
}

/**
 * A cap on utterances held while the model is still loading. A cold start is a
 * few seconds and an utterance is at most twenty-five, so this is roughly
 * twenty minutes of speech — far past the point where something is wrong.
 * Unbounded would mean a worker that never becomes ready quietly consuming the
 * meeting into the heap.
 */
const MAX_PENDING_SEGMENTS = 80

/**
 * How long after the last frame whatever the VAD is holding is sent anyway.
 *
 * Two jobs. The Rust side suppresses silence, so when a speaker stops the frames
 * stop arriving and the JS VAD's hangover never counts down — without this the
 * audio would sit held until the next person spoke. And it is the ceiling on how
 * long a packed utterance can wait: the VAD accumulates before emitting, which
 * is right for throughput and wrong if the meeting has simply gone quiet. Three
 * seconds of no audio at all is a real turn boundary, not a breath.
 */
const GAP_FLUSH_MS = 3_000

/**
 * Bounded, and the bound is a judgement call. The tail of a meeting is where
 * the next steps get agreed, so `stop()` waits for it — but the rep is looking
 * at a screen that says the meeting has ended, and a slow model with several
 * utterances queued could take minutes. Thirty seconds covers a cold model plus
 * a couple of finals; past that the loss is recorded and named rather than
 * hidden behind a spinner.
 */
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000

export class LocalWhisperSession extends EventEmitter implements SttSession {
  readonly providerId = 'local-whisper'

  #options: LocalWhisperOptions
  #diagnostics: DiagRecorder
  #modelId: string
  #language: string
  #prompt: string
  #drainTimeoutMs: number

  #vad: Vad | null = null
  #engine: WhisperEngine | null = null
  #active = false
  #inFlight = 0
  #pending: Float32Array[] = []
  #drainWaiters: Array<() => void> = []
  #gapTimer: NodeJS.Timeout | null = null
  #stopping: Promise<void> | null = null
  #onEngineProgress: ((p: { modelId: string; progress: number }) => void) | null = null
  #onEngineFailure: ((error: Error) => void) | null = null

  constructor(options: LocalWhisperOptions) {
    super()
    this.#options = options
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#modelId = options.model ?? DEFAULT_MODEL_ID
    this.#language = options.language
    // DEC-17: the registry says this provider's boost channel is
    // `initialPrompt`, so the terms are used rather than dropped.
    this.#prompt = options.boostTerms?.length ? options.boostTerms.join(', ') : ''
    this.#drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
  }

  start(): void {
    if (this.#active) return
    this.#active = true
    this.#vad = new Vad()

    const engine = acquireEngine({
      model: this.#modelId,
      ...(this.#options.modelsDir === undefined ? {} : { modelsDir: this.#options.modelsDir }),
      ...(this.#options.stateDir === undefined ? {} : { stateDir: this.#options.stateDir }),
      ...(this.#options.workerPath === undefined ? {} : { workerPath: this.#options.workerPath }),
      ...(this.#options.spawn === undefined ? {} : { spawn: this.#options.spawn }),
    })
    this.#engine = engine
    this.#attachEngine(engine)

    engine.retain().then(
      () => {
        // Already ready means the engine was warm — prewarmed at boot, or held
        // by the other channel of this same meeting. Nothing was waited for.
        if (this.#active && engine.ready) this.#flushPending()
      },
      (error: unknown) => {
        // The instance is torn back down to an inert one before the error is
        // announced. Leaving it half-alive is the shape of the bug this is
        // written against: `#active` stayed true with no engine behind it, so
        // every utterance was silently discarded at dispatch and the session
        // reported nothing wrong for the rest of the meeting.
        void this.#detachEngine()
        this.#active = false
        this.#vad = null
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
      },
    )

    if (this.#prompt) engine.setPrompt(this.#prompt)
  }

  write(chunk: Buffer, sampleRate: number): void {
    if (!this.#active || !this.#vad) return

    for (const segment of this.#vad.push(resampleToF32(chunk, sampleRate))) {
      this.#dispatch(segment.samples)
    }

    this.#armGapFlush()
  }

  #armGapFlush(): void {
    if (this.#gapTimer) clearTimeout(this.#gapTimer)
    this.#gapTimer = setTimeout(() => {
      this.#gapTimer = null
      this.#flushVad()
    }, GAP_FLUSH_MS)
  }

  /**
   * The native VAD saw the end of an utterance.
   *
   * It no longer forces a flush, and that is the point of the packing rule: an
   * utterance boundary is exactly what this session wants to *absorb*, because
   * Whisper charges a full 30-second window whether it is given one second of
   * speech or twenty. What the signal is still good for is the gap timer — it
   * marks the moment after which silence starts counting.
   */
  notifySpeechEnded(): void {
    if (!this.#active) return
    this.#armGapFlush()
  }

  async stop(): Promise<void> {
    // Sticky. A session is per meeting and never restarted, so a second call is
    // a mistake to absorb rather than a request to stop again.
    this.#stopping ??= this.#shutdown()
    await this.#stopping
  }

  async #shutdown(): Promise<void> {
    this.#active = false
    if (this.#gapTimer) {
      clearTimeout(this.#gapTimer)
      this.#gapTimer = null
    }
    if (this.#vad) {
      for (const segment of this.#vad.flush()) this.#dispatch(segment.samples)
      this.#vad = null
    }
    await this.#drain()
    await this.#detachEngine()
  }

  // ── Engine ────────────────────────────────────────────────────────────────

  #attachEngine(engine: WhisperEngine): void {
    this.#onEngineProgress = ({ modelId, progress }): void => {
      this.#diagnostics.record({
        severity: 'info',
        code: 'transcribe.local.download',
        module: 'transcribe',
        message: `téléchargement du modèle local ${progress}%`,
        detail: { model: modelId, progress },
      })
    }
    this.#onEngineFailure = (error: Error): void => {
      // Fatal, and fatal to both channels at once — which is the shape of the
      // thing that failed. Whatever was queued here will never be answered.
      this.#abandonOutstanding(error.message)
      this.emit('error', error)
    }
    engine.on('progress', this.#onEngineProgress)
    engine.on('loadFailed', this.#onEngineFailure)
    engine.on('ready', () => {
      if (this.#active) this.#flushPending()
    })
  }

  async #detachEngine(): Promise<void> {
    const engine = this.#engine
    this.#engine = null
    if (!engine) return
    if (this.#onEngineProgress) engine.off('progress', this.#onEngineProgress)
    if (this.#onEngineFailure) engine.off('loadFailed', this.#onEngineFailure)
    this.#onEngineProgress = null
    this.#onEngineFailure = null
    await engine.release()
    forgetEngine(engine)
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  #flushVad(): void {
    if (!this.#vad) return
    for (const segment of this.#vad.flush()) this.#dispatch(segment.samples)
  }

  #flushPending(): void {
    const queued = this.#pending.splice(0)
    for (const audio of queued) this.#post(audio)
    this.#settle()
  }

  #dispatch(audio: Float32Array): void {
    const engine = this.#engine
    if (!engine) {
      this.#diagnostics.record({
        severity: 'warn',
        code: 'transcribe.local.dropped',
        module: 'transcribe',
        message: 'segment perdu — aucun moteur local actif',
        detail: { samples: audio.length },
      })
      return
    }

    if (!engine.ready) {
      if (this.#pending.length >= MAX_PENDING_SEGMENTS) {
        // Drop the oldest. A meeting whose model never loaded is already lost;
        // what matters is that the most recent audio is the audio kept, since
        // that is the part still worth transcribing if it does load.
        this.#pending.shift()
        this.#diagnostics.record({
          severity: 'warn',
          code: 'transcribe.local.backlogFull',
          module: 'transcribe',
          message: 'file d’attente pleine — segment le plus ancien abandonné',
          detail: { pending: this.#pending.length },
        })
      }
      this.#pending.push(audio)
      return
    }

    this.#post(audio)
  }

  #post(audio: Float32Array): void {
    const engine = this.#engine
    if (!engine) return
    this.#inFlight++
    engine.transcribe(audio, this.#language).then(
      (raw) => {
        this.#inFlight = Math.max(0, this.#inFlight - 1)
        const text = filterHallucination(raw)
        // Whisper answers a silent window with subtitle boilerplate rather than
        // with nothing, and that text would verify as a span perfectly well.
        if (text) this.emit('transcript', { text, isFinal: true })
        this.#settle()
      },
      (error: unknown) => {
        this.#inFlight = Math.max(0, this.#inFlight - 1)
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
        this.#settle()
      },
    )
  }

  // ── Drain ────────────────────────────────────────────────────────────────

  #outstanding(): number {
    return this.#inFlight + this.#pending.length
  }

  #settle(): void {
    if (this.#outstanding() > 0) return
    const waiters = this.#drainWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  #abandonOutstanding(reason: string): void {
    const lost = this.#outstanding()
    this.#inFlight = 0
    this.#pending = []
    if (lost > 0) {
      this.#diagnostics.record({
        severity: 'error',
        code: 'transcribe.local.abandoned',
        module: 'transcribe',
        message: `${lost} segment(s) perdus — ${reason}`,
        detail: { lost, model: this.#modelId },
      })
    }
    this.#settle()
  }

  async #drain(): Promise<void> {
    if (this.#outstanding() === 0) return

    let timer: NodeJS.Timeout | null = null
    const drained = new Promise<void>((resolve) => this.#drainWaiters.push(resolve))
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.#drainTimeoutMs)
      timer.unref?.()
    })

    const outcome = await Promise.race([drained.then(() => 'drained' as const), timeout])
    if (timer) clearTimeout(timer)

    if (outcome === 'timeout') {
      this.#diagnostics.record({
        severity: 'error',
        code: 'transcribe.local.drainTimeout',
        module: 'transcribe',
        message: `fin de réunion: ${this.#outstanding()} segment(s) non transcrits après ${this.#drainTimeoutMs} ms`,
        detail: { outstanding: this.#outstanding(), model: this.#modelId },
      })
    }
  }
}
