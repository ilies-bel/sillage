/**
 * The import-boundary analyser (ARCHITECTURE.md §4).
 *
 *   core/*      → may import nothing but core/
 *   modules/X   → may import core/ and modules/X/. NOT modules/Y.
 *   app/*       → may import core/ and modules/*.
 *   src/*       → may import core/contracts/ only. Never modules/, never app/.
 *
 * Plus the purity half of the same rule, which the folder layout alone cannot
 * state: `core/` may not reach Electron, the filesystem, or the network. That
 * is what makes `core/domain/` unit-testable with no Electron, no audio device
 * and no network (ARCHITECTURE.md §5.G).
 *
 * ARCHITECTURE.md §4 named `eslint-plugin-boundaries` or `dependency-cruiser`.
 * This is neither: the rule is four lines, and a small analyser runs in
 * milliseconds with no dependency to install, no ESLint config to keep alive
 * and no plugin to upgrade. Kept separate from the CLI so the rule itself is
 * unit-testable — the deliberate `modules/a → modules/b` import that must fail
 * is a test case, not a file someone has to remember to delete.
 */
import { dirname, join, normalize } from 'node:path'

/** Layers, most specific first. `null` means "not in a layer yet". */
export const classify = (path) => {
  if (path === 'electron/preload.ts') return { layer: 'app' }
  if (path.startsWith('electron/core/')) return { layer: 'core' }
  if (path.startsWith('electron/modules/')) {
    const [, , name] = path.split('/')
    return { layer: 'modules', module: name }
  }
  if (path.startsWith('electron/app/')) return { layer: 'app' }
  if (path.startsWith('src/')) return { layer: 'renderer' }
  return null
}

/**
 * Node builtins `core/` may not touch: anything that performs I/O, opens a
 * socket, or spawns. `node:crypto`, `node:path` and `node:util` are pure and
 * stay allowed.
 */
export const FORBIDDEN_IN_CORE = new Set([
  'electron',
  'node:fs',
  'node:fs/promises',
  'node:net',
  'node:http',
  'node:https',
  'node:dns',
  'node:dgram',
  'node:tls',
  'node:child_process',
  'node:worker_threads',
  'node:sqlite',
  'node:os',
  'fs',
  'net',
  'http',
  'https',
  'child_process',
])

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gm

export const importsOf = (source) => {
  const found = []
  for (const match of source.matchAll(IMPORT_RE)) found.push(match[1] ?? match[2])
  return found
}

/**
 * Returns the violations in one file. An empty array means it passes; `null`
 * means the file is not in a layer yet and was not examined.
 */
export const checkFile = (file, source) => {
  const from = classify(file)
  if (!from) return null

  const violations = []
  const deny = (why, specifier) => violations.push({ file, why, specifier })

  for (const specifier of importsOf(source)) {
    if (!specifier.startsWith('.')) {
      if (from.layer === 'core' && FORBIDDEN_IN_CORE.has(specifier)) {
        deny('core/ must stay pure', specifier)
      }
      if (from.layer === 'renderer' && specifier === 'electron') {
        deny('the renderer must not import electron', specifier)
      }
      continue
    }

    const target = normalize(join(dirname(file), specifier)).replace(/\\/g, '/')
    const to = classify(target)
    if (!to) continue

    switch (from.layer) {
      case 'core':
        if (to.layer !== 'core') deny('core/ may import nothing but core/', specifier)
        break
      case 'modules':
        if (to.layer === 'modules' && to.module !== from.module) {
          deny(`modules/${from.module} may not import modules/${to.module}`, specifier)
        } else if (to.layer === 'app' || to.layer === 'renderer') {
          deny('modules/ may import core/ and its own folder only', specifier)
        }
        break
      case 'app':
        if (to.layer === 'renderer') deny('app/ may not import the renderer', specifier)
        break
      case 'renderer':
        // The rule is about what the renderer may reach *into `electron/`* for.
        // Inside `src/` it is an ordinary application and imports itself
        // freely — `src/editor/note/title-layout.ts` needs `./schema`.
        if (to.layer === 'renderer') break
        if (!target.startsWith('electron/core/contracts/')) {
          deny('the renderer may import core/contracts/ only', specifier)
        }
        break
    }
  }
  return violations
}
