#!/usr/bin/env node
/**
 * **A rep reads `ConnectorHealth.reason` verbatim, so a remote's words may follow
 * ours and never replace them.**
 *
 * That string is rendered unchanged on four surfaces — the onboarding's health
 * rows, Réglages' *Requis* / *Optionnel* cards, the review gate's « … — sera
 * envoyé dès le rétablissement », and `EnhancementNotice`'s « Le compte-rendu
 * n'a pas pu être rédigé : … ». Three of them weld it into a French sentence.
 *
 * Seven mappers ended in `reason: error.message`, and for the Graph, VSA and LLM
 * adapters that string is composed by the *remote*: `messageOf` reads Microsoft's
 * own `error.message`. So a revoked token put « Access token has expired or is
 * not yet valid. » on a French card, and a model name that does not exist
 * finished « Le compte-rendu n'a pas pu être rédigé : » in English. Every one of
 * those adapters is otherwise scrupulously French — the leak was one expression
 * per file, on the branch that needs a real tenant to refuse you, and three unit
 * tests asserted the property with a *French* fixture over a path that only ever
 * carries English.
 *
 * The rule is not « no English ». « Incorrect API key provided » is precisely
 * what tells a rep which key they pasted, and it is kept. The rule is that the
 * sentence *opens* with something we wrote — so a `down` or `degraded` health
 * literal must carry a quoted string in its `reason`.
 *
 * Scope is the literal, not the file: a projection that forwards a reason
 * decided elsewhere (`{ ...health }`, `outcome.reason`) is not a composition and
 * is not what this measures.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

const walk = (dir) => {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Strips comments so prose about a reason is never a finding. */
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')

/**
 * A bare `reason` resolved back to the `const` that set it, within the lines
 * above it. Without this the shorthand branch reads the identifier and calls
 * every local decision a forward.
 */
const resolve = (expression, lines, at) => {
  if (!/^[A-Za-z_$][\w$]*$/.test(expression)) return expression
  for (let i = at; i >= 0 && i > at - 40; i -= 1) {
    const set = new RegExp(`\\b(?:const|let|var)\\s+${expression}\\s*=\\s*(.+?)\\s*$`).exec(lines[i])
    if (set) return set[1].replace(/[;,]$/, '').replace(/\s+/g, ' ').trim()
  }
  return expression
}

/** `composeSentence(err)` states its French where it is declared, not here. */
const NAMED_CALL = /^(?!String\b|Number\b)[A-Za-z_$][\w$]*\s*\([\s\S]*\)$/

/**
 * Whether the error's own words can reach the field with none of ours attached.
 *
 * The old test was `if (/['"`]/.test(expression)) return` — a quote *anywhere*
 * waved the whole expression through, and `err instanceof Error ? err.message :
 * 'indisponible'` always has one. So the branch that carries English was
 * excused by the branch that does not. This reads the branches instead: a
 * template literal with prose of ours in it is a frame and is spent, a string
 * literal is ours, an `instanceof` is a guard and not a read — and whatever
 * still names the error after all three are gone is unmediated.
 */
const leaks = (expression) => {
  const spent = expression
    .replace(/\b(err|error)\b\s+instanceof\s+[\w.$]+/g, 'GUARD')
    .replace(/`(?:[^`\\]|\\.)*`/g, (lit) =>
      /\S/.test(lit.slice(1, -1).replace(/\$\{[^}]*\}/g, '')) ? "''" : lit,
    )
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
  return /\b(err|error)\b/.test(spent)
}

const findings = []
let scanned = 0
let literals = 0

for (const file of walk(join(ROOT, 'electron'))) {
  scanned += 1
  const rel = relative(ROOT, file)
  const lines = strip(readFileSync(file, 'utf8')).split('\n')

  lines.forEach((line, index) => {
    // The discriminant is what makes this a ConnectorHealth and not any object
    // with a `reason`. `state:` and `reason:` are within a few lines of each
    // other in every one of them, because the shape is four fields long.
    if (!/\bstate:\s*'(down|degraded)'/.test(line)) return
    const window = lines.slice(index, index + 7)
    const stop = window.findIndex((l, i) => i > 0 && /\bstate:\s*'/.test(l))
    const body = (stop === -1 ? window : window.slice(0, stop)).join('\n')
    // `reason:` and the ES6 shorthand `reason,` are the same field. Only the
    // first was matched for as long as this check existed, and both shipped
    // leaks were written in the second — the colon the regex required is the
    // one character a hoist into a `const` removes.
    const written = /\breason:\s*([\s\S]*?)(?:,\s*\n|\n\s*\})/.exec(body)
    const shorthand = /^\s*reason\s*,\s*$/m.test(body)
    if (!written && !shorthand) return
    literals += 1
    const expression = written ? written[1].replace(/\s+/g, ' ').trim() : 'reason'
    // A forwarded reason was decided elsewhere and is not a composition — but
    // only when it really was elsewhere. A bare identifier is resolved back to
    // the `const` that set it in this same function first, because
    // `const reason = err.message` two lines above is a decision taken *here*.
    const composed = resolve(expression, lines, index)
    if (/^[\w.#$?![\]]*\breason\b[\w.#$?![\]]*$/.test(composed)) return
    // A named call composes its sentence where it is declared; only a caught
    // error reaching the field unmediated is what this measures.
    if (NAMED_CALL.test(composed)) return
    if (!/\b(error|err)\b/.test(composed)) return
    if (!leaks(composed)) return
    findings.push({ rel, line: index + 1, expression: composed })
  })
}

if (findings.length > 0) {
  console.error(
    `reason(s) a rep reads verbatim with no sentence of ours (${findings.length}):`,
  )
  for (const f of findings) console.error(`  ${f.rel}:${f.line}: reason: ${f.expression}`)
  console.error("Prefix it — `notre phrase — ${error.message}`. See CLAUDE.md.")
  process.exit(1)
}

console.log(`reasons ok — ${scanned} fichier(s) scannés, ${literals} état(s) de santé composé(s)`)
