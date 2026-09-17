import { useEffect, useRef, useState } from 'react'
import { holdOneMotion } from './useDismiss.ts'

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
  /** Key → the canceller `holdOneMotion` handed back for that row's exit. */
  const timers = useRef(new Map<string, () => void>())
  /** Where a row sat in the list it was removed from, so it can leave from there. */
  const departedAt = useRef(new Map<string, number>())

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
    for (const item of gone) departedAt.current.set(keyOf(item), previous.current.indexOf(item))
    previous.current = items

    // Back before it finished leaving: stop the timer and let the live one render.
    for (const key of live) {
      const cancel = timers.current.get(key)
      if (cancel === undefined) continue
      cancel()
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
    /*
     * `holdOneMotion` and not a `setTimeout` armed here: a hold armed in an
     * effect starts a frame *before* the style that begins the exit resolves, so
     * it expires with that frame of the fade still to run — and `--ease-in` puts
     * almost all of its change at the end. The numbers are in `useDismiss.ts`.
     * The duration is still read off `--motion` and never written, one level in.
     */
    for (const item of gone) {
      const key = keyOf(item)
      timers.current.get(key)?.()
      timers.current.set(
        key,
        holdOneMotion(() => {
          timers.current.delete(key)
          departedAt.current.delete(key)
          setLeaving((was) => {
            const next = was.filter((other) => keyOf(other) !== key)
            return next.length === was.length ? was : next
          })
        }),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `signature`
  }, [signature, keyOf])

  // Cleared on unmount, so a pane closed mid-exit leaves no timer behind.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const cancel of map.values()) cancel()
      map.clear()
    }
  }, [])

  if (leaving.length === 0) return items
  /*
   * **Spliced back where it was, not appended** — the docblock above says « in
   * their old position » and the first draft did not do it. Two reviewers found
   * the same thing by reading: `[...items, ...leaving]` puts a withdrawn row at
   * the *bottom* of the day, so on the one stage this hook was written for the
   * 14:29 offer jumps past the 14:30 meeting still ahead of the rep and then
   * fades. A worse frame than none.
   *
   * Nothing could see it. `useLeaving.test.tsx` removed the *last* of two rows —
   * the one position where appending and holding are the same array — and
   * `--motion` reads a resting frame, where `.leaving` is on nothing. The test
   * below now removes a middle row, which is the case that tells them apart.
   *
   * The index is the one the item had in the previous list, so a row leaves from
   * the line it occupied and the rows under it close up afterwards rather than
   * during.
   */
  const out: (T & { leaving?: boolean })[] = [...items]
  for (const item of leaving) {
    const at = departedAt.current.get(keyOf(item))
    out.splice(at === undefined || at > out.length ? out.length : at, 0, { ...item, leaving: true })
  }
  return out
}
