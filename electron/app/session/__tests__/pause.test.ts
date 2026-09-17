/**
 * `session:pause` — a verb on the recording, never on the machine.
 *
 * Three things are asserted, each the half of the feature a rep would notice
 * missing: the transcriber hears nothing while paused and everything again
 * after; the meeting is still `recording` the whole time, so every guard that
 * keys on that state (one recording at a time, the crash sweep, the widget's
 * existence) is untouched; and the change is broadcast once per edge, never
 * per press.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { recordingRig } from './recordingFakes.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'

test('a paused recording drops frames before the transcriber and stays recording', async () => {
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const rig = await recordingRig({
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  })
  let writes = 0
  rig.transcribe.write = () => {
    writes += 1
  }
  const frame = { channel: 'rep', chunk: new Int16Array(160), sampleRate: 16_000 }

  rig.capture.emit('frame', frame)
  assert.equal(writes, 1)

  assert.deepEqual(rig.orchestrator.setPaused(rig.meetingId, true), { ok: true, paused: true })
  assert.equal(rig.orchestrator.isPaused(rig.meetingId), true)
  assert.equal(rig.orchestrator.stateOf(rig.meetingId), 'recording')
  rig.capture.emit('frame', frame)
  rig.capture.emit('frame', frame)
  assert.equal(writes, 1, 'frames reached the transcriber while paused')

  // Idempotent, and silent the second time.
  assert.deepEqual(rig.orchestrator.setPaused(rig.meetingId, true), { ok: true, paused: true })

  assert.deepEqual(rig.orchestrator.setPaused(rig.meetingId, false), { ok: true, paused: false })
  rig.capture.emit('frame', frame)
  assert.equal(writes, 2)

  const paused = broadcasts.filter((b) => b.channel === 'recording:paused')
  assert.deepEqual(
    paused.map((b) => b.payload),
    [
      { meetingId: rig.meetingId, paused: true },
      { meetingId: rig.meetingId, paused: false },
    ],
  )
  assert.deepEqual(
    rig.records.filter((r) => r.code.startsWith('recording.')).map((r) => r.code),
    ['recording.paused', 'recording.resumed'],
  )

  await rig.orchestrator.stopRecording(rig.meetingId)
})

/**
 * **`ok` and `paused` are two facts, and one boolean was carrying both.**
 *
 * Every line below answered `false` before this — a refused pause, a refused
 * *Reprendre* and a *successful* `Reprendre` — and the widget can only compare
 * the answer to what it asked for. So for `paused: false` « refused » and
 * « done » were the same reply, the sentence written for a refused *Reprendre*
 * was unreachable, and the control did nothing at all.
 *
 * Both directions are asserted, because the collapse is direction-specific:
 * a refused *Pause* was always visible in the comparison and a refused
 * *Reprendre* never was.
 */
test('a meeting that is not recording refuses, in both directions', async () => {
  const rig = await recordingRig()
  assert.deepEqual(rig.orchestrator.setPaused('m-absent', true), { ok: false, paused: false })
  assert.deepEqual(rig.orchestrator.setPaused('m-absent', false), { ok: false, paused: false })
  assert.equal(rig.orchestrator.isPaused('m-absent'), false)
  await rig.orchestrator.stopRecording(rig.meetingId)
})

/**
 * **The first half-second of every call, which is when the pill exists and the
 * devices do not.**
 *
 * `dispatch('start')` sets the state and broadcasts it synchronously — that
 * broadcast is what puts the widget on screen — then fires `#openDevices`
 * without awaiting it. Until `Recording.start` resolves there is a live pill, a
 * running clock and no `Recording`, and `setPaused` answered `false` for the
 * whole of it: driven on this class across a 418 ms device open, 8 samples of
 * 12 were a refusal beside `widget:state` answering a live meeting. The rep
 * pressed the product's only privacy control, read « La pause n’a pas pu être
 * prise. » next to « Enregistrement en cours », and the machine then opened the
 * devices **unpaused**.
 *
 * Two claimants, because the rule's subject is « a request made in that window
 * is honoured », not « a pause is honoured »: the pause has to reach the
 * transcriber, and a *Reprendre* taken back inside the same window has to reach
 * it too — otherwise the hold is a one-way door that nothing can open.
 */
