/**
 * A Graph `event` resource → a `CalendarEvent`.
 *
 * Pure, total and defensive. Every field is read as `unknown` and narrowed,
 * because this is the boundary where a tenant's data — room resources with no
 * address, on-premises mailboxes, an event whose organizer left the company —
 * meets a schema. A single odd attendee must not cost the meeting.
 *
 * Nothing here is ever produced by a model and nothing here is ever corrected by
 * one (DEC-7). Names, addresses and times are what the tenant says they are.
 */
import type { CalendarEvent } from '../../core/contracts/calendar.ts'
import type { Attendee, AttendeeType, ResponseStatus, Sensitivity } from '../../core/contracts/meeting.ts'
import { zonedToEpoch } from './time.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const ATTENDEE_TYPES: ReadonlySet<string> = new Set(['required', 'optional', 'resource'])
const RESPONSES: ReadonlySet<string> = new Set([
  'none',
  'organizer',
  'tentativelyAccepted',
  'accepted',
  'declined',
  'notResponded',
])
const SENSITIVITIES: ReadonlySet<string> = new Set([
  'normal',
  'personal',
  'private',
  'confidential',
])

/** Never read, never stored, never transcribed — see `SKIPPED_SENSITIVITY`. */
export const SKIPPED_SENSITIVITY: ReadonlySet<string> = new Set(['private', 'confidential'])

const toAttendee = (raw: Json): Attendee => ({
  name: str(raw?.emailAddress?.name),
  email: str(raw?.emailAddress?.address),
  type: ATTENDEE_TYPES.has(str(raw?.type)) ? (raw.type as AttendeeType) : 'required',
  response: RESPONSES.has(str(raw?.status?.response))
    ? (raw.status.response as ResponseStatus)
    : 'none',
})

/** Graph's `dateTimeTimeZone`, or NaN. */
const toEpoch = (raw: Json): number =>
  raw && typeof raw === 'object' ? zonedToEpoch(str(raw.dateTime), str(raw.timeZone, 'UTC')) : NaN

/**
 * Returns null for an event the app must not hold.
 *
 * Two cases, and they are different in kind. A `private` or `confidential` event
 * is a deliberate instruction from a human: Outlook's sensitivity flag is the
 * one place a user gets to say "this is not for tooling", so the subject never
 * enters the database at all rather than being filtered further downstream. An
 * unparseable one is a defect in the data, and an event with no usable start is
 * an event nothing can be decided about.
 *
 * `core/domain/arming.ts` checks sensitivity a second time. That is not
 * redundancy for its own sake — a `MeetingContext` can also arrive from a
 * manually started session, which never passes through this function.
 */
export const mapEvent = (raw: Json, displayTimeZone: string): CalendarEvent | null => {
  const id = str(raw?.id)
  if (!id) return null

  const sensitivity = str(raw?.sensitivity, 'normal')
  if (SKIPPED_SENSITIVITY.has(sensitivity)) return null

  const scheduledStart = toEpoch(raw?.start)
  const scheduledEnd = toEpoch(raw?.end)
  if (!Number.isFinite(scheduledStart) || !Number.isFinite(scheduledEnd)) return null

  const attendees = Array.isArray(raw?.attendees) ? raw.attendees.map(toAttendee) : []

  return {
    id,
    isCancelled: raw?.isCancelled === true,
    isAllDay: raw?.isAllDay === true,
    lastModified: Number.isFinite(Date.parse(str(raw?.lastModifiedDateTime)))
      ? Date.parse(raw.lastModifiedDateTime)
      : 0,
    context: {
      eventId: id,
      subject: str(raw?.subject),
      // `bodyPreview`, never `body`. The full body is HTML, arrives with the
      // Teams join blob and a signature block in it, and is the single largest
      // thing Graph returns — none of which an agenda needs (DEC-15).
      agenda: str(raw?.bodyPreview),
      organizer: toAttendee(raw?.organizer),
      attendees,
      onlineMeetingJoinUrl: str(raw?.onlineMeeting?.joinUrl) || null,
      categories: Array.isArray(raw?.categories) ? raw.categories.filter((c: unknown) => typeof c === 'string') : [],
      sensitivity: SENSITIVITIES.has(sensitivity) ? (sensitivity as Sensitivity) : 'normal',
      scheduledStart,
      scheduledEnd,
      seriesMasterId: str(raw?.seriesMasterId) || null,
      timeZone: displayTimeZone,
    },
  }
}

/** A delta entry marking an event the rep deleted, or that fell out of the window. */
export const removedId = (raw: Json): string | null =>
  raw && typeof raw === 'object' && raw['@removed'] ? (str(raw.id) || null) : null
