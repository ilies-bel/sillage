/**
 * **One scale on the gate, the reader and the search** — rubric axis 3, claim 1,
 * read off the source rather than off a screenshot.
 *
 * The three surfaces this covers are the review gate (`Review.tsx`,
 * `screens/review/`), *Historique* (`Historique.tsx`) and the search shared by
 * both (`screens/search/`). `src/ui/` and the other screens have their own
 * owners and are deliberately **not** in the subject list below: a check that
 * quietly widened to the whole tree would fail on somebody else's file and get
 * an allowance written for it here, which is how a ladder stops meaning
 * anything.
 *
 * ## Why a source test as well as `--rhythm`
 *
 * `shot.mjs --rhythm` reads painted geometry on 85 stages and is the instrument
 * that matters. It has one structural limit: it can only see what a stage
 * draws. Measured on this lane's twenty-three stagings, the gate's own
 * `RecipeSwitch` chip was reported on five of them and the *Historique* record's
 * two-column grid on four, because that is where the fixtures put a rep — and a
 * `py-0.5` added to a branch no scenario reaches would be invisible to it
 * entirely. jsdom answers zero for every box, so a renderer test cannot read a
 * painted rectangle either; what it *can* read is every spacing utility the
 * shipped source declares, on every branch, reached or not.
 *
 * The two are complementary in the other direction too, and this file claims
 * neither of the axis's other two rules: a seam that is the sum of two paddings
 * is on no element in the tree, and a heading's space above it is geometry.
 * Those belong to `--rhythm` and are measured there.
 *
 * ## What it was red on
 *
 * Eleven sites when it was written, against the seven steps `tokens.css`
 * declares — the exact string it printed, with this file's fix reverted:
 *
 *   Review.tsx:3241 mt-0.5 → 2px · Review.tsx:3458 mt-0.5 → 2px ·
 *   Historique.tsx:225 pt-7 → 28px · Historique.tsx:519 pb-2.5 → 10px ·
 *   Historique.tsx:568 pb-2.5 → 10px · Historique.tsx:664 gap-6 → 24px ·
 *   Historique.tsx:999 py-0.5 → 2px · review/RecipeSwitch.tsx:90 py-0.5 → 2px ·
 *   review/TranscriptReader.tsx:466 py-0.5 → 2px ·
 *   search/Results.tsx:133 space-y-0.5 → 2px · search/SearchBar.tsx:176 px-2.5 → 10px
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

/*
 * `process.cwd()` and not `import.meta.url`: vitest serves this file through
 * vite, so its own URL is `/@fs/…` and every path built from it lands outside
 * the checkout. The runner is started from the repo root (`run-tests.mjs`).
 */
const ROOT = process.cwd()

/**
 * The surfaces this file speaks for, named once.
 *
 * A directory is walked; a file is taken on its own. `__tests__` is skipped —
 * a fixture is free to write whatever number it needs to provoke a layout.
 */
const SUBJECT = [
  'src/screens/Review.tsx',
  'src/screens/Historique.tsx',
  'src/screens/review',
  'src/screens/search',
]

/**
 * The scale, read rather than restated.
 *
 * A second copy of those seven numbers here is a copy that goes stale the first
 * time anybody tunes one. Parsing the file also makes the failure legible: a
 * step deleted from `tokens.css` takes every utility naming it down with it,
 * which is the right blast radius — and it is the one thing `--rhythm` cannot
 * see, because a `var()` with no token is an invalid declaration the browser
 * drops and the spacing is then simply not painted.
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
 * Tailwind's numeric scale is 4px a unit, `px` is one pixel, and an arbitrary
 * value says its own. Everything else — `auto`, `full`, a variable, a token
 * this product does not declare — is not a length this check can compare and is
 * skipped rather than guessed at.
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

const sourceFiles = (rel: string): string[] => {
  if (!statSync(join(ROOT, rel)).isDirectory()) return /\.tsx?$/.test(rel) ? [rel] : []
  return readdirSync(join(ROOT, rel)).flatMap((entry) =>
    entry === '__tests__' ? [] : sourceFiles(`${rel}/${entry}`),
  )
}

/**
 * Comments out, and blanked rather than deleted so the line numbers a failure
 * prints still point at the right line of the file.
 *
 * Not « a line beginning with `*` »: these files argue for their own utilities
 * by name, inside `{/* … *\/}` blocks whose lines begin with a space.
 */
const uncommented = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (line, lead: string) => lead + ' '.repeat(line.length - lead.length),
    )

const spacingSites = (): Site[] => {
  const found: Site[] = []
  for (const file of SUBJECT.flatMap(sourceFiles)) {
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
 * Both of these are already argued in `scripts/harness/shot.mjs` — one by name
 * in `RHYTHM_ALLOWANCES`, one by the rule that spares a one-sided indent past
 * the widest step. They are restated here because this check reads source and
 * that one reads pixels; neither can consult the other's list.
 */
const DEVIATIONS: Array<{ file: string; util: string; count: number; why: string }> = [
  {
    file: 'src/screens/Historique.tsx',
    util: '-mx-px',
    count: 1,
    why:
      'The open record’s stroke, pulled over the list’s hairlines rather than ' +
      'beside them, so the row does not step sideways as it opens. It is the ' +
      'width of a border — border geometry, not a rung of a ladder whose ' +
      'smallest step is four.',
  },
  {
    file: 'src/screens/search/Results.tsx',
    util: 'pl-16',
    count: 1,
    why:
      'The gutter a search result’s excerpt hangs in, on one side only and past ' +
      'the widest step of the scale. A gutter is owned by what hangs in it and ' +
      'its geometry is measured, never read — `shot.mjs --geometry` is the pass ' +
      'that owns it, and `--rhythm` spares it by the same rule.',
  },
]

test('tout espacement déclaré par la revue, l’historique et la recherche vient de l’échelle', () => {
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

  const sites = spacingSites()
  /*
   * The census, before the judgement: a check that visited nothing must not be
   * able to print what a check that visited everything prints. 149 when this
   * was written, over six files.
   */
  expect(sites.length).toBeGreaterThan(120)
  expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(5)

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
