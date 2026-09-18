/**
 * A view switch: two to four words, exactly one of them current.
 *
 * `Jour · Semaine · Mois · Liste` (VISION.md §6) is the only one in the product
 * so far, and it is here rather than inlined in the calendar for the same
 * reason `SectionNav` is: the thing being carried is a *selected* control, and
 * left to a screen it becomes a `className` ternary with the state in the colour
 * and nowhere else.
 *
 * It is not `SectionNav` with a `direction` prop. That component is a navigation
 * rail and says `aria-current="page"` — a claim that its items are destinations,
 * which is true of *Réglages → Connecteurs* and false of a switch that changes
 * how much of one screen is in view. This is a toggle group: `role="group"`,
 * `aria-pressed` on each button, and no navigation semantics at all. The two
 * differ in markup, in role and in what a screen reader says; folding them
 * together would mean lying in one of the two places.
 *
 * Selection is brand blue. Orange means armed or recording (VISION.md §6) and
 * a view switch is never that.
 */
import { cn } from '../lib/utils.ts'

export interface SegmentedOption<Id extends string = string> {
  id: Id
  /** French, and the word on the button. */
  label: string
}

export interface SegmentedProps<Id extends string> {
  /**
   * The group's accessible name. Required — « Jour » on its own says nothing
   * about what it switches, and a screen holds more than one group of buttons.
   */
  label: string
  options: readonly SegmentedOption<Id>[]
  /** `NoInfer`, so `options` alone fixes `Id` and a stale value is a type error. */
  current: NoInfer<Id>
  onSelect: (id: NoInfer<Id>) => void
  className?: string
}

export function Segmented<Id extends string>({
  label,
  options,
  current,
  onSelect,
  className,
}: SegmentedProps<Id>) {
  if (!options.some((option) => option.id === current)) {
    throw new Error(`Segmented: \`current\` (${current}) names no option — nothing would be shown.`)
  }

  return (
    <div
      role="group"
      aria-label={label}
      /*
        **A tinted track with a raised white chip on it, not a wash on white.**
        This was `bg-inner` (#ffffff) carrying a `bg-brand-50` (#ebf8ff)
        selection: **1.08:1**, so which option is current rested almost entirely
        on `text-brand-700` against `text-muted`. It is the most repeated control
        in the product — four groups across the calendar, the session and the
        review gate — and the one a rep uses most often without reading.

        Inverting it is what a sliding thumb was asked for and refused. The
        refusal stands: §6 allows « opacity and 2–4px translate only », a thumb
        travels ~80px, and two of these four groups are on screen during a live
        client call, where DEC-14's « a chip that moves during a call is a chip
        that steals a glance » applies directly. But the request was pointing at
        something real — the selection could not be *seen* — and the answer to
        that is contrast, not travel. A raised chip reads instantly, reads for a
        colour-blind rep, and needs no motion at all.

        `--bg-subtle` #eef3f7 is the same ground the rail uses, nine units off
        the canvas; the chip is `--bg-inner` #ffffff on top of it with
        `shadow-card` — VISION §6's « shadows barely there », and the third
        surface in the product that genuinely lifts off the paper.

        **`p-hair` and no longer `p-0.5`.** The groove was two pixels wide, and
        two is not a step of this scale: the smallest declared rung is
        `--space-hair` at four. It was also the most widespread off-ladder value
        in the renderer — measured over all 85 stages at both sizes, this one
        line painted 2px on **106 of the 170 stagings, 512 occurrences**, more
        stagings than any other site in the product.

        It costs four pixels of height (30.59 → 34.59 at `--type-ui`) and it
        buys the groove back: at two pixels the tinted track was a hairline
        around a white chip, which is the same 1.08:1 problem this docblock
        opens on solved for colour and left unsolved for width. Four pixels of
        `--bg-subtle` on every side is a track a rep can see the chip sitting
        *in*, and it is the same four the buttons inside already use (`py-hair`).
      */
      className={cn('bg-subtle inline-flex shrink-0 rounded-sm p-hair', className)}
    >
      {options.map((option) => {
        const selected = option.id === current
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(option.id)}
            className={cn(
              /*
                `active:translate-y-px`: the press, one pixel, on the existing
                `transition` — see `Button`'s docblock for the measurement and
                for the three variants that are deliberately still.
              */
              'rounded-sm px-inline py-hair text-ui transition active:translate-y-px',
              selected
                ? 'bg-inner shadow-card text-brand-700 font-medium'
                : 'text-muted hover:text-body',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
