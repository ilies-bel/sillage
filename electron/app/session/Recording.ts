/**
 * The wire between capture and transcription, and the only place a transcript
 * segment becomes an event.
 *
 * `modules/capture/` and `modules/transcribe/` do not know about each other —
 * that is the boundary rule, and it is also the reason this file can be tested
 * with neither an audio device nor a network by injecting both factories.
 *
 * Two invariants live here rather than in either module:
 *
 *   · **A transcription failure never stops the recording** (DEC-26). Capture is
 *     upstream of everything and answers to nothing downstream. A meeting with a
 *     gap in its transcript is recoverable; a meeting that stopped recording is
 *     not, and the rep will not find out until they open it.
 *   · **Only final segments are persisted** (DEC-21). Interim text is broadcast
 *     to the transcript pane and replaced in place; if it were written to the
 *     log, an extraction could cite a span that the provider later revised away.
 */
import type { Channel, TranscriptSegment } from '../../core/contracts/transcript.ts'
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import { CaptureSession } from '../../modules/capture/index.ts'
import type { CaptureOptions, AudioFrame, CapturePort } from '../../modules/capture/index.ts'
import { TranscribeSession } from '../../modules/transcribe/index.ts'
import type { TranscribeOptions } from '../../modules/transcribe/index.ts'
import type { MeetingSession } from './MeetingSession.ts'

export interface RecordingDeps {
  diagnostics?: DiagRecorder
  clock?: () => number
  onSegment?: (segment: TranscriptSegment) => void
  onHealth?: (connector: 'capture' | 'transcribe', health: ConnectorHealth) => void
  /** Injected in tests; the real ones open devices and sockets. */
  createCapture?: (options: CaptureOptions) => CapturePort
  createTranscribe?: (options: TranscribeOptions) => TranscribeSession
  /**
   * Post-STT correction (DEC-17), applied to a final segment **before** it is
   * stored.
   *
   * Before, and not after, for a reason worth stating: DEC-21 verifies every
   * cited quote against the *stored* transcript. Correcting on the way out of
   * the database would leave the model reading corrected text and the verifier
   * checking uncorrected text, and every span would fail. Correcting here keeps
   * one transcript, and it is the one everybody sees.
   *
   * Interim segments are left alone — they are replaced in place a second
   * later, and rewriting text that is about to vanish costs a pass per
   * utterance for nothing.
   */
  correct?: (text: string) => { text: string; applied: string[] }
  /**
   * The VAD's two edges, forwarded so `EndOfMeetingWatch` can run DEC-16's
   * countdown. Local by construction — the transcriber is not consulted, so a
   * meeting still ends on its own with the network unplugged (DEC-26).
   */
  onSpeech?: (channel: Channel, speaking: boolean) => void
  /**
   * Peak amplitude per channel, ten times a second, for the in-call level
   * meter. Absent when nothing is drawing one — the poll does not run at all if
   * this is not supplied, so the meter costs nothing on a headless session.
   */
  onLevel?: (levels: Record<Channel, number>) => void
}

/**
 * How often the level meter is sampled.
 *
 * 100 ms because that is roughly where a needle stops reading as a needle and
 * starts reading as a lag. Five capture frames per sample, and the value drawn
 * is their peak rather than their mean — a meter that averages a syllable
 * against the gap after it under-reads exactly the speech it exists to show.
 */
const LEVEL_POLL_MS = 100

export interface RecordingOptions {
  capture?: CaptureOptions
  transcribe: Omit<TranscribeOptions, 'startedAt' | 'diagnostics' | 'clock'>
}

export class Recording {
  #session: MeetingSession
  #capture: CapturePort
  #transcribe: TranscribeSession
  #deps: RecordingDeps
  #diagnostics: DiagRecorder
  #stopping: Promise<void> | null = null
  #levelPoll: ReturnType<typeof setInterval> | null = null

  private constructor(
    session: MeetingSession,
    capture: CapturePort,
    transcribe: TranscribeSession,
    deps: RecordingDeps,
  ) {
    this.#session = session
    this.#capture = capture
    this.#transcribe = transcribe
    this.#deps = deps
    this.#diagnostics = deps.diagnostics ?? NULL_RECORDER
  }

