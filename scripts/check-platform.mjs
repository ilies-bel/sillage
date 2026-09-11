#!/usr/bin/env node
/**
 * HR-2, enforced: **Windows is the primary platform.**
 *
 * The requirement is easy to state and easy to lose, because every line of this
 * code is written on a Mac. It is lost one `process.platform === 'darwin'` at a
 * time, and each one looks reasonable on the machine where it was typed.
 *
 * So the rule is not "no platform branches" — capture genuinely differs — but
 * **every platform branch is declared here, with the reason it is unavoidable.**
 * A new one fails this check until someone writes that sentence down. An
 * allowance whose signal has gone fails too, so the list cannot rot into a
 * blanket exemption.
 *
 * Scope is the three layers plus the renderer, which is what ARCHITECTURE.md
 * governs. `electron/services/`, `electron/utils/` and the rest of the
 * not-yet-in-a-layer files are the old product's; they are covered when they
 * move (ARCHITECTURE.md §3).
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['electron/core', 'electron/modules', 'electron/app', 'src']
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])

/**
 * What counts as a platform commitment.
 *
 * Shell tools are in here because they are the branch that does not look like
 * one: `execFile('sysctl', …)` has no `if` in front of it and fails on Windows
 * with ENOENT at the moment the rep needs it.
 */
