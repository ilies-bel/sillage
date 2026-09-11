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
import type { PushIntentKind } from '../../core/contracts/push.ts'
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
  /**
   * Whether a kind of push intent has a connector behind it at all. See
   * `MeetingSessionOptions.routable` — this is the one place the app knows.
   */
  routable?: (kind: PushIntentKind) => boolean
  /**
   * **Whether the twenty-second dry run currently holds the devices** (DEC-45).
   *
   * `capture:essai` refuses while a meeting is recording, and nothing refused
   * the other way: `essaiRunning` was read at its own guard and nowhere else in
   * the repo. `EssaiAudio.tsx` disables only the *Essai* button, so *Terminer*,
   * *Passer* and *Retour* stay live — a rep can leave the onboarding six seconds
   * into a twenty-second trial, press *Démarrer une réunion*, and the trial's
   * own `finally` then runs `session.stop()` under the live meeting fourteen
   * seconds later.
   *
   * The justification for the one-sided guard was that « opening a second handle
   * on the same devices is exactly the failure `CaptureSession.start` guards
   * against internally », and that is false across instances: `#running` is a
   * per-instance private field and these are two independent constructions.
   */
  essaiRunning?: () => boolean
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
  /**
   * What each module last *claimed*, before `#truthful` stripped a `retryable`
   * nobody had registered a way to act on. `registerRetry` re-asks the question
   * against this, so the order of two statements in `main.ts` cannot decide
   * whether a rep gets a button.
   */
  #claimed: Partial<HealthSnapshot> = {}
  #retries = new Map<ConnectorId, () => Promise<ConnectorHealth>>()
  #recordings = new Map<MeetingId, Recording>()

  /**
   * Whether any meeting currently holds the audio devices.
   *
   * Asked by the onboarding dry run (`core/contracts/essai.ts`), which opens the
   * same devices and must refuse rather than race a live call for them: the
   * guarantee that a meeting keeps recording (DEC-26) is not one to test against
   * an onboarding screen.
   */
  recording(): boolean {
    return this.#recordings.size > 0
  }
  /** DEC-16's grace countdown, one per meeting that is actually recording. */
  #endWatch = new Map<MeetingId, EndOfMeetingWatch>()
  #recordingDeps: Pick<RecordingDeps, 'createCapture' | 'createTranscribe'>
  #signals = new Map<MeetingId, SignalProducer>()
  #routable: OrchestratorOptions['routable']
  #essaiRunning: OrchestratorOptions['essaiRunning']
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
    this.#routable = options.routable
    this.#essaiRunning = options.essaiRunning
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
      ...(this.#routable ? { routable: this.#routable } : {}),
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
      ...(this.#routable ? { routable: this.#routable } : {}),
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

  /**
   * Every session the app is holding in memory, for `core/domain/updateGate.ts`.
   *
   * In-memory only, and that is the correct scope rather than a shortcut: a
   * session is here because it was created or rehydrated this run, so anything
   * with work genuinely in flight — recording, extracting, awaiting the rep's
   * confirmation, draining the outbox — is necessarily in this map. A meeting
   * finished last week sits in the log and blocks nothing.
   */
  liveStates(): readonly MeetingState[] {
    return [...this.#sessions.values()].map((session) => session.state)
  }

  /**
   * The meetings this process is holding, by id.
   *
   * `liveStates` answers « is anything happening » — enough to refuse an
   * installer — and `before-quit` needs the other half: *which* meeting is
   * recording, so it can be ended properly rather than abandoned when the window
   * closes. In memory only, and that is the correct scope: a session is here
   * because it was created or rehydrated this run.
   */
  liveIds(): readonly MeetingId[] {
    return [...this.#sessions.keys()]
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
    // The other half of `capture:essai`'s guard — see `essaiRunning` above. The
    // trial is twenty seconds and always stops; waiting is the whole remedy.
    if (this.#essaiRunning?.()) {
      throw new Error('Un essai audio est en cours — il se termine dans quelques secondes.')
    }

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
        // Capture is the one required connector and this fires on *Enregistrer*,
        // so this sentence is read at the worst possible moment. The native
        // module's own text is English; it follows ours rather than replacing it.
        reason: err instanceof Error ? `capture indisponible — ${err.message}` : 'capture indisponible',
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
    // What the module claimed, kept unstripped — see `registerRetry`, which has
    // to be able to re-ask the question when a retry arrives after a health.
    this.#claimed = { ...this.#claimed, [connector]: health }
    this.#health = { ...this.#health, [connector]: this.#truthful(connector, health) }
    this.#broadcast('health:changed', {
      connector,
      health: this.#health[connector],
      at: this.#clock(),
    })
  }

  /**
   * **`retryable` means the app can actually retry it.**
   *
   * A module decides whether *its* failure is transient, and it has no idea
   * whether anybody registered a way to act on that. Three did not — capture on
   * a device error, transcription on a provider error, and Outlook on an expired
   * token all reported `retryable: true`, and `retry()` below quietly returned
   * the unchanged health for every one of them. So Réglages drew a live
   * *Réessayer*, a rep pressed it, the row said « Vérification… » and came back
   * saying exactly what it said before. Forever.
   *
   * That is the dead button DEC-26 forbids, and the docblock on `registerRetry`
   * six lines down says so — which is how long the rule had been wrong in the
   * one file that states it. Onboarding's *Autoriser* inherited it whole.
   *
   * The claim is corrected **here**, at the single point where both facts are
   * known, rather than in each of the three modules. A module that grows a retry
   * gets the button back by registering it; a module that loses one loses the
   * button the same day, with no screen to update.
   *
   * The reason survives untouched. « micro indisponible — … » is worth reading
   * whether or not there is a control beside it, and stripping it would trade a
   * dead button for a bare red dot.
   */
  #truthful(connector: ConnectorId, health: ConnectorHealth): ConnectorHealth {
    if (health.state === 'ok' || !health.retryable) return health
    return this.#retries.has(connector) ? health : { ...health, retryable: false }
  }

  /**
   * A module registers how to retry itself when it registers as a connector.
   *
   * Without one, the connector's `retryable` is cleared on the way in
   * (`#truthful`) and no screen draws a control — rather than drawing one that
   * cannot work, which is the exact dead button DEC-26 forbids.
   */
  registerRetry(connector: ConnectorId, retry: () => Promise<ConnectorHealth>): void {
    const first = !this.#retries.has(connector)
    this.#retries.set(connector, retry)

    /*
     * **And the health already published is re-truthed, because `#truthful` runs
     * at write time and registration order is not a thing anyone can see.**
     *
     * `main.ts` published the capture health twenty-two lines before it
     * registered capture's retry. `#truthful` had therefore already stripped
     * `retryable: true` down to `false` and *stored the stripped value* — so on
     * macOS first run, the one permission that cannot be repaired after the call
     * drew « Réglages › » instead of « Autoriser », on both the onboarding step
     * and the *Requis* row it sends the rep to. Verbatim the failure
     * `capturePermission.ts` was written to close, reopened by two statements in
     * the wrong order, with nothing on screen or in any test able to show it —
     * and the harness fixture asserted the opposite in prose, twice.
     *
     * Re-publishing here makes the order irrelevant rather than correct-by-luck,
     * and it re-truths **the module's own claim** rather than guessing: a
     * connector whose health genuinely says `retryable: false` — `restricted`, a
     * managed device where nothing will ever change — must not be handed a retry
     * it never asked for. That is why `#claimed` exists beside `#health`: one is
     * what the module said, the other is what the app can honestly offer.
     * Only on the first registration, and only when the answer actually changes,
     * so a re-registration does not re-broadcast an unchanged row.
     */
    const claimed = this.#claimed[connector]
    if (!first || !claimed) return
    const upgraded = this.#truthful(connector, claimed)
    const stored = this.#health[connector]
    const offers = (health: ConnectorHealth | undefined): boolean =>
      health !== undefined && health.state !== 'ok' && health.retryable
    if (offers(upgraded) === offers(stored)) return
    this.#health = { ...this.#health, [connector]: upgraded }
    this.#broadcast('health:changed', { connector, health: upgraded, at: this.#clock() })
  }

  async retry(connector: ConnectorId): Promise<ConnectorHealth> {
    const retry = this.#retries.get(connector)
    // Unreachable through the UI now that `#truthful` clears the claim — kept
    // as the answer to a channel called directly, and it is the honest one:
    // nothing was retried, so nothing changed.
    if (!retry) return this.#health[connector] ?? { state: 'ok' }
    try {
      const health = await retry()
      this.setHealth(connector, health)
      return health
    } catch (err) {
      const health: ConnectorHealth = {
        state: 'down',
        reason: err instanceof Error ? `nouvelle tentative échouée — ${err.message}` : 'échec inconnu',
        since: this.#clock(),
        retryable: true,
      }
      this.setHealth(connector, health)
      return health
    }
  }
}
