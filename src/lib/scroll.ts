/**
 * Scrolling the app does to itself — and the one place that decides whether it
 * is animated.
 *
 * ## Why the behaviour is not spelled at the call site any more
 *
 * Six call sites each wrote `behavior: 'smooth'`, and **Chromium does not
 * suppress programmatic smooth scrolling for `prefers-reduced-motion`**. The
 * setting collapses CSS transitions and animations; a `scrollIntoView` or a
 * `scrollBy` asked for `smooth` runs its full curve regardless. Measured in the
 * same Chromium the harness drives — frames caught at an intermediate position,
 * one row per sample:
 *
 *     no-preference   42 intermediate frames
 *     reduce          43 intermediate frames
 *
 * Identical curve, identical count. So the rep who turned motion off system-wide
 * got a several-hundred-pixel animated scroll, unasked for, the instant the
 * review gate opened — and again on every page turn the arming guard walks them
 * through, which on a long compte-rendu is a dozen of them. `tokens.css` says of
 * itself that it respects the OS setting « rather than asserting our motion is
 * tasteful enough to be exempt », and this was the motion that ignored it.
 *
 * It was invisible to `--motion` by construction: that check reads
 * `transitionDuration` and `animationDuration`, and a scroll animation is
 * neither. The check therefore printed « s'arrête quand l'OS le demande » over
 * six live animations that do not stop — its own load-bearing half, certifying
 * the opposite of the truth. `scripts/check-motion.mjs` is the other half of the
 * fix: it holds `behavior: 'smooth'` to this file, because a rule that lives in
 * one function is one edit away from being bypassed by the next call site.
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
 * `smooth` normally, `auto` when the rep has asked their OS for less motion.
 *
 * `matchMedia` is capability-tested rather than assumed: it is absent in jsdom,
 * and the honest default when the question cannot be asked is the behaviour the
 * product has always had. Read per call, never cached — the setting can change
 * while the app is open, and a value latched at module load would keep animating
 * for the rest of the session.
 */
export const scrollBehavior = (): ScrollBehavior => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Bring an element into the middle of its scroller, if the platform can. */
export function scrollToCenter(target: Element | null | undefined): void {
  if (typeof target?.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
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
  target.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
}

/**
 * `scrollTo` and `scrollBy` on a scroller the app is moving on the rep's behalf.
 *
 * They exist so that no surface spells `behavior` itself. A page turn, a
 * « revenir en haut » and a chip rail all animate for the same reason and have
 * to stop animating for the same reason, and three call sites each deciding
 * that independently is how two of them end up wrong.
 *
 * Guarded like the two above: jsdom gives an element neither method.
 */
export function scrollElementTo(el: Element | null | undefined, to: ScrollToOptions): void {
  if (typeof el?.scrollTo !== 'function') return
  el.scrollTo({ ...to, behavior: scrollBehavior() })
}

export function scrollElementBy(el: Element | null | undefined, by: ScrollToOptions): void {
  if (typeof el?.scrollBy !== 'function') return
  el.scrollBy({ ...by, behavior: scrollBehavior() })
}
