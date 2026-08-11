/**
 * One model reply → the interpretation, with every span measured (DEC-21).
 *
 * Pure. The reply arrives carrying quotes and nothing else about provenance;
 * `locateQuote` finds each quote in the stored transcript and *that* is where
 * `channel`, `startMs` and `endMs` come from. A model that wanted to invent a
 * plausible time range had nowhere to write one.
 *
 * ## Downgraded, not dropped
 *
 * This is where the recipe parts company with the signal rail. `modules/signals`
 * throws away a chip whose quote will not verify, because the rail is glanced
 * at mid-call and has no room for a caveat. Here the field is **kept and marked
 * `faible`**: the rep is sitting at the review gate looking at a form with a
 * `[source ▸]` next to every row (DEC-4, VISION.md §6). A field that says
 * « TJM 520 € ⚠ faible » is something they can confirm in two seconds; a field
 * that silently vanished is something they will not notice is missing.
 *
 * The span is still returned when it fails to verify — with null timings, so
 * nothing downstream can pretend to locate it — because the unverifiable quote
 * is the most useful thing to show a rep asking "where did that come from?".
 */
import type {
  Confidence,
  LlmInterpretation,
  VerificationReport,
} from '../../core/contracts/extraction.ts'
import { DEFAULT_RECIPE, type RecipeId } from '../../core/contracts/recipes.ts'
import type { TranscriptSegment, TranscriptSpan } from '../../core/contracts/transcript.ts'
import { locateQuote } from '../../core/domain/spanVerification.ts'
import type { ExtractReply } from './prompt.ts'

interface Grounded<T> {
  field: { value: T; span: TranscriptSpan }
  confidence: Confidence
}

const ground = <T>(
  cited: { valeur: T; citation: string },
  segments: readonly TranscriptSegment[],
): Grounded<T> => {
  const located = locateQuote(cited.citation, segments)
  if (located === null) {
    return {
      field: {
        value: cited.valeur,
        span: { quote: cited.citation, channel: null, startMs: null, endMs: null },
      },
      confidence: 'faible',
    }
  }
  return {
    field: {
      value: cited.valeur,
      span: {
        quote: cited.citation,
        channel: located.channel,
        startMs: located.startMs,
        endMs: located.endMs,
      },
    },
    confidence: 'ok',
  }
}

export interface GroundedExtraction {
  interpretation: LlmInterpretation
  verification: VerificationReport
}

/**
 * Builds the interpretation and its verification report in one pass.
 *
 * They are produced together rather than by a `verify(extraction)` pass because
 * a second pass would have to re-locate every quote to answer a question the
 * first pass already answered — and, worse, could disagree with it.
 */
export const groundReply = (
  reply: ExtractReply,
  segments: readonly TranscriptSegment[],
  recipe: RecipeId = DEFAULT_RECIPE,
): GroundedExtraction => {
  const fields: Record<string, Confidence> = {}

  const one = <T>(path: string, cited: { valeur: T; citation: string }) => {
    const grounded = ground(cited, segments)
    fields[path] = grounded.confidence
    return grounded.field
  }

  const maybe = <T>(path: string, cited: { valeur: T; citation: string } | null) =>
    cited === null ? null : one(path, cited)

  const many = <T>(path: string, cites: readonly { valeur: T; citation: string }[]) =>
    cites.map((cited, i) => one(`${path}.${i}`, cited))

  const interpretation: LlmInterpretation = {
    // Stamped from the run, never read off the reply — there is no key for it in
    // `ExtractReplySchema` and there must not be. Which recipe produced a
    // document is a fact about the app, and a model asked for it would answer.
    recipe,
    compteRendu: reply.compteRendu,
    besoin: one('besoin', reply.besoin),
    profilsRecherches: many('profilsRecherches', reply.profilsRecherches),
    modeCollaboration: one('modeCollaboration', reply.modeCollaboration),
    tjmEvoque: maybe('tjmEvoque', reply.tjmEvoque),
    dateDemarrage: maybe('dateDemarrage', reply.dateDemarrage),
    dureeMission: maybe('dureeMission', reply.dureeMission),
    contexteTechnique: one('contexteTechnique', reply.contexteTechnique),
    objections: many('objections', reply.objections),
    prochainesEtapes: many('prochainesEtapes', reply.prochainesEtapes),
  }

  const overall: Confidence = Object.values(fields).some((c) => c === 'faible') ? 'faible' : 'ok'
  return { interpretation, verification: { fields, overall } }
}
