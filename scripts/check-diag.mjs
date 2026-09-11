#!/usr/bin/env node
/**
 * DEC-27, enforced: **the bundle's button is a promise, and the message half of
 * it cannot be kept by a denylist.**
 *
 * `core/domain/redactDiagnostics.ts` has leaked in four review rounds — a
 * Windows home directory, a vendor API key, a client's name inside a quotation,
 * and a client's name that quoting *published* because the apostrophes around it
 * were an English possessive. Every one of them arrived the same way: a
 * `message:` built from a string this product did not write. The verdict after
 * the third round was that a denylist over free-form text cannot be made safe,
 * only made narrower, and the fourth round stopped narrowing it: the call site
 * declares, and a foreign message leaves as `[message:N]`.
 *
 * A declaration nobody is obliged to make is a comment. So this is the grep that
 * obliges it, in the `check-platform.mjs` shape:
 *
 *   **A `.record({…})` whose `message:` is not a string literal must carry
 *   `origin: 'authored'` or `origin: 'foreign'`.**
 *
 * A string literal needs no declaration — it is the product's own French, and
 * there is nothing to be wrong about. Everything else has somewhere for a
 * foreign value to enter: a template's interpolation, an identifier, a ternary
 * over `error.message`. The gate is not « is this message safe », which no grep
 * can answer, it is « did somebody decide », which is exactly what was missing
 * each of the four times.
 *
 * `origin` supplied as a variable or a shorthand counts as declared: the four
 * private `#record` helpers in `app/session/` take it as a **required**
 * parameter, so `tsc` is what holds their callers to a choice — one check for
 * the boundary, the type system for the fan-in.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['electron']

/**
 * Sites that must declare and cannot be edited yet, with the reason — the
 * `check-platform.mjs` shape, including the half that matters most: an entry
 * that is no longer a violation fails too, so the list cannot rot into a
 * blanket exemption.
 *
 * **Empty, and that is the point** — the `UNREACHED` list in
 * `check-surfaces.mjs` is empty for the same reason. It held two files for as
 * long as it took to read where their strings come from, and both turned out to
 * be the judgement this check exists to force rather than a reason to wait:
 * `update.install.refused` carries `BLOCKING[state]`, `agenda.arm.refused`
 * carries `STATE_REASON[from]`, and `agenda.adhoc.armed` carries a
 * `MEETING_APPS` label — three closed tables of our own French, all of which a
 * blanket `foreign` would have replaced with `[message:N]` for no safety gain
 * at all. Only `ipc.handler.failed` was foreign.
 *
 * Note what the *shape* of the exemption cost, which is why it is not to be
 * refilled lightly: it is keyed by **file**, so listing `register.ts` — sixteen
 * hundred lines and every IPC handler in the product — exempted every future
 * `.record({…})` written there as well as the two it was added for.
 */
const PENDING = new Map()

const EXTENSIONS = new Set(['.ts', '.tsx'])

const walk = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

/**
 * Comments, blanked to spaces so every offset and line number is preserved.
 *
 * **This is not tidiness, it is the difference between the check working and
 * silently not.** The property scanner below is string-aware, and a comment is
 * full of apostrophes and backticks: the first version read
 * `// A provider's own \`Error.message\`` as an unterminated string and lost the
 * `origin:` line that followed it — reporting two real declarations as
 * undeclared, which is the benign direction, and would have read a *comment*
 * mentioning `origin: 'authored'` as a declaration, which is not.
 */
const blankComments = (src) => {
  const out = src.split('')
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' '
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' '
      i--
    }
  }
  return out.join('')
}

/**
 * The object literal starting at `open`, brace-balanced and string-aware.
 * A regex cannot do this: `detail: { meetingId, ...detail }` nests, and
 * `message: 'a } b'` puts a brace inside a string.
 */
const objectAt = (src, open) => {
  let depth = 0
  let quote = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return null
}

