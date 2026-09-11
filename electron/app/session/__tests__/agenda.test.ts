import test from 'node:test'
import assert from 'node:assert/strict'
import { Agenda, MAX_SLEEP_MS, SYNC_INTERVAL_MS, meetingIdFor } from '../Agenda.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { ARM_LEAD_MS, ARM_POLL_MS } from '../../../core/domain/arming.ts'
import { AD_HOC_DWELL_MS, AD_HOC_IDLE_POLL_MS, AD_HOC_POLL_MS } from '../../../core/domain/adHoc.ts'
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

const harness = (
  events: CalendarEvent[],
  meetingAudio: string | null = 'Teams',
  micHeldBy: string | null = null,
) => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store)
  const calendar = new FakeCalendar(events)
  const health: ConnectorHealth[] = []
  const snapshots: ReturnType<Agenda['snapshot']>[] = []
  const armed: { meetingId: string; subject: string }[] = []
  let audio = meetingAudio
  let held = micHeldBy

  const agenda = new Agenda({
    calendar,
    orchestrator,
    meetingSignal: () => ({ running: audio, inCall: held }),
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
    setHeld: (value: string | null) => void (held = value),
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
    meetingSignal: () => ({ running: 'Teams', inCall: null }),
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
  /*
   * The calendar's own horizon is still the window opening and not an interval —
   * that is the property this test was written for, and it still holds. What it
   * can no longer assert is that the horizon *returned* is that instant, because
   * detection tightens it: an unscheduled call can start at any moment, including
   * two hours before this event, and a horizon is a floor on attention rather
   * than a ceiling on it. Measured with only the calendar deciding, the offer for
   * a call starting at t=0 arrived at **t=325s**.
   *
   * So the calendar horizon is asserted as an upper bound — a tick must never
   * sleep *past* the window opening — plus the tightening itself.
   */
  const h = harness([event('AAA')], null)
  const now = T0 - 2 * 60 * 60_000
  const wakeAt = await h.agenda.tick({ now })
  assert.ok(wakeAt <= T0 - ARM_LEAD_MS, 'never sleeps past the instant the window opens')
  assert.ok(wakeAt <= now + AD_HOC_IDLE_POLL_MS, 'and looks for an unscheduled call meanwhile')
  assert.ok(wakeAt > now, 'never a spin of zero-delay timers')
  h.store.close()
})

test('an empty day still schedules a re-check — and now a much sooner one', async () => {
  /*
   * It used to be `SYNC_INTERVAL_MS`, five minutes, and that was the whole of the
   * lag: an empty day is the demo build's every day, and a call starting on one
   * was not looked for until the calendar happened to re-sync. Driving the
   * shipped `Agenda` with a call at t=0 put the offer at **t=325s**; with the
   * horizon taken from the detection branch too it is **t=55s**.
   */
  const h = harness([])
  const wakeAt = await h.agenda.tick({ now: T0 })
  assert.ok(wakeAt > T0, 'still schedules one')
  assert.ok(
    wakeAt <= T0 + AD_HOC_IDLE_POLL_MS,
    `an empty day must still look for an unscheduled call, got ${(wakeAt - T0) / 1000}s`,
  )
  assert.ok(wakeAt < T0 + SYNC_INTERVAL_MS, 'sooner than a calendar re-sync')
  h.store.close()
})

