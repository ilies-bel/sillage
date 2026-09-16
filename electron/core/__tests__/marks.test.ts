/**
 * Where a mark sits in a transcript.
 *
 * The rule is not obvious and it was got wrong in an early draft, which is why
 * this file exists: a turn is **written down after it is spoken**
 * (`modules/transcribe/index.ts` stamps a segment with its arrival and says a
 * batch provider cannot report acoustic time), so a rep reacting at 14:32:10 is
 * reacting to words that will not reach the log until 14:32:14. Placing every
 * mark by its clock alone would therefore put it consistently *above* the
 * sentence it was made about.
 *
 * So there are two kinds and they are placed differently, and the difference is
 * whether the rep pointed at something:
 *
 *  · pressed **on a line**, in the widget's live transcript — placed on that
 *    line, whatever the clock says, because the rep chose it;
 *  · pressed **on the pill** — placed in time, drawn as a moment, claiming
 *    nothing about the turns either side of it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { interleaveMarks, type MomentMark } from '../contracts/marks.ts'

const turn = (id: string, receivedAt: number) => ({ id, receivedAt })
const mark = (id: string, at: number, segmentId: string | null = null): MomentMark => ({
  id,
  at,
  note: '',
  segmentId,
  by: 'rep',
})

const shape = (rows: ReturnType<typeof interleaveMarks>) =>
  rows.map((row) => (row.kind === 'turn' ? row.segment.id : `⌁${row.mark.id}`))

test('a mark made on a line lands on that line, not where its clock says', () => {
  const segments = [turn('s1', 1_000), turn('s2', 2_000), turn('s3', 3_000)]
  // Made at 500 — before every turn arrived — but pressed on `s3`.
  const rows = interleaveMarks(segments, [mark('m1', 500, 's3')])
  assert.deepEqual(shape(rows), ['s1', 's2', 's3', '⌁m1'])
})

test('a mark made on the pill lands after every turn that had arrived', () => {
  const segments = [turn('s1', 1_000), turn('s2', 2_000), turn('s3', 3_000)]
  const rows = interleaveMarks(segments, [mark('m1', 2_500)])
  assert.deepEqual(shape(rows), ['s1', 's2', '⌁m1', 's3'])
})

test('a tie goes to the turn — it was written down, then the rep pressed', () => {
  const rows = interleaveMarks([turn('s1', 1_000)], [mark('m1', 1_000)])
  assert.deepEqual(shape(rows), ['s1', '⌁m1'])
})

test('marks are ordered by when they were made, whatever order they arrive in', () => {
  const segments = [turn('s1', 1_000)]
  const rows = interleaveMarks(segments, [mark('late', 9_000), mark('early', 2_000)])
  assert.deepEqual(shape(rows), ['s1', '⌁early', '⌁late'])
})

test('several marks on one line keep the order they were made in', () => {
  const segments = [turn('s1', 1_000), turn('s2', 2_000)]
  const rows = interleaveMarks(segments, [mark('b', 9_000, 's1'), mark('a', 3_000, 's1')])
  assert.deepEqual(shape(rows), ['s1', '⌁a', '⌁b', 's2'])
})

/**
 * The fallback, and why it is not « drop it ».
 *
 * A mark can name a turn this view does not hold — a record read back after a
 * segment failed to persist, or a filtered list. Dropping it would lose the
 * rep's own press with nothing on screen saying anything went missing, which is
 * the failure DEC-21 exists to make visible everywhere else. Placing it by its
 * instant is at worst a turn early.
 */
test('a mark naming a turn that is not here is placed by its instant, never dropped', () => {
  const segments = [turn('s1', 1_000), turn('s2', 5_000)]
  const rows = interleaveMarks(segments, [mark('m1', 2_000, 'gone')])
  assert.deepEqual(shape(rows), ['s1', '⌁m1', 's2'])
})

/**
 * The case the end-to-end run found: a call that recorded no audio at all.
 *
 * A headless machine, a far channel that never opened, a laptop with no
 * weights — on every one of those the *only* record of what mattered is what
 * the rep pressed during the call. Both readers used to return « aucune
 * transcription » before they got this far and swallowed every mark.
 */
test('marks survive a call with no transcript', () => {
  const rows = interleaveMarks([], [mark('m1', 1_000), mark('m2', 2_000, 'gone')])
  assert.deepEqual(shape(rows), ['⌁m1', '⌁m2'])
})

test('a transcript with no marks is itself, in order', () => {
  const segments = [turn('s1', 1_000), turn('s2', 2_000)]
  assert.deepEqual(shape(interleaveMarks(segments, [])), ['s1', 's2'])
})
