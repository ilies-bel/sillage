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

/**
 * How long a quit waits for a tail already being flushed. See
 * `Orchestrator.settleRecordings`, which states why it is not the transcriber's
 * own thirty seconds and not the outbox's eight.
 */
const FLUSH_TIMEOUT_MS = 10_000

export class Orchestrator {
  #store: Store
  #diagnostics: DiagRecorder
  #clock: () => number
  #broadcast: Broadcaster
  #sessions = new Map<MeetingId, MeetingSession>()
  /**
   * The meetings this process has **acted on** — created, or dispatched a command
   * into — as distinct from the ones it merely looked up.
   *
   * `liveStates()` used to be `#sessions`, and `#sessions` is a *cache*: `session()`
   * is lazily rehydrated from the log, so **asking** a question about a meeting made
   * it live for the rest of the process. `liveStates()`'s own docblock stated the
   * property that breaks — « a meeting finished last week sits in the log and blocks
   * nothing » — and it was false of every read path in the product. Measured
   * (`scratch/r28-readonly-poison.mjs`): a second launch boots at `[]` and
   * `{ safe: true }`, one `stateOf` of a call that ended yesterday takes it to
   * `["ended"]` and « un compte-rendu est en cours de rédaction », for ever. So
   * *opening Historique on a past call refused every installer for the rest of the
   * session*, on the primary platform, with a French sentence that is false — and on
   * the demo build DEC-28 ships first that is every call ever recorded, because
   * `ended` persists indefinitely with no model (DEC-39).
   *
   * Round 27 then made it certain rather than merely likely: `Agenda.#calendarOffersAt`
   * asks `stateOf` on the thirty-second tick, so one tick of an ordinary morning — no
   * conferencing audio, nothing armed — was enough (`scratch/r28-rehydrate-updategate.mjs`).
   * That is the *third* instance in this repo of « the app could never install an
   * update again, on the primary platform », and the first caused by the fix for the
   * previous one.
   *
   * The cache has to stay a cache: a `MeetingSession` is the writer for its own log
   * and two instances of one meeting would be two objects appending to it. What was
   * wrong is reading the cache as an answer to a different question. Dispatch is the
   * only thing that moves a state and `create` the only thing that mints one, so
   * those two are exactly « work in flight in this process » — which covers the boot
   * re-drain (it dispatches), a crash-recovered `recording` (the boot sweep ends it,
   * which dispatches) and `before-quit`'s search for the live call, and excludes a
   * screen that read a row.
   */
  #touched = new Set<MeetingId>()
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
   * The flush each meeting is still in the middle of — see `stopRecording`, which
   * is where R32-1 lived, and `flushing()`, which is what `before-quit` asks.
   */
  #stopping = new Map<MeetingId, Promise<void>>()

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
              origin: 'foreign',
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
    this.#touched.add(session.id)
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
    // Acting on it, whatever the transition table answers — see `#touched`. A refused
    // command is still this process taking an interest, and `start` is refused below
    // on the strength of exactly this set.
    this.#touched.add(meetingId)

