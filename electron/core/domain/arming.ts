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

/**
 * How early the window opens. Five minutes is the interval between "I am about
 * to join" and "I have joined", which is the moment the offer has to already be
 * on screen: a rep who is talking is not looking for a button.
 */
export const ARM_LEAD_MS = 5 * 60_000

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
   * The conferencing application whose audio is on the system loopback right
   * now, or null. Supplied by `modules/capture/` — this file must not know how
   * that is detected, only that it is a name or nothing.
   */
  meetingAudio: string | null
}

export const decideArming = (input: ArmingInput): ArmingDecision => {
  const { event, now, meetingAudio } = input

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

  if (now >= event.scheduledEnd) {
    return { action: 'skip', reason: 'événement terminé' }
  }

  const opensAt = event.scheduledStart - ARM_LEAD_MS
  if (now < opensAt) {
    return { action: 'wait', untilMs: opensAt, reason: 'la fenêtre n’est pas encore ouverte' }
  }

  // Inside the window and still silent. Nothing *time-based* will change this
  // before the event ends — the next input is an audio event — so the horizon
  // handed back is the end of the event, at which point the answer becomes
  // `skip` rather than a timer that fired for nothing.
  if (!meetingAudio) {
    return {
      action: 'wait',
      untilMs: event.scheduledEnd,
      reason: 'aucune application de réunion n’émet de son',
    }
  }

  return { action: 'arm', reason: `${meetingAudio} émet du son` }
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
): ArmingChoice => {
  let armed: ArmingChoice | null = null
  let waiting: ArmingChoice | null = null

  for (const event of events) {
    // Cancelled and all-day entries stay in the window so the UI can show them;
    // neither is ever a call to record.
    if (event.isCancelled || event.isAllDay) continue

    const decision = decideArming({ event: event.context, now, meetingAudio })
    if (decision.action === 'arm') {
      if (!armed || event.context.scheduledStart < (armed.event?.context.scheduledStart ?? Infinity)) {
        armed = { event, decision }
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
  if (waiting) return waiting
  return { event: null, decision: { action: 'skip', reason: 'aucune réunion dans la fenêtre' } }
}
