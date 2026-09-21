import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The two named scales `tailwind.config.js` adds on top of Tailwind's defaults.
 *
 * They have to be repeated here because `tailwind-merge` resolves conflicts
 * from its own built-in table of what Tailwind's class names mean, and it has
 * never seen `px-row` or `text-ui`. Left undeclared, `cn('px-row', 'px-block')`
 * returns *both* — which is precisely the bug this function exists to prevent,
 * silently reintroduced for exactly the classes the design system introduces.
 *
 * `src/ui/ui.test.tsx` reads `tailwind.config.js` and fails if these two lists
 * and that file's `spacing` / `fontSize` keys ever stop agreeing.
 */
export const SPACING_STEPS = ['hair', 'snug', 'tight', 'inline', 'row', 'block', 'gutter'] as const
/**
 * Both halves of the scale: the interface's five, then the document's four
 * (`--type-prose` in tokens.css says why the second group exists). A rung
 * missing here is a `text-` override that silently fails to override, which is
 * what `ui.test.tsx` reads `tailwind.config.js` to prevent — and what it caught
 * when these four were added there and not here.
 */
export const TYPE_STEPS = [
  'label',
  'meta',
  'ui',
  'copy',
  /*
   * No `display`. 28px is the wordmark's rung and `.wordmark` in
   * `src/design/index.css` is the one rule that spends it — the utility was
   * deleted because it was written on the wordmark *and* on every page title
   * with the weight coming from `<p>` versus `<h1>`. This list has to match the
   * config's `fontSize` keys (`ui.test.tsx` holds it to them) or `cn()` stops
   * recognising a size as a size and an override silently emits both.
   */
  'prose',
  'subhead',
  'heading',
  'title',
] as const

/**
 * `text-ui` is a size and `text-muted` is a colour, and `text-` is all they
 * have in common. Tailwind's own plugins keep them apart by key; tailwind-merge
 * needs the size keys named so it puts them in `font-size` and leaves anything
 * else under `text-` in `text-color`, where the built-in fallback already
 * handles arbitrary names.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { spacing: [...SPACING_STEPS] },
    classGroups: { 'font-size': [{ text: [...TYPE_STEPS] }] },
  },
})

/**
 * Class-name join, conflict-aware.
 *
 * The previous implementation was `classes.filter(Boolean).join(' ')`, which
 * concatenates and nothing more. That is fine until a component takes a
 * `className` override — `cn('px-row py-tight', props.className)` with
 * `className="px-block"` emits both, and which one wins is decided by the order
 * Tailwind happened to emit them in its stylesheet, not by the caller. The
 * override silently does nothing, or works by accident.
 *
 * `tailwind-merge` was already installed for exactly this and was being
 * imported by nothing. `clsx` handles the arrays, objects and falsy values that
 * `cva` variant props produce; `twMerge` then keeps the last of any conflicting
 * pair.
 */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes))
}
