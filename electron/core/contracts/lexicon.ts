/**
 * The STT lexicon (DEC-17).
 *
 * Two layers: boost at the provider where it is supported, correct after the
 * fact where it is not. Which layer applies is decided from
 * `BoostCapability` — **capability-detected, never assumed**. A provider that
 * silently ignores an unsupported hint is how "TJM" becomes "tédjéem" in a
 * demo.
 */
import { z } from 'zod'

export const TermCategorySchema = z.enum([
  /** Static ESN vocabulary: TJM, régie, forfait, intercontrat, AO, portage… */
  'esn',
  /** English technical terms kept verbatim, never translated (DEC-22). */
  'tech-en',
  /** Per-meeting, from the calendar: attendee surnames — the highest-value terms. */
  'person',
  /** Per-meeting: the client company name. */
  'company',
  /** Per-meeting: project names read out of the agenda. */
  'project',
])
export type TermCategory = z.infer<typeof TermCategorySchema>

export const LexiconTermSchema = z.object({
  term: z.string().min(1),
  category: TermCategorySchema,
  /**
   * Known mis-transcriptions, used by the deterministic post-STT pass for
   * providers with no boosting: `régis` → `régie`, `inter contrat` →
   * `intercontrat`.
   */
  variants: z.array(z.string()),
})
export type LexiconTerm = z.infer<typeof LexiconTermSchema>

/**
 * Where a term came from, which is also how much it is worth.
 *
 * The ranking that falls out of this is the whole point of having scopes: a
 * bounded boost channel truncates, so the narrower the scope the earlier the
 * term goes. A name this client's people actually use beats a word every ESN
 * uses, which beats a word every French speaker uses.
 */
export const LexiconScopeSchema = z.enum([
  /** Ships with the app, in code. Reviewed once, identical for every install. */
  'global',
  /** This ESN's own vocabulary: their offers, their internal names. Curated. */
  'account',
  /** One client: their people, their projects, their systems. Learned. */
  'client',
  /** This meeting only, from the calendar. Never persisted — it is derivable. */
  'meeting',
])
export type LexiconScope = z.infer<typeof LexiconScopeSchema>

/**
 * A term as it is stored. `global` and `meeting` never appear here: the first
 * lives in code and the second is recomputed from `MeetingContext` every time,
 * and persisting a derivable value is how it goes stale.
 */
export const StoredLexiconTermSchema = LexiconTermSchema.extend({
  scope: z.enum(['account', 'client']),
  /** '' for `account`. The client name for `client`. */
  scopeKey: z.string(),
  /** How often this term has been seen since. Enrichment signal, not a score. */
  hits: z.number().int().nonnegative(),
  createdAt: z.number().int(),
})
export type StoredLexiconTerm = z.infer<typeof StoredLexiconTermSchema>

export const BoostCapabilitySchema = z.enum([
  /** Azure Speech phrase lists. */
  'phraseList',
  /** Deepgram keyterms. */
  'keyterms',
  /** Whisper `initial_prompt`. */
  'initialPrompt',
  /** No provider-side boosting — the post-STT correction pass carries the load. */
  'none',
])
export type BoostCapability = z.infer<typeof BoostCapabilitySchema>

/** What `transcribe/` hands a provider for one meeting. */
export const BoostSetSchema = z.object({
  capability: BoostCapabilitySchema,
  terms: z.array(z.string()),
})
export type BoostSet = z.infer<typeof BoostSetSchema>
