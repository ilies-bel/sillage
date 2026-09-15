#!/usr/bin/env node
/**
 * Render one design-review round: every screen worth judging, at both declared
 * sizes, into `scratch/<round>/`.
 *
 * Not a check — `smoke.mjs` is the check. This exists so a reviewer (human or
 * agent) can be handed one directory and see the whole product, and so two
 * rounds can be diffed by filename.
 *
 *   node scripts/harness/round.mjs round3 [screen ...]
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

/** The screens a design round is judged on, in the order a rep meets them. */
const SCREENS = [
  'splash',
  'onboarding',
  'onboarding-besoins',
  'agenda',
  'agenda-empty',
  'agenda-semaine',
  'agenda-liste',
  'session',
  'session-compte-rendu',
  'session-demander',
  'review',
  'review-garde',
  'review-valider',
  'historique',
  'reglages',
  'reglages-raccourcis',
  'widget',
]

/** Both sizes, always — 960×600 is the minimum `main.ts` declares. */
const SIZES = ['1280x800', '960x600']

const round = process.argv[2]
if (!round) {
  console.error('usage: node scripts/harness/round.mjs <round> [screen ...]')
  process.exit(2)
}
const screens = process.argv.length > 3 ? process.argv.slice(3) : SCREENS
const out = path.join(REPO, 'scratch', round)
fs.mkdirSync(out, { recursive: true })

const jobs = []
for (const screen of screens) {
  for (const size of SIZES) {
    jobs.push({ screen, size })
  }
}

let failed = 0
// Four at a time: each one is a Chromium, and the box has to stay usable.
const LANES = 4
let next = 0
async function lane() {
  for (;;) {
    const i = next++
    if (i >= jobs.length) return
    const { screen, size } = jobs[i]
    const file = path.join(out, `${screen}@${size}.png`)
    try {
      await run('node', [path.join(HERE, 'shot.mjs'), screen, file, '--viewport', size], { cwd: REPO })
      process.stdout.write(`ok   ${screen} ${size}\n`)
    } catch (err) {
      failed += 1
      process.stdout.write(`FAIL ${screen} ${size} — ${String(err.stderr ?? err).split('\n')[0]}\n`)
    }
  }
}
await Promise.all(Array.from({ length: LANES }, lane))
console.log(`\n${jobs.length - failed}/${jobs.length} rendered into scratch/${round}/`)
process.exit(failed ? 1 : 0)
