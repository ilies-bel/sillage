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

    act(() => void vi.advanceTimersByTime(149))
    expect(keys()).toEqual(['a', 'b'])

    act(() => void vi.advanceTimersByTime(1))
    expect(keys()).toEqual(['a'])
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
    act(() => void vi.advanceTimersByTime(0))
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
