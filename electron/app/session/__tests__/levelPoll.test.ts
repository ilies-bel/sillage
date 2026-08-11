/**
 * The level meter's poll — the one timer on the recording path.
 *
 * Three things have to hold, and none of them are visible from the meter
 * itself: it does not run when nobody is drawing one, it stops when the meeting
 * does, and it never holds the process open. The last two are the reason this
 * is a pull on a timer rather than an event per frame — a leaked interval in
 * the main process outlives the meeting that created it, and an Electron app
 * that will not quit is a bug a rep reports as "it froze".
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Recording } from '../Recording.ts'
import type { Channel } from '../../../core/contracts/transcript.ts'

class FakeCapture extends EventEmitter {
  pending: Record<Channel, number> = { rep: 0, far: 0 }
  reads = 0

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  takeLevels(): Record<Channel, number> {
    this.reads++
    const levels = this.pending
    this.pending = { rep: 0, far: 0 }
    return levels
  }
}

class FakeTranscribe extends EventEmitter {
  start(): void {}
  async stop(): Promise<void> {}
  write(): void {}
  speechEnded(): void {}
}

const start = async (
  capture: EventEmitter,
  deps: { onLevel?: (levels: Record<Channel, number>) => void } = {},
): Promise<Recording> =>
  Recording.start({ emit() {} } as never, { transcribe: {} as never }, {
    createCapture: () => capture as never,
    createTranscribe: () => new FakeTranscribe() as never,
    ...deps,
  })

test('the meter is sampled ten times a second while the meeting runs', async (t) => {
  mock.timers.enable({ apis: ['setInterval'] })
  t.after(() => mock.timers.reset())

  const capture = new FakeCapture()
  const seen: Array<Record<Channel, number>> = []
  const recording = await start(capture, { onLevel: (levels) => seen.push(levels) })

  capture.pending = { rep: 0.05, far: 0.01 }
  mock.timers.tick(100)
  mock.timers.tick(100)
  mock.timers.tick(100)

  assert.equal(seen.length, 3)
  // The first read drains the peak; the two after it see a channel that has
  // produced nothing since, which is what makes the meter fall back to the
  // baseline in a silence rather than holding a stale maximum.
  assert.deepEqual(seen[0], { rep: 0.05, far: 0.01 })
  assert.deepEqual(seen[1], { rep: 0, far: 0 })

  await recording.stop()
})

test('nothing is polled when nothing is drawing a meter', async (t) => {
  mock.timers.enable({ apis: ['setInterval'] })
  t.after(() => mock.timers.reset())

  // A headless session — no renderer attached — must not pay for a widget that
  // is not on screen.
  const capture = new FakeCapture()
  const recording = await start(capture)

  mock.timers.tick(1_000)

  assert.equal(capture.reads, 0)
  await recording.stop()
})

test('a capture source with no meter to read is not polled either', async (t) => {
  mock.timers.enable({ apis: ['setInterval'] })
  t.after(() => mock.timers.reset())

  // `FileCapture` replays a wav and does not implement `takeLevels`. The poll
  // has to notice that rather than tick a thousand times into an undefined.
  class NoLevels extends EventEmitter {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  }
  let called = 0
  const recording = await start(new NoLevels(), { onLevel: () => called++ })

  mock.timers.tick(1_000)

  assert.equal(called, 0)
  await recording.stop()
})

test('stopping the meeting stops the meter', async (t) => {
  mock.timers.enable({ apis: ['setInterval'] })
  t.after(() => mock.timers.reset())

  const capture = new FakeCapture()
  const recording = await start(capture, { onLevel: () => {} })

  mock.timers.tick(100)
  const before = capture.reads
  await recording.stop()
  mock.timers.tick(1_000)

  assert.equal(capture.reads, before)
})

test('a meter that throws costs its own frame and nothing else', async (t) => {
  mock.timers.enable({ apis: ['setInterval'] })
  t.after(() => mock.timers.reset())

  // DEC-26: nothing downstream may stop a meeting being recorded, and a
  // cosmetic surface is as downstream as it gets.
  const capture = new FakeCapture()
  let calls = 0
  const recording = await start(capture, {
    onLevel: () => {
      calls++
      throw new Error('renderer parti')
    },
  })

  mock.timers.tick(100)
  mock.timers.tick(100)

  assert.equal(calls, 2)
  assert.equal(recording instanceof Recording, true)
  await recording.stop()
})
