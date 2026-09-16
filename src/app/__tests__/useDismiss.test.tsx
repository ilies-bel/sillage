/**
 * **The exit, which the product did not have.**
 *
 * `shot.mjs --motion` reported « 0 qui s'en vont, 0 @keyframes de sortie » on
 * all eight app screens: one element in the repo had an exit and it was the
 * widget, in the other window. The cause was mechanical — React unmounts on the
 * frame the condition flips, so there is nothing left to transition — and
 * `useDismiss` is what holds a surface for one `--motion` so `.leaving` can run.
 *
 * `reglages-sortie` is the other half of this and the more important one: it
 * drives the shipped sheet and asserts the *curve* and the *duration* that
 * reach a real element, which no unit test can see. These four cover what that
 * stage cannot — the timing contract itself, and the three ways it can be asked
 * to do something twice.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { durationMs, useDeparture, useDismiss } from '../useDismiss.ts'

// No global auto-cleanup in this project (`src/ui/ui.test.tsx` does the same).
afterEach(cleanup)

describe('durationMs reads a CSS duration', () => {
  test.each([
    ['150ms', 150],
    ['0.15s', 150],
    ['0ms', 0],
    ['  150ms  ', 150],
    ['', 0],
    ['inherit', 0],
  ])('%s → %i', (value, expected) => {
    expect(durationMs(value)).toBe(expected)
  })
})

function Sheet({ onClose }: { onClose: () => void }) {
  const { leaving, dismiss } = useDismiss(onClose)
  return (
    <button type="button" className={leaving ? 'leaving' : ''} onClick={dismiss}>
      Fermer
    </button>
  )
}

describe('useDismiss holds the surface for one --motion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom resolves no custom properties, so `--motion` reads as ''. Stubbed to
    // the shipped 150ms so the timing below is the product's and not jsdom's.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '150ms',
    } as unknown as CSSStyleDeclaration)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('the class lands first and the close comes one duration later', () => {
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    const button = screen.getByRole('button')

    act(() => button.click())
    // The whole point: the surface is still here, wearing the exit.
    expect(button.className).toContain('leaving')
    expect(onClose).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(149))
    expect(onClose).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('two presses during the exit are one departure', () => {
    // A rep who clicks the ✕ twice, or the ✕ and then the veil, has left once.
    // Without the guard the second press starts a second timer and `onClose`
    // fires twice — which on a route pop is a double navigation.
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    const button = screen.getByRole('button')

    act(() => button.click())
    act(() => button.click())
    act(() => void vi.advanceTimersByTime(150))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('a surface torn down mid-exit does not navigate afterwards', () => {
    // The window closing, or a route change the sheet did not ask for. Firing
    // `onClose` into an unmounted tree is the classic leak this guards.
    const onClose = vi.fn()
    const view = render(<Sheet onClose={onClose} />)
    act(() => screen.getByRole('button').click())
    view.unmount()
    act(() => void vi.advanceTimersByTime(500))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('prefers-reduced-motion needs no branch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('a 0ms --motion closes on the next tick with no held frame', () => {
    /*
     * `tokens.css` sets `--motion: 0ms` under `prefers-reduced-motion`, so the
     * read returns 0 and the surface leaves without an intermediate frame. The
     * collapse comes from the token, not from a second code path here — which
     * is the same argument every other rung on the ladder makes.
     */
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0ms',
    } as unknown as CSSStyleDeclaration)
    const onClose = vi.fn()
    render(<Sheet onClose={onClose} />)
    act(() => screen.getByRole('button').click())
    expect(onClose).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(0))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * **The third shape: a surface the world removes, not the rep.**
 *
 * `useDismiss` above intercepts a gesture and `useLeaving` holds a row in a
 * list. The end-of-meeting notice is neither — `idle` arrives on a broadcast
 * when the compte-rendu finishes being written — and it is the strip two
 * reviewers named as the departure the product still had no frame for.
 *
 * The first two tests are the pair that matter. *No lost frame* is the whole
 * reason `shown` is derived during render rather than in an effect: computed
 * from state, the surface would unmount on the frame the condition flips and
 * remount wearing the exit, one blank frame inside the fade that exists to
 * remove it. *What leaves* is the reason the caller holds its own payload; the
 * pin in `useLeaving.test.tsx` shows what the economical version does instead.
 */
function Strip({ label }: { label: string | null }) {
  const { shown, leaving } = useDeparture(label !== null)
  const drawn = useRef(label)
  if (label !== null) drawn.current = label
  if (!shown) return null
  return (
    <p role="status" className={leaving ? 'leaving' : ''}>
      {drawn.current}
    </p>
  )
}

const strip = () => screen.queryByRole('status')

describe('a surface the world removes leaves instead of vanishing', () => {
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

  test('held for one --motion, wearing the exit, with no lost frame', () => {
    const view = render(<Strip label="attente" />)
    expect(strip()?.className).toBe('')

    view.rerender(<Strip label={null} />)
    // The frame the condition flips: still mounted, already marked. An effect
    // could not do this — it runs after the commit that unmounted the element.
    expect(strip()).not.toBeNull()
    expect(strip()?.className).toBe('leaving')

    act(() => void vi.advanceTimersByTime(149))
    expect(strip()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(strip()).toBeNull()
  })

  test('it leaves wearing the sentence it had, not the one that removed it', () => {
    const view = render(<Strip label="échec" />)
    view.rerender(<Strip label="rédaction" />)
    view.rerender(<Strip label={null} />)
    expect(strip()?.textContent).toBe('rédaction')
  })

  test('back before it finished leaving: it never left', () => {
    const view = render(<Strip label="a" />)
    view.rerender(<Strip label={null} />)
    expect(strip()?.className).toBe('leaving')
    view.rerender(<Strip label="a" />)
    expect(strip()?.className).toBe('')
    act(() => void vi.advanceTimersByTime(300))
    expect(strip()).not.toBeNull()
  })

  test('a screen torn down mid-exit leaves no timer behind', () => {
    const view = render(<Strip label="a" />)
    view.rerender(<Strip label={null} />)
    view.unmount()
    expect(() => act(() => void vi.advanceTimersByTime(500))).not.toThrow()
  })

  test('absent from the start draws nothing and schedules nothing', () => {
    render(<Strip label={null} />)
    expect(strip()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useDeparture under prefers-reduced-motion', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('a 0ms --motion drops it on the next tick with no held frame', () => {
    // `tokens.css` sets `--motion: 0ms` there, so the collapse comes from the
    // token and not from a second code path here.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0ms',
    } as unknown as CSSStyleDeclaration)
    const view = render(<Strip label="a" />)
    view.rerender(<Strip label={null} />)
    act(() => void vi.advanceTimersByTime(0))
    expect(strip()).toBeNull()
  })
})
