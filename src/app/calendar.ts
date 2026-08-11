/**
 * The calendar's arithmetic (DEC-31). No React, no tokens, no IPC — a month
 * grid is a list of days, and a list of days is testable.
 *
 * **A day is a string, not a `Date`.** `2026-08-05` is the Paris day an instant
 * falls on (`dayKeyOf`), and every operation here maps day → day. That is not a
 * stylistic choice: `Europe/Paris` shifts by an hour twice a year, and code that
 * adds `86_400_000` to a timestamp to get "tomorrow" is code that returns the
 * same day twice in October and skips one in March. Strings cannot do that, and
 * they sort, compare and key a `Map` for free.
 *
 * Where an *instant* is genuinely needed — the anchor a formatter is given, the
 * `scheduledStart` a new meeting is created with — it is minted here and only
 * here, by `noonOf` and `atParis`.
 */
import { TIME_ZONE, dayKeyOf } from './format.ts'

/** `YYYY-MM-DD`, in `Europe/Paris`. */
export type DayKey = string

/** `YYYY-MM`. What a month grid is scoped to. */
export type MonthKey = string

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

const partsOf = (day: DayKey): { year: number; month: number; date: number } => {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) throw new Error(`jour invalide: ${day}`)
  return { year, month, date }
}

const keyOf = (year: number, month: number, date: number): DayKey =>
  `${pad(year, 4)}-${pad(month)}-${pad(date)}`

/**
 * Midday UTC on that day — the instant to hand a formatter, never a boundary.
 *
 * Paris is UTC+1 or UTC+2, so 12:00 UTC is 13:00 or 14:00 there and always the
 * same calendar day. Midnight would be the day before for half the year.
 */
export const noonOf = (day: DayKey): number => {
  const { year, month, date } = partsOf(day)
  return Date.UTC(year, month - 1, date, 12)
}

export const addDays = (day: DayKey, days: number): DayKey => {
  const { year, month, date } = partsOf(day)
  const shifted = new Date(Date.UTC(year, month - 1, date + days))
  return keyOf(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/**
 * Same day-of-month in another month, clamped to the last day of it. Without
 * the clamp, ‹ from 31 March lands on 3 March — the one navigation bug that
 * makes a rep think the calendar is lying to them.
 */
export const addMonths = (day: DayKey, months: number): DayKey => {
  const { year, month, date } = partsOf(day)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDate = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return keyOf(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(date, lastDate))
}

/** Monday is 0. France starts its weeks on Monday and so does this grid. */
export const weekdayIndex = (day: DayKey): number => {
  const { year, month, date } = partsOf(day)
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7
}

export const startOfWeek = (day: DayKey): DayKey => addDays(day, -weekdayIndex(day))

export const weekOf = (day: DayKey): DayKey[] => {
  const first = startOfWeek(day)
  return Array.from({ length: 7 }, (_, index) => addDays(first, index))
}

export const monthOf = (day: DayKey): MonthKey => day.slice(0, 7)

export const startOfMonth = (day: DayKey): DayKey => `${monthOf(day)}-01`

export const endOfMonth = (day: DayKey): DayKey => {
  const { year, month } = partsOf(day)
  return keyOf(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
}

/**
 * Six weeks of seven days containing the given month, Monday-first.
 *
 * Always six rows, including for a 28-day February that fits in four. A grid
 * that changes height as the rep pages through the year makes everything under
 * it jump, and the day list is under it.
 */
export const monthMatrix = (day: DayKey): DayKey[][] => {
  const first = startOfWeek(startOfMonth(day))
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, index) => addDays(first, week * 7 + index)),
  )
}

/**
 * The instants that bound a span of days, inclusive, in Paris.
 *
 * What a range query is asked in (`meeting:list`'s `from`/`to`): the grid knows
 * which *days* it draws, the store knows *instants*, and the conversion is a DST
 * question — so it happens here with the rest of them and not in a component.
 * `to` is the last millisecond of `last`, so a meeting at 23:59 on the final day
 * of the window is inside it.
 */
export const spanOf = (first: DayKey, last: DayKey): { from: number; to: number } => ({
  from: atParis(first, 0, 0),
  to: atParis(addDays(last, 1), 0, 0) - 1,
})

/**
 * Paris wall-clock time on a given day, as an instant.
 *
 * Two passes, because the offset depends on the answer: guess that the local
 * time is UTC, measure how far Paris is from UTC at that guess, correct, then
 * re-measure in case the correction crossed a DST boundary. This is the whole
 * reason `scheduledStart` is minted here rather than in a component — a meeting
 * placed at 09:00 that is stored as 09:00 UTC is a meeting that shows up at
 * 11:00 all summer.
 */
export const atParis = (day: DayKey, hour: number, minute: number): number => {
  const { year, month, date } = partsOf(day)
  const guess = Date.UTC(year, month - 1, date, hour, minute)
  const first = offsetAt(guess)
  const corrected = guess - first
  const second = offsetAt(corrected)
  return second === first ? corrected : guess - second
}

/** `09:00` → `{ hour: 9, minute: 0 }`. Anything else is refused, not guessed. */
export const parseClock = (value: string): { hour: number; minute: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** `09:00`, for the value of a time field. */
export const formatClock = (hour: number, minute: number): string =>
  `${pad(hour)}:${pad(minute)}`

/**
 * How far `Europe/Paris` is ahead of UTC at a given instant, in milliseconds.
 * Read off `Intl` rather than tabulated, so the rules are the platform's.
 */
const zoned = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const offsetAt = (utcMs: number): number => {
  const read: Record<string, number> = {}
  for (const part of zoned.formatToParts(utcMs)) {
    if (part.type !== 'literal') read[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(
    read.year,
    read.month - 1,
    read.day,
    // `hour12: false` still renders midnight as 24 on some ICU builds.
    read.hour % 24,
    read.minute,
    read.second,
  )
  return asUtc - utcMs
}

/** The day an instant falls on. Re-exported so the grid has one import. */
export { dayKeyOf }
