#!/usr/bin/env node
/**
 * The CRM containment check (DEC-29, ARCHITECTURE.md §5.J).
 *
 * The client will have their own developments on top of VerySwing. That must
 * cost an adapter change, never a core change — and the test that proves the
 * boundary still holds is a grep: every VSA identifier must live inside
 * `electron/modules/crm/vsa/`. A hit anywhere else means the abstraction has
 * already leaked and their developers will be editing core files.
 *
 * Cheap, mechanical, and it fails at the moment the leak is introduced rather
 * than the month someone tries to reuse the code.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The three named in CLAUDE.md, plus the link discriminator they travel with. */
const MARKERS = [/\btiersCode\b/, /\boppyId\b/, /\bsalesStage\b/, /\bfreeProspectId\b/]

const ALLOWED_PREFIX = 'electron/modules/crm/vsa/'

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'electron', 'src'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx|mts|mjs|cjs|js|json)$/.test(f))
  // `--cached` still lists a file deleted from the working tree but not yet
  // staged; reading it would throw ENOENT instead of reporting a result.
  .filter((f) => existsSync(join(ROOT, f)))

const leaks = []

for (const file of files) {
  if (file.startsWith(ALLOWED_PREFIX)) continue
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const marker of MARKERS) {
      if (marker.test(line)) leaks.push(`${file}:${i + 1}: ${line.trim()}`)
    }
  })
}

if (leaks.length > 0) {
  console.error(`\nVSA vocabulary outside ${ALLOWED_PREFIX} (${leaks.length}):\n`)
  for (const leak of leaks) console.error(`  ${leak}`)
  console.error('\nsee ARCHITECTURE.md §5.J — the CRM boundary\n')
  process.exit(1)
}

console.log(`crm containment ok — ${files.length} files scanned`)
