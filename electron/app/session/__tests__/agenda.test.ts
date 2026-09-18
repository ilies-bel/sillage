import test from 'node:test'
import assert from 'node:assert/strict'
import { Agenda, MAX_SLEEP_MS, SYNC_INTERVAL_MS, meetingIdFor } from '../Agenda.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { ARM_LEAD_MS, ARM_POLL_MS, OVERRUN_GRACE_MS } from '../../../core/domain/arming.ts'
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

  /*
   * The diagnostics this agenda records, so a *rate* can be asserted and not only a
   * behaviour. It had none, and that is how ninety-four identical `warn` rows about a
   * finished meeting reached the support bundle unnoticed.
   */
  const diagnostics: { code: string; message: string }[] = []
  const agenda = new Agenda({
    calendar,
    orchestrator,
    diagnostics: {
      record: (event) => void diagnostics.push({ code: event.code, message: event.message }),
    },
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
    diagnostics,
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

test('the offer disappears when the meeting is over — and « over » means the grace', async () => {
  /*
   * **`scheduledEnd + OVERRUN_GRACE_MS`, and it used to be `scheduledEnd + 1ms`.**
   *
   * This asserted withdrawal one millisecond past the slot, and that contradicted
   * every other place the product decides whether a call is behind the rep:
   * `decideArming` arms an *overrunning* event on the strength of a held microphone
   * until exactly this boundary, `entries.ts`'s `isPast` keeps the row's own control
   * until it, and `calendarClaim` claims the conversation until it. DEC-9 says sales
   * calls overrun constantly — withdrawing the offer at +1 ms left the row drawing
   * « Enregistrer » through the `eventId` path while the armed offer behind it was
   * already gone.
   *
   * Both sides are asserted, because a boundary with only one side tested is a
   * boundary that can move.
   */
  const h = harness([event('AAA')])
  await h.agenda.tick({ now: T0 - 60_000 })
  assert.ok(h.agenda.snapshot().armed)

  await h.agenda.tick({ now: T0 + 3_600_000 + OVERRUN_GRACE_MS - 1_000 })
  assert.ok(h.agenda.snapshot().armed, 'a call that has just run over is the row to show')

  await h.agenda.tick({ now: T0 + 3_600_000 + OVERRUN_GRACE_MS + 1_000 })
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
  // Past the overrun grace, which is where the offer is actually withdrawn — see
  // « the offer disappears when the meeting is over » for why the boundary is that
  // and not the scheduled end.
  await h.agenda.tick({ now: T0 + 3_600_000 + OVERRUN_GRACE_MS + 1_000 })
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

test('the refusal beside a live recording names the call that is live', async () => {
  /*
   * `CLAUDE.md`: « `arm` is illegal beside a live recording, and a refusal names
   * the live call. » `Agenda.ts` says the same thing in its own docblock — « So
   * the live call is named, and the sentence says what to do » — and then found
   * `busy` and used it as a boolean. The sentence stopped at « Une réunion est
   * déjà en cours d'enregistrement », which is the one fact the rep already has.
   *
   * The rep here is the one the docblock above describes: two overlapping calls,
   * the 14:00 still running into the 15:00 slot. They press the row they believe
   * is free. An unnamed refusal says the product disagrees and withholds which of
   * the two it means, so the recoverable act — finish that one, press this again —
   * is the part it does not tell them. DEC-26: a refusal is a fact the rep can act
   * on, never a dead end.
   *
   * Asserted on the subject rather than on the whole sentence, so rewording the
   * instruction does not fail this and dropping the name does.
   */
  const h = harness([
    event('LIVE', { subject: 'Banque Delcourt — cadre tarifaire' }),
    event('NEXT', { subject: 'Néovia Santé — cadrage' }),
  ])
  const live = h.agenda.armNow('LIVE')
  h.orchestrator.dispatch(live.meetingId as never, 'start', null)
  assert.equal(h.orchestrator.stateOf(live.meetingId as never), 'recording')

  assert.throws(
    () => h.agenda.armNow('NEXT'),
    /Banque Delcourt — cadre tarifaire/,
    'le refus doit nommer l’appel en cours, pas seulement dire qu’il y en a un',
  )
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

// ── round 25: « one conversation, one offer », for the third time ─────────────
//
// Round 23 found the horizon. Round 24 found `calendarArmed: false`, hard-coded,
// so the rule was never applied at all. Round 25 found the same rule broken in two
// more places, and both are below. The pattern is worth naming: every previous fix
// reached for the *predicate*, and the predicate was never the problem — the
// withdrawal read its target out of the field being overwritten, and the
// suppression was keyed on an instant instead of on a conversation.

test('arming a calendar row over a standing offer does not strand the offer for ever', async () => {
  /*
   * **The rep's own gesture, and it cost three things for the life of the process.**
   *
   * `#withdrawAdHoc` read its target out of `#armed`, and `#arm(event)` overwrites
   * `#armed`. So the moment a rep pressed *Enregistrer* on an upcoming row while an
   * unscheduled call was detected, nothing in the product could name the ad-hoc
   * meeting again: it stayed `armed`, which is in `UPDATE_BLOCKING_STATES`, so
   * **every installer was refused** with a sentence that was false about a call that
   * had ended; `meetingLive` read that row and answered `none` for every subsequent
   * call, so **the detector turned itself off for the rest of the working day**; and
   * the row sat in *À venir* wearing « Prêt », past `listMeetings`'s filter, which
   * deliberately keeps a standing ad-hoc offer because one wants attention.
   *
   * Verbatim the harm `#trackHold`'s docblock says it ended for the Teams→Zoom case,
   * reintroduced one caller over.
   */
  /*
   * **The event has to be one the calendar does not claim**, and in the version of
   * this test written for round 25 it was thirty minutes away — inside
   * `CALENDAR_CLAIM_MS`, so round 26's fix correctly refuses to offer an unscheduled
   * meeting at all and the setup could no longer reach the thing being tested. The
   * property is unchanged and still real: a rep prepping for a 16:00 call while
   * taking an unscheduled 15:00 one presses *Enregistrer* on a row that is hours
   * away, and the standing offer must be withdrawn rather than stranded.
   */
  const upcoming = event('AAA', {
    scheduledStart: T0 + 4 * 60 * 60_000,
    scheduledEnd: T0 + 5 * 60 * 60_000,
  })
  const h = harness([upcoming], null, 'Teams')

  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  const adHoc = h.agenda.snapshot().armed?.meetingId
  assert.ok(adHoc, 'the unscheduled call was offered')
  assert.equal(h.orchestrator.stateOf(adHoc), 'armed')

  // The rep presses *Enregistrer* on the upcoming calendar row.
  await h.agenda.armNow('AAA')

  assert.equal(
    h.orchestrator.stateOf(adHoc),
    'idle',
    'the unscheduled offer was withdrawn rather than stranded in `armed`',
  )
  const rows = h.store.projections.listMeetings(null).map((m) => `${m.state}:${m.id}`)
  assert.ok(
    !rows.some((row) => row === `armed:${adHoc}`),
    `no phantom armed row on the day, got ${JSON.stringify(rows)}`,
  )

  /*
   * **And the feature under review is still alive**, which is the cost that was
   * invisible, because it looks exactly like the detector deciding not to offer.
   *
   * The rep's armed meeting has to settle first, and that is not a weakening of the
   * assertion — it is the assertion being about the right thing. While *any* meeting
   * is armed the detector is correctly silent (`meetingLive`): a rep who pressed
   * *Enregistrer* is telling the product to record this conversation, and a second
   * offer would put a second filled primary on the day. An earlier draft asserted an
   * offer arriving *while* that meeting was armed, which is the defect one screen up
   * rather than the property.
   *
   * What round 25 broke is that the stranded row made this state **permanent**. So:
   * settle it the way a rep does, change the hold — a new conversation — and the offer
   * must come.
   */
  h.orchestrator.dispatch(
    h.agenda.snapshot().armed!.meetingId,
    'disarm',
    'le commercial a renoncé',
  )
  h.setHeld(null)
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 5_000 })
  h.setHeld('Zoom')
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 6_000 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 6_000 + AD_HOC_DWELL_MS })
  const second = h.agenda.snapshot().armed
  assert.equal(second?.subject, 'Appel non planifié — Zoom', 'a later unscheduled call is still offered')
  h.store.close()
})

test('a conversation already recorded is not offered again when the recording ends', async () => {
  /*
   * **« Press *Terminer* while still on the call »** — which the widget's own
   * docblock calls an ordinary thing for a client to ask, and which is one of the
   * three paths round 24 named.
   *
   * `meetingLive` counted `armed` and `recording`, so the guard held during the
   * recording and *released* at `ended`, with Teams still holding the microphone.
   * The detector then offered to record the conversation it had just recorded: a
   * second row on the day, and an OS notification whose click broadcasts
   * `session:open` and navigates the rep off the screen they are reading.
   *
   * The suppression is a decision about the conversation now, not a pause: the hold
   * is spent the moment the product is already working on a meeting.
   */
  const h = harness([], null, 'Teams')
  h.orchestrator.create({ id: 'man-1', title: 'Appel Sodexial', context: null })
  h.orchestrator.dispatch('man-1', 'start', 'le commercial a démarré')

  await h.agenda.tick({ now: T0 + 30_000 })
  assert.equal(h.agenda.snapshot().armed, null, 'the guard holds during the recording')

  h.orchestrator.dispatch('man-1', 'end', 'le commercial a terminé')
  await h.agenda.tick({ now: T0 + 20 * 60_000 })

  assert.equal(h.agenda.snapshot().armed, null, 'the call just recorded is not offered again')
  assert.deepEqual(h.armed, [], 'and no notification takes the rep off the compte-rendu')
  h.store.close()
})

test('nor while the rep is at the gate, which is the one screen DEC-4 protects', async () => {
  // The same hold, carried through to `awaiting_confirmation`. A notification here
  // navigates the rep off a screen holding edits they have not confirmed.
  const h = harness([], null, 'Teams')
  h.orchestrator.create({ id: 'man-2', title: 'Appel Sodexial', context: null })
  h.orchestrator.dispatch('man-2', 'start', 'le commercial a démarré')
  await h.agenda.tick({ now: T0 + 30_000 })
  h.orchestrator.dispatch('man-2', 'end', 'le commercial a terminé')
  h.orchestrator.dispatch('man-2', 'extract', 'rédaction')
  h.orchestrator.dispatch('man-2', 'extractionSucceeded', 'compte-rendu rédigé')

  await h.agenda.tick({ now: T0 + 25 * 60_000 })
  assert.equal(h.orchestrator.stateOf('man-2'), 'awaiting_confirmation')
  assert.equal(h.agenda.snapshot().armed, null)
  assert.deepEqual(h.armed, [])
  h.store.close()
})

test('but a meeting waiting for ever on a model does not deafen the detector', async () => {
  /*
   * **The fix the round suggested, and why it is not the one here.**
   *
   * Round 25 proposed widening the live set to everything but `idle`, `done` and
   * `aborted` — the list `Agenda`'s own comment named. That is a worse defect than
   * the finding. `ended` and `extracting` persist **indefinitely** when no language
   * model is configured: DEC-39 says the app states the case and waits, and that is
   * every meeting on the demo build DEC-28 calls the first deliverable. So counting
   * them would turn meeting detection off permanently after the very first call —
   * the stranding above, by another route, on the build that ships first.
   *
   * What closes the window is *when* it closes, not how wide it is.
   */
  const h = harness([], null, 'Teams')
  h.orchestrator.create({ id: 'man-3', title: 'Appel Sodexial', context: null })
  h.orchestrator.dispatch('man-3', 'start', 'le commercial a démarré')
  await h.agenda.tick({ now: T0 + 60_000 })
  h.orchestrator.dispatch('man-3', 'end', 'le commercial a terminé')

  // An hour later, with no model: still `ended`, and it always will be.
  await h.agenda.tick({ now: T0 + 60 * 60_000 })
  assert.equal(h.orchestrator.stateOf('man-3'), 'ended')

  // A genuinely new call — the rep left Teams, and Zoom rings three hours later.
  h.setHeld(null)
  await h.agenda.tick({ now: T0 + 3 * 60 * 60_000 })
  h.setHeld('Zoom')
  await h.agenda.tick({ now: T0 + 3 * 60 * 60_000 + 1_000 })
  await h.agenda.tick({ now: T0 + 3 * 60 * 60_000 + 1_000 + AD_HOC_DWELL_MS })

  assert.equal(
    h.agenda.snapshot().armed?.subject,
    'Appel non planifié — Zoom',
    'an unscheduled call three hours later is still offered',
  )
  assert.equal(h.orchestrator.stateOf('man-3'), 'ended', 'and the waiting meeting cost nothing')
  h.store.close()
})

// ── round 26: the axis was wrong, for three rounds ───────────────────────────
//
// « One conversation, one offer » was rewritten three times around the question *is a
// meeting live*. The conversation it could not see is the most ordinary one a sales rep
// has: joining their own scheduled Teams call early. There is no live meeting, no armed
// meeting and a microphone held by Teams — so the detector offered an unscheduled
// meeting for the scheduled call, and the calendar then armed the same conversation a
// second time. The question is not « is a meeting live » but « does the calendar already
// account for a call happening now ».

test('a rep who joins their own call early gets one offer, and it is the calendar’s', async () => {
  /*
   * Measured on the shipped Agenda before the fix, at every distance from 5 min 25 s
   * — `ARM_LEAD_MS + AD_HOC_DWELL_MS` — outwards: « Appel non planifié — Teams »
   * plus « Sodexial », two rows on the day, two OS notifications. The first names no
   * client, wears the day's one filled primary, and carries `eventId: null`, which
   * `DayPane`'s own comment prices: no attendees, no « Interlocuteurs », no chance for
   * `speakerLabel` to name the far channel after a person, and the weakest possible
   * account resolution. « The rep pays that for being on time. »
   */
  for (const early of [5.5, 8, 15, 29]) {
    const h = harness([event('AAA', { subject: 'Sodexial — comité' })], null, null)
    const joined = T0 - early * 60_000
    h.setHeld('Teams')
    await h.agenda.tick({ now: joined })
    // Well past the dwell, so nothing here is waiting on evidence.
    await h.agenda.tick({ now: joined + AD_HOC_DWELL_MS + 1_000 })

    const armed = h.agenda.snapshot().armed
    assert.ok(
      armed === null || armed.eventId !== null,
      `joined ${early} min early and got an unscheduled offer: ${JSON.stringify(armed)}`,
    )
    assert.ok(
      h.armed.every((a) => !a.subject.startsWith('Appel non planifié')),
      `joined ${early} min early and the OS announced an unscheduled call: ${JSON.stringify(h.armed)}`,
    )
    h.store.close()
  }
})

test('and the offer it does get names the client, once', async () => {
  const h = harness([event('AAA', { subject: 'Sodexial — comité' })], null, null)
  h.setHeld('Teams')
  await h.agenda.tick({ now: T0 - 8 * 60_000 })
  await h.agenda.tick({ now: T0 - 8 * 60_000 + AD_HOC_DWELL_MS + 1_000 })
  /*
   * Nothing yet: the calendar has claimed the conversation and its own offer is not
   * due until `ARM_LEAD_MS`. Deferring, never refusing.
   *
   * The sentence on screen stays the **calendar's** — « la fenêtre n'est pas encore
   * ouverte » — because the ad-hoc branch overwrites `#reason` only for `offer` and
   * `wait`, and that is the right way round: the rep wants to know about the meeting,
   * not about the detector's internal deferral. Asserted so that a change to either
   * has to be deliberate.
   */
  assert.equal(h.agenda.snapshot().armed, null)
  assert.equal(h.agenda.snapshot().reason, 'la fenêtre n’est pas encore ouverte')

  await h.agenda.tick({ now: T0 - ARM_LEAD_MS + 1_000 })
  assert.equal(h.agenda.snapshot().armed?.subject, 'Sodexial — comité')
  assert.deepEqual(
    h.armed.map((a) => a.subject),
    ['Sodexial — comité'],
    'exactly one announcement, and it is the one carrying the client',
  )
  h.store.close()
})

test('a call the calendar knows nothing about is still offered', async () => {
  /*
   * The other side of the boundary, and the reason `CALENDAR_CLAIM_MS` is a number
   * rather than « any event today ». A rep with a 16:00 invite who takes an
   * unscheduled call at noon must still be offered it — that is the whole feature.
   */
  const far = event('AAA', { scheduledStart: T0 + 4 * 60 * 60_000, scheduledEnd: T0 + 5 * 60 * 60_000 })
  const h = harness([far], null, 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  assert.equal(h.agenda.snapshot().armed?.subject, 'Appel non planifié — Teams')
  h.store.close()
})

test('a call that outlives its slot becomes the unscheduled call it has become', async () => {
  /*
   * The claim is asked on every tick and never latched. A 14:00–15:00 call still going
   * at 15:25 — past `scheduledEnd + OVERRUN_GRACE_MS`, which is where every other rule
   * in the product stops calling it that meeting — is a conversation the calendar no
   * longer accounts for, and if the rep never recorded it they should be offered it.
   */
  const h = harness([event('AAA')], null, 'Teams')
  await h.agenda.tick({ now: T0 + 3_600_000 + OVERRUN_GRACE_MS + 60_000 })
  await h.agenda.tick({ now: T0 + 3_600_000 + OVERRUN_GRACE_MS + 60_000 + AD_HOC_DWELL_MS })
  assert.equal(h.agenda.snapshot().armed?.eventId, null, 'the offer is the unscheduled one')
  h.store.close()
})

test('the rep’s own press survives the next tick, and raises no notification', async () => {
  /*
   * **Two defects in one gesture.**
   *
   * `armNow` deliberately does not consult `decideArming` — « the detector guesses,
   * the rep has said ». The tick does, and the expiry branch treated *any* non-`arm`
   * answer as « the offer expired », so one ordinary tick undid the press and logged
   * `disarm` with « la réunion est passée sans enregistrement » about a call thirty
   * minutes in the future. The control that made it renders only while the row has no
   * meeting, so it was gone for the rest of the day — the defect that control was
   * added to end, reachable by pressing it. `wait` is not `over`.
   *
   * And the arming raised an OS notification « La réunion commence » in answer to the
   * rep's own click inside the app, about a meeting half an hour away — whose click is
   * the one thing in the product that navigates without a press inside it (DEC-46).
   */
  const later = event('AAA', { scheduledStart: T0 + 30 * 60_000, scheduledEnd: T0 + 90 * 60_000 })
  const h = harness([later], null, null)
  const { meetingId } = h.agenda.armNow('AAA')

  assert.deepEqual(h.armed, [], 'the rep’s own press announced itself to the OS')

  await h.agenda.tick({ now: T0 + 30_000 })
  assert.equal(h.orchestrator.stateOf(meetingId), 'armed', 'one tick undid the rep’s press')
  assert.equal(h.agenda.snapshot().armed?.meetingId, meetingId)

  // And inside the lead, with no conferencing application running at all — which is
  // `wait`, not `over`, and used to withdraw it on the clock path too.
  await h.agenda.tick({ now: T0 + 30 * 60_000 - ARM_LEAD_MS + 1_000 })
  assert.equal(h.orchestrator.stateOf(meetingId), 'armed')
  h.store.close()
})

test('one recording at a time, and the refusal says which', async () => {
  /*
   * `MeetingSession`'s table is per meeting, so `idle → recording` was legal for every
   * session independently: `liveStates = ["recording","recording"]`, two microphone and
   * two system-audio handles on the same devices, two transcripts, two compte-rendus
   * and two pushes to a CRM with no idempotency key and no delete verb — for one
   * conversation. `Orchestrator.recording()` already answered this and had one caller,
   * the onboarding dry run; the state machine never asked it.
   */
  const h = harness([], null, null)
  h.orchestrator.create({ id: 'man-a', title: 'Premier appel', context: null })
  h.orchestrator.create({ id: 'man-b', title: 'Second appel', context: null })
  assert.equal(h.orchestrator.dispatch('man-a', 'start', 'le commercial a démarré').ok, true)

  const refused = h.orchestrator.dispatch('man-b', 'start', 'le commercial a démarré')
  assert.equal(refused.ok, false)
  assert.equal(refused.ok === false && refused.reason, 'une autre réunion est déjà en cours d’enregistrement')
  assert.deepEqual(h.orchestrator.liveStates().filter((s) => s === 'recording'), ['recording'])

  // And it is a refusal, not a park: the second is recordable once the first is done.
  h.orchestrator.dispatch('man-a', 'end', 'le commercial a terminé')
  assert.equal(h.orchestrator.dispatch('man-b', 'start', 'le commercial a démarré').ok, true)
  h.store.close()
})

// ── round 27: the claim vetoed what the calendar would never arm ──────────────

test('an ordinary calendar does not make the detector deaf', async () => {
  /*
   * **The fifth axis, and it was two functions in one file disagreeing.**
   *
   * `calendarClaim` filtered on two of `decideArming`'s five refusals, so every entry
   * in the gap was claimed by one and refused by the other — and an ordinary Outlook
   * calendar is mostly those entries. Measured on the shipped `Agenda` over an
   * 08:00–19:00 day with two real invites and four blocks the rep wrote for themselves:
   * the detector could speak for **70 of 660 minutes**, and the longest silence — two
   * and a half hours — was claimed by a block named « Prospection téléphonique », which
   * is the block during which a rep makes unscheduled calls.
   *
   * Each shape is driven on its own so a failure names which one came back.
   */
  const shapes: [string, Partial<MeetingContext>][] = [
    ['un bloc sans participant ni lien', { attendees: [], onlineMeetingJoinUrl: null }],
    ['un créneau privé', { sensitivity: 'private' }],
    ['un créneau confidentiel', { sensitivity: 'confidential' }],
    ['une plage de neuf heures', { scheduledStart: T0, scheduledEnd: T0 + 9 * 3_600_000 }],
  ]

  for (const [what, over] of shapes) {
    const h = harness([event('AAA', over)], null, 'Teams')
    // Inside the old claim's reach and inside the entry's own slot: the two places it
    // used to veto.
    await h.agenda.tick({ now: T0 + 5 * 60_000 })
    await h.agenda.tick({ now: T0 + 5 * 60_000 + AD_HOC_DWELL_MS })

    assert.equal(
      h.agenda.snapshot().armed?.eventId,
      null,
      `${what}: no unscheduled offer — the calendar vetoed a call it would never arm`,
    )
    assert.equal(h.agenda.snapshot().armed?.subject, 'Appel non planifié — Teams', what)
    h.store.close()
  }
})

test('a meeting the rep has already finished stops claiming the conversation', async () => {
  /*
   * The claim reaches `OVERRUN_GRACE_MS` past the slot, and `#arm` refuses a meeting
   * past `armed` — so deferring to an offer that can never come cost a rep who ended
   * their 14:00–15:00 call at 14:20 and took a different client's call at 14:35
   * **forty-five minutes** of silence. On the demo build (DEC-28, no model) a meeting
   * stays `ended` for ever, so this was every slot, every day.
   *
   * And the refusal is recorded on the **edge**: it used to fire once per tick, which
   * measured ninety-four identical `warn` rows saying « Compte-rendu en attente
   * d'analyse. » about a meeting the rep had finished, in the bundle whose button says
   * it can be sent to support.
   */
  // « Teams » as the weak signal, so the calendar actually arms — without it
  // `decideArming` answers `wait` and this test would prove nothing.
  const h = harness([event('AAA')], 'Teams', null)
  await h.agenda.tick({ now: T0 - 60_000 })
  const scheduled = h.agenda.snapshot().armed?.meetingId
  assert.ok(scheduled)
  h.orchestrator.dispatch(scheduled, 'start', 'le commercial a démarré')
  h.orchestrator.dispatch(scheduled, 'end', 'le commercial a terminé')

  /*
   * 14:35 — a different client rings, well inside the old claim's tail.
   *
   * **Thirty ticks and not three.** A first draft of this drove three, and the
   * per-tick version of the diagnostic produced one row in three ticks, so it passed
   * on the defect: a fixture that cannot exercise the property it asserts, which is the
   * first defect shape `CLAUDE.md` lists. The rate is what is being measured, so the
   * test has to tick like the loop does.
   */
  h.setHeld('Teams')
  for (let i = 0; i < 30; i++) {
    await h.agenda.tick({ now: T0 + 35 * 60_000 + i * AD_HOC_POLL_MS })
  }

  assert.equal(h.agenda.snapshot().armed?.subject, 'Appel non planifié — Teams')
  /*
   * **And round 28 removed the refusal from this path entirely, which is better than
   * making it an edge.** The rate assertion used to live here: `nextArmable` went on
   * recommending the finished event on every tick and `#arm` refused it, ninety-four
   * times over eighty-five minutes. A conversation the product has finished is not a
   * candidate any more — see `#spent` — so there is nothing to refuse and nothing to
   * record. The edge property still matters and is still driven, on the path where an
   * already-`armed` meeting is legitimately recommended: see the test below.
   */
  assert.deepEqual(
    h.diagnostics.filter((d) => d.code === 'agenda.arm.refused'),
    [],
    'the calendar is still being told to arm a call the rep finished',
  )
  h.store.close()
})

test('a refused arming is recorded once per meeting, not once per attempt', async () => {
  /*
   * **Ninety-four identical `warn` rows came down a path round 28 closed, so the edge is
   * driven on the one that is left: the rep's own press.**
   *
   * `#arm` refuses a meeting past `armed`, and it used to be reached from every tick for
   * as long as `nextArmable` recommended the finished event — measured at ninety-four
   * rows over eighty-five minutes, all saying « Compte-rendu en attente d'analyse. »
   * about a meeting the rep had finished, in the bundle whose own button reads « Sans
   * contenu de conversation. Peut être envoyé au support. » A conversation the product
   * has finished is not a candidate any more (`#spent`), so the tick no longer asks.
   *
   * `armNow` still does, and deliberately: it is the rep pressing *Enregistrer*, which
   * consults no detector (« the detector guesses, the rep has said »). A row drawn before
   * the calendar armed and recorded that call is a stale row, and pressing it is how a
   * refusal is genuinely reached. The set makes it one row however many times it is
   * pressed — and `armNow` throws, so the rep is told each time.
   */
  const h = harness([event('AAA')], 'Teams', null)
  await h.agenda.tick({ now: T0 - 60_000 })
  const meetingId = meetingIdFor('AAA')
  h.orchestrator.dispatch(meetingId, 'start', 'le commercial a démarré')
  h.orchestrator.dispatch(meetingId, 'end', 'le commercial a terminé')
  // The tick withdraws the now-spent offer, which is the fix above this one.
  await h.agenda.tick({ now: T0 + 20 * 60_000 })
  assert.equal(h.agenda.snapshot().armed, null)

  for (let i = 0; i < 5; i++) {
    assert.throws(() => h.agenda.armNow('AAA'), /ne peut plus être démarrée/)
  }

  const refusals = h.diagnostics.filter((d) => d.code === 'agenda.arm.refused')
  assert.equal(
    refusals.length,
    1,
    `the refusal is an edge, not a row per attempt: got ${refusals.length} over 5 presses`,
  )
  h.store.close()
})

// ── round 28: the claim of the *other* slot went with the spent one ───────────

test('a finished slot does not hand the next one to the unscheduled detector', async () => {
  /*
   * **Sixth consecutive round on the arbitration rule, and the fifth time the previous
   * fix was right about the axis the round before it named.**
   *
   * Round 27 gave `#calendarOffersAt` the right question — « is the calendar *done* with
   * this conversation » — and asked it of `calendarClaim`, which answers **one** event.
   * So when the earliest claimant was spent, the conclusion was « the calendar accounts
   * for nothing », discarding the claim of every other slot covering the same instant.
   *
   * The rep records their 14:00–15:00 call, ends it at 14:20 — which DEC-39 leaves in
   * `ended` for ever on the demo build DEC-28 ships first — and at 14:50 joins their own
   * 15:00 Teams invite. Round 26 established that joining early is what a sales rep does
   * before a call that matters. Measured on the shipped `Agenda`: « Appel non planifié —
   * Teams » armed at 14:50:25 with the DEC-46 notification behind it, and then the
   * calendar arming *the same conversation* at 15:00 — `liveStates = ["recording","armed"]`,
   * two rows on the day, and a second notification whose click navigates the rep off
   * their live recording. Twenty-five minutes wide for every adjacent pair of slots.
   *
   * What it costs is the whole value of having consulted the calendar: no attendees, no
   * objet, « Client » instead of the person's name, no account resolution — so no
   * opportunity — and a VerySwing task titled « Appel non planifié — Teams » with no
   * idempotency key and no delete verb.
   *
   * Every `calendarClaim` test was single-event and this harness's own round-27 test
   * stages one event, so nothing in the repo put two slots and a session state together.
   */
  const HOUR = 3_600_000
  const a = event('AAA', { scheduledStart: T0, scheduledEnd: T0 + HOUR })
  const b = event('BBB', {
    subject: 'Néovia — cadrage',
    scheduledStart: T0 + HOUR,
    scheduledEnd: T0 + 2 * HOUR,
  })
  const h = harness([a, b], 'Teams', null)

  // 13:55 — the calendar offers the 14:00 call, the rep takes it and ends it at 14:20.
  await h.agenda.tick({ now: T0 - 5 * 60_000 })
  const first = meetingIdFor('AAA')
  assert.equal(h.orchestrator.stateOf(first), 'armed', 'the first call was never offered')
  h.orchestrator.dispatch(first, 'start', 'le commercial a démarré')
  h.orchestrator.dispatch(first, 'end', 'le commercial a terminé')
  assert.equal(h.orchestrator.stateOf(first), 'ended')

  // 14:50 — the rep joins their own 15:00 Teams call. Ten minutes early, and inside the
  // first slot, which is still running as far as the calendar is concerned.
  h.setHeld('Teams')
  await h.agenda.tick({ now: T0 + 50 * 60_000 })
  await h.agenda.tick({ now: T0 + 50 * 60_000 + AD_HOC_DWELL_MS })

  assert.notEqual(
    h.agenda.snapshot().armed?.subject,
    'Appel non planifié — Teams',
    'the detector offered an unscheduled meeting for a call the calendar holds — the ' +
      'compte-rendu loses the attendees, the objet, the speaker names and the account',
  )

  // 14:55 — `ARM_LEAD_MS` before the slot, which is when the *better* offer exists.
  await h.agenda.tick({ now: T0 + HOUR - ARM_LEAD_MS })
  assert.equal(h.agenda.snapshot().armed?.eventId, 'BBB')
  assert.equal(h.agenda.snapshot().armed?.subject, 'Néovia — cadrage')

  // And one offer for one conversation: never two live rows for the 15:00 call.
  const live = h.orchestrator
    .liveStates()
    .filter((state) => state === 'armed' || state === 'recording')
  assert.equal(live.length, 1, `two offers for one conversation: ${JSON.stringify(live)}`)
  h.store.close()
})

// ── round 29: the calendar → calendar direction, which had no test ────────────

test('a second invite does not strand the first in armed for ever', async () => {
  /*
   * **Round 25's finding in its third direction, and the one nobody had driven.**
   *
   * `#arm` overwrites `#armed`, which is why `#withdrawAdHoc` exists and why
   * `#adHocArmed` is its own field. The calendar half was never written: two invites
   * that abut — 14:00–15:00 and 15:00–16:00, the ordinary shape of a rep's day — and at
   * 15:00 `nextArmable` answers `arm` for the second, so `tick`'s expiry branch is an
   * `else if` that never runs and the first is never named again. Measured on the
   * shipped class (`scratch/r29-armed-stranded.mjs`): `["armed","armed"]` at 15:00, and
   * `["armed","idle"]` at 17:00 — the second withdrew itself, the first could not.
   *
   * Three costs, all past a relaunch because the row is in the store: every installer
   * refused with « une réunion est sur le point de démarrer » about a call that never
   * happened; the ad-hoc detector off for the working day, because `meetingLive` counts
   * that row and `#adHocSpent` latches — one offer for a genuine 17:00 call on two
   * non-adjacent invites, **zero** on two that abut; and a row in *À venir* wearing
   * « Prêt » on a day four days gone, past `entries.ts`'s `isPast`.
   *
   * `agenda.test.ts` had the ad-hoc → ad-hoc and the calendar → ad-hoc directions, both
   * named after this exact harm. A hundred and one tests passed with this live.
   */
  const HOUR = 3_600_000
  const first = event('AAA', { scheduledStart: T0, scheduledEnd: T0 + HOUR })
  const second = event('BBB', {
    subject: 'Néovia — cadrage',
    scheduledStart: T0 + HOUR,
    scheduledEnd: T0 + 2 * HOUR,
  })
  const h = harness([first, second], 'Teams', null)
  const a = meetingIdFor('AAA')
  const b = meetingIdFor('BBB')

  await h.agenda.tick({ now: T0 - ARM_LEAD_MS })
  assert.equal(h.orchestrator.stateOf(a), 'armed', 'the first invite was never offered')

  // 15:00 — the rep took the first call on their mobile and never pressed anything.
  await h.agenda.tick({ now: T0 + HOUR })
  assert.equal(h.orchestrator.stateOf(b), 'armed', 'the second invite was not offered')
  assert.equal(
    h.orchestrator.stateOf(a),
    'idle',
    'the first invite is still armed — nothing in the product can name it again',
  )
  assert.deepEqual(
    h.orchestrator.liveStates().filter((state) => state === 'armed'),
    ['armed'],
    'two standing offers for two conversations, one of them unreachable',
  )
  h.store.close()
})

test('the calendar does not arm the next invite over a live recording', async () => {
  /*
   * `MeetingSession`'s table is per meeting and `dispatch`'s « one recording at a time »
   * guards `start` only, so `arm` was legal beside a recording. A 14:00 call running to
   * 15:05 — what a call that matters does — armed the 15:00 invite beside it: measured,
   * `liveStates = ["recording","armed"]`, which is verbatim the string CLAUDE.md names
   * as the defect round 24 closed, with a **second OS notification whose click
   * navigates the rep off their live recording** (DEC-46).
   */
  const HOUR = 3_600_000
  const first = event('AAA', { scheduledStart: T0, scheduledEnd: T0 + HOUR })
  const second = event('BBB', {
    subject: 'Néovia — cadrage',
    scheduledStart: T0 + HOUR,
    scheduledEnd: T0 + 2 * HOUR,
  })
  const h = harness([first, second], 'Teams', null)
  const a = meetingIdFor('AAA')

  await h.agenda.tick({ now: T0 - ARM_LEAD_MS })
  h.orchestrator.dispatch(a, 'start', 'le commercial a démarré')

  await h.agenda.tick({ now: T0 + HOUR })
  assert.deepEqual(h.orchestrator.liveStates(), ['recording'], 'armed beside a live call')
  assert.equal(h.agenda.snapshot().armed?.eventId, 'AAA', 'the live call lost its row')
  assert.deepEqual(
    h.armed.map((a) => a.subject),
    ['Point Aura'],
    'a second notification while the rep is recording navigates them off their own call',
  )

  // And the invite is armed on the next tick after the rep ends the call.
  h.orchestrator.dispatch(a, 'end', 'le commercial a terminé')
  await h.agenda.tick({ now: T0 + HOUR + 60_000 })
  assert.equal(h.agenda.snapshot().armed?.eventId, 'BBB')
  h.store.close()
})

test('armNow names the event the rep pressed, or refuses', async () => {
  /*
   * It read `#armed` back and returned whatever it named, on the argument that « the id
   * the renderer should open is whatever the agenda now says is armed ». `#arm` has
   * paths that leave `#armed` naming a *different* meeting, and `Agenda.tsx` calls
   * `onOpen(meetingId)` with the answer: measured
   * (`scratch/r29-armnow-wrong-meeting.mjs`), `armNow('EV-A')` returned EV-B's id, so
   * pressing *Enregistrer* on Sodexial's row opened **Néovia's** session screen, where
   * the next press records the Sodexial call into Néovia's meeting — its `eventId`, its
   * attendees, its `speakerLabel`, its account, its VerySwing task, its Outlook draft.
   */
  const HOUR = 3_600_000
  const first = event('AAA', { scheduledStart: T0, scheduledEnd: T0 + HOUR })
  const second = event('BBB', {
    subject: 'Néovia — cadrage',
    scheduledStart: T0 + HOUR,
    scheduledEnd: T0 + 2 * HOUR,
  })
  const h = harness([first, second], 'Teams', null)
  const a = meetingIdFor('AAA')

  await h.agenda.tick({ now: T0 - ARM_LEAD_MS })
  // The first call happens and reaches the gate; the calendar then offers the second.
  for (const command of ['start', 'end'] as const) h.orchestrator.dispatch(a, command, 'x')
  await h.agenda.tick({ now: T0 + HOUR })
  assert.equal(h.agenda.snapshot().armed?.eventId, 'BBB')

  // A stale row for the first call — drawn before the calendar armed and recorded it.
  assert.throws(() => h.agenda.armNow('AAA'), /ne peut plus être démarrée/)
  // And the control: the event that *is* armed opens its own meeting.
  assert.equal(h.agenda.armNow('BBB').meetingId, meetingIdFor('BBB'))
  h.store.close()
})

test('and it says which call is in the way, because that one has a remedy', async () => {
  /*
   * Round 29's early return in `#arm` — « a call under way takes the conversation » — is
   * reached by `armNow` too, and the sentence it produced was « Cette réunion ne peut plus
   * être démarrée », through `window.alert`. It can: thirty seconds after *Terminer*. DEC-9
   * says sales calls overrun, so a 14:00 running to 15:05 and the rep pressing
   * *Enregistrer* on the 15:00 row is the ordinary case — and the fallback, *Démarrer une
   * réunion*, is refused too, so the reading left is « the 15:00 row is broken » and the
   * likely outcome is the call recorded with `eventId: null`: no attendees, no objet, no
   * `speakerLabel`, no account, no VerySwing link. The exact harm `armNow` exists to
   * prevent (DEC-26: a refusal is a fact the rep can act on).
   */
  const HOUR = 3_600_000
  const first = event('AAA', { scheduledStart: T0, scheduledEnd: T0 + HOUR })
  const second = event('BBB', {
    subject: 'Néovia — cadrage',
    scheduledStart: T0 + HOUR,
    scheduledEnd: T0 + 2 * HOUR,
  })
  const h = harness([first, second], 'Teams', null)
  await h.agenda.tick({ now: T0 - ARM_LEAD_MS })
  h.orchestrator.dispatch(meetingIdFor('AAA'), 'start', 'le commercial a démarré')

  assert.throws(() => h.agenda.armNow('BBB'), /déjà en cours d’enregistrement/)
  assert.throws(() => h.agenda.armNow('BBB'), /elle reste proposée/)

  // And the remedy is real: end the call, and the row starts.
  h.orchestrator.dispatch(meetingIdFor('AAA'), 'end', 'le commercial a terminé')
  await h.agenda.tick({ now: T0 + HOUR + 60_000 })
  assert.equal(h.agenda.armNow('BBB').meetingId, meetingIdFor('BBB'))
  h.store.close()
})

/**
 * **« One conversation, one offer » was unreachable on the calendar path — the
 * primary one (HR-9).**
 *
 * `#adHocSpent` is the field that makes the suppression a decision about the
 * *conversation* rather than a pause keyed on an instant. It was latched inside
 * `if (!calendarOffered)`, and on a calendar-armed call a calendar offer stands
 * for the whole call — so the branch never ran and the latch was never written
 * on the path it exists for.
 *
 * What the rep got, one minute after the most ordinary gesture in the product:
 * they join their 14:00 call, are offered it, record it, press *Terminer* at
 * 14:20 and keep talking. `calendarOffered` goes false for the first time, the
 * branch finally runs, and by then nothing is live — so the detector offers the
 * same conversation again. The day holds two rows for one call, the second
 * wearing the screen's one filled *Enregistrer*, and a second OS notification
 * fires whose click navigates them off the compte-rendu being written.
 *
 * `AdHocInput.spent`'s own docblock names this scenario as the thing the field
 * closes. It did not, for as long as the field has existed.
 */
test('a calendar call that ends mid-slot is not re-offered as an unplanned one', async () => {
  const h = harness([event('AAA')], 'Teams', 'Teams')
  await h.agenda.tick({ now: T0 - 60_000 })

  const meetingId = meetingIdFor('AAA')
  assert.equal(h.agenda.snapshot().armed?.meetingId, meetingId, 'l’appel du calendrier n’a pas été proposé')

  // Recorded, then finished well inside the slot — with the rep still talking.
  h.orchestrator.dispatch(meetingId, 'start', null)
  h.orchestrator.dispatch(meetingId, 'end', null)

  // Long enough after that the ad-hoc dwell is satisfied several times over.
  await h.agenda.tick({ now: T0 + 20 * 60_000 + AD_HOC_DWELL_MS })
  await h.agenda.tick({ now: T0 + 26 * 60_000 })

  assert.equal(
    h.armed.length,
    1,
    `la même conversation a été proposée ${h.armed.length} fois : ${JSON.stringify(h.armed)}`,
  )
  assert.equal(h.agenda.snapshot().armed, null, 'une réunion terminée est encore proposée')
  h.store.close()
})

/**
 * **`AgendaSnapshot.armed` is « the meeting currently offered », and it was
 * « the last meeting this agenda touched, while the hold lasts ».**
 *
 * `#armed` is cleared when the hold drops, and the hold outlives the meeting.
 * Between *Terminer* and the rep hanging up, the field named a meeting the
 * orchestrator calls `ended` — and the screen believed it: `buildEntries` set
 * `entry.armed` beside `past`, so a conversation just recorded drew a « Prêt »
 * state dot and an *Enregistrer* button under **Passées**. HR-7 says armed is an
 * offer, never a recording; this was an offer to record something already
 * recorded.
 *
 * The ad-hoc path is the one that reaches it, because there is no calendar event
 * whose end can clear the note.
 */
test('a snapshot never offers a meeting the machine calls ended', async () => {
  const h = harness([], 'Teams', 'Teams')
  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })

  const offered = h.agenda.snapshot().armed
  assert.ok(offered, 'l’appel hors calendrier n’a pas été proposé')

  h.orchestrator.dispatch(offered.meetingId, 'start', null)
  h.orchestrator.dispatch(offered.meetingId, 'end', null)

  // The rep is still on the call: the hold has not dropped.
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 60_000 })

  assert.equal(
    h.agenda.snapshot().armed,
    null,
    'une réunion terminée est encore annoncée comme proposée tant que le micro est tenu',
  )
  h.store.close()
})