test('a call on an empty calendar is offered in under a minute, not in five', async () => {
  /*
   * The measurement, as a test. This is the number the feature is worth: a rep
   * whose client rings unannounced gets the offer while they are still saying
   * hello, and « a rep who is talking is not looking for a button ».
   */
  const h = harness([], null, null)
  let now = T0
  let next = await h.agenda.tick({ now })
  h.setHeld('Teams')
  let offeredAt: number | null = null
  for (let i = 0; i < 400 && offeredAt === null; i++) {
    now = next
    next = await h.agenda.tick({ now })
    if (h.agenda.snapshot().armed) offeredAt = now
  }
  assert.ok(offeredAt !== null, 'the call is offered at all')
  const lag = (offeredAt! - T0) / 1000
  assert.ok(lag <= 60, `offered ${lag}s after the call started — it was 325s before`)
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
    meetingSignal: () => ({ running: 'Teams', inCall: null }),
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

// ── The unscheduled call ────────────────────────────────────────────────────
//
// The one axis on which Granola was straightforwardly better. Sillage required a
// calendar event as the first half of a conjunction, so a client who rings at
// 11:05 about yesterday's proposal produced no offer at all, ever — and for a
// sales rep that is a large share of the working day. These drive the real
// `Agenda` over an **empty calendar**, which is the case that could not work.

test('a call nobody scheduled is offered, with no calendar event at all', async () => {
  const h = harness([], null, 'Teams')
  // The hold starts at the first tick and has to survive the dwell.
  await h.agenda.tick({ now: T0 })
  assert.equal(h.agenda.snapshot().armed, null, 'not on the first sight of a microphone')

  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const armed = h.agenda.snapshot().armed
  assert.ok(armed, 'a hold that survived the dwell is offered')
  assert.equal(armed?.eventId, null, 'and it says it has no calendar row')
  assert.equal(armed?.subject, 'Appel non planifié — Teams')
  assert.equal(h.orchestrator.stateOf(armed!.meetingId), 'armed')
  h.store.close()
})

test('it is an offer and nothing else (HR-7)', async () => {
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const armed = h.agenda.snapshot().armed
  assert.notEqual(h.orchestrator.stateOf(armed!.meetingId), 'recording')
  h.store.close()
})

test('a microphone blip is never a call', async () => {
  // A Slack voice message, a dictation, Teams' own « test your microphone ».
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  h.setHeld(null)
  await h.agenda.tick({ now: T0 + 4_000 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS * 3 })
  assert.equal(h.agenda.snapshot().armed, null)
  assert.equal(h.store.projections.listMeetings(10).length, 0, 'and no meeting row was written')
  h.store.close()
})

test('one hold is one meeting, however many ticks it spans', async () => {
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  for (let i = 1; i <= 6; i++) await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS * i })
  assert.equal(h.store.projections.listMeetings(10).length, 1)
  h.store.close()
})

test('the OS notification fires for an unscheduled call, because nothing else can tell the rep', async () => {
  // DEC-46's 14:30 notification tells a rep something they already knew was
  // coming. This one is the only way they learn the app noticed at all.
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  assert.equal(h.armed.length, 1)
  assert.equal(h.armed[0]?.subject, 'Appel non planifié — Teams')
  h.store.close()
})

test('the offer is withdrawn when the call ends, and the machine is told', async () => {
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const meetingId = h.agenda.snapshot().armed!.meetingId

  h.setHeld(null)
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 30_000 })
  assert.equal(h.agenda.snapshot().armed, null, 'a standing Enregistrer on a finished call is a button a rep presses')
  assert.equal(h.orchestrator.stateOf(meetingId), 'idle', 'disarmed, never left in `armed` for ever')
  h.store.close()
})

test('a dismissed offer is not re-offered on every poll for the rest of the call', async () => {
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const first = h.agenda.snapshot().armed!.meetingId
  h.orchestrator.dispatch(first, 'disarm', 'le commercial a refusé')

  for (let i = 2; i <= 8; i++) await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS * i })
  /*
   * Asserted on the *offer*, not on a row count. `Projections.listMeetings` now
   * hides an `adhoc-` meeting that is `idle` and never started — a call that was
   * offered and declined is not a meeting the rep had — so counting rows here
   * would measure that filter rather than this rule, and would read `0` whether
   * one offer was made or eight.
   */
  assert.equal(h.armed.length, 1, 'one offer per hold, never one per poll')
  h.store.close()
})

test('leaving Teams for Zoom is a new call, and gets its own dwell', async () => {
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  assert.equal(h.agenda.snapshot().armed?.subject, 'Appel non planifié — Teams')

  h.setHeld('Zoom')
  const switched = T0 + AD_HOC_DWELL_MS + 1_000
  await h.agenda.tick({ now: switched })
  /*
   * The Teams offer is withdrawn *immediately*, not carried until the Zoom hold
   * earns its dwell — which is what this test asserted before round 24. Leaving
   * Teams means that call is over, so a standing *Enregistrer* naming it is a
   * button a rep presses on a finished conversation; and leaving it in `armed`
   * stranded it there for the life of the process, refusing every installer.
   */
  assert.equal(h.agenda.snapshot().armed, null, 'the finished call stops being offered at once')

  await h.agenda.tick({ now: switched + AD_HOC_DWELL_MS })
  assert.equal(h.agenda.snapshot().armed?.subject, 'Appel non planifié — Zoom')
  h.store.close()
})

