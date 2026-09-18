/**
 * **The number of passes has been wrong in prose three times, in one direction.**
 *
 * `CLAUDE.md` said « six » for three rounds and « nine » for one, four lines
 * above the list it was counting; `scripts/harness/README.md` said « Nine
 * measured checks » in one sentence and « All eight run on every stage » in the
 * next, in the same paragraph. Every one of those omitted the passes added most
 * recently — which are exactly the ones a reviewer assumes were not run, and
 * re-runs by hand, or worse assumes were run and does not.
 *
 * `smoke.mjs` holds the list once now, as `PASSES`, and spreads it into the
 * argument vector, so what a run *does* and what the file *declares* cannot
 * differ. This holds the README's copy of it to that one. It does not judge the
 * sentence around it — no test can — but a list that has silently stopped
 * matching is a list this catches, and that is the half that kept going wrong.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.resolve(HERE, '..', rel), 'utf8')

/** `PASSES` out of `smoke.mjs` itself — never a second copy beside it. */
const passes = () => {
  const source = read('harness/smoke.mjs')
  const open = source.indexOf('const PASSES = [')
  assert.ok(open > 0, 'PASSES introuvable dans smoke.mjs — la lecture a cessé de trouver')
  const close = source.indexOf('\n]', open)
  assert.ok(close > open, 'PASSES n’a pas de fin lisible')
  return [...source.slice(open, close).matchAll(/'(--[a-z0-9]+)'/g)].map((m) => m[1])
}

/** The one indented line in the README that is the list rather than prose about it. */
const documented = () => {
  const line = read('harness/README.md')
    .split('\n')
    .find((row) => /^ {4}--geometry /.test(row))
  assert.ok(
    line !== undefined,
    'la ligne de passes est absente de scripts/harness/README.md — elle commence par quatre espaces et « --geometry »',
  )
  return line.trim().split(/\s+/)
}

test('the harness README lists exactly the passes smoke.mjs runs', () => {
  const run = passes()
  const said = documented()

  // The floor: a regex that stopped matching would otherwise compare [] to []
  // and pass, which is the shape this file exists to catch one level up.
  assert.ok(run.length >= 10, `${run.length} passe(s) lues dans smoke.mjs — la lecture a cessé de trouver`)

  assert.deepEqual(
    said,
    run,
    `le README annonce ${said.length} passe(s) et smoke.mjs en lance ${run.length} : ` +
      `README ${said.join(' ')} · smoke ${run.join(' ')}`,
  )
})

test('every pass the smoke run passes is one shot.mjs accepts', () => {
  const shot = read('harness/shot.mjs')
  const unknown = passes().filter(
    (flag) => !shot.includes(`arg === '${flag}'`),
  )
  assert.deepEqual(
    unknown,
    [],
    `${unknown.length} passe(s) lancées par smoke.mjs que shot.mjs ne connaît pas : ${unknown.join(', ')} — ` +
      'shot.mjs sort avec « option inconnue » et les 170 mises en scène échouent sur la même ligne',
  )
})
