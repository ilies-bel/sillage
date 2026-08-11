/**
 * The one moment the AI is allowed to write into the rep's document (DEC-5).
 *
 * A meeting reaching `ended` starts this; nothing else does. It runs the
 * recipe, records the result as events, and moves the machine to
 * `awaiting_confirmation` — which is the review gate, and the only gate (DEC-4).
 *
 * Kept out of `Orchestrator` because it is a *rule* about when enhancement
 * happens, and the orchestrator holds no rules of its own (ARCHITECTURE.md §4).
 * Kept out of `MeetingSession` because it does I/O.
 *
 * ## Why the failure path is so careful
 *
 * `extractionFailed` returns the machine to `ended`, so the retry costs the
 * enhancement and nothing else — the transcript, the rep's notes and the
 * recording are all already persisted and are never touched here. That is the
 * whole design: an extraction that fails is an inconvenience, not a lost
 * meeting.
 */
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { MeetingContext, MeetingId, MeetingState } from '../../core/contracts/meeting.ts'
import type { RecipeId } from '../../core/contracts/recipes.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'
import type {
  EnhancementStatus,
  ExtractionESN,
  VerificationReport,
} from '../../core/contracts/extraction.ts'
import type { MeetingSession } from './MeetingSession.ts'

/**
 * The half of `CompteRenduRecipe` this file uses. Structural, so `app/session/`
 * still names no module — the real one is injected in `main.ts`.
 */
export interface ExtractionRunner {
  run(input: {
    context: MeetingContext
    /** Which document to produce (DEC-43). Omitted means the default recipe. */
    recipe?: RecipeId
    transcript: readonly TranscriptSegment[]
    repEmail: string | null
    notes?: string
    signal?: AbortSignal
  }): Promise<{
    extraction: ExtractionESN
    verification: VerificationReport
    compteRendu: string
  }>
}

export interface EnhancementDeps {
  /**
   * Asked for at the moment a meeting ends, and null when no model is
   * configured — enhancement is then simply not offered.
   *
   * A function rather than a value because the answer changed: since DEC-34 a
   * rep can add a key, sign into ChatGPT or pick a different provider from
   * Réglages while the app runs, and a recipe captured at boot would keep the
   * whole session pinned to whatever was configured at launch. The rep's own
   * change taking effect only after a restart is the failure this shape exists
   * to make impossible — including in the other direction, where a key they
   * deleted would go on being used.
   */
  recipe: () => ExtractionRunner | null
  /** The signed-in rep's address, or null when Microsoft is not connected. */
  repEmail: () => string | null
  /**
   * The orchestrator's `dispatch`, **not** `MeetingSession.dispatch`.
   *
   * The difference is the broadcast. `extracting` and `awaiting_confirmation`
   * are the two states the review gate is built on, and a transition made
   * straight on the session advances the machine without telling the renderer —
   * so the rep watches a spinner that never resolves while the compte-rendu
   * sits finished in the database. Routing through the orchestrator is what
   * makes those transitions visible.
   */
  dispatch: (
    meetingId: MeetingId,
    command: 'extract' | 'extractionSucceeded' | 'extractionFailed',
    reason: string | null,
  ) => { ok: boolean }
  /**
   * The run's outcome, for the health board. `null` means it succeeded.
   *
   * Injected rather than mapped here, because "what does this failure say about
   * the model" is a question only `app/` can answer: the mapping needs
   * `modules/llm`'s `llmHealth` *and* `modules/extract`'s error kinds, and a
   * module may not import another module. It is also the difference between a
   * connector strip that goes red when a key expires and one that only ever
   * reports what was true at boot.
   */
  onOutcome?: (error: unknown | null) => void
  /**
   * This meeting's compte-rendu status has changed — go and broadcast it.
   *
   * The id only, not the status: computing one needs the meeting's state and
   * whether a provider is configured, and those live in `modules/store` and in
   * a credential vault respectively. Passing the id and letting `main.ts`
   * compose the answer keeps one implementation of "what is the status", shared
   * with the `enhancement:status` read — two would drift, and the symptom would
   * be a screen that says something different after a remount than it did a
   * second earlier.
   */
  onStatus?: (meetingId: MeetingId) => void
  diagnostics?: DiagRecorder
}