test('a calendar event beats an unscheduled call for the same instant', async () => {
  // Two offers for one conversation is the defect `#arm`'s docblock records.
  const h = harness([event('AAA')], 'Teams', 'Teams')
  await h.agenda.tick({ now: T0 - 60_000 })
  const armed = h.agenda.snapshot().armed
  assert.equal(armed?.meetingId, meetingIdFor('AAA'))
  assert.equal(armed?.eventId, 'AAA', 'the calendar offer, with its attendees and objet')
  assert.equal(h.store.projections.listMeetings(10).length, 1, 'and no second row for the same call')
  h.store.close()
})

test('the horizon tightens while a hold is building, and never loosens', async () => {
  const h = harness([], null, 'Teams')
  const horizon = await h.agenda.tick({ now: T0 })
  assert.ok(
    horizon <= T0 + AD_HOC_POLL_MS,
    `a hold building toward its dwell must be re-asked within ${AD_HOC_POLL_MS} ms, got ${horizon - T0}`,
  )
  assert.ok(horizon > T0, 'and never a spin of zero-delay timers')
  h.store.close()
})

test('no microphone signal at all leaves the product exactly as it was', async () => {
  // An older binary, or a platform with no implementation. `inCall` is null and
  // nothing ad-hoc ever happens — no offer, no meeting row, no notification.
  const h = harness([], null, null)
  for (let i = 0; i <= 10; i++) await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS * i })
  assert.equal(h.agenda.snapshot().armed, null)
  assert.equal(h.store.projections.listMeetings(10).length, 0)
  assert.equal(h.armed.length, 0)
  h.store.close()
})

test('the agenda asks for the process signal only when an event could use it', async () => {
  // The other half of the cost fix, asserted where the decision is made.
  const asked: boolean[] = []
  const build = (events: CalendarEvent[]) =>
    new Agenda({
      calendar: new FakeCalendar(events),
      orchestrator: new Orchestrator(openMemoryStore()),
      meetingSignal: () => ({ running: null, inCall: null }),
      refreshMeetingSignal: async (want) => void asked.push(want),
      clock: () => T0,
    })

  await build([]).tick({ now: T0 })
  assert.deepEqual(asked, [false], 'no event in the window, no process spawn')

  await build([event('AAA')]).tick({ now: T0 })
  assert.deepEqual(asked, [false, true], 'an event in the window still gets both signals')
})

test('the unscheduled offer can actually be accepted, and the meeting is usable', async () => {
  /*
   * An offer nothing can accept is worse than no offer. The synthesised context
   * has no event, no attendees and no organiser, so this asserts the meeting the
   * rep gets is a real one all the way through the state machine — and that the
   * projection every surface reads carries the title they pressed.
   */
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const meetingId = h.agenda.snapshot().armed!.meetingId

  const started = h.orchestrator.dispatch(meetingId, 'start', 'le commercial a accepté')
  assert.equal(started.ok, true, 'Enregistrer must be able to start the call it offered')
  assert.equal(h.orchestrator.stateOf(meetingId), 'recording')

  const context = h.store.projections.context(meetingId)
  assert.ok(context, 'the meeting has a context the rest of the product can read')
  assert.equal(context?.eventId, null)
  assert.equal(context?.subject, 'Appel non planifié — Teams')

  const row = h.store.projections.listMeetings(10).find((m) => m.id === meetingId)
  assert.ok(row, 'and it is in the list every screen draws from')
  assert.equal(row?.title, 'Appel non planifié — Teams')
  h.store.close()
})

test('an unchanged snapshot is not re-broadcast on every tick', async () => {
  /*
   * `onChanged` fired at the end of every tick, which was defensible while a tick
   * was a five-minute calendar re-sync. Detecting unscheduled calls made the loop
   * run every thirty seconds — it has to, because the microphone is polled — so
   * an unguarded publish is ten times as many renderer re-renders of a screen on
   * which nothing moved.
   */
  const h = harness([], null, null)
  await h.agenda.tick({ now: T0 })
  const afterFirst = h.snapshots.length
  assert.equal(afterFirst, 1, 'the first tick publishes')

  for (let i = 1; i <= 9; i++) await h.agenda.tick({ now: T0 + i * 30_000 })
  assert.equal(h.snapshots.length, afterFirst, 'nine quiet ticks publish nothing')

  /*
   * The tenth crosses `SYNC_INTERVAL_MS` and the calendar re-syncs, which moves
   * `syncedAt` — a real change, and one the screen draws as « synchronisé il y a
   * N minutes ». So it publishes, and that is the guard working rather than
   * failing: what is suppressed is an identical snapshot, not a quiet one.
   */
  await h.agenda.tick({ now: T0 + 10 * 30_000 })
  assert.equal(h.snapshots.length, afterFirst + 1, 'a re-sync is a change and is published')
  h.store.close()
})

