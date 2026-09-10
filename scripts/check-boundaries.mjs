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

/*
 * **The exemption is frozen at its size, not merely printed.**
 *
 * Those are the files that survived demolition and have not reached their
 * porting step (ARCHITECTURE.md §3). They are outside `core/`, `modules/` and
 * `app/`, so the import rule does not reach them and neither does the platform
 * check — which means a file dropped into `electron/services/` today is
 * unconstrained by anything in this repo, and the count was the only thing
 * standing between that and shipping.
 *
 * A printed number is not a check. `RESIDUE` is what the tree holds today; the
 * count may fall as steps port their subject in, and it may never rise. A step
 * that ports a file lowers it; nothing else is allowed to touch it.
 */
const RESIDUE = 42

if (skipped > RESIDUE) {
  console.error(
    `\n${skipped} fichiers hors des trois couches, pour ${RESIDUE} attendus.\n` +
      "Un nouveau fichier sous electron/services, audio, lib, update ou utils n'est soumis\n" +
      "à aucune règle d'import ni à la vérification de plateforme (ARCHITECTURE.md §3).\n" +
      'Écris-le dans core/, modules/ ou app/ — ou porte son voisin et baisse ce chiffre.',
  )
  process.exit(1)
}

// Falling is the point of the number, so it says so when it falls.
const note =
  skipped < RESIDUE
    ? ` — ${RESIDUE - skipped} de moins qu'attendu, baisse RESIDUE dans ce fichier`
    : ''

console.log(
  `boundaries ok — ${checked} files checked, ${skipped} not yet in a layer${note} (see ARCHITECTURE.md §3)`,
)
