/**
 * **The scanner `check:ports` greps through, held to every token class TypeScript has
 * that looks like both a comment and a quote.**
 *
 * One `test()` per probe, named after the probe, because a check's own self-test is a
 * check: `--motion`'s counted its five attacks and one of them went silent while
 * another over-reported, which held the threshold and reported green. A count cannot
 * say *which* token class stopped being understood.
 *
 * The table is `PROSE_PROBES` in `scripts/lib/withoutProse.mjs`, shared with
 * `SILLAGE_PROSE_ATTACK=1 node scripts/check-ports.mjs` — one table, because a second
 * list is a second thing to keep true. Each probe was driven against a deliberate
 * regression before being trusted: five fail against the round-30 scanner (the regex
 * literal it could not read), four against a `regexAllowed` widened to the textbook
 * version with no JSX opinion, and the last against comments not being stripped at
 * all. None of the ten passes under every attack.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PROSE_PROBES, runProseProbes, withoutProse } from '../lib/withoutProse.mjs'

const rows = new Map(runProseProbes().map((row) => [row.name, row]))

for (const probe of PROSE_PROBES) {
  test(`withoutProse: ${probe.name}`, () => {
    const row = rows.get(probe.name)
    assert.ok(row, `la sonde « ${probe.name} » n’a pas été exécutée`)
    assert.deepEqual(
      row.missing,
      [],
      `code mangé par le scanner — ${probe.why}\n---\n${row.stripped}\n---`,
    )
    assert.deepEqual(
      row.leaked,
      [],
      `prose laissée par le scanner — ${probe.why}\n---\n${row.stripped}\n---`,
    )
  })
}

test('withoutProse: chaque sonde affirme quelque chose', () => {
  // A probe with nothing to assert is a probe that cannot fail, which is the shape
  // this file exists to refuse. `dropped` may be empty — several probes exist to
  // prove the scanner does *not* delete — but `survives` never is.
  assert.ok(PROSE_PROBES.length >= 10, `${PROSE_PROBES.length} sonde(s), il en faut dix`)
  for (const probe of PROSE_PROBES) {
    assert.ok(probe.survives.length > 0, `${probe.name} n’affirme aucun survivant`)
    assert.ok(probe.why.length > 40, `${probe.name} ne dit pas pourquoi elle existe`)
    for (const needle of [...probe.survives, ...probe.dropped]) {
      assert.ok(
        probe.source.includes(needle),
        `${probe.name} cherche « ${needle} », qui n’est pas dans sa propre source`,
      )
    }
  }
})

test('withoutProse: les sauts de ligne survivent, pour que compter les lignes veuille dire quelque chose', () => {
  const source = "const a = 'x'\n// y\nconst b = /z/\n"
  assert.equal(withoutProse(source).split('\n').length, source.split('\n').length)
})
