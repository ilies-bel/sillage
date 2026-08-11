/**
 * Cutting a whole meeting into pieces a model can read, and why the pieces look
 * like this.
 *
 * A two-hour French call is ~18 000 spoken words. That does not fit one prompt
 * at any price worth paying, and even where it fits it is the length at which
 * models start losing the middle. So the recipe is **map then reduce**, and the
 * strategy is chosen by one constraint rather than by cost:
 *
 *   DEC-21 says every interpretive field cites a *verbatim* transcript quote,
 *   and `core/domain/spanVerification.ts` checks that quote against the stored
 *   transcript. **Summarise-then-extract cannot satisfy that.** A summary is
 *   paraphrase by definition, so a field extracted from a summary cites words
 *   nobody said, `locateQuote` fails, and every field on the review screen
 *   arrives wearing `⚠ faible`. The measurement would be correct and the
 *   product would be useless.
 *
 * The map stage therefore does *not* summarise. It returns short French notes,
 * each carrying a citation copied character-for-character out of its chunk, and
 * the reduce stage is forbidden from rewriting those citations. The quotes that
 * reach `locateQuote` are still the transcript's own words, however many hops
 * they took to get there.
 *
 * Everything here is pure — no model, no clock, no store — so the cut points
 * are testable and, more to the point, *stable*: the same meeting cut twice
 * produces the same chunks, which is what makes a failed extraction worth
 * retrying.
 */
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'

/**
 * Four characters to a token is the standard rough count and it is deliberately
 * rough. It is used to decide where to cut, not to fill a context window to the
 * brim — the budgets below leave enough headroom that being 20% wrong about
 * French tokenisation changes nothing.
 */
export const CHARS_PER_TOKEN = 4

/**
 * Below this, the whole meeting goes to the model in one call and the map stage
 * is skipped entirely.
 *
 * ~6 000 tokens is roughly a 45-minute call, which is most of them. One pass
 * beats two: the reduce stage's whole difficulty is reconciling facts it can no
 * longer see the context of, and a short meeting should not pay for that.
 */
export const SINGLE_PASS_TOKENS = 6_000

/** One map call's share. Comfortable for every provider in the registry. */
export const CHUNK_TARGET_TOKENS = 3_000

/**
 * The tail of one chunk repeated at the head of the next.
 *
 * A rate is quoted in one sentence and qualified in the next — "520" … "mais
 * c'est hors astreinte" — and a cut between them turns one fact into two
 * half-facts. The overlap is small because the reduce stage dedupes anyway; its
 * job is to keep a sentence pair intact, not to make chunks redundant.
 */
export const CHUNK_OVERLAP_TOKENS = 200

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

/**
 * Only final segments are citable (DEC-21) — an interim segment can be revised
 * away by the provider, and a compte-rendu must not quote a sentence the
 * transcript no longer contains.
 */
export const isCitable = (segment: TranscriptSegment): boolean =>
  segment.isFinal && segment.text.trim().length > 0

/**
 * One line, as the model sees it. Identical in shape to the signal rail's
 * rendering and identical in what it withholds: the tags are the *roles* the
 * hardware gives us for free — mic is the rep, loopback is everyone else — and
 * no name and no timestamp appears. Who spoke and when are not the model's to
 * guess (DEC-7), and a timestamp in the input is an invitation to cite one
 * (DEC-21).
 */
export const renderSegment = (segment: TranscriptSegment): string =>
  `${segment.channel === 'rep' ? 'commercial' : 'client'}: ${segment.text.trim()}`

export const renderSegments = (segments: readonly TranscriptSegment[]): string =>
  segments.map(renderSegment).join('\n')

/**
 * Chronological, with a total order rather than a merely-sorted one. Two
 * channels routinely produce identical `startMs`, and `Array.prototype.sort`
 * being stable is not enough when the caller's input order is not: the store
 * replays by insertion, a live session appends by arrival. Tie-breaking on
 * `endMs` then `id` makes the cut points a function of the transcript alone.
 */
const chronological = (a: TranscriptSegment, b: TranscriptSegment): number =>
  a.startMs - b.startMs || a.endMs - b.endMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export interface TranscriptChunk {
  index: number
  segments: TranscriptSegment[]
  /** What goes in the prompt. Precomputed so a caller cannot render it twice. */
  text: string
  tokens: number
}

const buildChunk = (index: number, segments: TranscriptSegment[]): TranscriptChunk => {
  const text = renderSegments(segments)
  return { index, segments, text, tokens: estimateTokens(text) }
}

/**
 * The trailing segments worth repeating, never more than half the chunk.
 *
 * The cap is what guarantees progress. Without it a chunk made of one enormous
 * segment would hand its whole self to the next chunk and the loop would never
 * advance — the kind of bug that only shows up on the one call that matters.
 */
const overlapTail = (segments: readonly TranscriptSegment[], budget: number): TranscriptSegment[] => {
  if (budget <= 0) return []
  const maxSegments = Math.floor(segments.length / 2)
  if (maxSegments === 0) return []

  const tail: TranscriptSegment[] = []
  let tokens = 0
  for (let i = segments.length - 1; i >= 0 && tail.length < maxSegments; i--) {
    const segment = segments[i]
    if (segment === undefined) break
    const cost = estimateTokens(renderSegment(segment))
    if (tokens + cost > budget) break
    tail.unshift(segment)
    tokens += cost
  }
  return tail
}

export interface ChunkOptions {
  singlePassTokens?: number
  targetTokens?: number
  overlapTokens?: number
}

/**
 * The whole meeting → the chunks the map stage runs on. One chunk means the map
 * stage is skipped and the reduce prompt reads the transcript directly.
 */
export const chunkTranscript = (
  segments: readonly TranscriptSegment[],
  options: ChunkOptions = {},
): TranscriptChunk[] => {
  const singlePass = Math.max(500, options.singlePassTokens ?? SINGLE_PASS_TOKENS)
  const target = Math.max(500, options.targetTokens ?? CHUNK_TARGET_TOKENS)
  const overlap = Math.max(0, Math.min(options.overlapTokens ?? CHUNK_OVERLAP_TOKENS, target - 1))

  const ordered = segments.filter(isCitable).slice().sort(chronological)
  if (ordered.length === 0) return []

  if (estimateTokens(renderSegments(ordered)) <= singlePass) return [buildChunk(0, ordered)]

  const chunks: TranscriptChunk[] = []
  let current: TranscriptSegment[] = []
  let tokens = 0

  for (const segment of ordered) {
    const cost = estimateTokens(renderSegment(segment))
    if (current.length > 0 && tokens + cost > target) {
      chunks.push(buildChunk(chunks.length, current))
      current = overlapTail(current, overlap)
      tokens = current.reduce((total, s) => total + estimateTokens(renderSegment(s)), 0)
    }
    current.push(segment)
    tokens += cost
  }

  if (current.length > 0) chunks.push(buildChunk(chunks.length, current))
  return chunks
}
