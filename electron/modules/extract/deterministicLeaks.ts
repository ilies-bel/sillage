/**
 * The second half of DEC-7, and the half a schema cannot do.
 *
 * `ExtractReplySchema` has no key for an e-mail, an attendee or an account
 * code, so a model that returns one as *data* fails to parse. That closes the
 * structured channel and leaves the prose channel wide open: nothing in a JSON
 * schema stops `"compteRendu": "Réunion avec Camille Le Roy (camille.leroy@…) le
 * 12/03/2026"`. Every one of those three facts is known exactly, from Graph;
 * every one of them is being guessed here from what a speech-to-text engine
 * thought it heard. This file is the check on that channel.
 *
 * ## Refused, not scrubbed
 *
 * A leak fails the whole reply. Stripping the offending sentence would leave a
 * compte-rendu written by a model that misunderstood its job, and there is no
 * reason to trust the paragraph after the one it invented an attendee in. The
 * cost of refusing is one re-run; the cost of a wrong name in a CRM record is
 * paid by a rep in front of a client.
 *
 * ## Citations are exempt, on purpose
 *
 * A citation is verbatim transcript, and the transcript legitimately contains
 * names — people introduce themselves. Flagging citations would fail honest
 * extractions constantly, and a citation never becomes CRM data: it is evidence
 * behind `[source ▸]`, verified by `locateQuote` against the recording's own
 * words. So the walk skips `citation` and inspects everything else.
 */

/** Anything shaped like an address. Deliberately looser than RFC 5322. */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u

/** French numbers, spaced, dotted, dashed or run together, with or without +33. */
const PHONE = /(?:\+33|0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}/

/**
 * Fully-qualified dates only.
 *
 * `12/03/2026` and `2026-03-12` are calendar data — nobody says them out loud,
 * so their presence means the model reached for a fact it does not have. A
 * spoken approximation like « démarrage mi-septembre » is the opposite: it is
 * exactly what `dateDemarrage` is free text *for* (DEC-7), and flagging it
 * would refuse the reply for doing the right thing.
 */
const NUMERIC_DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/
const TEXTUAL_DATE =
  /\b\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(?:19|20)\d{2}\b/i

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * The names and addresses this meeting's own reply must not contain.
 *
 * Built from `MeetingContext`, which is Graph's answer and therefore the truth.
 * The model was never shown any of it (`prompt.ts` explains why), so a match is
 * unambiguous: the model read a name off the transcript and decided to use it.
 */
export interface ForbiddenIdentities {
  names: readonly string[]
  emails: readonly string[]
}

/**
 * A single token is a name only when it is long.
 *
 * Two-token runs (« le roy », « marc dupont ») are specific enough to match on
 * their own. A lone token is not: `petit` and `roux` are surnames and they are
 * also ordinary French words, and refusing an honest compte-rendu for
 * containing « un petit lot » would be a worse bug than the one being
 * prevented. Six characters is where a surname stops colliding with the prose
 * of a sales summary.
 */
const MIN_LONE_NAME_TOKEN = 6

/** Every folded form of a name that is specific enough to match on. */
const nameNeedles = (name: string): string[] => {
  const tokens = fold(name).split(' ').filter(Boolean)
  const needles: string[] = []
  for (const token of tokens) {
    if (token.length >= MIN_LONE_NAME_TOKEN) needles.push(token)
  }
  for (let width = 2; width <= tokens.length; width++) {
    for (let at = 0; at + width <= tokens.length; at++) {
      needles.push(tokens.slice(at, at + width).join(' '))
    }
  }
  return needles
}

const containsWord = (haystack: string, needle: string): boolean => {
  if (needle.length === 0) return false
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? ' ' : haystack[at - 1]
    const after = haystack[at + needle.length] ?? ' '
    if (before === ' ' && after === ' ') return true
    from = at + 1
  }
}

/** Every string in the reply except the citations, with the path that found it. */
const prose = (node: unknown, path: string, into: { path: string; text: string }[]): void => {
  if (typeof node === 'string') {
    into.push({ path, text: node })
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => prose(item, `${path}.${i}`, into))
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'citation') continue
      prose(value, path === '' ? key : `${path}.${key}`, into)
    }
  }
}

/**
 * Everything in `reply` that is not the model's to know. Empty means clean.
 *
 * `identities` is optional so the check still works before an account is
 * resolved — the shape rules (address, phone, calendar date) hold for any
 * meeting, and they are the ones that catch a model inventing a contact that
 * was never in the invite.
 */
export const findDeterministicLeaks = (
  reply: unknown,
  identities?: ForbiddenIdentities,
): string[] => {
  const fields: { path: string; text: string }[] = []
  prose(reply, '', fields)

  const needles = (identities?.names ?? []).flatMap(nameNeedles)
  const emails = (identities?.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)
  const leaks: string[] = []

  for (const { path, text } of fields) {
    const folded = fold(text)
    const lowered = text.toLowerCase()

    if (EMAIL.test(text)) leaks.push(`${path}: adresse e-mail`)
    else if (emails.some((email) => lowered.includes(email))) leaks.push(`${path}: adresse e-mail`)

    if (PHONE.test(text)) leaks.push(`${path}: numéro de téléphone`)
    if (NUMERIC_DATE.test(text) || TEXTUAL_DATE.test(text)) leaks.push(`${path}: date calendaire`)

    const name = needles.find((needle) => containsWord(folded, needle))
    if (name !== undefined) leaks.push(`${path}: nom d'un participant`)
  }

  return leaks
}

/** Graph's answer, folded into the shape the check wants. */
export const forbiddenIdentitiesOf = (input: {
  organizer: { name: string; email: string }
  attendees: readonly { name: string; email: string }[]
}): ForbiddenIdentities => {
  const people = [input.organizer, ...input.attendees]
  return {
    names: people.map((p) => p.name).filter((n) => n.trim().length > 0),
    emails: people.map((p) => p.email).filter((e) => e.trim().length > 0),
  }
}
