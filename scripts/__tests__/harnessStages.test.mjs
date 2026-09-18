/**
 * **The screen list is the one place a reviewer looks to learn what exists, and
 * nothing held it to the harness.**
 *
 * `scripts/harness/README.md` carries a table of stages with a sentence each —
 * what the screen is arranged to show, and why that arrangement is the
 * interesting one. It is the map. `shot.mjs` carries the stages themselves.
 * Measured when this was written: **83 stages declared, 60 documented, 23 with
 * no row at all** — and 0 stale rows, so the table never went *wrong*, it just
 * stopped being extended, which is the failure mode nobody notices because
 * every sentence in it is true.
 *
 * What that costs is specific rather than tidy. A reviewer reads the table to
 * decide what to look at, so an undocumented stage is a screen that does not
 * get reviewed — and the 23 are not a random sample. They are the ones added
 * most recently, which is to say the ones covering the defects the last few
 * rounds found: every departure stage, both refusal stages, the inert rail, the
 * no-opportunity gate. `CLAUDE.md` already records the same shape one level up,
 * about the pass list that said « six » for three rounds while nine were
 * running, and names the reason it matters — the entries a reader assumes are
 * missing are the ones they re-derive by hand, and the ones they cannot tell
 * are missing are the ones they skip.
 *
 * So the table is a check now. This does not ask for a *good* sentence, which
 * no test can judge; it asks that every stage have one and that the table name
 * no stage that has gone. A row whose sentence has rotted is still a lie this
 * cannot catch — but a screen nobody has ever described is one it can.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(path.resolve(HERE, '..', rel), 'utf8')

/**
 * The stages, read out of the `SCREENS` object itself rather than out of a
 * list somebody maintains beside it — the same reason the census reads its
 * radius rungs from `:root` at runtime. A second list is a second thing to
 * forget.
 */
const declared = () => {
  const source = read('harness/shot.mjs')
  const open = source.indexOf('const SCREENS = {')
  assert.ok(open > 0, 'SCREENS introuvable dans shot.mjs — la lecture a cessé de trouver')
  const body = source.slice(open, source.indexOf('\nconst ', open + 10))
  return [...body.matchAll(/^ {2}'?([a-zA-Z0-9-]+)'?:\s*\{/gm)].map((m) => m[1])
}

/** Every `| \`name\` |` in the README's stage table. */
const documented = () =>
  new Set([...read('harness/README.md').matchAll(/^\| ?`([a-zA-Z0-9-]+)`/gm)].map((m) => m[1]))

test('every stage shot.mjs declares has a row in the harness README', () => {
  const stages = declared()
  const rows = documented()
  // The floor is the walk's own health: 83 when this was written, and a regex
  // that stopped matching would otherwise pass this file in silence.
  assert.ok(stages.length >= 70, `${stages.length} mise(s) en scène lues — la lecture de SCREENS a cessé de trouver`)

  const undocumented = stages.filter((name) => !rows.has(name))
  assert.deepEqual(
    undocumented,
    [],
    `${undocumented.length} mise(s) en scène sans ligne dans scripts/harness/README.md : ${undocumented.join(', ')}`,
  )
})

test('the harness README names no stage that has gone', () => {
  const stages = new Set(declared())
  const stale = [...documented()].filter((name) => !stages.has(name))
  assert.deepEqual(
    stale,
    [],
    `${stale.length} ligne(s) du README nomment une mise en scène qui n'existe plus : ${stale.join(', ')}`,
  )
})
