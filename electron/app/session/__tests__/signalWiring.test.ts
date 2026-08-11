/**
 * The orchestrator is the only thing allowed to know that `modules/capture` and
 * `modules/signals` both exist (ARCHITECTURE.md §4). These check the wire it
 * holds between them — not that either module works, which is their own suites'
 * job.
 *
 * The properties tested here are the ones neither module's unit tests can see:
 * that a chip is *persisted* rather than merely broadcast, that the transcript
 * pane never waits on a model, and that a meeting records perfectly well with
 * no model at all.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Store } from '../../../modules/store/index.ts'
import { SILENCE_GRACE_MS } from '../../../core/domain/endOfMeeting.ts'
import { Orchestrator, type SignalProducer } from '../Orchestrator.ts'
import type { Signal } from '../../../core/contracts/signals.ts'
import type { TranscriptSegment } from '../../../core/contracts/transcript.ts'

const segment = (id: string, text: string): TranscriptSegment => ({
  id,
  channel: 'far',
  text,
  startMs: 0,
  endMs: 1000,
  isFinal: true,
  provider: 'test',
  receivedAt: 1000,
})

const signal = (seq: number, label: string): Signal => ({
  id: `sig-${seq}`,
  seq,
  kind: 'tjm',
  label,
  source: { quote: label, channel: 'far', startMs: 0, endMs: 1000 },
  createdAt: 5000,
})

/**
 * Capture and transcription are both `EventEmitter`s. These open, emit nothing
 * on their own, and let a test push a segment through the real path rather than
 * simulating what the path would have done.
 */
