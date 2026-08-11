/**
 * The wiring, with no audio device and no network.
 *
 * What is asserted here is the set of rules that belong to neither module and
 * would therefore be nobody's job to keep: the start/stop ordering, the fact
 * that only final segments reach the log, and that a transcription failure
 * leaves capture running.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { openMemoryStore } from '../../modules/store/index.ts'
import { MeetingSession } from '../session/MeetingSession.ts'
import { Orchestrator } from '../session/Orchestrator.ts'
import { Recording } from '../session/Recording.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'

/** Records the order in which the two modules were driven. */
const trace: string[] = []

class FakeCapture extends EventEmitter {
  failOnStart = false
  async start(): Promise<void> {
    if (this.failOnStart) throw new Error('micro indisponible')
    trace.push('capture.start')
  }
  async stop(): Promise<void> {
    trace.push('capture.stop')
  }
}

class FakeTranscribe extends EventEmitter {
  frames: Array<{ channel: string; bytes: number }> = []
  flushes: string[] = []
  start(): void {
    trace.push('transcribe.start')
  }
  write(channel: string, chunk: Buffer): void {
    this.frames.push({ channel, bytes: chunk.length })
  }
  speechEnded(channel: string): void {
    this.flushes.push(channel)
  }
  async stop(): Promise<void> {
    trace.push('transcribe.stop')
  }
}

const harness = () => {
  trace.length = 0
  const store = openMemoryStore()
  const session = MeetingSession.create(store, { id: 'm1', title: 'Point ACME' })
  session.dispatch('start')
  const capture = new FakeCapture()
  const transcribe = new FakeTranscribe()
  return {
    store,
    session,
    capture,
    transcribe,
  }
}

const start = async (h: ReturnType<typeof harness>, extra = {}) =>
  Recording.start(
    h.session,
    { transcribe: { providerId: 'azure-fr', apiKey: 'k', language: 'fr-FR' } },
    {
      // The casts are the price of faking two concrete classes rather than
      // interfaces; the events and methods used are exactly the ones asserted.
      createCapture: () => h.capture as never,
      createTranscribe: () => h.transcribe as never,
      ...extra,
    },
  )

test('the transcriber is ready before the first frame can arrive', async () => {
  const h = harness()
  await start(h)
  assert.deepEqual([...trace], ['transcribe.start', 'capture.start'])
})

test('capture stops before the transcriber, so the tail is not dropped', async () => {
  const h = harness()
  const recording = await start(h)
  trace.length = 0
  await recording.stop()
  assert.deepEqual([...trace], ['capture.stop', 'transcribe.stop'])
})

test('frames and VAD flushes are forwarded with their channel intact', async () => {
  const h = harness()
  await start(h)
  h.capture.emit('frame', { channel: 'rep', chunk: Buffer.alloc(320), sampleRate: 16_000 })
  h.capture.emit('frame', { channel: 'far', chunk: Buffer.alloc(640), sampleRate: 48_000 })
  h.capture.emit('speechEnded', 'far')
  assert.deepEqual(h.transcribe.frames, [
    { channel: 'rep', bytes: 320 },
    { channel: 'far', bytes: 640 },
  ])
  assert.deepEqual(h.transcribe.flushes, ['far'])
})

const segment = (over: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  id: 's1',
  channel: 'rep',
  text: 'on part sur du régie',
  startMs: 1_000,
  endMs: 1_000,
  isFinal: true,
  provider: 'azure-fr',
  receivedAt: 1_700_000_000_000,
  ...over,
})

test('a final segment is persisted as an event', async () => {
  const h = harness()
  await start(h)
  h.transcribe.emit('segment', segment())
  const stored = h.store.projections.segments('m1')
  assert.equal(stored.length, 1)
  assert.equal(stored[0]?.text, 'on part sur du régie')
})

test('an interim segment is shown but never written to the log (DEC-21)', async () => {
  const h = harness()
  const seen: TranscriptSegment[] = []
  await start(h, { onSegment: (s: TranscriptSegment) => seen.push(s) })
  h.transcribe.emit('segment', segment({ id: 's2', isFinal: false }))
  assert.equal(seen.length, 1, 'the pane still sees it')
  assert.equal(h.store.projections.segments('m1').length, 0, 'the log does not')
})

test('a transcription failure degrades transcribe and leaves capture alone (DEC-26)', async () => {
  const h = harness()
  const health: Array<[string, { state: string }]> = []
  await start(h, { onHealth: (c: string, s: { state: string }) => health.push([c, s]) })
  h.transcribe.emit('health', { state: 'degraded', reason: '429', since: 1, retryable: true })
  assert.deepEqual(health.map(([c, s]) => [c, s.state]), [['transcribe', 'degraded']])
})

test('stop is idempotent', async () => {
  const h = harness()
  const recording = await start(h)
  trace.length = 0
  await Promise.all([recording.stop(), recording.stop()])
  await recording.stop()
  assert.deepEqual([...trace], ['capture.stop', 'transcribe.stop'])
})

test('a meeting whose devices will not open is aborted, not left claiming to record', async () => {
  const store = openMemoryStore()
  const capture = new FakeCapture()
  capture.failOnStart = true
  const orchestrator = new Orchestrator(store, {
    recording: {
      createCapture: () => capture as never,
      createTranscribe: () => new FakeTranscribe() as never,
    },
  })
  orchestrator.create({ id: 'm2', title: 'Point ACME' })
  orchestrator.dispatch('m2', 'start')
  assert.equal(orchestrator.stateOf('m2'), 'recording')

  await assert.rejects(
    orchestrator.startRecording('m2', {
      transcribe: { providerId: 'azure-fr', apiKey: 'k', language: 'fr-FR' },
    }),
    /micro indisponible/,
  )

  assert.equal(orchestrator.stateOf('m2'), 'aborted')
  const health = orchestrator.health().capture
  assert.ok(health && health.state === 'down')
  assert.match(health.reason, /micro indisponible/)
})
