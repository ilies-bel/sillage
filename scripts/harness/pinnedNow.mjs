/**
 * **The instant every harness surface pins to, defined once.**
 *
 * Today's date at **14:35 Europe/Paris**. Fixed so the calendar always opens on a
 * plausible mid-afternoon — the armed meeting has just started, two calls are behind
 * and two ahead — and so two runs of the same screen produce the same pixels.
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
export const pinnedNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const read = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  // 14:35 Paris = 12:35Z in summer, 13:35Z in winter. Resolve it by measuring
  // rather than by knowing which side of the change today is on.
  const guess = Date.UTC(Number(read.year), Number(read.month) - 1, Number(read.day), 14, 35)
  const shown = new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Paris', hour12: false })
  const offsetHours = new Date(shown).getHours() - 14
  return guess - offsetHours * 3_600_000
}
