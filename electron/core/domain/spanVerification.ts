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
import type { Channel, TranscriptSegment, TranscriptSpan } from '../contracts/transcript.ts'

/**
 * Shorter than this, a match is a coincidence rather than evidence: `à`, `oui`
 * and `520` occur in almost any French call, so they prove nothing about the
 * claim built on top of them. Counted after normalisation, so `TJM 520 €` (→
 * `tjm 520`, 7 chars) still qualifies and a bare `€` does not.
 */
export const MIN_QUOTE_CHARS = 4

/**
 * Fold away everything two renderings of the same sentence can disagree about.
 *
 * Case, punctuation, currency signs, typographic apostrophes and accents. The
 * accents are the debatable one and they are folded on purpose: French STT
 * routinely emits `demarrage` where the model writes `démarrage`, and refusing
 * that match would drop true chips. It cannot create a false one — folding only
 * merges characters, so an invented sentence stays absent.
 */
export const normalizeForVerification = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Where a quote was said. Read off the transcript, never off the reply. */
export interface LocatedSpan {
  channel: Channel
  startMs: number
  endMs: number
}

interface ChannelIndex {
  haystack: string
  /** Normalised offsets back to the segment they came from. */
  parts: { start: number; end: number; segment: TranscriptSegment }[]
}

/**
 * One channel's final segments as a single normalised string.
 *
 * Joining is what lets a quote that straddles two segments verify — providers
 * cut on silence, not on sentences, and a model quoting a sentence has no idea
 * where the cut fell. It is also the one place this check is deliberately
 * generous: two utterances a minute apart are adjacent in the haystack, so a
 * quote could in principle bridge them. The alternative — refusing every
 * cross-segment quote — drops far more true citations than it stops false ones.
 */
const indexChannel = (segments: readonly TranscriptSegment[]): ChannelIndex => {
  const chunks: string[] = []
  const parts: ChannelIndex['parts'] = []
  let cursor = 0

  for (const segment of segments) {
    const normalized = normalizeForVerification(segment.text)
    if (normalized.length === 0) continue
    if (cursor > 0) cursor += 1 // the space `join` will insert
    parts.push({ start: cursor, end: cursor + normalized.length, segment })
    chunks.push(normalized)
    cursor += normalized.length
  }

  return { haystack: chunks.join(' '), parts }
}

const byStart = (a: TranscriptSegment, b: TranscriptSegment): number => a.startMs - b.startMs

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
  const needle = normalizeForVerification(quote)
  if (needle.length < MIN_QUOTE_CHARS) return null

  const channels: Channel[] = channel === null ? ['rep', 'far'] : [channel]

  for (const candidate of channels) {
    const index = indexChannel(
      segments.filter((s) => s.isFinal && s.channel === candidate).sort(byStart),
    )
    const at = index.haystack.indexOf(needle)
    if (at === -1) continue

    const end = at + needle.length
    const touched = index.parts.filter((p) => p.start < end && p.end > at)
    if (touched.length === 0) continue

    return {
      channel: candidate,
      startMs: Math.min(...touched.map((p) => p.segment.startMs)),
      endMs: Math.max(...touched.map((p) => p.segment.endMs)),
    }
  }

  return null
}

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
