/**
 * `MeetingContext` → the boost list handed to one STT provider (DEC-17).
 *
 * Pure: no provider, no network, no Electron. What it decides is *which terms*
 * and *in what order*; whether the provider can use them at all is
 * capability-detected upstream from the registry descriptor, and a provider
 * whose capability is `none` gets an empty list rather than a list it would
 * silently drop.
 *
 * ## Order is the whole design
 *
 * Every boost channel is bounded — Whisper's prompt window is 224 tokens,
 * Deepgram caps keyterms, Azure caps a phrase list — and every one of them
 * truncates the *end*. So the order here is a ranking by value, and it is:
 *
 *   attendee surnames → company → projects → static ESN → static tech-en
 *
 * Surnames first because they are the terms that cannot be recovered by any
 * other means. A mangled "SharePoint" is repaired by an LLM that has seen ten
 * thousand SharePoints; a mangled "Chalendard" is repaired by nothing, and it
 * is the word the compte-rendu has to get right to be sendable. The calendar
 * hands them over for free.
 *
 * ## Why the budget is not the provider's cap
 *
 * A prompt that fills the window is not a better prompt. Whisper conditions on
 * it as *preceding text*, so a long glossary is a long stretch of comma-listed
 * nouns that the decoder treats as the immediate context of the utterance — and
 * the documented failure is regurgitation: terms from the prompt appearing in
 * the transcript during silence. The cap below is well under 224 tokens for
 * that reason. Fewer, better terms.
 */
import type { LexiconTerm, StoredLexiconTerm, TermCategory } from '../../contracts/lexicon.ts'
import type { BoostCapability, BoostSet } from '../../contracts/lexicon.ts'
import type { MeetingContext } from '../../contracts/meeting.ts'
import { STATIC_TERMS } from './terms.fr-esn.ts'

/**
 * Terms, not tokens — and far below the 223-token window, because the window is
 * not the binding constraint. **A long prompt makes Whisper stop early.**
 *
 * Measured on four 25 s clips of real calls, same audio, budget swept:
 *
 *   terms   prompt tokens   words transcribed   target nouns fixed
 *       0               0                 128                    0
 *       5              18                  81                    2
 *      10              35                  83                    2
 *      20              74                  83                    2
 *      40             130                  66                    0
 *
 * Past roughly twenty terms the boost stops working *and* the transcript
 * collapses — 25 s of speech came back as "et des services de la production."
 * A prompt is prepended as `<|startofprev|>` context, so a long one is a long
 * stretch of comma-listed nouns immediately before the audio, and the decoder
 * answers it with an early end-of-transcript. Confirmed on the real path too:
 * the same call gave 269 words at 8 terms and 182 at 41.
 *
 * Twelve sits inside the flat part of that curve, and a meeting rarely needs
 * more: one client, a handful of attendees, a project or two.
 *
 * This is a Whisper-prompt number, not a universal one. A provider whose boost
 * channel is a real keyword list (Deepgram keyterms, Azure phrase lists, a
 * transducer context graph) has no such cliff and should raise it via
 * `maxTerms`.
 */
const DEFAULT_MAX_TERMS = 12

/**
 * Words that are half a surname to a human and a stopword to a decoder.
 *
 * They are never a term on their own — boosting "de" or "van" biases every
 * French sentence toward a preposition, a measurable loss for no gain. They are
 * kept when they lead into the surname they belong to, because « Le Roy » is
 * the string the decoder has to produce and « Roy » does not get it there.
 */
const PARTICLES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'van',
  'von',
  'den',
  'der',
  'el',
  'al',
  'da',
  'di',
  'dos',
])

/**
 * The surname out of a Graph display name.
 *
 * Graph gives `"Ahmed ZAIOU"`, `"ZAIOU, Ahmed"` and `"ahmed.zaiou@…"` depending
 * on how the tenant is configured, and the surname is in a different position
 * in each. First names are deliberately dropped: Whisper already gets Léo,
 * Sarah and Gabriel right, and every term spent on one is a term not spent on
 * the name it gets wrong.
 */
export const surnameOf = (displayName: string): string | null => {
  const name = displayName.trim()
  if (!name) return null

  // "ZAIOU, Ahmed" — the comma is unambiguous, so trust it over word order.
  const comma = name.indexOf(',')
  const candidate = comma > 0 ? name.slice(0, comma) : name

  const words = candidate
    .split(/\s+/)
    .map((w) => w.replace(/[(),.]/g, '').trim())
    .filter((w) => w.length > 0)

  if (words.length === 0) return null

  /*
   * Particles belong **to** the surname, not to the noise around it.
   *
   * They used to be filtered out, which turned « Camille Le Roy » into `Roy`.
   * That is close enough to look right and useless in practice: the term exists
   * to make Whisper produce the surname as written, and boosting `Roy` does
   * nothing for `Le Roy`. French client contact lists are full of them — Le,
   * La, De, Du, Van, Da — so for this product it is the common case, not an
   * edge one.
   *
   * With a comma the surname is everything before it, particle included. Without
   * one, western order puts the surname last, so walk left while the previous
   * word is a particle.
   */
  if (comma > 0) {
    const joined = words.join(' ')
    return joined.length > 2 ? joined : null
  }

  let start = words.length - 1
  while (start > 0 && PARTICLES.has(words[start - 1]!.toLowerCase())) start -= 1

  // A name that is *only* particles is not a name.
  if (PARTICLES.has(words[start]!.toLowerCase()) && start === words.length - 1) return null

  const surname = words.slice(start).join(' ')
  return surname.length > 2 ? surname : null
}

