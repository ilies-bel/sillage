/**
 * DEC-32 at the surface it is actually read from.
 *
 * The pure half — which subsystems are allowed to move the aggregate — is
 * settled and tested in `core/contracts/status.ts`. What is left here is what
 * only a rendered control can show: that the healthy state says « Tout
 * fonctionne » in French with a dot beside it, that a required subsystem moves
 * it, that an optional one does **not**, and that the control is a way into
 * Réglages rather than a label.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  ConnectorHealth,
  ConnectorId,
  HealthSnapshot,
} from '../../../electron/core/contracts/health.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { StatusControl } from '../StatusControl.tsx'

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

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('the healthy state', () => {
  test('everything required is up, so the control says « Tout fonctionne »', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    render(<StatusControl onReglages={() => {}} />)

    expect(await screen.findByRole('button', { name: 'Tout fonctionne' })).toBeTruthy()
  })

  test('the state is a dot with its word, never a bare colour', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await screen.findByText('Tout fonctionne')

    const dot = container.querySelector('[aria-hidden].bg-success')
    expect(dot, 'the healthy dot is --success, and it is decorative').toBeTruthy()
  })

  test('it claims nothing before the snapshot has arrived', () => {
    // A flash of « Tout fonctionne » while the request is still in flight is a
    // statement the app has not earned yet.
    bridge.when('health:snapshot', () => snapshot({}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

describe('only a required subsystem moves it', () => {
  test('transcription down moves the control off « Tout fonctionne »', async () => {
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

  test('an unreachable VerySwing is not an app-level degradation (DEC-32)', async () => {
    // The decision, at the surface. VerySwing, Outlook and the calendar are
    // optional at runtime (DEC-26): all three can be down at once and the app
    // is still capturing, transcribing and analysing — which is what the
    // header reports. Their reason and their retry stay inline in Réglages;
    // what collapsed is the aggregate, not the explanation.
    bridge.when('health:snapshot', () =>
      snapshot({
        crm: down('VerySwing injoignable'),
        mail: down('jeton Outlook expiré'),
        calendar: down('application Entra non configurée'),
      }),
    )
    const { container } = render(<StatusControl onReglages={() => {}} />)

    expect(await screen.findByRole('button', { name: 'Tout fonctionne' })).toBeTruthy()
    expect(container.textContent).not.toContain('VerySwing')
    expect(container.querySelector('.bg-danger')).toBeNull()
  })

  test('a health:changed broadcast for an optional connector leaves it alone', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    render(<StatusControl onReglages={() => {}} />)
    await screen.findByText('Tout fonctionne')

    await act(async () => {
      bridge.emit('health:changed', {
        connector: 'crm',
        health: down('VerySwing injoignable'),
        at: 2000,
      })
    })
    expect(screen.getByText('Tout fonctionne')).toBeTruthy()

    // …and one for a required connector does move it, in place, with no poll.
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
  test('clicking navigates to Réglages', async () => {
    const onReglages = vi.fn()
    bridge.when('health:snapshot', () => snapshot({}))
    render(<StatusControl onReglages={onReglages} />)

    const control = await screen.findByRole('button', { name: 'Tout fonctionne' })
    await act(async () => {
      control.click()
    })

    expect(onReglages).toHaveBeenCalledTimes(1)
  })

  test('the chevron is an affordance, not part of the accessible name', async () => {
    bridge.when('health:snapshot', () => snapshot({}))
    const { container } = render(<StatusControl onReglages={() => {}} />)
    await screen.findByRole('button', { name: 'Tout fonctionne' })

    expect(container.textContent).toContain('›')
  })
})
