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

/**
 * **A file `grep` calls binary is a file this rule's own command cannot report.**
 *
 * `CLAUDE.md` states the CRM boundary as a command a person runs: the
 * containment grep over `electron/` and `src/`, which must hit only under
 * `electron/modules/crm/vsa/`.
 *
 * `src/screens/Review.tsx` carried a literal U+0000 inside a template string — a
 * deliberate separator, written as the byte instead of as the escape. POSIX
 * `grep` treats any file holding a NUL as binary and answers « Binary file …
 * matches » without printing a line, so the documented command silently stopped
 * naming lines in the 3 300-line file that holds the CRM gate. This script reads
 * with Node and was never fooled, which is precisely why nothing noticed: the
 * check and the command it documents had quietly become two different tests.
 *
 * Any C0 control other than tab, newline and carriage return, over the same file
 * list this check already walks — so it is exactly as wide as the rule whose
 * instrument it protects, and it covers the next tool that reads source as text
 * rather than only `grep`.
 */
const BINARY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const opaque = []


for (const file of files) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const control = BINARY.exec(source)
  if (control !== null) {
    const at = source.slice(0, control.index).split('\n').length
    const code = control[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
    opaque.push(`${file}:${at}: U+${code}`)
  }
  if (file.startsWith(ALLOWED_PREFIX)) continue
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    for (const marker of MARKERS) {
      if (marker.test(line)) leaks.push(`${file}:${i + 1}: ${line.trim()}`)
    }
  })
}

if (opaque.length > 0) {
  console.error(`\nsource files a text tool reads as binary (${opaque.length}):\n`)
  for (const one of opaque) console.error(`  ${one}`)
  console.error(
    '\nPOSIX grep prints « Binary file … matches » and no line, so the containment\n' +
      'command this check documents stops reporting anything in that file. Write the\n' +
      'control as an escape — same value, readable file.\n',
  )
  process.exit(1)
}

if (leaks.length > 0) {
  console.error(`\nVSA vocabulary outside ${ALLOWED_PREFIX} (${leaks.length}):\n`)
  for (const leak of leaks) console.error(`  ${leak}`)
  console.error('\nsee ARCHITECTURE.md §5.J — the CRM boundary\n')
  process.exit(1)
}

console.log(
  `crm containment ok — ${files.length} files scanned, none opaque to a text tool`,
)
