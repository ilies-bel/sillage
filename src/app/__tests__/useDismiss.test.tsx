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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { durationMs, useDismiss } from '../useDismiss.ts'

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
