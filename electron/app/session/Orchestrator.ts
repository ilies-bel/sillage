/**
 * Owns the sessions and the connector health board.
 *
 * Modules never talk to each other; the orchestrator wires them (ARCHITECTURE.md
 * §4). It is deliberately thin — it holds no rules of its own. Anything that
 * looks like a decision belongs in `MeetingSession` or `core/domain/`.
 */
import type { HealthSnapshot } from '../../core/contracts/health.ts'
import type { ConnectorHealth, ConnectorId } from '../../core/contracts/health.ts'
import type {
  MeetingContext,
  MeetingId,
  MeetingState,
  SessionCommand,
} from '../../core/contracts/meeting.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import { SPEECH_FLOOR } from '../../core/domain/inputLevel.ts'
import type { BroadcastChannel, BroadcastPayload } from '../../core/contracts/ipc.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'
import type { Signal } from '../../core/contracts/signals.ts'
import type { Store } from '../../modules/store/index.ts'
import { MeetingSession, type TransitionOutcome } from './MeetingSession.ts'
import { Recording, type RecordingDeps, type RecordingOptions } from './Recording.ts'
import { EndOfMeetingWatch } from './EndOfMeetingWatch.ts'

export type Broadcaster = <C extends BroadcastChannel>(
  channel: C,
  payload: BroadcastPayload<C>,
) => void

export interface OrchestratorOptions {
  diagnostics?: DiagRecorder
  clock?: () => number
  /**
   * Beside `clock`, and for the same reason: DEC-16's grace window is 75
   * seconds, so a test that cannot control the timer cannot exercise the one
   * behaviour that matters — that a silent meeting actually ends.
   */
  timers?: {
    set: (fn: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  }
  broadcast?: Broadcaster
  /** Passed through to `Recording`, which is where the module factories are injected. */
  recording?: Pick<RecordingDeps, 'createCapture' | 'createTranscribe'>
  /**
   * Builds the signal rail's producer for one meeting, or returns null when
   * there is no model configured.
   *
   * Injected rather than imported because `modules/signals` and
   * `modules/capture` must not know about each other — the orchestrator is the
   * only thing allowed to know both exist (ARCHITECTURE.md §4). Null is a
   * first-class answer: the rail stays empty, the transcript still scrolls and
   * the meeting still records (DEC-26).
   */
  createSignals?: (input: {
    meetingId: MeetingId
    existing: readonly Signal[]
    onSignal: (signal: Signal) => void
  }) => SignalProducer | null
  /**
   * Runs the compte-rendu recipe for a meeting that has just ended.
   *
   * Injected because *when* enhancement happens is a rule and the orchestrator
   * holds no rules of its own — it only knows that `ended` is the edge that
   * triggers it (DEC-5). `app/session/Enhancement.ts` holds the rest.
   */
  onEnded?: (meetingId: MeetingId) => Promise<void>
  /**
   * The end-of-meeting path has begun — before the transcriber is flushed, not
   * after.
   *
   * `onEnded` runs once the flush has finished, and that flush is seconds a rep
   * spends looking at a screen with no *Terminer* button left on it and nothing
   * yet saying why. This is the hook that lets whoever owns the status say
   * « ça arrive » for the whole of the path rather than only for the part that
   * calls a model. Synchronous and best-effort: it announces, it does no work.
   */
  onEnding?: (meetingId: MeetingId) => void
  /**
   * The transcription options for a meeting about to record: which provider,
   * with which credential, and which boost terms (DEC-17).
   *
   * Injected because every part of that answer is a decision — provider
   * selection is `modules/transcribe/registry.ts`, the boost set is
   * `core/domain/lexicon/boost.ts`, and the stored terms are the store's — and
   * the orchestrator holds no decisions of its own. Null means no provider is
   * usable, which is a stated degradation, not a reason to refuse the meeting.
   */
  recordingOptionsFor?: (meetingId: MeetingId) => RecordingOptions | null
  /**
   * Post-STT correction for one meeting (DEC-17). Built per meeting because the
   * client's own vocabulary is part of it.
   */
  correctorFor?: (meetingId: MeetingId) => ((text: string) => {
    text: string
    applied: string[]
  }) | null
}

/**
 * The half of `SignalExtractor` the orchestrator uses. Structural, so this file
 * still imports no module — and narrow enough that it cannot grow a way to
 * write into the rep's document (DEC-5).
 */
export interface SignalProducer {
  push(segment: TranscriptSegment): void
  stop(): void
}

/**
 * `capture` starts healthy and stays healthy on its own terms: it has zero
 * network dependencies, so nothing downstream can take it down (DEC-26). The
 * rest start `down` with a stated reason rather than optimistically `ok` — an
 * unconfigured connector that claims to work is how a demo discovers at the
 * worst moment that it never authenticated.
 */
const initialHealth = (since: number): HealthSnapshot => {
  const unconfigured: ConnectorHealth = {
    state: 'down',
    reason: 'connecteur non configuré',
    since,
    retryable: false,
  }
  return {
    capture: { state: 'ok' },
    transcribe: unconfigured,
    calendar: unconfigured,
    llm: unconfigured,
    crm: unconfigured,
    mail: unconfigured,
  }
}

export class Orchestrator {
  #store: Store
  #diagnostics: DiagRecorder
  #clock: () => number
  #broadcast: Broadcaster
  #sessions = new Map<MeetingId, MeetingSession>()
  #health: HealthSnapshot
  #retries = new Map<ConnectorId, () => Promise<ConnectorHealth>>()
  #recordings = new Map<MeetingId, Recording>()
  /** DEC-16's grace countdown, one per meeting that is actually recording. */
  #endWatch = new Map<MeetingId, EndOfMeetingWatch>()
  #recordingDeps: Pick<RecordingDeps, 'createCapture' | 'createTranscribe'>
  #signals = new Map<MeetingId, SignalProducer>()
  #createSignals: OrchestratorOptions['createSignals']
  #onEnded: OrchestratorOptions['onEnded']
  #onEnding: OrchestratorOptions['onEnding']
  #recordingOptionsFor: OrchestratorOptions['recordingOptionsFor']
  #correctorFor: OrchestratorOptions['correctorFor']
  #timers: OrchestratorOptions['timers']

