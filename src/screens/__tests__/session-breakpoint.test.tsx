/**
 * **The breakpoint is one number spelled four times, and nothing but this
 * checks that the four agree.**
 *
 * Below `SIDE_BY_SIDE_PX` the session screen holds two reading columns and not
 * three: the compte-rendu and the slate, with the rep's own notes behind
 * « Mes notes » in the header. Four Tailwind variants carry that decision —
 * `max-[1183px]:hidden` on the notepad, `min-[1184px]:…` on the compte-rendu's
 * width, `min-[1184px]:…` on the trame's, and `min-[1184px]:hidden` on the
 * control — and they are **strings**. A typo in one of them does not fail to
 * compile, does not fail `tsc`, and does not fail any of the twelve harness
 * passes at either smoke size, because 1280 and 960 are both a long way from
 * the number: the screen would simply hide the notepad and the control on the
 * same side of the break, or on opposite sides, at some width nobody
 * photographs. A rep on a 1 152px laptop would meet it and nothing else would.
 *
 * jsdom measures every box as zero and evaluates no media query, so this test
 * cannot render the layout and does not pretend to — it reads the shipped
 * source and asserts that every arbitrary breakpoint in the file is the
 * exported number, and that the `max-` half is exactly one pixel below the
 * `min-` half. That is the whole of what can be checked without a browser, and
 * the browser half is `session-mes-notes`, which presses the control at 1280
 * and fails if it is drawn there.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SIDE_BY_SIDE_PX } from '../Session.tsx'

// Vitest serves the renderer over http, so `import.meta.url` is not a file URL
// here. The path is resolved from the project root, which is `vitest.config`'s
// own cwd, so the file read is the file the suite imported.
const SOURCE = readFileSync(path.resolve('src/screens/Session.tsx'), 'utf8')

describe('the session screen’s breakpoint', () => {
  test('every min-[…px] variant in the file is SIDE_BY_SIDE_PX', () => {
    const mins = [...SOURCE.matchAll(/min-\[(\d+)px\]:/g)].map((m) => Number(m[1]))
    expect(mins.length).toBeGreaterThan(0)
    expect([...new Set(mins)]).toEqual([SIDE_BY_SIDE_PX])
  })

  test('every max-[…px] variant is one pixel below it', () => {
    const maxes = [...SOURCE.matchAll(/max-\[(\d+)px\]:/g)].map((m) => Number(m[1]))
    expect(maxes.length).toBeGreaterThan(0)
    expect([...new Set(maxes)]).toEqual([SIDE_BY_SIDE_PX - 1])
  })

  test('the notepad and the control never vanish together', () => {
    // The notepad is hidden below the break and the control that fetches it is
    // hidden above: one of the two is on screen at every width, which is the
    // property the two spellings exist to produce. Asserted on the *pair* of
    // variants rather than on either number, so swapping them is red.
    expect(SOURCE).toContain("twoUp ? 'max-[1183px]:hidden' : ''")
    expect(SOURCE).toContain('className="shrink-0 min-[1184px]:hidden"')
  })

  test('the number is the one the measurement gave', () => {
    // 1 184 is the first sampled viewport width at which every run of prose on
    // `session-compte-rendu` clears 45 characters a line; 1 176 does not (42).
    // Changing it is a measurement, not an edit — re-run the sweep in the
    // commit that changes it.
    expect(SIDE_BY_SIDE_PX).toBe(1184)
  })
})