const openWindowRig = async (): Promise<{
  orchestrator: Orchestrator
  store: ReturnType<typeof openMemoryStore>
  /** Frames that reached the transcriber. The whole point of a pause. */
  writes: () => number
  frame: () => void
  broadcasts: Array<{ channel: string; payload: unknown }>
  /** Lets `Recording.start` finish, then waits for the devices the way the rep does. */
  opened: () => Promise<void>
}> => {
  const store = openMemoryStore()
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  let writes = 0
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  class SlowCapture extends EventEmitter {
    async start(): Promise<void> {
      // What two audio devices cost on a real machine, held open by the test.
      await gate
    }
    async stop(): Promise<void> {}
  }
  class Transcribe extends EventEmitter {
    start(): void {}
    write(): void {
      writes += 1
    }
    speechEnded(): void {}
    async stop(): Promise<void> {}
  }

  let capture: SlowCapture | null = null
  const orchestrator = new Orchestrator(store, {
    diagnostics: { record: () => {} },
    broadcast: ((channel: string, payload: unknown) =>
      broadcasts.push({ channel, payload })) as never,
    recording: {
      createCapture: () => {
        capture = new SlowCapture()
        return capture as never
      },
      createTranscribe: () => new Transcribe() as never,
    },
    recordingOptionsFor: () => ({
      transcribe: { providerId: 'azure-fr', apiKey: 'k', language: 'fr-FR' },
    }),
    onEnded: async () => {},
  })
  orchestrator.create({ id: 'm-ouverture', title: 'Néovia — cadrage' })
  orchestrator.dispatch('m-ouverture', 'start', 'le commercial a démarré')

  return {
    orchestrator,
    store,
    writes: () => writes,
    frame: () => {
      assert.ok(capture, 'aucune capture ouverte')
      capture.emit('frame', { channel: 'rep', chunk: new Int16Array(160), sampleRate: 16_000 })
    },
    broadcasts,
    opened: async () => {
      release()
      for (let tick = 0; tick < 500 && !orchestrator.recording(); tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      assert.equal(orchestrator.recording(), true, 'les périphériques ne se sont jamais ouverts')
    },
  }
}

test('une pause demandée pendant l’ouverture des périphériques est tenue, pas refusée', async () => {
  const rig = await openWindowRig()

  // The window: the machine says `recording`, nothing is open behind it.
  assert.equal(rig.orchestrator.stateOf('m-ouverture'), 'recording')
  assert.equal(rig.orchestrator.recording(), false)

  assert.deepEqual(rig.orchestrator.setPaused('m-ouverture', true), { ok: true, paused: true })
  assert.equal(rig.orchestrator.isPaused('m-ouverture'), true)
  // The label flips because the broadcast went out, the way it does for a live
  // pause: the widget draws the broadcast and never its own press.
  assert.deepEqual(
    rig.broadcasts.filter((b) => b.channel === 'recording:paused').map((b) => b.payload),
    [{ meetingId: 'm-ouverture', paused: true }],
  )

  await rig.opened()

  // And it reached the `Recording`, so the first frame the devices produce is
  // already dropped — which is the fact, rather than a flag agreeing with itself.
  assert.equal(rig.orchestrator.isPaused('m-ouverture'), true)
  rig.frame()
  rig.frame()
  assert.equal(rig.writes(), 0, 'une trame a atteint le transcripteur malgré la pause')
  await rig.orchestrator.stopRecording('m-ouverture')
  rig.store.close()
})

test('et une reprise demandée dans la même fenêtre reprend vraiment', async () => {
  const rig = await openWindowRig()

  assert.deepEqual(rig.orchestrator.setPaused('m-ouverture', true), { ok: true, paused: true })
  assert.deepEqual(rig.orchestrator.setPaused('m-ouverture', false), { ok: true, paused: false })
  assert.equal(rig.orchestrator.isPaused('m-ouverture'), false)
  // One edge each way, never one per press — the rule the live path holds too.
  assert.deepEqual(
    rig.broadcasts.filter((b) => b.channel === 'recording:paused').map((b) => b.payload),
    [
      { meetingId: 'm-ouverture', paused: true },
      { meetingId: 'm-ouverture', paused: false },
    ],
  )

  await rig.opened()
  assert.equal(rig.orchestrator.isPaused('m-ouverture'), false)
  rig.frame()
  assert.equal(rig.writes(), 1, 'la reprise n’a pas rendu les trames au transcripteur')
  await rig.orchestrator.stopRecording('m-ouverture')
  rig.store.close()
})
