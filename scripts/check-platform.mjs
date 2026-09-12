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
 *
 * ## Round 26: it was a list of spellings, and the list was keyed by file
 *
 * Two holes, reproduced before either was touched, both measured by writing a
 * probe into a scanned root and running this gate for real.
 *
 * **Nine spellings of « read the host » exited 0.** `navigator.appVersion`,
 * `navigator.vendor`, `nav['plat' + 'form']`, `os.type() === 'Darwin'`,
 * `execFileSync('vm_stat', …)`, `path.sep === '\\'`, `process.env.APPDATA`,
 * `'C:/Users/…'` with forward slashes, and `/proc/meminfo`. Two of those are not
 * hypothetical: `modules/transcribe/whisper/onnx.ts` shells out to `vm_stat` on
 * line 98 and reads `/proc/meminfo` on line 111, and that file was caught only
 * *incidentally*, by a `process.platform` forty lines further down. Move those
 * three lines into a helper and the file goes undeclared.
 *
 * The answer is not a longer list of tool names — that is what was there. It is
 * the general form behind each one, and there are only four:
 *
 *   1. **reading a host descriptor** — `process.platform`, `process.arch`,
 *      `os.platform/type/release/arch`, `path.sep/delimiter/win32/posix`,
 *      `navigator.<anything that answers "which machine">`;
 *   2. **naming a platform** — `'darwin'`, `'win32'`, `'linux'`, `'Darwin'`,
 *      `'Windows_NT'`, `'macOS'`;
 *   3. **shelling out to an OS binary** — any `child_process` call whose first
 *      argument is a string literal. That is the branch with no `if` in front of
 *      it: `execFileSync('vm_stat', …)` fails on Windows with ENOENT at the
 *      moment the rep needs it;
 *   4. **spelling a path or an environment variable only one platform has** —
 *      `/Applications`, `/proc/`, `C:\`, `C:/`, `%APPDATA%`, `$HOME`.
 *
 * **Every one of the four was measured against the tree before it was added, and
 * the widened set produces hits in exactly the six files that were already
 * declared — zero new violations.** That number is the whole reason to trust it:
 * a new false positive is worse than the hole, because a check developers learn
 * to work around is a check that is gone. Two candidates were measured and
 * **rejected** for exactly that reason and are recorded below so the next round
 * does not re-add them.
 *
 * **And `ALLOWED` was keyed by file.** Appending
 *
 *     export const r26MacOnlyShortcut = process.platform === 'darwin' ? 'Cmd' : 'Ctrl'
 *     export const r26Tasklist = 'tasklist /fi "imagename eq Teams.exe"'
 *
 * to `electron/app/main.ts` — a brand-new, undeclared, mac-first branch plus a
 * Windows shell-out — printed `platform ok — 210 files scanned` and exited 0,
 * measured. That is verbatim the cost `check-diag.mjs`'s own `PENDING` docblock
 * records for itself (« keyed by **file**, so listing `register.ts` exempted
 * every future `.record({…})` written there »), and the answer is the one
 * `NOT_RECORDERS` already uses: **an allowance keyed by something narrower than a
 * file, where an entry that is no longer needed fails too.**
 *
 * Narrower than a file, here, is the **signal**, with the number of times it
 * fires. `main.ts` declares four `platform-branch`, two `host-descriptor` and one
 * `darwin-literal`; a fifth `process.platform` fails, and so does deleting one of
 * the four. It is not a hash of the lines — a reformat or a rename would fail for
 * no reason, which is the noise that kills a check — and it is not the file, which
 * is what was wrong. What it costs is a number to update when a declared file
 * genuinely gains or loses a branch, and that is the event that deserves the
 * re-read.
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
 * What counts as a platform commitment — the four general forms, not a list of
 * tool names.
 *
 * `spawn-literal` is the one that needed stating twice. A `child_process` call
 * whose first argument is a quoted literal *is* a platform commitment whatever
 * the binary is called, and it is the branch that does not look like one: there
 * is no `if`, and the failure is an ENOENT on the primary platform. It is
 * anchored on the **quote** rather than on the function alone, and that is not
 * fastidiousness: `\b(?:execFile|exec|spawn)\s*\(` over this tree matches
 * `MODEL_VENDOR.exec(value)`, `/```(?:json)?…/.exec(raw)` and nineteen
 * `this.db.exec(DDL)` in `modules/store/` — twenty hits across twelve files, ten
 * of them undeclared, i.e. a check that fails on the first run and is deleted on
 * the second. Anchored on the quote it is **one hit in the whole tree**, the
 * declared `execFileSync('vm_stat', …)`. The injected-seam form
 * (`this.#options.spawn(modelId)`, `spawn(workerPath)`) is deliberately *not*
 * matched: those are our own worker seams, not the host's binaries.
 *
 * `macos-tool` and `windows-tool` survive alongside it, narrower than it and
 * kept on purpose: they name a binary a reader recognises, so the error message
 * says *what* the code is reaching for rather than only *that* it shells out, and
 * they still catch a tool name that arrives as a variable or inside a string
 * built elsewhere.
 *
 * **Two candidates were measured and rejected.** A bare
 * `\b(?:exec|execFile|spawn)\s*\(` with a non-literal first argument: three hits,
 * two of them our own injected worker seams — noise, and the noisiest kind, in
 * `modules/transcribe`. And `os.homedir()`, `os.tmpdir()`, `os.EOL`: those are
 * the *portable* APIs, the opposite of a commitment, and flagging them would
 * push code towards hand-rolled per-platform paths, which is the failure this
 * file exists to prevent. Do not re-add either.
 */
const SIGNALS = [
  { id: 'platform-branch', re: /\bprocess\.platform\b|\bos\.platform\s*\(\)/ },
  { id: 'host-descriptor', re: /\bos\.(?:type|release|arch)\s*\(\)|\bprocess\.arch\b/ },
  { id: 'darwin-literal', re: /['"`](?:darwin|win32|linux|Darwin|Windows_NT|macOS|Windows)['"`]/ },
  {
    id: 'macos-tool',
    re: /\b(otool|install_name_tool|lipo|sw_vers|osascript|mdfind|sysctl|codesign|vm_stat|diskutil|launchctl|pmset|xcrun)\b/,
  },
  {
    id: 'windows-tool',
    re: /\b(tasklist|powershell\.exe|reg\.exe|wmic|cmd\.exe|where\.exe|sc\.exe)\b/,
  },
  { id: 'spawn-literal', re: /\b(?:execFile|execFileSync|execSync|spawn|spawnSync)\s*\(\s*['"`]/ },
  {
    id: 'posix-path',
    re: /['"`](?:\/Applications|\/usr\/|\/tmp\/|\/Library\/|~\/Library|\/proc\/|\/etc\/|\/opt\/|\/private\/|\/Volumes\/|\/System\/|\/var\/)/,
  },
  // A quote, then a drive letter, then either slash — `'C:/Users/…'` is the same
  // commitment as `'C:\\Users\\…'` and used to walk straight through. The quote
  // is what keeps `https://` out: the character after it is not a colon.
  { id: 'windows-path', re: /['"`][A-Za-z]:[\\/]/ },
  { id: 'path-host-shape', re: /\bpath\.(?:sep|delimiter|win32|posix)\b/ },
  {
    id: 'host-env',
    re: /\bprocess\.env\.(?:APPDATA|LOCALAPPDATA|USERPROFILE|ProgramFiles|ProgramW6432|SystemRoot|windir|ComSpec|COMPUTERNAME|HOME|SHELL|XDG_[A-Z_]+)\b|\bprocess\.env\[\s*['"](?:APPDATA|LOCALAPPDATA|USERPROFILE|ProgramFiles|SystemRoot|windir|HOME|SHELL)['"]\s*\]/,
  },
  { id: 'bundle-assumption', re: /\.app\/Contents|Program Files/ },
]

const NAVIGATOR = /\bnavigator\b/
/**
 * The properties of `navigator` that answer « which machine is this ».
 *
 * Round 26 widened this from `platform|userAgent`, which was two thirds of a
 * sniff: `navigator.appVersion` (« 5.0 (Macintosh) ») and `navigator.vendor`
 * (« Apple Computer, Inc. ») are the two everybody reaches for the week
 * `platform` is deprecated, and both exited 0, measured. `oscpu` is Firefox's,
 * `maxTouchPoints` is how the modern advice tells you to tell a Mac from an iPad,
 * and `platformVersion` is a `userAgentData` high-entropy hint.
 *
 * **Widening this list costs nothing, which is the point of where it lives**: it
 * is only ever evaluated in a file that mentions `navigator`, and exactly one
 * file in the tree does — `src/lib/clipboard.ts`, which reads
 * `navigator.clipboard` and none of these. A property name is a common word;
 * `appVersion` alone appears on eight lines of `core/contracts/diagnostics.ts`
 * and `app/ipc/register.ts`, where it is the app's own version and no business
 * of this check. Add a property here, never to `SIGNALS`.
 */
const SNIFFED_PROPERTY = /\b(?:platform|userAgent|appVersion|vendor|oscpu|maxTouchPoints|platformVersion)\b/
const MODERN_SNIFF = /\buserAgentData\b/
/**
 * An identifier this file binds from `navigator`, so a **computed** read off it
 * can be caught: `nav['plat' + 'form']` contains no sniffable property name at
 * all and exited 0, measured.
 *
 * What this does *not* claim: a computed read is undecidable in general — the key
 * can arrive from anywhere, and `nav[k]` where `k` is a parameter cannot be
 * resolved by a grep in any granularity. What it does claim is narrower and still
 * worth having: a bracket read off a binding whose value came from `navigator` is
 * a sniff whatever is inside the bracket, because there is nothing else on that
 * object worth indexing by a computed key. Cost, measured: the one
 * navigator-bearing file in the tree binds nothing from it, so zero.
 */
const NAVIGATOR_BINDING = /(?:const|let|var)\s+(?:\{\s*)?([A-Za-z_$][\w$]*)[^=\n]*=\s*[^\n]*\bnavigator\b/

/**
 * **Signals that need more than one line to see.**
 *
 * `SIGNALS` is matched a line at a time, which is right for every one of them:
 * each is a single contiguous token — `process.platform`, `'darwin'`, `sysctl`,
 * `C:\`. The renderer's platform sniff is not, and that is the whole story of
 * this signal, which has now been wrong three times in the same direction.
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
 * **Round 26: the property list was two thirds of a sniff, and a computed read
 * was none of it.** See `SNIFFED_PROPERTY` and `NAVIGATOR_BINDING`.
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

      const nearest = (entry) =>
        objects.reduce((best, candidate) =>
          Math.abs(candidate.line - entry.line) < Math.abs(best.line - entry.line) ? candidate : best,
        )

      for (const entry of code) {
        if (!SNIFFED_PROPERTY.test(entry.text)) continue
        const near = nearest(entry)
        record(entry, near.line === entry.line ? undefined : `navigator is on line ${near.line}`)
      }

      // A computed read off a binding taken from `navigator` — `nav['plat' + 'form']`
      // carries no property name and is invisible to everything above.
      const bound = new Set()
      for (const entry of code) {
        const match = NAVIGATOR_BINDING.exec(entry.text)
        if (match) bound.add(match[1])
      }
      for (const name of bound) {
        const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*\\[`)
        for (const entry of code) {
          if (!re.test(entry.text)) continue
          const near = nearest(entry)
          record(entry, `computed read off \`${name}\`, bound from navigator on line ${near.line}`)
        }
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

const SIGNAL_IDS = new Set([...SIGNALS, ...FILE_SIGNALS].map((s) => s.id))

/**
 * Every file allowed to know what it is running on, why it cannot be written any
 * other way, and **how many times each signal is allowed to fire in it**. Keep
 * the reasons in French-free English — they are for whoever adds the next one.
 *
 * The counts are the round-26 narrowing and they are what makes this a list of
 * real exceptions rather than a list of exempt files. Both directions fail: one
 * more `process.platform` in `main.ts` than the four declared is an undeclared
 * branch in a declared file, which is what used to pass silently; one fewer is an
 * allowance that has started to rot. When a number is wrong the failure prints
 * every hit of that signal with its line, so updating it is a matter of reading
 * what changed.
 */
const ALLOWED = new Map([
  [
    'electron/app/main.ts',
    {
      hits: { 'platform-branch': 4, 'host-descriptor': 2, 'darwin-literal': 1 },
      why:
        'window-all-closed quits off macOS, where closing the last window ends the app; ' +
        'the boot diagnostic records which platform and arch produced a report; ' +
        'and the two macOS privacy panes are the only remedy for a capture permission ' +
        'the rep has already refused — the OS will not prompt a second time. Those two ' +
        'URLs are opened by capability, never by a platform test: `openExternal` on a ' +
        'scheme the host does not know simply rejects, and Windows has no such ' +
        'permission to refuse, so the branch never runs there.',
    },
  ],
  [
    'electron/core/domain/updateTrust.ts',
    {
      hits: { 'darwin-literal': 1 },
      why:
        'whether a downloaded update can be verified before it runs *is* a question about ' +
        'the platform’s own verification mechanism, so there is nothing to probe: on ' +
        'Windows `electron-updater` checks an Authenticode signature against a publisher ' +
        'the packaging config declares, and on macOS the OS verifies the app bundle ' +
        'itself. The platform is a **parameter** here rather than `process.platform`, so ' +
        'both branches are unit-tested on either host, and the one caller passes it in.',
    },
  ],
  [
    'electron/modules/capture/MeetingApps.ts',
    {
      hits: { 'platform-branch': 1, 'darwin-literal': 1, 'windows-tool': 1 },
      why:
        'process enumeration has no portable form: `tasklist` on Windows, `ps` elsewhere. ' +
        'The platform is injectable so the parsing of both is unit-tested on either host.',
    },
  ],
  [
    'electron/modules/capture/nativeModule.ts',
    {
      hits: { 'platform-branch': 2, 'host-descriptor': 2 },
      why:
        'napi-rs names its artefacts by platform and arch; this maps one to the other. ' +
        'It is the one place a binary name is spelled, and it spells all of them.',
    },
  ],
  [
    'electron/modules/transcribe/whisper/inference.ts',
    {
      hits: { 'platform-branch': 1, 'host-descriptor': 1, 'darwin-literal': 2 },
      why: 'thread-count heuristics differ per platform; the platform is a parameter, not a read.',
    },
  ],
  [
    'electron/modules/transcribe/whisper/onnx.ts',
    {
      hits: {
        'platform-branch': 3,
        'darwin-literal': 2,
        'macos-tool': 1,
        'spawn-literal': 1,
        'posix-path': 1,
      },
      why:
        'available-memory probing: `vm_stat` on macOS, /proc/meminfo on Linux, ' +
        'os.freemem() on Windows — where it already means what the other two compute. ' +
        'The shell-out and the /proc read are each declared in their own right now: ' +
        'before round 26 this file was caught only by the `process.platform` forty lines ' +
        'below them, so moving those three lines into a helper would have taken the ' +
        'whole declaration with it.',
    },
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

/** Undeclared files. */
const violations = []
/** Declared files whose count for a signal no longer matches the declaration. */
const drifted = []
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
  const allowance = ALLOWED.get(rel)
  if (!allowance) {
    if (hits.length > 0) violations.push({ rel, hits })
    continue
  }
  // A declared file with no hits at all is a rotted allowance, and `stale` says
  // so in one sentence rather than as a per-signal drift over nothing.
  if (hits.length === 0) continue
  seen.add(rel)

  const counted = new Map()
  for (const hit of hits) counted.set(hit.signal, (counted.get(hit.signal) ?? 0) + 1)
  for (const id of new Set([...counted.keys(), ...Object.keys(allowance.hits)])) {
    const found = counted.get(id) ?? 0
    const declared = allowance.hits[id] ?? 0
    if (found !== declared) {
      drifted.push({ rel, id, found, declared, hits: hits.filter((h) => h.signal === id) })
    }
  }
}

/** A declared file that no longer branches at all, or a signal id that is a typo. */
const stale = [...ALLOWED.keys()].filter((rel) => !seen.has(rel))
const unknownSignals = []
for (const [rel, allowance] of ALLOWED) {
  for (const id of Object.keys(allowance.hits)) {
    if (!SIGNAL_IDS.has(id)) unknownSignals.push({ rel, id })
  }
}

const declaredCommitments = [...ALLOWED.values()].reduce(
  (total, a) => total + Object.values(a.hits).reduce((s, n) => s + n, 0),
  0,
)

if (
  violations.length === 0 &&
  drifted.length === 0 &&
  stale.length === 0 &&
  unknownSignals.length === 0
) {
  console.log(
    `platform ok — ${files.length} files scanned, ${SIGNALS.length + FILE_SIGNALS.length} signals, ` +
      `${ALLOWED.size} declared files / ${declaredCommitments} declared platform commitments (HR-2)`,
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

for (const { rel, id } of unknownSignals) {
  console.error(
    `\n✗ ${rel} declares a count for \`${id}\`, which is not a signal this check has — ` +
      `a typo in an allowance is an allowance that never fires. Known: ${[...SIGNAL_IDS].join(', ')}.`,
  )
}

for (const { rel, id, found, declared, hits } of drifted) {
  const verb =
    found > declared
      ? `${found - declared} undeclared ${id} in an already-declared file`
      : `${declared - found} declared ${id} that no longer fires`
  console.error(
    `\n✗ ${rel} — ${verb}: the allowance says ${declared}, the file has ${found}.` +
      `\n    Read the ${found} hit(s) below, then set \`hits['${id}']\` in scripts/check-platform.mjs` +
      `\n    to ${found} and make sure the reason beside it still covers all of them.`,
  )
  for (const hit of hits) {
    const where = hit.note ? `  (${hit.note})` : ''
    console.error(`    ${rel}:${hit.line}  [${hit.signal}]  ${hit.text.slice(0, 96)}${where}`)
  }
}

for (const rel of stale) {
  console.error(
    `\n✗ ${rel} is declared in scripts/check-platform.mjs but no longer branches on the platform — ` +
      'delete the allowance so the list stays a list of real exceptions.',
  )
}

console.error(
  '\nEither write the code so both platforms take the same path, or declare it in ' +
    '`ALLOWED` in scripts/check-platform.mjs — the file, the per-signal count, and the ' +
    'reason it cannot be written portably.\n',
)
process.exit(1)