/**
 * **The sentence written for the no-Microsoft branch was never observable.**
 *
 * `main.ts` passes `initialReason` — « aucun calendrier connecté — les appels en
 * cours sont détectés sans lui » — in the branch built over `NULL_CALENDAR`,
 * and `#tick` overwrote it from `nextArmable` before `#publish` had ever run. So
 * the published snapshot only ever carried « aucune réunion dans la fenêtre »:
 * true, and on a build with no calendar at all, useless. It describes a window
 * the rep cannot fill and says nothing about the detector still running — which
 * is the one thing that branch needs said, on the build DEC-28 makes the first
 * deliverable.
 *
 * Bounded to a fold that holds nothing, so a real calendar takes the line back
 * on its first event.
 */
test('a build with no calendar keeps saying why, in every snapshot', async () => {
  const h = harness([], null, null)
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    meetingSignal: () => ({ running: null, inCall: null }),
    clock: () => T0,
    onChanged: (s) => void h.snapshots.push(s),
    initialReason: 'aucun calendrier connecté — les appels en cours sont détectés sans lui',
  })

  await agenda.tick({ now: T0 })
  await agenda.tick({ now: T0 + 60_000 })

  assert.equal(
    agenda.snapshot().reason,
    'aucun calendrier connecté — les appels en cours sont détectés sans lui',
    'la phrase de la branche sans Microsoft a été écrasée au premier tick',
  )
  assert.ok(
    h.snapshots.every(
      (s) => s.reason === 'aucun calendrier connecté — les appels en cours sont détectés sans lui',
    ),
    `une phrase publiée dit autre chose : ${JSON.stringify(h.snapshots.map((s) => s.reason))}`,
  )
  h.store.close()
})

