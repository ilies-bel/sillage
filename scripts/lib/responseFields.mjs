/**
 * **What an invoke channel's response actually ships, read where it is written.**
 *
 * `check-surfaces.mjs`'s fourth rule asks whether a top-level field on an invoke
 * channel's response has a reader under `src/`. For as long as it existed it asked
 * that of a *name*: `RESPONSE_SCHEMA` was `/response:\s*([A-Za-z0-9_]+)/` and
 * `schemaBody` resolved only `export const <name> = z.object({`. So the identifier
 * captured from `response: z.object({ … })` was **`z`**, `schemaBody('z')` found
 * nothing, and the channel was skipped **in silence** — the same for a
 * `z.discriminatedUnion`, a `z.array`, a `z.record` and a schema built with
 * `.extend`.
 *
 * Measured on the shipped check, at the commit this file was added:
 *
 *     canaux invoke portant une réponse          : 42   (of 52 — see below)
 *     canaux dont le schéma est résolu (mesuré)  : 20
 *     champs comptés (le « 132 » de la ligne ok) : 132
 *
 * `review:confirm` — the only thing in this product that writes into a client's
 * CRM — `widget:state`, `health:snapshot`, `session:command`, `meeting:get` and
 * seventeen others were outside the only rule in the repo that asks whether a
 * shipped field has a reader, and the pass line reported the 132 as if it were
 * coverage.
 *
 * **And ten channels were not even blocks.** `channelBlocks` was
 * `/^ {2}'([^']+)':\s*\{([\s\S]*?)^ {2}\},/gm`, and a channel written on one line —
 * `'auth:state': { request: z.object({}), response: AuthStateSchema },` — has no
 * `}` in the first two columns to stop at, so the lazy run swallowed everything up
 * to the next multi-line channel's close: `auth:state`'s « block » ran through
 * `auth:signIn`, `auth:signOut`, `agenda:snapshot` and `agenda:refresh`, and the
 * `response:` it read was the first one in that span. 42 blocks for 52 channels,
 * and the fields of four of them attributed to a neighbour.
 *
 * So nothing here follows a name. Brackets are matched, the response expression is
 * read where it stands, and the small vocabulary of Zod combinators the contract
 * uses is resolved to a set of top-level field names. **The list is closed on
 * purpose**: an expression this file does not understand answers `null`, and
 * `check-surfaces.mjs` turns that into a red check rather than a skip. That is the
 * whole finding — the silence, not the narrowness.
 *
 * Cost: none that five runs can see — 0.27 s before, 0.27 s after, on the same
 * machine, for two and a half times the channels. `check:ports`' lesson is the
 * reason: it went from 1.5 s to 16.5 s on a pattern carrying `[\s\S]*?` across a
 * file and came back to 0.55 s by dropping the stripped characters rather than
 * spacing them. Nothing here scans a file for a response; the scanners below run
 * one pass over an expression a few hundred characters long, and the only thing
 * that touches every file is the read join, which was already there.
 */

const CLOSE = { '{': '}', '(': ')', '[': ']' }
const OPEN = { '}': '{', ')': '(', ']': '[' }

/**
 * Line and block comments out, crudely and deliberately — the same function
 * `check-surfaces.mjs` applies to every other rule, for the same reason: a
 * contract whose docblocks quote field names and channel names would otherwise
 * answer every question with a comment.
 */
export const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')

/** Index of the bracket matching the one at `open`, or -1. String-aware. */
export const closerOf = (source, open) => {
  const stack = [source[open]]
  let at = open + 1
  while (at < source.length && stack.length > 0) {
    const ch = source[at]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      at += 1
      while (at < source.length && source[at] !== quote) at += source[at] === '\\' ? 2 : 1
    } else if (ch === '{' || ch === '(' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (CLOSE[stack[stack.length - 1]] !== ch) return -1
      stack.pop()
    }
    at += 1
  }
  return stack.length === 0 ? at - 1 : -1
}

/** Index of the bracket matching the last character of `expr`, or -1. */
const openerOf = (expr) => {
  let at = expr.length - 1
  const stack = [expr[at]]
  at -= 1
  while (at >= 0 && stack.length > 0) {
    const ch = expr[at]
    if (ch === '"' || ch === "'" || ch === '`') {
      at -= 1
      while (at >= 0 && expr[at] !== ch) at -= 1
    } else if (ch === '}' || ch === ')' || ch === ']') stack.push(ch)
    else if (ch === '{' || ch === '(' || ch === '[') {
      if (OPEN[stack[stack.length - 1]] !== ch) return -1
      stack.pop()
    }
    at -= 1
  }
  return stack.length === 0 ? at + 1 : -1
}

