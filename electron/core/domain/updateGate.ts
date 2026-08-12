/**
 * When it is safe to restart the app under the rep (DEC-4, DEC-26).
 *
 * Installing an update is `app.quit()` followed by an installer. That is the
 * most destructive thing this product can do to itself, and the whole of its
 * value — a meeting that is being recorded right now — sits in exactly the
 * window where it would land.
 *
 * ## Why this is a pure function and not an `if` in the updater
 *
 * The updater knows about GitHub releases and nothing else. It has no business
 * knowing that `pushing` means a `POST /v1/crm/tasks` with no idempotency key
 * is in flight, or that `awaiting_confirmation` means the rep is looking at
 * edits they have not saved. Those facts belong to the session, so the rule
 * that reads them belongs here, next to the state machine's other rules, where
 * one test covers it.
 *
 * ## Why every non-safe state names itself
 *
 * DEC-26 forbids a dead affordance: a disabled *Installer* button must say why
 * it is disabled. « Une réunion est en cours » and « Un compte-rendu attend
 * votre validation » call for different things from the rep — waiting versus
 * thirty seconds of clicking — and only the state knows which.
 */
import type { MeetingState } from '../contracts/meeting.ts'

/**
 * The states in which a restart destroys something, and what it destroys.
 *
 * Written as a total map over the blocking states rather than a list, so
 * adding a state to `MeetingStateSchema` without deciding its update
 * behaviour is a type error rather than an accidental « safe ».
 */
const BLOCKING: Readonly<Partial<Record<MeetingState, string>>> = {
  /*
   * The obvious one, and the only one anybody thinks of. Raw audio is never
   * retained (DEC-12), so a restart mid-recording does not lose a file that
   * could be reprocessed — it loses the meeting.
   */
  recording: 'une réunion est en cours d’enregistrement',
  /*
   * An armed session is a calendar event about to start (HR-9). Restarting
   * here means the app is not running when the rep joins the call, which is
   * the same failure as `recording` displaced by two minutes.
   */
  armed: 'une réunion est sur le point de démarrer',
  /*
   * The transcript is durable by now, but the compte-rendu is not: `ended` and
   * `extracting` are where enhancement runs. A restart costs the rep the
   * automatic write-up and sends them back to raw notes.
   */
  ended: 'un compte-rendu est en cours de rédaction',
  extracting: 'un compte-rendu est en cours de rédaction',
  /*
   * The rep is at the one human gate (DEC-4) with edits on screen that have
   * not been confirmed. Restarting discards their corrections — the single
   * thing the review gate exists to preserve.
   */
  awaiting_confirmation: 'un compte-rendu attend votre validation',
  /*
   * The worst of them, and the least visible. `POST /v1/crm/tasks` has no
   * idempotency key; the outbox drains an intent and persists the returned id
   * in one transaction. Killing the process between the POST and that commit
   * is how a VerySwing task gets created twice.
   */
  pushing: 'un envoi vers VerySwing est en cours',
}

export interface UpdateReadiness {
  /** Whether `quitAndInstall` may be called right now. */
  safe: boolean
  /**
   * French, and phrased to be read after « Mise à jour disponible — » on a
   * disabled control. `null` exactly when `safe`.
   */
  reason: string | null
}

/**
 * Given every session the app currently holds, may we restart?
 *
 * Takes the states rather than the sessions so it stays free of the store: the
 * caller in `app/` has the orchestrator and can enumerate. `done`, `aborted`
 * and `idle` are absent from `BLOCKING`, which is what makes the common case —
 * an app sitting between meetings — safe.
 */
export const updateReadiness = (states: readonly MeetingState[]): UpdateReadiness => {
  /*
   * First match wins, and the order is the array's, not a severity ranking.
   * With two sessions in blocking states any reason is true and any of them
   * stops the install; inventing a priority here would be a rule nobody asked
   * for and nobody tests.
   */
  for (const state of states) {
    const reason = BLOCKING[state]
    if (reason) return { safe: false, reason }
  }
  return { safe: true, reason: null }
}

/** Exported for the test, so the blocking set is asserted rather than retyped. */
export const UPDATE_BLOCKING_STATES = Object.keys(BLOCKING) as readonly MeetingState[]
