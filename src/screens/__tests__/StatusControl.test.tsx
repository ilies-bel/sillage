/**
 * DEC-32 at the surface it is actually read from.
 *
 * The pure half — which subsystems are allowed to move the aggregate — is
 * settled and tested in `core/contracts/status.ts`. What is left here is what
 * only a rendered control can show: that a required subsystem in trouble is
 * named in French with a dot beside it, that an optional one draws nothing, and
 * that the control is a way into Réglages rather than a label.
 *
 * **And that a healthy app is silent.** The four assertions that used to demand
 * « Tout fonctionne » are rewritten here rather than deleted: each asks for the
 * absence, on the same fixture, so a pill creeping back into the header fails
 * the test that used to require it. A test that stops asking is not a test that
 * passes.
 *
 * **The two silences are asked for apart, because on screen they are one
 * rendering.** « We have not measured anything yet » and « we measured and
 * everything is fine » are different facts about the app, and a `return null`
 * in two places cannot be interrogated — so `statusDisplay` is asked directly
 * for its `because`, and the component is asked *behaviourally*: from the well
 * silence a required `health:changed` puts the control on screen, and from the
 * unmeasured one it is ignored, because there is no snapshot to fold it into.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  ConnectorHealth,
  ConnectorId,
  HealthSnapshot,
} from '../../../electron/core/contracts/health.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { StatusControl, statusDisplay } from '../StatusControl.tsx'

let bridge: FakeBridge
let uninstall: () => void

const down = (reason: string): ConnectorHealth => ({
  state: 'down',
  reason,
  since: 1000,
  retryable: true,
})

const degraded = (reason: string): ConnectorHealth => ({
  state: 'degraded',
  reason,
  since: 1000,
  retryable: true,
})

/** The orchestrator seeds all six at construction, so the fixtures do too. */
const snapshot = (troubled: Partial<Record<ConnectorId, ConnectorHealth>>): HealthSnapshot => ({
  capture: { state: 'ok' },
  transcribe: { state: 'ok' },
  calendar: { state: 'ok' },
  llm: { state: 'ok' },
  crm: { state: 'ok' },
  mail: { state: 'ok' },
  ...troubled,
})

/**
 * Let the snapshot land. Nothing appears when it does, which is the whole
 * point — so the wait is on the invoke having been answered, and never on a
 * string the header no longer draws.
 */
