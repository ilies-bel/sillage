/**
 * **A meeting that is genuinely recording, with a transcriber that has a tail.**
 *
 * Not a `.test.ts`, so `run-tests.mjs` does not run it: it is shared by
 * `orchestrator.test.ts` and `powerWatch.test.ts`, which both need to ask what
 * happens to the **last utterance of a call** when the process is on its way out,
 * and neither could ask before — the first built its orchestrator without
 * `onEnded` and the second never opened a device at all.
 *
 * Two things here are the fixture, and getting either wrong makes the fixture
 * unable to exercise the property it is named after (this repo's first shape):
 *
 *  · **`onEnded` is injected by default**, because `main.ts` injects it on every
 *    launch and it is the axis R32-1 turned on. Without it `Orchestrator.#enhance`
 *    returns on its first line, nothing races `stopRecording` for the `Recording`,
 *    and the flush measured is one the product never performs.
 *  · **The tail is emitted inside `stop()`, after a real await**, the way
 *    `LocalWhisperSession.#shutdown()` drains its queue on a thirty-second budget
 *    and every REST provider posts its last chunk. A fake that flushed
 *    synchronously cannot tell « awaited the flush » from « returned before it ».
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import type { Store } from '../../../modules/store/index.ts'
import type { DiagInput } from '../../../core/contracts/diagnostics.ts'
import type { TranscriptSegment } from '../../../core/contracts/transcript.ts'

/** The devices. They stop without an opinion; capture is upstream of everything. */
export class FakeCapture extends EventEmitter {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

/** The id every tail segment here carries, so a test can count exactly it. */
export const TAIL_ID = 'tail-1'

/**
 * A transcriber whose `stop()` emits one final segment — « on se recale jeudi »,
 * the part `stopRecording`'s docblock calls the one with the next steps in it.
 */
export class TailingTranscribe extends EventEmitter {
  /** True once `stop()` has finished emitting. */
  flushed = false
  /** Set when the emit threw, which is what a write into a closed store does. */
  refused: string | null = null
  /** Never resolves — for the bounded-wait case. */
  hangs = false
  #delayMs: number

  constructor(delayMs = 5) {
    super()
    this.#delayMs = delayMs
  }

  start(): void {}
  write(): void {}
  speechEnded(): void {}

  async stop(): Promise<void> {
    if (this.hangs) return new Promise<void>(() => {})
    await new Promise((resolve) => setTimeout(resolve, this.#delayMs))
    try {
      this.emit('segment', {
        id: TAIL_ID,
        channel: 'far',
        text: 'on se recale jeudi avec les trois CV',
        startMs: 1_000,
        endMs: 1_000,
        isFinal: true,
        provider: 'azure-fr',
        receivedAt: 1_700_000_000_000,
      } satisfies TranscriptSegment)
    } catch (error) {
      this.refused = error instanceof Error ? error.message : String(error)
    }
    this.flushed = true
  }
}

export interface RecordingRig {
  store: Store
  orchestrator: Orchestrator
  transcribe: TailingTranscribe
  records: DiagInput[]
  meetingId: string
  /** Segments in the log that only the flush could have written. */
  tails: () => number
}

/**
 * A store, an orchestrator holding open devices, and a meeting in `recording`.
 *
 * `store` is the caller's to close. `onEnded: false` is the shape the older
 * fixtures had and is kept as a *control*, never as the default.
 */
export const recordingRig = async (
  options: {
    onEnded?: boolean
    delayMs?: number
    meetingId?: string
    /** Installed before the meeting starts — `watchPower`, for instance. */
    install?: (orchestrator: Orchestrator, store: Store, records: DiagInput[]) => void
  } = {},
): Promise<RecordingRig> => {
  const store = openMemoryStore()
  const records: DiagInput[] = []
  const capture = new FakeCapture()
  const transcribe = new TailingTranscribe(options.delayMs ?? 5)
  const orchestrator = new Orchestrator(store, {
    diagnostics: { record: (input) => records.push(input) },
    recording: {
      createCapture: () => capture as never,
      createTranscribe: () => transcribe as never,
    },
    recordingOptionsFor: () => ({
      transcribe: { providerId: 'azure-fr', apiKey: 'k', language: 'fr-FR' },
    }),
    ...(options.onEnded === false ? {} : { onEnded: async () => {} }),
  })

  options.install?.(orchestrator, store, records)

  const meetingId = options.meetingId ?? 'm-neovia-cadrage'
  orchestrator.create({ id: meetingId, title: 'Néovia — cadrage', context: null })
  assert.equal(orchestrator.dispatch(meetingId, 'start', 'le commercial a démarré').ok, true)

  // `#openDevices` is fired and not awaited by `dispatch`, so this waits the way
  // the rep's next second does — and then asserts they opened, because a fixture
  // that holds no `Recording` cannot exercise a flush at all.
  for (let tick = 0; tick < 200 && !orchestrator.recording(); tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.equal(orchestrator.recording(), true, 'the devices never opened in this fixture')

  return {
    store,
    orchestrator,
    transcribe,
    records,
    meetingId,
    tails: () =>
      store.projections.segments(meetingId).filter((segment) => segment.id === TAIL_ID).length,
  }
}

/**
 * **`main.ts`'s `before-quit`, in the shape it has there.**
 *
 * Both predicates — a meeting still `recording`, *and* a flush already in flight,
 * which is the one `PowerWatch` leaves behind — then the `dispatch` +
 * `await stopRecording` loop, then the bounded wait for whatever somebody else
 * started. Modelled rather than booted; booting it is `scripts/e2e.mjs`'s job.
 *
 * It is one function shared by both suites deliberately. `powerWatch.test.ts` had
 * its own three-line version that stopped at the dispatch and asserted the quit
 * path « finds nothing » — which is R32-1 written down as the expectation — and a
 * second copy is how the two drift apart again.
 */
export const quitPath = async (
  orchestrator: Pick<
    Orchestrator,
    'liveIds' | 'stateOf' | 'flushing' | 'dispatch' | 'stopRecording' | 'settleRecordings'
  >,
): Promise<{ deferred: boolean; ended: string[]; settled: boolean }> => {
  const recording = orchestrator
    .liveIds()
    .filter((meetingId) => orchestrator.stateOf(meetingId) === 'recording')
  const deferred = recording.length > 0 || orchestrator.flushing()
  for (const meetingId of recording) {
    orchestrator.dispatch(meetingId, 'end', 'fermeture de l’application')
    // `void`, like the handler: the flush is memoised, so the bounded
    // `settleRecordings()` below waits for it once rather than awaiting each
    // provider's own thirty-second budget in turn.
    void orchestrator.stopRecording(meetingId).catch(() => {})
  }
  const settled = deferred ? await orchestrator.settleRecordings() : true
  return { deferred, ended: recording, settled }
}