/** And a real calendar takes the line back the moment it holds anything. */
test('one event is enough for nextArmable to own the sentence again', async () => {
  const h = harness([event('AAA')], null, null)
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    meetingSignal: () => ({ running: null, inCall: null }),
    clock: () => T0,
    initialReason: 'aucun calendrier connecté — les appels en cours sont détectés sans lui',
  })

  await agenda.tick({ now: T0 - 60_000 })

  assert.notEqual(
    agenda.snapshot().reason,
    'aucun calendrier connecté — les appels en cours sont détectés sans lui',
    'la phrase de repli masque la vraie réponse d’un calendrier qui a des événements',
  )
  h.store.close()
})

/**
 * **A meeting the rep placed here claims its own conversation.**
 *
 * `#calendarOffersAt` and `#spent` both read `this.#window.events` — Graph — so
 * on the build with no Entra registration, which DEC-28 makes the first
 * deliverable and DEC-31 writes the calendar for, the only meetings that exist
 * claimed nothing. Driven: the rep makes their 14:30 in the app, joins Teams at
 * 14:29, and « Appel non planifié — Teams » armed instead and took the
 * notification. The day held two rows for one conversation and the anonymous one
 * — no client, no subject, no account resolution, no VSA link, no Outlook
 * recipients — wore the screen's only filled *Enregistrer*.
 *
 * Top finding on that surface for three consecutive rounds, and a round was lost
 * to a note of mine claiming the bound it needs did not exist. It does:
 * `AD_HOC_NOMINAL_MS`, argued in `adHoc.ts` for exactly this class of object.
 */
