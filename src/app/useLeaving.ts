import { useEffect, useRef, useState } from 'react'
import { durationMs } from './useDismiss.ts'

/**
 * **A list whose removals are watched, so they can leave instead of vanishing.**
 *
 * React unmounts on the frame the item stops being in the array, so there is
 * nothing left to transition — the same mechanical reason `useDismiss` exists
 * for a surface. `--motion` has reported « 0 qui s'en vont, 0 @keyframes de
 * sortie » on every app screen for six consecutive rounds, and the instance two
 * separate reviewers keep naming is this one: the agenda's offered row arrives
 * over 150 ms of `animate-rise-in` and is removed between two frames when
 * `#withdrawAdHoc` fires. The product's own rule is « ease-out on the way in,
 * ease-in on the way out » (VISION §6) and only half of it was built.
 *
 * It matters most on exactly that row, because the row is not decoration: it is
 * the screen's one filled *Enregistrer*. A control that big disappearing with no
 * frame in between reads as a misclick — the rep looks for what they just did,
 * and the product has already forgotten it.
 *
 * Removed items are kept in place, in their old position, wearing `leaving` for
 * one `--motion`, and then dropped. An item that comes back inside that window
 * simply stops leaving, so a list that flickers does not accumulate ghosts.
 *
 * `--motion` collapses to `0ms` under `prefers-reduced-motion` (`tokens.css`),
 * and `durationMs` reads it off the document — so the hold is skipped there by
 * the token rather than by a second code path, which is the argument every other
 * rung on this ladder makes.
 */
export function useLeaving<T extends object>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly (T & { leaving?: boolean })[] {
  const [leaving, setLeaving] = useState<readonly T[]>([])
  const previous = useRef<readonly T[]>(items)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  /*
   * **Keyed on the keys, not on the array** — and the first draft was not, which
   * is worth keeping because of how it failed. `items` is rebuilt every render,
   * so an effect depending on it runs every render; inside, it called
   * `setLeaving(was => was.filter(…))`, and `filter` returns a new array even
   * when it removes nothing. New state identity every render, so every render
   * scheduled another: an infinite loop that took the renderer suite to
   * « JavaScript heap out of memory », killed 57 tests — and still exited 0, so
   * `npm test` reported green over a fifth of the suite that never ran.
   *
   * Two rules come out of it and both are applied below: the dependency is a
   * value that only changes when the list does, and no setter is called unless
   * the state it writes actually differs.
   */
  const signature = items.map(keyOf).join('\u0000')

  useEffect(() => {
    const live = new Set(items.map(keyOf))
    const gone = previous.current.filter((item) => !live.has(keyOf(item)))
    previous.current = items

    // Back before it finished leaving: stop the timer and let the live one render.
    for (const key of live) {
      const timer = timers.current.get(key)
      if (timer === undefined) continue
      clearTimeout(timer)
      timers.current.delete(key)
    }

    setLeaving((was) => {
      const kept = was.filter((item) => !live.has(keyOf(item)))
      const added = gone.filter((item) => !kept.some((other) => keyOf(other) === keyOf(item)))
      // Same contents means same state: returning `was` is what stops the loop.
      if (added.length === 0 && kept.length === was.length) return was
      return [...kept, ...added]
    })

    if (gone.length === 0) return
    const hold = durationMs(getComputedStyle(document.documentElement).getPropertyValue('--motion'))
    for (const item of gone) {
      const key = keyOf(item)
      const running = timers.current.get(key)
      if (running !== undefined) clearTimeout(running)
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          setLeaving((was) => {
            const next = was.filter((other) => keyOf(other) !== key)
            return next.length === was.length ? was : next
          })
        }, hold),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `signature`
  }, [signature, keyOf])

  // Cleared on unmount, so a pane closed mid-exit leaves no timer behind.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
    }
  }, [])

  if (leaving.length === 0) return items
  return [...items, ...leaving.map((item) => ({ ...item, leaving: true }))]
}
