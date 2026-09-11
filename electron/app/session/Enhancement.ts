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
import type { AccountCandidate, AccountQuery } from '../../core/contracts/crm.ts'
import type { AccountRef } from '../../core/contracts/extraction.ts'
import type { RecipeId } from '../../core/contracts/recipes.ts'
import { ExtractionError } from '../../modules/extract/errors.ts'
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
   * **Which VerySwing account this call belongs to, asked once, before the
   * recipe runs.**
   *
   * `CrmPort.resolveAccount` was declared, implemented in `VsaCrm`, tested — and
   * called by nothing at all. A grep for it outside `modules/crm` returned the
   * declaration and nothing else, so `facts.account` was `UNRESOLVED_ACCOUNT` on
   * every meeting the product has ever produced. That is not a cosmetic gap:
   * `reviewGate.ts`'s `opportunityPossible` reads `edits.accountId !== null`, so
   * **the opportunity was structurally impossible**, and `VsaCrm.link()` fell
   * through OPPY → COMPANY → FREE to its last branch and created every
   * compte-rendu task as an orphan with no `linkType` and no client on it. Two
   * of the three things the one button promises could not happen, on the
   * deliverable DEC-28 calls first.
   *
   * A function and optional, for the two reasons every port here is: VerySwing
   * is optional (DEC-26), and a rep can connect it from Réglages mid-session, so
   * a value captured at boot would pin the answer to whatever was configured at
   * launch.
   *
   * It never throws outward and never blocks the compte-rendu. An unreachable
   * CRM leaves the account unresolved, which is the state the whole gate is
   * already built to render — the row says so and the opportunity states why it
   * cannot ship. Losing the compte-rendu because a CRM was down would invert
   * DEC-26 exactly.
   */
  resolveAccount?: (query: AccountQuery) => Promise<AccountCandidate[]>
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
  /** Injectable so a test can assert on the elapsed clock without waiting. */
  clock?: () => number
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
  /**
   * Meetings whose end-of-meeting path has begun but whose run has not.
   *
   * Between the `ended` transition and the first line of `run` sits the
   * transcriber flush — a second or two on a batch provider, longer on a long
   * call. In that window the meeting is `ended`, nothing is in `#running`, and
   * `statusOf` therefore answered `failed`: a rep who pressed *Terminer* and
   * reloaded, or who opened the meeting from Historique at that moment, was
   * told the compte-rendu had not been written and offered a button to write
   * it — while the run was already on its way. `ended` drawing no control, the
   * screen was otherwise blank, which is the one thing DEC-39 exists to
   * prevent.
   *
   * Set by `begin`, cleared by `run`. Separate from `#running` because that set
   * is the double-run guard and an entry in it would make `run` return early.
   */
  #starting = new Set<MeetingId>()
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
  /**
   * When the current path started, so the notice can draw a clock rather than a
   * sentence that never changes (see `EnhancementStatusSchema`).
   *
   * Stamped by `begin` and by `run`, whichever reaches the meeting first, and
   * kept across the handover between them — the rep is waiting on one wait, not
   * on a flush and then a model.
   */
  #startedAt = new Map<MeetingId, number>()
  #clock: () => number

  constructor(deps: EnhancementDeps) {
    this.#deps = deps
    this.#diagnostics = deps.diagnostics ?? NULL_RECORDER
    this.#clock = deps.clock ?? Date.now
  }

  /*
   * **`isRunning` is gone for the reason `Outbox.isDraining` is.**
   *
   * It answered « is this meeting's extraction in flight », which nothing asks:
   * `before-quit` deliberately does *not* wait for enhancement — it can take
   * minutes and a rep who pressed close is owed a window that goes away — and
   * `reconcile` reads `#running` directly, from inside. Declared, documented,
   * unit-tested, unreached.
   */

  /**
   * The end-of-meeting path has started on this meeting — say so now, rather
   * than when the model is finally called.
   *
   * Called before the transcriber is flushed, which is the part of the path
   * that takes measurable time and during which the screen used to have
   * nothing to show. Idempotent, and harmless on a meeting whose run never
   * materialises: `run` clears it on every exit, and a path that dies before
   * reaching `run` leaves a meeting reported as *running* until the next
   * status read, which re-derives from a state the store still has.
   */
  begin(meetingId: MeetingId): void {
    if (this.#running.has(meetingId) || this.#starting.has(meetingId)) return
    this.#starting.add(meetingId)
    this.#startedAt.set(meetingId, this.#clock())
    this.#announce(meetingId)
  }

  /**
   * Free a meeting the log says is `extracting` with nothing running behind it.
   *
   * That combination has exactly one cause: a run that did not finish because
   * the process did not. The state is persisted, `#running` is not, so the next
   * launch replays a meeting into `extracting` and leaves it there — and
   * `extracting` is the worst state to be stranded in. `statusOf` reports
   * `running`, so the notice draws « Rédaction du compte-rendu… » with no
   * control; the review gate is closed with *Analyse en cours…*; the recipe
   * picker locks itself to « rédaction en cours »; and `extract` is not legal
   * from `extracting`, so the retry — the one way out of every other failure —
   * is refused before it does anything. A meeting that reached this state was
   * unrecoverable short of deleting the database, and it was a rep's own
   * recorded call.
   *
   * So it is treated as what it is: a failed attempt. `extractionFailed` puts
   * the meeting back in `ended` with its transcript, its notes and its
   * recording untouched — exactly where a model timing out would have left it —
   * and the notice then offers *Rédiger le compte-rendu*.
   *
   * Deliberately **not** an automatic re-run. The interrupted attempt may be
   * what stopped the process, and a boot that silently re-enters it is a crash
   * loop that costs a model call each time round. The rep is told what happened
   * and given the button.
   *
   * `state` is passed in for the same reason `statusOf` takes it: the meeting
   * projection lives in `modules/store` and `app/session/` may not read it.
   * Returns whether it actually freed one, so the caller can say how many.
   */
  reconcile(meetingId: MeetingId, state: MeetingState): boolean {
    if (state !== 'extracting') return false
    if (this.#running.has(meetingId)) return false

    const reason = 'l’application s’est arrêtée pendant la rédaction'
    if (!this.#deps.dispatch(meetingId, 'extractionFailed', reason).ok) return false

    this.#starting.delete(meetingId)
    this.#startedAt.delete(meetingId)
    this.#lastFailure.set(meetingId, reason)
    this.#record('warn', 'enhancement.interrupted', reason, meetingId)
    this.#announce(meetingId)
    return true
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
    if (this.#running.has(meetingId) || this.#starting.has(meetingId) || state === 'extracting') {
      return { status: 'running', since: this.#startedAt.get(meetingId) ?? null }
    }
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

    // The path `begin` announced has arrived. Cleared here rather than only in
    // the `finally`, because every early return below is an outcome the status
    // has to be free to describe — a meeting that found no model is *waiting*,
    // not still starting.
    this.#starting.delete(meetingId)

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
      // Nothing is being written, so there is nothing to time. A meeting
      // waiting on a model waits for as long as it takes a rep to configure
      // one, and a clock on that is a stopwatch on the rep.
      this.#startedAt.delete(meetingId)
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
    // Kept if `begin` already stamped it: the rep pressed *Terminer* once and
    // has been waiting since then, not since the flush happened to finish. Set
    // here for the paths that skip `begin` — the retry, and the drain that
    // follows a model appearing in Réglages.
    if (!this.#startedAt.has(meetingId)) this.#startedAt.set(meetingId, this.#clock())
    // It is being analysed now, so it is neither waiting nor carrying the last
    // attempt's reason. Cleared before the announcement, so the screen never
    // draws a spinner next to a stale explanation of why nothing is happening.
    this.#deferred.delete(meetingId)
    this.#lastFailure.delete(meetingId)
    session.emit({ type: 'extraction.started', attempt })
    this.#announce(meetingId)

    try {
      const account = await this.#resolveAccount(meetingId, input.context)
      const result = await recipe.run({
        context: input.context,
        transcript: input.transcript,
        repEmail,
        ...(account === null ? {} : { account }),
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
      /*
       * **`EnhancementNotice` welds this into a French sentence, so it has to be
       * one.** `asExtractionError` guarantees a French message for everything
       * the recipe throws — but this `try` is wider than the recipe: it covers
       * `#resolveAccount` and two store writes, and a `SQLITE_BUSY` or a throw
       * from our own code read « Le compte-rendu n'a pas pu être rédigé :
       * database is locked » on the screen that explains why the product's one
       * output is missing. The cause is kept; it just never stands alone.
       */
      const reason =
        error instanceof ExtractionError
          ? error.message
          : `rédaction impossible — ${error instanceof Error ? error.message : String(error)}`
      session.emit({ type: 'extraction.failed', reason })
      // Back to `ended`. The transcript and the rep's notes are untouched, so
      // the retry costs the enhancement only.
      this.#deps.dispatch(meetingId, 'extractionFailed', reason)
      this.#lastFailure.set(meetingId, reason)
      this.#report(error)
      /*
       * **A meeting nobody spoke on is an outcome, not a fault.**
       *
       * `empty-transcript` is the recipe saying there was nothing to summarise —
       * a call that was cancelled after thirty seconds, a session started by
       * mistake, the twenty-second trial of a rep who said nothing. The app did
       * everything right, and logging it at `error` put a red line in the
       * diagnostics bundle beside « le module audio natif ne se charge pas ». A
       * bundle where the two look the same is the evidence nobody can read on a
       * support call, which is DEC-27's cost with none of its benefit.
       *
       * Every other kind stays `error`: a model that would not answer, a reply
       * that would not parse, a leak that was refused — those are the app or its
       * provider failing, and they are what the severity is for.
       */
      const expected = error instanceof ExtractionError && error.kind === 'empty-transcript'
      this.#record(
        expected ? 'warn' : 'error',
        'enhancement.failed',
        reason,
        meetingId,
        { attempt },
      )
    } finally {
      this.#running.delete(meetingId)
      this.#startedAt.delete(meetingId)
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
  /**
   * The account this call belongs to, or `null` when nobody could say.
   *
   * **Never throws and never blocks.** VerySwing is optional (DEC-26) and the
   * compte-rendu is the thing the product exists to produce: a CRM that is
   * unreachable, slow or not configured leaves the account unresolved, which is
   * a state every surface downstream already renders — the gate's *Client* row
   * says so, and the opportunity states why it cannot ship. Losing the document
   * because a lookup failed would invert DEC-26 exactly.
   *
   * **Only an unambiguous answer is taken.** `resolveAccount` returns scored
   * candidates and the top one is used only when it stands clear of the second:
   * DEC-18's whole argument is that picking the wrong company is the expensive
   * mistake — the compte-rendu lands in a stranger's file — and a tie is the
   * case where the app has no basis to choose. Unresolved is honest and the rep
   * is shown the alternatives at the gate (`accountCandidates`); a confident
   * wrong answer is not, and it is `⚠ faible` on the row rather than a silent
   * pick.
   */
  async #resolveAccount(meetingId: MeetingId, context: MeetingContext): Promise<AccountRef | null> {
    const resolve = this.#deps.resolveAccount
    if (!resolve) return null
    try {
      const attendeeEmails = context.attendees.map((a) => a.email).filter((e) => e.trim() !== '')
      if (attendeeEmails.length === 0) return null
      const candidates = await resolve({ attendeeEmails, hint: context.subject })
      const [best, next] = candidates
      if (!best) return null
      // A margin, not a threshold: what matters is whether one candidate stands
      // out, not how sure the scorer claims to be about it in the abstract.
      const clear = next === undefined || best.score - next.score >= 0.2
      if (!clear) {
        this.#record(
          'info',
          'extraction.account.ambiguous',
          'plusieurs comptes VerySwing correspondent',
          meetingId,
          { candidates: candidates.slice(0, 4).map((c) => `${c.name} (${c.score})`) },
        )
        return null
      }
      return { accountId: best.accountId, name: best.name, confidence: best.confidence }
    } catch (error) {
      // A diagnostic, never a failure: see above.
      this.#record(
        'warn',
        'extraction.account.failed',
        error instanceof Error ? error.message : 'compte VerySwing non résolu',
        meetingId,
      )
      return null
    }
  }

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
