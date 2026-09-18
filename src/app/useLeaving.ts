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
  const seen = useRef(signature)

  /*
   * **Which rows have gone is decided during render, and for as long as this
   * hook existed it was decided in an effect.**
   *
   * An effect runs *after* the commit. So on the frame the row left the array,
   * React had already taken its `<li>` out of the document; the effect then
   * called `setLeaving` and a second commit put a **different** element back,
   * created already wearing `.leaving`. A CSS transition interpolates from the
   * last value the browser painted on that element, and a node that has never
   * been painted has none — so the exit did not run at all.
   *
   * Frame-sampled on the agenda, the node caught at birth by a
   * `MutationObserver` and every frame it is alive read off `getComputedStyle`
   * (`scratch/x-birth.mjs`), the two rows the clock jump removes, both smoke
   * sizes. Before, at 1280×800 and 960×600:
   *
   *     NOUVEL élément, 11 images, **0 entre les deux**,
   *       1re opacité 0.000, dernière 0.000, détachée à 246 / 257 ms
   *
   * Eleven painted frames and not one of them between the two ends: the row
   * blinked out and left a hole open for a quarter of a second — a worse frame
   * than no exit, produced by the hook whose whole purpose is to remove that
   * frame, on the one row it was written for. After:
   *
   *     même élément, 11 images, **5 entre les deux**,
   *       1re opacité 0.998 / 0.995, dernière 0.000, détachée à 243 / 239 ms
   *
   * and under `prefers-reduced-motion`, 2–3 images, 0 entre les deux, detached
   * at 87–106 ms — the collapse comes from the `0ms` token, not from a branch.
   *
   * `useDeparture` already derives its `shown` during render and
   * `useDismiss.ts` states this exact reason for it — « the surface unmounts,
   * the effect then sets `leaving`, and it remounts wearing the exit ». This
   * hook is the older of the two and never got the same treatment. Adjusting
   * state during render is React's own escape hatch for state derived from
   * props: it re-runs this component before committing anything, so the row is
   * never removed from the document and the class lands on the element the rep
   * has been looking at.
   *
   * The guard is the comparison it feeds, so it is idempotent under StrictMode's
   * double invocation — the first pass mutates and schedules, the second sees
   * them equal and schedules nothing. That is the same argument `useDeparture`
   * makes, and it is **asserted rather than argued**: `useLeaving.test.tsx`
   * drives the whole hook inside `<StrictMode>` and pins node identity, one held
   * row in its old position, and exactly one `--motion`. Driven with the guard
   * removed, all eleven tests in that file fail on a render loop; driven with it
   * weakened to an array-identity comparison, the stale-payload test that buys
   * `useDeparture` its existence fails. The guard is load-bearing both ways.
   */
  if (seen.current !== signature) {
    seen.current = signature
    const live = new Set(items.map(keyOf))
    const gone = previous.current.filter((item) => !live.has(keyOf(item)))
    for (const item of gone) departedAt.current.set(keyOf(item), previous.current.indexOf(item))
    previous.current = items
    setLeaving((was) => {
      const kept = was.filter((item) => !live.has(keyOf(item)))
      const added = gone.filter((item) => !kept.some((other) => keyOf(other) === keyOf(item)))
      // Same contents means same state: returning `was` is what stops the loop.
      if (added.length === 0 && kept.length === was.length) return was
      return [...kept, ...added]
    })
  }

  /**
   * The held rows, as a value that changes only when the *set* of them does —
   * `leaving` is rebuilt on every departure, so an effect depending on the array
   * would re-arm every hold each time any row moved.
   */
  const heldSignature = leaving.map(keyOf).join('\u0000')

  useEffect(() => {
    const held = new Set(leaving.map(keyOf))

    // Back before it finished leaving: stop the timer and let the live one render.
    for (const [key, cancel] of Array.from(timers.current)) {
      if (held.has(key)) continue
      cancel()
      timers.current.delete(key)
    }

    /*
     * `holdOneMotion` and not a `setTimeout` armed here: a hold armed in an
     * effect starts a frame *before* the style that begins the exit resolves, so
     * it expires with that frame of the fade still to run — and `--ease-in` puts
     * almost all of its change at the end. The numbers are in `useDismiss.ts`.
     * The duration is still read off `--motion` and never written, one level in.
     *
     * One hold per key and never a second: a row already on its way out keeps
     * the clock it started with, so a neighbour departing beside it cannot
     * restart its fade.
     */
    for (const key of held) {
      if (timers.current.has(key)) continue
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `heldSignature`
  }, [heldSignature, keyOf])

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
