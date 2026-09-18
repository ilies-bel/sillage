/**
 * **The other half of « ease-out on the way in, ease-in on the way out ».**
 *
 * `--motion` has reported « 0 qui s'en vont » on every app screen for six
 * rounds, and the instance two reviewers kept naming is a list removal: React
 * unmounts on the frame the item leaves the array, so there is nothing left to
 * transition. These four cover the timing contract and the three ways a list can
 * ask for something awkward.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useLeaving } from '../useLeaving.ts'

afterEach(cleanup)

interface Row {
  key: string
}
const keyOf = (row: Row) => row.key

function List({ items }: { items: readonly Row[] }) {
  const shown = useLeaving(items, keyOf)
  return (
    <ul>
      {shown.map((row) => (
        <li key={row.key} data-leaving={row.leaving ? 'true' : undefined}>
          {row.key}
        </li>
      ))}
    </ul>
  )
}

/**
 * Two frames, which is what `holdOneMotion` waits for before it starts counting:
 * an effect runs a frame before the style that begins the exit resolves, so a
 * hold armed there expires with a quarter of the fade still to run.
 * `useDismiss.ts` carries the measurement.
 */
const FRAMES = 32

const keys = () => screen.getAllByRole('listitem').map((el) => el.textContent)
const leaving = () =>
  screen.queryAllByRole('listitem').filter((el) => el.dataset.leaving === 'true').map((el) => el.textContent)

describe('a removed row leaves instead of vanishing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom resolves no custom properties, so `--motion` reads ''. Stubbed to
    // the shipped 150ms so the timing below is the product's, not jsdom's.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '150ms',
    } as unknown as CSSStyleDeclaration)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('it is held for one --motion, wearing the exit, then dropped', () => {
    const view = render(<List items={[{ key: 'a' }, { key: 'b' }]} />)
    view.rerender(<List items={[{ key: 'a' }]} />)

    // The whole point: still on screen, and marked.
    expect(keys()).toEqual(['a', 'b'])
    expect(leaving()).toEqual(['b'])

    // One bare `--motion` from the removal is not the contract — the row has not
    // finished painting its exit. This is the line the old shape passed.
    act(() => void vi.advanceTimersByTime(150))
    expect(keys()).toEqual(['a', 'b'])

    act(() => void vi.advanceTimersByTime(FRAMES - 1))
    expect(keys()).toEqual(['a', 'b'])

    act(() => void vi.advanceTimersByTime(1))
    expect(keys()).toEqual(['a'])
  })

  test('it leaves from the line it occupied, not from the bottom', () => {
    /*
     * The case the first version of this test could not see: it removed the
     * *last* of two rows, which is the one position where appending a leaver and
     * holding it in place produce the same array. Two reviewers found the
     * append by reading the code. On the agenda it meant a withdrawn offer
     * jumped past every meeting still ahead of the rep and then faded.
     */
    const view = render(<List items={[{ key: 'a' }, { key: 'b' }, { key: 'c' }]} />)
    view.rerender(<List items={[{ key: 'a' }, { key: 'c' }]} />)

    expect(keys()).toEqual(['a', 'b', 'c'])
    expect(leaving()).toEqual(['b'])

    act(() => void vi.advanceTimersByTime(FRAMES + 150))
    expect(keys()).toEqual(['a', 'c'])
  })

  test('a row that comes back mid-exit stops leaving and does not double', () => {
    // A list that flickers — an offer withdrawn and re-made inside 150ms — must
    // not end up with a ghost beside the live row.
    const view = render(<List items={[{ key: 'a' }]} />)
    view.rerender(<List items={[]} />)
    expect(leaving()).toEqual(['a'])

    view.rerender(<List items={[{ key: 'a' }]} />)
    expect(keys()).toEqual(['a'])
    expect(leaving()).toEqual([])

    act(() => void vi.advanceTimersByTime(300))
    expect(keys()).toEqual(['a'])
  })

  test('a pane closed mid-exit leaves no timer behind', () => {
    const view = render(<List items={[{ key: 'a' }]} />)
    view.rerender(<List items={[]} />)
    view.unmount()
    // The classic leak: a timer setting state into an unmounted tree.
    expect(() => act(() => void vi.advanceTimersByTime(500))).not.toThrow()
  })
})

describe('prefers-reduced-motion needs no branch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('a 0ms --motion drops the row on the next tick with no held frame', () => {
    /*
     * `tokens.css` sets `--motion: 0ms` under `prefers-reduced-motion`, so the
     * collapse comes from the token and not from a second code path here.
     */
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0ms',
    } as unknown as CSSStyleDeclaration)
    const view = render(<List items={[{ key: 'a' }]} />)
    view.rerender(<List items={[]} />)
    act(() => void vi.advanceTimersByTime(FRAMES + 1))
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

/** Declared once, the way this hook's own callers are told to declare it. */
const NOTICE_KEY = () => 'notice'

