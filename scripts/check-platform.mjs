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

/**
 * Every file allowed to know what it is running on, and why it cannot be
 * written any other way. Keep the reasons in French-free English — they are for
 * whoever adds the next one.
 */
const ALLOWED = new Map([
  [
    'electron/app/main.ts',
    'window-all-closed quits off macOS, where closing the last window ends the app; ' +
      'and the boot diagnostic records which platform produced a report.',
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
  source.split('\n').forEach((line, index) => {
    // A line that only talks about a platform is documentation, not a branch.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    for (const signal of SIGNALS) {
      if (signal.re.test(line)) hits.push({ signal: signal.id, line: index + 1, text: line.trim() })
    }
  })
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
    console.error(`    ${rel}:${hit.line}  [${hit.signal}]  ${hit.text.slice(0, 96)}`)
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