/** Top-level properties of an object literal source: `{ key: value }` and `{ key }`. */
const propertiesOf = (obj) => {
  const out = new Map()
  const body = obj.slice(1, -1)
  let depth = 0
  let quote = null
  let key = null
  let start = 0
  let piece = 0
  const finish = (end) => {
    const text = body.slice(start, end)
    if (key !== null) out.set(key, text.trim())
    else {
      const bare = body.slice(piece, end).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(bare)) out.set(bare, bare)
    }
    key = null
    piece = end + 1
    start = end + 1
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if ('{[('.includes(c)) depth++
    else if ('}])'.includes(c)) depth--
    else if (depth === 0 && c === ':' && key === null) {
      const name = body.slice(piece, i).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) {
        key = name
        start = i + 1
      }
    } else if (depth === 0 && c === ',') finish(i)
  }
  finish(body.length)
  return out
}

/**
 * A string literal, or a `+` chain of them — which is how a long French sentence
 * is wrapped to eighty columns and is still entirely the product's own words.
 * A **template** literal is deliberately not on this list even when it has no
 * interpolation: `${}` is where three of the four leaks came in, and a template
 * with none today grows one tomorrow without the site being reconsidered.
 */
const STRING = String.raw`(?:'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*")`
const LITERAL = new RegExp(String.raw`^${STRING}(?:\s*\+\s*${STRING})*$`)

const ORIGINS = new Set(["'authored'", "'foreign'", '"authored"', '"foreign"'])

const files = ROOTS.flatMap((r) => walk(path.join(ROOT, r)))

const violations = []
const seenPending = new Set()
let declared = 0
let literal = 0

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const src = blankComments(readFileSync(file, 'utf8'))
  let cursor = 0
  for (;;) {
    const at = src.indexOf('.record({', cursor)
    if (at === -1) break
    const open = src.indexOf('{', at)
    cursor = open + 1
    const obj = objectAt(src, open)
    if (!obj) continue
    const props = propertiesOf(obj)
    // `.record({` on something that is not a DiagRecorder: no `code`/`module`.
    if (!props.has('code') || !props.has('module')) continue
    const line = src.slice(0, at).split('\n').length
    const message = props.get('message')
    const origin = props.get('origin')

    if (message !== undefined && LITERAL.test(message)) {
      literal++
      continue
    }
    if (origin !== undefined && (origin === 'origin' || ORIGINS.has(origin))) {
      declared++
      continue
    }
    if (PENDING.has(rel)) {
      seenPending.add(rel)
      continue
    }
    violations.push({
      rel,
      line,
      message: (message ?? '(passé par un paramètre)').replace(/\s+/g, ' ').slice(0, 88),
      origin,
    })
  }
}

const stale = [...PENDING.keys()].filter((rel) => !seenPending.has(rel))

if (violations.length === 0 && stale.length === 0) {
  console.log(
    `diag ok — ${literal + declared} recorded messages: ${literal} string literals, ` +
      `${declared} declared origins, ${PENDING.size} files pending (DEC-27)`,
  )
  process.exit(0)
}

for (const v of violations) {
  console.error(`\n✗ ${v.rel}:${v.line} — message: ${v.message}`)
  console.error(
    v.origin === undefined
      ? "    undeclared origin: this message is not a string literal, so add `origin: 'authored'` or `origin: 'foreign'`"
      : `    origin is \`${v.origin}\` — it must be 'authored' or 'foreign', or the required parameter named \`origin\``,
  )
}

for (const rel of stale) {
  console.error(
    `\n✗ ${rel} is listed in PENDING in scripts/check-diag.mjs but every message there is ` +
      'now a literal or declared — delete the entry so the list stays a list of real ones.',
  )
}

if (violations.length > 0) {
  console.error(
    "\n`origin: 'foreign'` means the text is not a literal this product wrote — a vendor's " +
      'error body, an OS string, a value interpolated in from the world. The redacted bundle\n' +
      "carries `[message:N]` for it. `origin: 'authored'` says this product wrote every part of " +
      'it, interpolations included, and the bundle carries the sentence.\n' +
      'The bundle’s own button reads « Sans contenu de conversation. Peut être envoyé au ' +
      'support. » (DEC-27)\n',
  )
}
process.exit(1)