  constructor(store: Store, options: OrchestratorOptions = {}) {
    this.#store = store
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
    /*
     * A broadcast is a readout, never a dependency.
     *
     * In the app this is `webContents.send`, which **throws** once the window
     * has been destroyed. Most dispatches come from an IPC handler, where that
     * would merely reject a call — but DEC-16's automatic end comes from a
     * timer, and an exception there is an unhandled one that takes the main
     * process down. Closing the window during a silent meeting is not an exotic
     * sequence; it is how a rep leaves for lunch.
     *
     * Swallowed here rather than at each of the dozen call sites, so a new one
     * cannot forget.
     */
    const raw = options.broadcast
    this.#broadcast = raw
      ? ((channel, payload) => {
          try {
            raw(channel, payload)
          } catch (error) {
            this.#diagnostics.record({
              severity: 'warn',
              code: 'app.broadcast.failed',
              module: 'app',
              message: error instanceof Error ? error.message : 'diffusion impossible',
              detail: { channel },
            })
          }
        })
      : () => {}
    this.#health = initialHealth(this.#clock())
    this.#recordingDeps = options.recording ?? {}
    this.#createSignals = options.createSignals
    this.#onEnded = options.onEnded
    this.#onEnding = options.onEnding
    this.#recordingOptionsFor = options.recordingOptionsFor
    this.#correctorFor = options.correctorFor
    this.#timers = options.timers
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  create(input: {
    id: MeetingId
    title: string
    context?: MeetingContext | null
    clientName?: string | null
    /** The day the rep placed it on, when that is not now (DEC-31). */
    scheduledStart?: number | null
  }): MeetingSession {
    const session = MeetingSession.create(this.#store, input, {
      diagnostics: this.#diagnostics,
      clock: this.#clock,
    })
    this.#sessions.set(session.id, session)
    return session
  }

  /** Lazily rehydrated from the log — a restart loses no session (DEC-12). */
  session(meetingId: MeetingId): MeetingSession | null {
    const live = this.#sessions.get(meetingId)
    if (live) return live
    const loaded = MeetingSession.load(this.#store, meetingId, {
      diagnostics: this.#diagnostics,
      clock: this.#clock,
    })
    if (loaded) this.#sessions.set(meetingId, loaded)
    return loaded
  }

  dispatch(
    meetingId: MeetingId,
    command: SessionCommand,
    reason: string | null = null,
  ): TransitionOutcome {
    const session = this.session(meetingId)
    if (!session) {
      return { ok: false, state: 'idle', reason: `réunion inconnue: ${meetingId}` }
    }
    const outcome = session.dispatch(command, reason)
    if (outcome.ok) this.#broadcast('session:changed', { meetingId, state: outcome.to })

    // The **edge** `recording → ended` triggers enhancement, not the state
    // `ended` (DEC-5: gray AI text enters the document exactly once, at meeting
    // end). The distinction is load-bearing: `extractionFailed` also lands on
    // `ended`, so keying on the state alone retries a failing extraction
    // forever, at the model's expense, with no way for anyone to stop it.
    //
    // Fired and not awaited — `dispatch` is synchronous and the renderer is
    // waiting on it, so the caller must not be held for the length of an LLM
    // call. The review gate is driven by the `session:changed` broadcasts that
    // follow, which is why `Enhancement` dispatches through here and not
    // straight onto the session.
    if (outcome.ok && outcome.from === 'recording' && outcome.to === 'ended') {
      void this.#enhance(meetingId)
    }

    // The other edge, and the one the whole product rests on: entering
    // `recording` is what opens the devices. Without this the machine reports
    // `recording` and captures nothing — a notetaker's one unacceptable
    // failure, and one that looks completely healthy from the outside.
    //
    // Fired and not awaited, for the same reason as enhancement: `dispatch` is
    // synchronous and the renderer is waiting on it. A failure to open the
    // devices aborts the meeting from inside `startRecording`, which is louder
    // than a rejected promise nobody holds.
    if (outcome.ok && outcome.to === 'recording' && outcome.from !== 'recording') {
      void this.#openDevices(meetingId)
    }

    return outcome
  }

  /** Resolves the options, then opens. Never throws into `dispatch`. */
  async #openDevices(meetingId: MeetingId): Promise<void> {
    if (this.#recordings.has(meetingId)) return

    // No resolver at all means the caller drives recording itself — the dev
    // harness and the tests do. That is a construction-time choice and not a
    // runtime degradation, so it is silent.
    if (!this.#recordingOptionsFor) return

    const options = this.#recordingOptionsFor(meetingId)
    if (!options) {
      // No usable provider. The meeting is aborted rather than left claiming to
      // record: a session that says `recording` with no transcriber is the one
      // state this app may never be in.
      this.setHealth('transcribe', {
        state: 'down',
        reason: 'aucun fournisseur de transcription disponible',
        since: this.#clock(),
        retryable: true,
      })
      this.dispatch(meetingId, 'abort', 'aucun fournisseur de transcription')
      return
    }

    try {
      await this.startRecording(meetingId, options)
    } catch {
      // `startRecording` has already set health and aborted the meeting.
    }
  }

  /** Stops the devices, then runs the recipe. Never throws into `dispatch`. */
  async #enhance(meetingId: MeetingId): Promise<void> {
    const enhance = this.#onEnded
    if (!enhance) return
    try {
      // Before the flush, so the seconds it takes are seconds the screen can
      // account for. Guarded like every other injected callback here: a status
      // announcement that throws must not be able to cost the compte-rendu it
      // is announcing.
      try {
        this.#onEnding?.(meetingId)
      } catch {
        /* a readout, never a dependency */
      }
      // The tail of a call is the part with the next steps in it, so the
      // transcriber is flushed before anything reads the transcript.
      await this.stopRecording(meetingId)
      await enhance(meetingId)
    } catch (error) {
      this.#diagnostics.record({
        severity: 'error',
        code: 'enhancement.unhandled',
        module: 'app',
        message: error instanceof Error ? error.message : 'fin de réunion incomplète',
        detail: { meetingId },
      })
    }
  }

  /**
   * Run the recipe for a meeting that has already ended — a retry, or a first
   * attempt once a model finally exists.
   *
   * The same path the end of a meeting takes, deliberately. `#enhance` also
   * stops the devices, which is a no-op on a meeting that stopped some minutes
   * ago and is the correct thing on one that has not; and it gathers the
   * transcript, the context and the rep's notes the same way, so a retry can
   * never analyse less material than the attempt it replaces.
   */
  async enhance(meetingId: MeetingId): Promise<void> {
    await this.#enhance(meetingId)
  }

  stateOf(meetingId: MeetingId): MeetingState {
    return this.session(meetingId)?.state ?? 'idle'
  }

  /** Debounced from the editor at ~500ms (DEC-12). */
  saveDocument(meetingId: MeetingId, revision: number, doc: unknown): number {
    const session = this.session(meetingId)
    if (!session) throw new Error(`réunion inconnue: ${meetingId}`)
    session.emit({ type: 'document.snapshot', revision, doc })
    return revision
  }

  // ── Recording ────────────────────────────────────────────────────────────

  /**
   * Opens the devices and the transcriber for a meeting already in `recording`.
   *
   * The state transition comes first and separately: `dispatch('start')` is what
   * makes the meeting a recording, and this is what makes it produce audio. If
   * the devices fail, the meeting is aborted rather than left in a state that
   * claims to be recording nothing — the one failure mode a notetaker cannot
   * have.
   */
  async startRecording(meetingId: MeetingId, options: RecordingOptions): Promise<void> {
    if (this.#recordings.has(meetingId)) return
    const session = this.session(meetingId)
    if (!session) throw new Error(`réunion inconnue: ${meetingId}`)

    // Built before the devices open, and seeded from whatever the log already
    // holds so a resumed session neither restarts `seq` nor re-announces a chip
    // the rep has already read.
    const signals = this.#startSignals(meetingId, session)

    try {
      const corrector = this.#correctorFor?.(meetingId) ?? null

      const recording = await Recording.start(session, options, {
        ...this.#recordingDeps,
        diagnostics: this.#diagnostics,
        clock: this.#clock,
        ...(corrector ? { correct: corrector } : {}),
        onSegment: (segment: TranscriptSegment) => {
          this.#broadcast('transcript:appended', { meetingId, segment })
          // After the broadcast, and inside a try. The transcript pane is the
          // cheap, deterministic proof the tool is working (DEC-14), and this
          // callback runs on the transcriber's own emit — so an exception here
          // would travel back up the capture path. `SignalExtractor.push`
          // documents that it never throws; the guarantee that a meeting keeps
          // recording (DEC-26) must not rest on a downstream module keeping a
          // promise.
          try {
            signals?.push(segment)
          } catch (error) {
            this.#diagnostics.record({
              severity: 'warn',
              code: 'signals.push.failed',
              module: 'app',
              message: error instanceof Error ? error.message : 'signal rail indisponible',
              detail: { meetingId },
            })
          }
        },
        onHealth: (connector, health) => this.setHealth(connector, health),
        onLevel: (levels) => {
          this.#broadcast('audio:level', {
            meetingId,
            rep: levels.rep,
            far: levels.far,
            floor: SPEECH_FLOOR,
          })
        },
        onSpeech: (channel, speaking) => {
          const watch = this.#endWatch.get(meetingId)
          if (!watch) return
          if (speaking) watch.speechStarted(channel)
          else watch.speechEnded(channel)
        },
      })
      this.#recordings.set(meetingId, recording)
      this.#startEndWatch(meetingId)
    } catch (err) {
      this.#stopSignals(meetingId)
      this.setHealth('capture', {
        state: 'down',
        reason: err instanceof Error ? err.message : 'capture indisponible',
        since: this.#clock(),
        retryable: true,
      })
      this.dispatch(meetingId, 'abort', 'capture indisponible')
      throw err
    }
  }

  /** Resolves once both providers have flushed — the tail of a call is the part with the next steps in it. */
  async stopRecording(meetingId: MeetingId): Promise<void> {
    this.#stopSignals(meetingId)
    this.#endWatch.get(meetingId)?.stop()
    this.#endWatch.delete(meetingId)
    const recording = this.#recordings.get(meetingId)
    if (!recording) return
    this.#recordings.delete(meetingId)
    await recording.stop()
  }

  /**
   * DEC-16's countdown, armed for the length of the recording.
   *
   * The scheduled end comes from the calendar and is a *prior*, never a
   * trigger: sales calls overrun constantly, so it only shortens the window
   * once passed. A manually started meeting has none, and then the full grace
   * always applies.
   *
   * `dispatch` rather than a direct session call, so the transition is
   * broadcast — an automatic end that the renderer never hears about leaves the
   * rep watching a session that the machine considers over.
   */
  #startEndWatch(meetingId: MeetingId): void {
    if (this.#endWatch.has(meetingId)) return
    const scheduledEnd = this.#store.projections.context(meetingId)?.scheduledEnd ?? null
    this.#endWatch.set(
      meetingId,
      new EndOfMeetingWatch({
        scheduledEnd,
        clock: this.#clock,
        ...(this.#timers
          ? { setTimer: this.#timers.set, clearTimer: this.#timers.clear }
          : {}),
        onEnd: (reason) => {
          this.#diagnostics.record({
            severity: 'info',
            code: 'session.autoEnded',
            module: 'app',
            message: reason,
            detail: { meetingId, scheduledEnd },
          })
          this.dispatch(meetingId, 'end', reason)
        },
      }),
    )
  }

  /**
   * A signal is an event like any other: persisted through the session, then
   * broadcast. Which means the rail survives a restart by replay, and
   * `meeting:get` can answer with the chips already earned.
   */
  #startSignals(meetingId: MeetingId, session: MeetingSession): SignalProducer | null {
    if (this.#signals.has(meetingId)) return this.#signals.get(meetingId) ?? null
    if (!this.#createSignals) return null

    const producer = this.#createSignals({
      meetingId,
      existing: this.#store.projections.signals(meetingId),
      onSignal: (signal) => {
        session.emit({ type: 'signal.appended', signal })
        this.#broadcast('signal:appended', { meetingId, signal })
      },
    })

    if (producer) this.#signals.set(meetingId, producer)
    return producer
  }

  #stopSignals(meetingId: MeetingId): void {
    const producer = this.#signals.get(meetingId)
    if (!producer) return
    this.#signals.delete(meetingId)
    producer.stop()
  }

  // ── Health ───────────────────────────────────────────────────────────────

  health(): HealthSnapshot {
    return { ...this.#health }
  }

  setHealth(connector: ConnectorId, health: ConnectorHealth): void {
    this.#health = { ...this.#health, [connector]: health }
    this.#broadcast('health:changed', { connector, health, at: this.#clock() })
  }

  /**
   * A module registers how to retry itself when it registers as a connector.
   * Without one, a `down` connector renders a disabled control with no way
   * back — the exact dead button DEC-26 forbids.
   */
  registerRetry(connector: ConnectorId, retry: () => Promise<ConnectorHealth>): void {
    this.#retries.set(connector, retry)
  }

  async retry(connector: ConnectorId): Promise<ConnectorHealth> {
    const retry = this.#retries.get(connector)
    if (!retry) return this.#health[connector] ?? { state: 'ok' }
    try {
      const health = await retry()
      this.setHealth(connector, health)
      return health
    } catch (err) {
      const health: ConnectorHealth = {
        state: 'down',
        reason: err instanceof Error ? err.message : 'échec inconnu',
        since: this.#clock(),
        retryable: true,
      }
      this.setHealth(connector, health)
      return health
    }
  }
}
