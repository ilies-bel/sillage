/**
 * `DeterministicFacts`, assembled in plain code from `MeetingContext` (DEC-7).
 *
 * There is no model in this file and there is no transcript in this file. Who
 * was in the meeting, what it was called and when it ran are answers Microsoft
 * Graph already gave us; re-deriving them from what a speech-to-text engine
 * heard would be replacing a fact with a guess. `modules/extract` exists to
 * produce the *interpretation* — this half is a projection, and it is pure so
 * it can be tested without an Electron mock, a network or a key.
 */
import type { AccountRef, DeterministicFacts } from '../../core/contracts/extraction.ts'
import type { Attendee, MeetingContext } from '../../core/contracts/meeting.ts'

/**
 * What an unresolved account is: **empty**, and `faible` so the gate says so.
 *
 * It used to be « Client à confirmer ». That is a sentence, not a client, and it
 * behaved like one: it pre-filled the account field so the row looked answered,
 * `Projections.ts` wrote it into `meetings.client_name` on
 * `extraction.completed`, and from there it reached the session header, the
 * search chips and the lexicon's per-client scope — where terms were learned
 * "for Client à confirmer" and shared across every unresolved meeting. A
 * placeholder that is stored is indistinguishable from data.
 *
 * Empty is the honest shape: nothing is known, the field is blank with a hint
 * beside it, `⚠ faible` is still on the row, and `accountId` is still null —
 * which is what already makes the opportunity undraftable (DEC-20).
 */
export const UNRESOLVED_ACCOUNT: AccountRef = {
  accountId: null,
  name: '',
  confidence: 'faible',
}

const key = (attendee: Attendee): string => attendee.email.trim().toLowerCase()

/**
 * Everyone who was invited except the rep and the rooms.
 *
 * `resource` attendees are meeting rooms and equipment — Graph returns them in
 * the same array as people, and a conference room does not become a CRM
 * contact. Colleagues of the rep are *kept*: an ESN sends a presales engineer
 * into calls routinely, and the review gate is where a human removes a row
 * (DEC-4). Guessing that a shared mail domain means "not an interlocutor" would
 * be right most of the time and silently wrong on every meeting with a partner.
 *
 * The organiser comes first because they usually are the client, and order here
 * is the order the review screen renders.
 */
export const interlocuteursOf = (
  context: MeetingContext,
  repEmail: string | null,
): Attendee[] => {
  // No signed-in rep means nobody to subtract, not nobody to keep. The list is
  // then everyone Graph invited, and the review gate is where a human removes
  // the row that is themselves (DEC-4) — which is the same gesture they already
  // have for a colleague who should not become a CRM contact.
  const rep = repEmail?.trim().toLowerCase() ?? ''
  const seen = new Set<string>()
  const people: Attendee[] = []

  for (const attendee of [context.organizer, ...context.attendees]) {
    if (attendee.type === 'resource') continue
    const email = key(attendee)
    if (email !== '' && email === rep) continue
    if (email !== '' && seen.has(email)) continue
    if (email !== '') seen.add(email)
    people.push(attendee)
  }

  return people
}

export interface BuildFactsInput {
  context: MeetingContext
  /**
   * The authenticated rep (MSAL account), not anything read off the call, and
   * null when Microsoft is not connected.
   */
  repEmail: string | null
  /** Resolved by `modules/crm`. Absent until step 8 wires it. */
  account?: AccountRef
  /** Contacts the CRM already knows, matched by attendee e-mail. */
  knownContactIds?: readonly string[]
}

export const buildFacts = (input: BuildFactsInput): DeterministicFacts => {
  return {
    // Blank when the meeting has no subject, for the reason `UNRESOLVED_ACCOUNT`
    // is blank: « Rendez-vous client » filled the one field VSA requires with a
    // phrase nobody chose, so the gate looked complete and the CRM received a
    // task named after nothing. Empty is refused by `draftIntents`, with the
    // reason on the row (DEC-26) — one word from the rep and it ships.
    taskName: input.context.subject.trim(),
    startsAt: input.context.scheduledStart,
    endsAt: input.context.scheduledEnd,
    interlocuteurs: interlocuteursOf(input.context, input.repEmail),
    repEmail: input.repEmail,
    account: input.account ?? UNRESOLVED_ACCOUNT,
    knownContactIds: [...(input.knownContactIds ?? [])],
  }
}
