/**
 * A chip: a small bordered or tinted tag, sometimes pressable.
 *
 * Two real shapes in the code today — Review's sibling-account suggestions
 * (`border-card bg-inner text-body … px-snug py-hair text-meta`) and the uppercase
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
 * `py-hair` and no longer `py-0.5`, and the target is the reason rather than
 * the ladder.
 *
 * `py-0.5` is two pixels, and two pixels is not a step of this product's scale
 * — the smallest declared rung is `--space-hair` at four. It was the densest
 * off-ladder site in the renderer: measured over all 85 stages at both sizes,
 * this one variant painted 2px on **64 stagings, 472 occurrences**, second only
 * to the calendar's day cells.
 *
 * But the ladder is the smaller half of it. Around `--type-meta` (11px on a
 * 17.05px line) `py-0.5` resolves to **23.05px** of chip, so the two pressable
 * variants carried `min-h-[24px]` purely to be dragged back over WCAG 2.2's
 * 24px floor — every pressable chip in the product was painted at exactly
 * 24.00px, a rescue and not a size, and the rescue is invisible in the class
 * list of anything that reuses this. At `py-hair` the box measures **27.05px**
 * on its own, two and a half pixels clear.
 *
 * `min-h-[24px]` stays, and it now declares the floor instead of manufacturing
 * it: `--type-meta` is a token and a chip must not be able to fall under 24 if
 * it moves. `label` never had it and still does not — a word in a row is not a
 * control, and enlarging it would only push the row it sits on apart.
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
        'border-card bg-inner text-body hover:bg-subtle active:translate-y-px min-h-[24px] rounded-sm border px-snug py-hair text-meta transition',
      /** Brand tint. 10.55:1 — the only filled chip that carries text. */
      brand: 'bg-brand-100 text-brand-900 min-h-[24px] rounded-sm px-snug py-hair text-meta',
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