const settled = async () => {
  await waitFor(() => expect(bridge.calls.some((c) => c.channel === 'health:snapshot')).toBe(true))
  await act(async () => {})
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('the healthy state is silent', () => {
  test('everything required is up, so the header holds nothing at all', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await settled()

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Tout fonctionne')).toBeNull()
    /*
     * Not an empty chip either: no element, so no padding, no border, no
     * zero-height box holding a margin. Measured on the shipped header at
     * 1280×800 and 960×600 — the right-hand group loses the pill's 131.5 px and
     * one `gap-inline`, 359.1 → 215.6, and the header's own height is unchanged.
     */
    expect(container.childElementCount).toBe(0)
    expect(container.textContent).toBe('')
  })

  test('no dot is painted for a healthy app, and the word it owned is gone with it', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await settled()

    // `--success` was the healthy pill's dot. Nothing is reassured by a colour.
    expect(container.querySelector('.bg-success')).toBeNull()
    expect(container.querySelector('[aria-hidden]')).toBeNull()
  })

  test('it is the *well* silence, and it takes a required failure to break it', async () => {
    // The behavioural half of the distinction. `health:changed` is folded into a
    // snapshot the component holds, so it can only be answered by a component
    // whose snapshot has arrived — which is what separates this silence from the
    // one below, on a screen where both draw nothing.
    bridge.when('health:snapshot', () => snapshot({}))
    render(<StatusControl onReglages={() => {}} />)
    await settled()

    await act(async () => {
      bridge.emit('health:changed', {
        connector: 'capture',
        health: degraded('micro muet'),
        at: 2000,
      })
    })
    expect(await screen.findByRole('button', { name: 'Audio à vérifier' })).toBeTruthy()
  })

  test('it claims nothing before the snapshot has arrived, and that is a different fact', async () => {
    // A flash of anything at all while the request is still in flight is a
    // statement the app has not earned yet. The responder never answers here,
    // so the component is held in the state the old test could only catch in
    // its first synchronous frame.
    bridge.when('health:snapshot', () => new Promise<HealthSnapshot>(() => {}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    expect(container.textContent).toBe('')

    await act(async () => {
      bridge.emit('health:changed', {
        connector: 'capture',
        health: down('périphérique introuvable'),
        at: 2000,
      })
    })
    // Nothing to fold it into, so nothing appears — the same empty header as
    // above, reached for the other reason.
    expect(container.childElementCount).toBe(0)
  })
})

describe('the two silences are one rendering and two facts', () => {
  test('no snapshot is « unmeasured », never « well »', () => {
    expect(statusDisplay(null)).toEqual({ show: false, because: 'unmeasured' })
  })

  test('a snapshot with nothing wrong is « well »', () => {
    expect(statusDisplay(snapshot({}))).toEqual({ show: false, because: 'well' })
  })

  test('an optional connector down is still « well » (DEC-32)', () => {
    expect(statusDisplay(snapshot({ crm: down('VerySwing injoignable') }))).toEqual({
      show: false,
      because: 'well',
    })
  })

  test('a required connector in trouble is shown, and names itself', () => {
    expect(statusDisplay(snapshot({ llm: down('modèle injoignable') }))).toEqual({
      show: true,
      state: 'down',
      worst: 'llm',
    })
    expect(statusDisplay(snapshot({ capture: degraded('micro muet') }))).toEqual({
      show: true,
      state: 'degraded',
      worst: 'capture',
    })
  })
})

describe('only a required subsystem is drawn', () => {
  test('transcription down is the one thing that appears in the header', async () => {
    bridge.when('health:snapshot', () => snapshot({ transcribe: down('aucun moteur disponible') }))
    render(<StatusControl onReglages={() => {}} />)

    expect(await screen.findByRole('button', { name: 'Transcription indisponible' })).toBeTruthy()
    expect(screen.queryByText('Tout fonctionne')).toBeNull()
  })

  test('capture degraded reads « Audio à vérifier », in a warn tone', async () => {
    bridge.when('health:snapshot', () => snapshot({ capture: degraded('micro muet') }))
    const { container } = render(<StatusControl onReglages={() => {}} />)

    await screen.findByText('Audio à vérifier')
    expect(container.querySelector('[aria-hidden].bg-warn')).toBeTruthy()
  })

  test('analysis down reads « Analyse indisponible »', async () => {
    bridge.when('health:snapshot', () => snapshot({ llm: down('modèle injoignable') }))
    render(<StatusControl onReglages={() => {}} />)

    expect(await screen.findByText('Analyse indisponible')).toBeTruthy()
  })

  test('it arrives where nothing was, with the entering curve', async () => {
    // The transition into degraded is an *insertion*, which is the strongest
    // signal a header has and also the textbook change-blindness case, so it
    // carries `riseIn` — `var(--motion) var(--ease-out)`, and 0 ms under
    // `prefers-reduced-motion` because `--motion` collapses. jsdom resolves no
    // box and no animation, so what is asserted here is the class; the resolved
    // 150 ms, the curve and the reduced-motion 0 s are measured in Chromium.
    bridge.when('health:snapshot', () => snapshot({ capture: degraded('micro muet') }))
    render(<StatusControl onReglages={() => {}} />)

    const control = await screen.findByRole('button', { name: 'Audio à vérifier' })
    expect(control.className).toContain('animate-rise-in')
  })

  test('an unreachable VerySwing is not an app-level degradation (DEC-32)', async () => {
    // The decision, at the surface. VerySwing, Outlook and the calendar are
    // optional at runtime (DEC-26): all three can be down at once and the app
    // is still capturing, transcribing and analysing — so the header says
    // nothing. Their reason and their retry stay inline in Réglages; what
    // collapsed is the aggregate, not the explanation.
    bridge.when('health:snapshot', () =>
      snapshot({
        crm: down('VerySwing injoignable'),
        mail: down('jeton Outlook expiré'),
        calendar: down('application Entra non configurée'),
      }),
    )
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await settled()

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Tout fonctionne')).toBeNull()
    expect(container.textContent).toBe('')
    expect(container.querySelector('.bg-danger')).toBeNull()
  })

  test('a health:changed broadcast for an optional connector leaves the header empty', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await settled()

    await act(async () => {
      bridge.emit('health:changed', {
        connector: 'crm',
        health: down('VerySwing injoignable'),
        at: 2000,
      })
    })
    expect(container.textContent).toBe('')
    expect(screen.queryByText('Tout fonctionne')).toBeNull()

    // …and one for a required connector does draw it, in place, with no poll.
    await act(async () => {
      bridge.emit('health:changed', {
        connector: 'capture',
        health: down('périphérique introuvable'),
        at: 3000,
      })
    })
    await waitFor(() => expect(screen.getByText('Audio indisponible')).toBeTruthy())
  })
})

describe('it is a way into Réglages, not a label', () => {
  /*
   * Staged degraded, because that is now the only state with a control in it —
   * and it is the state where the click matters: the rep is being handed the one
   * destination that can explain what is wrong (DEC-32).
   */
  test('clicking navigates to Réglages', async () => {
    const onReglages = vi.fn()
    bridge.when('health:snapshot', () => snapshot({ capture: degraded('micro muet') }))
    render(<StatusControl onReglages={onReglages} />)

    const control = await screen.findByRole('button', { name: 'Audio à vérifier' })
    await act(async () => {
      control.click()
    })

    expect(onReglages).toHaveBeenCalledTimes(1)
  })

  test('the chevron is an affordance, not part of the accessible name', async () => {
    bridge.when('health:snapshot', () => snapshot({ capture: degraded('micro muet') }))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await screen.findByRole('button', { name: 'Audio à vérifier' })

    expect(container.textContent).toContain('›')
  })
})
