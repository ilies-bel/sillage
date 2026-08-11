/**
 * Graph's `dateTimeTimeZone` → epoch milliseconds.
 *
 * The app has exactly one time representation (`TimestampSchema`: epoch ms,
 * UTC), so every date Graph returns is converted once, here, at the boundary.
 *
 * The conversion is not `new Date(s)`. With `Prefer: outlook.timezone="Europe/
 * Paris"` set — which the delta query does set, so that everything Graph returns
 * about an event is stated in the rep's own zone — the string comes back as
 * `2026-08-05T14:00:00.0000000` with *no offset* and the zone named separately.
 * Handing that to `Date` gets local time on a developer's laptop and UTC on a
 * server, and the failure is a meeting that arms an hour early twice a year.
 */

const PARTS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/

/**
 * How far ahead of UTC the zone is at that instant, in ms.
 *
 * Formatting the instant *into* the zone and reading the wall clock back is the
 * only way to get this without shipping a tz database: `Intl` already has one.
 */
const offsetAt = (utcMs: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))

  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = field('hour') % 24
  const wall = Date.UTC(field('year'), field('month') - 1, field('day'), hour, field('minute'), field('second'))
  return wall - utcMs
}

/**
 * Returns NaN for anything unparseable, which callers treat as "drop this
 * event" — a date the app cannot read is worse than an event it never saw.
 */
export const zonedToEpoch = (dateTime: string, timeZone: string): number => {
  const match = PARTS.exec(dateTime.trim())
  if (!match) return NaN

  const [, y, mo, d, h, mi, s] = match
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'))

  const zone = timeZone.trim()
  if (!zone || zone.toUpperCase() === 'UTC' || zone === 'Etc/GMT') return wall

  let instant: number
  try {
    // Two passes. The first offset is looked up at the wrong instant — off by
    // the offset itself — which lands on the wrong side of a DST change for
    // meetings within an hour of one. The second pass looks it up at the
    // corrected instant and settles it.
    instant = wall - offsetAt(wall, zone)
    instant = wall - offsetAt(instant, zone)
  } catch {
    // An unknown IANA zone. Reading it as UTC is off by at most a few hours,
    // where refusing the event loses the meeting entirely.
    return wall
  }
  return instant
}
