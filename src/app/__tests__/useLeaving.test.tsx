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
   * `previous.current` is refreshed *inside* the effect, and the effect is keyed
   * on `signature` — the keys, joined — plus `keyOf`. With a constant key the
   * signature never moves while the row is present, and `DayPane` already
   * carries the instruction that makes `keyOf` stable too (« a new lambda each
   * render would re-fire `useLeaving`'s effect »). Both deps held, the effect
   * never runs, and `previous` still holds the payload the row was mounted
   * with. When the condition finally goes false the departure is reported out of
   * that stale snapshot.
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