    /*
     * **One recording at a time, and this is the only place that can say so.**
     *
     * `MeetingSession`'s transition table is per meeting, so `idle → recording` is
     * legal for every session independently and nothing above it asked whether
     * another was already capturing. Measured on the shipped orchestrator:
     * `liveStates = ["recording","recording"]`. That is two `startRecording` calls,
     * **two microphone and two system-audio handles on the same devices**, two
     * transcribers, two compte-rendus and two pushes to VerySwing — where
     * `POST /v1/crm/tasks` has no idempotency key and `CrmPort` has no delete verb —
     * for one conversation. The widget adopts whichever `widget:state`'s `.find()`
     * returns and silently re-points at the other on the next `session:changed`,
     * carrying a different `startedAt` and a different mark list, so the one surface
     * that exists to prove the rep is being heard cannot say which call it means.
     *
     * `Orchestrator.recording()` already answered this question and had exactly one
     * caller — the onboarding dry run, which asks so it can refuse to open a second
     * handle on the same devices. The state machine never asked it.
     *
     * Here rather than in `MeetingSession`: this is a fact about the *process*, not
     * about a meeting, and `dispatch` is the one chokepoint every route goes through
     * — the IPC handler, `Agenda`, `Enhancement`, the boot re-drain. A refusal and
     * never a silent no-op, because DEC-26 wants a sentence the rep can act on, and
     * the sentence names the other call rather than the rule.
     */
    if (command === 'start') {
      const other = this.liveIds().find(
        (id) => id !== meetingId && this.stateOf(id) === 'recording',
      )
      if (other !== undefined) {
        return {
          ok: false,
          state: session.state,
          reason: 'une autre réunion est déjà en cours d’enregistrement',
        }
      }

      /*
       * **And not on top of the audio dry run** (DEC-45), refused *here* rather
       * than inside `startRecording`.
       *
       * That guard threw from above `startRecording`'s own try/catch, so it set
       * no health and aborted nothing — and the only production caller,
       * `#openDevices`, swallowed the rejection under a comment saying it had.
       * Driven on this class: the meeting stayed `recording` with
       * `recording() === false`, zero frames, zero segments, zero diagnostics and
       * `capture: ok`, for the life of the process. Nothing retried when the
       * trial ended twenty seconds later, the rep's next call was then refused
       * with « une autre réunion est déjà en cours d’enregistrement », and the
       * pill floated over the whole meeting saying « Enregistrement en cours ».
       *
       * Reachable with two presses: the dry run runs in the main process on a
       * wall clock and nothing cancels it, so closing Réglages leaves it running
       * while *Démarrer une réunion* is live behind it.
       *
       * A refusal before the transition is what the sibling above does and it is
       * what the rep wants: the meeting stays `idle`, the session screen draws
       * *Enregistrer*, and pressing it again once the trial is over works. The
       * sentence names the trial and the wait, because the remedy is to wait.
       */
      if (this.#essaiRunning?.()) {
        return {
          ok: false,
          state: session.state,
          reason: 'un essai audio est en cours — il se termine dans quelques secondes',
        }
      }
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

    /*
     * **The resolver is inside the try now, and it was the loudest of the three
     * routes out of here.**
     *
     * `#openDevices` is fired as `void`, so a throw from `recordingOptionsFor`
     * — it reads Réglages and the OS credential store — was an *unhandled
     * rejection* and the meeting stayed `recording` with nothing behind it.
     * Measured on this class, one per start.
     */
    try {
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
      await this.startRecording(meetingId, options)
    } catch (err) {
      this.#strandedStart(meetingId, err)
    }
  }

