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
import type { Meeting, MeetingState } from '../../../electron/core/contracts/meeting.ts'
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
   * Non-null ⇒ there is a session to open. An entry without one is
   * information and carries no button (DEC-26).
   */
  meetingId: string | null
  /** The offer, never a recording (HR-7). */
  armed: boolean
  /** Null for a calendar event the app has never opened. */
  state: MeetingState | null
  /** Held already — it goes under *Passées*. */
  past: boolean
}

/**
 * The states a meeting reaches only after the call. `recording` is deliberately
 * absent, and so is `armed`: a call running past its scheduled end is the most
 * important row on the screen, and filing it under *Passées* would hide it.
 */
const AFTER_THE_CALL: ReadonlySet<MeetingState> = new Set<MeetingState>([
  'ended',
  'extracting',
  'awaiting_confirmation',
  'pushing',
  'done',
  'aborted',
])

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
  return end < now
}

const attendeesOf = (event: CalendarEvent): string | null => {
  const names = event.context.attendees.map((attendee) => attendee.name || attendee.email)
  return names.length > 0 ? names.join(', ') : null
}

/** What a day cell has to draw under its number. */
export type DayMark = 'armed' | 'captured' | 'scheduled'

/**
 * One mark per day, strongest first: armed beats captured beats merely
 * scheduled. Built over every entry rather than over the visible month, so
 * paging the grid never has to re-derive it.
 */
export const marksByDay = (entries: readonly AgendaEntry[]): Map<DayKey, DayMark> => {
  const marks = new Map<DayKey, DayMark>()
  const rank: Record<DayMark, number> = { scheduled: 0, captured: 1, armed: 2 }

  for (const entry of entries) {
    const mark: DayMark = entry.armed ? 'armed' : entry.meetingId ? 'captured' : 'scheduled'
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
