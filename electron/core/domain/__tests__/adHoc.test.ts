import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AD_HOC_DWELL_MS,
  AD_HOC_NOMINAL_MS,
  AD_HOC_POLL_MS,
  adHocContext,
  adHocMeetingId,
  adHocTitle,
  decideAdHoc,
} from '../adHoc.ts'

const T0 = Date.UTC(2026, 8, 11, 11, 5, 0)

const input = (over: Partial<Parameters<typeof decideAdHoc>[0]> = {}) => ({
  micHeldBy: 'Teams',
  now: T0,
  heldSince: T0,
  meetingLive: false,
  spent: false,
  calendarOffersAt: null,
  ...over,
})

test('nothing holding a microphone offers nothing', () => {
  const decision = decideAdHoc(input({ micHeldBy: null }))
  assert.equal(decision.action, 'none')
})

test('a hold shorter than the dwell waits, and re-asks at the poll interval', () => {
  // The blips this exists to refuse: a Slack voice message, a dictation, Teams'
  // own « test your microphone ». None of them survives twenty-five seconds.
  const decision = decideAdHoc(input({ now: T0 + 3_000 }))
  assert.equal(decision.action, 'wait')
  assert.equal(decision.action === 'wait' && decision.untilMs, T0 + 3_000 + AD_HOC_POLL_MS)
})

test('the horizon never overshoots the instant the hold becomes ripe', () => {
  // One second short of the dwell must not sleep a further five seconds: that
  // would make the offer late by the difference, every time.
  const now = T0 + AD_HOC_DWELL_MS - 1_000
  const decision = decideAdHoc(input({ now }))
  assert.equal(decision.action === 'wait' && decision.untilMs, T0 + AD_HOC_DWELL_MS)
})

test('a hold that survives the dwell is offered, by name', () => {
  const decision = decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS }))
  assert.equal(decision.action, 'offer')
  assert.equal(decision.action === 'offer' && decision.app, 'Teams')
})

test('the dwell boundary is inclusive, so the offer cannot be one poll late', () => {
  assert.equal(decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS - 1 })).action, 'wait')
  assert.equal(decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS })).action, 'offer')
})

test('anything already armed or recording wins outright', () => {
  /*
   * One conversation, one offer. Round 24 drove three paths through a
   * hard-coded `calendarArmed: false`: a calendar call being recorded that ran
   * past its slot, a rep who had pressed « Démarrer une réunion », and a
   * one-poll microphone drop during an ad-hoc recording. Each armed a second
   * meeting over a live one and fired « La réunion commence » mid-call.
   */
  const decision = decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS, meetingLive: true }))
  assert.equal(decision.action, 'none')
  assert.match(decision.reason, /déjà en cours ou proposée/)
})

test('and it is re-asked, so the call after the live one is still offered', () => {
  // Parking here would mean a rep who ends one call and takes another
  // immediately gets no offer for the second.
  const blocked = decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS, meetingLive: true }))
  assert.equal(blocked.action, 'none')
  assert.ok(blocked.untilMs > T0 + AD_HOC_DWELL_MS, 'a horizon, not a park')
  const freed = decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS, meetingLive: false }))
  assert.equal(freed.action, 'offer')
})

test('one offer per hold — a dismissed offer is not re-offered on every poll', () => {
  const decision = decideAdHoc(input({ now: T0 + AD_HOC_DWELL_MS, spent: true }))
  assert.equal(decision.action, 'none')
})

test('a hold with no start instant is aged from now, never offered immediately', () => {
  // The conservative reading: it delays by one dwell and can never bring the
  // offer forward.
  const decision = decideAdHoc(input({ heldSince: null }))
  assert.equal(decision.action, 'wait')
  assert.equal(decision.action === 'wait' && decision.untilMs, T0 + AD_HOC_POLL_MS)
})

test('the offer is bounded by evidence, not by a clock: losing the hold ends it', () => {
  // Same instant, same everything, microphone gone.
  const ripe = input({ now: T0 + AD_HOC_DWELL_MS })
  assert.equal(decideAdHoc(ripe).action, 'offer')
  assert.equal(decideAdHoc({ ...ripe, micHeldBy: null }).action, 'none')
})

test('one continuous hold is one meeting id, and two holds are two', () => {
  assert.equal(adHocMeetingId(T0), adHocMeetingId(T0))
  assert.notEqual(adHocMeetingId(T0), adHocMeetingId(T0 + 1))
  // The property `meetingIdFor` exists for on the calendar side: `create()` on
  // an id that already exists would append a second `meeting.created` and the
  // rep would find two rows for one conversation.
  assert.match(adHocMeetingId(T0), /^adhoc-[0-9a-z]+$/)
})

test('the synthesised context claims nothing it does not know (DEC-7)', () => {
  const context = adHocContext('Teams', T0)
  assert.equal(context.eventId, null)
  assert.deepEqual(context.attendees, [])
  assert.equal(context.agenda, '')
  assert.equal(context.organizer.name, '')
  assert.equal(context.organizer.email, '')
  assert.equal(context.onlineMeetingJoinUrl, null)
  assert.equal(context.seriesMasterId, null)
  assert.deepEqual(context.categories, [])
})

test('the context bounds the session rather than predicting its end', () => {
  const context = adHocContext('Zoom', T0)
  assert.equal(context.scheduledStart, T0)
  assert.equal(context.scheduledEnd, T0 + AD_HOC_NOMINAL_MS)
  assert.ok(context.scheduledEnd > context.scheduledStart)
})

test('the title names the application, because it is the only thing known', () => {
  assert.equal(adHocTitle('Teams'), 'Appel non planifié — Teams')
  assert.equal(adHocContext('Aircall', T0).subject, 'Appel non planifié — Aircall')
})

test('a browser call is titled like the others, not like a process or a sentence', () => {
  /*
   * Two things this must not be. Not « Appel non planifié — chrome.exe », which
   * is a process name in the client's record; and not « Appel non planifié — un
   * appel dans le navigateur », which was the first draft and says « appel »
   * twice. `MEETING_APPS` labels the row « Navigateur » so that the same string
   * works as a title here and as a reason in `decideArming`.
   */
  assert.equal(adHocTitle('Navigateur'), 'Appel non planifié — Navigateur')
})
