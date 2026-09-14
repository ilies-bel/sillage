/**
 * Does the cited quote really occur in the stored transcript? (DEC-21)
 *
 * Confidence is measured, not self-reported. A model asked "how sure are you"
 * answers with a number it also invented, so the only thing worth checking is
 * whether the words it quoted were actually said. This file is that check, and
 * it is pure: no model, no store, no Electron.
 *
 * Two callers, one rule, two different remedies:
 *
 *   `modules/signals/`  a chip whose quote cannot be found is **dropped**. The
 *                       rail is glanced at during a live call; there is no room
 *                       to render a caveat (DEC-14).
 *   `modules/extract/`  a field whose quote cannot be found is kept and marked
 *                       `⚠ faible`, because the rep is sitting at the review
 *                       gate and can judge it (DEC-21).
 *
 * ## Why locating beats verifying
 *
 * `locateQuote` returns *where* the words were said, not just whether they
 * were. That lets the caller build the `TranscriptSpan` from the transcript
 * rather than from the reply — the model supplies the quote and nothing else,
 * and `channel`/`startMs`/`endMs` become measured facts. A model that invents a
 * plausible time range is exactly the failure this defends against, and the way
 * to defend against it is to never ask for one.
 */
import type { Confidence } from '../contracts/extraction.ts'
import {
  MIN_QUOTE_CHARS,
  locateSegments,
  normalizeForVerification,
  type Channel,
  type TranscriptSegment,
  type TranscriptSpan,
} from '../contracts/transcript.ts'

/** Where a quote was said. Read off the transcript, never off the reply. */
export interface LocatedSpan {
  channel: Channel
  startMs: number
  endMs: number
}


/**
 * Finds `quote` in the transcript and reports where it was said.
 *
 * Only final segments are searched: an interim segment can be revised away by
 * the provider, and a citation must point at something it has committed to.
 * `channel` narrows the search when the caller already knows who spoke; passing
 * `null` searches the rep first, then the far end.
 */
export const locateQuote = (
  quote: string,
  segments: readonly TranscriptSegment[],
  channel: Channel | null = null,
): LocatedSpan | null => {
  /*
   * **One search, in `contracts`, because two searches is a contradiction the
   * rep reads.** `TranscriptReader` wrote its own — `text.includes(quote)`, raw,
   * inside one segment — under a comment claiming it was this one, and it
   * answered « introuvable » for an accent the STT dropped, a typographic
   * apostrophe, a trailing full stop, and every quote spanning two turns, on
   * rows this function had just certified. `src/*` may import `contracts` and
   * nothing else, which is why the implementation moved rather than the caller.
   */
  const touched = locateSegments(quote, segments, channel)
  if (touched.length === 0) return null
  return {
    channel: touched[0]!.channel,
    startMs: Math.min(...touched.map((s) => s.startMs)),
    endMs: Math.max(...touched.map((s) => s.endMs)),
  }
}

export { MIN_QUOTE_CHARS, normalizeForVerification, locateSegments }

/** The predicate form. `span.channel` narrows the search when it is set. */
export const spanOccursIn = (
  span: TranscriptSpan,
  segments: readonly TranscriptSegment[],
): boolean => locateQuote(span.quote, segments, span.channel) !== null

/** The review gate's verdict for one cited field (DEC-21). */
export const confidenceOf = (
  span: TranscriptSpan,
  segments: readonly TranscriptSegment[],
): Confidence => (spanOccursIn(span, segments) ? 'ok' : 'faible')
