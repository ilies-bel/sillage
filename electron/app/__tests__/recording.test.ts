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

/**
 * **`retryable` means the app can actually retry it** (DEC-26).
 *
 * A module decides whether *its* failure is transient. It has no idea whether
 * anybody registered a way to act on that, and for a long time nobody had:
 * capture on a device error, transcription on a provider error and Outlook on an
 * expired token all reported `retryable: true`, and `Orchestrator.retry` quietly
 * returned the unchanged health for every one of them.
 *
 * So Réglages drew a live *Réessayer*, a rep pressed it, the row said
 * « Vérification… » and came back saying exactly what it had said before —
 * forever. The onboarding's *Autoriser* inherited the same bug the day it was
 * written, on the one screen whose whole job is to get a permission granted.
 *
 * The claim is corrected where both facts are known. These two tests are the
 * rule in both directions, because only having the first would let somebody
 * "fix" it by clearing `retryable` everywhere.
 */
test('a connector with no registered retry never claims to be retryable', () => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store, {})

  orchestrator.setHealth('capture', {
    state: 'degraded',
    reason: 'micro indisponible — périphérique occupé',
    since: 1,
    retryable: true,
  })

  const health = orchestrator.health().capture
  // `assert.equal` narrows the union, so `retryable` is reachable below it.
  assert.equal(health.state, 'degraded')
  assert.equal(health.retryable, false)
  // The reason survives untouched: it is worth reading whether or not there is
  // a control beside it, and stripping it would trade a dead button for a bare
  // red dot.
  assert.match(health.reason, /périphérique occupé/)
  store.close()
})

test('a retry registered *after* the health still gives the control back', async () => {
  /*
   * **The order of two statements in `main.ts` decided whether a rep got a
   * button, and nothing could see it.**
   *
   * `#truthful` strips `retryable` at *write* time and stores the stripped
   * value, so a health published before its retry was registered stayed
   * `retryable: false` for the life of the process. `main.ts` published capture
   * health twenty-two lines before registering capture's retry — so on macOS
   * first run the one permission that cannot be repaired after the call drew
   * « Réglages › » instead of « Autoriser », on the onboarding step *and* on the
   * *Requis* row it sends the rep to. Verbatim the failure
   * `core/domain/capturePermission.ts` exists to close.
   *
   * The test above registers the retry first, which is the order the product
   * does not use. This is the other one.
   */
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store, {})

  orchestrator.setHealth('capture', {
    state: 'degraded',
    reason: 'l’audio système n’est pas autorisé — le client ne sera pas enregistré',
    since: 1,
    retryable: true,
  })
  // Stripped, correctly: at this instant nobody can act on the claim.
  const before = orchestrator.health().capture
  assert.equal(before.state !== 'ok' && before.retryable, false)

  orchestrator.registerRetry('capture', async () => ({ state: 'ok' }))

  const health = orchestrator.health().capture
  assert.equal(health.state, 'degraded')
  assert.ok(health.state === 'degraded' && health.retryable, 'le bouton n’est jamais revenu')
  store.close()
})

test('and a module that genuinely cannot be retried is not handed one', () => {
  /*
   * The re-truth reads the module's **own claim**, never the stripped value —
   * guessing `retryable: true` there would invent a button for `restricted`, a
   * managed device where nothing a rep does will ever change the answer, which
   * is the dead control DEC-26 forbids in the other direction.
   */
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store, {})

  orchestrator.setHealth('capture', {
    state: 'down',
    reason: 'l’enregistrement est désactivé par votre organisation',
    since: 1,
    retryable: false,
  })
  orchestrator.registerRetry('capture', async () => ({ state: 'ok' }))

  const after = orchestrator.health().capture
  assert.equal(after.state !== 'ok' && after.retryable, false)
  store.close()
})

test('registering a retry gives the control back, with no screen to update', async () => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store, {})
  orchestrator.registerRetry('capture', async () => ({ state: 'ok' }))

  orchestrator.setHealth('capture', {
    state: 'degraded',
    reason: 'micro indisponible — périphérique occupé',
    since: 1,
    retryable: true,
  })

  const health = orchestrator.health().capture
  assert.equal(health.state, 'degraded')
  assert.equal(health.retryable, true)

  // And it does something: the point of the claim is that pressing it can change
  // the answer.
  assert.deepEqual(await orchestrator.retry('capture'), { state: 'ok' })
  store.close()
})
