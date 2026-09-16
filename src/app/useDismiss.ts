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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const dismiss = useCallback(() => {
    // Two presses during the exit are one departure, not two navigations.
    if (timer.current !== null) return
    setLeaving(true)
    timer.current = setTimeout(onClose, motionMs())
  }, [onClose])

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
    const timer = setTimeout(() => setState((s) => (s === 'leaving' ? 'out' : s)), motionMs())
    // Cleared when the condition comes back *and* on unmount, so a screen torn
    // down mid-exit leaves no timer writing into a tree that is gone.
    return () => clearTimeout(timer)
  }, [state])

  return { shown: state !== 'out', leaving: state === 'leaving' }
}
