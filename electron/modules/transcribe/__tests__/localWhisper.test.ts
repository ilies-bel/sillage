/**
 * The offline floor's lifecycle, with a fake worker and no model on disk.
 *
 * What is asserted here is the set of failures that cost a meeting rather than
 * a segment: a spawn that fails leaving a session that claims to be
 * transcribing, a worker that dies leaving `stop()` waiting forever, and a
 * `stop()` that returns before the tail of the call has come back.
 *
 * Four of the deferred tests belonged to the class this replaces. Three of them
 * asserted on the *source text* of the old streaming loop — `extractHandlerBody`
 * grepping for `streamingTaskInFlight` resets — which cannot survive the loop
 * being deleted. The invariant underneath them does survive, and it is the one
 * below: **the session must never be left in a state where nothing will ever
 * complete and nothing says so.**
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { LocalWhisperSession } from '../LocalWhisperSession.ts'
import type { WorkerLike } from '../LocalWhisperSession.ts'
import { __resetLoadSlotForTests } from '../whisper/onnx.ts'
import { acquireEngine, __resetEnginePoolForTests } from '../whisper/engine.ts'
import type { DiagEvent } from '../../../core/contracts/diagnostics.ts'

// The memory gate spawns `vm_stat`; pin it so the tests are about the session.
process.env.SILLAGE_ONNX_AVAILABLE_MEM_GB = '64'
// The crash-loop sentinel writes to disk. Its own behaviour is covered in
// whisper.test.ts against a temp dir; here it must simply not interfere.
process.env.SILLAGE_ONNX_SENTINEL_DISABLED = '1'

class FakeWorker extends EventEmitter implements WorkerLike {
  sent: Array<Record<string, unknown>> = []
  terminated = false

  postMessage(value: unknown): void {
    this.sent.push(value as Record<string, unknown>)
  }
  terminate(): number {
    this.terminated = true
    return 0
  }

  get tasks(): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type === 'transcribe')
  }
  becomeReady(): void {
    this.emit('message', { type: 'ready' })
  }
  answer(index: number, text: string): void {
    const task = this.tasks[index]
    this.emit('message', { type: 'result', taskId: task?.taskId, text })
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface Harness {
  session: LocalWhisperSession
  worker: FakeWorker
  transcripts: string[]
  errors: unknown[]
  diagnostics: DiagEvent[]
}

const start = async (
  overrides: Record<string, unknown> = {},
  spawn?: () => WorkerLike,
): Promise<Harness> => {
  __resetLoadSlotForTests()
  const worker = new FakeWorker()
  const diagnostics: DiagEvent[] = []
  const transcripts: string[] = []
  const errors: unknown[] = []

  const session = new LocalWhisperSession({
    apiKey: '',
    language: 'fr-FR',
    modelsDir: '/models',
    workerPath: '/worker.js',
    stateDir: '/state',
    drainTimeoutMs: 40,
    spawn: spawn ?? (() => worker),
    diagnostics: {
      record: (event) => {
        diagnostics.push(event as DiagEvent)
      },
    },
    ...overrides,
  })
  session.on('transcript', (t: { text: string }) => transcripts.push(t.text))
  session.on('error', (e: unknown) => errors.push(e))
  session.start()
  await tick()
  return { session, worker, transcripts, errors, diagnostics }
}

/**
 * One audible utterance, as the capture module would deliver it: Int16LE PCM.
 *
 * The default is 26 seconds because that is what it now takes to *make* the VAD
 * emit without a pause: speech is packed up to twenty seconds and cut hard at
 * twenty-five, since Whisper charges a full 30-second window per inference
 * regardless of how much speech is in it. A short burst followed by
 * `notifySpeechEnded()` used to produce a segment and deliberately no longer
 * does — see the absorption test below.
 */
const utterance = (frames = 860): Buffer => {
  const samples = 480 * frames
  const pcm = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(i % 2 === 0 ? 8_000 : -8_000, i * 2)
  return pcm
}

test('audio recorded while the model is still loading is not thrown away', async () => {
  const h = await start()
  h.session.write(utterance(), 16_000)
  assert.equal(h.worker.tasks.length, 0, 'nothing posted before the worker is ready')

  h.worker.becomeReady()
  assert.equal(h.worker.tasks.length, 1, 'the backlog flushes on ready')
  await h.session.stop()
})

test('boost terms are sent once, as a prompt, before any audio (DEC-17)', async () => {
  const h = await start({ boostTerms: ['TJM', 'régie', 'intercontrat'] })
  h.session.write(utterance(), 16_000)
  h.worker.becomeReady()

  const prompts = h.worker.sent.filter((m) => m.type === 'setPrompt')
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0]?.prompt, 'TJM, régie, intercontrat')
  // The prompt has to be in the worker's cache before the queued utterance is
  // transcribed, or the first thing said in the meeting is the one thing not
  // boosted — and that is where the attendee names are.
  const order = h.worker.sent.map((m) => m.type)
  assert.ok(order.indexOf('setPrompt') < order.indexOf('transcribe'))
  await h.session.stop()
})

