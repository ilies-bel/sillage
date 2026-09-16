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

/**
 * **A utility that silently cancels another one on the same element.**
 *
 * Third instance of the family this file already guards. `bg-muted/30` compiled
 * to no rule; `ring-card` named a colour `ringColor` did not have; and
 * `line-clamp-2 block` resolved *both* — the clamp needs `display: -webkit-box`
 * and `block` overwrote it, so the element drew nine lines under a class that
 * says two. Every one of them reads correctly in the source and is invisible in
 * a screenshot, which is exactly the shape this check exists for.
 *
 * The pair is one-directional and ordering is irrelevant: Tailwind emits both
 * rules and the later *declaration* wins, not the later class name.
 */
const CANCELS = [
  {
    utility: /\bline-clamp-(?!none\b)[a-z0-9]+\b/,
    by: /\b(?:block|flex|grid|inline-block|inline-flex|inline-grid|table|contents)\b/,
    why: 'line-clamp needs `display: -webkit-box`; a display utility beside it wins',
  },
]

/**
 * **The fourth rule: a scale the design system does not have.**
 *
 * `tailwind.config.js` declares its scales under `theme.extend`, which *adds to*
 * Tailwind's defaults rather than replacing them. So the file that says the type
 * scale is `label / meta / ui / copy / display` also ships `text-xs` through
 * `text-9xl`, the file that says radius is `sm / DEFAULT / lg` (10 / 12 / 14px)
 * also ships `rounded-md` at 6px, and the file whose only shadow is `overlay`
 * also ships `shadow-sm`. None of that is a typo anybody can see: the class is
 * real, Tailwind emits it, and the element simply lands off the system.
 *
 * Measured when this rule was written: `rounded-md` ×7, `rounded-xl` ×1,
 * `shadow-sm` ×6, `text-sm` and `text-xs` in the editor's error boundary, and —
 * before the document ladder landed — twelve `text-[Npx]` arbitrary sizes over
 * five distinct values. The visible cost was the three first-run cards, drawn at
 * a 6px corner with Tailwind's drop shadow while every other card in the product
 * is 10–14px and flat, which is why they read as belonging to a different app.
 *
 * The allowed keys are read out of the config rather than copied, so a rung
 * added there is allowed here on the same commit — the `tokenNames` pattern
 * above. What is *not* read from the config is the small set of Tailwind
 * built-ins that are part of the system by intent rather than by declaration:
 * a circle is `rounded-full` and a square corner is `rounded-none`, and neither
 * is a size on a scale.
 */
const KEYWORD_OK = { borderRadius: new Set(['full', 'none']), boxShadow: new Set(['none']), fontSize: new Set([]) }
const OFF_SCALE = (() => {
  const config = createRequire(import.meta.url)(join(ROOT, 'tailwind.config.js'))
  const extend = config.theme?.extend ?? {}
  const scale = (group, prefix) => {
    const declared = new Set([...Object.keys(extend[group] ?? {}), ...KEYWORD_OK[group]])
    return {
      // `rounded-lg`, `rounded-[3px]`, and bare `rounded` (DEFAULT). Stops at a
      // `/` so `text-muted/40` stays the ALPHA rule's business, and at `:` so a
      // variant prefix (`lg:rounded-sm`) is read without its variant.
      pattern: new RegExp(`(?<![\\w-])${prefix}(?:-(\\[[^\\]]+\\]|[a-z0-9]+(?:-[a-z0-9]+)*))?(?![\\w-])`, 'g'),
      declared,
      group,
      prefix,
    }
  }
  return [scale('borderRadius', 'rounded'), scale('boxShadow', 'shadow'), scale('fontSize', 'text')]
})()

/**
 * `text-` is the hard one: it is a size *and* a colour *and* an alignment, and
 * they all share the prefix. Only a suffix that is unmistakably a size is
 * judged — Tailwind's own size names, and any arbitrary `[…px]`/`[…rem]`. A
 * colour (`text-muted`), an alignment (`text-left`) and a transform
 * (`text-balance`) fall through untouched, which is the same split
 * `tailwind.config.js` makes at the top for why the scale is not called `body`.
 */
const TAILWIND_SIZES = /^(?:xs|sm|base|lg|xl|[2-9]xl)$/
const isSize = (suffix) =>
  suffix !== undefined && (TAILWIND_SIZES.test(suffix) || /^\[[\d.]+(?:px|rem|em)\]$/.test(suffix))

/**
 * **The fifth rule: a spacing step that already has a name.**
 *
 * `tailwind.config.js` adds the named scale *alongside* Tailwind's numeric one,
 * deliberately — « the numeric utilities stay available for the one-off cases
 * that are not part of the system ». What that permits is a second spelling of
 * a step the system already names, and measured before this rule existed, the
 * product was **27.8 %** on the named scale: 551 spacing utilities, 379 of them
 * numeric, and **154 of those spelling a step the named scale already had**.
 * `gap-3` appeared 61 times beside `gap-inline`'s 38 — the same 12 px, written
 * two ways, so no reviewer could read rhythm off the source and the axis scored
 * 5 for four consecutive rounds.
 *
 * The two most-used values were not a spelling problem but a missing rung: 8 px
 * ×105 and 4 px ×75, more than any named step, on a scale documented as
 * « derived from what the screens already repeat ». `--space-snug` and
 * `--space-hair` are those two, and the codemod that followed took the product
 * to 85 %.
 *
 * Only exact equality is judged. A value the scale does not name — 2 px, 10 px,
 * 40 px — is the one-off case the config makes room for and is not this rule's
 * business. The px are read out of `tokens.css` rather than copied, so a rung
 * added there is enforced here on the same commit.
 */
