/**
 * **The widget's spacing rhythm** — one scale, and groups that are groups.
 *
 * Two blind reviewers scored this surface 8–9 on every axis but one: spacing
 * rhythm, 6.5, the lowest on the window by a point and a half. The axis makes
 * three claims — one scale, tight groups against generous separation, and a
 * heading's space above it — and nothing in this repo measured any of them.
 * `smoke.mjs` had ten passes and none read a gap; `--census` reads radii and
 * author-decided control heights; jsdom returns zero for every box, so a
 * renderer test cannot read a painted rectangle either. `--rhythm` is the
 * eleventh and it does read one — count them in `smoke.mjs` rather than trusting
 * this sentence, which is the third place in the tree to have said « ten ».
 *
 * What a test *can* read is what the shipped component declares, and that is
 * what both halves below do. The numbers each one is pinned to were measured on
 * the real renderer first, through `scripts/harness/shot.mjs --no-png` with a
 * probe walking `#window`, at **1280×800 and 960×600 — identical at both, the
 * widget being a fixed-width card in a content-sized window**:
 *
 *   the pill, before   six children, five gaps, `[8, 8, 8, 8, 8]`; padding
 *                      10 left / 6 right; ink 11 px from the left edge, 7 from
 *                      the right; 285.55 × 38
 *   the pill, after    two groups, `gap-tight` inside each and `gap-inline`
 *                      between; padding 8 / 8; ink 9 / 9; 281.55 × 38
 *   the panel, before  band seams (a sum of two paddings, nothing declares
 *                      them) 12, 14.2, 13.7 px — three separations inside
 *                      2.2 px of one another, one of them a step of the scale
 *   the panel, after   12, 12, 11.75, against 6 px between two turns *inside*
 *                      the log
 *   the title          glyph to glyph, 3.8 px under it to its own caption,
 *                      5.8 px now, against 9 px above it from the card's edge
 *
 * Neither half of this file can see a pixel. The first reads the source of
 * everything the widget window draws and resolves every spacing utility in it
 * against the seven steps `tokens.css` declares; the second renders the
 * component and reads the classes that reached the DOM. The stages remain the
 * only thing that measures the result.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Widget } from '../Widget.tsx'

/*
 * `process.cwd()` and not `import.meta.url`: vitest serves this file through
 * vite, so its own URL is `/@fs/…` and every path built from it lands outside
 * the checkout. The runner is started from the repo root (`run-tests.mjs`).
 */
const ROOT = process.cwd()

/**
 * The scale, read rather than restated.
 *
 * `--space-*` lives in `src/design/tokens.css` and a second copy of those seven
 * numbers here is a second copy that goes stale the first time anybody tunes
 * one. Parsing the file also makes the failure legible: a step that is deleted
 * takes every utility naming it down with it, which is the right blast radius.
 */
const scale = (): Map<string, number> => {
  const css = readFileSync(join(ROOT, 'src/design/tokens.css'), 'utf8')
  const steps = new Map<string, number>()
  for (const m of css.matchAll(/--space-([a-z]+):\s*(\d+(?:\.\d+)?)px/g)) {
    steps.set(m[1], Number(m[2]))
  }
  return steps
}

const STEPS = scale()
const ALLOWED = new Set<number>([0, ...STEPS.values()])

/**
 * Tailwind's numeric scale is 4 px a unit, `px` is one pixel, and an arbitrary
 * value says its own. Everything else — `auto`, `full`, a variable — is not a
 * length this check can compare and is skipped rather than guessed at.
 */
const px = (raw: string): number | null => {
  if (raw.startsWith('[')) {
    const m = /^\[(-?\d+(?:\.\d+)?)px\]$/.exec(raw)
    return m === null ? null : Number(m[1])
  }
  if (STEPS.has(raw)) return STEPS.get(raw) as number
  if (raw === 'px') return 1
  const n = Number(raw)
  return Number.isFinite(n) ? n * 4 : null
}

/**
 * `p`/`m` take their side glued on (`px-2`, `mt-hair`); `gap` and `space` take
 * theirs with a dash (`gap-x-2`, `space-y-tight`). Bare `space-…` is not a
 * spacing utility at all, and a leading `-` is a negative margin.
 */
