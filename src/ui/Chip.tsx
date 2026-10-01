/**
 * A chip: a small bordered or tinted tag, sometimes pressable.
 *
 * Two real shapes in the code today — Review's sibling-account suggestions
 * (`border-card bg-inner text-body … px-snug py-hair text-ui`) and the uppercase
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
/*
 * **`text-ui` and no longer `text-meta`, because a chip is a control.**
 *
 * `--type-meta` (11px on a 17.05px line) is the size of the word *beside* a row.
 * On a pressable chip it produced a box of 17.05 + 8 of padding + 2 of border =
 * **27.05px**, and the product's segmented options — `--type-ui`, the same 4px
 * padding, no border — produce **26.59px**. Measured over all 85 stages at both
 * sizes: those two heights stood side by side on **27 screens**, 0.46px apart.
 * Half a pixel is not a decision anybody took; it is two type rungs meeting a
 * border, and `--census` now fails on it.
 *
 * At `--type-ui` the chip is 18.59 + 8 + 2 = **28.59px**, which is the rung the
 * product's own one-line fields already stand on (« Objet du brouillon »,
 * « Client », « Rechercher dans la transcription »). One height fewer on every
 * screen that draws both, and the thing a rep presses is now set at the size
 * every other control is set at. The uppercase `label` variant keeps
 * **`--type-label`**: it is a word in a row and not a control, which is the
 * distinction the docblock below already drew about `min-h-[24px]`.
 *
 * This sentence said `--type-meta` from the round that wrote it, and the code
 * under it has said `text-label` throughout. The two are both 11px, so the
 * claim cost nothing while the rungs differed only in name — and then
 * `--label-tracking` landed on the `label` rung, which is the eyebrow's
 * tracking, and `--type-meta` became the rung for 11px that is *not* an
 * eyebrow. The variant wants the eyebrow. Naming the wrong one here would now
 * argue for taking the tracking back off.
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
        'border-card bg-inner text-body hover:bg-subtle active:translate-y-px min-h-[24px] rounded-sm border px-snug py-hair text-ui transition',
      /** Brand tint. 10.55:1 — the only filled chip that carries text. */
      brand: 'bg-brand-100 text-brand-900 min-h-[24px] rounded-sm px-snug py-hair text-ui',
      /** The uppercase micro-label. Not a control, just a word in a row. */
      label: 'text-muted text-label font-semibold uppercase',
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