test('but a real change is published immediately', async () => {
  const h = harness([], null, null)
  await h.agenda.tick({ now: T0 })
  const quiet = h.snapshots.length

  h.setHeld('Teams')
  await h.agenda.tick({ now: T0 + 30_000 })
  await h.agenda.tick({ now: T0 + 30_000 + AD_HOC_DWELL_MS })
  assert.ok(h.snapshots.length > quiet, 'an offer appearing is a change')
  assert.equal(h.snapshots.at(-1)?.armed?.subject, 'Appel non planifié — Teams')
  h.store.close()
})

// ── One conversation, one offer ─────────────────────────────────────────────
//
// Round 24 drove three paths through a `calendarArmed: false` that `Agenda`
// hard-coded, so the rule the field named was never applied at all. Each armed a
// second meeting over a live one, put a second row on the day wearing the
// screen's one filled *Enregistrer*, and fired an OS notification reading « La
// réunion commence » about a call already in progress — whose click broadcasts
// `session:open` and navigates the rep off their live recording.

test('a manually started call is not offered back to the rep 25 seconds later', async () => {
  // « Démarrer une réunion » is the existing route for an unscheduled call, and
  // the fast one: this detector waits for a dwell.
  const h = harness([], null, 'Teams')
  h.orchestrator.create({ id: 'manuelle', title: 'Appel Sodexial', context: null })
  h.orchestrator.dispatch('manuelle', 'arm', 'manuel')
  h.orchestrator.dispatch('manuelle', 'start', 'le commercial a pressé Démarrer')

  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })

  assert.equal(h.agenda.snapshot().armed, null, 'no second offer for one conversation')
  assert.equal(h.armed.length, 0, 'and no « La réunion commence » over a live call')
  assert.equal(h.orchestrator.stateOf('manuelle'), 'recording', 'the real one is untouched')
  assert.equal(h.store.projections.listMeetings(10).length, 1, 'one row, not two')
  h.store.close()
})

test('a recording that keeps the microphone held does not arm a second meeting', async () => {
  // The overrun case: `OVERRUN_GRACE_MS` keeps a calendar call armable past its
  // slot precisely *because* the microphone is still held, and that same hold
  // was feeding the ad-hoc path.
  const h = harness([event('AAA')], 'Teams', 'Teams')
  await h.agenda.tick({ now: T0 - 60_000 })
  const calendarMeeting = h.agenda.snapshot().armed!.meetingId
  h.orchestrator.dispatch(calendarMeeting, 'start', 'le commercial enregistre')
  assert.equal(h.orchestrator.stateOf(calendarMeeting), 'recording')

  // Well past the scheduled end, microphone still held.
  for (let i = 1; i <= 6; i++) await h.agenda.tick({ now: T0 + 3_600_000 + i * AD_HOC_DWELL_MS })

  const live = h.orchestrator.liveStates().filter((s) => s === 'armed' || s === 'recording')
  assert.deepEqual(live, ['recording'], `expected one live meeting, got ${JSON.stringify(live)}`)
  assert.equal(h.store.projections.listMeetings(10).length, 1, 'no second row for one call')
  h.store.close()
})

test('once the live meeting ends, the next call is offered normally', async () => {
  // The guard is a horizon, not a park: a rep who finishes one call and takes
  // another immediately must still get the second offer.
  const h = harness([], null, 'Teams')
  h.orchestrator.create({ id: 'manuelle', title: 'Appel Sodexial', context: null })
  h.orchestrator.dispatch('manuelle', 'arm', 'manuel')
  h.orchestrator.dispatch('manuelle', 'start', 'démarré')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  assert.equal(h.agenda.snapshot().armed, null)

  h.orchestrator.dispatch('manuelle', 'end', 'terminée')
  // A new hold, so a new dwell.
  h.setHeld(null)
  await h.agenda.tick({ now: T0 + 2 * AD_HOC_DWELL_MS })
  h.setHeld('Zoom')
  const t = T0 + 3 * AD_HOC_DWELL_MS
  await h.agenda.tick({ now: t })
  await h.agenda.tick({ now: t + AD_HOC_DWELL_MS })
  assert.equal(h.agenda.snapshot().armed?.subject, 'Appel non planifié — Zoom')
  h.store.close()
})

