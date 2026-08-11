/**
 * The post-STT half of the lexicon (DEC-17): repairing known mis-transcriptions
 * after the fact, instead of leaning on the decoder to avoid them.
 *
 * This exists because boosting turned out to be the weaker of the two levers,
 * and the measurement is worth keeping next to the code. A Whisper prompt is
 * prepended as `<|startofprev|>` context, so it biases the *whole* decode: past
 * roughly twenty terms the transcript collapses (25 s of speech came back as
 * "et des services de la production."), and generic vocabulary in the prompt
 * inserts itself into speech where nobody said it — an observed run opened a
 * segment with "CDI,". For a notetaker feeding a CRM, an invented contract type
 * is worse than the mis-transcription it replaced.
 *
 * Correction has none of those failure modes. It runs on text, changes nothing
 * about how the audio was read, and a term that never matches costs nothing.
 * So the shipped ESN vocabulary lives here, and the boost prompt is reserved
 * for the handful of names this meeting cannot be understood without.
 *
 * **Only what is written down.** This replaces exact known variants, never
 * anything it guesses at. Fuzzy or phonetic matching would repair unseen
 * mistakes and invent new ones — and a wrong repair is invisible, because the
 * output is a plausible French word either way. Every variant here was observed
 * in a real transcript.
 */
import type { LexiconTerm } from '../../contracts/lexicon.ts'
import { STATIC_TERMS } from './terms.fr-esn.ts'

/** One rule: a spelling that was heard, and what it should have been. */
interface Rule {
  pattern: RegExp
  term: string
}

/**
 * Longest variant first, so `inter contrat` is repaired as one phrase before
 * `contrat` alone could match part of it.
 */
const compile = (terms: readonly LexiconTerm[]): Rule[] =>
  terms
    .flatMap((entry) => entry.variants.map((variant) => ({ variant, term: entry.term })))
    .sort((a, b) => b.variant.length - a.variant.length)
    .map(({ variant, term }) => ({
      // Word boundaries on both sides: without them "AO" rewrites the middle of
      // "chaos" and "run" rewrites "runtime". `\b` is not enough on its own for
      // accented French, so the guards are explicit about what may sit either
      // side of a match.
      pattern: new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(variant)})(?=$|[^\\p{L}\\p{N}])`, 'giu'),
      term,
    }))

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

let cached: Rule[] | null = null

const staticRules = (): Rule[] => {
  cached ??= compile(STATIC_TERMS)
  return cached
}

export interface CorrectionResult {
  text: string
  /** Canonical terms that were restored. The enrichment signal for `hits`. */
  applied: string[]
}

/**
 * Rewrites known mis-transcriptions in one segment.
 *
 * `extra` carries per-meeting terms — a client's own vocabulary, with the
 * variants earlier meetings observed — and is applied *before* the shipped
 * list so a client-specific spelling wins over a generic one.
 */
export const correct = (text: string, extra: readonly LexiconTerm[] = []): CorrectionResult => {
  if (!text) return { text, applied: [] }

  const applied = new Set<string>()
  let out = text
  for (const rule of [...compile(extra), ...staticRules()]) {
    out = out.replace(rule.pattern, (_match, before: string) => {
      applied.add(rule.term)
      return `${before}${rule.term}`
    })
  }
  return { text: out, applied: [...applied] }
}
