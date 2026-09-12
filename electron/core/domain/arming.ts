/**
 * "Should the app arm itself for this calendar event, right now?"
 *
 * Pure by construction: a calendar event, a clock reading, and whether a
 * conferencing application is currently making noise. No Graph client, no audio
 * device, no Electron — which is what lets every rule below be tested at an
 * arbitrary instant instead of by waiting for one.
 *
 * Two signals, both required (VISION.md §7). Time alone arms on a meeting the
 * rep skipped; audio alone arms on a YouTube tab. The conjunction is the whole
 * design, and `wait` carries the instant to re-evaluate so nothing polls on a
 * guess.
 *
 * Arming is not recording. It puts the app in reach — a visible, dismissible
 * offer — and a human still starts the meeting (HR-7).
 */
import type { CalendarEvent } from '../contracts/calendar.ts'
import type { ArmingDecision, MeetingContext, Sensitivity } from '../contracts/meeting.ts'
/*
 * Re-exported, not redeclared. It moved to `contracts` because `src/*` may import
 * nothing else and `screens/agenda/entries.ts` has to apply the same grace — see
 * the constant's own docblock. Callers that already import it from here keep
 * working, and there is still exactly one number.
 */
export { OVERRUN_GRACE_MS } from '../contracts/meeting.ts'
import { OVERRUN_GRACE_MS } from '../contracts/meeting.ts'

/**
 * How early the window opens. Five minutes is the interval between "I am about
 * to join" and "I have joined", which is the moment the offer has to already be
 * on screen: a rep who is talking is not looking for a button.
 */
export const ARM_LEAD_MS = 5 * 60_000

/**
 * **How early a scheduled call may be joined and still be that call.**
 *
 * The calendar's *claim* on a conversation is wider than its readiness to *arm* one,
 * and conflating the two is how « one conversation, one offer » was broken for a
 * fourth round. `ARM_LEAD_MS` answers « should the offer be on screen yet »;
 * this answers « is the microphone I can hear the scheduled call ». They are
 * different questions and the second has a longer reach.
 *
 * Measured on the shipped `Agenda`: a rep joining their own 14:30 Teams call
 * **5 min 25 s** early — `ARM_LEAD_MS + AD_HOC_DWELL_MS`, so anything from five and
 * a half minutes — got a *second* offer, « Appel non planifié — Teams », because the
 * ad-hoc detector saw a held microphone that no calendar rule had claimed yet. Take
 * that offer, which is the one the OS notification points at, and at 14:25 the
 * calendar arms the same conversation a second time: `liveStates` becomes
 * `["recording","armed"]`, two rows sit on the day and the second notification's
 * click navigates the rep off their own live recording. Joining early is not an edge
 * case; it is what a sales rep does before a call that matters.
 *
 * Thirty minutes, and the number is chosen from the **asymmetry of being wrong**
 * rather than from a study of behaviour. Too wide and a genuinely unscheduled call
 * taken in the half hour before a meeting gets no offer — a cost with a remedy the
 * rep already has and which is the *fast* route anyway (« Démarrer une réunion »).
 * Too narrow and the product creates a duplicate meeting whose push to VerySwing has
 * no idempotency key and no delete verb. One of those is a missing convenience and
 * the other is a row in a client's system of record.
 *
 * It deliberately does **not** widen `ARM_LEAD_MS`. Arming *on* a held microphone is
 * a claim that this call is that event, and the further from the slot, the weaker it
 * is: a rep on an unrelated call twenty minutes early would be offered the wrong
 * client's objet. So the calendar stays silent until its own lead, and what this
 * changes is only that the ad-hoc detector stops speaking over it.
 */
export const CALENDAR_CLAIM_MS = 30 * 60_000

