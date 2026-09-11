import test from 'node:test'
import assert from 'node:assert/strict'
import { Agenda, MAX_SLEEP_MS, SYNC_INTERVAL_MS, meetingIdFor } from '../Agenda.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { ARM_LEAD_MS, ARM_POLL_MS } from '../../../core/domain/arming.ts'
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
  const armed: { meetingId: string; subject: string }[] = []
  let audio = meetingAudio

  const agenda = new Agenda({
    calendar,
    orchestrator,
    meetingAudio: () => audio,
    clock: () => T0,
    onHealth: (h) => void health.push(h),
    onChanged: (s) => void snapshots.push(s),
    onArmed: (a) => void armed.push(a),
  })

  return {
    agenda,
    calendar,
    orchestrator,
    store,
    health,
    snapshots,
    armed,
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


/*
 * ── the announcement (`main.ts`) ────────────────────────────────────────────
 *
 * The agenda knew the 14:30, labelled it « PRÊT » and drew *Enregistrer* — on a
 * window sitting behind Teams, Outlook and a browser, which is where this app
 * lives for the whole of a rep's day. The OS notification is what reaches them,
 * and it hangs off this callback. What has to hold is that it fires on the
 * *edge*: the arming loop ticks every thirty seconds, and a notification per
 * tick would be the app that gets muted on day one.
 */

test('a meeting that arms announces itself exactly once, however many ticks pass', async () => {
  const h = harness([event('AAA')])

  await h.agenda.tick({ now: T0 - 60_000 })
  await h.agenda.tick({ now: T0 - 45_000 })
  await h.agenda.tick({ now: T0 - 30_000 })

  assert.equal(h.armed.length, 1)
  assert.equal(h.armed[0]?.meetingId, meetingIdFor('AAA'))
  // The event's own subject — it is the notification's title, and a rep glancing
  // at a toast has to recognise the call from it.
  assert.equal(h.armed[0]?.subject, event('AAA').context.subject)
  h.store.close()
})

test('a meeting that never arms is never announced', async () => {
  // No conferencing audio: the window is open, nothing is running, and there is
  // nothing to offer. A toast here would be the app interrupting a rep about a
  // call they have not joined.
  const h = harness([event('AAA')], null)
  await h.agenda.tick({ now: T0 - 60_000 })

  assert.deepEqual(h.armed, [])
  h.store.close()
})

test('a listener that throws does not stop the meeting arming', async () => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store)
  const agenda = new Agenda({
    calendar: new FakeCalendar([event('AAA')]),
    orchestrator,
    meetingAudio: () => 'Teams',
    clock: () => T0,
    onArmed: () => {
      throw new Error('pas de service de notification')
    },
  })

  await agenda.tick({ now: T0 - 60_000 })

  // A notification that will not show is not a meeting that will not record
  // (DEC-26).
  assert.equal(orchestrator.stateOf(meetingIdFor('AAA')), 'armed')
  assert.equal(agenda.snapshot().armed?.meetingId, meetingIdFor('AAA'))
  store.close()
})

test('the offer is withdrawn when the rep ends the call inside its own slot', async () => {
  /*
   * **The armed offer used to survive the end of the call.**
   *
   * `#armed` is cleared in `#tick` only when `decideArming` stops returning
   * `arm`, and `decideArming` is pure over the calendar and the audio: it knows
   * nothing about session state, clears on `now >= scheduledEnd` or when the
   * meeting audio goes quiet, and `MeetingApps` reports a *running process* and
   * not a call. The re-arm that follows is refused by the state machine —
   * `ended` does not accept `arm` — and that branch returned without touching
   * `#armed`.
   *
   * So a rep who finished at minute 20 of a 60-minute slot kept, for forty
   * minutes: **Prêt** on a row whose meeting is `awaiting_confirmation`, under
   * the *Passées* divider, wearing the screen's one filled primary reading
   * *Enregistrer* — while `PendingGates` counted the same call and pointed at
   * that row saying « Une autre est dans la liste du jour, au-dessus ».
   */
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })

  const meetingId = meetingIdFor('AAA')
  assert.equal(h.agenda.snapshot().armed?.meetingId, meetingId)

  // The rep records and finishes, well inside the slot. Teams is still running
  // and the calendar still says the meeting is on, so `decideArming` still
  // wants to arm — which is exactly the case this closes.
  h.orchestrator.dispatch(meetingId, 'start', null)
  h.orchestrator.dispatch(meetingId, 'end', null)

  await h.agenda.tick({ now: T0 + 20 * 60_000 })

  assert.equal(h.agenda.snapshot().armed, null, 'l’offre a survécu à la fin de l’appel')
  h.store.close()
})