/**
 * Capitalised multi-word runs and ALL-CAPS acronyms out of the agenda — how a
 * project name is written in a calendar invite.
 *
 * Deliberately conservative. A false positive costs a slot in a bounded budget
 * and biases the decoder toward a word nobody said, so the bar is "looks like a
 * proper noun and is not the first word of a sentence".
 */
export const projectNamesFrom = (agenda: string): string[] => {
  const found = new Set<string>()
  for (const match of agenda.matchAll(/\b[A-Z][A-Za-z0-9]{2,}(?:[ -][A-Z][A-Za-z0-9]{2,})*\b/g)) {
    // A capital at the start or after a full stop is a sentence opening rather
    // than a name — but only its *first word* is. "Migration DIMOS" matches as
    // one run, and discarding the run would throw away the one word in it worth
    // boosting, so the opening word is dropped and the rest is kept.
    const before = agenda.slice(Math.max(0, match.index - 2), match.index)
    const opensSentence = match.index === 0 || /[.!?]\s$/.test(before)

    const words = match[0].split(' ')
    const kept = opensSentence ? words.slice(1) : words
    if (kept.length === 0) continue
    found.add(kept.join(' '))
  }
  return [...found]
}

export interface BoostOptions {
  capability: BoostCapability
  /** Overrides the default term budget. The provider's hard cap still applies. */
  maxTerms?: number
  /**
   * Persisted terms, from `store.lexicon.forClient()`. Already ordered by the
   * store: client scope ahead of account scope, most-heard first inside each.
   */
  stored?: readonly StoredLexiconTerm[]
  /**
   * Pad the prompt with the shipped ESN vocabulary. **Off by default, and the
   * default is the measured one.**
   *
   * Generic vocabulary in a Whisper prompt is not free filler. On a real call
   * it did two things, both bad: it diluted the terms that mattered — the same
   * audio that gave "mon SharePoint pré-production" with five call-specific
   * terms gave "mon cher point de préprôte" once eleven generic ones were added
   * — and it *inserted itself*, opening a segment with "CDI," where nobody had
   * said it. A fabricated contract type in a transcript that feeds a CRM is a
   * worse failure than the mis-transcription it was meant to prevent.
   *
   * The shipped list earns its keep after the fact instead, in `correct.ts`,
   * where a term costs nothing until it actually matches.
   */
  includeStatic?: boolean
}

/**
 * Deduplicates case-insensitively but keeps the first spelling seen, which is
 * the highest-ranked one — so `SharePoint` from the agenda wins over
 * `sharepoint` from a static list.
 */
const dedupe = (terms: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const term of terms) {
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

/**
 * The per-meeting terms, ranked, with no static vocabulary. Exported because
 * the ordering is the part worth testing on its own.
 */
export const meetingTerms = (context: MeetingContext | null): string[] => {
  if (!context) return []

  const people = [context.organizer, ...context.attendees]
    .map((a) => surnameOf(a.name))
    .filter((s): s is string => s !== null)

  // The subject is where the client company is written, in practice.
  const fromSubject = projectNamesFrom(context.subject)
  const fromAgenda = projectNamesFrom(context.agenda)

  return dedupe([...people, ...fromSubject, ...fromAgenda])
}

/**
 * The full boost set for one meeting and one provider.
 *
 * `capability: 'none'` returns no terms at all — DEC-17 is explicit that a
 * provider which cannot boost must not be handed terms it will ignore, because
 * a list that is silently dropped looks exactly like a list that did not work.
 */
export const buildBoostSet = (context: MeetingContext | null, options: BoostOptions): BoostSet => {
  if (options.capability === 'none') return { capability: 'none', terms: [] }

  const max = options.maxTerms ?? DEFAULT_MAX_TERMS
  const terms = dedupe([
    // meeting → client → account, narrowest first, because the budget truncates
    // from the end. The store has already ordered the last two.
    ...meetingTerms(context),
    ...(options.stored ?? []).map((t) => t.term),
    ...(options.includeStatic ? STATIC_TERMS.map((t: LexiconTerm) => t.term) : []),
  ]).slice(0, max)

  return { capability: options.capability, terms }
}

/**
 * What this meeting taught the app about this client, ready to persist.
 *
 * This is the compounding half of the lexicon and the reason scopes exist. The
 * terms are the same ones `meetingTerms` derives — surnames, the company,
 * project names — but writing them under the client's scope means the *second*
 * meeting with that client starts with them already boosted, before anyone has
 * opened the calendar. Nothing is hand-curated and nothing is asked of the rep.
 *
 * Returns rows rather than writing them: `core/domain/` does no I/O, and a pure
 * function is what lets "what would this meeting add?" be a test rather than a
 * database assertion.
 */
export const termsLearnedFrom = (
  context: MeetingContext | null,
  clientName: string | null,
): Array<{ term: string; category: TermCategory; scope: 'client'; scopeKey: string }> => {
  const key = clientName?.trim()
  // Without a client there is no scope to learn into. Writing these to the
  // account scope instead would boost one client's surnames in every other
  // client's meetings, which is worse than not learning at all.
  if (!context || !key) return []

  const people = [context.organizer, ...context.attendees]
    .map((a) => surnameOf(a.name))
    .filter((s): s is string => s !== null)
  const projects = dedupe([...projectNamesFrom(context.subject), ...projectNamesFrom(context.agenda)])

  return [
    ...dedupe(people).map((term) => ({ term, category: 'person' as const, scope: 'client' as const, scopeKey: key })),
    ...projects.map((term) => ({ term, category: 'project' as const, scope: 'client' as const, scopeKey: key })),
  ]
}