test('a meeting the rep placed in the app stops the detector offering a second one', async () => {
  const h = harness([], 'Teams', 'Teams')
  const mine = h.orchestrator.create({
    id: 'm-mine',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0,
  })
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    meetingSignal: () => ({ running: 'Teams', inCall: 'Teams' }),
    clock: () => T0,
    onArmed: (a) => void h.armed.push(a),
  })

  await agenda.tick({ now: T0 - 60_000 })
  await agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
  await agenda.tick({ now: T0 + 60_000 })

  /*
   * **One offer, and it is the rep's own meeting.**
   *
   * The first version of this test asserted `[]` — no offer at all — because
   * only half the fix existed: `ownClaims` silenced the detector and nothing
   * armed what it had deferred to. That shipped for a round and the next review
   * priced it as a regression, correctly: on the build DEC-28 makes the first
   * deliverable the product noticed the call and then did nothing about it. An
   * assertion written against half a feature is an assertion that defends the
   * half.
   */
  assert.deepEqual(
    h.armed.map((a) => a.subject),
    ['Néovia Santé'],
    `attendu une seule offre, celle du commercial : ${JSON.stringify(h.armed)}`,
  )
  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'armed',
    'la réunion que le commercial a placée n’est pas proposée',
  )
  h.store.close()
})

