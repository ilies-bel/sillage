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
 *
 * **And a `.record({…})` this check cannot read right through is a finding, not
 * a skip.** It used to require the literal keys `code:` and `module:` to be
 * present and *silently ignore* every site that did not have them, on the
 * reasoning « `.record(` on something that is not a `DiagRecorder` ». So
 * `diagnostics.record({ ...META, message: error.message })` — a per-module
 * `meta` object, which is the ordinary way to stop repeating `module: 'crm'` on
 * thirty sites, and a foreign vendor message, which is how all four leaks
 * arrived — was invisible to the gate. It was reproduced: the eightieth site was
 * added, the census printed **79** for the second time, and the green sentence
 * was printed over it. That last part is the general lesson and it now has three
 * recorded instances of its own in `CLAUDE.md`: a check that measures nothing
 * must not be able to wear the green sentence, so the number of sites *set
 * aside* is on that line and a zero reads as a zero.
 *
 * What replaced the skip is not a looser rule but a narrower exemption, in two
 * parts. A site whose object is readable right through and has no `code`/`module`
 * is set aside **by `tsc`, not by this check's judgement** — `DiagInput` requires
 * both, so such a literal could not compile as a `DiagRecorder.record` argument.
 * Anything else — a spread, a quoted key, a computed key, braces this scanner
 * cannot balance — is a finding until somebody declares it, either with `origin`
 * at the site or in `NOT_RECORDERS` below.
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

/**
 * `.record({…})` sites whose receiver is genuinely **not** a `DiagRecorder`, and
 * which this check cannot read well enough to say so on its own — one entry per
 * `file:receiver`, with the reason.
 *
 * Two things make this narrow rather than a blanket exemption, and both are the
 * `check-platform.mjs` shape:
 *
 * 1. It is keyed by the **receiver** as well as the file, so listing one
 *    `counters.record({…})` does not exempt the `diagnostics.record({…})`
 *    written in the same file next month. `PENDING` above is keyed by file and
 *    its own docblock records what that cost.
 * 2. **An entry that is no longer needed fails.** Not « no longer present » —
 *    *no longer needed*: the key is counted as used only when it actually
 *    suppressed a finding. A receiver that has since become readable, or whose
 *    site now declares `origin`, takes its entry down with it.
 *
 * **Empty, and a zero is printed rather than implied.** Most non-`DiagRecorder`
 * `.record(` in this repo needs no entry because it is refused by the type
 * system instead: `DiagInput` requires `severity`, `code`, `module` and
 * `message`, so an object literal this check can read *completely* and which has
 * no `code`/`module` could not compile as a `DiagRecorder.record` argument. That
 * is the `preloadUnwrap.test.ts` division of labour — one check for the
 * boundary, `tsc` for what a grep cannot see — and it is sound only while the
 * object is fully readable, which is why an unreadable entry ends up here and
 * not there. The three `z.record(…)` in `core/contracts/` are not matched at all
 * (no `{`), and the dozen in `__tests__` are outside the walk.
 */
const NOT_RECORDERS = new Map()

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

/**
 * Top-level properties of an object literal source: `{ key: value }` and `{ key }`
 * — **and every top-level entry that is neither**, kept rather than dropped.
 *
 * That last clause is the whole of the twenty-fifth round's finding. This
 * function used to *silently discard* anything it could not name: a spread, a
 * quoted key, a computed key, a method. The caller then asked « does it have
 * `code` and `module`? », got no for a site that supplies both through
 * `{ ...META, message: error.message }`, and concluded the receiver was not a
 * `DiagRecorder` at all — so the one interesting property of that site, its
 * foreign `message`, was never looked at. A per-module `meta` object is the
 * ordinary way to stop repeating `module: 'crm'` on thirty call sites, so the
 * hole sat exactly where the check is most likely to be needed.
 *
 * `unreadable` is the list of those entries. What the caller does with it is the
 * rule `shot.mjs --fade` learned in the same round: **something the check cannot
 * parse is a finding, not a skip — that is where the thing being looked for
 * would hide.**
 *
 * Each entry carries its offset inside the object, because in
 * `{ message: 'our French', ...META }` the spread comes **last and wins** — so a
 * literal `message:` is only a literal while nothing unreadable follows it. That
 * is the same rule one shape over, and the first version of this fix had it
 * wrong: it took the visible literal as settling the site.
 */
