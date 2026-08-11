/**
 * A chip: a small bordered or tinted tag, sometimes pressable.
 *
 * Two real shapes in the code today — Review's sibling-account suggestions
 * (`border-card bg-inner text-body … px-2 py-0.5 text-[11px]`) and the uppercase
 * letterspaced micro-labels (*Prêt*, *Utilisé*, *Sur cette machine*) that
 * Agenda and Réglages both write out longhand.
 *
 * Deliberately absent: an orange chip. `--accent` means armed or recording, it
 * is 2.44:1 on white, and a filled orange chip with text on it cannot be read.
 * The armed state is a `StateDot`, where the orange is on the dot and the word
 * beside it is legible.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

const chip = cva('inline-flex shrink-0 items-center', {
  variants: {
    variant: {
      /** Pressable suggestion — Review's "autres sociétés du même groupe". */
      choice:
        'border-card bg-inner text-body hover:bg-subtle rounded-sm border px-2 py-0.5 text-meta transition',
      /** Brand tint. 10.55:1 — the only filled chip that carries text. */
      brand: 'bg-brand-100 text-brand-900 rounded-sm px-2 py-0.5 text-meta',
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
