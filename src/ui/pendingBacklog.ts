/**
 * **The backlog's size, said the same way wherever it is said.**
 *
 * Two surfaces print this one number: the rail's note beside *À valider* and the
 * heading of *En attente de validation* on the calendar. `Agenda` holds one
 * answer from `history:search` and used to hand each of them a different part of
 * it — `pending={pending.result?.rows.length ?? null}` to the rail, and
 * `total` **plus** `capped` to the section. `capped` had exactly one reader, so
 * the rail printed a backlog the main process had cut short as if it were exact.
 *
 * Measured on the shipped renderer, `--scenario historique-annees` (eighteen
 * months of calls, the one fixture that reaches the fifty-row cap), at 1280×800
 * and at 960×600: « 50 » at x=193.75 y=147.36 in the rail against « 50+ » at
 * x=788.28 y=616.34 in the section, and « 50 appels en attente de validation »
 * in the accessible tree beside « au moins 50 réunions en attente de
 * validation ». One set, one screen, two numbers.
 *
 * So neither surface composes the mark any more: both are handed the pair the
 * channel answers with and ask here. A `capped` that cannot be dropped on the
 * way to a surface is the point of the type — `PendingBacklog` travels whole or
 * not at all, which is why `RailProps.pending` is this object and no longer a
 * bare `number`.
 *
 * The noun is the caller's, because the two surfaces name the same set
 * differently today — the rail counts « appels », the section counts
 * « réunions ». That is one screen using two words for one thing and it is not
 * this file's to settle; what this file settles is that the *number* and the
 * `+` cannot differ.
 */

export interface PendingBacklog {
  /** How many rows the main process returned for `statut: 'a-valider'`. */
  total: number
  /**
   * Whether a row was hidden — the handler's own answer, off the field the
   * search channel ships on every reply. Never `total >= PENDING_LIMIT`: that
   * is one more than the question, and it turned a rep owing exactly fifty
   * gestures into « 50+ ».
   */
  capped: boolean
}

/** What the eye reads: « 50 », or « 50+ » when a row was hidden. */
export const pendingMark = ({ total, capped }: PendingBacklog): string =>
  capped ? `${total}+` : String(total)

/**
 * What a screen reader is told, in French — the same claim as the mark.
 *
 * A bare numeral beside a heading reads as « En attente de validation trois »
 * and could be anything, so the sentence says what it counts; and it says the
 * `+` too, because a reader given « 50 » where the screen shows « 50+ » has
 * been told something the screen is not claiming.
 */
export const pendingLabel = (
  { total, capped }: PendingBacklog,
  noun: 'appel' | 'réunion',
): string => {
  const plural = capped || total > 1 ? 's' : ''
  const count = capped ? `au moins ${total}` : String(total)
  return `${count} ${noun}${plural} en attente de validation`
}
