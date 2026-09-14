/**
 * **Comments and string literals out, so a grep over this repo is not a grep over
 * prose — and a regex literal is neither.**
 *
 * `check-ports.mjs` asks « does anything call this port method », and it asks with a
 * regular expression. In a repo whose docblocks name every verb they reason about,
 * that question was answered by the prose twice: `CalendarPort.sync` passed for a
 * dozen rounds on the check's own docblock *about* `CalendarPort.sync`, and one
 * sentence in `Outbox.ts` reading « Nothing here calls crm.closeSession » was enough
 * to wire a verb nothing called. So comments and strings are dropped before anything
 * is matched.
 *
 * ## Round 31: it mis-parsed regex literals, and one realistic line turned the check
 * red on live code
 *
 * `electron/core/domain/historySearch.ts:84` writes
 *
 *     .replace(/[‘’ʼ´`]/g, "'")
 *
 * — a **backtick inside a character class**, which is the ordinary way to fold every
 * apostrophe a French transcript can carry. The scanner had no notion of a regex, so
 * that backtick opened a « template literal » that ran for **eight lines**, ate three
 * real `.replace` calls and an `interface`, and left the scanner desynced for thirty
 * lines after it. Ten files in the tree carried residue of the same kind.
 *
 * Today's tree survived it by luck: the swallowed lines happened to hold no port
 * call. Injecting the same shape into `electron/app/session/Agenda.ts` — where
 * `CalendarPort` is held — took `check:ports` to **exit 1**, reporting
 * `CalendarPort.sync` and `CalendarPort.window` as called nowhere while `tsc` was
 * clean and both were wired. That is the **false-positive** direction, and it is the
 * worse one: the only remedy the failure names is an `UNWIRED` entry, which is
 * standing permission on live code and exactly the rot that list exists to prevent.
 *
 * ## Three things about *how* this is written, each measured
 *
 * **One forward pass, never a regex.** An alternation carrying `[\s\S]*?` took the
 * check from 1.5 s to 16.5 s on the same tree.
 *
 * **The stripped characters are dropped, not spaced over.** Blanking them to spaces
 * left thousand-character runs of whitespace inside the docblocks this repo is made
 * of, and the caller pattern is `receiver \s* !? \s* \?? . \s* method`, so every
 * failed match backtracked across the whole run. Same 16 s, for the opposite reason.
 * Newlines survive so a line count still means something; columns were never
 * reported.
 *
 * **Every ambiguity fails towards leaving code alone.** Deleting too little costs a
 * false green, which the *next* tightening finds; deleting too much costs a false red
 * on working code, which gets the code deleted or excused. So an unterminated regex
 * scan — no closing `/` before the end of the line — is re-read as division and
 * nothing is dropped, and `/` is only read as a regex where an expression cannot
 * already have ended. See `regexAllowed`.
 */

/**
 * Whether a `/` at this point opens a regex literal rather than dividing.
 *
 * `prev` is the last significant character the scan passed — whitespace skipped,
 * comments skipped (a comment is not a token), and a closed string or template
 * reported as its own quote, because a string is a value and a `/` after one divides.
 *
 * The rule is « could an expression have ended here ». If yes, `/` is division; if
 * no, it opens a regex. What makes this repo-specific rather than textbook is
 * **JSX**, and it bites in the direction that matters:
 *
 *   · `<` never precedes a regex. `a < /re/.test(b)` is not a thing anybody writes,
 *     and `</div></section>` on one line offers two slashes — read as a regex, the
 *     first would blank everything between them, which on
 *     `<p>{a.b()}</p><q>{c.d()}</q>` eats a real call.
 *   · `>` precedes one only as the tail of `=>`. An arrow followed by a regex is
 *     ordinary (`(s) => /x/.test(s)`); `useState<string>(…)` and `a >> b` are not.
 *   · `}` does not. A block end followed by a regex is legal and nobody writes it,
 *     while `<Foo a={x} /><Bar b={y} />` is written constantly and has the same
 *     two-slash shape as the closing-tag case.
 *
 * `)` and `]` close an expression, so they divide — which costs the rare
 * `if (x) /re/.test(y)`, a hole and not a wrong deletion.
 */
const AFTER_A_VALUE = new Set([')', ']', '}', '<', "'", '"', '`'])
const IDENTIFIER = /[\w$]/
/** Words after which a `/` opens a regex, because none of them ends an expression. */
const KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'throw',
])

const regexAllowed = (source, at, prev, prevAt) => {
  if (prev === undefined) return true
  if (prev === '>') return source[prevAt - 1] === '='
  if (AFTER_A_VALUE.has(prev)) return false
  if (!IDENTIFIER.test(prev)) return true
  let start = prevAt
  while (start > 0 && IDENTIFIER.test(source[start - 1])) start -= 1
  return KEYWORDS.has(source.slice(start, prevAt + 1))
}

/**
 * The end of a regex literal that starts at `at`, flags included — or `-1` when what
 * starts there is not a regex after all.
 *
 * A character class swallows `/`, a backslash swallows the next character, and a
 * regex may not contain a newline. Reaching one means this was division and the
 * caller leaves every character where it is.
 */
