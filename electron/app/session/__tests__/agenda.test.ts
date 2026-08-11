import test from 'node:test'
import assert from 'node:assert/strict'
import { Agenda, SYNC_INTERVAL_MS, meetingIdFor } from '../Agenda.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { ARM_LEAD_MS } from '../../../core/domain/arming.ts'
import type { CalendarEvent, CalendarPort, CalendarWindow } from '../../../core/contracts/calendar.ts'
import type { ConnectorHealth } from '../../../core/contracts/health.ts'
import type { MeetingContext } from '../../../core/contracts/meeting.ts'

const T0 = Date.parse('2026-08-05T12:00:00Z')

const attendee = (name: string) => ({
  name,
  email: `${name.toLowerCase()}@client.fr`,
  type: 'required' as const,
  response: 'accepted' as const,
})

const event = (id: string, over: Partial<MeetingContext> = {}, flags: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  isCancelled: false,
  isAllDay: false,
  lastModified: 0,
  context: {
    eventId: id,
    subject: 'Point Aura',
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

class FakeCalendar implements CalendarPort {
  syncs = 0
  failWith: unknown = null
  #window: CalendarWindow

  constructor(events: CalendarEvent[]) {
    this.#window = { cursor: 'c', syncedAt: 0, from: T0 - 86_400_000, to: T0 + 604_800_000, events }
  }

  window(): CalendarWindow {
    return this.#window
  }

  async sync(now?: number): Promise<CalendarWindow> {
    this.syncs++
    if (this.failWith) throw this.failWith
    this.#window = { ...this.#window, syncedAt: now ?? 0 }
    return this.#window
  }
}

const harness = (events: CalendarEvent[], meetingAudio: string | null = 'Teams') => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store)
  const calendar = new FakeCalendar(events)
  const health: ConnectorHealth[] = []
  const snapshots: ReturnType<Agenda['snapshot']>[] = []
  let audio = meetingAudio

  const agenda = new Agenda({
    calendar,
    orchestrator,
    meetingAudio: () => audio,
    clock: () => T0,
    onHealth: (h) => void health.push(h),
    onChanged: (s) => void snapshots.push(s),
  })

  return {
    agenda,
    calendar,
    orchestrator,
    store,
    health,
    snapshots,
    setAudio: (value: string | null) => void (audio = value),
  }
}

test('a calendar event plus a running meeting app arms a session', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })

  const meetingId = meetingIdFor('AAA')
  assert.equal(h.agenda.snapshot().armed?.meetingId, meetingId)
  assert.equal(h.orchestrator.stateOf(meetingId), 'armed')
  h.store.close()
})

test('armed is an offer — nothing starts recording on its own', () => {
  // HR-7. The state machine stops at `armed`; a human presses Démarrer.
  const h = harness([event('AAA')])
  return h.agenda.tick({ now: T0 - 60_000 }).then(() => {
    assert.notEqual(h.orchestrator.stateOf(meetingIdFor('AAA')), 'recording')
    h.store.close()
  })
})

test('no meeting app running means no arming, however close the meeting is', async () => {
  const h = harness([event('AAA')], null)
  await h.agenda.tick({ now: T0 - 60_000 })
  assert.equal(h.agenda.snapshot().armed, null)
  assert.equal(h.orchestrator.stateOf(meetingIdFor('AAA')), 'idle')
  h.store.close()
})

test('the same event armed twice is one meeting, not two', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  await h.agenda.tick({ now: T0 - 30_000 })
  // A second `meeting.created` for one conversation would show the rep two rows.
  assert.equal(h.store.projections.listMeetings(10).length, 1)
  h.store.close()
})

test('a restart re-arms the meeting it already created', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })

  // Same store, a fresh orchestrator and agenda: the process restarted.
  const orchestrator = new Orchestrator(h.store)
  const restarted = new Agenda({
    calendar: h.calendar,
    orchestrator,
    meetingAudio: () => 'Teams',
    clock: () => T0,
  })
  await restarted.tick({ now: T0 - 30_000 })

  assert.equal(h.store.projections.listMeetings(10).length, 1)
  assert.equal(orchestrator.stateOf(meetingIdFor('AAA')), 'armed')
  h.store.close()
})

test('the offer disappears when the meeting is over', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  assert.ok(h.agenda.snapshot().armed)

  await h.agenda.tick({ now: T0 + 3_600_001 })
  // Leaving it on screen would put Démarrer on a finished conversation.
  assert.equal(h.agenda.snapshot().armed, null)
  h.store.close()
})

test('the next wake-up is the instant the window opens, not a fixed interval', async () => {
  const h = harness([event('AAA')], null)
  const wakeAt = await h.agenda.tick({ now: T0 - 2 * 60 * 60_000 })
  assert.equal(wakeAt, T0 - ARM_LEAD_MS)
  h.store.close()
})

test('an empty day still schedules a re-check', async () => {
  const h = harness([])
  const wakeAt = await h.agenda.tick({ now: T0 })
  assert.equal(wakeAt, T0 + SYNC_INTERVAL_MS)
  h.store.close()
})

test('a fresh calendar is not re-fetched on every tick', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  await h.agenda.tick({ now: T0 - 59_000 })
  assert.equal(h.calendar.syncs, 1)

  await h.agenda.tick({ now: T0 - 60_000 + SYNC_INTERVAL_MS })
  assert.equal(h.calendar.syncs, 2)
  h.store.close()
})

test('a forced refresh syncs even when the fold is fresh', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  await h.agenda.tick({ now: T0 - 59_000, force: true })
  assert.equal(h.calendar.syncs, 2)
  h.store.close()
})

test('a calendar that will not sync keeps the last fold armable', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 10 * 60_000 })
  assert.equal(h.agenda.snapshot().armed, null, 'too early to arm yet')

  h.calendar.failWith = new Error('réseau indisponible')
  await h.agenda.tick({ now: T0 - 60_000 })

  // DEC-26: a calendar that cannot be refreshed is not a calendar that is gone.
  assert.equal(h.agenda.snapshot().armed?.eventId, 'AAA')
  assert.equal(h.health.at(-1)?.state, 'down')
  h.store.close()
})

test('every tick publishes a snapshot, so the renderer never polls', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  await h.agenda.tick({ now: T0 + 3_600_001 })
  assert.equal(h.snapshots.length, 2)
  assert.equal(h.snapshots[0]?.armed?.eventId, 'AAA')
  assert.equal(h.snapshots[1]?.armed, null)
  assert.ok(h.snapshots[1]?.reason.length)
  h.store.close()
})

test('a meeting id is derived from the event, and is not the event id', async () => {
  // Restart-safe by construction; hashed because a Graph event id is a
  // 152-character blob that ends up in file names and logs.
  assert.equal(meetingIdFor('AAA'), meetingIdFor('AAA'))
  assert.notEqual(meetingIdFor('AAA'), meetingIdFor('BBB'))
  assert.match(meetingIdFor('AAA'), /^evt-[0-9a-f]{16}$/)
})
