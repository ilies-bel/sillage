/**
 * A state dot, and the label that has to go with it.
 *
 * There is no way to render the dot on its own. `label` is required, it is
 * refused at runtime if it is blank, and the component owns the markup for both
 * — because the rule "colour is never the only signal" is one that documentation
 * has never once enforced. Every screen in this repo already got it right by
 * hand; this is what stops the next one getting it wrong.
 *
 * The dot is `aria-hidden` and the label is the accessible name, so a screen
 * reader hears "Prêt", not "Prêt" preceded by a decorative bullet.
 *
 * `armed` is `--accent`, which VISION.md §6 gives exactly one meaning: this
 * meeting is armed or recording. Never a selected tab, never a primary button,
 * never a link. And note where the orange is: on the dot, not on the text.
 * `--accent` is 2.44:1 on white and cannot carry a label — the screens that
 * currently write `text-accent` on the words *Prêt*, *Utilisé* and
 * *Enregistrement* are rendering them at 2.41:1.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/utils.ts'

const dot = cva('h-1.5 w-1.5 shrink-0 rounded-full', {
  variants: {
    tone: {
      armed: 'bg-accent',
      ok: 'bg-success',
      warn: 'bg-warn',
      down: 'bg-danger',
      /* Selection and navigation, per VISION.md §6. 3.05:1 — non-text UI. */
      selected: 'bg-brand-500',
      /* Present but says nothing. Keeps the row's text aligned with its neighbours. */
      none: 'bg-transparent',
    },
  },
  defaultVariants: { tone: 'none' },
})

export interface StateDotProps extends VariantProps<typeof dot> {
  /**
   * The French word beside the dot. Required, and required to be non-blank —
   * a dot whose only meaning is its colour is the thing this component exists
   * to make unrepresentable.
   */
  label: string
  /** `text-muted` unless the row wants the label to carry weight. */
  className?: string
}

export function StateDot({ tone, label, className }: StateDotProps) {
  if (label.trim() === '') {
    throw new Error(
      'StateDot: `label` cannot be blank — a state dot is never the only signal (VISION.md §6).',
    )
  }

  return (
    <span className={cn('text-muted inline-flex shrink-0 items-center gap-2 text-ui', className)}>
      <span aria-hidden className={dot({ tone })} />
      {label}
    </span>
  )
}
