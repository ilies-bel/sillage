import { describe, expect, test } from 'vitest'
import {
  formatAgo,
  formatDayShort,
  formatElapsed,
  formatOffset,
  formatDayLong,
  formatDayMedium,
  formatMonthLong,
  formatRange,
  formatTime,
  isSameDay,
  meetingHeading,
  upperFirst,
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

/**
 * French does not capitalise the names of days or months. The calendar's
 * headings went through Tailwind's `capitalize`, which is
 * `text-transform: capitalize` and capitalises **every word** — so the app read
 * « Jeudi 10 Septembre » and « Septembre 2026 » in 20px type while the
 * compte-rendu two screens away wrote « jeudi 10 septembre 2026 » correctly.
 */
describe('the first letter, and only the first letter', () => {
  test('a long day keeps its month lowercase', () => {
    expect(upperFirst(formatDayLong(AUGUST))).toBe('Mercredi 5 août')
  })

  test('a month heading keeps its month lowercase', () => {
    expect(upperFirst(formatMonthLong(AUGUST))).toBe('Août 2026')
  })

  test('a medium day too', () => {
    expect(upperFirst(formatDayMedium(AUGUST))).toBe('5 août')
  })

  test('an empty string is not an exception to handle at every call site', () => {
    expect(upperFirst('')).toBe('')
  })

  test('it counts characters, not UTF-16 units', () => {
    // A first letter can be a surrogate pair, and slicing one in half is how a
    // formatter turns a date into a replacement character.
    expect(upperFirst('🙂 ok')).toBe('🙂 ok')
  })
})

/**
 * The objet a rep types opens on the client's own name almost every time,
 * because that is how a calendar invitation is written. Drawn as-is, the row
 * spent its strongest line on a word repeated three pixels below it.
 */
describe('a row names its client once', () => {
  test('the objet drops the prefix it duplicates, and the separator with it', () => {
    expect(meetingHeading({ title: 'Sodexial — comité de staffing', clientName: 'Sodexial' })).toEqual(
      { title: 'Sodexial', subtitle: 'comité de staffing' },
    )
  })

  test('case and accents are folded before the comparison', () => {
    expect(meetingHeading({ title: 'NÉOVIA SANTÉ : cadrage data', clientName: 'Néovia Santé' })).toEqual(
      { title: 'Néovia Santé', subtitle: 'cadrage data' },
    )
  })

  test('an objet that does not open on the client keeps every word', () => {
    expect(meetingHeading({ title: 'Point hebdo Sodexial', clientName: 'Sodexial' })).toEqual({
      title: 'Sodexial',
      subtitle: 'Point hebdo Sodexial',
    })
  })

  test('an objet that is only the client leaves the row one line', () => {
    expect(meetingHeading({ title: 'Sodexial', clientName: 'Sodexial' })).toEqual({
      title: 'Sodexial',
      subtitle: undefined,
    })
  })
})
