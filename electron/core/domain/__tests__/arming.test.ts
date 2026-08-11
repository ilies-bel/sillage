import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARM_LEAD_MS,
  MAX_ARMABLE_DURATION_MS,
  decideArming,
  nextArmable,
  type ArmableEvent,
} from '../arming.ts'
import {
  SILENCE_GRACE_MS,
  SILENCE_GRACE_PAST_END_MS,
  decideEndOfMeeting,
} from '../endOfMeeting.ts'
import type { CalendarEvent } from '../../contracts/calendar.ts'
import type { MeetingContext } from '../../contracts/meeting.ts'

const T0 = 1_800_000_000_000

const attendee = (name: string) => ({
  name,
  email: `${name.toLowerCase()}@client.fr`,
  type: 'required' as const,
  response: 'accepted' as const,
})

const event = (over: Partial<ArmableEvent> = {}): ArmableEvent => ({
  sensitivity: 'normal',
  scheduledStart: T0,
  scheduledEnd: T0 + 3_600_000,
  attendees: [attendee('Zaiou')],
  onlineMeetingJoinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
  ...over,
})

// ── decideArming ───────────────────────────────────────────────────────────

test('both signals are required, and time alone is not enough', () => {
  const inside = T0 - 60_000
  assert.equal(decideArming({ event: event(), now: inside, meetingAudio: null }).action, 'wait')
  assert.equal(decideArming({ event: event(), now: inside, meetingAudio: 'Teams' }).action, 'arm')
})

test('audio alone before the window opens does not arm', () => {
  // A YouTube tab at 09:00 is not the 14:00 client call.
  const decision = decideArming({ event: event(), now: T0 - 60 * 60_000, meetingAudio: 'Teams' })
  assert.equal(decision.action, 'wait')
  if (decision.action !== 'wait') return
  assert.equal(decision.untilMs, T0 - ARM_LEAD_MS, 'the horizon is the instant the window opens')
})

test('the window opens exactly five minutes ahead', () => {
  const opensAt = T0 - ARM_LEAD_MS
  assert.equal(decideArming({ event: event(), now: opensAt - 1, meetingAudio: 'Teams' }).action, 'wait')
  assert.equal(decideArming({ event: event(), now: opensAt, meetingAudio: 'Teams' }).action, 'arm')
})

test('a meeting that started late still arms', () => {
  // Running twenty minutes behind is normal and the rep needs the offer then
  // most of all.
  const decision = decideArming({ event: event(), now: T0 + 20 * 60_000, meetingAudio: 'Teams' })
  assert.equal(decision.action, 'arm')
})

test('a meeting that is over is skipped, audio or not', () => {
  const now = T0 + 3_600_000
  assert.equal(decideArming({ event: event(), now, meetingAudio: 'Teams' }).action, 'skip')
})

test('a private event is never armed on', () => {
  for (const sensitivity of ['private', 'confidential'] as const) {
    const decision = decideArming({ event: event({ sensitivity }), now: T0, meetingAudio: 'Teams' })
    assert.equal(decision.action, 'skip', sensitivity)
  }
  // …and the two Outlook does not treat as an instruction still arm.
  assert.equal(decideArming({ event: event({ sensitivity: 'personal' }), now: T0, meetingAudio: 'Teams' }).action, 'arm')
})

test('a block with nobody in it and nowhere to join is not a meeting', () => {
  const solo = event({ attendees: [], onlineMeetingJoinUrl: null })
  assert.equal(decideArming({ event: solo, now: T0, meetingAudio: 'Teams' }).action, 'skip')

  // A join link on its own is enough: an ad-hoc Teams call has no attendee list.
  const linkOnly = event({ attendees: [] })
  assert.equal(decideArming({ event: linkOnly, now: T0, meetingAudio: 'Teams' }).action, 'arm')
})

test('an all-day-sized block cannot arm', () => {
  // The failure this prevents: a window that opens at 23:55 and stays open for
  // a day, so any conferencing audio at all arms against the wrong event.
  const allDay = event({ scheduledEnd: T0 + MAX_ARMABLE_DURATION_MS + 1 })
  assert.equal(decideArming({ event: allDay, now: T0, meetingAudio: 'Teams' }).action, 'skip')
})

test('waiting for audio inside the window looks no further than the event', () => {
  const decision = decideArming({ event: event(), now: T0, meetingAudio: null })
  assert.equal(decision.action, 'wait')
  if (decision.action !== 'wait') return
  assert.equal(decision.untilMs, T0 + 3_600_000)
})

// ── nextArmable ────────────────────────────────────────────────────────────

