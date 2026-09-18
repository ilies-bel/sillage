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
import { StrictMode, useCallback, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { durationMs, useDeparture, useDismiss } from '../useDismiss.ts'
import { useLeaving } from '../useLeaving.ts'

// No global auto-cleanup in this project (`src/ui/ui.test.tsx` does the same).
afterEach(cleanup)

/**
 * **The two frames `holdOneMotion` waits for before it starts counting.**
 *
 * An effect runs a frame *before* the browser resolves the style that begins the
 * exit, so a hold armed there expires with part of the fade still to run —
 * measured at « last painted opacity 0.237 / 0.241 / 0.238 » on the widget's card
 * (`useDismiss.ts` carries the numbers and why it is two frames and not one).
 *
 * It is a named constant here and asserted rather than absorbed: every timing
 * test below advances this **first** and then the duration, and each one also
 * asserts that one bare `--motion` from the press is *not* enough. That second
 * assertion is the whole discriminator — it is what the old shape passed and
 * this one must not.
 */
const FRAMES = 32

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

    // One bare `--motion` from the press is **not** the contract, and this is the
    // line that tells the two shapes apart: the exit has not finished painting.
    act(() => void vi.advanceTimersByTime(150))
    expect(onClose).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(FRAMES - 1))
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
    act(() => void vi.advanceTimersByTime(FRAMES + 150))
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
    // Two frames and a zero-length hold: no intermediate value is ever painted,
    // which is the property — `--motion` is `0ms`, so there is nothing to wait for.
    act(() => void vi.advanceTimersByTime(FRAMES + 1))
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

    // One bare `--motion` from the flip is not the contract — the exit has not
    // finished painting yet. This is the line the old shape passed.
    act(() => void vi.advanceTimersByTime(150))
    expect(strip()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(FRAMES - 1))
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
    act(() => void vi.advanceTimersByTime(FRAMES + 1))
    expect(strip()).toBeNull()
  })
})

describe('useDeparture under StrictMode', () => {
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

  /*
   * The hook compares against a ref mutated during render, which `react-doctor`
   * reports and which React's own page on this pattern writes with state
   * instead. The mutation is guarded by the comparison it feeds, so the
   * double invocation mutates and schedules on the first pass and sees them
   * equal on the second — asserted here rather than argued in the docblock,
   * because « it is idempotent » is exactly the kind of sentence this repo has
   * been wrong about ten times.
   */
  const Wrapped = ({ label }: { label: string | null }) => (
    <StrictMode>
      <Strip label={label} />
    </StrictMode>
  )

  test('the exit fires once and lasts exactly one --motion', () => {
    const view = render(<Wrapped label="attente" />)
    expect(strip()?.className).toBe('')
    view.rerender(<Wrapped label={null} />)
    expect(strip()?.className).toBe('leaving')
    expect(strip()?.textContent).toBe('attente')
    act(() => void vi.advanceTimersByTime(150))
    expect(strip()).not.toBeNull()
    act(() => void vi.advanceTimersByTime(FRAMES + 1))
    expect(strip()).toBeNull()
  })

  test('coming back mid-exit still cancels it', () => {
    const view = render(<Wrapped label="a" />)
    view.rerender(<Wrapped label={null} />)
    view.rerender(<Wrapped label="a" />)
    expect(strip()?.className).toBe('')
    act(() => void vi.advanceTimersByTime(300))
    expect(strip()).not.toBeNull()
  })
})

