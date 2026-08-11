/**
 * Whisper's inventions, filtered out before they can become a transcript span.
 *
 * On near-silent or noise-only audio Whisper does not return nothing — it
 * returns the most common thing in its training data for that acoustic
 * signature, which is subtitle boilerplate. A meeting has a great deal of
 * near-silence in it, so this fires often.
 *
 * **The list the previous product shipped was English-only**, which for this
 * one is the wrong half: a `fr-FR`-locked pipeline (DEC-22) produces the French
 * credit lines instead — "Sous-titres réalisés par la communauté d'Amara.org"
 * and its relatives. Left unfiltered they are worse than noise, because they
 * are fluent, they survive into the compte-rendu, and DEC-21 would happily
 * verify their span: the words really are in the transcript.
 *
 * Two rules, and the difference matters. Whole-segment matches must be exact —
 * "merci" alone is boilerplate, "merci, on vous envoie la proposition" is the
 * most important sentence in the call. Credit lines are matched by substring
 * because they arrive with arbitrary suffixes.
 */

/** Matched against the entire trimmed segment, lower-cased. Never a substring. */
const WHOLE_SEGMENT = new Set([
  // French
  'merci',
  'merci.',
  'merci !',
  'merci à tous',
  "merci d'avoir regardé",
  'au revoir',
  'abonnez-vous',
  "abonnez-vous !",
  'à bientôt',
  'musique',
  'générique',
  'applaudissements',
  // English — the models still emit these on French audio
  '[music]',
  '[applause]',
  '[inaudible]',
  '(music)',
  'thank you for watching',
  'thanks for watching',
  'you',
  'bye',
  '...',
  '.',
])

/**
 * Matched anywhere in the segment. Every entry is a subtitling credit — a
 * phrase that cannot occur in a French ESN sales conversation and does occur,
 * verbatim, in Whisper's training subtitles.
 */
const CREDIT_LINES = [
  'amara.org',
  'soustitreur.com',
  'sous-titres réalisés',
  'sous-titrage société',
  'sous-titrage st',
  'subtitles by',
  'subtitled by',
  'transcription outsourced',
]

/** Anything that is nothing but a bracketed tag: `[Noise]`, `[BLANK_AUDIO]`. */
const BRACKET_TOKEN = /^\[.*\]$/

/** Returns the text to keep, or `''` when the segment was an invention. */
export function filterHallucination(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length < 2) return ''

  const lower = trimmed.toLowerCase()
  if (WHOLE_SEGMENT.has(lower)) return ''
  if (BRACKET_TOKEN.test(trimmed)) return ''
  if (CREDIT_LINES.some((line) => lower.includes(line))) return ''

  return trimmed
}