/** And a caller that wires nothing keeps exactly the old behaviour. */
test('without the port the unscheduled detector is unchanged', async () => {
  const h = harness([], 'Teams', 'Teams')
  h.orchestrator.create({ id: 'm-mine', title: 'Néovia Santé', clientName: null, scheduledStart: T0 })

  await h.agenda.tick({ now: T0 })
  await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })

  assert.equal(h.armed.length, 1, 'le détecteur ne propose plus rien sans le port')
  h.store.close()
})

/**
 * **An offer the rep never took is taken back — and the one the own-meeting site
 * makes had no exit at all.**
 *
 * The calendar's withdrawal is guarded `#armed.eventId !== null`, written when
 * `eventId: null` meant « ad-hoc » and `#adHocArmed` handled that separately. It
 * no longer does: `null` now means an ad-hoc meeting *or* one the rep placed
 * here, and only the first had a way out.
 *
 * Driven before the fix: `armed` at T+150, ninety minutes past the bound
 * `ownClaims` itself applies. And it did not stop there — `live` is true every
 * tick while a meeting is armed, so `#adHocSpent` latched and the detector was
 * spent for the life of the process; `armed` is in `UPDATE_BLOCKING_STATES`, so
 * every installer was refused with « une réunion est sur le point de démarrer »
 * about a call that never happened; and the row survived a relaunch, because it
 * is in the store.
 */
/*
 * **The microphone, read the way `decideArming` reads it.**
 *
 * Five of the nine applications `MEETING_APPS` supports are `micOnly` — a
 * browser tab, a Slack huddle, Aircall, FaceTime — and `matchMeetingApp`
 * refuses to name them, because they are open all day. They hold the
 * microphone and never produce `meetingAudio`. The calendar path has always
 * armed on that alone; the site that arms a meeting the rep placed here read
 * `running` only, so on those five the rep's own row never armed at all.
 *
 * The harness's own default is why nothing caught it: `harness([], null, 'Teams')`
 * puts a string in `running` for every fixture that reaches the site, so
 * « `running` is null and the microphone is held » is a shape no test built.
 */
test('a meeting the rep placed here arms on a call the machine cannot name', async () => {
  const h = harness([], null, 'Navigateur')
  const mine = h.orchestrator.create({
    id: 'm-mine',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0,
  })
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    // A Google Meet tab: nothing to report by name, the microphone held.
    meetingSignal: () => ({ running: null, inCall: 'Navigateur' }),
    clock: () => T0,
  })

  /*
   * **One tick is not a call, and this test used to take it for one.**
   *
   * The named offer requires `AD_HOC_DWELL_MS` of continuous hold, for the
   * reason `decideAdHoc` requires it of the anonymous one: a microphone held for
   * an instant is a dictation, a voice note, a browser tab. The first version of
   * this test ticked once and asserted the arm, so it passed against a site that
   * armed a client's meeting on any hold at all.
   */
  await agenda.tick({ now: T0 - 60_000 })
  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'idle',
    'un micro tenu un instant a suffi à proposer la réunion d’un client',
  )

  await agenda.tick({ now: T0 - 60_000 + AD_HOC_DWELL_MS })

  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'armed',
    'la réunion placée n’arme pas sur un appel navigateur : rien à enregistrer en une pression',
  )
  assert.equal(agenda.snapshot().armed?.meetingId, mine.id)
  h.store.close()
})

/*
 * **And the hold has to be this meeting's, which is what the fix above cost.**
 *
 * `ownClaims` claims a hundred and ten minutes. Reading « is anything holding a
 * microphone » across all of it arms a meeting under a client's name for any
 * blip in that window — driven, a sixty-second voice note seventy-five minutes
 * past the slot did it. That raises DEC-46's notification about a meeting that
 * is not starting, takes the day's one filled *Enregistrer*, and if the rep
 * accepts it the compte-rendu and the VerySwing task go to a client who was not
 * on the call, through a POST with no idempotency key and no delete verb.
 *
 * A hold that *begins* past `OVERRUN_GRACE_MS` is another conversation, which is
 * the boundary `#over` already uses. `decideAdHoc` offers that one anonymously,
 * and the assertion below is that it does — refusing the named offer must not
 * cost the rep the anonymous one.
 */
/*
 * **The other direction of `#recorded`, at the site that had never been asked.**
 *
 * `a calendar call that ends mid-slot is not re-offered as an unplanned one`
 * pins this for an invite, and patching `#recorded` there goes red. The
 * rep-placed site had no equivalent: replace the whole predicate with
 * `const recorded = false` and the suite stayed green — 77 tests and 2084 in
 * total, on the line the commit that introduced it was named after.
 *
 * Driven, that is a rep who records their own placed call and presses
 * *Terminer* while still talking being offered **the same conversation a second
 * time** ninety minutes later, anonymously, with a second OS notification and a
 * second row on the day. « One conversation, one offer » is documented four
 * times in `Agenda.ts` and was held at neither end of this branch.
 */