test('leaving Teams for Zoom does not strand the Teams meeting in armed for ever', async () => {
  /*
   * `#armAdHoc` mints its id from `heldSince`, so a new hold is always a new
   * meeting, and `#withdrawAdHoc` only ever named whatever was *currently* in
   * `#armed` — which the new offer overwrote. `armed` is in
   * `UPDATE_BLOCKING_STATES`, so the stranded row refused every installer for the
   * rest of the session with « une réunion est sur le point de démarrer », about
   * a call that had ended.
   */
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const first = h.agenda.snapshot().armed!.meetingId

  h.setHeld('Zoom')
  const t = T0 + AD_HOC_DWELL_MS + 1_000
  await h.agenda.tick({ now: t })
  await h.agenda.tick({ now: t + AD_HOC_DWELL_MS })
  const second = h.agenda.snapshot().armed!.meetingId

  assert.notEqual(first, second)
  assert.equal(h.orchestrator.stateOf(first), 'idle', 'the abandoned offer was disarmed')
  assert.ok(
    !h.orchestrator.liveStates().includes('armed') ||
      h.orchestrator.stateOf(second) === 'armed',
    'nothing is armed except the offer that is actually standing',
  )

  h.setHeld(null)
  await h.agenda.tick({ now: t + AD_HOC_DWELL_MS + 60_000 })
  const blocking = h.orchestrator.liveStates().filter((s) => s === 'armed' || s === 'recording')
  assert.deepEqual(blocking, [], `an update would be refused by ${JSON.stringify(blocking)}`)
  h.store.close()
})

test('a meeting the rep accepted is never withdrawn by a change of application', async () => {
  // `#withdrawAdHoc` clears `#armed` and disarms — neither of which may happen to
  // a call under way. The call ending is exactly when the rep stops it.
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const accepted = h.agenda.snapshot().armed!.meetingId
  h.orchestrator.dispatch(accepted, 'start', 'le commercial a accepté')

  h.setHeld('Zoom')
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 1_000 })
  assert.equal(h.orchestrator.stateOf(accepted), 'recording', 'still recording')
  h.store.close()
})

test('a one-poll microphone drop during a recording does not mint a second meeting', async () => {
  /*
   * Round 24's third path. The microphone signal is a poll over a process list,
   * and a single missed reading — a device switching, a HAL hiccup — resets the
   * hold. `#armAdHoc` mints its id from `heldSince`, so the next hold is always a
   * fresh `idle` meeting and always armable; without the live guard that meant a
   * second ad-hoc meeting on top of the one being recorded.
   */
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const first = h.agenda.snapshot().armed!.meetingId
  h.orchestrator.dispatch(first, 'start', 'le commercial a accepté')

  h.setHeld(null)
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 5_000 })
  h.setHeld('Teams')
  for (let i = 1; i <= 4; i++) {
    await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 5_000 + i * AD_HOC_DWELL_MS })
  }

  assert.equal(h.orchestrator.stateOf(first), 'recording', 'the call carries on')
  assert.equal(h.store.projections.listMeetings(10).length, 1, 'one row for one conversation')
  const live = h.orchestrator.liveStates().filter((s) => s === 'armed' || s === 'recording')
  assert.deepEqual(live, ['recording'])
  h.store.close()
})

test('a flicker under a standing offer replaces it rather than stacking on it', async () => {
  // The same drop while the rep has not yet accepted. The stale offer must be
  // withdrawn — it names a hold that ended — and exactly one may stand after.
  const h = harness([], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const first = h.agenda.snapshot().armed!.meetingId

  h.setHeld(null)
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 5_000 })
  h.setHeld('Teams')
  for (let i = 1; i <= 4; i++) {
    await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 5_000 + i * AD_HOC_DWELL_MS })
  }

  assert.equal(h.orchestrator.stateOf(first), 'idle', 'the stale offer was disarmed')
  const live = h.orchestrator.liveStates().filter((s) => s === 'armed' || s === 'recording')
  assert.equal(live.length, 1, `exactly one offer may stand, got ${JSON.stringify(live)}`)
  h.store.close()
})