test('a result becomes one final transcript, and an invention becomes none', async () => {
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(), 16_000)
  h.session.write(utterance(), 16_000)

  h.worker.answer(0, 'On part sur du régie.')
  h.worker.answer(1, "Sous-titres réalisés par la communauté d'Amara.org")

  // One microtask: a result now travels back through the shared engine's
  // per-task promise rather than being emitted inside the message handler.
  await tick()
  assert.deepEqual(h.transcripts, ['On part sur du régie.'])
  await h.session.stop()
})

test('the language reaches the worker as sent, not guessed (DEC-22)', async () => {
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(), 16_000)
  assert.equal(h.worker.tasks[0]?.language, 'fr-FR')
  await h.session.stop()
})

test('stop waits for the tail of the meeting', async () => {
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(), 16_000)

  let settled = false
  const stopping = h.session.stop().then(() => {
    settled = true
  })
  await tick()
  assert.equal(settled, false, 'the last utterance has not come back yet')

  h.worker.answer(0, 'On se cale mardi pour le kickoff.')
  await stopping
  assert.equal(settled, true)
  assert.deepEqual(h.transcripts, ['On se cale mardi pour le kickoff.'])
})

test('an open utterance is flushed by stop, not abandoned in the VAD', async () => {
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(8), 16_000)
  // No `notifySpeechEnded` — the meeting simply ended while someone was talking.
  const stopping = h.session.stop()
  await tick()
  assert.equal(h.worker.tasks.length, 1, 'stop closed the open utterance')
  h.worker.answer(0, 'Donc on valide le TJM.')
  await stopping
  assert.deepEqual(h.transcripts, ['Donc on valide le TJM.'])
})

test('a worker that dies mid-drain does not leave stop waiting forever', async () => {
  // This is the invariant the deleted streaming-loop tests were protecting,
  // stated in terms of what it costs: a `stop()` that never resolves means the
  // meeting never reaches `ended`, so the rep's document never receives its AI
  // block and the session is stuck. Losing the tail is bad; hanging is worse.
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(8), 16_000)

  const stopping = h.session.stop()
  await tick()
  h.worker.emit('exit', 1)

  await stopping // must not hit the drain timeout, and must not hang
  assert.ok(h.errors.length > 0, 'the failure is announced, not swallowed')
  const lost = h.diagnostics.find((d) => d.code === 'transcribe.local.abandoned')
  assert.ok(lost, 'the lost segment is recorded')
  assert.match(lost.message, /1 segment/)
})

test('a model that never answers is bounded, and the loss is named', async () => {
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(), 16_000)

  await h.session.stop() // drainTimeoutMs is 40ms in this harness
  const timeout = h.diagnostics.find((d) => d.code === 'transcribe.local.drainTimeout')
  assert.ok(timeout, 'a silent loss at meeting end is the one thing not allowed')

  // Asked to leave, not killed. `terminate()` stops the thread wherever it is,
  // and inside an ONNX inference that unwind aborts the whole process — the app
  // vanishing at the end of a meeting, before the document has been written.
  assert.ok(
    h.worker.sent.some((m) => m.type === 'shutdown'),
    'a worker with an inference in flight is asked to finish first',
  )
})

test('a worker with nothing in flight is torn down immediately', async () => {
  const h = await start()
  h.worker.becomeReady()
  await h.session.stop()
  assert.equal(h.worker.terminated, true, 'no native work to interrupt, no reason to wait')
})

test('a worker still loading its model is asked to leave, not killed', async () => {
  // Building the ONNX session is native work like an inference is, it is the
  // longest of the two, and interrupting it aborts the process the same way —
  // `libc++abi: terminating due to uncaught exception of type Napi::Error`.
  // A meeting that ends while the model is still cold is the case that hits it.
  const h = await start()
  const stopping = h.session.stop()
  await tick()

  assert.equal(h.worker.terminated, false, 'a loading worker is not terminated outright')
  assert.ok(
    h.worker.sent.some((m) => m.type === 'shutdown'),
    'it is asked to shut down cooperatively',
  )

  h.worker.emit('exit', 0)
  await stopping
})

test('a pause inside an utterance does not cost an inference', async () => {
  // The packing rule at this level: the native VAD's end-of-utterance is
  // absorbed rather than acted on, because acting on it is what made a
  // five-minute call queue eighty-five inferences it could not retire.
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(8), 16_000) // ~240 ms of speech
  h.session.notifySpeechEnded()
  assert.equal(h.worker.tasks.length, 0, 'held, not sent')

  // …and none of it is lost: `stop()` flushes whatever is still held.
  const stopping = h.session.stop()
  await tick()
  assert.equal(h.worker.tasks.length, 1, 'the held audio is sent at meeting end')
  h.worker.answer(0, 'Trois mots suffisent.')
  await stopping
  assert.deepEqual(h.transcripts, ['Trois mots suffisent.'])
})

