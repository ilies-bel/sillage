/**
 * The window's top strip: reserved space and a drag handle, and nothing else.
 *
 * `main.ts` hides the frame's own title bar (`titleBarStyle: 'hidden'`) and the
 * host paints its controls over this strip — traffic lights on macOS, the
 * Windows controls overlay. The strip carries **no fill and no content**, so
 * what shows through it is whatever the screen below puts there: the rail's
 * `--bg-card-soft` on the left of the calendar, `--bg-canvas` everywhere else.
 * Those two differ by two units, which is why the seam is not visible.
 *
 * **It used to be a `--brand-700` rectangle carrying an 18px logo**, with
 * `titleBarOverlay.color` set to the same blue so the top of the window was one
 * saturated band on both platforms. That is 36px of every screen — 6% of the
 * height at the 960×600 minimum `main.ts` declares — spent on a brand swatch
 * with no information in it, and it is the single loudest piece of chrome in
 * the product. VISION.md §6 asks for « calm, low-contrast, paper-like — the
 * opposite of a dashboard » and never asks for a band; the reference this
 * product is measured against (`docs/stories/ref/granola-home.png`) has none,
 * and lets its sidebar run the full height of the window instead.
 *
 * The wordmark is not lost with it: `ui/Rail.tsx` draws « Sillage » at the top
 * of the one surface that is on every screen that has a rail, and the two
 * screens without one — the session and the review gate — say what meeting the
 * rep is in, which is the more useful thing for a strip to sit above.
 *
 * It is `.drag-region`, because a hidden title bar is a window nobody can move
 * otherwise. The height is `env(titlebar-area-height)` where the host declares
 * one and 36px where it does not (the harness, macOS), which is the number
 * `main.ts` passes to the overlay.
 */
export function TitleBar() {
  return (
    <div
      role="presentation"
      className="drag-region shrink-0"
      style={{ height: 'env(titlebar-area-height, 36px)' }}
    />
  )
}