  /**
   * Starts transcription first, then capture.
   *
   * That order is deliberate and it is the reverse of the intuitive one: the
   * transcriber has to be ready to accept bytes before any arrive, or the first
   * seconds of the meeting — the greeting, the "alors, où en est-on" — land on
   * the floor. Capture failing is fatal and rethrows; transcription failing is
   * not, and is why the health callback exists.
   */
  static async start(
    session: MeetingSession,
    options: RecordingOptions,
    deps: RecordingDeps = {},
  ): Promise<Recording> {
    const clock = deps.clock ?? Date.now
    const diagnostics = deps.diagnostics ?? NULL_RECORDER

    const transcribe = (deps.createTranscribe ?? ((o) => new TranscribeSession(o)))({
      ...options.transcribe,
      startedAt: clock(),
      diagnostics,
      clock,
    })
    const capture = (deps.createCapture ?? ((o) => new CaptureSession(o)))({
      ...options.capture,
      diagnostics,
      clock,
    })

    const recording = new Recording(session, capture, transcribe, deps)
    recording.#wire()

    /*
     * **The transcriber still starts first, and it may no longer throw** (DEC-26).
     *
     * `TranscribeSession.start` reaches `createSttSession`, which throws for any
     * provider id it has no branch for. The throw propagated out of here into
     * `Orchestrator.startRecording`'s single catch, which sets **capture** down
     * and aborts the meeting — so a downstream, remote, *optional* subsystem
     * failing at t=0 meant the rep pressed *Enregistrer*, nothing was recorded,
     * and the app told them the microphone was unavailable. Capture had never
     * been asked to start.
     *
     * DEC-26 is one sentence and this was its exact inversion: « everything
     * downstream may fail; nothing downstream may stop a meeting being
     * recorded ». `#corrected` and `#notifySpeech` below each carry a comment
     * saying so; the discipline was present in the small and absent in the one
     * place that decides whether a call gets recorded at all.
     *
     * **The order is not the bug and must not be changed to fix it**: the
     * transcriber goes first so it is listening before the first frame can
     * arrive, and the test below holds that. Containment is the fix.
     *
     * The reachable instance was `deepgram` — declared in `STT_PROVIDERS` as the
     * only *streaming* row, so `selectProvider` prefers it the moment a rep opts
     * into a cloud upgrade, and absent from `REST_PROVIDERS`, so it had no
     * adapter. Pasting a key into Réglages stopped the product recording. But the
     * instance is not the finding: a 401 on an expired key, a proxy refusing the
     * model host, a VPN, or a local engine that will not load all arrive here.
     *
     * What a meeting with no transcriber costs is stated rather than hidden: the
     * connector row goes down with the real reason, and the compte-rendu cannot
     * be written — which is DEC-39's `ended` case, already drawn, with the rep's
     * own notes untouched (DEC-5). A recording with no transcript is a bad
     * outcome. No recording at all is the one this product exists to prevent.
     */
    try {
      transcribe.start()
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'transcription indisponible'
      deps.onHealth?.('transcribe', {
        state: 'down',
        reason,
        since: (deps.clock ?? Date.now)(),
        retryable: true,
      })
      deps.diagnostics?.record({
        severity: 'error',
        code: 'transcribe.start.failed',
        module: 'transcribe',
        origin: 'foreign',
        message: reason,
        detail: { meetingId: session.id },
        meetingId: session.id,
      })
    }
    await capture.start()
    return recording
  }