const UTILITY =
  /(?<![\w-])(-?)(?:(p|m)([xytblrse])?|(gap|space)(?:-([xy]))?)-(\[[^\]\s]+\]|[A-Za-z]+|[\d.]+)(?![\w-])/g

interface Site {
  file: string
  line: number
  util: string
  value: number
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`
    if (statSync(join(ROOT, rel)).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(rel)
    }
    return /\.tsx?$/.test(entry) ? [rel] : []
  })

/**
 * Comments out, and blanked rather than deleted so the line numbers a failure
 * prints still point at the file.
 *
 * Not « a line beginning with `*` »: this file's subject argues for its own
 * utilities by name, inside `{/* … *\/}` blocks whose lines begin with a
 * space. That first cut reported two of its own paragraphs as defects.
 */
const uncommented = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, lead: string) => lead + ' '.repeat(line.length - lead.length))

const spacingSites = (dir: string): Site[] => {
  const found: Site[] = []
  for (const file of sourceFiles(dir)) {
    const lines = uncommented(readFileSync(join(ROOT, file), 'utf8')).split('\n')
    lines.forEach((line, index) => {
      for (const m of line.matchAll(UTILITY)) {
        const [, negative, pm, , gapSpace, gapSide, raw] = m
        if (gapSpace === 'space' && gapSide === undefined) continue
        if (pm === undefined && gapSpace === undefined) continue
        const value = px(raw)
        if (value === null) continue
        found.push({ file, line: index + 1, util: m[0], value: negative === '-' ? -value : value })
      }
    })
  }
  return found
}

/**
 * **The declared deviations, and why each is not a rhythm step.**
 *
 * Keyed by file and utility with the count, the way `check-platform.mjs` keys
 * its allowances: an entry whose sites have gone fails as loudly as a site with
 * no entry, so a deviation cannot outlive the reason for it.
 *
 * There is exactly one on this surface.
 */
const DEVIATIONS: Array<{ file: string; util: string; count: number; why: string }> = [
  {
    file: 'src/widget/Widget.tsx',
    util: 'pt-px',
    count: 1,
    why:
      'One pixel, and it is not a gap between two things: it is the timestamp ' +
      'column of a mark row nudged onto the first line of the prose beside it, ' +
      'which is set at a different size. An optical alignment inside one row, ' +
      'not a step of the ladder the card is built on.',
  },
]

test('tout espacement peint par la fenêtre widget vient de l’échelle déclarée', () => {
  // The scale itself, first: a check that silently read an empty token file
  // would pass every utility in the tree.
  expect([...STEPS.keys()].sort()).toEqual([
    'block',
    'gutter',
    'hair',
    'inline',
    'row',
    'snug',
    'tight',
  ])

  const sites = spacingSites('src/widget')
  // The census, before the judgement: a check that visited nothing must not be
  // able to print what a check that visited everything prints.
  expect(sites.length).toBeGreaterThan(20)

  const declared = (site: Site) =>
    DEVIATIONS.some((d) => d.file === site.file && d.util === site.util)

  const offScale = sites.filter((s) => !ALLOWED.has(Math.abs(s.value)) && !declared(s))
  // Joined into one string on purpose: a reporter abbreviates an array of two
  // to « [ …(2) ] », and a failure nobody can read is a failure nobody fixes.
  expect(
    offScale.map((s) => `${s.file}:${s.line} ${s.util} → ${s.value}px`).join(' · '),
    'une valeur hors des sept pas de --space-*',
  ).toBe('')

  // And the other direction: an allowance whose sites have gone.
  for (const d of DEVIATIONS) {
    const hits = sites.filter((s) => s.file === d.file && s.util === d.util)
    expect(hits.length, `déviation déclarée sans emploi : ${d.file} ${d.util}`).toBe(d.count)
    expect(d.why.length).toBeGreaterThan(80)
  }
})

let bridge: FakeBridge
let uninstall: () => void