/**
 * Does the calendar already account for a call happening **now**?
 *
 * The one fact `decideAdHoc` cannot work out for itself, and the reason it is here
 * rather than in `adHoc.ts` is that it is a statement about *events* — cancelled and
 * all-day entries are not calls to record, and that rule is already written down in
 * `nextArmable` one screen below. Returning the event rather than a boolean so the
 * caller can take the **horizon** from it: the offer the rep should get is the
 * calendar's, and it becomes available at `scheduledStart - ARM_LEAD_MS`.
 */
export const calendarClaim = (
  events: readonly CalendarEvent[],
  now: number,
): CalendarEvent | null => {
  let claim: CalendarEvent | null = null
  for (const event of events) {
    if (event.isCancelled || event.isAllDay) continue
    const { scheduledStart, scheduledEnd } = event.context
    if (now < scheduledStart - CALENDAR_CLAIM_MS) continue
    if (now >= scheduledEnd + OVERRUN_GRACE_MS) continue
    // The earliest claimant, for the same reason `nextArmable` prefers it: the
    // conversation the rep is in is the one whose slot they reached first.
    if (!claim || scheduledStart < claim.context.scheduledStart) claim = event
  }
  return claim
}

/**
 * How often to re-ask, once the window is open and no conferencing app is up
 * yet.
 *
 * This exists because the second signal is a **poll**, not a subscription:
 * `modules/capture/MeetingApps.ts` shells out to `ps`/`tasklist`, and nothing
 * anywhere calls `Agenda.tick` when that list changes. A horizon further out
 * than this is a promise to notice something at an instant when nothing will
 * have been looked at.
 *
 * Twenty seconds against a five-minute lead: a rep who opens Teams at the last
 * moment still gets the offer with four and a half minutes to spare, and the
 * cost is one short-lived process every twenty seconds for at most the length of
 * the slot — which `MeetingApps`'s own fifteen-second cache then damps, a cache
 * that until now could never hit because its only caller ran every five minutes.
 *
 * It is deliberately **not** the sleep ceiling's job. `MAX_SLEEP_MS` exists for a
 * suspended laptop and must stay a ceiling; a decision that wants to be asked
 * again sooner has to say so itself, or every future caller inherits whatever
 * the ceiling happens to be.
 */
export const ARM_POLL_MS = 20_000


/**
 * Longer than this and it is a working block, not a call.
 *
 * All-day events are the case that matters. Their window would otherwise open
 * five minutes before midnight and stay open for twenty-four hours, at which
 * point *any* conferencing audio that day arms against the wrong event. The
 * calendar module drops all-day events for the same reason; this is the second
 * of the two guards, because it also catches the six-hour "atelier" that is
 * genuinely on the calendar as one event.
 */
export const MAX_ARMABLE_DURATION_MS = 4 * 60 * 60_000

/**
 * Never read, never armed on, never transcribed.
 *
 * Outlook's sensitivity flag is the one place a user gets to say "this is not
 * for tooling", and a notetaker that ignores it is a notetaker that transcribes
 * an HR conversation. There is no override.
 */
const PRIVATE: ReadonlySet<Sensitivity> = new Set(['private', 'confidential'])

/** The fields of a `MeetingContext` this decision actually reads. */
export type ArmableEvent = Pick<
  MeetingContext,
  'sensitivity' | 'scheduledStart' | 'scheduledEnd' | 'attendees' | 'onlineMeetingJoinUrl'
>

export interface ArmingInput {
  event: ArmableEvent
  now: number
  /**
   * The conferencing application that is *running* right now, or null. Supplied
   * by `modules/capture/` — this file must not know how that is detected, only
   * that it is a name or nothing.
   *
   * Weak by construction: Teams starts with Windows and stays open all day, so
   * on most machines this is a constant. It is nonetheless the only signal that
   * exists **before** a call begins, which is what `ARM_LEAD_MS` is for.
   */
  meetingAudio: string | null
  /**
   * The conferencing application *holding a microphone* right now, or null — a
   * call that is actually happening, rather than an application that is open.
   *
   * Optional because a binary built before `mic_apps.rs` existed cannot answer
   * it, and the absence has to mean « we did not measure it » rather than « no
   * call » (DEC-45). Every rule below that reads it therefore only ever *adds*
   * arming; none withholds it on a null.
   */
  micHeldBy?: string | null
}

