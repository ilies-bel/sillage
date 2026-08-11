/**
 * The fold, and the rules about when a delta cursor stops being usable.
 *
 * Pure. `GraphCalendar` does the HTTP and hands the pages here, which is what
 * makes the interesting half — a cancellation arriving as an update, an event
 * turning private between two syncs, a window that has aged out — testable
 * against fixtures instead of a tenant.
 */
import type { CalendarEvent, CalendarWindow } from '../../core/contracts/calendar.ts'
import { mapEvent, removedId } from './mapEvent.ts'

const DAY_MS = 24 * 60 * 60_000

/**
 * Yesterday, so that a meeting still being written up after midnight is still
 * there, and a week ahead, which is as far as a rep plans and well inside what
 * one delta query returns comfortably.
 */
export const WINDOW_BACK_MS = DAY_MS
export const WINDOW_AHEAD_MS = 7 * DAY_MS

/**
 * A delta link has the original `startDateTime`/`endDateTime` baked into it and
 * keeps answering for *that* window forever. Left alone, the app would sync
 * happily every day while its view of the future shrank a day at a time, and
 * eventually arm for nothing. Below this much runway, the cursor is thrown away
 * and a full sync earns a new one.
 */
export const MIN_LOOKAHEAD_MS = 2 * DAY_MS

export const windowFor = (now: number): { from: number; to: number } => ({
  from: now - WINDOW_BACK_MS,
  to: now + WINDOW_AHEAD_MS,
})

/** True when the cursor cannot be trusted to still cover the days that matter. */
export const needsFullSync = (window: CalendarWindow, now: number): boolean =>
  window.cursor === null || now < window.from || window.to - now < MIN_LOOKAHEAD_MS

/**
 * Applies one page of delta entries.
 *
 * Three kinds arrive and two of them remove. `@removed` is the explicit one; the
 * quiet one is an event that `mapEvent` refuses — it went `private`, or its
 * dates stopped parsing — which has to delete the copy already held rather than
 * leave a stale one that nothing will ever update again.
 */
export const applyDelta = (
  events: readonly CalendarEvent[],
  items: readonly unknown[],
  displayTimeZone: string,
): CalendarEvent[] => {
  const byId = new Map(events.map((event) => [event.id, event]))

  for (const item of items) {
    const removed = removedId(item)
    if (removed) {
      byId.delete(removed)
      continue
    }

    const mapped = mapEvent(item, displayTimeZone)
    if (mapped) {
      byId.set(mapped.id, mapped)
      continue
    }

    const id = (item as { id?: unknown } | null)?.id
    if (typeof id === 'string' && id) byId.delete(id)
  }

  return [...byId.values()]
}

/** Drops what the window no longer covers, so the stored fold cannot grow forever. */
export const prune = (events: readonly CalendarEvent[], bounds: { from: number; to: number }): CalendarEvent[] =>
  events.filter((event) => event.context.scheduledEnd >= bounds.from && event.context.scheduledStart <= bounds.to)

/** Earliest first — the order every consumer wants and none should have to impose. */
export const byStart = (events: readonly CalendarEvent[]): CalendarEvent[] =>
  [...events].sort((a, b) => a.context.scheduledStart - b.context.scheduledStart)
