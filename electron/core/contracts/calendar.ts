/**
 * The calendar, as the rest of the app sees it (DEC-15).
 *
 * Everything here is deterministic fact read from Microsoft Graph. None of it is
 * ever produced by a model and none of it is ever corrected by one (DEC-7): an
 * attendee's name and address are what the tenant says they are, and if that is
 * wrong the fix is in Outlook.
 */
import { z } from 'zod'
import { MeetingContextSchema, TimestampSchema } from './meeting.ts'

export const CalendarEventSchema = z.object({
  /** Graph `event.id`. Stable for the life of the event, and the fold's key. */
  id: z.string().min(1),
  /** What the meeting *is* — the part the rest of the app consumes. */
  context: MeetingContextSchema,
  /**
   * Cancelled events keep arriving in a delta feed; they are kept in the fold
   * rather than dropped so that a cancellation reaches the UI as a
   * cancellation, and only the arming path ignores them.
   */
  isCancelled: z.boolean(),
  /**
   * All-day blocks are never calls. Kept as a flag rather than filtered at the
   * boundary so the window can still show a rep their day.
   */
  isAllDay: z.boolean(),
  /** Graph `lastModifiedDateTime`, epoch ms. */
  lastModified: TimestampSchema,
})
export type CalendarEvent = z.infer<typeof CalendarEventSchema>

/**
 * The fold: everything currently known about the sync window, plus the cursor
 * that will fetch the next batch of changes.
 *
 * Persisted as one value and written atomically. Cursor and events have to move
 * together — a cursor saved without the events it was earned by would, on the
 * next boot, ask Graph only for what changed *since*, and the app would come up
 * with an empty calendar and no way to notice.
 */
export const CalendarWindowSchema = z.object({
  /** The opaque `@odata.deltaLink`. Null before the first successful sync. */
  cursor: z.string().nullable(),
  /** Epoch ms of the last successful sync. Zero when there has never been one. */
  syncedAt: TimestampSchema,
  /** Inclusive bounds of the window the cursor was earned over, epoch ms. */
  from: TimestampSchema,
  to: TimestampSchema,
  events: z.array(CalendarEventSchema),
})
export type CalendarWindow = z.infer<typeof CalendarWindowSchema>

export const EMPTY_WINDOW: CalendarWindow = {
  cursor: null,
  syncedAt: 0,
  from: 0,
  to: 0,
  events: [],
}

export interface CalendarPort {
  /** Fetches changes, folds them in, persists the result, returns it. */
  sync(now?: number): Promise<CalendarWindow>
  /** The last fold, with no network access. Safe to call on every render. */
  window(): CalendarWindow
}