export const decideArming = (input: ArmingInput): ArmingDecision => {
  const { event, now, meetingAudio, micHeldBy = null } = input

  if (PRIVATE.has(event.sensitivity)) {
    return { action: 'skip', reason: 'événement marqué privé dans Outlook' }
  }

  // A block with nobody in it and nowhere to join is a reminder the rep wrote
  // for themselves. Transcribing it is noise, and worse, it would consume the
  // one meeting the rep expected to be armed for.
  if (event.attendees.length === 0 && !event.onlineMeetingJoinUrl) {
    return { action: 'skip', reason: 'aucun participant ni lien de réunion' }
  }

  if (event.scheduledEnd - event.scheduledStart > MAX_ARMABLE_DURATION_MS) {
    return { action: 'skip', reason: 'plage trop longue pour être une réunion' }
  }

  /*
   * **A call that runs over has not finished, and this used to say it had.**
   *
   * DEC-9 says in as many words that sales calls overrun constantly. The rule
   * here was `now >= scheduledEnd → skip`, so auto-arming stopped at the
   * scheduled minute — and `DayPane` gates its manual control on the same
   * instant, so at 14:31 on a 14:00–14:30 slot a rep had neither. What they had
   * instead was « Démarrer une réunion », which creates a meeting with no
   * `eventId`: no attendees, no « Interlocuteurs » on the header, no chance for
   * `speakerLabel` to name the far channel after a person rather than « Client »,
   * and the strongest signal account resolution has, all dropped — at the moment
   * the conversation is going *well enough to run late*.
   *
   * The microphone signal is what makes this safe to relax. « The slot ended »
   * is a schedule; « a conferencing app is holding a microphone » is the call
   * still happening. Extending on a clock alone would arm the 14:00 event over
   * the 15:00 one; extending only while the evidence says a call is live cannot.
   *
   * Bounded all the same: a rep who leaves Teams in a call over lunch is not in
   * this meeting, and the grace is deliberately shorter than a slot.
   */
  if (now >= event.scheduledEnd) {
    const overrunning = micHeldBy !== null && micHeldBy !== undefined
    if (!overrunning) {
      return { action: 'skip', reason: 'événement terminé' }
    }
    if (now >= event.scheduledEnd + OVERRUN_GRACE_MS) {
      return { action: 'skip', reason: 'événement terminé depuis trop longtemps' }
    }
    return { action: 'arm', reason: `${micHeldBy} émet du son après l’heure prévue` }
  }

  const opensAt = event.scheduledStart - ARM_LEAD_MS
  if (now < opensAt) {
    return { action: 'wait', untilMs: opensAt, reason: 'la fenêtre n’est pas encore ouverte' }
  }

  /*
   * **Inside the window and still silent — and this is where the five-minute
   * lead was being thrown away.**
   *
   * This used to hand back `event.scheduledEnd`, on the argument that « nothing
   * *time-based* will change this before the event ends — the next input is an
   * audio event ». **There is no audio event.** Nothing anywhere calls
   * `Agenda.tick` on a change in the process list; the only callers outside
   * tests are the loop itself and two rep-initiated IPC handlers. So the horizon
   * named an instant an hour away at which, by construction, the answer would
   * already be `skip` — and the only thing left choosing the delay was
   * `Agenda`'s `MAX_SLEEP_MS` ceiling, five minutes, which is the whole of
   * `ARM_LEAD_MS`.
   *
   * Measured over a simulated day: Teams launched at 14:26 for a 14:30 call, the
   * window open since 14:25, and the offer arrived at **14:30:00** — 240 seconds
   * late, worst case 299. DEC-46 and `ARM_LEAD_MS` above both exist to put the
   * offer on screen *before* the rep joins, because « a rep who is talking is
   * not looking for a button », and it was arriving as they said hello.
   *
   * The signal being waited on is **polled, not pushed**, so the horizon has to
   * be a poll interval. That is the honest statement of what this branch knows:
   * not « wake me when the event ends », but « ask again shortly, because the
   * thing that decides this is a process list nobody will tell us about ».
   */
  /*
   * Either signal satisfies the conjunction, and the strong one is named first.
   *
   * `micHeldBy` non-null implies a conferencing app is running, so this is not a
   * new case so much as a better *sentence*: « Teams est ouvert » and « Teams
   * émet du son » are different facts, and the reason string is read by a rep in
   * the agenda's empty state. It also covers the `micOnly` applications — a
   * browser tab, a Slack huddle, Aircall — which `matchMeetingApp` refuses to
   * report by name because they are open all day, and which therefore never
   * produce `meetingAudio` at all.
   */
  if (micHeldBy) {
    return { action: 'arm', reason: `${micHeldBy} émet du son` }
  }

  if (!meetingAudio) {
    return {
      action: 'wait',
      untilMs: now + ARM_POLL_MS,
      reason: 'aucune application de réunion n’émet de son',
    }
  }

  return { action: 'arm', reason: `${meetingAudio} est ouvert` }
}

