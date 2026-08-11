import { describe, expect, test } from 'vitest'
import {
  formatAgo,
  formatDayShort,
  formatElapsed,
  formatOffset,
  formatRange,
  formatTime,
  isSameDay,
} from '../format.ts'

// 2026-08-05 08:00 UTC = 10:00 in Paris (CEST).
const AUGUST = Date.parse('2026-08-05T08:00:00Z')
// 2026-01-05 08:00 UTC = 09:00 in Paris (CET).
const JANUARY = Date.parse('2026-01-05T08:00:00Z')

describe('times are Paris times, whatever the laptop is set to', () => {
  test('summer is CEST', () => {
    expect(formatTime(AUGUST)).toBe('10:00')
  })

  test('winter is CET', () => {
    // The bug this catches is a formatter built once with the machine's zone —
    // it passes in August in France and is an hour out in January, or on CI.
    expect(formatTime(JANUARY)).toBe('09:00')
  })

  test('a range reads as a range', () => {
    expect(formatRange(AUGUST, AUGUST + 30 * 60_000)).toBe('10:00 – 10:30')
  })

  test('a short day is day/month, French order', () => {
    expect(formatDayShort(AUGUST)).toBe('05/08')
  })
})

describe('the transcript clock is elapsed time, not wall time', () => {
  test.each([
    [0, '0:00'],
    [9_000, '0:09'],
    [61_500, '1:01'],
    [3_600_000, '60:00'],
  ])('%dms is %s', (ms, expected) => {
    expect(formatOffset(ms)).toBe(expected)
  })

  test('a negative offset floors at zero rather than showing -0:01', () => {
    expect(formatOffset(-5_000)).toBe('0:00')
  })
})

describe('the recording clock is a clock, not a transcript offset', () => {
  test.each([
    [0, '00:00:00'],
    [9_000, '00:00:09'],
    [61_500, '00:01:01'],
    // Where the two formatters part company: `formatOffset` says `60:00` here.
    [3_600_000, '01:00:00'],
    [3_600_000 + 24 * 60_000 + 7_000, '01:24:07'],
  ])('%dms is %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected)
  })

  test('the field never changes width, so the title beside it never moves', () => {
    const lengths = [0, 59_000, 3_599_000, 7_200_000].map((ms) => formatElapsed(ms).length)
    expect(new Set(lengths).size).toBe(1)
  })

  test('a clock skew backwards floors at zero rather than counting down', () => {
    expect(formatElapsed(-5_000)).toBe('00:00:00')
  })
})

describe('formatAgo', () => {
  test('never synced says so, rather than "il y a 56 ans"', () => {
    // A zero timestamp is the empty-window sentinel from `calendar.ts`. Passed
    // through the arithmetic it renders as the epoch, which is worse than
    // useless on a screen a rep glances at.
    expect(formatAgo(0, AUGUST)).toBe('jamais')
  })

  test.each([
    [10_000, "à l'instant"],
    [3 * 60_000, 'il y a 3 min'],
    [2 * 3_600_000, 'il y a 2 h'],
  ])('%dms ago reads as %s', (delta, expected) => {
    expect(formatAgo(AUGUST - delta, AUGUST)).toBe(expected)
  })
})

describe('isSameDay uses the Paris day, not the machine midnight', () => {
  test('two instants inside one Paris day', () => {
    expect(isSameDay(AUGUST, AUGUST + 6 * 3_600_000)).toBe(true)
  })

  test('23:30 and 00:30 Paris are different days', () => {
    const late = Date.parse('2026-08-05T21:30:00Z') // 23:30 Paris
    const early = Date.parse('2026-08-05T22:30:00Z') // 00:30 Paris, next day
    expect(isSameDay(late, early)).toBe(false)
  })

  test('an instant that is still "today" in UTC but tomorrow in Paris', () => {
    // 22:30 UTC on the 5th is 00:30 on the 6th in Paris. A comparison built on
    // the machine's own midnight files this under the wrong day.
    const utcEvening = Date.parse('2026-08-05T12:00:00Z')
    const parisTomorrow = Date.parse('2026-08-05T22:30:00Z')
    expect(isSameDay(utcEvening, parisTomorrow)).toBe(false)
  })
})