beforeEach(() => {
  bridge = fakeBridge()
  bridge.when('widget:state', () => ({
    mentionSentence: 'Je prends des notes avec Sillage.',
    meeting: {
      meetingId: 'm1',
      title: 'Néovia Santé — cadrage',
      clientName: 'Néovia Santé',
      startedAt: Date.UTC(2026, 8, 11, 12, 0, 0),
      marks: [],
      paused: false,
    },
  }))
  bridge.when('widget:resize', () => ({ ok: true, above: false }))
  bridge.when('window:focus', () => ({ ok: true }))
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

/** The `gap-…` a flex row declares, in pixels, or `null` if it declares none. */
const gapOf = (el: Element): number | null => {
  for (const cls of (el.getAttribute('class') ?? '').split(/\s+/)) {
    const m = /^gap(?:-[xy])?-(.+)$/.exec(cls)
    if (m !== null) return px(m[1])
  }
  return null
}

test('la pilule groupe ses relevés et ses commandes au lieu de les aligner', async () => {
  render(<Widget />)
  await screen.findByLabelText('Durée d’enregistrement')

  const pill = document.querySelector('[data-pill]')
  if (pill === null) throw new Error('la pilule n’a pas été trouvée')

  const between = gapOf(pill)
  expect(between, 'la pilule ne déclare aucun gap').not.toBeNull()

  /*
   * Every row *inside* the pill, whatever it holds. Naming the two groups would
   * make this a check on the arrangement I happen to have written; asking every
   * multi-child row makes it a check on the rule, so a third group added later
   * is measured the same way.
   */
  const rows = [...pill.querySelectorAll('*')].filter(
    (el) => [...el.children].length > 1 && gapOf(el) !== null,
  )
  expect(rows.length, 'aucun groupe dans la pilule').toBeGreaterThan(0)

  for (const row of rows) {
    const inner = gapOf(row) as number
    expect(
      inner * 2,
      `groupe « ${row.getAttribute('class')} » : ${inner}px dedans contre ${between}px autour`,
    ).toBeLessThanOrEqual(between as number)
  }
})

test('les bandes du panneau se rembourrent toutes du même pas', async () => {
  render(<Widget />)
  const toggle = await screen.findByRole('button', { name: /^Ouvrir le panneau/ })
  toggle.click()
  const heading = await screen.findByRole('heading', { level: 1 })

  const card = heading.closest('[data-card]')
  if (card === null) throw new Error('la carte du panneau n’a pas été trouvée')

  /*
   * **Nothing on this card declares a seam.** Each band pads itself and what a
   * rep sees between two of them is the two paddings added — so two bands on
   * two different steps make a separation that is on neither. Measured on the
   * shipped panel before this test existed: 12, 14.2 and 13.7 px, three seams
   * within 2.2 px of one another, from `py-tight` + `py-tight`, `py-tight` +
   * `py-snug` and `py-snug` + the tray's own inset.
   *
   * A band with no `py-` of its own is not asked: the tray is a filled zone
   * whose rows reserve their tallest state in fixed heights, for a reason
   * written where it is done.
   */
  const step = (el: Element): string | null =>
    ((el.getAttribute('class') ?? '').split(/\s+/).find((c) => /^py-/.test(c)) ?? null)

  const bands = [...card.children].map(step).filter((s): s is string => s !== null)
  expect(bands.length, 'aucune bande rembourrée dans le panneau').toBeGreaterThan(1)
  expect(new Set(bands).size, `bandes sur ${new Set(bands).size} pas : ${bands.join(', ')}`).toBe(1)
})

test('la pilule est posée symétriquement dans sa carte', async () => {
  render(<Widget />)
  await screen.findByLabelText('Durée d’enregistrement')

  const pill = document.querySelector('[data-pill]')
  if (pill === null) throw new Error('la pilule n’a pas été trouvée')

  /*
   * Measured before this test existed: `pl-2.5 pr-tight` put the content 11 px
   * from the left edge and 7 from the right, on the one card that is on screen
   * for the whole call. jsdom cannot see those eleven pixels, so what is
   * asserted is the declaration that produced them — no horizontal side set on
   * its own without its opposite.
   */
  const classes = (pill.getAttribute('class') ?? '').split(/\s+/)
  const side = (prefix: string) =>
    classes.filter((c) => c.startsWith(prefix)).map((c) => px(c.slice(prefix.length)))

  const left = side('pl-')
  const right = side('pr-')
  expect(left, `padding gauche seul : ${left.join(',')}`).toEqual(right)
})