export interface EnhancementInput {
  session: MeetingSession
  context: MeetingContext
  /**
   * The recipe the meeting is set to (DEC-43), read from its log by the caller.
   *
   * Passed in rather than resolved here for the same reason `repEmail` is a
   * dep and not a lookup: `app/session/` may not read the store, and the answer
   * has to be the one that is true at the moment the run starts — a rep who
   * switches the picker and presses *Régénérer* is asking for the recipe they
   * just chose, not the one that was set when the meeting ended.
   */
  recipe?: RecipeId
  transcript: readonly TranscriptSegment[]
  /** The rep's own notes as plain text. Empty is normal — typing is optional (DEC-5). */
  notes: string
}

export class Enhancement {
  #deps: EnhancementDeps
  #diagnostics: DiagRecorder
  /** One run per meeting. A second `end` must not start a second extraction. */
  #running = new Set<MeetingId>()
  #attempts = new Map<MeetingId, number>()
  /**
   * Meetings that ended with no model to analyse them, kept so a model
   * appearing later can drain them without the rep asking twice.
   *
   * In memory, and that is the whole scope of the promise: « dès qu'un modèle
   * sera disponible » means within this run of the app. A quit clears it, and
   * the meeting is then a meeting in `ended` with a *Générer* button — which is
   * why `statusOf` reports `failed` with a null reason rather than `idle` for a
   * meeting it has never heard of. Persisting the set would be a projection
   * column whose only reader is a button that already exists.
   */
  #deferred = new Set<MeetingId>()
  /**
   * The last attempt's failure, per meeting, so the screen can say *what* went
   * wrong rather than only that something did. Cleared when an attempt starts,
   * because a stale reason beside a running spinner is a lie with a timestamp.
   */
  #lastFailure = new Map<MeetingId, string>()

  constructor(deps: EnhancementDeps) {
    this.#deps = deps
    this.#diagnostics = deps.diagnostics ?? NULL_RECORDER
  }

  /** True while this meeting's extraction is in flight. */
  isRunning(meetingId: MeetingId): boolean {
    return this.#running.has(meetingId)
  }

