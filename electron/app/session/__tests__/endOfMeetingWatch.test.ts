/**
 * DEC-16's countdown, driven by a fake clock.
 *
 * The failure being designed against is not a session that runs thirty seconds
 * long — it is one that ends while somebody is still talking, because
 * everything after the cut is gone and the rep only finds out when the
 * compte-rendu is missing the next steps. So most of these are about *not*
 * ending.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SILENCE_GRACE_MS, SILENCE_GRACE_PAST_END_MS } from '../../../core/domain/endOfMeeting.ts'
import { EndOfMeetingWatch } from '../EndOfMeetingWatch.ts'

/**
 * A clock and a timer queue that move only when a test says so. `advance`
 * fires every timer whose deadline has passed, in order, so a countdown that
 * re-arms itself is followed rather than dropped.
 */
const harness = (scheduledEnd: number | null = null, start = 1_000_000) => {
  let now = start
  const ends: string[] = []
  let pending: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1

  const watch = new EndOfMeetingWatch({
    scheduledEnd,
    onEnd: (reason) => ends.push(reason),
    clock: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++
      pending.push({ at: now + ms, fn, id })
      return id
    },
    clearTimer: (handle) => {
      pending = pending.filter((t) => t.id !== handle)
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

  return { watch, ends, advance, pendingCount: () => pending.length }
}

test('a long pause in a call is a pause, not an ending', () => {
  const h = harness()
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS - 1_000)
  assert.deepEqual(h.ends, [])
})

test('silence past the grace window ends the meeting', () => {
  const h = harness()
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS + 1)
  assert.equal(h.ends.length, 1)
  assert.match(h.ends[0] ?? '', /silence/)
})

test('audio resuming cancels the countdown silently', () => {
  const h = harness()
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS - 5_000)
  h.watch.speechStarted('far')
  h.advance(SILENCE_GRACE_MS * 2)
  assert.deepEqual(h.ends, [], 'nothing ended')
  assert.equal(h.watch.silentSince, null)
})

test('a resumed meeting can still end later, on a fresh full window', () => {
  const h = harness()
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS - 5_000)
  h.watch.speechStarted('far')
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS - 1_000)
  assert.deepEqual(h.ends, [], 'the window restarted rather than resuming')
  h.advance(2_000)
  assert.equal(h.ends.length, 1)
})

test('one channel falling quiet is not silence — the other is still talking', () => {
  const h = harness()
  h.watch.speechStarted('rep')
  h.watch.speechStarted('far')
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS * 2)
  assert.deepEqual(h.ends, [], 'the rep was still speaking')
})

test('a two-sided pause does not restart the clock when the second channel drops', () => {
  const h = harness()
  h.watch.speechStarted('rep')
  h.watch.speechStarted('far')
  h.watch.speechEnded('far')
  h.watch.speechEnded('rep')
  // Both quiet from here. A restart on the second `speechEnded` would push the
  // deadline out by however long the two were apart, every single time.
  h.advance(SILENCE_GRACE_MS + 1)
  assert.equal(h.ends.length, 1)
})

test('past the scheduled end the same silence means something different', () => {
  // The calendar already said this was over, so the burden of proof flips.
  const start = 1_000_000
  const h = harness(start - 1, start)
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_PAST_END_MS + 1)
  assert.equal(h.ends.length, 1)
})

test('a meeting that fell silent before its scheduled end keeps the full window', () => {
  // Deciding on `now` rather than on when the silence started would cut this
  // meeting off the instant the end time passed, mid-pause, room still full.
  const start = 1_000_000
  const h = harness(start + 5_000, start)
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_PAST_END_MS + 10_000)
  assert.deepEqual(h.ends, [])
  h.advance(SILENCE_GRACE_MS)
  assert.equal(h.ends.length, 1)
})

/*
 * « Terminer short-circuits everything » went with `manual()`, which no caller
 * could have had: pressing *Terminer* goes through the state machine, and
 * `Orchestrator.stopRecording` calls `stop()` on this watch as its second line.
 * The test proved the method did what it said; nothing asked whether anything
 * could say it.
 */

test('a meeting ends exactly once, however many edges arrive afterwards', () => {
  const h = harness()
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS + 1)
  h.watch.speechStarted('far')
  h.watch.speechEnded('far')
  h.advance(SILENCE_GRACE_MS * 3)
  // The route that *is* reachable: the orchestrator stopping the watch.
  h.watch.stop()
  assert.equal(h.ends.length, 1)
})

test('stopping leaves no timer behind to fire into a finished meeting', () => {
  const h = harness()
  h.watch.speechEnded('far')
  h.watch.stop()
  h.advance(SILENCE_GRACE_MS * 2)
  assert.deepEqual(h.ends, [])
  assert.equal(h.pendingCount(), 0)
})

test('a laptop that slept through the window ends on waking, not one window later', () => {
  const h = harness()
  h.watch.speechEnded('far')
  // The timer fires long after its deadline. Re-asking the rule turns that into
  // an end; trusting the timer to have slept exactly the grace would too, but
  // re-asking is what makes a *missed* wake-up still end.
  h.advance(SILENCE_GRACE_MS * 4)
  assert.equal(h.ends.length, 1)
})

test.describe('hold and release (session:pause)', () => {
  test('a held watch does not end a silent call, and a released one counts from now', () => {
    let now = 1_000_000
    const timers: Array<{ fn: () => void; at: number }> = []
    const ended: string[] = []
    const watch = new EndOfMeetingWatch({
      scheduledEnd: null,
      onEnd: (reason) => ended.push(reason),
      clock: () => now,
      setTimer: (fn, ms) => {
        const handle = { fn, at: now + ms }
        timers.push(handle)
        return handle
      },
      clearTimer: (handle) => {
        const index = timers.indexOf(handle as never)
        if (index >= 0) timers.splice(index, 1)
      },
    })
    const fire = (untilMs: number) => {
      now = untilMs
      for (const timer of timers.splice(0)) if (timer.at <= now) timer.fn()
    }

    watch.speechStarted('rep')
    watch.speechEnded('rep')
    assert.ok(timers.length > 0)
    const deadline = timers[0]!.at

    watch.hold()
    assert.equal(watch.held, true)
    assert.equal(timers.length, 0)
    fire(deadline + 60 * 60_000)
    assert.deepEqual(ended, [])

    watch.release()
    assert.equal(watch.held, false)
    assert.equal(watch.silentSince, now)
    assert.ok(timers.length > 0)
    assert.ok(timers[0]!.at > now)
  })

  test('releasing while someone speaks forgets the silence', () => {
    const watch = new EndOfMeetingWatch({ scheduledEnd: null, onEnd: () => undefined })
    watch.speechEnded('far')
    watch.hold()
    watch.speechStarted('rep')
    watch.release()
    assert.equal(watch.silentSince, null)
    watch.stop()
  })
})