const SPACING_STEPS = (() => {
  const css = readFileSync(join(ROOT, 'src/design/tokens.css'), 'utf8')
  const byPx = new Map()
  for (const [, name, px] of css.matchAll(/--space-([\w-]+):\s*(\d+)px/g)) {
    byPx.set(Number(px), name)
  }
  return byPx
})()
/** Tailwind's numeric spacing: `n` → `n × 4px`, plus the literal `px` → 1px. */
const stepPx = (suffix) => (suffix === 'px' ? 1 : Number(suffix) * 4)
const SPACING = new RegExp(
  String.raw`(?<![\w-])((?:p|m)(?:[xytblr])?|gap(?:-[xy])?|space-[xy])-(px|\d+(?:\.\d+)?)(?![\w-])`,
  'g',
)

const violations = []
const offScale = []
const deadAlpha = []
const cancelled = []
const renamed = []
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
    for (const { pattern, declared, group, prefix } of OFF_SCALE) {
      pattern.lastIndex = 0
      for (const match of line.matchAll(pattern)) {
        const suffix = match[1]
        /*
         * **Only the suffixed forms are judged**, and the reason is that these
         * prefixes are ordinary English. A bare `rounded` is the config's own
         * `DEFAULT` rung and legitimate anyway; a bare `text` is not a utility
         * at all, and matching it flagged 300+ lines of `const text = …` and
         * `schema.text("-")` in the editor's own tests the first time this rule
         * ran. Comments are already stripped, so what is left is code, and in
         * code a hyphenated `rounded-md` is a class name and `text` is a
         * variable. The gap this leaves — a bare `shadow`, which would be
         * Tailwind's default — is worth the 300 false positives it costs to
         * close.
         */
        if (suffix === undefined) continue
        if (declared.has(suffix)) continue
        // Only judge `text-` when the suffix is a size; it is also the colour
        // and the alignment prefix.
        if (prefix === 'text' && !isSize(suffix)) continue
        const known = [...declared].sort().join(', ') || '(none)'
        offScale.push(`${file}:${i + 1}: ${match[0]} — ${group} declares ${known}\n      ${line.trim()}`)
      }
    }
    SPACING.lastIndex = 0
    for (const match of line.matchAll(SPACING)) {
      const name = SPACING_STEPS.get(stepPx(match[2]))
      if (name === undefined) continue
      renamed.push(
        `${file}:${i + 1}: ${match[0]} — ${stepPx(match[2])}px is \`--space-${name}\`, write \`${match[1]}-${name}\`\n      ${line.trim()}`,
      )
    }
    for (const { utility, by, why } of CANCELS) {
      const hit = utility.exec(line)
      if (!hit) continue
      const other = by.exec(line)
      if (!other) continue
      cancelled.push(`${file}:${i + 1}: ${hit[0]} + ${other[0]} — ${why}\n      ${line.trim()}`)
    }
  })
}

if (cancelled.length > 0) {
  console.error(`\nutilities that cancel each other — the class is right and the rule never applies (${cancelled.length}):\n`)
  for (const v of cancelled) console.error(`  ${v}`)
  console.error('\nDrop the display utility, or drop the clamp — the two cannot both be meant.\n')
  process.exit(1)
}

if (renamed.length > 0) {
  console.error(
    `\nspacing written off a scale that names it — two spellings of one step (${renamed.length}):\n`,
  )
  for (const v of renamed) console.error(`  ${v}`)
  console.error(
    '\nThe named step and the numeric utility are the same pixels. Two spellings mean\n' +
      'nobody can read the rhythm off the source, which is how this stayed at 27.8%\n' +
      'on the scale for four rounds. Use the name; add a rung if the value deserves one.\n',
  )
  process.exit(1)
}

if (offScale.length > 0) {
  console.error(`\nutilities off the declared scale — Tailwind's defaults leaking past \`extend\` (${offScale.length}):\n`)
  for (const v of offScale) console.error(`  ${v}`)
  console.error('\nUse a declared rung, or add one to tailwind.config.js (and to')
  console.error('src/design/tokens.css + VISION.md §6 when it is a new value). `rounded-md`')
  console.error('is 6px and `shadow-sm` is Tailwind\'s, not this product\'s.\n')
  process.exit(1)
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
  `tokens ok — ${checked} files scanned for hex literals, dead /NN modifiers ` +
    `on ${tokenNames.size} tokens and ${CANCELS.length} cancelling utility pair(s), ` +
    `${exempted} exempt (${EXEMPT.map((e) => e.prefix).join(', ')})`,
)
