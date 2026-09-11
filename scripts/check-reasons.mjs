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
    const reason = /\breason:\s*([\s\S]*?)(?:,\s*\n|\n\s*\})/.exec(body)
    if (!reason) return
    literals += 1
    const expression = reason[1].replace(/\s+/g, ' ').trim()
    // A forwarded reason was written where it was decided; this measures
    // compositions, and a pass-through composes nothing.
    if (/^[\w.#$?![\]]*\breason\b[\w.#$?![\]]*$/.test(expression)) return
    // A named call composes its sentence where it is declared; only a caught
    // error reaching the field unmediated is what this measures.
    if (!/\b(error|err)\b/.test(expression)) return
    if (/['"`]/.test(expression)) return
    findings.push({ rel, line: index + 1, expression })
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