  /**
   * **A start that threw and left the machine claiming to record.**
   *
   * This catch used to be empty, under « `startRecording` has already set health
   * and aborted the meeting ». It has, for everything thrown from inside its own
   * try — and for nothing thrown above it. Three routes were driven past it on
   * this class, each ending in `recording` with `recording() === false`,
   * `capture: ok` and no diagnostic at all: the dry-run guard (now refused a
   * layer up, where the rep can act on it), `createSignals` throwing, and
   * `recordingOptionsFor` throwing.
   *
   * What that costs is the product's one unacceptable failure and it is silent:
   * no frames, no segments, an `Enregistrement en cours` pill over the whole
   * call, `session:pause` refused for the length of it, and every later
   * *Enregistrer* refused with « une autre réunion est déjà en cours
   * d’enregistrement » until the process restarts.
   *
   * Idempotent by construction rather than by flag: it does nothing if the
   * devices did open, and nothing if the meeting has already left `recording`,
   * which is the ordinary case because `startRecording`'s own catch got there
   * first.
   */
  #strandedStart(meetingId: MeetingId, err: unknown): void {
    if (this.#recordings.has(meetingId)) return
    if (this.stateOf(meetingId) !== 'recording') return
    const reason = err instanceof Error ? err.message : 'capture indisponible'
    this.setHealth('capture', {
      state: 'down',
      reason,
      since: this.#clock(),
      retryable: true,
    })
    this.dispatch(meetingId, 'abort', reason)
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
        origin: 'foreign',
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

  /**
   * **The rep has the review gate open on this meeting.**
   *
   * `awaiting_confirmation` blocks an installer because, in `updateGate.ts`'s own words,
   * « the rep is at the one human gate (DEC-4) with edits on screen that have not been
   * confirmed. Restarting discards their corrections — the single thing the review gate
   * exists to preserve. » Nothing dispatches when a gate *opens*: `review:get` reads the
   * projection and asks `stateOf`. So once `liveStates()` stopped answering from the
   * rehydration cache, a meeting that reached the gate **last launch** — which on the
   * demo build DEC-28 ships first is every meeting until somebody validates it — no
   * longer blocked anything. Measured (`scratch/r29-gate-update.mjs`): launch 1 refuses
   * with « un compte-rendu attend votre validation »; launch 2 opens the same gate and
   * answers `{ safe: true }`. A rep who records at 17:00, quits, comes back Friday
   * morning, corrects the compte-rendu and three of the eleven fields — `PENDING_EDITS`
   * is deliberately in memory — is then offered « Installer et redémarrer », and
   * `updateTick` downloads the installer while they stand there.
   *
   * Round 28 traded a permanent false refusal for a silent permission, and only the
   * first half had a test. The honest trigger is not the stored state, which is stale
   * for ever with no model: it is **this** — the gate was opened, in this process, by
   * this rep. It stays marked, because the drafts it protects do: `PENDING_EDITS` holds
   * them for the life of the window and only a confirmation clears them.
   */
  atGate(meetingId: MeetingId): void {
    if (this.session(meetingId) !== null) this.#touched.add(meetingId)
  }

  stateOf(meetingId: MeetingId): MeetingState {
    return this.session(meetingId)?.state ?? 'idle'
  }

  /**
   * Every session the app is holding in memory, for `core/domain/updateGate.ts`.
   *
   * In-memory only, and **created or dispatched into rather than merely looked up**
   * — see `#touched`. The distinction is the whole property: this used to read the
   * rehydration cache, so a screen *reading* a past meeting made it live and « a
   * meeting finished last week sits in the log and blocks nothing », two lines above
   * where it was written, was false of every read path in the product.
   */
  liveStates(): readonly MeetingState[] {
    return this.liveIds().map((id) => this.#sessions.get(id)?.state ?? 'idle')
  }

  /**
   * The meetings this process is holding, by id.
   *
   * `liveStates` answers « is anything happening » — enough to refuse an
   * installer — and `before-quit` needs the other half: *which* meeting is
   * recording, so it can be ended properly rather than abandoned when the window
   * closes. In memory only, and **acted on** rather than looked up, for the reason
   * `#touched` states at length.
   */
  liveIds(): readonly MeetingId[] {
    return [...this.#touched].filter((id) => this.#sessions.has(id))
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
              origin: 'foreign',
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

  /**
   * Resolves once both providers have flushed — the tail of a call is the part
   * with the next steps in it.
   *
   * **One flush per recording, and every caller awaits the same one.**
   *
   * This used to delete the `Recording` and then await it, which reads as
   * defensive and was the whole of R32-1. `dispatch(id, 'end')` fires
   * `void this.#enhance(id)`; `#enhance` is `async`, so its body runs
   * synchronously to its first `await` — which is `await this.stopRecording(id)`,
   * and *evaluating that call* runs this body synchronously to its own first
   * await, `#recordings.delete(meetingId)` already executed. So one line later
   * `before-quit`'s own `await orchestrator.stopRecording(meetingId)` returned at
   * `if (!recording) return`: it waited for nothing, having been told by its own
   * docblock that both providers had flushed. Measured on the real `Store` and
   * this class, with a transcriber that emits a tail segment inside `stop()` the
   * way `LocalWhisperSession.#shutdown()` and every REST provider do
   * (`scratch/r32-1-drive.ts`):
   *
   *     onEnded injected: no    flushed? true   tail segments in the log: 1
   *     onEnded injected: YES   flushed? false  tail segments in the log: 0
   *
   * and `onEnded` is injected by `main.ts` on every launch, so the second row is
   * the product. On Windows — the primary platform (HR-2) — `window-all-closed`
   * quits, so « get the app out of the way at the end of a call » is a quit: the
   * last utterance, up to `GAP_FLUSH_MS` of held speech plus whatever is queued
   * in the model, never reached the log. It is therefore missing from the
   * transcript the compte-rendu is folded from, from what `[source ▸]` reads, and
   * from what VerySwing receives.
   *
   * So the in-flight flush is memoised **per meeting** and a second caller awaits
   * the first. Three things about the memo, each measured rather than reasoned:
   *
   *  · It is **set synchronously**, before the first await, because that is the
   *    only way `before-quit` can find it: it dispatches and calls this one line
   *    later, with no tick in between.
   *  · It is **cleared when the flush settles**, not kept. `enhance()` — the
   *    retry path, and a first attempt once a model finally exists — calls this on
   *    a meeting that stopped minutes ago and expects a no-op; a memo kept for the
   *    life of the process would hand it a *rejected* promise for ever if that
   *    one flush had failed.
   *  · A rejection reaches **every** awaiter. `#enhance` records
   *    `enhancement.unhandled` and `before-quit` records `app.quit.endFailed`, and
   *    two rows for one failed flush is the honest reading: two callers needed it.
   */
  /**
   * `session:pause`. A verb on the recording, not on the machine — see the
   * channel's docblock. Answers what is true afterwards, which for a meeting
   * that is not recording is `false`.
   */
  setPaused(meetingId: MeetingId, paused: boolean): boolean {
    const recording = this.#recordings.get(meetingId)
    if (!recording) return false
    const before = recording.paused
    const now = recording.pause(paused)
    if (now === before) return now
    const watch = this.#endWatch.get(meetingId)
    if (now) watch?.hold()
    else watch?.release()
    // Two literals, not one ternary: `check:diag` reads what this product wrote.
    if (now) {
      this.#diagnostics.record({
        severity: 'info',
        code: 'recording.paused',
        module: 'app',
        message: 'Enregistrement en pause',
        detail: { meetingId },
        meetingId,
      })
    } else {
      this.#diagnostics.record({
        severity: 'info',
        code: 'recording.resumed',
        module: 'app',
        message: 'Enregistrement repris',
        detail: { meetingId },
        meetingId,
      })
    }
    this.#broadcast('recording:paused', { meetingId, paused: now })
    return now
  }