const regexEnd = (source, at) => {
  let cursor = at + 1
  let inClass = false
  while (cursor < source.length) {
    const ch = source[cursor]
    if (ch === '\\') {
      cursor += 2
      continue
    }
    if (ch === '\n') return -1
    if (inClass) {
      if (ch === ']') inClass = false
      cursor += 1
      continue
    }
    if (ch === '[') {
      inClass = true
      cursor += 1
      continue
    }
    if (ch === '/') {
      cursor += 1
      while (cursor < source.length && /[a-z]/.test(source[cursor])) cursor += 1
      return cursor
    }
    cursor += 1
  }
  return -1
}

/**
 * The end of the quoted run that starts at `at`, the closing quote included.
 *
 * A template literal's `${ … }` is code and may hold anything a file can hold —
 * another template, a quote, a regex — so the nesting is tracked rather than scanned
 * over. It was not, and `` `${"`"}` `` therefore ended the literal on the backtick
 * inside a string inside the expression: the same desync one level in.
 *
 * The whole literal is dropped, expressions included. That is the behaviour this
 * function has always had, and it is a **hole, not a rule**: a port reached only from
 * inside a `${ … }` would read as unreached. There is no such call in the tree (the
 * dump is byte-identical with expressions kept), and the remedy when one appears is
 * to keep the expression, not to loosen the scan.
 */
const quotedEnd = (source, at) => {
  const quote = source[at]
  let cursor = at + 1
  while (cursor < source.length) {
    const ch = source[cursor]
    if (ch === '\\') {
      cursor += 2
      continue
    }
    if (ch === quote) return cursor + 1
    // An unterminated single- or double-quoted string cannot cross a line.
    if (quote !== '`' && ch === '\n') return cursor
    if (quote === '`' && ch === '$' && source[cursor + 1] === '{') {
      let depth = 1
      cursor += 2
      while (cursor < source.length && depth > 0) {
        const inner = source[cursor]
        if (inner === '{') depth += 1
        else if (inner === '}') depth -= 1
        else if (inner === "'" || inner === '"' || inner === '`') {
          cursor = quotedEnd(source, cursor)
          continue
        }
        cursor += 1
      }
      continue
    }
    cursor += 1
  }
  return cursor
}

/** Comments, string and template literals and regex literals, dropped in one pass. */
export const withoutProse = (source) => {
  const out = Array.from(source)
  const drop = (from, to) => {
    for (let at = from; at < to; at += 1) if (out[at] !== '\n') out[at] = ''
  }
  let at = 0
  let prev
  let prevAt = -1
  const passed = (index) => {
    prev = source[index]
    prevAt = index
  }
  while (at < source.length) {
    const two = source.slice(at, at + 2)
    if (two === '//') {
      const end = source.indexOf('\n', at)
      const stop = end === -1 ? source.length : end
      drop(at, stop)
      at = stop
      continue
    }
    if (two === '/*') {
      const end = source.indexOf('*/', at + 2)
      const stop = end === -1 ? source.length : end + 2
      drop(at, stop)
      at = stop
      continue
    }
    const ch = source[at]
    if (ch === "'" || ch === '"' || ch === '`') {
      const stop = Math.min(quotedEnd(source, at), source.length)
      drop(at, stop)
      passed(at)
      at = stop
      continue
    }
    if (ch === '/' && regexAllowed(source, at, prev, prevAt)) {
      const stop = regexEnd(source, at)
      if (stop !== -1) {
        drop(at, stop)
        // A regex literal is a value: the `/` in `/a/ / 2` divides.
        passed(at)
        at = stop
        continue
      }
    }
    if (!/\s/.test(ch)) passed(at)
    at += 1
  }
  return out.join('')
}

/**
 * **The self-test, and it is asserted probe by probe.**
 *
 * `SILLAGE_PROSE_ATTACK=1 node scripts/check-ports.mjs` runs it, and
 * `scripts/__tests__/withoutProse.test.mjs` runs the same table under `npm test` —
 * one table, because a second list is a second thing to keep true.
 *
 * Every probe is named and asserted **by name**, never by a count. `--motion`'s
 * self-test counted, and one of its five probes went silent while another
 * over-reported, holding the threshold: a count cannot say *which* token class
 * stopped being understood.
 *
 * Each probe states, of one token class TypeScript has that looks like both a comment
 * and a quote, what must survive the strip and what must not. `survives` is code the
 * check has to be able to see; `dropped` is prose or data it must not.
 */
