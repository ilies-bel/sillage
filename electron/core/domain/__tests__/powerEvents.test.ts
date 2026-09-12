/**
 * **The rule, branch by branch, because each branch is expensive in its own
 * direction.**
 *
 * `suspend` not ending costs the recording — the machine takes the devices with
 * it and the meeting sits in `recording` for ever, which is what US-1 measured on
 * the shipped `EndOfMeetingWatch`: a rep talking when the lid shuts arms **0**
 * timers, and sixty minutes of fake clock later the log still says `recording`.
 * `lock-screen` ending costs the *call*: audio keeps flowing on both platforms
 * while the screen is locked, so a rep on a headset would lose a live recording
 * for a gesture that costs nothing.
 *
 * So every event is asserted by name, and the two lists are asserted whole
 * rather than one membership at a time — a new event added to `POWER_EVENTS`
 * lands in one of them and fails here until somebody has decided which. The
 * union is derived from that tuple, so `tsc` holds the other direction: a branch
 * cannot be added to the type without being added to the list, and
 * `decidePowerEvent`'s switch cannot be left without a case for it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  POWER_EVENTS,
  decidePowerEvent,
  sleepInterruptedNotice,
  type PowerEvent,
} from '../powerEvents.ts'

test('sleeping and shutting down end a recording; nothing else does', () => {
  const ends: PowerEvent[] = []
  const keeps: PowerEvent[] = []
  for (const event of POWER_EVENTS) {
    if (decidePowerEvent(event).action === 'end') ends.push(event)
    else keeps.push(event)
  }

  assert.deepEqual(
    ends,
    ['suspend', 'shutdown'],
    'the machine may never come back — the transition has to be in the log first',
  )
  assert.deepEqual(
    keeps,
    ['resume', 'lock-screen', 'unlock-screen', 'on-battery', 'on-ac'],
    'a locked screen still records, and display sleep is not system sleep',
  )
})

test('`lock-screen` keeps the recording, said on its own so flipping it cannot hide', () => {
  assert.equal(decidePowerEvent('lock-screen').action, 'keep')
  assert.equal(decidePowerEvent('unlock-screen').action, 'keep')
})

test('`resume` restarts nothing', () => {
  /*
   * The rep pressed *Enregistrer*; the app does not press it for them. A resumed
   * capture would be a second recording with a different `startedAt` inside one
   * meeting — and `resume` is not a command the state machine has.
   */
  assert.equal(decidePowerEvent('resume').action, 'keep')
})

test('every event carries a French sentence, and it is the one the log shows', () => {
  for (const event of POWER_EVENTS) {
    const { reason } = decidePowerEvent(event)
    assert.ok(reason.length > 3, `${event} has no sentence`)
    assert.ok(
      !/[a-z]'[a-z]/i.test(reason),
      `${event}'s sentence uses a straight apostrophe — the product writes U+2019`,
    )
  }
  assert.equal(decidePowerEvent('suspend').reason, 'mise en veille de l’ordinateur')
  assert.equal(decidePowerEvent('shutdown').reason, 'arrêt de l’ordinateur')
})

test('the resume notice names the objet, and offers a new recording rather than a resumption', () => {
  const notice = sleepInterruptedNotice('Néovia — cadrage')
  assert.equal(notice.title, 'Néovia — cadrage')
  /*
   * `start` is not legal from `ended` (`MeetingSession`'s table), so « reprendre
   * l’enregistrement » would be a control that cannot exist — the dead control
   * DEC-26 forbids, in a sentence.
   */
  assert.match(notice.body, /nouveau/)
  assert.doesNotMatch(notice.body, /reprendre|relancer l’enregistrement/)

  // A meeting with no objet still gets a title: an OS notification with an empty
  // one is a notification the rep cannot identify.
  assert.equal(sleepInterruptedNotice(null).title, 'Réunion')
  assert.equal(sleepInterruptedNotice('   ').title, 'Réunion')
})
