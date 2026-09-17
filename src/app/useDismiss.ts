/**
 * **Keep a surface mounted long enough to leave.**
 *
 * Measured on every screen in the product with `shot.mjs --motion`: « 66 / 82 /
 * 47 / 36 / 8 / 4 / 3 / 0 élément(s) animé(s) dont **0 qui s'en vont**, 0
 * `@keyframes` de sortie ». One element in the repo has an exit — the in-meeting
 * widget's `.widget-leaving` — and it lives in the other window. In the app
 * window, Réglages rises in over 150ms and then vanishes between two frames; so
 * does the `source ▸` panel, and so does every notice.
 *
 * That is not a taste gap, it is a missing half. `--ease-in` is declared in
 * `tokens.css`, argued over forty lines, pinned by shape in `tokens.test.ts` —
 * and worn by exactly one rule, in a window most of these screens never open.
 * VISION.md §6 states the rule as « **ease-out on the way in, ease-in on the way
 * out** », and the product only ever did the first half.
 *
 * The reason is mechanical rather than aesthetic: React unmounts on the frame
 * the condition flips, so there is no element left to transition. This holds it
 * for one duration and then lets go.
 *
 *     const { leaving, dismiss } = useDismiss(onClose)
 *     return <div className={leaving ? 'leaving' : 'animate-rise-in'} … onClick={dismiss}>
 *
 * **The duration is read, never written.** `--motion` is the single source and
 * `index.css`'s `.leaving` is what spends it; duplicating `150` here would be a
 * second number to keep in step, and the widget's exit handshake already
 * demonstrates the failure — it reads its own duration back off computed style
 * before telling the main process how long to wait.
 *
 * **`prefers-reduced-motion` needs no branch.** That media query sets `--motion`
 * to `0ms` (`tokens.css`), so the read returns 0, the timer fires on the next
 * tick and the surface unmounts without an intermediate frame — the same
 * collapse every other rung gets, from the same place.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** `150ms` / `0.15s` / `0ms` → milliseconds. Anything unreadable is instant. */
export function durationMs(value: string): number {
  const text = value.trim()
  if (text.endsWith('ms')) return Number.parseFloat(text) || 0
  if (text.endsWith('s')) return (Number.parseFloat(text) || 0) * 1000
  return 0
}

/** `--motion`, off the document, at the moment the surface starts leaving. */
const motionMs = (): number => {
  if (typeof window === 'undefined') return 0
  return durationMs(getComputedStyle(document.documentElement).getPropertyValue('--motion'))
}

/**
 * **Run something one `--motion` after the exit has started painting — which is
 * not one `--motion` after the effect, and for three rungs of this ladder it
 * was.**
 *
 * An effect runs after the commit and *before* the browser has resolved the
 * style that begins the exit. A timer armed in the effect therefore expires
 * while the motion still has that latency left to run, and `--ease-in` is
 * back-loaded by design (mean progress 0.173), so a cut of one frame off a
 * hundred and fifty milliseconds takes the last quarter of the fade with it.
 *
 * Measured on the widget's card, three runs, with the timer armed in the effect
 * (`scratch/r19-depart.mjs`): last painted opacity **0.237 / 0.241 / 0.238**,
 * detached at 157 / 154 / 152 ms. The surface was held for the whole duration
 * and then snapped out from a quarter opaque. That is round 18's finding about
 * `useDismiss`, one frame smaller, in the file whose own docblock concluded
 * « `useLeaving` and `useDeparture` were always right because both arm in an
 * effect ». Arming in an effect is necessary and it is not sufficient.
 *
 * **Two frames, not one, and the second is the measurement.** A single
 * `requestAnimationFrame` puts the arming in the *same* frame the style change
 * resolves in, so the hold and the motion end in the same frame and whether the
 * last paint lands before or after the animation's end is a coin toss: three
 * runs gave 0.000 / 0.000 / **0.438**. The second frame is the slack that makes
 * the animation finish first, every time — and it costs one frame of a surface
 * already at `opacity: 0`, which paints nothing.
 *
 * Under `prefers-reduced-motion` `--motion` is `0ms` (`tokens.css`), so the
 * surface leaves two frames later with no intermediate value painted — the same
 * collapse, from the same token, and not a second code path.
 *
 * One helper and not three copies, because the three rungs — `useDismiss`,
 * `useLeaving`, `useDeparture` — are one rule about when a hold starts, and this
 * repo has watched a two-copy invariant drift twice.
 */
export function holdOneMotion(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      timer = setTimeout(run, motionMs())
    })
  })
  return () => {
    cancelAnimationFrame(frame)
    if (timer !== null) clearTimeout(timer)
  }
}

export interface Dismiss {
  /** Wear `.leaving`. True only while the surface is on its way out. */
  leaving: boolean
  /** Call instead of the real close. Runs the exit, then closes. */
  dismiss: () => void
}

/**
 * The surface asks to go, wears the exit for one `--motion`, then goes.
 *
 * Driven from **inside** rather than from a prop, because the sheet's unmount
 * is the route changing one component up (`App.tsx`) and a surface cannot
 * transition after its parent has stopped rendering it. Intercepting its own
 * close keeps the whole exit in the file that draws it, and the caller's
 * `onClose` is untouched — it simply happens 150ms later.
 *
 * The timer is cleared on unmount, so a surface torn down another way (the
 * window closing, a route change the sheet did not ask for) does not fire a
 * navigation into a tree that is gone.
 */