  isPaused(meetingId: MeetingId): boolean {
    return this.#recordings.get(meetingId)?.paused ?? false
  }

  async stopRecording(meetingId: MeetingId): Promise<void> {
    const inFlight = this.#stopping.get(meetingId)
    if (inFlight) {
      await inFlight
      return
    }
    this.#stopSignals(meetingId)
    this.#endWatch.get(meetingId)?.stop()
    this.#endWatch.delete(meetingId)
    const recording = this.#recordings.get(meetingId)
    if (!recording) return
    this.#recordings.delete(meetingId)
    const flush = (async () => {
      try {
        await recording.stop()
      } finally {
        this.#stopping.delete(meetingId)
      }
    })()
    this.#stopping.set(meetingId, flush)
    await flush
  }

  /**
   * **Is this process still owed a tail?**
   *
   * Asked by `before-quit` *before* it decides whether to defer the quit, and it
   * is not the same question as « is a meeting recording ». `PowerWatch` ends a
   * live recording synchronously inside the OS handler — it has to, because the
   * machine may never come back — and that dispatch starts the flush. By the time
   * `before-quit` runs, the meeting is `ended`, so the predicate it had found
   * nothing, it did not even `preventDefault()`, and `store.close()` landed a few
   * microtasks later while the local engine was still draining on a thirty-second
   * budget. Measured before this existed: `defers the quit? false`, and the tail
   * segment arrived at a closed database.
   *
   * That made Windows shutdown and « Se déconnecter » — `session-end`, the one
   * branch a rep on the primary platform can actually reach — strictly worse
   * after `b2cc981` than before it, which is why this is a question the
   * orchestrator answers rather than something `PowerWatch` was asked to do: the
   * handler cannot wait, so what it can do is leave something to wait for.
   */
  flushing(): boolean {
    return this.#stopping.size > 0
  }

