#!/usr/bin/env node
/**
 * The palette containment check (VISION.md §6), and the opacity-modifier check
 * that belongs beside it.
 *
 * `src/design/tokens.css` opens by claiming every hex in the product lives in
 * it. That claim is worth something only if something enforces it — otherwise
 * the first `#e5e7eb` typed into a screen is a colour nobody can change later,
 * invisible to the drift check in `src/design/tokens.test.ts` because that test
 * only ever reads the token file and VISION.md.
 *
 * So: a grep. Every hex literal under `src/` is a violation, with two
 * exemptions that are named here rather than inferred, because a silently
 * growing exemption list is how a rule stops meaning anything:
 *
 *   · `src/design/tokens.css` — the one home. The whole point.
 *   · `src/font/`             — vendored font CSS. Upstream, not ours to edit.
 *
 * Cheap, mechanical, and it fails at the moment the leak is introduced rather
 * than the month someone tries to restyle the app.
 *
 * ## The second rule: no `/NN` on a token
 *
 * `tailwind.config.js` warns in its own header that Tailwind cannot recompute
 * alpha on a bare `var()`, so `bg-muted/30` compiles to **no rule at all**. A
 * warning in a comment is not a check, and two of them shipped:
 *
 *   · `LevelMeter` drew every below-floor bar transparent, so a microphone too
 *     quiet to transcribe — the one state that meter was built to show —
 *     rendered as an empty strip;
 *   · `SignalRail`'s « — » inherited `--text-body`, drawing every *empty* slot
 *     stronger than the values in the filled ones.
 *
 * Neither is visible in code review, neither fails a unit test, and neither
 * throws: the class name is spelled correctly and simply means nothing. The
 * token list comes from the config itself rather than a copy, so a token added
 * there is covered here on the same commit.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** `#abc`, `#abcd`, `#aabbcc`, `#aabbccdd` — and nothing that merely starts with them. */
const HEX = /#[0-9a-fA-F]{3,8}\b/g

const EXEMPT = [
  { prefix: 'src/design/tokens.css', why: 'the one home for every hex (VISION.md §6)' },
  { prefix: 'src/font/', why: 'vendored font CSS — upstream, never hand-edited' },
]

/** A `#abc` inside `url(#gradient)` is an id reference, not a colour. */
const isColour = (line, match) => !/url\([^)]*$/.test(line.slice(0, match.index))

/**
 * Comments are prose and prose is allowed to name a colour — this file, and
 * `src/design/index.css`, both explain *why* a token was retired by quoting the
 * hex it used to be. Blanked rather than deleted so line and column survive.
 *
 * A small scanner rather than a regex, because `"https://…"` is not a comment
 * and `/* …` inside a string is not one either. It only has to be right about
 * where comments are; being conservative costs a false positive, never a miss.
 */
const withoutComments = (source) => {
  const out = [...source]
  let mode = 'code' // code | line | block | "'" | '"' | '`'
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    const next = source[i + 1]
    if (mode === 'code') {
      if (c === '/' && next === '*') { mode = 'block'; out[i] = out[i + 1] = ' '; i++ }
      else if (c === '/' && next === '/') { mode = 'line'; out[i] = out[i + 1] = ' '; i++ }
      else if (c === "'" || c === '"' || c === '`') mode = c
    } else if (mode === 'line') {
      if (c === '\n') mode = 'code'
      else out[i] = ' '
    } else if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out[i] = out[i + 1] = ' '; i++ }
      else if (c !== '\n') out[i] = ' '
    } else if (c === '\\') i++
    else if (c === mode) mode = 'code'
  }
  return out.join('')
}

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', 'src'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx|css)$/.test(f))
  // `--cached` still lists a file deleted from the working tree but not yet
  // staged; reading it would throw ENOENT instead of reporting a result.
  .filter((f) => existsSync(join(ROOT, f)))

/**
 * Every colour name the config defines, read from the config — `colors` plus
 * `borderColor`, because `border-card/50` is the same dead class as
 * `bg-card/50`. Tailwind's own numeric palette is untouched by all this and is
 * not in this list: `bg-white/50` works, because white is a real value.
 */
const tokenNames = (() => {
  const config = createRequire(import.meta.url)(join(ROOT, 'tailwind.config.js'))
  const extend = config.theme?.extend ?? {}
  return new Set([...Object.keys(extend.colors ?? {}), ...Object.keys(extend.borderColor ?? {})])
})()

/** Every Tailwind utility prefix that takes a colour and accepts a `/NN`. */
const COLOUR_UTILITIES =
  'bg|text|border|divide|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|shadow|accent|caret|placeholder'
const ALPHA = new RegExp(`\\b(?:${COLOUR_UTILITIES})-([a-z0-9-]+)\\/\\d+`, 'g')

const violations = []
const deadAlpha = []
let checked = 0
let exempted = 0

for (const file of files) {
  if (EXEMPT.some((e) => file.startsWith(e.prefix))) {
    exempted++
    continue
  }
  checked++
  const lines = withoutComments(readFileSync(join(ROOT, file), 'utf8')).split('\n')
  lines.forEach((line, i) => {
    for (const match of line.matchAll(HEX)) {
      if (!isColour(line, match)) continue
      violations.push(`${file}:${i + 1}: ${match[0]}  ${line.trim()}`)
    }
    for (const match of line.matchAll(ALPHA)) {
      if (!tokenNames.has(match[1])) continue
      deadAlpha.push(`${file}:${i + 1}: ${match[0]}  ${line.trim()}`)
    }
  })
}

if (deadAlpha.length > 0) {
  console.error(`\nopacity modifiers on design tokens — these compile to nothing (${deadAlpha.length}):\n`)
  for (const v of deadAlpha) console.error(`  ${v}`)
  console.error('\nTailwind cannot recompute alpha on a bare var(). Add a named token to')
  console.error('src/design/tokens.css — a color-mix() derived from an existing one needs no')
  console.error('entry in VISION.md §6 — and map it in tailwind.config.js.\n')
  process.exit(1)
}

if (violations.length > 0) {
  console.error(`\nhex colours outside src/design/tokens.css (${violations.length}):\n`)
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    '\nadd a token to src/design/tokens.css and VISION.md §6, then use the Tailwind',
  )
  console.error('mapping in tailwind.config.js — see VISION.md §6, "Visual language"\n')
  process.exit(1)
}

// The exempted count is printed on purpose, the way check-boundaries.mjs prints
// its skipped count: an exemption you cannot see is an exemption that grows.
console.log(
  `tokens ok — ${checked} files scanned for hex literals and dead /NN modifiers ` +
    `on ${tokenNames.size} tokens, ${exempted} exempt (${EXEMPT.map((e) => e.prefix).join(', ')})`,
)
