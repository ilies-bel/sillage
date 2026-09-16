/**
 * Shared by the review gate and by every reading column: see `ReadingColumn`.
 */
import { Button } from './Button.tsx'

/**
 * **The page turn, at the foot of the column it turns.**
 *
 * It used to live in the pinned decision slot and swap to *Valider* the instant
 * the last screenful landed — the same DOM node, the same rectangle, sixty-three
 * milliseconds apart. A double-click on the fourth turn shipped to the CRM
 * without the rep ever seeing the word; five Enters on the retained focus did
 * the same; and the first frame of every gate painted the ship's fill under the
 * turn's label, because the shared `transition` animated one into the other.
 * `POST /v1/crm/tasks` has no idempotency key, so none of the three has an undo.
 *
 * Here it is in the flow instead, after the last thing to read, which is where a
 * rep who has just finished a screenful is already looking. It is not the
 * decision's slot, it is not the decision's shape, and the two never occupy one
 * rectangle — which is the property that makes the gesture a decision rather
 * than a repetition.
 *
 * **One screenful, not the whole column.** The scroll used to jump to
 * `scrollHeight`, so the guard could be satisfied by two presses of a button the
 * rep never took their eyes off — a EULA checkbox with better copy. Arming is
 * measured from the scroll either way (`atEnd` fires from this, never from the
 * click), but a measurement of a single teleport measures *revealing*. `- 64`
 * overlaps two lines across the turn so nothing falls into the seam.
 */
export function PageTurn({
  what,
  onTurn,
  ground,
}: {
  what: string
  onTurn: () => void
  /** The colour the column is painted, for the gradient the button sits on. */
  ground?: string
}) {
  return (
    /*
      **Sticky, because a control at the end of the content is a control nobody
      reaches.**

      The first version sat after the last paragraph. Measured on the document
      column at 1280×800 — 2508px of content in a 747px box — it was fully
      visible for sixteen pixels of a 1761-pixel scroll: **nine-tenths of one per
      cent**, and inside that window the scroll it performs is a no-op because
      the column is already at its end. Wheel-scrolled from the top in 200px
      steps it never entered the viewport once. The harness only ever clicked it
      because Playwright scrolls a target into view first, and the keyboard only
      because focus does — which is precisely the « a teleport measures
      *revealing* » failure this control exists to prevent.

      Pinned to the bottom of its own scroller instead: reachable at every scroll
      position, in the column whose text it turns, and never in the decision's
      rectangle. `pointer-events-none` on the row and `auto` on the button so the
      band it floats over stays scrollable and selectable.
    */
    <div
      className="turn-ground pointer-events-none sticky bottom-0 z-10 flex justify-center pb-snug pt-gutter"
      {...(ground ? { style: { ['--turn-ground' as string]: ground } } : {})}
    >
      <Button variant="bordered" className="pointer-events-auto shadow-card" onClick={onTurn}>
        {what}
      </Button>
    </div>
  )
}