describe('a list of one cannot serve a condition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '150ms',
    } as unknown as CSSStyleDeclaration)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * **The measurement that bought a third hook.**
   *
   * The end-of-meeting notice is one surface whose presence is a condition, and
   * the obvious economy is to spend this hook on it: a list of nought or one
   * rows, keyed on a constant so a change of status is the same row rather than
   * a departure beside an arrival. It does not work, and the reason is in the
   * effect rather than in the caller.
   *
   * `previous.current` is refreshed inside the block guarded by `signature` —
   * the keys, joined. (It was an effect keyed on the same value until the
   * render-phase fix below; the guard moved, the value did not, and so neither
   * did this.) With a constant key the signature never moves while the row is
   * present, so the block never runs and `previous` still holds the payload the
   * row was mounted with. When the condition finally goes false the departure is
   * reported out of that stale snapshot.
   *
   * On the notice that is the path `failed → running → idle`: the strip would
   * fade out saying « n'a pas pu être rédigé » at the moment the compte-rendu it
   * says failed appears underneath it. Passing an inline lambda instead only
   * trades the defect for the one `DayPane` names — an effect on every render of
   * a live list.
   *
   * `useDeparture` holds the *condition* rather than the row, and the caller
   * keeps its own last-drawn payload. Pinned here rather than argued in a
   * comment, because the next person to see two hooks where one would do will
   * try exactly this.
   */
  test('keyed on a constant, it leaves wearing a stale payload', () => {
    const Notice = ({ items }: { items: readonly Row[] }) => {
      const shown = useLeaving(items, NOTICE_KEY)
      return (
        <ul>
          {shown.map((row) => (
            <li key="notice" data-leaving={row.leaving ? 'true' : undefined}>
              {row.key}
            </li>
          ))}
        </ul>
      )
    }

    const view = render(<Notice items={[{ key: 'échec' }]} />)
    // The payload changes while the key does not, so the effect does not run.
    view.rerender(<Notice items={[{ key: 'rédaction' }]} />)
    expect(keys()).toEqual(['rédaction'])

    // Now it goes — reported out of `previous.current`, two states behind.
    view.rerender(<Notice items={[]} />)
    expect(leaving()).toEqual(['échec'])
  })
})

/**
 * **The held row has to be the row that was there — and it was a new element.**
 *
 * A CSS transition interpolates from the last value the browser *painted* on
 * that element. A node created already wearing `.leaving` has never been
 * painted, so there is nothing to interpolate from: it appears at the end of
 * the fade and sits there. Which is what shipped.
 *
 * Frame-sampled on the agenda, a `MutationObserver` catching the node at birth
 * and a rAF loop on every frame it is alive (`scratch/x-birth.mjs`), the two
 * rows the clock jump removes, both smoke sizes, at 1280×800 and 960×600:
 *
 *     avant   NOUVEL élément, 11 images, **0 entre les deux**,
 *               1re opacité 0.000, dernière 0.000, détachée à 246 / 257 ms
 *     après   même élément,   11 images, **5 entre les deux**,
 *               1re opacité 0.998 / 0.995, dernière 0.000, détachée à 243 / 239 ms
 *
 * Eleven painted frames before, and not one of them between the two ends. The
 * rep saw the row blink out and then a hole where it was for a quarter of a
 * second before the list closed up — a worse frame than no exit at all,
 * produced by the hook written to remove exactly that, on the one row
 * `useLeaving` exists for.
 *
 * **The cause is the one `useDeparture`'s docblock already names.** This hook
 * computed its departures in an **effect**, which runs *after* the commit that
 * already dropped the row from the array — so React removed the `<li>`, the
 * effect then called `setLeaving`, and a second commit put a **different**
 * element back wearing the exit. `useDeparture` derives `shown` during render
 * for precisely this reason and says so in `useDismiss.ts`; this hook, the
 * older of the two, never got the same treatment.
 *
 * Node identity is the assertion because it is the property, and it is the one
 * thing jsdom can see here: jsdom paints nothing, so no unit test can measure
 * the opacity above — but it does reconcile, and a re-created row is a
 * re-created row in both engines.
 */
describe('the row that leaves is the row that was there', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '150ms',
    } as unknown as CSSStyleDeclaration)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('the same element is held, so the exit has a value to fade from', () => {
    const view = render(<List items={[{ key: 'a' }, { key: 'b' }, { key: 'c' }]} />)
    const before = screen.getAllByRole('listitem').find((el) => el.textContent === 'b')
    expect(before).toBeDefined()

    view.rerender(<List items={[{ key: 'a' }, { key: 'c' }]} />)
    const held = screen.getAllByRole('listitem').find((el) => el.textContent === 'b')
    expect(held?.dataset.leaving).toBe('true')
    // Not `toEqual`: the assertion is that React never dropped the node, which
    // is what leaves a painted frame for the transition to start from.
    expect(held).toBe(before)

    act(() => void vi.advanceTimersByTime(FRAMES + 150))
    expect(keys()).toEqual(['a', 'c'])
  })

  test('a row that comes back mid-exit is still the same element', () => {
    const view = render(<List items={[{ key: 'a' }, { key: 'b' }]} />)
    const before = screen.getAllByRole('listitem').find((el) => el.textContent === 'b')
    view.rerender(<List items={[{ key: 'a' }]} />)
    view.rerender(<List items={[{ key: 'a' }, { key: 'b' }]} />)
    const back = screen.getAllByRole('listitem').find((el) => el.textContent === 'b')
    expect(back).toBe(before)
    expect(back?.dataset.leaving).toBeUndefined()
  })
})