class FakeCapture extends EventEmitter {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

class FakeTranscribe extends EventEmitter {
  start(): void {}
  async stop(): Promise<void> {}
  write(): void {}
  speechEnded(): void {}
}

interface Harness {
  orchestrator: Orchestrator
  store: Store
  broadcasts: Array<{ channel: string; payload: unknown }>
  transcribe: FakeTranscribe
  produced: SignalProducer[]
  cleanup: () => void
}

type CreateSignals = (input: {
  existing: readonly Signal[]
  onSignal: (signal: Signal) => void
}) => SignalProducer | null

const open = (createSignals?: CreateSignals, store = new Store(':memory:')): Harness => {
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const produced: SignalProducer[] = []
  const transcribe = new FakeTranscribe()

  const orchestrator = new Orchestrator(store, {
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    recording: {
      createCapture: () => new FakeCapture() as never,
      createTranscribe: () => transcribe as never,
    },
    ...(createSignals
      ? {
          createSignals: (input) => {
            const producer = createSignals(input)
            if (producer) produced.push(producer)
            return producer
          },
        }
      : {}),
  })

  return { orchestrator, store, broadcasts, transcribe, produced, cleanup: () => store.close() }
}

const record = async (h: Harness, id = 'm1') => {
  h.orchestrator.create({ id, title: 'Point Acme', context: null })
  h.orchestrator.dispatch(id, 'start', null)
  await h.orchestrator.startRecording(id, { transcribe: { providerId: 'test' } as never })
  return id
}

test('a chip is persisted, not merely broadcast', async () => {
  // The difference only shows on restart: a broadcast-only rail comes back
  // empty and the rep loses everything the model found before the crash.
  // Collected rather than assigned to a `let`: the assignment happens inside a
  // closure, and TypeScript narrows the variable to `null` at the call site.
  const emitters: Array<(signal: Signal) => void> = []
  const h = open(({ onSignal }) => {
    emitters.push(onSignal)
    return { push: () => {}, stop: () => {} }
  })

  const id = await record(h)
  assert.equal(emitters.length, 1, 'the orchestrator should have built a producer')
  emitters[0]!(signal(0, 'TJM 520 €'))

  assert.deepEqual(
    h.store.projections.signals(id).map((s) => s.label),
    ['TJM 520 €'],
  )
  assert.equal(h.broadcasts.filter((b) => b.channel === 'signal:appended').length, 1)

  h.cleanup()
})

test('the producer is seeded from the log, so a resumed session does not repeat itself', async () => {
  const store = new Store(':memory:')

  const first = open(({ onSignal }) => ({ push: () => void onSignal, stop: () => {} }), store)
  const id = await record(first)
  store.append(id, { type: 'signal.appended', signal: signal(0, 'TJM 520 €') })
  await first.orchestrator.stopRecording(id)

  // A restart: a new orchestrator over the same store.
  let seeded: readonly Signal[] = []
  const second = open(({ existing }) => {
    seeded = existing
    return { push: () => {}, stop: () => {} }
  }, store)
  second.orchestrator.dispatch(id, 'start', null)
  await second.orchestrator.startRecording(id, { transcribe: { providerId: 'test' } as never })

  assert.deepEqual(
    seeded.map((s) => s.label),
    ['TJM 520 €'],
    'the producer should be told what the rep has already seen',
  )

  store.close()
})

test('no model configured still records the meeting', async () => {
  // DEC-26: everything downstream of capture may fail; nothing downstream of
  // capture may stop a meeting being recorded.
  const h = open(() => null)
  const id = await record(h)

  assert.equal(h.orchestrator.stateOf(id), 'recording')
  assert.equal(h.produced.length, 0)
  assert.deepEqual(h.store.projections.signals(id), [])

  h.cleanup()
})

test('stopping the recording stops the producer', async () => {
  let stopped = 0
  const h = open(() => ({ push: () => {}, stop: () => void stopped++ }))
  const id = await record(h)

  await h.orchestrator.stopRecording(id)
  assert.equal(stopped, 1)

  h.cleanup()
})

test('a final segment reaches the rail through the real path', async () => {
  const seen: string[] = []
  const h = open(() => ({ push: (s) => seen.push(s.text), stop: () => {} }))
  await record(h)

  h.transcribe.emit('segment', segment('s1', 'le TJM est de 520 euros'))

  assert.deepEqual(seen, ['le TJM est de 520 euros'])
  h.cleanup()
})

test('the transcript is broadcast before the model sees the segment, and a throwing producer cannot stop it', async () => {
  // The transcript pane is the cheap, deterministic proof the tool is working
  // (DEC-14). A slow or throwing producer must not be able to delay or break
  // the one surface that is meant to be immune to model latency.
  const order: string[] = []
  const h = open(() => ({
    push: () => {
      order.push('signals')
      throw new Error('le modèle est tombé')
    },
    stop: () => {},
  }))
  const id = await record(h)

  const broadcastsBefore = h.broadcasts.filter((b) => b.channel === 'transcript:appended').length
  h.transcribe.emit('segment', segment('s1', 'bonjour'))
  const broadcastsAfter = h.broadcasts.filter((b) => b.channel === 'transcript:appended').length

  assert.deepEqual(order, ['signals'], 'the producer should still have been offered the segment')
  assert.equal(broadcastsAfter, broadcastsBefore + 1, 'the transcript must have been broadcast')

  // And the segment is stored, so a crash here costs no transcript either.
  assert.equal(h.store.projections.segments(id).length, 1)

  h.cleanup()
})

// ── Opening the devices ─────────────────────────────────────────────────────
//
// Regression, and the most important one in this file. `dispatch('start')`
// moves the machine to `recording`; `startRecording` is what opens the
// microphone. For a while nothing connected the two outside the dev harness, so
// pressing *Démarrer* produced a session that reported `recording` and captured
// nothing — the one failure a notetaker may not have, and one that looks
// completely healthy from every surface.

test('entering recording opens the devices', async () => {
  const asked: string[] = []
  const store = new Store(':memory:')
  const orchestrator = new Orchestrator(store, {
    recording: {
      createCapture: () => new FakeCapture() as never,
      createTranscribe: () => new FakeTranscribe() as never,
    },
    recordingOptionsFor: (meetingId) => {
      asked.push(meetingId)
      return { transcribe: { providerId: 'test', apiKey: '', language: 'fr-FR' } as never }
    },
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(asked, ['m1'], 'the options resolver should have been asked')
  assert.equal(orchestrator.stateOf('m1'), 'recording')

  store.close()
})

test('no usable transcription provider aborts rather than claiming to record', async () => {
  // A session that says `recording` with no transcriber is the one state this
  // app may never be in: it looks like it is working.
  const store = new Store(':memory:')
  const health: string[] = []
  const orchestrator = new Orchestrator(store, {
    broadcast: (channel, payload) => {
      if (channel === 'health:changed') health.push((payload as { connector: string }).connector)
    },
    recording: {
      createCapture: () => new FakeCapture() as never,
      createTranscribe: () => new FakeTranscribe() as never,
    },
    recordingOptionsFor: () => null,
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(orchestrator.stateOf('m1'), 'aborted')
  assert.ok(health.includes('transcribe'), 'and it says why')

  store.close()
})

test('re-entering recording does not open a second capture', async () => {
  let opened = 0
  const store = new Store(':memory:')
  const orchestrator = new Orchestrator(store, {
    recording: {
      createCapture: () => {
        opened += 1
        return new FakeCapture() as never
      },
      createTranscribe: () => new FakeTranscribe() as never,
    },
    recordingOptionsFor: () =>
      ({ transcribe: { providerId: 'test', apiKey: '', language: 'fr-FR' } }) as never,
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  orchestrator.dispatch('m1', 'start', null)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(opened, 1)
  store.close()
})

// ── The lexicon, both halves ────────────────────────────────────────────────
//
// Also regressions. `correct()` and `termsLearnedFrom()` were built and tested
// in step 4 and neither had a production caller: the shipped ESN vocabulary
// never corrected anything, and no meeting ever taught the app a client's
// vocabulary — so DEC-17's "the second meeting starts already boosted" could
// not happen.

test('a final segment is corrected before it is stored', async () => {
  // Before, not after. DEC-21 verifies every cited quote against the *stored*
  // transcript, so correcting on the way out would leave the model reading
  // corrected text and the verifier checking uncorrected text — and every span
  // would fail.
  const store = new Store(':memory:')
  const transcribe = new FakeTranscribe()
  const orchestrator = new Orchestrator(store, {
    recording: {
      createCapture: () => new FakeCapture() as never,
      createTranscribe: () => transcribe as never,
    },
    correctorFor: () => (text) => ({
      text: text.replace('mon cher point', 'SharePoint'),
      applied: ['SharePoint'],
    }),
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  await orchestrator.startRecording('m1', { transcribe: { providerId: 'test' } as never })

  transcribe.emit('segment', segment('s1', 'on héberge ça sur mon cher point'))

  assert.equal(
    store.projections.segments('m1')[0]?.text,
    'on héberge ça sur SharePoint',
    'the stored transcript is the corrected one',
  )

  store.close()
})

test('an interim segment is not corrected — it is about to be replaced', async () => {
  let calls = 0
  const store = new Store(':memory:')
  const transcribe = new FakeTranscribe()
  const orchestrator = new Orchestrator(store, {
    recording: {
      createCapture: () => new FakeCapture() as never,
      createTranscribe: () => transcribe as never,
    },
    correctorFor: () => (text) => {
      calls += 1
      return { text, applied: [] }
    },
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  await orchestrator.startRecording('m1', { transcribe: { providerId: 'test' } as never })

  transcribe.emit('segment', { ...segment('i1', 'en cours'), isFinal: false })
  assert.equal(calls, 0)

  transcribe.emit('segment', segment('s1', 'définitif'))
  assert.equal(calls, 1)

  store.close()
})

test('a throwing corrector costs the correction, never the sentence', async () => {
  // The capture path has no dependency it is allowed to fail on (DEC-26), and
  // this sits on it.
  const store = new Store(':memory:')
  const transcribe = new FakeTranscribe()
  const orchestrator = new Orchestrator(store, {
    recording: {
      createCapture: () => new FakeCapture() as never,
      createTranscribe: () => transcribe as never,
    },
    correctorFor: () => () => {
      throw new Error('table de correction cassée')
    },
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  await orchestrator.startRecording('m1', { transcribe: { providerId: 'test' } as never })

  transcribe.emit('segment', segment('s1', 'la phrase doit survivre'))
  assert.equal(store.projections.segments('m1')[0]?.text, 'la phrase doit survivre')

  store.close()
})

/*
 * DEC-16 reaching the orchestrator.
 *
 * `EndOfMeetingWatch` and `decideEndOfMeeting` were both written and tested
 * before anything called either, which is the failure this file exists to
 * catch: a rule that is correct, covered, and never consulted looks identical
 * to a working feature from every surface except a real meeting.
 */
const silenceHarness = () => {
  const store = new Store(':memory:')
  const capture = new FakeCapture()
  const transcribe = new FakeTranscribe()
  let now = 1_000_000
  let pending: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1

  const orchestrator = new Orchestrator(store, {
    clock: () => now,
    broadcast: () => {},
    timers: {
      set: (fn, ms) => {
        const id = nextId++
        pending.push({ at: now + ms, fn, id })
        return id
      },
      clear: (handle) => {
        pending = pending.filter((t) => t.id !== handle)
      },
    },
    recording: {
      createCapture: () => capture as never,
      createTranscribe: () => transcribe as never,
    },
  })

  const advance = (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = pending.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      pending = pending.filter((t) => t.id !== due.id)
      now = due.at
      due.fn()
    }
    now = target
  }

  const start = async (id = 'm1') => {
    orchestrator.create({ id, title: 'Point Acme', context: null })
    orchestrator.dispatch(id, 'start', null)
    await orchestrator.startRecording(id, { transcribe: { providerId: 'test' } as never })
    return id
  }

  return { orchestrator, capture, advance, start, cleanup: () => store.close() }
}

test('a meeting that falls silent long enough ends itself', async () => {
  const h = silenceHarness()
  await h.start()

  h.capture.emit('speechStarted', 'far')
  h.capture.emit('speechEnded', 'far')
  h.advance(SILENCE_GRACE_MS + 1)

  assert.equal(h.orchestrator.stateOf('m1'), 'ended')
  h.cleanup()
})

test('speech resuming inside the window keeps the meeting alive', async () => {
  const h = silenceHarness()
  await h.start()

  h.capture.emit('speechEnded', 'far')
  h.advance(SILENCE_GRACE_MS - 1_000)
  h.capture.emit('speechStarted', 'far')
  h.advance(SILENCE_GRACE_MS * 2)

  assert.equal(h.orchestrator.stateOf('m1'), 'recording')
  h.cleanup()
})

test('a pause on one channel while the other talks is not the end of the meeting', async () => {
  const h = silenceHarness()
  await h.start()

  h.capture.emit('speechStarted', 'rep')
  h.capture.emit('speechStarted', 'far')
  h.capture.emit('speechEnded', 'far')
  h.advance(SILENCE_GRACE_MS * 2)

  assert.equal(h.orchestrator.stateOf('m1'), 'recording')
  h.cleanup()
})

test('stopping the recording disarms the countdown', async () => {
  const h = silenceHarness()
  await h.start()

  h.capture.emit('speechEnded', 'far')
  await h.orchestrator.stopRecording('m1')
  h.advance(SILENCE_GRACE_MS * 3)

  // The meeting was stopped by another route; the timer must not fire a second
  // `end` into a session that has moved on.
  assert.notEqual(h.orchestrator.stateOf('m1'), 'aborted')
  h.cleanup()
})

test('a renderer that has gone away cannot break the capture path it auto-ends', async () => {
  const store = new Store(':memory:')
  const capture = new FakeCapture()
  const transcribe = new FakeTranscribe()
  let now = 1_000_000
  let pending: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1
  // Off during setup, on for the auto-end: `webContents.send` throws once the
  // window is destroyed, and the auto-end path reaches it from a VAD callback.
  let dead = false

  const orchestrator = new Orchestrator(store, {
    clock: () => now,
    broadcast: () => {
      if (dead) throw new Error('le renderer est parti')
    },
    timers: {
      set: (fn, ms) => {
        const id = nextId++
        pending.push({ at: now + ms, fn, id })
        return id
      },
      clear: (handle) => {
        pending = pending.filter((t) => t.id !== handle)
      },
    },
    recording: {
      createCapture: () => capture as never,
      createTranscribe: () => transcribe as never,
    },
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: null })
  orchestrator.dispatch('m1', 'start', null)
  await orchestrator.startRecording('m1', { transcribe: { providerId: 'test' } as never })

  dead = true
  capture.emit('speechEnded', 'far')
  const due = pending[0]
  assert.ok(due, 'a countdown was armed')

  // DEC-26: nothing downstream may stop a meeting being recorded, and a VAD
  // edge is as far downstream as it gets.
  now = due.at
  assert.doesNotThrow(() => due.fn())
  store.close()
})