test('a call the rep placed and recorded is not re-offered as an unplanned one', async () => {
  const h = harness([], 'Teams', 'Teams')
  const mine = h.orchestrator.create({
    id: 'm-mine',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0,
  })
  const armed: { subject: string }[] = []
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    meetingSignal: () => ({ running: 'Teams', inCall: 'Teams' }),
    clock: () => T0,
    onArmed: (a) => void armed.push(a),
  })

  await agenda.tick({ now: T0 - 60_000 })
  assert.equal(h.orchestrator.stateOf(mine.id), 'armed', 'la réunion placée n’a pas été proposée')

  // Recorded, then finished well inside the slot — with the rep still talking.
  h.orchestrator.dispatch(mine.id, 'start', null)
  h.orchestrator.dispatch(mine.id, 'end', null)

  // Past `AD_HOC_NOMINAL_MS + OVERRUN_GRACE_MS`, and the microphone never drops.
  for (let at = T0; at < T0 + 95 * 60_000; at += 5 * 60_000) {
    await agenda.tick({ now: at })
  }
  await agenda.tick({ now: T0 + 95 * 60_000 + AD_HOC_DWELL_MS })

  assert.equal(
    armed.length,
    1,
    `la même conversation a été proposée ${armed.length} fois : ${JSON.stringify(armed.map((a) => a.subject))}`,
  )
  h.store.close()
})

test('a voice note long after the slot is not the meeting it lands inside', async () => {
  const h = harness([], null, null)
  const mine = h.orchestrator.create({
    id: 'm-mine',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0,
  })
  let held: string | null = null
  const armed: { subject: string }[] = []
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    meetingSignal: () => ({ running: null, inCall: held }),
    clock: () => T0,
    onArmed: (a) => void armed.push(a),
  })

  // Nothing at all through the slot itself: the rep never took this meeting.
  for (let at = T0 - 10 * 60_000; at < T0 + 70 * 60_000; at += 5 * 60_000) {
    await agenda.tick({ now: at })
  }
  assert.equal(h.orchestrator.stateOf(mine.id), 'idle', 'rien ne tenait le micro')

  // A Slack voice message at T0+75, inside `ownClaims`' eighty minutes past the anchor.
  const note = T0 + 75 * 60_000
  held = 'Slack'
  await agenda.tick({ now: note })
  await agenda.tick({ now: note + AD_HOC_DWELL_MS })
  await agenda.tick({ now: note + 60_000 })

  assert.notEqual(
    h.orchestrator.stateOf(mine.id),
    'armed',
    'une note vocale a proposé la réunion d’un client 75 minutes après son créneau',
  )
  assert.ok(
    !armed.some((a) => a.subject === 'Néovia Santé'),
    `notification DEC-46 pour une réunion qui ne démarre pas : ${JSON.stringify(armed.map((a) => a.subject))}`,
  )
  /*
   * And the anonymous offer still arrives — the refusal above must cost the rep
   * nothing. This is the offer that is correct for a conversation nothing on the
   * calendar accounts for.
   */
  assert.ok(
    armed.some((a) => a.subject.startsWith('Appel non planifié')),
    `le détecteur ne propose plus rien non plus : ${JSON.stringify(armed.map((a) => a.subject))}`,
  )
  h.store.close()
})

/*
 * **The origin bound is a boundary, and for three rounds nothing held it.**
 *
 * `#accountingOwnClaims` refuses a placed meeting when the microphone hold
 * *began* too long after the anchor — the rule that stops a voice note seventy-
 * five minutes past a slot arming a client's meeting. The rule is right and the
 * number was never chosen: it was `OVERRUN_GRACE_MS`, picked by analogy to
 * « the same boundary `#over` uses », and `#over` reads
 * `event.context.scheduledEnd`, which a meeting with `eventId === null` does not
 * have and cannot have — `Meeting` carries no `scheduledEnd` at all. So the
 * analogy named a boundary that is unreachable for exactly the meetings this
 * filter runs on, and the product refused the rep's own meeting for any client
 * who joined more than twenty minutes late.
 *
 * Driven before the change, on the shipped class: a client dialling a browser
 * link at 14:55 for a 14:30 meeting got « Appel non planifié — Navigateur »
 * with `clientName: null`, while the named row sat `idle`; pressing the named
 * row armed it and then refused to start, leaving `liveStates` at
 * `["recording","armed"]` — which blocks every installer and is escapable only
 * by stopping the recording that is under way.
 *
 * The number now comes from the product's own statement of how long an
 * unplanned conversation runs. `ownClaims` holds the *slot* live for
 * `AD_HOC_NOMINAL_MS + OVERRUN_GRACE_MS` past the anchor and assumes exactly
 * `AD_HOC_NOMINAL_MS` of duration when it synthesises one
 * (`adHoc.ts`'s `scheduledEnd: heldSince + AD_HOC_NOMINAL_MS`). So: the slot is
 * live for eighty minutes, a hold that *begins* inside the first sixty is this
 * conversation, and one beginning in the last twenty is another call that
 * merely overlaps the tail.
 *
 * The two assertions are one minute either side of that line, as literals. A
 * bound widened to the slot's own eighty minutes fails the second; a bound left
 * at twenty fails the first. Both were green before this test existed.
 */
test('a client who joins late is still the meeting the rep placed', async () => {
  const run = async (lateMin: number) => {
    const h = harness([], null, null)
    const mine = h.orchestrator.create({
      id: 'm-mine',
      title: 'Néovia Santé',
      clientName: 'Néovia Santé',
      scheduledStart: T0,
    })
    let held: string | null = null
    const armed: { subject: string }[] = []
    const agenda = new Agenda({
      calendar: h.calendar,
      orchestrator: h.orchestrator,
      ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
      // A browser link: `running` is null, so this is the `micOnly` class the
      // bound actually bites on — Meet, a Teams web join, Livestorm, Aircall.
      meetingSignal: () => ({ running: null, inCall: held }),
      clock: () => T0,
      onArmed: (a) => void armed.push(a),
    })

    // Nobody holds a microphone through the slot itself: the client is late.
    const join = T0 + lateMin * 60_000
    for (let at = T0 - 10 * 60_000; at < join; at += 5 * 60_000) {
      await agenda.tick({ now: at })
    }
    held = 'Navigateur'
    await agenda.tick({ now: join })
    await agenda.tick({ now: join + AD_HOC_DWELL_MS })
    await agenda.tick({ now: join + 60_000 })

    const state = h.orchestrator.stateOf(mine.id)
    h.store.close()
    return { state, subjects: armed.map((a) => a.subject) }
  }

  const inside = await run(59)
  assert.equal(
    inside.state,
    'armed',
    `un client en retard de 59 minutes perd sa réunion nommée : ${JSON.stringify(inside.subjects)}`,
  )
  assert.ok(
    inside.subjects.includes('Néovia Santé'),
    `la notification DEC-46 ne nomme pas le client : ${JSON.stringify(inside.subjects)}`,
  )

  /*
   * And the subject of the bound is when the hold **began**, not when the tick
   * that arms it runs. A hold starting at 59:40 arms, though `#arm` itself
   * lands one `AD_HOC_DWELL_MS` later at 60:05 — past the line. Reading `now`
   * there instead of `#heldSince` is a mutation the 59/61 probes above cannot
   * see, because they straddle a sensitivity only twenty-five seconds wide, and
   * it stayed green on 1284 node tests and twelve gates. The docblock names
   * `#heldSince` as load-bearing three times; this is the assertion that makes
   * that true.
   */
  const straddling = await run(59 + 40 / 60)
  assert.equal(
    straddling.state,
    'armed',
    `la prise du micro est datée du tick, pas du début de la tenue : ${JSON.stringify(straddling.subjects)}`,
  )

  const outside = await run(61)
  assert.notEqual(
    outside.state,
    'armed',
    'un micro pris 61 minutes après le créneau a proposé la réunion d’un client',
  )
  // And the refusal costs the rep nothing: the anonymous offer is the right one
  // for a conversation nothing accounts for.
  assert.ok(
    outside.subjects.some((s) => s.startsWith('Appel non planifié')),
    `le détecteur ne propose plus rien non plus : ${JSON.stringify(outside.subjects)}`,
  )
})

/*
 * **Which of two meetings the rep is in — and every fixture here had one.**
 *
 * `#accountingOwnClaims` decides which conversation a held microphone belongs
 * to, and until this test every fixture at this site created exactly one
 * rep-placed meeting. A rule whose whole subject is *which* of several
 * claimants wins cannot be exercised by a fixture with one claimant, so three
 * decisions that route a conversation to a client had no instrument at all:
 * the origin bound, the direction `ownClaims` sorts, and which claimant the arm
 * loop takes. Two mutations of those stayed green on 1284 node tests, 808
 * renderer tests and twelve gates.
 *
 * The defect it was hiding, driven on the shipped class: a rep with a 14:00
 * that no-showed joins their 14:30 call on a browser link, and the product arms
 * **14:00** — because `ownClaims` sorts earliest-first and the loop took the
 * head. Widening the origin bound to `AD_HOC_NOMINAL_MS` tripled the window
 * that mis-attribution lives in and put the canonical half-hour ESN slot inside
 * it.
 *
 * Thirty, forty-five and sixty minutes, because thirty is the slot this product
 * is built for and sixty is the bound's own edge. The earlier meeting is never
 * recorded on purpose — `AFTER_THE_CALL` already removes a recorded one, so the
 * biting case is the ordinary one: a no-show, an internal call, anything the rep
 * did not press *Enregistrer* on.
 */
test('the rep is in the slot they reached last, not the earliest still claiming', async () => {
  const run = async (gapMin: number) => {
    const h = harness([], null, null)
    const earlier = h.orchestrator.create({
      id: 'm-earlier',
      title: 'Aurexia',
      clientName: 'Aurexia',
      scheduledStart: T0,
    })
    const later = h.orchestrator.create({
      id: 'm-later',
      title: 'Néovia Santé',
      clientName: 'Néovia Santé',
      scheduledStart: T0 + gapMin * 60_000,
    })
    let held: string | null = null
    const armed: { subject: string }[] = []
    const agenda = new Agenda({
      calendar: h.calendar,
      orchestrator: h.orchestrator,
      ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
      meetingSignal: () => ({ running: null, inCall: held }),
      clock: () => T0,
      onArmed: (a) => void armed.push(a),
    })

    // The first slot passes with nobody on a call: the rep's 14:00 no-showed.
    const join = T0 + gapMin * 60_000
    for (let at = T0 - 10 * 60_000; at < join; at += 5 * 60_000) {
      await agenda.tick({ now: at })
    }
    // And they join the second one on time.
    held = 'Navigateur'
    await agenda.tick({ now: join })
    await agenda.tick({ now: join + AD_HOC_DWELL_MS })

    const states = {
      earlier: h.orchestrator.stateOf(earlier.id),
      later: h.orchestrator.stateOf(later.id),
    }
    h.store.close()
    return { states, subjects: armed.map((a) => a.subject) }
  }

  for (const gapMin of [30, 45, 60]) {
    const got = await run(gapMin)
    assert.equal(
      got.states.later,
      'armed',
      `à ${gapMin} min d’écart, la réunion que la rep rejoint n’est pas celle qui est proposée : ${JSON.stringify(got)}`,
    )
    assert.notEqual(
      got.states.earlier,
      'armed',
      `à ${gapMin} min d’écart, c’est la réunion précédente qui est proposée — le compte-rendu partirait chez le mauvais client`,
    )
    assert.deepEqual(
      got.subjects,
      ['Néovia Santé'],
      `la notification DEC-46 nomme le mauvais client à ${gapMin} min d’écart : ${JSON.stringify(got.subjects)}`,
    )
  }
})