const calendarEvent = (id: string, over: Partial<MeetingContext> = {}, flags: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  isCancelled: false,
  isAllDay: false,
  lastModified: 0,
  context: {
    eventId: id,
    subject: id,
    agenda: '',
    organizer: attendee('Fontaine'),
    attendees: [attendee('Zaiou')],
    onlineMeetingJoinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
    categories: [],
    sensitivity: 'normal',
    scheduledStart: T0,
    scheduledEnd: T0 + 3_600_000,
    seriesMasterId: null,
    timeZone: 'Europe/Paris',
    ...over,
  },
  ...flags,
})

test('when two calls overlap, the one already under way wins', () => {
  const early = calendarEvent('early')
  const late = calendarEvent('late', { scheduledStart: T0 + 30 * 60_000, scheduledEnd: T0 + 90 * 60_000 })
  const choice = nextArmable([late, early], T0 + 60_000, 'Teams')
  assert.equal(choice.event?.id, 'early')
})

test('cancelled and all-day entries stay in the window but never arm', () => {
  const events = [
    calendarEvent('cancelled', {}, { isCancelled: true }),
    calendarEvent('allday', {}, { isAllDay: true }),
  ]
  const choice = nextArmable(events, T0, 'Teams')
  assert.equal(choice.event, null)
  assert.equal(choice.decision.action, 'skip')
})

test('with nothing armable, the earliest horizon is the one returned', () => {
  const soon = calendarEvent('soon', { scheduledStart: T0 + 60 * 60_000, scheduledEnd: T0 + 120 * 60_000 })
  const later = calendarEvent('later', { scheduledStart: T0 + 300 * 60_000, scheduledEnd: T0 + 360 * 60_000 })
  const choice = nextArmable([later, soon], T0, null)
  assert.equal(choice.decision.action, 'wait')
  if (choice.decision.action !== 'wait') return
  // Waking at `later`'s horizon would sleep through `soon` entirely.
  assert.equal(choice.decision.untilMs, T0 + 60 * 60_000 - ARM_LEAD_MS)
})

test('an empty day says so rather than pretending to wait', () => {
  assert.deepEqual(nextArmable([], T0, 'Teams'), {
    event: null,
    decision: { action: 'skip', reason: 'aucune réunion dans la fenêtre' },
  })
})

// ── endOfMeeting ───────────────────────────────────────────────────────────

test('audio still flowing is never an ending', () => {
  const decision = decideEndOfMeeting({ now: T0, silentSince: null, scheduledEnd: T0 - 60_000, manual: false })
  assert.equal(decision.action, 'continue')
})

test('a long pause mid-call is a pause', () => {
  const silentSince = T0
  const decision = decideEndOfMeeting({ now: silentSince + SILENCE_GRACE_MS - 1, silentSince, scheduledEnd: T0 + 600_000, manual: false })
  assert.equal(decision.action, 'wait')
  if (decision.action !== 'wait') return
  assert.equal(decision.untilMs, silentSince + SILENCE_GRACE_MS)
})

test('silence past the full grace ends the meeting', () => {
  const silentSince = T0
  const decision = decideEndOfMeeting({ now: silentSince + SILENCE_GRACE_MS, silentSince, scheduledEnd: T0 + 600_000, manual: false })
  assert.equal(decision.action, 'end')
})

test('past the scheduled end, the same silence is decided sooner', () => {
  const scheduledEnd = T0
  const silentSince = T0 + 5_000
  const decision = decideEndOfMeeting({ now: silentSince + SILENCE_GRACE_PAST_END_MS, silentSince, scheduledEnd, manual: false })
  assert.equal(decision.action, 'end')
})

test('the short grace is chosen by when the silence started, not by the clock', () => {
  // Silence begins before the scheduled end and holds across it. Deciding on
  // `now` would cut the meeting the instant the end time passed, mid-pause.
  const scheduledEnd = T0
  const silentSince = T0 - 10_000
  const decision = decideEndOfMeeting({ now: T0 + 1_000, silentSince, scheduledEnd, manual: false })
  assert.equal(decision.action, 'wait')
  if (decision.action !== 'wait') return
  assert.equal(decision.untilMs, silentSince + SILENCE_GRACE_MS)
})

test('a session with no calendar entry always gets the full grace', () => {
  const silentSince = T0
  const decision = decideEndOfMeeting({ now: silentSince + SILENCE_GRACE_PAST_END_MS, silentSince, scheduledEnd: null, manual: false })
  assert.equal(decision.action, 'wait')
})

test('Terminer short-circuits everything', () => {
  const decision = decideEndOfMeeting({ now: T0, silentSince: null, scheduledEnd: T0 + 3_600_000, manual: true })
  assert.equal(decision.action, 'end')
})
