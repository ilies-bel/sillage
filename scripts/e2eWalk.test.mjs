/**
 * **The walk itself, read by the suite that is actually watched.**
 *
 * `npm run test:e2e` is the only thing in this repo that starts the real main
 * process, and it is in neither of the two gates: not in `npm run check`'s
 * twelve, not in `node scripts/run-tests.mjs`'s two suites. It cannot be — it
 * needs a Vite dev server, a Rust addon, 489 MB of weights and a display, and
 * CI is `ubuntu-latest` with `--ignore-scripts`. So every round has reported
 * « all green » against two gates that cannot see it, and this round found it
 * had been red for at least 105 commits.
 *
 * Running it here is not available. Reading it is. These are the two shapes that
 * cost this round, both of them findable without an Electron binary, both of
 * them checked in a suite that runs on every push:
 *
 *  · **A positional pick over a bare tag.** `page.locator('li').first()` was the
 *    first call row the day it was written and became the navigation rail the
 *    day `a36e39e` put a permanent `Rail` on that screen. The step then pressed
 *    « Aujourd'hui », left for the calendar, and spent twenty seconds waiting
 *    for a field that is not there — and took the step below it with it. A
 *    locator that picks by position out of a tag name is a locator that names
 *    the layout instead of the product.
 *
 *  · **A step that cannot be told from another step.** The report is a list of
 *    names; two steps with one name is a failure nobody can find.
 *
 * What this does *not* do is say the walk is green. Nothing here can. That is
 * stated in `run-tests.mjs`'s own summary rather than left to be assumed.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WALK = readFileSync(path.resolve(HERE, 'e2e.mjs'), 'utf8')

/** The file with its comments taken out — prose quotes both shapes on purpose. */
const code = WALK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')

test('no step picks a control by position out of a bare tag', () => {
  /*
   * `.first()`, `.nth()` and `.last()` over `locator('<tag>')` — anything that
   * is not an id, a class, an attribute or a combinator inside a named scope.
   * A tag filtered by text (`locator('li').getByText(…)`) is not this: it names
   * what it wants and fails when it is absent, rather than taking whatever the
   * DOM happens to put first.
   */
  const offences = []
  for (const match of code.matchAll(
    /\.locator\(\s*(['"`])([^'"`]*)\1\s*\)\s*\n?\s*\.(first|last|nth)\(/g,
  )) {
    const [, , selector] = match
    if (/^[a-z][a-z0-9]*$/.test(selector.trim())) {
      offences.push({ selector, line: code.slice(0, match.index).split('\n').length })
    }
  }
  assert.deepEqual(
    offences,
    [],
    offences
      .map(
        (o) =>
          `scripts/e2e.mjs:${o.line} — locator('${o.selector}').first() prend ce que la page met ` +
          `en premier, pas ce que le commercial vise. Portez-le sur une région nommée.`,
      )
      .join('\n'),
  )
})

test('every step in the walk has its own name', () => {
  const names = [...code.matchAll(/await step\(\s*(['"`])([\s\S]*?)\1\s*,/g)].map(([, , n]) => n)
  // A scan that found nothing would be a green check over no subject.
  assert.ok(names.length >= 30, `seulement ${names.length} étape(s) lue(s) dans scripts/e2e.mjs`)
  const seen = new Set()
  const twice = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)))
  assert.deepEqual(twice, [], `deux étapes portent le même nom : ${twice.join(', ')}`)
})

test('every prerequisite the walk needs is one the walk refuses to start without', () => {
  /*
   * Three things live outside the throwaway profile and none of them is created
   * by `npm install`: the dev server, the native addon and the local weights.
   * The run guarded one of them and scored 20 failures out of 38 without the
   * other two, which reads as « my change broke the app » — the exact afternoon
   * the first guard was written to stop two lanes losing.
   *
   * Checked by remedy, because the remedy is what a developer acts on.
   */
  const guard = /const requirePrerequisites[\s\S]*?\n\}\n/.exec(code)?.[0]
  assert.ok(guard, 'requirePrerequisites introuvable')
  for (const remedy of ['npm run dev', 'npm run build:native', 'npm run whisper:fetch']) {
    assert.ok(guard.includes(remedy), `le garde-fou ne nomme pas « ${remedy} »`)
  }
  assert.match(code, /await requirePrerequisites\(\)/)
})
