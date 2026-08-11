/**
 * Why an extraction did not happen, at the granularity the caller can act on.
 *
 * There is no partial `ExtractionESN`. The review gate is the one confirmation
 * (DEC-4) and it shows the rep something they are about to send to a client's
 * CRM — a half-filled form presented as complete is the failure mode that costs
 * a deal, so the recipe either returns a whole extraction or throws one of
 * these. `MeetingSession` decides what to do with it; nothing here decides on
 * its behalf.
 *
 * The transcript and the rep's notes are already persisted by the time this
 * throws (DEC-26: nothing downstream may stop a meeting being recorded), so
 * every kind below is survivable — the meeting is intact and the extraction can
 * be run again.
 */

/**
 * `llm`             the provider failed: auth, quota, timeout, network. The
 *                   `cause` is the `LlmError` and carries the retryable flag.
 * `reply-invalid`   the reply did not match the recipe's schema. A regeneration
 *                   is the natural remedy.
 * `deterministic-leak`
 *                   the reply carried a name, an e-mail or an account code —
 *                   data that comes from Graph and VSA and is never the model's
 *                   to produce (DEC-7). Refused rather than stripped: a model
 *                   that invents an attendee has misunderstood the job, and the
 *                   rest of its reply is not more trustworthy for having been
 *                   cleaned up.
 * `empty-transcript`
 *                   nothing citable was recorded. Not a model failure at all,
 *                   and it must not be reported as one — the honest message is
 *                   "rien n'a été transcrit", which points at capture.
 */
export type ExtractionErrorKind =
  | 'llm'
  | 'reply-invalid'
  | 'deterministic-leak'
  | 'empty-transcript'

export class ExtractionError extends Error {
  readonly kind: ExtractionErrorKind
  /** Worth running the same extraction again, unchanged. */
  readonly retryable: boolean
  /** What was wrong, one line each. Shown in diagnostics, never to the rep. */
  readonly details: string[]

  constructor(input: {
    kind: ExtractionErrorKind
    message: string
    retryable: boolean
    details?: string[]
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'ExtractionError'
    this.kind = input.kind
    this.retryable = input.retryable
    this.details = input.details ?? []
  }
}

/** French, because it is the string the session surfaces (HR-6). */
export const extractionErrorMessage = (kind: ExtractionErrorKind): string => {
  switch (kind) {
    case 'llm':
      return "Le modèle n'a pas répondu. Le compte-rendu n'a pas été généré."
    case 'reply-invalid':
      return "La réponse du modèle n'a pas le format attendu. Aucun compte-rendu n'a été retenu."
    case 'deterministic-leak':
      return 'La réponse du modèle contenait des données qui ne sont pas les siennes (nom, e-mail ou référence client). Elle a été refusée.'
    case 'empty-transcript':
      return "Rien n'a été transcrit pendant cette réunion."
  }
}
