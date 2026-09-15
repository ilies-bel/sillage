/**
 * One list, two sources (DEC-31).
 *
 * « Meetings created in the app sit in the same grid as meetings from Outlook »
 * is the whole of this file. Graph gives `CalendarEvent`s, the store gives
 * `Meeting`s, and the screen must not care which a row came from — a rep with no
 * Entra registration has only the second kind and their calendar is not
 * therefore empty.
 *
 * Pure, and separate from the components, because the two things most likely to
 * be quietly wrong here are invisible on screen: a meeting counted twice
 * because it exists on both sides, and a day boundary computed in the machine's
 * timezone instead of Paris.
 *
 * Type-only imports from `core/contracts/` — those modules build Zod schemas at
 * module scope and none of it may cross the bridge.
 */
import type { CalendarEvent } from '../../../electron/core/contracts/calendar.ts'
import type { AgendaSnapshotPayload } from '../../../electron/core/contracts/ipc.ts'
import {
  AFTER_THE_CALL,
  Meeting,
  MeetingState,
  OVERRUN_GRACE_MS,
} from '../../../electron/core/contracts/meeting.ts'
import { dayKeyOf, type DayKey } from '../../app/calendar.ts'

export interface AgendaEntry {
  /** Stable across re-renders and unique across both sources. */
  key: string
  day: DayKey
  start: number
  /** Null for a meeting the app created: it has a start, not a slot. */
  end: number | null
  title: string
  /** Attendees, or the client the rep named. Never both. */
  subtitle: string | null
  /**
   * Non-null ⇒ there is a session to *open*.
   *
   * This used to say « an entry without one is information and carries no
   * button (DEC-26) », and that reading was too broad by exactly one case. A
   * past event the app never recorded is information, and a dead *Ouvrir* on it
   * would indeed be the control DEC-26 forbids. An **upcoming** event is not
   * information: it is a call that has not started yet, and the rep can start
   * it. Both fell into the same `null` and the whole upcoming list went inert —
   * four of five rows with no control at all, and the row is not clickable
   * either. `eventId` is what separates them.
   */
  meetingId: string | null
  /**
   * The invite this row came from, when it came from one.
   *
   * Null for a meeting the app created itself (*Démarrer une réunion*), which
   * by construction has no invite — `meeting:create`'s docblock is explicit
   * that `eventId: null` is the normal case there, not a fallback.
   *
   * It is here so an upcoming calendar row can offer *Enregistrer* through
   * `agenda:arm`, which reaches `Agenda`'s own arm path and therefore keeps the
   * attendees and the subject. Without it the only way to record a call
   * starting early is the header's *Démarrer*, which drops the invite and with
   * it every deterministic fact DEC-7 keeps away from the model.
   */
  eventId: string | null
  /** The offer, never a recording (HR-7). */
  armed: boolean
  /** Null for a calendar event the app has never opened. */
  state: MeetingState | null
  /** Held already — it goes under *Passées*. */
  past: boolean
}

/** French, and never the machine's own vocabulary. */
export const STATE_LABEL: Record<MeetingState, string> = {
  idle: 'En attente',
  armed: 'Prêt',
  recording: 'En cours',
  ended: 'Terminée',
  extracting: 'Analyse…',
  awaiting_confirmation: 'À valider',
  pushing: 'Envoi…',
  done: 'Validée',
  aborted: 'Abandonnée',
}

export interface BuildInput {
  snapshot: AgendaSnapshotPayload | null
  meetings: readonly Meeting[]
  now: number
}

/**
 * Every meeting the app knows about, calendar and hand-made, in one list.
 *
 * The join is on `eventId`: a meeting armed from an invite is the *same* row as
 * the invite it came from, and drawing both would put a call twice in a day.
 * The calendar side wins the title and the time — those are deterministic fact
 * from Graph (DEC-7, DEC-15) — and the meeting side contributes the thing the
 * calendar cannot know, which is whether there is a session to open.
 */
