/**
 * A chip: a small bordered or tinted tag, sometimes pressable.
 *
 * Two real shapes in the code today — Review's sibling-account suggestions
 * (`border-card bg-inner text-body … px-snug py-0.5 text-[11px]`) and the uppercase
 * letterspaced micro-labels (*Prêt*, *Utilisé*, *Sur cette machine*) that
 * Agenda and Réglages both write out longhand.
 *
 * Deliberately absent: an orange chip. `--accent` means armed or recording, it
 * is 3.38:1 on white — it clears 3:1 as a graphic and is still under AA as text,
 * so a filled orange chip with text on it cannot be read. The ratio moved when
 * the grid proved a mark can be the only carrier; the conclusion did not, and the
 * stronger reason never depended on it: orange means armed or recording and
 * nothing else, so a chip in it would be claiming a state.
 * The armed state is a `StateDot`, where the orange is on the dot and the word
 * beside it is legible.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

/*
 * `min-h-[24px]` on the two pressable variants, not on `label`.
 *
 * WCAG 2.2's target size, and `py-0.5` around `--type-meta` resolves to
 * twenty-three pixels — one short, on the filter row where seven of them wrap
 * and a miss lands on the chip below. `label` is a word in a row and never a
 * control, so enlarging it would only push the row it sits on apart.
 */
const chip = cva('inline-flex shrink-0 items-center', {
  variants: {
    variant: {
      /**
       * Pressable suggestion — Review's "autres sociétés du même groupe".
       *
       * `active:translate-y-px` is the press, one pixel, on the `transition`
       * this already carries (the fast rung, 90ms). `Button`'s docblock holds
       * the measurement and the reason the gate's three decision variants are
       * excluded from it; a `choice` chip confirms nothing and is safe.
       */
      choice:
        'border-card bg-inner text-body hover:bg-subtle active:translate-y-px min-h-[24px] rounded-sm border px-snug py-0.5 text-meta transition',
      /** Brand tint. 10.55:1 — the only filled chip that carries text. */
      brand: 'bg-brand-100 text-brand-900 min-h-[24px] rounded-sm px-snug py-0.5 text-meta',
      /** The uppercase micro-label. Not a control, just a word in a row. */
      label: 'text-muted text-label font-semibold uppercase tracking-wider',
    },
  },
  defaultVariants: { variant: 'choice' },
})

export interface ChipProps extends VariantProps<typeof chip> {
  children: ReactNode
  /** Present ⇒ renders a `<button>`; absent ⇒ a `<span>`. */
  onClick?: () => void
  /**
   * A chip that is a *toggle* rather than a suggestion — the search filters
   * (DEC-25, DEC-31). Defined ⇒ `aria-pressed` is on the button and the pressed
   * state paints `brand`, the one filled chip that can carry text (10.55:1).
   *
   * Separate from `variant` on purpose: the selection has to reach a screen
   * reader, and a chip whose only difference is a background colour does not.
   * Passing it without `onClick` is a chip nobody can unpress, so it throws.
   */
  pressed?: boolean
  className?: string
}

export function Chip({ children, onClick, pressed, variant, className }: ChipProps) {
  if (pressed !== undefined && !onClick) {
    throw new Error('Chip: `pressed` describes a toggle — it needs an `onClick` to toggle back.')
  }

  const classes = cn(chip({ variant: pressed ? 'brand' : variant }), className)

  if (onClick) {
    return (
      <button type="button" aria-pressed={pressed} onClick={onClick} className={classes}>
        {children}
      </button>
    )
  }
  return <span className={classes}>{children}</span>
}