  /**
   * Meetings waiting on a model, for the caller that has just been told one
   * exists. A copy, so draining it cannot mutate what is being iterated.
   */
  deferred(): MeetingId[] {
    return [...this.#deferred]
  }

  /**
   * This meeting's status, given what `app/` knows about the world.
   *
   * `state` and `modelReady` are passed in rather than read here: the meeting
   * projection lives in `modules/store` and whether a provider is configured is
   * a question about a credential vault, and `app/session/` is allowed to know
   * neither. What it does know is what it has attempted, which is the half that
   * cannot be derived from anywhere else.
   */
  statusOf(
    meetingId: MeetingId,
    state: MeetingState,
    modelReady: boolean,
  ): EnhancementStatus {
    if (this.#running.has(meetingId) || state === 'extracting') return { status: 'running' }
    // Every other state is either before the question (`idle`, `armed`,
    // `recording`), past it (`awaiting_confirmation`, `pushing`, `done`) or out
    // of it (`aborted`). Only `ended` is a meeting owed a compte-rendu.
    if (state !== 'ended') return { status: 'idle' }
    if (!modelReady) return { status: 'waitingForModel' }
    return { status: 'failed', reason: this.#lastFailure.get(meetingId) ?? null }
  }

  /**
   * Runs the recipe for a meeting that has just ended.
   *
   * Never throws. Every failure becomes `extraction.failed` plus a diagnostic,
   * because the caller is an end-of-meeting handler and there is nobody above
   * it to catch anything.
   */
  async run(input: EnhancementInput): Promise<void> {
    const { session } = input
    const meetingId = session.id

    if (this.#running.has(meetingId)) return

    const recipe = this.#deps.recipe()
    if (!recipe) {
      // Not a failure, and deliberately not a state change: the meeting stays
      // `ended` with its transcript and notes intact.
      //
      // What *is* new is that it says so. This used to record a diagnostic and
      // return, which left the rep watching a recording end and nothing happen,
      // with the reason in a log they have no cause to open. The meeting is now
      // remembered as waiting, the screen is told, and the moment a provider is
      // configured in Réglages it drains — the promise the notice makes.
      this.#deferred.add(meetingId)
      this.#record('warn', 'enhancement.deferred', 'aucun modèle configuré', meetingId)
      this.#announce(meetingId)
      return
    }

    // Null, and that is not a refusal. This used to return here, which made a
    // Microsoft sign-in a prerequisite of the compte-rendu — so on a machine
    // with no Entra registration every meeting was recorded, transcribed and
    // then silently left un-analysed, with nothing on screen saying why. The
    // address names the rep on the document header and subtracts them from
    // `interlocuteurs`; a compte-rendu without it is missing a line, not
    // missing its point.
    const repEmail = this.#deps.repEmail()

    // The state machine decides whether this is legal, not this file. A meeting
    // that is not `ended` — already extracting, aborted, long since confirmed —
    // is refused here rather than half-run.
    if (!this.#deps.dispatch(meetingId, 'extract', 'fin de réunion').ok) return

    const attempt = (this.#attempts.get(meetingId) ?? 0) + 1
    this.#attempts.set(meetingId, attempt)
    this.#running.add(meetingId)
    // It is being analysed now, so it is neither waiting nor carrying the last
    // attempt's reason. Cleared before the announcement, so the screen never
    // draws a spinner next to a stale explanation of why nothing is happening.
    this.#deferred.delete(meetingId)
    this.#lastFailure.delete(meetingId)
    session.emit({ type: 'extraction.started', attempt })
    this.#announce(meetingId)

    try {
      const result = await recipe.run({
        context: input.context,
        transcript: input.transcript,
        repEmail,
        ...(input.recipe === undefined ? {} : { recipe: input.recipe }),
        ...(input.notes ? { notes: input.notes } : {}),
      })

      session.emit({
        type: 'extraction.completed',
        extraction: result.extraction,
        verification: result.verification,
      })
      this.#deps.dispatch(meetingId, 'extractionSucceeded', null)
      this.#report(null)

      this.#record(
        'info',
        'enhancement.completed',
        `compte-rendu produit (${result.compteRendu.length} caractères)`,
        meetingId,
        // The measured confidence, not a count of failures: `overall` is
        // `faible` when any field's quote could not be located (DEC-21), and
        // that rate is the thing worth watching over a week of demos.
        { attempt, overall: result.verification.overall },
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'extraction impossible'
      session.emit({ type: 'extraction.failed', reason })
      // Back to `ended`. The transcript and the rep's notes are untouched, so
      // the retry costs the enhancement only.
      this.#deps.dispatch(meetingId, 'extractionFailed', reason)
      this.#lastFailure.set(meetingId, reason)
      this.#report(error)
      this.#record('error', 'enhancement.failed', reason, meetingId, { attempt })
    } finally {
      this.#running.delete(meetingId)
      // After `#running` is cleared, so the status this sends is the one that
      // is true once the run is over rather than the one that was true inside
      // it. Both the success and the failure path arrive here; success reports
      // `idle`, because the meeting has moved on to the review gate and the
      // notice has nothing left to say.
      this.#announce(meetingId)
    }
  }

  /**
   * Tell whoever is listening that this meeting's status has moved.
   *
   * Swallows, for the same reason `#report` does: this is the notice *about* a
   * compte-rendu, and a notice that throws must not be able to take down the
   * compte-rendu it is describing. The worst case is a screen one refresh out
   * of date, and `enhancement:status` is readable on demand for exactly that.
   */
  #announce(meetingId: MeetingId): void {
    try {
      this.#deps.onStatus?.(meetingId)
    } catch {
      // Deliberately empty — see above.
    }
  }

  /**
   * Never throws into the run. A health board that fails while reporting a
   * failure would turn a degraded model into a lost compte-rendu, and the
   * extraction has already succeeded or failed by the time this is called.
   */
  #report(error: unknown | null): void {
    try {
      this.#deps.onOutcome?.(error)
    } catch {
      /* the strip is a readout, never a dependency */
    }
  }

  #record(
    severity: 'info' | 'warn' | 'error',
    code: string,
    message: string,
    meetingId: MeetingId,
    detail: Record<string, unknown> = {},
  ): void {
    this.#diagnostics.record({
      severity,
      code,
      module: 'app',
      message,
      detail: { meetingId, ...detail },
    })
  }
}