  /**
   * **Waits for every flush in flight, bounded.** The one caller is `before-quit`.
   *
   * Bounded for the reason `Outbox.settle` is: a rep who pressed close is owed a
   * window that goes away, and an unbounded wait on a provider that never answers
   * is a process the rep kills — which loses the tail as well and looks broken
   * doing it. The asymmetry runs the other way from the outbox's, though, and
   * that is why this number is larger than a POST's: an interrupted push is
   * reclaimed on the next launch by `Projections.interrupted()`, and **a lost tail
   * has no recovery at all** — the audio is gone (DEC-12), so whatever expiry
   * discards here is discarded for good.
   *
   * Ten seconds rather than the transcriber's own thirty: that budget is sized
   * for a *cold* model, and a quit during a recording cannot be cold — the engine
   * has been transcribing this call for the length of it. What ten seconds covers
   * is a warm model with a couple of queued finals, which is what the end of a
   * call actually is.
   *
   * `false` means the wait expired, and the caller says so in the log rather than
   * quitting silently (DEC-26). The loop re-reads the map because a flush can
   * start while this is waiting — `#enhance` on a second meeting, the widget's own
   * *Terminer* — and `allSettled` because one provider failing must not abandon
   * the other one's tail.
   */
  async settleRecordings(timeoutMs = FLUSH_TIMEOUT_MS): Promise<boolean> {
    if (this.#stopping.size === 0) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
      timer.unref?.()
    })
    const drained = (async () => {
      while (this.#stopping.size > 0) {
        await Promise.allSettled([...this.#stopping.values()])
      }
      return true
    })()
    try {
      return await Promise.race([drained, expired])
    } finally {
      if (timer) clearTimeout(timer)
    }
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
    /*
     * **A synthesised end is not a scheduled end.**
     *
     * `graceFor` shortens the end-of-meeting grace from 75 s to 25 s once the
     * silence starts past `scheduledEnd`, and the reasoning for that is entirely
     * about a *calendar* slot: the invite said 15:00, it is 15:02, a pause is far
     * more likely to be the end. A meeting with no invite has no such instant,
     * and both paths that create one invent a number:
     *
     *   `adHocContext`   `heldSince + 1h`, whose own docblock says « it is not a
     *                    claim about when the call will end » — and `graceFor`
     *                    read it as exactly that claim, so a 25-second pause at
     *                    minute 61 of an unscheduled call ended the recording.
     *   `manualContext`  `endedAt ?? updatedAt`, which for a live meeting is
     *                    roughly *now* — the short grace from the first second.
     *
     * `eventId === null` is the fact that separates them, and it is the same fact
     * `MeetingContextSchema` documents: « Null for a manually started session with
     * no calendar entry ». CLAUDE.md already states the rule this restores — « a
     * session with no calendar entry always gets the full grace » — and there is a
     * test named for it, which passed because it supplies a null *context*, not a
     * context with a synthesised end.
     */
    const context = this.#store.projections.context(meetingId)
    const scheduledEnd = context && context.eventId !== null ? context.scheduledEnd : null
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
            origin: 'authored',
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