const SIGNALS = [
  { id: 'platform-branch', re: /\bprocess\.platform\b|\bos\.platform\(\)/ },
  { id: 'darwin-literal', re: /['"`]darwin['"`]|['"`]win32['"`]/ },
  { id: 'macos-tool', re: /\b(otool|install_name_tool|lipo|sw_vers|osascript|mdfind|sysctl|codesign)\b/ },
  { id: 'windows-tool', re: /\b(tasklist|powershell\.exe|reg\.exe|wmic)\b/ },
  { id: 'posix-path', re: /['"`](\/Applications|\/usr\/|\/tmp\/|\/Library\/|~\/Library)/ },
  { id: 'windows-path', re: /['"`][A-Z]:\\\\/ },
  { id: 'bundle-assumption', re: /\.app\/Contents|Program Files/ },
]

const NAVIGATOR = /\bnavigator\b/
const SNIFFED_PROPERTY = /\b(?:platform|userAgent)\b/
const MODERN_SNIFF = /\buserAgentData\b/

/**
 * **Signals that need more than one line to see.**
 *
 * `SIGNALS` is matched a line at a time, which is right for every one of them:
 * each is a single contiguous token — `process.platform`, `'darwin'`, `sysctl`,
 * `C:\`. The renderer's platform sniff is not, and that is the whole story of
 * this signal, which has now been wrong twice in the same direction.
 *
 * **What it is for.** `SIGNALS` was built out of the ways *main-process* code
 * learns what it is running on, and `src/` is in `ROOTS` — so a renderer
 * branching on the host was scanned for signals it can never contain.
 * `navigator.platform` (and its modern replacement `userAgentData.platform`, and
 * the `userAgent` sniff everybody reaches for when the first two are deprecated)
 * is exactly « a branch on the host », which this file's own reason for existing
 * calls the mac-first mistake — and one shipped: the notepad's entire keymap hung
 * off `if (mac)`, eight bindings deep, on the platform HR-2 says is primary and
 * this one is not. It happened to be *correct* on Windows, which is the point.
 * The gate is not « is this branch wrong », it is « is this branch declared », and
 * a renderer branch was undeclarable.
 *
 * **Round 24: anchored on the object, so the only form that compiles got
 * through.** It was `navigator\.(platform|userAgentData|userAgent)` — the object,
 * spelled literally, immediately before the dot — and
 *
 *     (navigator as any).userAgentData?.platform === 'macOS'
 *
 * exited 0, because the cast puts `any)` between the object and the property.
 * That is the spelling a TypeScript renderer *has* to use, since `userAgentData`
 * is not in the DOM lib: the check caught the form nobody writes any more and let
 * through the only form that compiles. So it was re-anchored on the **property**,
 * as two same-line alternatives.
 *
 * **Round 25: same hole, one indirection out.** Requiring both tokens on one line
 * left the check defeated by a single intermediate binding — which is what
 * TypeScript makes you write anyway:
 *
 *     const nav = window.navigator
 *     export const isMac = nav.userAgent.includes('Mac')
 *
 * Measured: `platform ok — 211 files scanned`, on an undeclared mac-first keymap
 * branch. A destructure (`const { userAgent } = navigator`), a sniff wrapped over
 * three lines and `globalThis.navigator` with the `.platform` read further down
 * were all equally invisible. **Line granularity bought a nicer error message and
 * cost the check**, so the pairing is evaluated over the *file* now and the
 * message is paid for instead: the hit is reported on the property line, which is
 * the branch, with the nearest `navigator` line named beside it.
 *
 * The scope stays the file's **code** lines — the same documentation filter the
 * per-line scan uses — and that is what keeps this from being a ban on the
 * object. `src/lib/clipboard.ts` uses `navigator.clipboard` and mentions
 * `platform` only in a comment; `src/editor/note/keymap.ts` mentions
 * `navigator.platform` only in the comment recording its removal. Both stay
 * silent, measured. The residual cost of file granularity is a `navigator` in one
 * function and an unrelated `platform` identifier in another; there is no such
 * pair in the repo today, and if one appears the answer is to name the variable
 * something else, not to go back to counting newlines.
 *
 * **`platform-destructure` is here for the same reason, and it was written
 * line-anchored first — the very hole, one signal over.** `platform` taken off
 * `process` or `node:os` *by name* is the same branch `platform-branch` is and the
 * same regex cannot see it: `const { platform } = process` contains neither
 * `process.platform` nor `os.platform()`. `darwin-literal` is the backstop and a
 * good one — a platform branch has to compare against a platform name somewhere —
 * but only when that name is spelled *in this file*, so a `WINDOWS` constant
 * imported from a shared module escapes both. The first spelling of this signal
 * was one line, and prettier's own output defeated it:
 *
 *     const {
 *       platform,
 *     } = process
 *
 * exited 0, measured. So it is matched over the joined code, where `[^}]*` spans
 * newlines and the absence of a closing brace is what bounds it. The alias form
 * (`const p = process`, then `p.platform` two hundred lines down) is out of reach
 * of a grep in any granularity and is left to `darwin-literal`, stated rather than
 * implied.
 */
const PLATFORM_BY_NAME = [
  /\{[^}]*\bplatform\b[^}]*\}\s*=\s*(?:process|os)\b/g,
  /\bimport\s*\{[^}]*\bplatform\b[^}]*\}\s*from\s*['"](?:node:)?os['"]/g,
]

/**
 * The file's code lines as one string, with a way back from an offset to the
 * original line number — the per-line scan's numbers are what a developer reads.
 */
const joinCode = (code) => {
  const starts = []
  let text = ''
  for (const entry of code) {
    starts.push({ offset: text.length, line: entry.line, text: entry.text })
    text += `${entry.text}\n`
  }
  return { text, starts }
}

const lineAt = (starts, offset) => {
  let found = starts[0]
  for (const start of starts) {
    if (start.offset > offset) break
    found = start
  }
  return found
}

const FILE_SIGNALS = [
  {
    id: 'renderer-platform-sniff',
    /** @param {{ text: string, line: number }[]} code */
    find: (code) => {
      /** @type {Map<number, { line: number, text: string, note?: string }>} */
      const hits = new Map()
      const record = (entry, note) => {
        const existing = hits.get(entry.line)
        if (existing) existing.note ??= note
        else hits.set(entry.line, { line: entry.line, text: entry.text.trim(), note })
      }

      // `userAgentData` has no meaning but a platform sniff, wherever it appears.
      for (const entry of code) if (MODERN_SNIFF.test(entry.text)) record(entry)

      const objects = code.filter((entry) => NAVIGATOR.test(entry.text))
      if (objects.length === 0) return [...hits.values()]

      for (const entry of code) {
        if (!SNIFFED_PROPERTY.test(entry.text)) continue
        const nearest = objects.reduce((best, candidate) =>
          Math.abs(candidate.line - entry.line) < Math.abs(best.line - entry.line) ? candidate : best,
        )
        record(entry, nearest.line === entry.line ? undefined : `navigator is on line ${nearest.line}`)
      }
      return [...hits.values()]
    },
  },
  {
    id: 'platform-destructure',
    /** @param {{ text: string, line: number }[]} code */
    find: (code) => {
      const { text, starts } = joinCode(code)
      if (starts.length === 0) return []
      const hits = []
      for (const re of PLATFORM_BY_NAME) {
        re.lastIndex = 0
        let match
        while ((match = re.exec(text)) !== null) {
          // Report the `platform` token, which is the name the branch will read.
          const inside = match[0].search(/\bplatform\b/)
          const name = lineAt(starts, match.index + Math.max(inside, 0))
          const source = lineAt(starts, match.index + match[0].length - 1)
          hits.push({
            line: name.line,
            text: name.text.trim(),
            note:
              source.line === name.line
                ? undefined
                : `taken off process/node:os on line ${source.line}`,
          })
        }
      }
      return hits
    },
  },
]

/**
 * Every file allowed to know what it is running on, and why it cannot be
 * written any other way. Keep the reasons in French-free English — they are for
 * whoever adds the next one.
 */
const ALLOWED = new Map([
  [
    'electron/app/main.ts',
    'window-all-closed quits off macOS, where closing the last window ends the app; ' +
      'the boot diagnostic records which platform produced a report; ' +
      'and the two macOS privacy panes are the only remedy for a capture permission ' +
      'the rep has already refused — the OS will not prompt a second time. Those two ' +
      'URLs are opened by capability, never by a platform test: `openExternal` on a ' +
      'scheme the host does not know simply rejects, and Windows has no such ' +
      'permission to refuse, so the branch never runs there.',
  ],
  [
    'electron/core/domain/updateTrust.ts',
    'whether a downloaded update can be verified before it runs *is* a question about ' +
      'the platform’s own verification mechanism, so there is nothing to probe: on ' +
      'Windows `electron-updater` checks an Authenticode signature against a publisher ' +
      'the packaging config declares, and on macOS the OS verifies the app bundle ' +
      'itself. The platform is a **parameter** here rather than `process.platform`, so ' +
      'both branches are unit-tested on either host, and the one caller passes it in.',
  ],
  [
    'electron/modules/capture/MeetingApps.ts',
    'process enumeration has no portable form: `tasklist` on Windows, `ps` elsewhere. ' +
      'The platform is injectable so the parsing of both is unit-tested on either host.',
  ],
  [
    'electron/modules/capture/nativeModule.ts',
    'napi-rs names its artefacts by platform and arch; this maps one to the other. ' +
      'It is the one place a binary name is spelled, and it spells all of them.',
  ],
  [
    'electron/modules/transcribe/whisper/inference.ts',
    'thread-count heuristics differ per platform; the platform is a parameter, not a read.',
  ],
  [
    'electron/modules/transcribe/whisper/onnx.ts',
    'available-memory probing: `vm_stat` on macOS, /proc/meminfo on Linux, ' +
      "os.freemem() on Windows — where it already means what the other two compute.",
  ],
])

const walk = async (dir) => {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    // Colocated renderer tests carry platform strings as *data* — a Windows
    // path inside a markdown fixture is content, not a branch.
    else if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = (await Promise.all(ROOTS.map((r) => walk(path.join(ROOT, r))))).flat()

const violations = []
const seen = new Set()

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const source = readFileSync(file, 'utf8')
  const hits = []
  // A line that only talks about a platform is documentation, not a branch.
  const code = source
    .split('\n')
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text))
  for (const { text, line } of code) {
    for (const signal of SIGNALS) {
      if (signal.re.test(text)) hits.push({ signal: signal.id, line, text: text.trim() })
    }
  }
  // The file-scoped signals see what no single line can: an indirection.
  for (const signal of FILE_SIGNALS) {
    for (const hit of signal.find(code)) hits.push({ signal: signal.id, ...hit })
  }
  hits.sort((a, b) => a.line - b.line)
  if (hits.length === 0) continue
  if (ALLOWED.has(rel)) {
    seen.add(rel)
    continue
  }
  violations.push({ rel, hits })
}

const stale = [...ALLOWED.keys()].filter((rel) => !seen.has(rel))

if (violations.length === 0 && stale.length === 0) {
  console.log(
    `platform ok — ${files.length} files scanned, ${ALLOWED.size} declared platform branches (HR-2)`,
  )
  process.exit(0)
}

for (const { rel, hits } of violations) {
  console.error(`\n✗ ${rel} — undeclared platform branch (HR-2: Windows is the primary platform)`)
  for (const hit of hits.slice(0, 4)) {
    const where = hit.note ? `  (${hit.note})` : ''
    console.error(`    ${rel}:${hit.line}  [${hit.signal}]  ${hit.text.slice(0, 96)}${where}`)
  }
  if (hits.length > 4) console.error(`    … and ${hits.length - 4} more`)
}

for (const rel of stale) {
  console.error(
    `\n✗ ${rel} is declared in scripts/check-platform.mjs but no longer branches on the platform — ` +
      'delete the allowance so the list stays a list of real exceptions.',
  )
}

console.error(
  '\nEither write the code so both platforms take the same path, or add the file to ' +
    '`ALLOWED` in scripts/check-platform.mjs with the reason it cannot be.\n',
)
process.exit(1)
