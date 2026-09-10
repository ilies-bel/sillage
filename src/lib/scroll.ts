/**
 * Bring an element into the middle of its scroller, if the platform can.
 *
 * `Element.scrollIntoView` is not implemented in jsdom — it is not even a
 * function there — so calling it directly turns « the renderer scrolls to the
 * cited line » into a `TypeError` inside a `useEffect`, which React reports as a
 * crashed component tree rather than as a missing DOM API. Every renderer test
 * that renders the surface then fails for a reason that has nothing to do with
 * the surface.
 *
 * A guard rather than a global jsdom polyfill in `test/setup`: the tests should
 * exercise the code the browser runs, and what the browser runs is a call that
 * may not exist. Nothing downstream depends on the scroll having happened —
 * the cited line is highlighted whether or not it was brought into view.
 */
export function scrollToCenter(target: Element | null | undefined): void {
  if (typeof target?.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
