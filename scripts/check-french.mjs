#!/usr/bin/env node
/**
 * **One apostrophe, and it is the typographic one.**
 *
 * Every user-facing string in this product is French (HR-6, DEC-22), and every
 * one of them writes `l’appel`, `n’a pas`, `qu’il` — the typographic apostrophe,
 * `’`, U+2019. Two hundred of them do. One did not: « à l'instant », on the
 * calendar's sync line, which a rep reads every day. A straight quote among
 * curly ones is the kind of thing nobody reports and everybody sees, and it is
 * the exact class of defect a screenshot review slides past because the glyph is
 * four pixels wide.
 *
 * ## What this deliberately does not check
 *
 * French typography also wants a narrow no-break space before `:` `;` `!` `?`
 * and inside `« … »`. The product uses an ordinary space in a hundred and
 * forty-three places and a no-break space in none, which is a *consistent*
 * choice rather than a slip — and several of those strings are not layout at
 * all: they are composed into the VerySwing task body and the Outlook draft,
 * where an invisible U+202F is a character a client's CRM receives. Changing
 * that is a decision with a blast radius, not a lint rule, and it is not made
 * here by a script.
 *
 * So the rule is narrow on purpose: enforce the convention the product already
 * has, and do not invent one.
 *
 * ## What is not a user-facing string
 *
 * Three kinds of French text in this repo are never read by a rep, and holding
 * them to a typographic convention would be a check enforcing style on data:
 *
 *  · **the prompts** (each module's `prompt.ts`) are input to a model, not output to
 *    a person — and a model tokenises the two apostrophes differently, so
 *    rewriting them
 *    is a change to the extraction with no way to tell whether it helped;
 *  · **`hallucinations.ts`** is a list of the phrases Whisper actually emits,
 *    matched against its output. The apostrophe there is the engine's, and
 *    "correcting" it would silently stop the filter matching;
 *  · **fixtures** are sample calendar data — a subject line is whatever the
 *    organiser typed, and the product must not assume they typed `’`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', 'electron', 'src'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
  // See « what is not a user-facing string », above.
  .filter((f) => !/\/prompt\.ts$|hallucinations\.ts$|contracts\/fixtures\.ts$/.test(f))
  .filter((f) => existsSync(join(ROOT, f)))

/** A quoted literal, on one line. Good enough: a French sentence is one line. */
const LITERAL = /'([^'\\\n]{4,})'|"([^"\\\n]{4,})"|`([^`\\\n]{4,})`/g

/**
 * Is this string French prose rather than a class name, an id or a path?
 *
 * An accent settles it outright. Failing that, a short list of words that are
 * French and are not also code — `class`, `type` and `for` would each match a
 * Tailwind string, and are not on it.
 */
const FRENCH =
  /[À-ÿ]|\b(aucun|aucune|réunion|appel|client|compte|rendu|vous|votre|dans|pour|avec|sans|est|sont|pas|une|des|les|cette|cet)\b/i

/** `l'appel`, `n'a`, `qu'il` — an elision, which is where the apostrophe lives. */
const STRAIGHT = /\b(l|d|n|j|s|c|t|m|qu|jusqu|lorsqu|puisqu|quelqu)'/i

const findings = []
for (const file of files) {
  const source = readFileSync(join(ROOT, file), 'utf8')
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    // Comments are English (`CLAUDE.md`: French for user-facing strings, English
    // for code and comments), and an English `don't` is not a defect.
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
    for (const match of line.matchAll(LITERAL)) {
      /*
       * `${…}` first. A template's own interpolation is code, and code contains
       * quoted fragments — `${n > 1 ? 's' : ''}` reads as an elision to any
       * regex and is a plural, which is how the first version of this check
       * reported two false positives in the renderer.
       */
      const text = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, '·')
      if (!FRENCH.test(text) || !STRAIGHT.test(text)) continue
      findings.push({ file, line: index + 1, text: text.slice(0, 70) })
    }
  })
}

if (findings.length > 0) {
  console.error(`\napostrophe droite dans ${findings.length} chaîne(s) française(s) :\n`)
  for (const { file, line, text } of findings) console.error(`  ${file}:${line}\n    ${text}\n`)
  console.error("Le produit écrit « l’appel », pas « l'appel ». U+2019, comme les deux cents autres.\n")
  process.exit(1)
}

console.log(`french ok — ${files.length} files scanned for a straight apostrophe in French prose`)