  /**
   * The corrected segment, or the original when nothing changed.
   *
   * Never throws into the transcript: a correction table that somehow blows up
   * must cost the correction, not the sentence. The capture path has no
   * dependencies it is allowed to fail on (DEC-26), and this is on it.
   */
  #corrected(segment: TranscriptSegment): TranscriptSegment {
    const correct = this.#deps.correct
    if (!correct) return segment
    try {
      const result = correct(segment.text)
      if (result.text === segment.text) return segment
      this.#deps.diagnostics?.record?.({
        severity: 'info',
        code: 'lexicon.corrected',
        module: 'transcribe',
        message: `${result.applied.length} terme(s) rétabli(s)`,
        detail: { applied: result.applied },
      })
      return { ...segment, text: result.text }
    } catch {
      return segment
    }
  }

  /**
   * Never throws into the capture path. A countdown that blew up while being
   * told about a pause would take the recording with it, and DEC-26 says
   * nothing downstream may stop a meeting being recorded.
   */
  #notifySpeech(channel: Channel, speaking: boolean): void {
    try {
      this.#deps.onSpeech?.(channel, speaking)
    } catch (error) {
      this.#record('capture', channel, error)
    }
  }

  #wire(): void {
    this.#capture.on('frame', (frame: AudioFrame) => {
      this.#transcribe.write(frame.channel, frame.chunk, frame.sampleRate)
    })
    this.#capture.on('speechEnded', (channel: Channel) => {
      this.#transcribe.speechEnded(channel)
      this.#notifySpeech(channel, false)
    })
    this.#capture.on('speechStarted', (channel: Channel) => {
      this.#notifySpeech(channel, true)
    })
    this.#capture.on('health', (health: ConnectorHealth) => {
      this.#deps.onHealth?.('capture', health)
    })
    this.#capture.on('error', (channel: Channel, error: unknown) => {
      this.#record('capture', channel, error)
    })

    this.#transcribe.on('segment', (raw: TranscriptSegment) => {
      // Interim text is shown, never stored: a citation must point at something
      // the provider has committed to (DEC-21).
      const segment = raw.isFinal ? this.#corrected(raw) : raw
      if (segment.isFinal) this.#session.emit({ type: 'transcript.segment', segment })
      this.#deps.onSegment?.(segment)
    })
    this.#transcribe.on('health', (health: ConnectorHealth) => {
      this.#deps.onHealth?.('transcribe', health)
    })
    this.#transcribe.on('error', (channel: Channel, error: unknown) => {
      this.#record('transcribe', channel, error)
    })

    this.#startLevelPoll()
  }

  /**
   * The meter's clock, and it lives here rather than in `modules/capture/`
   * because the interval is a presentation decision — how often a bar redraws —
   * and the capture module is not allowed to hold one.
   *
   * `unref` so a meter can never be the reason the process refuses to exit, and
   * every tick is wrapped: this reads a number and hands it to the renderer, and
   * neither of those is permitted to become a way for a meeting to stop
   * recording (DEC-26).
   */
  #startLevelPoll(): void {
    const onLevel = this.#deps.onLevel
    if (!onLevel || !this.#capture.takeLevels) return

    this.#levelPoll = setInterval(() => {
      try {
        const levels = this.#capture.takeLevels?.()
        if (levels) onLevel(levels)
      } catch {
        // A meter that throws loses its next frame and nothing else.
      }
    }, LEVEL_POLL_MS)
    this.#levelPoll.unref?.()
  }

  /**
   * Stops capture first, then transcription.
   *
   * Also the reverse of the start order, and for the same reason: stopping the
   * transcriber while frames are still arriving would drop the tail of the
   * meeting, which is where the next steps get agreed. `TranscribeSession.stop()`
   * resolves only once both providers have flushed.
   */
  async stop(): Promise<void> {
    // Sticky, not cleared on completion. A `Recording` is per meeting and never
    // restarted — the Rust monitors tear their platform handles down on stop —
    // so a second call is a mistake to absorb, not a request to stop again.
    if (!this.#stopping) {
      if (this.#levelPoll) {
        clearInterval(this.#levelPoll)
        this.#levelPoll = null
      }
      this.#stopping = (async () => {
        await this.#capture.stop()
        await this.#transcribe.stop()
      })()
    }
    await this.#stopping
  }

  #record(module: 'capture' | 'transcribe', channel: Channel, error: unknown): void {
    this.#diagnostics.record({
      severity: 'error',
      code: `recording.${module}.${channel}`,
      module,
      origin: 'foreign',
      message: error instanceof Error ? error.message : String(error),
      detail: {},
    })
  }
}
