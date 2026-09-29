/**
 * Does the meeting's own name already carry the account's?
 *
 * Two screens print the pair. The review gate composes one heading —
 * `Review.tsx`, `title · account` — and the session header draws two fields,
 * `MeetingTitle.tsx`. Only the first had the rule, written inline as
 * `!panel.meeting.title.includes(edits.accountName)`, so « Néovia Santé —
 * cadrage renfort data » was followed by « · Néovia Santé » on one screen and
 * by a second field holding « Néovia Santé » on the other.
 *
 * The rule is the same rule and is now in one place, because a predicate copied
 * is a predicate that drifts: the moment one screen decides that a trailing
 * space counts and the other does not, a rep is looking at the same meeting
 * named two ways and has no way to know which screen is wrong.
 *
 * **Exact containment, on trimmed strings, and case matters.** That is what the
 * gate has always done; sharing it must not change a pixel the gate paints, and
 * widening it — casefolding, accent-folding, a prefix match — would change what
 * the gate suppresses on the screen whose POST has no idempotency key, on the
 * strength of no measurement. « Néovia Santé » inside « Néovia Santé — cadrage »
 * is the case this exists for and exact containment answers it. If a fixture
 * ever shows a rep writing « NÉOVIA SANTÉ » over an account of « Néovia
 * Santé », widen it here, once, with that fixture in the commit.
 *
 * An empty or absent account is never « already said »: there is nothing to
 * say twice, and a `''.includes` is true of every string, which would hide the
 * field on every untitled meeting in the product.
 */
export const titleSaysAccount = (title: string, account: string | null): boolean => {
  const name = (account ?? '').trim()
  if (name === '') return false
  return title.trim().includes(name)
}
