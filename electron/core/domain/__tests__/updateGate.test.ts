import test from 'node:test'
import assert from 'node:assert/strict'
import { UPDATE_BLOCKING_STATES, updateReadiness } from '../updateGate.ts'
import { MeetingStateSchema, type MeetingState } from '../../contracts/meeting.ts'

const ALL_STATES = MeetingStateSchema.options as readonly MeetingState[]

test('an app between meetings may install', () => {
  assert.deepEqual(updateReadiness([]), { safe: true, reason: null })
  assert.deepEqual(updateReadiness(['idle']), { safe: true, reason: null })
  assert.deepEqual(updateReadiness(['done', 'aborted', 'idle']), { safe: true, reason: null })
})

test('a recording meeting blocks the install', () => {
  const readiness = updateReadiness(['recording'])
  assert.equal(readiness.safe, false)
  assert.match(readiness.reason ?? '', /enregistrement/)
})

/*
 * The regression this file exists for. Every one of these was a state where an
 * "is a meeting running?" check written as `state === 'recording'` would have
 * said yes, install — and destroyed something.
 */
test('every state with work in flight blocks the install', () => {
  for (const state of ['armed', 'ended', 'extracting', 'awaiting_confirmation', 'pushing'] as const) {
    const readiness = updateReadiness([state])
    assert.equal(readiness.safe, false, `${state} must block`)
    assert.ok(readiness.reason, `${state} must say why`)
  }
})

test('a terminal session alongside a live one still blocks', () => {
  // The order matters: the safe state comes first, so a loop that returned on
  // its first *safe* match instead of its first blocking one would pass wrongly.
  const readiness = updateReadiness(['done', 'recording'])
  assert.equal(readiness.safe, false)
})

test('every declared state is either safe or gives a French reason', () => {
  for (const state of ALL_STATES) {
    const readiness = updateReadiness([state])
    if (readiness.safe) {
      assert.equal(readiness.reason, null, `${state} is safe and must carry no reason`)
    } else {
      assert.ok(
        (readiness.reason ?? '').length > 0,
        `${state} blocks and must name what it would destroy`,
      )
    }
  }
})

/*
 * Pins the decision rather than the implementation: if someone adds a state to
 * MeetingStateSchema and does not decide its update behaviour, it silently
 * defaults to safe. This is the test that notices.
 */
test('the blocking set is exactly the states that hold unfinished work', () => {
  assert.deepEqual(
    [...UPDATE_BLOCKING_STATES].sort(),
    ['armed', 'awaiting_confirmation', 'ended', 'extracting', 'pushing', 'recording'],
  )
  const safe = ALL_STATES.filter((state) => !UPDATE_BLOCKING_STATES.includes(state))
  assert.deepEqual([...safe].sort(), ['aborted', 'done', 'idle'])
})
