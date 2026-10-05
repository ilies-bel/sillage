/**
 * **Give the keyboard back to whatever opened the sheet.**
 *
 * The other half of a modal, and the half that only exists because of the
 * first. Réglages is drawn over the screen behind it and that screen is
 * `inert` while it is (`App.tsx`), so the control the rep pressed to get here
 * is blurred by the browser the moment the sheet mounts — focus falls to
 * `<body>` and `Tab` starts again from the top of the document. Measured before
 * any of this existed, on the `reglages` stage: focus stayed on BUTTON
 * « Réglages », *outside* the dialog, and `Tab` landed on a background control
 * **76 times at 1280×800 before the 77th reached the sheet, 75 times at 960×600
 * before the 76th** — the two sizes differ by one stop, so the number is given
 * per size rather than once. Making the background inert closes that; this is
 * what stops the closing from costing the rep their place.
 *
 * **The capture is in the render, not in an effect, and that is the whole
 * subtlety.** React mutates the DOM — including the `inert` attribute that
 * blurs the trigger — before it runs a single effect, so an effect reading
 * `document.activeElement` on the frame the sheet opens reads `<body>`. The
 * render that first returns the sheet runs before that mutation, and the
 * trigger is still focused there. `useDeparture` in `useDismiss.ts` derives
 * state during render for the same class of reason and states the StrictMode
 * argument: the mutation is guarded by the comparison that feeds it, so the
 * second invocation sees the values equal and captures nothing.
 *
 * **It never *moves* focus, only gives it back.** Moving it into the sheet is
 * the sheet's own job, in the file that holds the element to move it to
 * (`Reglages.tsx`'s `Sheet`), and the way out of the sheet is untouched: `Échap`
 * closes through `App.tsx`'s shortcut table and the ✕ and the veil through
 * `useDismiss`, all three ending in the same route change. This hook watches
 * that one boolean and adds no fourth way out.
 *
 * `null` is a real answer twice over. Nothing was focused when the sheet opened
 * — the rep pressed `⌘ ,` with focus on the document — and there is nothing to
 * give it back to; or the screen behind the sheet was replaced while it was
 * open, which « Revoir la présentation » does, and the control is no longer in
 * the document. Both leave focus where a fresh screen leaves it instead of
 * throwing into a detached node.
 */
import { useEffect, useRef } from 'react'

export function useReturnFocus(open: boolean): void {
  const was = useRef(open)
  const giveBackTo = useRef<HTMLElement | null>(null)

  if (was.current !== open) {
    was.current = open
    if (open) {
      const active = document.activeElement
      giveBackTo.current =
        active instanceof HTMLElement && active !== document.body ? active : null
    }
  }

  useEffect(() => {
    if (open) return
    const target = giveBackTo.current
    giveBackTo.current = null
    if (target !== null && target.isConnected) target.focus()
  }, [open])
}
