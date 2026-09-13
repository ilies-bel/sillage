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
  POWER_MONITOR_EVENTS,
  WINDOW_POWER_EVENTS,
  decidePowerEvent,
  sleepInterruptedNotice,
  type PowerEvent,
} from '../powerEvents.ts'

test('sleeping, shutting down and ending the Windows session end a recording; nothing else does', () => {
  const ends: PowerEvent[] = []
  const keeps: PowerEvent[] = []
  for (const event of POWER_EVENTS) {
    if (decidePowerEvent(event).action === 'end') ends.push(event)
    else keeps.push(event)
  }

  assert.deepEqual(
    ends,
    ['suspend', 'shutdown', 'session-end'],
    'the machine may never come back — the transition has to be in the log first',
  )
  assert.deepEqual(
    keeps,
    ['resume', 'lock-screen', 'unlock-screen', 'on-battery', 'on-ac'],
    'a locked screen still records, and display sleep is not system sleep',
  )
})

test('the two tuples are what gets subscribed, and `session-end` is not `powerMonitor`’s', () => {
  /*
   * `PowerWatch` walks each tuple against a different emitter, so a misplaced
   * entry is a subscription with no emitter — it compiles, never fires, and reads
   * as a fix. Windows' `session-end` is declared on `BaseWindow`/`BrowserWindow`
   * (`@platform win32`); Electron 43's `App` has no such event and
   * `powerMonitor`'s `shutdown` is `@platform linux,darwin`, which is why the
   * Windows branch had to exist at all.
   */
  assert.ok(
    !(POWER_MONITOR_EVENTS as readonly string[]).includes('session-end'),
    '`session-end` is a window event — `powerMonitor` will never emit it',
  )
  assert.deepEqual(WINDOW_POWER_EVENTS as readonly string[], ['session-end'])
  // Every decided event is subscribed by exactly one of the two.
  assert.equal(POWER_EVENTS.length, POWER_MONITOR_EVENTS.length + WINDOW_POWER_EVENTS.length)
  for (const event of POWER_EVENTS) {
    const carriers = [POWER_MONITOR_EVENTS, WINDOW_POWER_EVENTS].filter((tuple) =>
      (tuple as readonly string[]).includes(event),
    )
    assert.equal(carriers.length, 1, `\`${event}\` is decided but subscribed ${carriers.length}×`)
  }
})

test('only an end the rep comes back from owes them the resume sentence', () => {
  /*
   * `sleepInterruptedNotice` says « la mise en veille a arrêté l’enregistrement »,
   * which is a **false** statement about a shutdown or a Windows session end —
   * and it is raised on `resume`, which neither of those is followed by in the
   * ordinary case. The field matters when it is *not* the ordinary case: a
   * `session-end` whose shutdown another application then vetoes would leave a
   * meeting waiting in `PowerWatch`'s field for some later sleep to publish it as
   * a stale fact about a call already dealt with.
   */
  const notices = POWER_EVENTS.map((event) => {
    const decision = decidePowerEvent(event)
    return [event, decision.action === 'end' ? decision.notice : 'n/a'] as const
  })
  assert.deepEqual(
    notices.filter(([, notice]) => notice === 'on-resume').map(([event]) => event),
    ['suspend'],
    'the sleep sentence is owed by the sleep, and by nothing else',
  )
  assert.deepEqual(
    notices.filter(([, notice]) => notice === 'none').map(([event]) => event),
    ['shutdown', 'session-end'],
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
  // Its own sentence, because « arrêt de l’ordinateur » and « fermeture de la
  // session » are different facts on the row and in the diagnostics log: a rep
  // who logged off did not turn the machine off.
  assert.equal(decidePowerEvent('session-end').reason, 'fermeture de la session Windows')
})

test('the resume notice names the objet, and offers nothing the product can refuse', () => {
  const notice = sleepInterruptedNotice('Néovia — cadrage')
  assert.equal(notice.title, 'Néovia — cadrage')
  /*
   * `start` is not legal from `ended` (`MeetingSession`'s table), so « reprendre
   * l’enregistrement » would be a control that cannot exist — the dead control
   * DEC-26 forbids, in a sentence.
   */
  assert.doesNotMatch(notice.body, /reprendre|relancer/)
  /*
   * **And « en démarrer un nouveau » was the same defect one verb over** (R33-3).
   * This body is read whenever the rep clears their notification centre, which on
   * a working day is hours after the lid opened and routinely during their next
   * call — and `Orchestrator.dispatch` allows one recording at a time, so
   * *Démarrer une réunion* is refused for the whole of it. A notification cannot
   * be rewritten once shown, so the sentence may not name a control whose
   * availability changes; what it states instead is what happened, which is true
   * at every instant it can be read.
   */
  assert.doesNotMatch(
    notice.body,
    /démarrer|Ouvrir Sillage/,
    'the body offers a control the product refuses while the next call is recording',
  )
  assert.match(notice.body, /veille a arrêté l’enregistrement/)
  assert.match(notice.body, /n’a pas repris/)
  assert.match(notice.body, /conservé/, 'the rep is not told what survived the sleep')

  // A meeting with no objet still gets a title: an OS notification with an empty
  // one is a notification the rep cannot identify.
  assert.equal(sleepInterruptedNotice(null).title, 'Réunion')
  assert.equal(sleepInterruptedNotice('   ').title, 'Réunion')
})