/** Which event the app is offering to record, and why — or why it is offering none. */
export interface ArmingChoice {
  event: CalendarEvent | null
  decision: ArmingDecision
}

/**
 * The same decision over a whole day.
 *
 * Two events can be armable at once — back-to-back calls overlap by their lead
 * time, and double-booking is normal in sales. The earlier start wins, because
 * that is the call the rep is in; the later one arms on its own once this one is
 * over.
 *
 * When nothing arms, the **earliest** `wait` horizon is returned rather than the
 * first one found. A caller that sets a timer from anything else sleeps through
 * the meeting that was about to open.
 */
export const nextArmable = (
  events: readonly CalendarEvent[],
  now: number,
  meetingAudio: string | null,
  micHeldBy: string | null = null,
): ArmingChoice => {
  let armed: ArmingChoice | null = null
  /*
   * An event armed only by `OVERRUN_GRACE_MS` is kept apart and loses to any
   * event whose slot actually contains `now`.
   *
   * Without the split, a 14:00–15:00 call running over to 15:05 would beat the
   * 15:00–16:00 call on « the earlier start wins », and the rep would be offered
   * the conversation they have just left instead of the one they are in. The
   * microphone is held either way, so the signal cannot separate them — only the
   * clock can, and this is the one place that knows both slots.
   */
  let overrun: ArmingChoice | null = null
  let waiting: ArmingChoice | null = null

  for (const event of events) {
    // Cancelled and all-day entries stay in the window so the UI can show them;
    // neither is ever a call to record.
    if (event.isCancelled || event.isAllDay) continue

    const decision = decideArming({ event: event.context, now, meetingAudio, micHeldBy })
    if (decision.action === 'arm') {
      const isOverrun = now >= event.context.scheduledEnd
      const slot = isOverrun ? 'overrun' : 'current'
      const held = slot === 'overrun' ? overrun : armed
      if (!held || event.context.scheduledStart < (held.event?.context.scheduledStart ?? Infinity)) {
        if (slot === 'overrun') overrun = { event, decision }
        else armed = { event, decision }
      }
      continue
    }
    if (decision.action === 'wait') {
      const current = waiting?.decision
      if (!current || (current.action === 'wait' && decision.untilMs < current.untilMs)) {
        waiting = { event, decision }
      }
    }
  }

  if (armed) return armed
  if (overrun) return overrun
  if (waiting) return waiting
  return { event: null, decision: { action: 'skip', reason: 'aucune réunion dans la fenêtre' } }
}