export function useDismiss(onClose: () => void): Dismiss {
  const [leaving, setLeaving] = useState(false)
  const cancelHold = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      cancelHold.current?.()
    },
    [],
  )

  /*
   * **The timer is armed after the commit, not in the handler — and for one
   * round it was not.**
   *
   * `dismiss()` used to call `setLeaving(true)` and `setTimeout(onClose,
   * motionMs())` in the same synchronous press handler. The transition does not
   * begin until React commits and the browser paints `.leaving`, some 40 ms
   * later, so the 150 ms timer expired **110 ms into a 150 ms fade** — and
   * `--ease-in` is back-loaded by design (mean progress 0.173), so almost all of
   * the visible change is in the part that got cut.
   *
   * Frame-sampled on the shipped sheet, three runs: last painted opacity
   * **0.438 / 0.446 / 0.408**. It snapped out from 44 % opaque, which is the
   * blink this whole family exists to remove — on the first rung of the ladder,
   * for as long as the ladder has existed.
   *
   * `useLeaving` and `useDeparture` arm in an effect, and this is now the same
   * shape; the measurement agreed: the notice ran 0.998 → **0.000 at 210 ms** and
   * detached at 225 ms. What that sentence then concluded — « both were always
   * right » — was wrong about both of them, and round 19 measured it: an effect
   * still runs a frame before the style that starts the motion resolves, which
   * cost the widget's card the last quarter of its fade. All three rungs hold
   * through `holdOneMotion` now, which carries the numbers.
   *
   * `onClose` is read through a ref so a caller passing a fresh lambda each
   * render cannot restart the timer half way through the exit — the effect
   * depends on `leaving` alone, which moves once.
   */
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    if (!leaving) return
    // `holdOneMotion`, not a bare `setTimeout`: the hold has to start when the
    // motion does and not one frame before it. The measurement is up there.
    const cancel = holdOneMotion(() => latest.current())
    cancelHold.current = cancel
    return cancel
  }, [leaving])

  const dismiss = useCallback(() => {
    // Two presses during the exit are one departure, not two navigations.
    setLeaving(true)
  }, [])

  return { leaving, dismiss }
}

/**
 * The surface's condition goes false, it wears the exit for one `--motion`,
 * then it goes — for the departures **nobody presses for**.
 *
 * The third shape on this ladder, and the three are not interchangeable:
 *
 *   · `useDismiss`   a surface the rep closes      — the gesture is intercepted
 *   · `useLeaving`   a row removed from a list     — the item is held in place
 *   · `useDeparture` a surface the *world* removes — the condition is held true
 *
 * `useDismiss` cannot serve this case because there is no gesture to intercept:
 * the end-of-meeting notice goes when the compte-rendu finishes being written,
 * which is a broadcast arriving from the main process. `useLeaving` cannot,
 * because a list of one keyed on a constant reports its departure out of
 * `previous.current`, which its effect only refreshes when the *keys* change —
 * so a strip that went `failed → running → idle` would fade out wearing the
 * sentence from two states ago. Measured on that exact path before this hook
 * existed.
 *
 * **`shown` is derived during render, not in an effect**, and that is the whole
 * of the difficulty. An effect runs after the commit, so `shown = present ||
 * leaving` computed from state would return false on the frame the condition
 * flips: the surface unmounts, the effect then sets `leaving`, and it remounts
 * wearing the exit — one frame of nothing, in the middle of the fade that
 * exists to remove exactly that. Adjusting state during render is React's own
 * escape hatch for state derived from props; it re-runs this component before
 * committing anything, and no child sees the intermediate.
 *
 * The duration is read off `--motion` by `motionMs`, never written here, for
 * the reason stated above it.
 *
 * **The previous value is a ref, and `react-doctor` flags every one of those.**
 * React's own page on this pattern stores it in state instead, which would cost
 * a second `useState` and remove the finding. Kept as a ref because the finding
 * is not a defect here and the repo already spends this idiom in five places:
 * the mutation is guarded by the comparison it feeds, so it is idempotent, and
 * under StrictMode's double invocation the first pass mutates and schedules
 * while the second sees them equal and schedules nothing. Measured rather than
 * reasoned — `useDismiss.test.tsx` runs the exit inside `<StrictMode>` and
 * asserts it fires once and for exactly one `--motion`.
 */
export interface Departure {
  /** Render the surface: true while it is present, and for one `--motion` after. */
  shown: boolean
  /** Wear `.leaving`. True only while it is on its way out. */
  leaving: boolean
}

export function useDeparture(present: boolean): Departure {
  const [state, setState] = useState<'out' | 'in' | 'leaving'>(present ? 'in' : 'out')
  const was = useRef(present)

  if (was.current !== present) {
    was.current = present
    // Back before it finished leaving: it never left, and no ghost accumulates.
    setState(present ? 'in' : 'leaving')
  }

  useEffect(() => {
    if (state !== 'leaving') return
    // Cleared when the condition comes back *and* on unmount, so a screen torn
    // down mid-exit leaves no timer writing into a tree that is gone.
    return holdOneMotion(() => setState((s) => (s === 'leaving' ? 'out' : s)))
  }, [state])

  return { shown: state !== 'out', leaving: state === 'leaving' }
}