export const PROSE_PROBES = [
  {
    name: 'classe-de-caractères-avec-accent-grave',
    why:
      'historySearch.ts:84 — un accent grave dans une classe de caractères. C’est ' +
      'le défaut que ce round répare : il ouvrait un « littéral de gabarit » de huit ' +
      'lignes et mangeait trois appels réels.',
    source: [
      "  const fold = (s) => s.replace(/[\\u2019`]/g, \"'\")",
      '  const next = () => crm.resolveAccount(code)',
      '  const after = () => llm.structured(payload)',
    ].join('\n'),
    survives: ['crm.resolveAccount(', 'llm.structured('],
    dropped: ['\\u2019'],
  },
  {
    name: 'classe-de-caractères-avec-guillemet-et-barre-oblique',
    why:
      'Une classe de caractères qui contient un guillemet, un accent grave et une ' +
      'barre oblique : les trois délimiteurs à la fois, dont celui qui termine le ' +
      'littéral lui-même.',
    source: ['  const strip = (s) => s.replace(/[`\'"/]/g, \'\'); updates.state()'].join('\n'),
    survives: ['updates.state()'],
    dropped: ['[`'],
  },
  {
    name: 'division-qui-n’est-pas-une-expression-régulière',
    why:
      'Deux divisions sur une ligne. Lues comme une expression régulière, tout ce ' +
      'qui est entre les deux disparaît — et c’est du code.',
    source: ['  const rate = chars / minutes / 60', '  const n = (a + b) / 2', '  kv.get(key)'].join(
      '\n',
    ),
    survives: ['chars / minutes / 60', '(a + b) / 2', 'kv.get('],
    dropped: [],
  },
  {
    name: 'gabarit-avec-expression-contenant-un-guillemet',
    why:
      'Un `${ … }` qui contient une chaîne, laquelle contient un accent grave : le ' +
      'littéral se terminait là, un caractère avant sa vraie fin.',
    source: ['  const label = `a ${wrap("`")} b`; vault.get(name)'].join('\n'),
    survives: ['vault.get('],
    dropped: ['a ${wrap'],
  },
  {
    name: 'expression-régulière-contenant-un-début-de-commentaire',
    why:
      'Une expression régulière qui contient `//` — la forme même que le premier ' +
      'test de ce scanner cherche.',
    source: ['  const url = /https:\\/\\/[^ ]+/.exec(line)', '  diagnostics.record(event)'].join(
      '\n',
    ),
    survives: ['diagnostics.record('],
    dropped: ['https'],
  },
  {
    name: 'balise-jsx-fermante-suivie-d’une-autre',
    why:
      'Deux balises fermantes sur une ligne offrent deux barres obliques. Lue comme ' +
      'une expression régulière, la première efface l’appel qui se trouve entre.',
    source: ['      <p>{a.b()}</p><q>{crm.listSiblings(x)}</q>'].join('\n'),
    survives: ['a.b()', 'crm.listSiblings('],
    dropped: [],
  },
  {
    name: 'attribut-jsx-auto-fermant-suivi-d’un-autre',
    why:
      'Même forme un cran plus tôt : `<Foo a={x} /><Bar b={y} />`, où le `/` suit ' +
      'une accolade fermante.',
    source: ['      <Foo a={f()} /><Bar b={g.h()} />'].join('\n'),
    survives: ['f()', 'g.h()'],
    dropped: [],
  },
  {
    name: 'expression-régulière-après-un-mot-clé',
    why:
      '`return /x/.test(s)` : le `/` suit un identifiant, et il ouvre pourtant une ' +
      'expression régulière, parce que ce mot-là ne termine pas une expression.',
    source: ['  const t = (s) => { return /a`b/.test(s) }', '  identity.token()'].join('\n'),
    survives: ['identity.token()'],
    dropped: ['a`b'],
  },
  {
    name: 'barre-oblique-non-terminée-relue-comme-une-division',
    why:
      'Une balise fermante seule sur sa ligne, et la barre oblique suivante trois ' +
      'lignes plus bas. Deux garde-fous répondent, et il en faut un seul : `<` ' +
      'n’ouvre pas d’expression régulière, et une expression régulière ne franchit ' +
      'pas une fin de ligne. Sans l’un ou l’autre, l’appel du milieu disparaît — ' +
      'supprimer trop coûte un faux rouge sur du code qui marche, ce qui est le pire ' +
      'des deux sens.',
    source: [
      '      </section>',
      '      {crm.pushCompteRendu(doc)}',
      '      <Footer note={n / 2} />',
    ].join('\n'),
    survives: ['crm.pushCompteRendu(', 'n / 2'],
    dropped: [],
  },
  {
    name: 'prose-nommant-une-méthode',
    why:
      'Le contrôle de départ : une phrase dans un commentaire qui nomme un verbe de ' +
      'port ne câble rien. C’est la sonde de référence — si celle-là tombe, tout le ' +
      'reste de ce fichier est inutile.',
    source: [
      '  // Nothing here calls crm.closeSession(), and this sentence is the only place.',
      "  /* Ni celle-ci : crm.closeSession(). */ const s = 'crm.closeSession()'",
      '  crm.pushCompteRendu(doc)',
    ].join('\n'),
    survives: ['crm.pushCompteRendu('],
    dropped: ['closeSession'],
  },
]

/** Runs `PROSE_PROBES` against the shipped stripper. Returns one row per probe. */
export const runProseProbes = () =>
  PROSE_PROBES.map((probe) => {
    const stripped = withoutProse(probe.source)
    const missing = probe.survives.filter((needle) => !stripped.includes(needle))
    const leaked = probe.dropped.filter((needle) => stripped.includes(needle))
    return { ...probe, stripped, missing, leaked, ok: missing.length === 0 && leaked.length === 0 }
  })
