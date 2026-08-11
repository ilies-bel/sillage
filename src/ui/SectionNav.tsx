/**
 * The left rail of a two-pane screen: the sections, with exactly one current.
 *
 * It is here rather than inlined in *Réglages* because the thing it carries is
 * not a layout — a two-pane split is `flex` and two divs — but a **selected
 * navigation item**, and none of the other primitives can express one. `Row`
 * has an `interactive` variant and no notion of *current*; `Chip` is a tag, not
 * a destination. Left to the screen, the selected item would have been a
 * hand-written `className` ternary with no `aria-current` on it, which is the
 * exact shape of the bug this folder exists to make unconstructible: a state
 * carried by colour alone.
 *
 * Two things it settles, both from VISION.md §6:
 *
 *   · **Selection is brand blue, never orange.** Orange has one meaning in this
 *     product — this meeting is armed or recording — and a settings rail is not
 *     that. `--brand-700` on `--brand-50` is 5.80:1, so the current item is
 *     legible rather than merely tinted.
 *   · **Selection is in the accessible tree.** `aria-current="page"` rides with
 *     the colour, so a screen reader hears which section is open.
 *
 * And a third carrier, from `5.5 Réglages`: a 2px rule down the left edge of the
 * current item. `--brand-50` is a wash — 1.09:1 against the rail's own
 * `--bg-card-soft` — so on a projector, in sunlight, or on the mid-range laptop
 * this ships to, the tint is the first thing to disappear. The rule is a shape
 * rather than a shade and survives all three. Every item carries the border at
 * `transparent`, so becoming current changes a colour and never a width: the
 * labels do not step sideways as the rep moves down the rail.
 *
 * The items are full-bleed — no rounding, no gap, their own horizontal padding —
 * because the left rule has to meet the rail's edge to read as an edge marker.
 * A rounded pill with a rule down one side reads as a broken border.
 *
 * `current` naming a section that is not in `items` throws. A rail with nothing
 * selected renders a right pane with nothing in it, and an empty pane is what a
 * broken screen looks like.
 */
import { cn } from '../lib/utils.ts'

export interface SectionNavItem<Id extends string = string> {
  id: Id
  /** French, and the words the section itself is headed with. */
  label: string
}

export interface SectionNavProps<Id extends string> {
  /**
   * The rail's accessible name. Required: a screen holds more than one list,
   * and « Réglages » is not a name a landmark can be found by.
   */
  label: string
  items: readonly SectionNavItem<Id>[]
  /**
   * `NoInfer` on both of these, so `Id` is fixed by `items` alone. Without it a
   * `current` naming a section the rail does not hold simply widens the union
   * and compiles — which is the mistake most worth catching, and the one the
   * runtime guard below would otherwise be left to catch on its own.
   */
  current: NoInfer<Id>
  onSelect: (id: NoInfer<Id>) => void
  className?: string
}

export function SectionNav<Id extends string>({
  label,
  items,
  current,
  onSelect,
  className,
}: SectionNavProps<Id>) {
  if (!items.some((item) => item.id === current)) {
    throw new Error(
      `SectionNav: \`current\` (${current}) names no section — the content pane would be empty.`,
    )
  }

  return (
    <nav aria-label={label} className={cn('shrink-0', className)}>
      <ul>
        {items.map((item) => {
          const selected = item.id === current
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'w-full border-l-2 px-row py-2 text-left text-ui transition',
                  selected
                    ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                    : 'text-muted hover:bg-subtle hover:text-body border-transparent',
                )}
              >
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