test('a spawn failure leaves an inert session, not one that claims to record', async () => {
  // The regression this pins: the failure path used to log and re-emit without
  // tearing anything down, so `#active` stayed true with no worker behind it.
  // Every utterance for the rest of the meeting was dropped at dispatch, and
  // nothing ever said so again.
  const h = await start({}, () => {
    throw new Error('mémoire insuffisante')
  })

  assert.equal(h.errors.length, 1)
  assert.match(String(h.errors[0]), /mémoire insuffisante/)

  h.session.write(utterance(), 16_000)
  assert.deepEqual(h.diagnostics.filter((d) => d.code === 'transcribe.local.dropped'), [])
  await h.session.stop()
})

test('stop is idempotent', async () => {
  const h = await start()
  h.worker.becomeReady()
  await Promise.all([h.session.stop(), h.session.stop()])
  await h.session.stop()
  assert.equal(h.worker.terminated, true)
})

test('frames after stop are dropped rather than queued for a dead worker', async () => {
  const h = await start()
  h.worker.becomeReady()
  await h.session.stop()
  h.session.write(utterance(), 16_000)
  assert.equal(h.worker.tasks.length, 0)
})

test('download progress is a diagnostic, never a transcript', async () => {
  const h = await start()
  h.worker.emit('message', { type: 'progress', modelId: 'Xenova/whisper-small', progress: 42 })
  assert.deepEqual(h.transcripts, [])
  assert.equal(h.diagnostics.at(-1)?.code, 'transcribe.local.download')
  await h.session.stop()
})

test('a model-load failure is translated into something a rep can act on', async () => {
  const h = await start()
  h.worker.emit('message', {
    type: 'error',
    message: 'Failed to load model: Symbol not found: __ZNSt3__18to_charsEPcS0_d',
  })
  assert.equal(h.errors.length, 1)
  assert.match(String(h.errors[0]), /macOS 13/)
  await h.session.stop()
})

test('a per-segment failure is reported without killing the session', async () => {
  const h = await start()
  h.worker.becomeReady()
  h.session.write(utterance(), 16_000)
  h.worker.emit('message', { type: 'error', taskId: h.worker.tasks[0]?.taskId, message: 'boom' })

  await tick()
  assert.equal(h.errors.length, 1)
  // Still alive: the next utterance is transcribed normally.
  h.session.write(utterance(), 16_000)
  h.worker.answer(1, 'Deuxième phrase.')
  await tick()
  assert.deepEqual(h.transcripts, ['Deuxième phrase.'])
  await h.session.stop()
})

/**
 * The reason `whisper/engine.ts` exists, asserted rather than assumed.
 *
 * A meeting opens two channels. Before the engine they each spawned a worker
 * and loaded the same weights twice — 15.2 s and 2.1 GB where 7 s and 1.1 GB
 * would do, measured on an M1 Max with whisper-small q8. The rep's report was a
 * 70-second recording whose first line arrived at 38.8 s, and this is the test
 * that would have caught it.
 */
test('two channels of one meeting share a single loaded model', async () => {
  __resetLoadSlotForTests()
  __resetEnginePoolForTests()

  const spawned: FakeWorker[] = []
  const spawn = (): WorkerLike => {
    const worker = new FakeWorker()
    spawned.push(worker)
    return worker
  }

  // The pool keys on the model id, and only a session without a `spawn`
  // override consults it — so the two channels are built the way `index.ts`
  // builds them, through one shared engine handed the same fake.
  const engine = acquireEngine({ model: 'Xenova/whisper-small', modelsDir: '/m', stateDir: '/s', workerPath: '/w.js', spawn })
  await engine.retain()
  await engine.retain()
  await tick()

  assert.equal(spawned.length, 1, `expected one worker for two channels, got ${spawned.length}`)
  assert.equal(engine.refs, 2)

  // The first channel leaving must not take the model with it: the other one is
  // still mid-meeting, and reloading would cost the far end its next utterance.
  await engine.release()
  assert.equal(spawned[0]?.terminated, false)

  await engine.release()
  assert.equal(engine.refs, 0)
})

/**
 * What makes the boot prewarm reach the meeting: the pool hands the same engine
 * to whoever asks for the same checkpoint. Without this identity the prewarm
 * would load a model into an object nobody ever consults, and *Démarrer* would
 * still pay the cold load — a gigabyte spent to change nothing.
 *
 * Nothing is retained here, so nothing spawns: this is about which object comes
 * back, which is the part the prewarm depends on.
 */
test('the prewarm and the meeting resolve to the same engine', () => {
  __resetEnginePoolForTests()

  const boot = acquireEngine({ model: 'Xenova/whisper-small' })
  const meeting = acquireEngine({ model: 'Xenova/whisper-small' })
  assert.equal(meeting, boot)

  // Not across checkpoints, though. Handing a meeting the prewarmed weights of
  // a model the rep did not choose would transcribe it on the wrong engine —
  // silently, since both answer in French.
  assert.notEqual(acquireEngine({ model: 'Xenova/whisper-base' }), boot)

  // And never for a session carrying a test's fake worker, or one test's stub
  // would answer the next test's audio.
  const fake = acquireEngine({ model: 'Xenova/whisper-small', spawn: () => new FakeWorker() })
  assert.notEqual(fake, boot)
})
