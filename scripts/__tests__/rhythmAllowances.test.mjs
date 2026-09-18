/**
 * **An allowance may not outlive the code it excuses.**
 *
 * `--rhythm` fails on any painted spacing that is not one of the seven
 * `--space-*` steps, and `RHYTHM_ALLOWANCES` in `shot.mjs` is the short list of
 * values that are not rhythm at all and could not be recognised by a rule. Four
 * rules do the rest of that work inside the pass — a drawing is not a layout, a
 * bare tag's own spacing is not authored, a fractional length came from the type,
 * a one-sided indent past the ladder is a gutter — and rules cannot go stale.
 * A list can.
 *
 * The pass itself cannot hold it: it sees one screen, and « no element on this
 * screen wears that value » is the ordinary case for every screen but one. Whether
 * an allowance still has a site anywhere is a question about the **tree**, so it is
 * asked here, the way `check-platform.mjs` asks it of its own — and an allowance
 * whose sites have gone fails exactly as loudly as a site with no allowance.
 *
 * This is the same shape `scripts/__tests__/harnessStages.test.mjs` uses for the
 * screen list: read the declaration out of the shipped file rather than keep a
 * second copy of it beside the check.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SHOT = path.join(ROOT, 'scripts', 'harness', 'shot.mjs')

/**
 * The table, read out of `shot.mjs`'s own source.
 *
 * `shot.mjs` imports Playwright at module scope and runs a CLI on load, so it
 * cannot be imported here for one constant. The block is sliced out and
 * evaluated on its own, which keeps the single source of truth in the file that
 * uses it.
 */
const allowances = () => {
  const source = readFileSync(SHOT, 'utf8')
  const open = source.indexOf('const RHYTHM_ALLOWANCES = [')
  assert.ok(open > 0, 'RHYTHM_ALLOWANCES introuvable dans shot.mjs — la lecture a cessé de trouver')
  const close = source.indexOf('\n]', open)
  assert.ok(close > open, 'RHYTHM_ALLOWANCES n’a pas de fin lisible')
  const body = source.slice(open + 'const RHYTHM_ALLOWANCES = '.length, close + 2)
  // eslint-disable-next-line no-new-func
  return new Function(`return ${body}`)()
}

const sources = (dir) =>
  readdirSync(path.join(ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`
    if (statSync(path.join(ROOT, rel)).isDirectory()) {
      return entry === '__tests__' ? [] : sources(rel)
    }
    return /\.tsx?$/.test(entry) ? [rel] : []
  })

/**
 * The class that produced the painted value, as a Tailwind utility.
 *
 * `--rhythm` matches an allowance against the element's tag and first classes,
 * which is what the browser can hand back; a *source* grep needs the utility
 * itself. Both are stated per entry so neither can drift alone: the regex names
 * what the pass sees, `utility` names what the tree must still contain.
 */
const SITES = [
  { value: 1, utility: 'pt-px', file: 'src/widget/Widget.tsx' },
  { value: -1, utility: '-mx-px', file: 'src/screens/Historique.tsx' },
]

test('every rhythm allowance still has a site in src/, and every site an allowance', () => {
  const declared = allowances()

  assert.ok(
    declared.length > 0,
    'aucune dérogation lue — soit le bloc a changé de forme, soit ce test ne regarde plus rien',
  )
  assert.equal(
    declared.length,
    SITES.length,
    `${declared.length} dérogation(s) déclarées dans shot.mjs contre ${SITES.length} décrites ici : ` +
      'une dérogation ajoutée sans site nommé est une dérogation que rien ne tient',
  )

  for (const entry of declared) {
    assert.ok(entry.at instanceof RegExp, `dérogation sans sélecteur : ${JSON.stringify(entry.value)}`)
    assert.ok(Array.isArray(entry.sides) && entry.sides.length > 0, 'dérogation sans côté déclaré')
    /*
     * A reason long enough to be one. `src/widget/__tests__/spacing.test.tsx`
     * holds its own deviation to 80 characters for the same reason: « optique »
     * is a word, not an argument, and the next round cannot re-derive a trap
     * from it.
     */
    assert.ok(
      typeof entry.why === 'string' && entry.why.length > 120,
      `dérogation ${entry.value}px sans raison utilisable (${(entry.why ?? '').length} caractères)`,
    )
  }

  const tree = sources('src')
  assert.ok(tree.length > 50, `${tree.length} fichier(s) lus sous src/ — la lecture a cessé de trouver`)

  const missing = []
  for (const site of SITES) {
    assert.ok(
      declared.some((entry) => entry.value === site.value),
      `aucune dérogation pour ${site.value}px, alors que ${site.utility} est décrit ici`,
    )
    const source = readFileSync(path.join(ROOT, site.file), 'utf8')
    // The utility as a whole class token, never as a substring: `pt-px` must not
    // be found inside `pt-pxy`, and `-mx-px` must not match `mx-px`.
    const token = new RegExp(`(?<![\\w-])${site.utility.replace(/[-]/g, '\\-')}(?![\\w-])`)
    if (!token.test(source)) missing.push(`${site.utility} dans ${site.file}`)
  }

  assert.deepEqual(
    missing,
    [],
    `${missing.length} dérogation(s) de RHYTHM_ALLOWANCES n’ont plus de site : ${missing.join(', ')} — ` +
      'une dérogation qui survit à son motif rend --rhythm aveugle à la valeur qu’elle excuse',
  )
})
