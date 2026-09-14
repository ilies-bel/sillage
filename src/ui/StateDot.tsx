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
      /*
       * Asked and not yet answered — an outline, not a colour.
       *
       * `none` was doing this job on the splash and it draws *nothing*, so the
       * one row still waiting read as a row whose dot had failed to render
       * beside two that had one. A ring says « the slot is here and it is
       * empty », which is exactly the state, and it commits to no semantic
       * colour: a pending answer is not a green light and not a red one.
       *
       * The ring was `ring-card` and drew *nothing at all* for two rounds:
       * `ringColor` was not in `tailwind.config.js`, so the class name spelled
       * a token that `ring-*` could not reach and compiled to no rule. Same
       * failure mode as `bg-muted/30` — a name that is right, a rule that does
       * not exist, and an element that is simply unstyled — and the row it hit
       * was the one this tone was written for. Both `borderColor` and
       * `ringColor` now carry the pair.
       */
      pending: 'bg-transparent ring-1 ring-inset ring-muted',
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
  /**
   * On the *word*, not on the dot.
   *
   * The one caller is the session header's recording pill, whose room runs out
   * at the window's minimum width and which drops the word « ENREGISTREMENT »
   * there — an orange dot and a running clock say the same thing beside it. The
   * word is still in the DOM and still read aloud, because a dot whose only
   * meaning is its colour is what this component exists to make impossible;
   * what the class does is take it out of the *layout*.
   */
  labelClassName?: string
}

export function StateDot({ tone, label, className, labelClassName }: StateDotProps) {
  if (label.trim() === '') {
    throw new Error(
      'StateDot: `label` cannot be blank — a state dot is never the only signal (VISION.md §6).',
    )
  }

  return (
    <span className={cn('text-muted inline-flex shrink-0 items-center gap-2 text-ui', className)}>
      <span aria-hidden className={dot({ tone })} />
      <span className={labelClassName}>{label}</span>
    </span>
  )
}