/**
 * The comma-separated runs of a body, at depth zero. `null` when the brackets do
 * not balance, which is a finding and never a shrug.
 */
export const runsOf = (body) => {
  const out = []
  let at = 0
  let start = 0
  while (at < body.length) {
    const ch = body[at]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      at += 1
      while (at < body.length && body[at] !== quote) at += body[at] === '\\' ? 2 : 1
    } else if (ch === '{' || ch === '(' || ch === '[') {
      const end = closerOf(body, at)
      if (end < 0) return null
      at = end
    } else if (ch === ',') {
      out.push(body.slice(start, at))
      start = at + 1
    }
    at += 1
  }
  out.push(body.slice(start))
  return out.filter((run) => run.trim().length > 0)
}

/**
 * The top-level keys of an object-literal body.
 *
 * Every run must *be* a key, so a spread (`...Other.shape`) or anything else this
 * does not read answers `null` and the channel goes red. Indentation is not
 * consulted: the old `^ {2}([a-zA-Z]…):` could only ever see a schema declared at
 * the top level of a contract file, which is precisely why an inline one was
 * invisible.
 */
export const keysOf = (body) => {
  const runs = runsOf(body)
  if (runs === null) return null
  const keys = []
  for (const run of runs) {
    const named = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(run)
    if (!named) return null
    keys.push(named[1] ?? named[2] ?? named[3])
  }
  return keys
}

/**
 * Methods that leave the set of top-level fields exactly as it was, so they are
 * peeled off and the receiver is resolved instead.
 *
 * `.omit`, `.pick`, `.partial` and `.merge` are deliberately absent: each of them
 * *changes* the field set, and a resolver that guessed would report fields the
 * channel does not ship or miss ones it does. None of them appears in the contract
 * today; the day one does, the channel goes red with its expression printed, which
 * is the correct thing for a rule whose whole finding was a silent skip.
 */
const WRAPPERS = new Set([
  'nullable',
  'optional',
  'nullish',
  'default',
  'describe',
  'readonly',
  'strict',
  'strip',
  'passthrough',
  'catch',
  'brand',
  'refine',
  'superRefine',
  'array',
])

/** `z.<head>(…)` forms with no top-level fields of their own. Resolved, not skipped. */
const SCALARS = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'literal',
  'enum',
  'nativeEnum',
  'unknown',
  'any',
  'null',
  'undefined',
  'void',
  'never',
  'symbol',
  'instanceof',
  'tuple',
])

/**
 * `export const <Name> = <expression>` across the contract sources, by name.
 *
 * The expression ends at the first newline at depth zero that the next line does
 * not continue with a `.` — every schema in `core/contracts/` is declared at column
 * zero and every continuation is indented or chained, so this reads the expression
 * and never the declaration after it.
 */
export const declarationsIn = (sources) => {
  const declarations = new Map()
  for (const source of sources) {
    for (const hit of source.matchAll(/^export const ([A-Za-z_$][\w$]*)(?:\s*:[^=\n]*)?\s*=\s*/gm)) {
      const from = hit.index + hit[0].length
      let at = from
      let depth = 0
      let end = source.length
      while (at < source.length) {
        const ch = source[at]
        if (ch === '"' || ch === "'" || ch === '`') {
          const quote = ch
          at += 1
          while (at < source.length && source[at] !== quote) at += source[at] === '\\' ? 2 : 1
        } else if (ch === '{' || ch === '(' || ch === '[') depth += 1
        else if (ch === '}' || ch === ')' || ch === ']') depth -= 1
        else if (depth === 0 && (ch === ';' || ch === '\n')) {
          if (ch === ';' || !/^[ \t]*\./.test(source.slice(at + 1))) {
            end = at
            break
          }
        }
        at += 1
      }
      if (!declarations.has(hit[1])) declarations.set(hit[1], source.slice(from, end))
    }
  }
  return declarations
}

const trim = (expr) => expr.trim().replace(/[,;]+$/, '').trim()

/**
 * The top-level field names an expression ships, or `null` when this file cannot
 * say — which is a finding, not a skip.
 *
 * `trace` collects the schema identifiers the resolution walked through, outermost
 * first, so a caller can name the subject after the schema (`MeetingSchema.updatedAt`,
 * which is what the three standing `UNREAD` entries are keyed on) and fall back to
 * the channel for a response declared inline (`meeting:get.outbox`).
 */
