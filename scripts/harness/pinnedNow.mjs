/**
 * **The instant every harness surface pins to, defined once.**
 *
 * **Thursday 17 September 2026 at 14:35 Europe/Paris.** A plausible mid-afternoon —
 * the armed meeting has just started, two calls are behind and two ahead — and the
 * same pixels on every run.
 *
 * **The date used to be today's, and the docblock claimed the same-pixels property
 * anyway.** It held within a day and failed across one. Same commit, consecutive
 * days, `--scan` on `agenda`: « 15 signalements, 4 types » became « 16, 5 », the
 * extra being `extreme-negative-tracking` on « Vendredi 18 septembre » — three
 * characters longer than « Jeudi 17 septembre » at `--display-tracking: -1.5px`.
 * One French weekday name moved a detector count by 26 scans with nothing in `src/`
 * changed.
 *
 * That is not a cosmetic flaw in a harness whose entire purpose is comparison
 * between rounds: two scores taken on different days were not measuring the same
 * product, and nothing said so. 17 September and not another date because every
 * measurement recorded in `docs/design/RUBRIC.md` through round 20 was taken
 * against it, so pinning here keeps the recorded history comparable instead of
 * invalidating it.
 *
 * It lived in `shot.mjs` and again, character for character, in `serve.mjs`, and the
 * fixture's whole timeline is derived from it: `bridge-stub.mjs` places its meetings
 * with `at(dayOffset, hour, minute)` relative to this, `NEOVIA_STARTED` is its 14:30
 * slot, and every `receivedAt` in the transcript is measured from there. So a test
 * that wants to ask « is anything in this fixture dated after the instant the
 * fixture is pinned to » has to ask about *this* number — and a third copy of a
 * DST-resolving expression is not a place to find out, which is why the file exists
 * rather than the constant being restated in
 * `modules/extract/__tests__/harnessFixture.test.ts`.
 *
 * `page.clock.setFixedTime` freezes `Date.now()` and leaves timers running, which the
 * 200 ms search debounce needs; `serve.mjs` installs an equivalent `Date` shim.
 */
/** The pinned day, as the calendar names it. Read by the check that holds this. */
export const PINNED_DAY = { year: 2026, month: 9, day: 17, hour: 14, minute: 35 }

export const pinnedNow = () => {
  const { year, month, day, hour, minute } = PINNED_DAY
  // 14:35 Paris is 12:35Z in summer and 13:35Z in winter. Resolved by measuring
  // rather than by knowing which side of the change the date falls on, so moving
  // the pin across a DST boundary cannot silently shift it by an hour.
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const shown = new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Paris', hour12: false })
  const offsetHours = new Date(shown).getHours() - hour
  return guess - offsetHours * 3_600_000
}
