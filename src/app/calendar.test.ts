/**
 * The arithmetic under the grid (DEC-31).
 *
 * Everything here is about the two ways a calendar quietly lies: an hour of
 * daylight saving, and a month that does not have a 31st. Both produce a grid
 * that renders perfectly and puts a meeting on the wrong day.
 */
import { describe, expect, test } from 'vitest'
import {
  addDays,
  addMonths,
  atParis,
  dayKeyOf,
  endOfMonth,
  formatClock,
  monthMatrix,
  monthOf,
  noonOf,
  parseClock,
  startOfMonth,
  startOfWeek,
  weekOf,
  weekdayIndex,
} from './calendar.ts'

describe('a day is a Paris day, and adding one never depends on the clock', () => {
  test('the spring-forward day is one day long, not twenty-three hours', () => {
    // 2026-03-29 is when Paris jumps to UTC+2. `+86_400_000` from midnight
    // local would land back on the 29th.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
  })

  test('the autumn day is one day long too', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
  })

  test('days cross months and years', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  test('the anchor of a day formats as that day in Paris, in both halves of the year', () => {
    expect(dayKeyOf(noonOf('2026-08-05'))).toBe('2026-08-05')
    expect(dayKeyOf(noonOf('2026-01-05'))).toBe('2026-01-05')
    expect(dayKeyOf(noonOf('2026-03-29'))).toBe('2026-03-29')
  })
})

describe('the month grid', () => {
  test('weeks start on Monday', () => {
    // 2026-08-05 is a Wednesday.
    expect(weekdayIndex('2026-08-05')).toBe(2)
    expect(startOfWeek('2026-08-05')).toBe('2026-08-03')
    expect(weekOf('2026-08-05')[0]).toBe('2026-08-03')
    expect(weekOf('2026-08-05')[6]).toBe('2026-08-09')
  })

  test('a Sunday belongs to the week that started six days earlier, not the next one', () => {
    // The off-by-one that puts a Sunday call at the top of next week.
    expect(startOfWeek('2026-08-09')).toBe('2026-08-03')
  })

  test('it is always six rows of seven, so nothing under it moves as the rep pages', () => {
    for (const day of ['2026-02-10', '2026-08-05', '2027-02-01', '2026-11-30']) {
      const matrix = monthMatrix(day)
      expect(matrix).toHaveLength(6)
      for (const week of matrix) expect(week).toHaveLength(7)
    }
  })

  test('it contains every day of its month, and starts on a Monday', () => {
    const matrix = monthMatrix('2026-08-05')
    const flat = matrix.flat()
    expect(weekdayIndex(flat[0])).toBe(0)
    expect(flat).toContain('2026-08-01')
    expect(flat).toContain('2026-08-31')
    expect(flat.filter((day) => monthOf(day) === '2026-08')).toHaveLength(31)
  })

  test('paging months clamps rather than overflowing into the next one', () => {
    // From 31 March, ‹ must be March→February and land on the 28th. Naive
    // arithmetic produces 2026-02-31, which normalises to 3 March.
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-08-05', 1)).toBe('2026-09-05')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  test('month bounds', () => {
    expect(startOfMonth('2026-08-05')).toBe('2026-08-01')
    expect(endOfMonth('2026-02-05')).toBe('2026-02-28')
    expect(endOfMonth('2028-02-05')).toBe('2028-02-29')
    expect(endOfMonth('2026-08-05')).toBe('2026-08-31')
  })
})

describe('a time on a day is a Paris time', () => {
  test('09:00 in summer is 07:00 UTC, and in winter 08:00', () => {
    expect(atParis('2026-08-05', 9, 0)).toBe(Date.UTC(2026, 7, 5, 7, 0))
    expect(atParis('2026-01-05', 9, 0)).toBe(Date.UTC(2026, 0, 5, 8, 0))
  })

  test('a chosen time round-trips to the day it was chosen on', () => {
    for (const day of ['2026-03-29', '2026-10-25', '2026-08-05', '2026-12-31']) {
      expect(dayKeyOf(atParis(day, 9, 0))).toBe(day)
      expect(dayKeyOf(atParis(day, 23, 30))).toBe(day)
      expect(dayKeyOf(atParis(day, 0, 15))).toBe(day)
    }
  })

  test('a clock reading is parsed or refused, never guessed', () => {
    expect(parseClock('09:30')).toEqual({ hour: 9, minute: 30 })
    expect(parseClock('9:05')).toEqual({ hour: 9, minute: 5 })
    expect(parseClock('')).toBeNull()
    expect(parseClock('25:00')).toBeNull()
    expect(parseClock('09:60')).toBeNull()
    expect(parseClock('neuf heures')).toBeNull()
  })

  test('formatClock is what a time field accepts back', () => {
    expect(formatClock(9, 0)).toBe('09:00')
    expect(formatClock(14, 5)).toBe('14:05')
  })
})