test('a call still under way keeps its offer — that is the row to show', async () => {
  // `recording` is not a refusal: the offer is what tells the rep which call the
  // app is on, and withdrawing it mid-call would be the opposite defect.
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  const meetingId = meetingIdFor('AAA')
  h.orchestrator.dispatch(meetingId, 'start', null)

  await h.agenda.tick({ now: T0 + 10 * 60_000 })

  assert.equal(h.agenda.snapshot().armed?.meetingId, meetingId)
  h.store.close()
})

/**
 * **A 14:30 that came and went without a recording is `idle`, not `armed` for
 * ever.**
 *
 * `disarm` has had an entry in `SessionCommandSchema` and a rule in
 * `TRANSITIONS` since the state machine was written, and no dispatcher anywhere:
 * a grep outside those two files returned the declarations and nothing else. So
 * a meeting the rep did not record stayed `armed` — a row the boot sweep does
 * not touch (it ends `recording`), that `Agenda` will not re-arm (`arm` is
 * illegal from `armed`), and that nothing in the product could move.
 */
test('an offer that expires without a recording leaves the meeting idle', async () => {
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  const meetingId = meetingIdFor('AAA')
  assert.equal(h.orchestrator.stateOf(meetingId), 'armed')

  // The slot passes. `decideArming` stops offering, the standing offer goes —
  // and so does the arming.
  await h.agenda.tick({ now: T0 + 4 * 60 * 60_000 })
  assert.equal(h.agenda.snapshot().armed, null)
  assert.equal(h.orchestrator.stateOf(meetingId), 'idle')
  h.store.close()
})

test('an offer that expires *during* a recording leaves the recording alone', async () => {
  // The opposite error, and the more expensive one: a slot that ends while the
  // call is still running must not touch the machine. `disarm` is illegal from
  // `recording` anyway — this holds the guard that never asks.
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  const meetingId = meetingIdFor('AAA')
  h.orchestrator.dispatch(meetingId, 'start', null)

  await h.agenda.tick({ now: T0 + 4 * 60 * 60_000 })
  assert.equal(h.orchestrator.stateOf(meetingId), 'recording')
  h.store.close()
})

/*
 * `armNow` — the rep asking, where the clock would not have.
 *
 * These are written against the case `decideArming` **refuses**, deliberately.
 * A test that armed a meeting the detector was already going to arm would pass
 * whether or not `armNow` bypassed it, which is the fixture-cannot-exercise-the-
 * property shape this repo keeps finding. With no conferencing process running,
 * the clock never arms — the test directly above proves that — so anything armed
 * here was armed because a human asked.
 */
test('armNow arms an event the detector would refuse', async () => {
  const h = harness([event('AAA')], null)
  await h.agenda.tick({ now: T0 - 60_000 })
  // The clock has had its chance and declined.
  assert.equal(h.agenda.snapshot().armed, null)

  const { meetingId } = h.agenda.armNow('AAA')

  assert.equal(meetingId, meetingIdFor('AAA'))
  assert.equal(h.orchestrator.stateOf(meetingId), 'armed')
  assert.equal(h.agenda.snapshot().armed?.eventId, 'AAA')
  h.store.close()
})

test('armNow keeps the invite, which is the whole reason it exists', async () => {
  /*
   * The alternative on screen was « Démarrer une réunion », which `meeting:create`
   * describes as a meeting the calendar knows nothing about — `eventId: null`,
   * no attendees, no subject. Everything DEC-7 keeps away from the model comes
   * off the invite, so this is the assertion that makes the feature worth having.
   */
  const h = harness([event('AAA', { subject: 'Néovia — cadrage' })], null)
  await h.agenda.tick({ now: T0 - 60_000 })

  const { meetingId } = h.agenda.armNow('AAA')
  /*
   * Read back through `Projections.context`, which is the projection every
   * other surface reads — the compte-rendu's « Interlocuteurs » line,
   * `speakerLabel`, account resolution — rather than off the in-memory session.
   * A session object that happened to hold the right fields would prove nothing
   * about what the *store* fold carries across a restart.
   */
  const context = h.store.projections.context(meetingId)

  assert.ok(context, 'the arming stored the invite')
  assert.equal(context.eventId, 'AAA')
  assert.equal(context.subject, 'Néovia — cadrage')
  assert.equal(context.attendees.length, 1)
  h.store.close()
})