export const resolveFields = (expr, declarations, trace = [], seen = new Set(), depth = 0) => {
  if (depth > 16) return null
  let e = trim(expr)

  // Peel the wrappers that do not change the field set, one at a time.
  for (;;) {
    if (!e.endsWith(')')) break
    const open = openerOf(e)
    if (open <= 0) break
    const method = /\.\s*([A-Za-z_$][\w$]*)\s*$/.exec(e.slice(0, open))
    if (!method) break
    const base = e.slice(0, open - method[0].length).trim()
    if (base === 'z' || base === '') break
    if (method[1] === 'extend') {
      const args = e.slice(open + 1, e.length - 1)
      const brace = args.indexOf('{')
      if (brace < 0) return null
      const closes = closerOf(args, brace)
      const added = closes < 0 ? null : keysOf(args.slice(brace + 1, closes))
      const inherited = resolveFields(base, declarations, trace, seen, depth + 1)
      if (added === null || inherited === null) return null
      return [...new Set([...inherited, ...added])]
    }
    if (!WRAPPERS.has(method[1])) return null
    e = base
  }

  const call = /^z\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(e)
  if (call) {
    const open = e.indexOf('(', call[0].length - 1)
    const close = closerOf(e, open)
    if (close < 0 || close !== e.length - 1) return null
    const args = e.slice(open + 1, close)
    const head = call[1]
    if (head === 'object') {
      const brace = args.indexOf('{')
      if (brace < 0) return null
      const end = closerOf(args, brace)
      return end < 0 ? null : keysOf(args.slice(brace + 1, end))
    }
    // A list, a promise or a lazy thunk ships its element's fields.
    if (head === 'array' || head === 'promise' || head === 'set' || head === 'lazy') {
      return resolveFields(
        args.replace(/^\s*\(\s*\)\s*=>/, ''),
        declarations,
        trace,
        seen,
        depth + 1,
      )
    }
    // A record ships its *value's* fields; the keys are not fields.
    if (head === 'record' || head === 'map') {
      const list = runsOf(args)
      return list === null
        ? null
        : resolveFields(list[list.length - 1], declarations, trace, seen, depth + 1)
    }
    /*
     * Every variant of a union ships, so every variant's fields must be read —
     * `session:command`'s refusal carries `reason` and its success does not, and a
     * `reason` nobody reads is exactly the finding this rule exists for.
     */
    if (head === 'discriminatedUnion' || head === 'union' || head === 'intersection') {
      const list = runsOf(args)
      if (list === null) return null
      let members = list
      if (head !== 'intersection') {
        const tail = list[list.length - 1].trim()
        if (!tail.startsWith('[')) return null
        const inner = runsOf(tail.slice(1, closerOf(tail, 0)))
        if (inner === null) return null
        members = inner
      }
      const out = new Set()
      for (const member of members) {
        const got = resolveFields(member, declarations, trace, seen, depth + 1)
        if (got === null) return null
        for (const key of got) out.add(key)
      }
      return [...out]
    }
    if (SCALARS.has(head)) return []
    return null
  }

  const ident = /^([A-Za-z_$][\w$]*)$/.exec(e)
  if (ident) {
    trace.push(ident[1])
    // A schema that refers to itself (a recursive document node) adds no field.
    if (seen.has(ident[1])) return []
    const declared = declarations.get(ident[1])
    if (declared === undefined) return null
    return resolveFields(declared, declarations, trace, new Set([...seen, ident[1]]), depth + 1)
  }
  return null
}

/**
 * The channel entries of one of the contract's two object literals, brace-matched.
 *
 * `block` is `null` when the braces do not balance — which the caller turns into a
 * finding, because a channel whose declaration cannot be read is the case the old
 * lazy pattern answered by quietly attributing it to its neighbour.
 */
export const channelEntries = (source) => {
  const entries = []
  for (const hit of source.matchAll(/^ {2}'([^']+)':\s*\{/gm)) {
    const open = source.indexOf('{', hit.index + hit[0].length - 1)
    const close = closerOf(source, open)
    entries.push({ channel: hit[1], block: close < 0 ? null : source.slice(open + 1, close) })
  }
  return entries
}

/** The `response:` expression of a channel block, or `null` if it declares none. */
export const responseIn = (block) => {
  const runs = runsOf(block)
  if (runs === null) return null
  const run = runs.find((candidate) => /^\s*response\s*:/.test(candidate))
  return run === undefined ? null : run.replace(/^\s*response\s*:/, '')
}
