/**
 * When is a rolling window of transcript worth one model call?
 *
 * Pure, so the cadence can be tested without a model and without a clock. The
 * decision is deliberately not "on every segment": a segment is a pause in
 * someone's speech, roughly a sentence, and one call per sentence would be
 * ~40 calls a minute, would cost more than the extraction that actually matters
 * (DEC-13), and would produce a rail that flickers rather than one the rep can
 * glance at (DEC-14).
 *
 * VISION.md §5 fixes the target: a cheap model on chunk boundaries, roughly one
 * call per minute.
 */
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'

/**
 * The cadence. ~1 call/minute is the budget VISION.md §5 sets for the rail.
 *
 * A window is measured from the first pending segment's `startMs` to the last
 * one's `endMs`, i.e. in transcript time rather than wall clock — a call that
 * is paused, or a replay running at ten times speed, must produce the same
 * chips as the live one.
 */
export const CHUNK_WINDOW_MS = 60_000

/**
 * The floor. French business speech runs ~150 wpm, so a minute that produced
 * fewer than this was mostly silence, screen-sharing or "vous m'entendez ?" —
 * there is no fact in it to extract, and firing anyway spends a call to learn
 * that.
 */
export const CHUNK_MIN_WORDS = 25

/**
 * The ceiling, and the reason it is not just the window: when both parties talk
 * at once, two channels of 150 wpm fill a minute with ~300 words. Firing early
 * at 220 keeps each prompt small — which is what keeps the call cheap and, more
 * importantly, fast. The rail is a side surface; a slow answer is a wrong one.
 */
export const CHUNK_MAX_WORDS = 220

/** Only final segments are citable (DEC-21), so only they count towards a chunk. */
export const isCitable = (segment: TranscriptSegment): boolean =>
  segment.isFinal && segment.text.trim().length > 0

export const countWords = (segments: readonly TranscriptSegment[]): number =>
  segments.reduce((total, s) => total + s.text.trim().split(/\s+/).filter(Boolean).length, 0)

/** Transcript time covered, first `startMs` to last `endMs`. Zero when empty. */
export const spanMs = (segments: readonly TranscriptSegment[]): number => {
  if (segments.length === 0) return 0
  const starts = segments.map((s) => s.startMs)
  const ends = segments.map((s) => s.endMs)
  return Math.max(...ends) - Math.min(...starts)
}

/**
 * Fire when the window is full **or** the prompt is getting long — never below
 * the word floor.
 *
 * The `or` is what makes a busy call and a quiet call cost about the same: a
 * quiet minute waits for words it will not get and skips its turn, a loud one
 * fires at 220 words without waiting out the minute.
 */
export const shouldFlush = (pending: readonly TranscriptSegment[]): boolean => {
  const words = countWords(pending)
  if (words < CHUNK_MIN_WORDS) return false
  return spanMs(pending) >= CHUNK_WINDOW_MS || words >= CHUNK_MAX_WORDS
}

/**
 * The chunk as the model sees it: one line per utterance, tagged with who
 * spoke.
 *
 * The tags are French because the rest of the prompt is, and they are the
 * *roles* rather than the devices — mic is the rep, loopback is everyone else,
 * which is speaker attribution the hardware gives us for free (VISION.md §5).
 * No names appear here: who said it is not the model's to guess (DEC-7).
 */
export const renderChunk = (segments: readonly TranscriptSegment[]): string =>
  segments
    .map((s) => `${s.channel === 'rep' ? 'commercial' : 'client'}: ${s.text.trim()}`)
    .join('\n')
