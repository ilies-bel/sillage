#!/usr/bin/env node
/**
 * CLI over `scripts/lib/boundaries.mjs`. Exit 1 on any violation.
 *
 * Reads the working tree, not the index (`--others --exclude-standard`), so a
 * violation is caught before it is staged rather than after.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { checkFile } from './lib/boundaries.mjs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', 'electron', 'src'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f))
  // `--cached` still lists a file that has been deleted from the working tree
  // but not yet staged, and reading it throws ENOENT — which turned every
  // unstaged deletion into a crash rather than a check result.
  .filter((f) => existsSync(join(ROOT, f)))

const violations = []
let checked = 0
let skipped = 0

for (const file of files) {
  const found = checkFile(file, readFileSync(join(ROOT, file), 'utf8'))
  if (found === null) {
    skipped++
    continue
  }
  checked++
  violations.push(...found)
}

if (violations.length > 0) {
  console.error(`\nimport boundary violations (${violations.length}):\n`)
  for (const v of violations) console.error(`  ${v.file}\n    ${v.why}\n    → ${v.specifier}\n`)
  console.error('see ARCHITECTURE.md §4 — "The import rule"\n')
  process.exit(1)
}

// The skipped count is printed on purpose. Those are files that survived
// demolition and have not reached their porting step yet; a silently growing
// exemption list is how a boundary rule stops meaning anything.
console.log(
  `boundaries ok — ${checked} files checked, ${skipped} not yet in a layer (see ARCHITECTURE.md §3)`,
)
