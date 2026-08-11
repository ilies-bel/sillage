/**
 * Chunking is pure, so it is tested the way pure things are: same input, same
 * cuts, every time. Stability is the property that matters — a failed
 * extraction is retried by re-running the whole recipe, and a retry that cut
 * the transcript somewhere else would produce a different compte-rendu from the
 * same meeting.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { TranscriptSegment } from '../../../core/contracts/transcript.ts'
import {
  chunkTranscript,
  estimateTokens,
  isCitable,
  renderSegment,
  renderSegments,
} from '../chunking.ts'

const segment = (over: Partial<TranscriptSegment> & { id: string }): TranscriptSegment => ({
  channel: 'far',
  text: 'on cherche un renfort',
  startMs: 0,
  endMs: 1_000,
  isFinal: true,
  provider: 'test',
  receivedAt: 0,
  ...over,
})

/** ~40 words a turn, which is about ten seconds of French business speech. */
const longTurn = (i: number): TranscriptSegment =>
  segment({
    id: `seg-${String(i).padStart(4, '0')}`,
    channel: i % 2 === 0 ? 'rep' : 'far',
    text: `tour ${i} ${'nous avons besoin de renforts sur la plateforme et le budget est contraint '.repeat(4)}`,
    startMs: i * 10_000,
    endMs: i * 10_000 + 9_000,
  })

test('interim and empty segments are never citable', () => {
  assert.equal(isCitable(segment({ id: 'a' })), true)
  assert.equal(isCitable(segment({ id: 'b', isFinal: false })), false)
  assert.equal(isCitable(segment({ id: 'c', text: '   ' })), false)
})

test('a transcript with nothing citable produces no chunks at all', () => {
  assert.deepEqual(chunkTranscript([]), [])
  assert.deepEqual(chunkTranscript([segment({ id: 'a', isFinal: false })]), [])
})

test('the model sees roles, never names, never timings', () => {
  const rendered = renderSegments([
    segment({ id: 'a', channel: 'rep', text: 'bonjour' }),
    segment({ id: 'b', channel: 'far', text: 'bonjour à vous' }),
  ])
  assert.equal(rendered, 'commercial: bonjour\nclient: bonjour à vous')
  assert.match(renderSegment(segment({ id: 'c', channel: 'far' })), /^client: /)
  assert.doesNotMatch(rendered, /\d/)
})

test('a short meeting is one chunk — the map stage is skipped', () => {
  const chunks = chunkTranscript([segment({ id: 'a' }), segment({ id: 'b', startMs: 2_000 })])
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]?.segments.length, 2)
})

test('a long meeting is cut into chunks that each stay near the budget', () => {
  const transcript = Array.from({ length: 120 }, (_, i) => longTurn(i))
  const chunks = chunkTranscript(transcript, {
    singlePassTokens: 500,
    targetTokens: 900,
    overlapTokens: 120,
  })

  assert.ok(chunks.length > 3, `expected several chunks, got ${chunks.length}`)
  for (const chunk of chunks) {
    // The budget is a cut point, not a hard ceiling: a chunk is closed *before*
    // the segment that would overflow it, so one segment of slack is expected.
    assert.ok(chunk.tokens <= 900 + estimateTokens(renderSegment(longTurn(0))))
  }
  assert.deepEqual(
    chunks.map((c) => c.index),
    chunks.map((_, i) => i),
  )
})

test('every citable segment reaches at least one chunk', () => {
  const transcript = Array.from({ length: 60 }, (_, i) => longTurn(i))
  const chunks = chunkTranscript(transcript, {
    singlePassTokens: 500,
    targetTokens: 900,
    overlapTokens: 120,
  })
  const seen = new Set(chunks.flatMap((c) => c.segments.map((s) => s.id)))
  assert.equal(seen.size, transcript.length)
})

test('chunks overlap, so a fact split across a cut survives it', () => {
  const transcript = Array.from({ length: 60 }, (_, i) => longTurn(i))
  const chunks = chunkTranscript(transcript, {
    singlePassTokens: 500,
    targetTokens: 900,
    overlapTokens: 200,
  })
  const first = chunks[0]
  const second = chunks[1]
  assert.ok(first !== undefined && second !== undefined)
  const tail = new Set(first.segments.map((s) => s.id))
  assert.ok(second.segments.some((s) => tail.has(s.id)), 'no overlap between chunk 0 and 1')
})

test('the cut points depend on the transcript, not on the order it arrived in', () => {
  const transcript = Array.from({ length: 80 }, (_, i) => longTurn(i))
  const options = { singlePassTokens: 500, targetTokens: 900, overlapTokens: 120 }

  const inOrder = chunkTranscript(transcript, options)
  const shuffled = chunkTranscript([...transcript].reverse(), options)
  const withInterim = chunkTranscript(
    [...transcript, segment({ id: 'zz', isFinal: false, text: 'euh' })],
    options,
  )

  assert.deepEqual(
    shuffled.map((c) => c.text),
    inOrder.map((c) => c.text),
  )
  assert.deepEqual(
    withInterim.map((c) => c.text),
    inOrder.map((c) => c.text),
  )
})

test('two segments starting at the same instant get a total order', () => {
  const options = { singlePassTokens: 10, targetTokens: 500, overlapTokens: 0 }
  const a = segment({ id: 'aaa', channel: 'rep', text: 'le commercial parle', startMs: 5_000 })
  const b = segment({ id: 'bbb', channel: 'far', text: 'le client parle aussi', startMs: 5_000 })
  assert.deepEqual(
    chunkTranscript([a, b], options).map((c) => c.text),
    chunkTranscript([b, a], options).map((c) => c.text),
  )
})

test('one enormous segment cannot stall the loop', () => {
  const huge = segment({ id: 'huge', text: 'mot '.repeat(5_000) })
  const after = segment({ id: 'after', text: 'et donc voilà', startMs: 60_000 })
  const chunks = chunkTranscript([huge, after], {
    singlePassTokens: 500,
    targetTokens: 600,
    overlapTokens: 200,
  })
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.at(-1)?.segments.some((s) => s.id === 'after'))
})
