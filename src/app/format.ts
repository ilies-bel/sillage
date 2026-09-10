/**
 * Every user-visible string that is derived rather than written.
 *
 * In one file because they are all the same decision — French, `Europe/Paris`,
 * 24-hour — and because a date formatted inline in a component is a date nobody
 * can test. `Intl` is used rather than a formatting library: it is in the
 * runtime, it knows French, and it is what the calendar module already parses
 * with.
 */
const LOCALE = 'fr-FR'

/** v1 is a French ESN. When that stops being true this is the one constant to change. */
export const TIME_ZONE = 'Europe/Paris'

const time = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
})

const dayLong = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
})

const dayShort = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIME_ZONE,
})

/**
 * **The first letter, and only the first letter.**
 *
 * French does not capitalise the names of days or months, so `Intl` correctly
 * returns « jeudi 10 septembre » and « septembre 2026 » — and five call sites
 * were putting them on screen through Tailwind's `capitalize`, which is
 * `text-transform: capitalize` and capitalises **every word**. The calendar's
 * own headings therefore read « Jeudi 10 Septembre » and « Septembre 2026 », in
 * 20px type, in a product whose compte-rendu gets « jeudi 10 septembre 2026 »
 * right two screens away.
 *
 * It is done here rather than in CSS because `::first-letter` does not apply to
 * an inline box, so the fix would have had to change the layout of the spans it
 * landed on. A string is a string.
 *
 * `Array.from` and not `[0]`: a first letter can be a surrogate pair, and
 * slicing one in half is how a formatter turns a date into a replacement
 * character.
 */
export const upperFirst = (value: string): string => {
  const [first, ...rest] = Array.from(value)
  return first === undefined ? value : first.toLocaleUpperCase(LOCALE) + rest.join('')
}

/** `5 août` — a day inside a month the reader already has in front of them. */
const dayMedium = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
})

/** `août 2026` — the calendar grid's own heading (DEC-31). */
const monthLong = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
})

/** `lun.` — the grid's column headers, derived rather than typed out. */
const weekdayShort = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  timeZone: TIME_ZONE,
})

/** `5` — the number in a month cell, and nothing else. */
const dayNumber = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', timeZone: TIME_ZONE })

export const formatTime = (ms: number): string => time.format(ms)
export const formatDayLong = (ms: number): string => dayLong.format(ms)
export const formatDayShort = (ms: number): string => dayShort.format(ms)
export const formatDayMedium = (ms: number): string => dayMedium.format(ms)
export const formatMonthLong = (ms: number): string => monthLong.format(ms)
export const formatWeekdayShort = (ms: number): string => weekdayShort.format(ms)
export const formatDayNumber = (ms: number): string => dayNumber.format(ms)

/** `09:00 – 09:30`. An en dash, because this is a range and not a subtraction. */
export const formatRange = (startMs: number, endMs: number): string =>
  `${formatTime(startMs)} – ${formatTime(endMs)}`

/**
 * The transcript's own clock: milliseconds since recording began, never wall
 * time. A rep scanning back through a call thinks in "twelve minutes in", and
 * the segment timings are relative for the same reason (`transcript.ts`).
 */
export const formatOffset = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * `01:24:07` — the running length of the call, for the header's recording chip.
 *
 * Not `formatOffset`. That one reads `84:07` past an hour and drops the leading
 * zero on the minutes, which is right for a transcript line ("twelve minutes
 * in") and wrong for a clock a rep glances at to answer "how long have we been
 * on this call". Wall-clock shape, zero-padded, hours always present so the
 * field does not change width mid-meeting and pull the title along with it.
 */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

/** `il y a 3 min`, for a sync timestamp. Deliberately coarse — a live counter is noise. */
export const formatAgo = (ms: number, now: number): string => {
  if (ms <= 0) return 'jamais'
  const seconds = Math.round((now - ms) / 1000)
  // `’`, like every other apostrophe in the product. This was the one straight
  // one left — on the calendar's sync line, where a rep reads it every day.
  if (seconds < 60) return 'à l’instant'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return formatDayShort(ms)
}

/**
 * Same day in `Europe/Paris`, not "within 24 hours" and not the machine's own
 * midnight. A rep in Paris on a laptop still set to UTC would otherwise see
 * tomorrow's 00:30 call filed under today.
 */
const dayKey = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIME_ZONE,
})

/**
 * `2026-08-05` — which Paris day an instant falls on, as a sortable string.
 *
 * Exported because the calendar grid is built out of these rather than out of
 * `Date` objects (`src/app/calendar.ts`): a day is a label, not an interval,
 * and string keys cannot drift by an hour twice a year.
 */
export const dayKeyOf = (ms: number): string => dayKey.format(ms)

export const isSameDay = (a: number, b: number): boolean => dayKeyOf(a) === dayKeyOf(b)

/**
 * How a meeting names itself in a list: the client if it has one, else the
 * objet, and « Sans objet » when it has neither.
 *
 * The third case is new and it is not an edge: a meeting now starts on one click
 * with no objet and no client, and it stays that way until the rep types one in
 * the session header. Two screens had the same `clientName || title` pair, which
 * rendered an *empty row* for such a meeting — a list of dates with nothing
 * beside them. The label is a rendering concern and stops here: nothing is
 * written into the store, so the CRM never receives « Sans objet ».
 */
export const meetingHeading = (meeting: {
  title: string
  clientName: string | null
}): { title: string; subtitle: string | undefined } => {
  const client = meeting.clientName?.trim() ?? ''
  const objet = meeting.title.trim()
  if (client === '') return { title: objet === '' ? 'Sans objet' : objet, subtitle: undefined }
  if (objet === '') return { title: client, subtitle: undefined }
  /*
   * The objet a rep types almost always opens with the client's own name —
   * « Sodexial — comité de staffing hebdomadaire », « Nordis Retail — cadrage
   * support N2 » — because that is how a calendar invitation is written. Drawn
   * as-is the row said « Sodexial » over « Sodexial — comité de staffing
   * hebdomadaire », which spends the strongest line on a word repeated three
   * pixels below it and buries the only part that distinguishes one call from
   * the next.
   *
   * So the client stays on top, where the eye scans, and the objet drops the
   * prefix it duplicates along with the dash that joined them. Nothing is
   * invented and nothing is truncated away: if the objet does not open on the
   * client it is drawn whole.
   */
  const rest = withoutClientPrefix(objet, client)
  return { title: client, subtitle: rest === '' ? undefined : rest }
}

/**
 * `« Sodexial — comité de staffing »` under a `Sodexial` title becomes
 * `« comité de staffing »`. Case- and accent-insensitive on the name, and it
 * only ever strips a *leading* occurrence followed by a separator — « point
 * Sodexial » keeps every word it has.
 */
const SEPARATOR = /^\s*[—–\-:·|]\s*/
const fold = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr')

const withoutClientPrefix = (objet: string, client: string): string => {
  if (!fold(objet).startsWith(fold(client))) return objet
  // « Sodexial » as the whole objet leaves nothing for a second line to say —
  // the title above it already is that word — so the row draws one line.
  return objet.slice(client.length).replace(SEPARATOR, '').trim()
}