export const buildEntries = ({ snapshot, meetings, now }: BuildInput): AgendaEntry[] => {
  const armed = snapshot?.armed ?? null
  const byEventId = new Map<string, Meeting>()
  for (const meeting of meetings) {
    if (meeting.eventId) byEventId.set(meeting.eventId, meeting)
  }

  const entries: AgendaEntry[] = []
  const seenEventIds = new Set<string>()

  for (const event of snapshot?.events ?? []) {
    if (event.isCancelled) continue
    seenEventIds.add(event.id)
    const meeting = byEventId.get(event.id) ?? null
    const isArmed = armed?.eventId === event.id
    // `armed` names its own meeting id, and it names it before `meeting:list`
    // has been re-read — so a freshly armed row is openable immediately.
    const meetingId = isArmed ? armed.meetingId : (meeting?.id ?? null)
    const state = meeting?.state ?? (isArmed ? 'armed' : null)

    entries.push({
      key: `event:${event.id}`,
      day: dayKeyOf(event.context.scheduledStart),
      start: event.context.scheduledStart,
      end: event.context.scheduledEnd,
      title: event.context.subject || 'Sans objet',
      subtitle: attendeesOf(event),
      meetingId,
      eventId: event.id,
      armed: isArmed,
      state,
      past: isPast({ state, end: event.context.scheduledEnd, now }),
    })
  }

  for (const meeting of meetings) {
    // Already drawn as its calendar row. A meeting whose event has fallen out
    // of the sync window is *not* skipped — it is the app's own record and it
    // keeps its place in the grid (DEC-31).
    if (meeting.eventId && seenEventIds.has(meeting.eventId)) continue

    const start = startOf(meeting)
    entries.push({
      key: `meeting:${meeting.id}`,
      day: dayKeyOf(start),
      start,
      end: meeting.endedAt,
      title: meeting.title || 'Sans objet',
      subtitle: meeting.clientName,
      meetingId: meeting.id,
      // The app's own record. It may *carry* an `eventId` — a meeting armed
      // from an invite whose event has since fallen out of the sync window —
      // but it already has a meeting, so there is nothing here left to arm.
      eventId: null,
      armed: armed?.meetingId === meeting.id,
      state: meeting.state,
      past: isPast({ state: meeting.state, end: meeting.endedAt ?? start, now }),
    })
  }

  return entries.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title, 'fr'))
}

/**
 * Where a meeting sits in the grid: the day the rep placed it on, else the day
 * it ran on, else the day it was created. The first is the DEC-31 case and the
 * only one the projection could not answer before.
 */
const startOf = (meeting: Meeting): number =>
  meeting.scheduledStart ?? meeting.startedAt ?? meeting.createdAt

/**
 * Is this row behind the rep, or still theirs to record?
 *
 * **A call that runs over is not past, and this used to say it was.** For a row
 * with no meeting yet the answer was `end < now`, so at 14:31 on a 14:00–14:30
 * slot the row moved under *Passées* and `DayPane` drew **no control at all** —
 * while `Agenda.armNow`, which the control would have called, would happily have
 * armed it. DEC-9 says sales calls overrun constantly.
 *
 * The domain has the same grace (`decideArming`, `OVERRUN_GRACE_MS`) and applies
 * it only while a microphone is still held, because a schedule alone is not
 * evidence a call is still happening and the app must not *offer* on a guess.
 * Here the microphone deliberately does not come into it: `armNow` does not
 * consult `decideArming` — the detector guesses, the rep has said — so the
 * control has to be reachable on a machine that produces no microphone signal at
 * all, which is every older binary, macOS before 14.4, a locked-down Windows box
 * and any call taken on a desk phone. Withholding it there would be the dead
 * control DEC-26 forbids, in reverse: a live meeting with no way to record it.
 *
 * One number, imported rather than restated — see its docblock in
 * `core/contracts/meeting.ts` for why it lives there.
 */
const isPast = ({
  state,
  end,
  now,
}: {
  state: MeetingState | null
  end: number
  now: number
}): boolean => {
  if (state === 'recording' || state === 'armed') return false
  if (state && AFTER_THE_CALL.has(state)) return true
  return end + OVERRUN_GRACE_MS < now
}

const attendeesOf = (event: CalendarEvent): string | null => {
  const names = event.context.attendees.map((attendee) => attendee.name || attendee.email)
  return names.length > 0 ? names.join(', ') : null
}

/**
 * What a day cell has to draw under its number.
 *
 * **`recording` is the fourth and it exists because the grid was lying.** A call
 * being recorded is also armed, so it took the `armed` mark — and the legend
 * under the grid calls that mark « réunion prête ». Measured on the shipped
 * screen: the 15th carried the armed dot while its only orange-state meeting
 * read « EN COURS ». The grid said *ready* about a call in progress, on the
 * screen a rep opens mid-call, under a key that said so in words.
 */
export type DayMark = 'recording' | 'armed' | 'captured' | 'scheduled'

/**
 * One mark per day, strongest first: a live recording beats an offer beats a
 * captured call beats a merely scheduled one. Built over every entry rather
 * than over the visible month, so paging the grid never has to re-derive it.
 */
export const marksByDay = (entries: readonly AgendaEntry[]): Map<DayKey, DayMark> => {
  const marks = new Map<DayKey, DayMark>()
  const rank: Record<DayMark, number> = { scheduled: 0, captured: 1, armed: 2, recording: 3 }

  for (const entry of entries) {
    const mark: DayMark =
      entry.state === 'recording'
        ? 'recording'
        : entry.armed
          ? 'armed'
          : entry.meetingId
            ? 'captured'
            : 'scheduled'
    const current = marks.get(entry.day)
    if (!current || rank[mark] > rank[current]) marks.set(entry.day, mark)
  }
  return marks
}

export const countsByDay = (entries: readonly AgendaEntry[]): Map<DayKey, number> => {
  const counts = new Map<DayKey, number>()
  for (const entry of entries) counts.set(entry.day, (counts.get(entry.day) ?? 0) + 1)
  return counts
}