/*
 * **And the mirror of it: the rep who joins the *earlier* slot and stays there.**
 *
 * The test above builds two claimants and drives one direction — the earlier
 * meeting no-showed, the rep joins the later one. « Which of several claimants
 * wins » has two directions and the fixture could only express one, so the rule
 * shipped reading `now`: the greatest anchor among everything claiming at the
 * instant of the tick.
 *
 * `now` advances under a call that does not. Driven on the shipped class
 * (`scratch/r18-own-offer-replacement.mjs`), the rep joining their 14:00 on a
 * browser link at 13:56 and still on it at 14:25:
 *
 *     14:24  1400=armed 1430=idle
 *     14:25  1400=armed 1430=armed    ← DEC-46 notifies « Néovia Santé »
 *     19:00  1400=armed 1430=idle     updateReadiness { safe: false }
 *
 * Two harms, both priced by the round before this one and both by the same line.
 * The day's one filled *Enregistrer* moves to a client the rep is not talking to,
 * and a press there sends the Aurexia conversation to Néovia's account through a
 * POST with no idempotency key and no delete verb. And the offer it replaced has
 * no withdrawal, which the test below this one holds.
 *
 * Thirty, forty-five and sixty minutes, mirroring the gaps above. The probe is one
 * tick either side of the later slot's `ARM_LEAD_MS`, because that is the instant
 * the two readings diverge — reading `now` fails the second, reading the hold's
 * origin passes both.
 */
test('the offer names the slot the hold began in, not the one now has reached', async () => {
  const run = async (gapMin: number) => {
    const h = harness([], null, null)
    const earlier = h.orchestrator.create({
      id: 'm-earlier',
      title: 'Aurexia',
      clientName: 'Aurexia',
      scheduledStart: T0,
    })
    const later = h.orchestrator.create({
      id: 'm-later',
      title: 'Néovia Santé',
      clientName: 'Néovia Santé',
      scheduledStart: T0 + gapMin * 60_000,
    })
    let held: string | null = null
    const armed: { subject: string }[] = []
    const agenda = new Agenda({
      calendar: h.calendar,
      orchestrator: h.orchestrator,
      ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
      meetingSignal: () => ({ running: null, inCall: held }),
      clock: () => T0,
      onArmed: (a) => void armed.push(a),
    })

    // The rep joins their own first call four minutes early and stays on it.
    const join = T0 - 4 * 60_000
    await agenda.tick({ now: join - 60_000 })
    held = 'Navigateur'
    await agenda.tick({ now: join })
    await agenda.tick({ now: join + AD_HOC_DWELL_MS })

    // One tick a minute across the later slot's own lead, the call still running.
    const opens = T0 + gapMin * 60_000 - ARM_LEAD_MS
    for (let at = join + 60_000; at <= opens + 60_000; at += 60_000) {
      await agenda.tick({ now: at })
    }

    const states = {
      earlier: h.orchestrator.stateOf(earlier.id),
      later: h.orchestrator.stateOf(later.id),
    }
    h.store.close()
    return { states, subjects: armed.map((a) => a.subject) }
  }

  for (const gapMin of [30, 45, 60]) {
    const got = await run(gapMin)
    assert.equal(
      got.states.earlier,
      'armed',
      `à ${gapMin} min d’écart, la conversation en cours a perdu son offre au profit du créneau suivant : ${JSON.stringify(got)}`,
    )
    assert.notEqual(
      got.states.later,
      'armed',
      `à ${gapMin} min d’écart, le créneau suivant a été armé pendant l’appel précédent — le compte-rendu partirait chez le mauvais client`,
    )
    assert.deepEqual(
      got.subjects,
      ['Aurexia'],
      `la notification DEC-46 nomme un client que le commercial n’a pas au téléphone à ${gapMin} min d’écart : ${JSON.stringify(got.subjects)}`,
    )
  }
})

/*
 * **And when the offer *does* move, the one it replaces is taken back.**
 *
 * `#arm` withdraws the ad-hoc offer it overwrites (`#withdrawAdHoc`) and the
 * calendar one (`#withdrawStanding`, which was `#withdrawCalendar` and returned
 * on `eventId === null`). A meeting the rep placed here also carries
 * `eventId: null` and is never in `#adHocArmed`, so it fell through both — the
 * third time this file has recorded a standing offer with no exit, on the fourth
 * path, and the second time on a path that replaced the third.
 *
 * Driven, no Entra: the rep takes their 14:00 on a browser link, hangs up at
 * 14:10, joins their 14:30 at 14:35. The 14:30 arms and the 14:00 stays `armed`
 * for the life of the process and past a relaunch, because the row is in the
 * store. `armed` is in `UPDATE_BLOCKING_STATES`, so every installer is refused
 * with « une réunion est sur le point de démarrer » about a call that ended; and
 * `live` is then true on every tick, so `#adHocSpent` latches and the detector is
 * off for the working day — a genuine unscheduled client call at 19:00 got
 * **zero** offers. Neither is escapable by the rep: `disarm` is dispatched only by
 * this class and is not in `UserCommandSchema`.
 *
 * The unscheduled call at the end is the assertion that matters most, because it
 * is the one the strand costs a recording rather than a dialog.
 */
test('arming the next placed meeting takes back the offer it replaces', async () => {
  const h = harness([], null, null)
  const earlier = h.orchestrator.create({
    id: 'm-earlier',
    title: 'Aurexia',
    clientName: 'Aurexia',
    scheduledStart: T0,
  })
  const later = h.orchestrator.create({
    id: 'm-later',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0 + 30 * 60_000,
  })
  let held: string | null = null
  const armed: { subject: string }[] = []
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    meetingSignal: () => ({ running: null, inCall: held }),
    clock: () => T0,
    onArmed: (a) => void armed.push(a),
  })

  // The 14:00 call: joined four minutes early, hung up at 14:10.
  await agenda.tick({ now: T0 - 5 * 60_000 })
  held = 'Navigateur'
  for (let at = T0 - 4 * 60_000; at <= T0 + 10 * 60_000; at += 60_000) {
    await agenda.tick({ now: at })
  }
  assert.equal(h.orchestrator.stateOf(earlier.id), 'armed', 'le premier créneau n’a jamais été proposé')
  held = null
  for (let at = T0 + 11 * 60_000; at <= T0 + 34 * 60_000; at += 60_000) {
    await agenda.tick({ now: at })
  }

  // And the 14:30 call, five minutes late, which is a new hold and a new slot.
  held = 'Navigateur'
  for (let at = T0 + 35 * 60_000; at <= T0 + 45 * 60_000; at += 60_000) {
    await agenda.tick({ now: at })
  }

  assert.equal(
    h.orchestrator.stateOf(later.id),
    'armed',
    `le créneau que le commercial rejoint n’est pas proposé : ${JSON.stringify(armed.map((a) => a.subject))}`,
  )
  assert.notEqual(
    h.orchestrator.stateOf(earlier.id),
    'armed',
    'l’offre remplacée est restée armée : deux réunions armées à la fois, ' +
      'tout installateur refusé et le détecteur éteint pour la journée',
  )

  // The call ends; nothing is placed for the rest of the day; a real client rings.
  held = null
  for (let at = T0 + 46 * 60_000; at <= T0 + 300 * 60_000; at += 5 * 60_000) {
    await agenda.tick({ now: at })
  }
  held = 'Navigateur'
  for (let at = T0 + 300 * 60_000; at <= T0 + 302 * 60_000; at += 30_000) {
    await agenda.tick({ now: at })
  }
  assert.ok(
    armed.some((a) => a.subject.startsWith('Appel non planifié')),
    `l’appel imprévu de 19 h n’a reçu aucune offre — le détecteur est éteint pour la journée : ${JSON.stringify(armed.map((a) => a.subject))}`,
  )
  h.store.close()
})

/*
 * **Twenty-five seconds, not « more than one tick ».**
 *
 * `AD_HOC_DWELL_MS` is the whole of the safety argument at the named-arm site:
 * `adHoc.ts` spends a page on « a Slack voice message, a dictation, "test your
 * microphone" in Teams' settings, a browser tab asking for permission », and
 * the number that argument produces had no assertion on it here. The test above
 * this one ticks at Δ0 and at Δ`AD_HOC_DWELL_MS`, which pins « more than zero »
 * and nothing else — weakening the guard to `now - heldSince > 0` left all 1282
 * node tests green, and a six-second voice note then armed a client's meeting
 * under the client's name.
 *
 * The middle tick is the assertion. It is a literal and not the constant,
 * because a test that reads the constant it is pinning cannot see the constant
 * move.
 */
/*
 * **An offer that was already standing when the recording began — the one
 * direction `#arm`'s guard cannot reach.**
 *
 * `#arm` refuses to make an offer beside a live recording and spends a docblock
 * on why (« A call under way takes the conversation, and the calendar waits »).
 * It is asked only when an offer is about to be *made*. An offer standing before
 * the rep starts recording something else is nobody's: `#withdrawAdHoc` fires on
 * a change or loss of the microphone hold, and the hold is exactly what does not
 * change when the rep records the call they are already on by another route.
 *
 * Driven on the shipped class, Teams holding the microphone two minutes before
 * the rep presses « Démarrer une réunion » — which `AdHocInput.spent` calls the
 * existing route for an unscheduled call, and the fast one:
 *
 *     liveStates ["armed","recording"]
 *     Réunion=recording | Appel non planifié — Teams=armed
 *     pressing the anonymous row: « une autre réunion est déjà en cours
 *     d’enregistrement »
 *
 * Two rows for one conversation for the length of the call, the day's single
 * filled *Enregistrer* on the one that cannot be started, and the rep's own live
 * recording wearing an outline control below it.
 *
 * Both kinds of offer, because the subject of the rule is « a standing offer »
 * and not « an unscheduled one »: the calendar half reaches it through an invite
 * armed at T−5 and a manual start at T−2, and the two withdrawals are different
 * code paths (`#withdrawAdHoc` owns `#adHocArmed`; `#withdrawStanding` does not).
 */