const propertiesOf = (obj) => {
  const out = new Map()
  const unreadable = []
  const body = obj.slice(1, -1)
  let depth = 0
  let quote = null
  let key = null
  let start = 0
  let piece = 0
  const at = new Map()
  const finish = (end) => {
    const text = body.slice(start, end)
    if (key !== null) {
      out.set(key, text.trim())
      at.set(key, piece)
    } else {
      const bare = body.slice(piece, end).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(bare)) {
        out.set(bare, bare)
        at.set(bare, piece)
      }
      // Not a name, not `name: value`, not empty (a trailing comma, or `{}`).
      else if (bare !== '') {
        unreadable.push({ text: bare.replace(/\s+/g, ' ').slice(0, 60), at: piece })
      }
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
  /** `true` when something this scanner cannot read is written after `key`, and so overrides it. */
  const overridden = (key) => unreadable.some((u) => u.at > (at.get(key) ?? Infinity))
  return { props: out, unreadable, overridden }
}

/**
 * The expression `.record({…})` is called on — `this.#diagnostics`, `diagnostics`,
 * `deps.recorder?`. It is what `NOT_RECORDERS` is keyed by, so an exemption names
 * one receiver in one file rather than a file, which is the cost `PENDING`'s
 * docblock records above.
 */
const receiverAt = (src, at) => {
  const before = src.slice(Math.max(0, at - 120), at)
  const m = /([A-Za-z_$#][\w$#]*(?:\s*\??\.\s*[A-Za-z_$#][\w$#]*)*\s*\??)$/.exec(before)
  return m ? m[1].replace(/\s+/g, '') : '(inconnu)'
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
const seenNotRecorder = new Set()
let declared = 0
let literal = 0
/** Set aside by `tsc`'s argument, not by this check's judgement. See `NOT_RECORDERS`. */
let typeRefused = 0
/** Set aside by a declared `NOT_RECORDERS` entry. */
let exempted = 0

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const src = blankComments(readFileSync(file, 'utf8'))
  /*
   * `.record(` with any amount of whitespace before the brace. It was the literal
   * string `.record({`, which a formatter breaking a long call over two lines
   * would have walked straight past — the same silent skip, one character over.
   * A `.record(` whose argument is *not* an object literal stays unmatched, which
   * is `z.record(z.string(), …)` and is deliberate: a `DiagInput` built somewhere
   * else and passed in is a fan-in, and `tsc` is what holds those to a choice
   * (the four `#record` helpers in `app/session/` take `origin` as a required
   * parameter for exactly that reason).
   */
  const ANCHOR = /\.record\(\s*\{/g
  ANCHOR.lastIndex = 0
  for (;;) {
    const hit = ANCHOR.exec(src)
    if (hit === null) break
    const at = hit.index
    const open = at + hit[0].length - 1
    ANCHOR.lastIndex = open + 1
    const line = src.slice(0, at).split('\n').length
    const receiver = receiverAt(src, at)
    const key = `${rel}:${receiver}`
    const obj = objectAt(src, open)
    /*
     * An object literal whose braces do not balance — a `${'}'}` inside a
     * template, something this scanner has not met. It used to `continue`, which
     * is the same silent skip the finding is about, one level lower.
     */
    if (!obj) {
      violations.push({
        rel,
        line,
        receiver,
        unreadable: ['(littéral illisible — accolades non appariées)'],
      })
      continue
    }
    const { props, unreadable, overridden } = propertiesOf(obj)
    const message = props.get('message')
    const origin = props.get('origin')

    /*
     * A literal `message:` or a declared `origin:` settles the site whatever else
     * is in the object — unless something unreadable is written *after* it, in
     * which case the later entry is the one that wins and the check is reading a
     * value that never reaches the sink.
     */
    if (message !== undefined && LITERAL.test(message) && !overridden('message')) {
      literal++
      continue
    }
    if (
      origin !== undefined &&
      (origin === 'origin' || ORIGINS.has(origin)) &&
      !overridden('origin')
    ) {
      declared++
      continue
    }
    /*
     * Nothing is established. Either this is a diag record that failed to
     * declare, or it is not a diag record at all — and the *only* honest way to
     * say the second is that the object is readable right through and has no
     * `code`/`module`, which `DiagInput` requires. One unreadable entry and that
     * argument is gone: the keys may be in the spread.
     */
    if (unreadable.length === 0 && (!props.has('code') || !props.has('module'))) {
      typeRefused++
      continue
    }
    if (NOT_RECORDERS.has(key)) {
      seenNotRecorder.add(key)
      exempted++
      continue
    }
    if (PENDING.has(rel)) {
      seenPending.add(rel)
      continue
    }
    violations.push({
      rel,
      line,
      receiver,
      message: (message ?? '(passé par un paramètre)').replace(/\s+/g, ' ').slice(0, 88),
      origin,
      unreadable: unreadable.length > 0 ? unreadable.map((u) => u.text) : null,
    })
  }
}

const stale = [...PENDING.keys()].filter((rel) => !seenPending.has(rel))
const staleNotRecorder = [...NOT_RECORDERS.keys()].filter((key) => !seenNotRecorder.has(key))

if (violations.length === 0 && stale.length === 0 && staleNotRecorder.length === 0) {
  /*
   * **The skip count is on the green line, and a zero reads as a zero.**
   * `CLAUDE.md` records three checks that shipped measuring nothing while
   * reporting green — `--scrollers` over a landmark list *Historique* has none
   * of, `--contrast` reusing `drawn()`, the `aec3` test driving its own
   * pipeline. This was the fourth: the census stayed at 79 with an eightieth
   * site present, and the number that would have said so was never printed.
   */
  console.log(
    `diag ok — ${literal + declared} recorded messages: ${literal} string literals, ` +
      `${declared} declared origins, ${PENDING.size} files pending; ` +
      `${typeRefused} non-DiagRecorder set aside by \`tsc\` (no code/module, fully read), ` +
      `${exempted} by a declared NOT_RECORDERS entry (DEC-27)`,
  )
  process.exit(0)
}

for (const v of violations) {
  if (v.unreadable) {
    console.error(
      `\n✗ ${v.rel}:${v.line} — ${v.receiver}.record({…}) : ${v.unreadable.join(', ')}`,
    )
    console.error(
      '    this check cannot read the whole object, so it cannot see whether `code`/`module`\n' +
        '    arrive through it, nor whether `origin` does. Write `origin: \'authored\'` or\n' +
        "    `origin: 'foreign'` at the site — a declaration has to be greppable where the\n" +
        '    message is built — or, if this receiver is not a `DiagRecorder` at all, add\n' +
        `    \`${v.rel}:${v.receiver}\` to NOT_RECORDERS in scripts/check-diag.mjs with the reason.`,
    )
    continue
  }
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

for (const key of staleNotRecorder) {
  console.error(
    `\n✗ ${key} is listed in NOT_RECORDERS in scripts/check-diag.mjs and is not needed: ` +
      'nothing there\n    was suppressed by it. Either the receiver is now readable, or the site ' +
      'declares `origin`, or\n    it is gone — delete the entry, so the list cannot rot into a ' +
      'blanket exemption.',
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