test('armNow is still an offer — it never starts recording (HR-7)', async () => {
  const h = harness([event('AAA')], null)
  await h.agenda.tick({ now: T0 - 60_000 })
  const { meetingId } = h.agenda.armNow('AAA')
  assert.notEqual(h.orchestrator.stateOf(meetingId), 'recording')
  h.store.close()
})

test('armNow refuses an event the fold does not hold', async () => {
  /*
   * The id crosses the bridge from the renderer, so it is matched against the
   * events this agenda actually has. Without this it would happily create a
   * meeting for an event nobody can see, named by a string from anywhere.
   */
  const h = harness([event('AAA')], null)
  await h.agenda.tick({ now: T0 - 60_000 })
  assert.throws(() => h.agenda.armNow('BBB'), /calendrier/)
  assert.equal(h.agenda.snapshot().armed, null)
  h.store.close()
})

test('armNow publishes a snapshot, so the row redraws without a poll', async () => {
  const h = harness([event('AAA')], null)
  await h.agenda.tick({ now: T0 - 60_000 })
  const before = h.snapshots.length

  h.agenda.armNow('AAA')

  assert.ok(h.snapshots.length > before, 'a snapshot was published')
  assert.equal(h.snapshots.at(-1)?.armed?.eventId, 'AAA')
  h.store.close()
})

/*
 * **How late the offer actually arrives**, driven through the real loop's own
 * delay arithmetic rather than asserted about `decideArming` in isolation.
 *
 * This is the shape the defect had: `decideArming` was *correct* about the
 * window — it returned `wait` before it and `arm` inside it — and the offer
 * still arrived at the meeting's start time, because the horizon it handed back
 * (`scheduledEnd`, an hour out) meant the only thing choosing the delay was
 * `Agenda`'s five-minute ceiling. A unit test of `decideArming` at a chosen
 * instant cannot see that: it never asks *when the next instant would be*.
 *
 * So this replays a rep's morning. Teams comes up inside the window, and the
 * question is how long the rep stands there before the offer appears.
 */
test('the offer arrives inside the five-minute lead, not at the meeting’s start', async () => {
  const start = T0
  const launchedTeams = start - 4 * 60_000 // the rep opens Teams four minutes early
  const h = harness([event('AAA')], null)

  let now = start - 10 * 60_000
  let armedAt: number | null = null

  // The loop's own arithmetic, lifted verbatim: `min(MAX_SLEEP_MS, max(MIN, horizon - now))`.
  for (let i = 0; i < 400 && armedAt === null && now < start + 60_000; i++) {
    if (now >= launchedTeams) h.setAudio('Teams')
    /*
     * `tick` **returns the instant it wants to be woken at**, which is the one
     * number the defect lived in — so the replay advances by the loop's own
     * answer clamped the way `#loop` clamps it, rather than by a cadence this
     * test chose. A test that stepped by a fixed interval would have measured
     * its own interval.
     */
    const wakeAt = await h.agenda.tick({ now })
    if (h.agenda.snapshot().armed !== null) {
      armedAt = now
      break
    }
    now += Math.min(MAX_SLEEP_MS, Math.max(1_000, wakeAt - now))
  }

  assert.ok(armedAt !== null, 'the offer appeared at all')
  const lead = start - armedAt
  /*
   * The assertion is the **lead**, not a tick count. `ARM_LEAD_MS` is the
   * promise — « a rep who is talking is not looking for a button » — so what has
   * to hold is that the button is there before they start talking. Before the
   * fix this was 0 (measured: armed exactly at `start`, 240 s after Teams came
   * up); a whole `ARM_POLL_MS` of slack is left so the test is about the
   * property and not about the exact sampling phase.
   */
  assert.ok(
    lead >= ARM_LEAD_MS - 4 * 60_000 - ARM_POLL_MS,
    `armed ${lead / 1000}s before the start — the offer must not arrive as the call begins`,
  )
  assert.ok(armedAt - launchedTeams <= ARM_POLL_MS * 2, `took ${(armedAt - launchedTeams) / 1000}s after Teams came up`)
  h.store.close()
})