/**
 * **Every rung comes back to rest, and the first one never did.**
 *
 * The three hooks are one rule about when a hold starts (`holdOneMotion`) and
 * one rule about when it ends: the exit state a departure sets is spent by that
 * departure and may not survive it. Two of the three enforce that by
 * construction — `useDeparture` moves to `out` and `useLeaving` drops the key —
 * and `useDismiss` did not. It set `leaving` true and nothing ever set it false.
 *
 * **What that cost, measured on the shipped app** (`scratch/r21-reopen.mjs`,
 * `scratch/r21-piege.mjs`, both sizes). `App.tsx` holds this hook's state one
 * component above the sheet's own mount, so the flag outlives the sheet it was
 * set for. Open Réglages, close it, open it again:
 *
 *     1re ouverture   leaving false   opacity 1.000   veil 1.000
 *     2e ouverture    leaving true    opacity 0.000   veil 0.000
 *
 * A `role="dialog"` at zero opacity, still translated by its exit
 * (`matrix(1, 0, 0, 1, 0, 3)`) and still `pointer-events: auto`, over the whole
 * screen. The rep asked for Réglages and got nothing; `elementFromPoint` at the
 * centre of the window lands **inside** the dialog, so every press on the
 * calendar behind it goes to a settings row nobody can see. And there is no way
 * out: `dismiss()` sets a flag that is already set, so the effect keyed on it
 * does not re-run — `Échap` and the ✕ were both driven, four presses, and the
 * sheet is still there. Quitting the app is the only exit. Réglages is where
 * the transcription model, the language model and the CRM credentials live, so
 * the second visit is the ordinary one.
 *
 * **Nothing could see it, and one stage opened the sheet twice.**
 * `reglages-sortie` closes with `Échap`, reopens, and closes again with the ✕ —
 * on the reopened, already-`leaving`, already-transparent sheet. Its four
 * assertions are « opacity < 1 » (0 passes), « every curve is `--ease-in` »
 * (the rule is on the element, so it passes), « every duration is 0.15s »
 * (same), and « the tracer saw at least 3 frames » (three frames of 0.000
 * passes). Its veil assertion fires only when the veil is at zero *while the
 * sheet is above 0.2*, which a sheet at 0.000 never is. Driven at HEAD with
 * `--motion --fade` at both smoke sizes: « ✓ reglages-sortie 1280×800 … 85
 * élément(s) animé(s) dont 2 qui s'en vont, tous par les jetons, dans le bon
 * sens », and the same at 960×600. Every assertion on that stage is satisfied
 * by the defect it exists to stop, and the frame it photographs is the
 * invisible sheet.
 *
 * So the check is written here, at the width of the rule: the three rungs
 * together, each made to leave, brought back, and made to leave again. A
 * fixture that drives one hook cannot express « every rung returns to rest » —
 * which is the shape round 19 shipped when it fixed one rung and concluded the
 * family was right.
 */
const KEY = () => 'r'
const ONE = [{ id: 'r' }]
const NONE: { id: string }[] = []

/** `useDismiss`, wired the way `App.tsx` wires it: the hook above the mount. */
function DismissRung() {
  const [open, setOpen] = useState(true)
  const { leaving, dismiss } = useDismiss(useCallback(() => setOpen(false), []))
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      {open ? <p data-testid="rung" className={leaving ? 'leaving' : ''} /> : null}
      <button type="button" onClick={dismiss}>
        Fermer
      </button>
    </>
  )
}

/** `useDeparture`, wired the way `EnhancementNotice` and `Review` wire it. */
function DepartureRung() {
  const [present, setPresent] = useState(true)
  const { shown, leaving } = useDeparture(present)
  return (
    <>
      <button type="button" onClick={() => setPresent(true)}>
        Ouvrir
      </button>
      {shown ? <p data-testid="rung" className={leaving ? 'leaving' : ''} /> : null}
      <button type="button" onClick={() => setPresent(false)}>
        Fermer
      </button>
    </>
  )
}

/** `useLeaving`, wired the way `DayPane` wires it: a row dropping out of a list. */
function LeavingRung() {
  const [present, setPresent] = useState(true)
  const rows = useLeaving(present ? ONE : NONE, KEY)
  return (
    <>
      <button type="button" onClick={() => setPresent(true)}>
        Ouvrir
      </button>
      {rows.map((row) => (
        <p key={row.id} data-testid="rung" className={row.leaving ? 'leaving' : ''} />
      ))}
      <button type="button" onClick={() => setPresent(false)}>
        Fermer
      </button>
    </>
  )
}

const RUNGS: [string, () => ReactElement][] = [
  ['useDismiss', DismissRung],
  ['useDeparture', DepartureRung],
  ['useLeaving', LeavingRung],
]

describe.each(RUNGS)('the exit does not outlive the departure it was set for (%s)', (_name, Rung) => {
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

  const rung = () => screen.queryByTestId('rung')
  const press = (name: string) => act(() => screen.getByRole('button', { name }).click())
  const oneMotion = () => act(() => void vi.advanceTimersByTime(FRAMES + 150))

  test('it comes back at rest, and it can leave a second time', () => {
    render(<Rung />)
    expect(rung()?.className).toBe('')

    press('Fermer')
    expect(rung()?.className).toBe('leaving')
    oneMotion()
    expect(rung()).toBeNull()

    // The whole assertion: what the rep sees on the *second* visit.
    press('Ouvrir')
    expect(rung()).not.toBeNull()
    expect(rung()?.className).toBe('')

    // And the way out still works, which is the half that traps them.
    press('Fermer')
    expect(rung()?.className).toBe('leaving')
    oneMotion()
    expect(rung()).toBeNull()
  })
})
