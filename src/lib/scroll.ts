/**
 * Scrolling the app does to itself — and the one place that decides whether it
 * is animated. It is not.
 *
 * ## Why it is not, and why that is a measurement rather than a taste
 *
 * Six call sites each wrote `behavior: 'smooth'`, and **Chromium picks the
 * duration for it**. Measured on the shipped review gate, the rep's own way in —
 * open the gate, press the page turn the arming guard offers:
 *
 *     1280×800   box 747 in 2549   415 ms / 27 intermediate frames
 *      960×600   box 547 in 2549   352 ms / 23 intermediate frames
 *
 * VISION §6's ceiling is **150 ms** and DEC-50 carves out one surface, the
 * widget's arrival, which is a card drawn over another application. A page turn
 * inside a document on the app's own paper is not that surface, and 415 ms is
 * also past the 300 ms master rule. It was the only motion in the product above
 * either, and the guard walks a rep through six to eight of those turns:
 * **1 996 ms of animation per gate at 1280×800 and 2 647 ms at 960×600**, on the
 * one screen a rep cannot leave without deciding (DEC-4), plus the 336–401 ms
 * opening jump to the first `⚠ faible` row.
 *
 * ## What the animation was for, and what it was actually buying
 *
 * The reason it was smooth is the arming guard: coverage is the union of the
 * viewports a column has *shown*, and a jump shows nothing on the way. So the
 * question is whether the guard credits those intermediate frames — and it does
 * not, in either direction. `Review.tsx`'s `extend` unions the landing viewport
 * with the band it abuts, and a page turn lands on that band's own edge, so
 * every frame of the sweep lies *inside* the union either way. Driven against
 * the shipped gate, both ways, at both smoke sizes:
 *
 *     smooth   6 presses / 1 996 ms   8 presses / 2 647 ms
 *     auto     6 presses /   164 ms   8 presses /   227 ms
 *
 * Byte-identical scroll trails. The app-initiated jump is the other half and it
 * is explicitly *not* credited — `jumping` replaces the band with where the
 * scroll landed, « never the bands it animated past » — so the 336–401 ms of
 * that one is spent on frames the guard is written to discard.
 *
 * A token cannot shorten `behavior: 'smooth'`, and hand-rolling a rAF curve
 * inside 150 ms would be a second animation no check can see, competing with the
 * rep's own wheel. What ships instead is the behaviour every rep who has asked
 * their OS for less motion has already had since this file existed, and which
 * reaches the gate in the same number of presses: **instant**.
 *
 * ## Why the helpers stay, and why `behavior` is still named here
 *
 * The value is spelled once, in one file, for the reason it always was: a page
 * turn, a « revenir en haut », a citation and a chip rail all move a scroller on
 * the rep's behalf, and six call sites each deciding independently is how two of
 * them end up wrong — which is the history above. `scripts/check-motion.mjs`
 * holds `behavior: 'smooth'`, `scroll-behavior: smooth`, Tailwind's
 * `scroll-smooth` and both CSSOM spellings to this file, so the decision cannot
 * be reintroduced one call site at a time; `scroll.test.ts` beside this file
 * drives the four exported helpers and asserts what they *pass*, because a check
 * that reads the rest of the tree cannot see this file changing its mind.
 *
 * It was also invisible to `shot.mjs --motion` by construction: that check reads
 * `transitionDuration` and `animationDuration`, and a scroll animation is
 * neither. That blind spot is why this was measured with a driver — a page turn
 * pressed on the real gate, `scrollTop` sampled every animation frame — and it
 * is still open for anything that reintroduces a scroll animation by a route
 * `check-motion.mjs` does not spell.
 *
 * ## Why `scrollIntoView` is guarded
 *
 * It is not implemented in jsdom — not even a function there — so calling it
 * directly turns « the renderer scrolls to the cited line » into a `TypeError`
 * inside a `useEffect`, which React reports as a crashed component tree rather
 * than as a missing DOM API. A guard rather than a global polyfill in
 * `test/setup`: the tests should exercise the code the browser runs, and what
 * the browser runs is a call that may not exist. Nothing downstream depends on
 * the scroll having happened — the cited line is highlighted either way.
 */

/**
 * **Instant, always.**
 *
 * Exported so the test beside this file can assert the value the helpers below
 * hand to the DOM, and so the four of them cannot drift from each other: two
 * spellings of this constant is the failure the whole file is here to prevent.
 *
 * It is deliberately not a question asked of `matchMedia` any more. That branch
 * existed because Chromium runs a `smooth` scroll at full curve whatever the OS
 * setting says, so the rep who had asked for less motion was the only one not
 * getting 415 ms of it; with nothing animated there is no asymmetry left to
 * repair, and a media query whose two answers are equal is a control that does
 * nothing.
 */
export const SCROLL_BEHAVIOR: ScrollBehavior = 'auto'

/** Bring an element into the middle of its scroller, if the platform can. */
export function scrollToCenter(target: Element | null | undefined): void {
  if (typeof target?.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'center', behavior: SCROLL_BEHAVIOR })
}

/**
 * The same, brought to the *top* of its scroller.
 *
 * `center` is right when the point is « look at this in context ». It is wrong
 * when the target is a row taller than a third of the column: centring a 180px
 * field in a 500px rail leaves the row above sheared through the middle at the
 * top edge, and what the rep lands on is half of something else. Honour the
 * element's own `scroll-margin-top`, which is what `start` does.
 */
export function scrollToTop(target: Element | null | undefined): void {
  if (typeof target?.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'start', behavior: SCROLL_BEHAVIOR })
}

/**
 * `scrollTo` and `scrollBy` on a scroller the app is moving on the rep's behalf.
 *
 * They exist so that no surface spells `behavior` itself. A page turn, a
 * « revenir en haut » and a chip rail all moved for the same reason and had to
 * stop moving for the same reason, and three call sites each deciding that
 * independently is how two of them end up wrong.
 *
 * Guarded like the two above: jsdom gives an element neither method.
 */
export function scrollElementTo(el: Element | null | undefined, to: ScrollToOptions): void {
  if (typeof el?.scrollTo !== 'function') return
  el.scrollTo({ ...to, behavior: SCROLL_BEHAVIOR })
}

export function scrollElementBy(el: Element | null | undefined, by: ScrollToOptions): void {
  if (typeof el?.scrollBy !== 'function') return
  el.scrollBy({ ...by, behavior: SCROLL_BEHAVIOR })
}