/**
 * **The two properties the render-phase shape had to keep, asserted rather than
 * argued.**
 *
 * Deriving the departed set during render is what gives the exit an element to
 * fade from. It also moves two things that used to be incidental, and both of
 * them can be traded away without a single existing test noticing.
 *
 * *The clock.* The old effect cancelled a row's hold and armed a new one every
 * time the keys moved. The new shape arms **one hold per key and never a
 * second**, so that a neighbour departing beside a row cannot restart its fade
 * — which makes the cancellation load-bearing rather than tidy. Drop the cancel
 * loop and the third test below reports the row gone 82 ms into its second
 * exit, on the clock the *first* one started.
 *
 * `a row that comes back mid-exit stops leaving and does not double` cannot see
 * that: an uncancelled hold whose key is no longer in `leaving` runs
 * `was.filter(…)`, changes nothing, returns `was`, and paints nothing. The
 * damage only becomes visible when the same row leaves a second time inside the
 * window.
 *
 * *The double invocation.* Adjusting state during render is React's own escape
 * hatch for state derived from props, and StrictMode invokes the render twice
 * in development. The guard is the comparison it feeds — the first pass moves
 * `seen`, mutates `previous`/`departedAt` and schedules; the second sees them
 * equal and does nothing. `useDeparture` makes exactly this argument and pins it
 * with a test; this hook made the argument in a docblock and pinned nothing.
 */
const Wrapped = ({ items }: { items: readonly Row[] }) => (
  <StrictMode>
    <List items={items} />
  </StrictMode>
)

describe('the render-phase departure holds under a second invocation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '150ms',
    } as unknown as CSSStyleDeclaration)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('one held row, in its old position, for exactly one --motion', () => {
    const view = render(<Wrapped items={[{ key: 'a' }, { key: 'b' }, { key: 'c' }]} />)
    view.rerender(<Wrapped items={[{ key: 'a' }, { key: 'c' }]} />)

    // Not two ghosts: the second pass must schedule nothing.
    expect(keys()).toEqual(['a', 'b', 'c'])
    expect(leaving()).toEqual(['b'])

    // And one hold, not two stacked: still there at one bare `--motion`.
    act(() => void vi.advanceTimersByTime(150))
    expect(keys()).toEqual(['a', 'b', 'c'])
    act(() => void vi.advanceTimersByTime(FRAMES))
    expect(keys()).toEqual(['a', 'c'])
  })

  test('the departed set is derived, not accumulated, over repeated renders', () => {
    // The same list, rendered again and again: nothing has gone, so nothing may
    // start leaving — the failure mode of a guard that moves on every render.
    const view = render(<Wrapped items={[{ key: 'a' }, { key: 'b' }]} />)
    for (let i = 0; i < 4; i += 1) view.rerender(<Wrapped items={[{ key: 'a' }, { key: 'b' }]} />)
    expect(keys()).toEqual(['a', 'b'])
    expect(leaving()).toEqual([])
    act(() => void vi.advanceTimersByTime(FRAMES + 150))
    expect(keys()).toEqual(['a', 'b'])
  })

  test('a second departure gets a second clock, not the first one’s remainder', () => {
    const view = render(<Wrapped items={[{ key: 'a' }]} />)
    view.rerender(<Wrapped items={[]} />)
    expect(leaving()).toEqual(['a'])

    // 100 ms into a hold that expires at FRAMES + 150 = 182 ms.
    act(() => void vi.advanceTimersByTime(100))
    view.rerender(<Wrapped items={[{ key: 'a' }]} />)
    expect(leaving()).toEqual([])
    view.rerender(<Wrapped items={[]} />)
    expect(leaving()).toEqual(['a'])

    /*
     * The first clock expires 82 ms from here — `FRAMES + 150` measured from the
     * *first* departure — so 120 ms is past it and the row must still be here.
     *
     * Bounded rather than exact on purpose: the fake clock lays `rAF` on a fixed
     * 16 ms grid from time zero rather than from now, so the second hold lands
     * on 278 ms or 282 ms depending on where the departure fell on that grid. An
     * assertion pinned to one of those would be a test that reads the fixture's
     * arithmetic instead of the product's rule.
     */
    act(() => void vi.advanceTimersByTime(120))
    expect(keys()).toEqual(['a'])
    expect(leaving()).toEqual(['a'])

    act(() => void vi.advanceTimersByTime(200))
    // `queryAllByRole`: the list is empty here and `getAllByRole` throws on none.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
