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
      className={cn('border-card bg-inner inline-flex shrink-0 rounded-sm border p-0.5', className)}
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
              'rounded-sm px-inline py-1 text-ui transition',
              selected
                ? 'bg-brand-50 text-brand-700 font-medium'
                : 'text-muted hover:bg-subtle hover:text-body',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