test('a recording started elsewhere takes back the offer already standing', async () => {
  // ── the unscheduled offer
  {
    const h = harness([], null, 'Teams')
    await h.agenda.tick({ now: T0 })
    await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS })
    assert.ok(h.agenda.snapshot().armed, 'le détecteur n’a rien proposé : ce fixture ne teste rien')

    // « Démarrer une réunion », which is create + start in `main.ts`.
    h.orchestrator.create({ id: 'm-manuel', title: 'Réunion', context: null })
    assert.equal(h.orchestrator.dispatch('m-manuel', 'start', 'le commercial a démarré').ok, true)
    await h.agenda.tick({ now: T0 + AD_HOC_DWELL_MS + 60_000 })

    assert.equal(
      h.agenda.snapshot().armed,
      null,
      'l’offre non planifiée reste proposée à côté de l’enregistrement en cours',
    )
    assert.deepEqual(
      h.orchestrator.liveStates().filter((state) => state === 'armed'),
      [],
      'deux lignes pour une conversation : liveStates vaut ["armed","recording"], ' +
        'et le seul Enregistrer plein du jour est sur celle qui refuse de démarrer',
    )
    h.store.close()
  }

  // ── and the calendar offer, which reaches it by a different withdrawal
  {
    const h = harness([event('AAA')])
    await h.agenda.tick({ now: T0 - 5 * 60_000 })
    assert.equal(h.orchestrator.stateOf(meetingIdFor('AAA')), 'armed')

    h.orchestrator.create({ id: 'm-manuel', title: 'Réunion', context: null })
    assert.equal(h.orchestrator.dispatch('m-manuel', 'start', 'le commercial a démarré').ok, true)
    await h.agenda.tick({ now: T0 - 2 * 60_000 })

    assert.equal(
      h.agenda.snapshot().armed,
      null,
      'l’invitation reste proposée à côté de l’enregistrement en cours',
    )
    assert.notEqual(
      h.orchestrator.stateOf(meetingIdFor('AAA')),
      'armed',
      'l’invitation est restée armée pendant que le commercial enregistre autre chose',
    )
    h.store.close()
  }
})

test('the dwell is twenty-five seconds, not one tick', async () => {
  assert.equal(AD_HOC_DWELL_MS, 25_000, 'le palier a bougé : ce test le tient en clair')

  const h = harness([], null, null)
  const mine = h.orchestrator.create({
    id: 'm-mine',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0,
  })
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    meetingSignal: () => ({ running: null, inCall: 'Navigateur' }),
    clock: () => T0,
  })

  const origin = T0 - 60_000
  await agenda.tick({ now: origin })
  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'idle',
    'un micro tenu un instant a suffi à proposer la réunion d’un client',
  )

  await agenda.tick({ now: origin + 24_000 })
  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'idle',
    'vingt-quatre secondes de micro ont proposé la réunion d’un client : une note vocale suffit',
  )

  await agenda.tick({ now: origin + 25_000 })
  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'armed',
    'le palier de vingt-cinq secondes ne déclenche plus rien',
  )
  h.store.close()
})

/*
 * **A start that failed is not a call the rep recorded.**
 *
 * `aborted` is in `AFTER_THE_CALL` — correctly, *Historique* asks that set « is
 * this behind the rep » — and the hand-back decision was reading the same set to
 * answer « did the rep record this ». `armed → abort` is what a press of
 * *Enregistrer* reaches when there is no transcription provider or no capture,
 * so the rep whose start failed lost the detector for the rest of the call while
 * the rep who pressed nothing kept it.
 *
 * The assertion is that the two now behave the same, which is the whole claim:
 * an abort is a non-event for the detector, not a decision about the
 * conversation. It is deliberately not « hand it back at once » — the offer
 * still stands until `ownClaims`' bound, exactly as it does when nobody presses
 * anything, and making the failed press *better* than silence would be a
 * different decision than this one.
 */
test('a start that failed gives the detector back the call it never recorded', async () => {
  const run = async (abort: boolean) => {
    const h = harness([], 'Teams', 'Teams')
    const mine = h.orchestrator.create({
      id: 'm-mine',
      title: 'Néovia Santé',
      clientName: 'Néovia Santé',
      scheduledStart: T0,
    })
    const armed: { subject: string }[] = []
    const agenda = new Agenda({
      calendar: h.calendar,
      orchestrator: h.orchestrator,
      ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
      meetingSignal: () => ({ running: 'Teams', inCall: 'Teams' }),
      clock: () => T0,
      onArmed: (a) => void armed.push(a),
    })

    await agenda.tick({ now: T0 - 60_000 })
    assert.equal(h.orchestrator.stateOf(mine.id), 'armed')

    /*
     * **Ticks before the press, and they are the whole test.**
     *
     * `#adHocSpent` latches on the top-of-tick liveness of the standing offer,
     * and the arm above happens *after* that line — so a run that aborts on the
     * very next tick never once has the field set, and passes against the
     * unfixed code. The rep presses *Enregistrer* a minute or two into the call,
     * not in the same instant the row lights up.
     */
    for (let at = T0 - 50_000; at < T0; at += 10_000) {
      await agenda.tick({ now: at })
    }

    if (abort) {
      // What *Enregistrer* reaches with no capture device — `Orchestrator.ts:636`.
      h.orchestrator.dispatch(mine.id, 'abort', 'capture indisponible')
      assert.equal(h.orchestrator.stateOf(mine.id), 'aborted')
    }

    // The rep stays on the call. Ticks at the shipped rate would be ~160 of
    // these; five minutes apart reproduces the latch and is cheap.
    for (let at = T0; at < T0 + 95 * 60_000; at += 5 * 60_000) {
      await agenda.tick({ now: at })
    }
    await agenda.tick({ now: T0 + 95 * 60_000 })
    await agenda.tick({ now: T0 + 95 * 60_000 + AD_HOC_DWELL_MS })
    h.store.close()
    return armed.map((a) => a.subject)
  }

  const silent = await run(false)
  const failed = await run(true)

  assert.ok(
    silent.some((subject) => subject.startsWith('Appel non planifié')),
    `le témoin est faux : le rep qui ne presse rien doit être relancé — ${JSON.stringify(silent)}`,
  )
  assert.ok(
    failed.some((subject) => subject.startsWith('Appel non planifié')),
    'après un démarrage en échec le détecteur reste muet pour le reste de l’appel : ' +
      `${JSON.stringify(failed)} contre ${JSON.stringify(silent)} sans la pression`,
  )
})

test('an offer for a meeting the rep placed here expires with the conversation', async () => {
  const h = harness([], 'Teams', null)
  const mine = h.orchestrator.create({
    id: 'm-mine',
    title: 'Néovia Santé',
    clientName: 'Néovia Santé',
    scheduledStart: T0,
  })
  /*
   * **The microphone is held throughout, which is the input the first version of
   * this test pinned shut.**
   *
   * It ran `inCall: null` — the one branch where `#trackHold` clears
   * `#adHocSpent` on every tick — so the half of the harm its own docblock
   * describes could not fail. An assertion written around the part that is not
   * fixed defends the part that is not fixed.
   *
   * Held from before the offer to well past its bound, the way a rep on one long
   * call actually holds it.
   */
  const armed: { subject: string }[] = []
  const agenda = new Agenda({
    calendar: h.calendar,
    orchestrator: h.orchestrator,
    ownMeetings: (from, to) => h.store.projections.listMeetings(200, { from, to }),
    meetingSignal: () => ({ running: 'Teams', inCall: 'Teams' }),
    clock: () => T0,
    onArmed: (a) => void armed.push(a),
  })

  await agenda.tick({ now: T0 - 60_000 })
  assert.equal(h.orchestrator.stateOf(mine.id), 'armed', 'la réunion placée n’a pas été proposée')

  /*
   * **The ticks in between, which are the whole of what this test was missing.**
   *
   * The first version jumped straight from the arm to T+90 — two ticks — and on
   * neither of them does `#adHocSpent` latch: the arm happens *after* the latch
   * line, and by T+90 the withdrawal above has already run and nothing is live.
   * So the field this test's last assertion is about was never once true, and the
   * assertion passed against the unfixed code. A schedule that skips the state
   * that causes the harm is the same defect as an input that pins it shut, which
   * is what the note above the signal records.
   *
   * The shipped `Agenda` ticks on `SYNC_INTERVAL_MS`, so an 80-minute stale
   * offer is ~160 ticks with a meeting `armed`, every one of them spending the
   * detector. Five minutes apart is enough to reproduce that and cheap.
   */
  // Up to, not past, the bound: `AD_HOC_NOMINAL_MS + OVERRUN_GRACE_MS` is 80
  // minutes, so these sixteen ticks all run with the offer still standing.
  for (let at = T0; at < T0 + 75 * 60_000; at += 5 * 60_000) {
    await agenda.tick({ now: at })
  }
  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'armed',
    'l’offre placée devait tenir jusqu’à sa borne',
  )

  // Past `AD_HOC_NOMINAL_MS + OVERRUN_GRACE_MS` — the bound `ownClaims` applies.
  await agenda.tick({ now: T0 + 90 * 60_000 })

  assert.equal(
    h.orchestrator.stateOf(mine.id),
    'idle',
    'l’offre survit à la conversation : elle bloque le détecteur et les mises à jour',
  )
  /*
   * Not « armed is null »: with the microphone still held, the detector takes
   * the conversation back the moment the stale offer is withdrawn, so something
   * else legitimately stands here. What must be gone is *this* meeting.
   */
  assert.notEqual(
    agenda.snapshot().armed?.meetingId,
    mine.id,
    'la pastille annonce encore la réunion retirée',
  )

  /*
   * **And the microphone goes back to the detector.**
   *
   * `#adHocSpent` latches on the stale offer's own liveness, once per tick for
   * as long as it stands, and `#trackHold` clears it only on a *change* of hold
   * — so a rep who never puts the call down got nothing for the rest of the
   * process. Driven on the shipped class before the fix: a client call from
   * 15:20 to 17:30 with a 14:30 placed got **zero offers for its whole length**,
   * against a control with nothing placed offered at minute one.
   *
   * Moving the latch below the withdrawal was not enough and this is where that
   * shows: it spares the one tick the withdrawal fires on, and the loop above
   * has already set the field 18 times. `#handBack` clears it at the event.
   */
  await agenda.tick({ now: T0 + 95 * 60_000 })
  await agenda.tick({ now: T0 + 95 * 60_000 + AD_HOC_DWELL_MS })

  assert.ok(
    armed.some((a) => a.subject.startsWith('Appel non planifié')),
    `le micro n’est pas rendu au détecteur après le retrait : ${JSON.stringify(armed.map((a) => a.subject))}`,
  )
  h.store.close()
})
