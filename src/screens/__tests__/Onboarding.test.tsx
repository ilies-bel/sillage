/**
 * The first screen, and the five states of its one live row.
 *
 * What these pin is not the layout. It is that **the renderer never decides a
 * platform**: every case below is produced by feeding the screen the rows the
 * main process would have sent from that machine, and the screen is expected to
 * draw the right dot, the right sentence and the right control without a single
 * branch on an OS. The two Windows cases are the ones that matter — this file
 * is written on a Mac and the reps are on Windows (HR-2).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { CapturePermissions, PermissionRow } from '../../../electron/core/contracts/permissions.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Onboarding } from '../Onboarding.tsx'

let bridge: FakeBridge
let uninstall: () => void

const row = (over: Partial<PermissionRow> & Pick<PermissionRow, 'scope'>): PermissionRow => ({
  status: 'prompt',
  reason: null,
  canOpenSettings: true,
  ...over,
})

/** macOS: both scopes governed, two panes. */
const MAC_TO_GRANT: CapturePermissions = {
  rows: [row({ scope: 'microphone' }), row({ scope: 'systemAudio' })],
}

const MAC_DENIED: CapturePermissions = {
  rows: [
    row({ scope: 'microphone', status: 'granted', canOpenSettings: true }),
    row({
      scope: 'systemAudio',
      status: 'denied',
      reason: 'L’audio de votre ordinateur est refusé dans Enregistrement de l’écran.',
    }),
  ],
}

const MAC_READY: CapturePermissions = {
  rows: [
    row({ scope: 'microphone', status: 'granted' }),
    row({ scope: 'systemAudio', status: 'granted' }),
  ],
}

/** Windows: the microphone is governed and nothing else is. */
const WINDOWS_BLOCKED: CapturePermissions = {
  rows: [
    row({
      scope: 'microphone',
      status: 'denied',
      reason: 'Le micro est bloqué pour Sillage dans les paramètres de confidentialité de Windows.',
    }),
    row({ scope: 'systemAudio', status: 'notRequired', canOpenSettings: false }),
  ],
}

const WINDOWS_READY: CapturePermissions = {
  rows: [
    row({ scope: 'microphone', status: 'granted' }),
    row({ scope: 'systemAudio', status: 'notRequired', canOpenSettings: false }),
  ],
}

const draw = async (permissions: CapturePermissions, onDone = () => {}) => {
  bridge.when('permissions:capture', () => permissions)
  render(<Onboarding onDone={onDone} />)
  await screen.findByText('Le micro et l’audio de votre ordinateur')
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
  bridge.when('permissions:openSettings', () => ({ opened: true, reason: null }))
})

afterEach(() => {
  cleanup()
  uninstall()
})

test('the three steps are there, in order, and the footer is not', async () => {
  await draw(MAC_READY)
  const steps = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(steps).toEqual([
    'Sillage ne rejoint jamais la réunion',
    'Le micro et l’audio de votre ordinateur',
    'Vous relisez avant tout envoi',
  ])
  // The V2 design dropped the version footer. It is gone, not hidden.
  expect(screen.queryByText(/^Version /)).toBeNull()
})

test('one filled control per screen — *Commencer*, and it is the only one', async () => {
  await draw(MAC_TO_GRANT)
  const filled = screen
    .getAllByRole('button')
    .filter((el) => el.className.includes('bg-brand-700'))
    .map((el) => el.textContent)
  expect(filled).toEqual(['Commencer'])
})

test('macOS « à autoriser »: a dot, what will be asked, and the way to the pane', async () => {
  await draw(MAC_TO_GRANT)
  expect(screen.getByText('À autoriser')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
})

test('macOS « refusé »: the refusal is printed verbatim, never rewritten here', async () => {
  await draw(MAC_DENIED)
  expect(screen.getByText('Refusé')).toBeTruthy()
  expect(
    screen.getByText('L’audio de votre ordinateur est refusé dans Enregistrement de l’écran.'),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
})

test('a refusal opens the refused scope’s pane — never the other one', async () => {
  await draw(MAC_DENIED)
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir les réglages' }))
  await waitFor(() => {
    const call = bridge.calls.find((c) => c.channel === 'permissions:openSettings')
    expect(call?.payload).toEqual({ scope: 'systemAudio' })
  })
})

test('macOS « prêt »: no control at all, because there is nothing to open', async () => {
  await draw(MAC_READY)
  expect(screen.getByText('Prêt')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
})

test('Windows « micro bloqué »: the Windows sentence, and its own pane', async () => {
  await draw(WINDOWS_BLOCKED)
  expect(screen.getByText('Refusé')).toBeTruthy()
  expect(screen.getByText(/paramètres de confidentialité de Windows/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir les réglages' }))
  await waitFor(() => {
    const call = bridge.calls.find((c) => c.channel === 'permissions:openSettings')
    expect(call?.payload).toEqual({ scope: 'microphone' })
  })
})

test('Windows « prêt »: an ungoverned scope raises nothing and offers nothing', async () => {
  await draw(WINDOWS_READY)
  expect(screen.getByText('Prêt')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
  // Nothing on this screen ever names a pane the renderer chose.
  expect(screen.queryByText(/Enregistrement de l’écran/)).toBeNull()
})

test('a refusal never leads to a prompt — the only verb is openSettings', async () => {
  await draw(MAC_DENIED)
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir les réglages' }))
  await waitFor(() => {
    expect(bridge.calls.some((c) => c.channel === 'permissions:openSettings')).toBe(true)
  })
  expect(bridge.calls.map((c) => c.channel)).not.toContain('permissions:ask')
})

test('coming back from System Settings re-reads — a stale « refusé » is the bug', async () => {
  let answer = MAC_DENIED
  bridge.when('permissions:capture', () => answer)
  render(<Onboarding onDone={() => {}} />)
  await screen.findByText('Refusé')

  answer = MAC_READY
  fireEvent.focus(window)
  await screen.findByText('Prêt')
})

test('*Commencer* is live even when a channel is refused — the app still records the other side', async () => {
  let done = 0
  await draw(WINDOWS_BLOCKED, () => {
    done += 1
  })
  const start = screen.getByRole('button', { name: 'Commencer' })
  expect(start.hasAttribute('disabled')).toBe(false)
  fireEvent.click(start)
  expect(done).toBe(1)
})

test('a channel that has not answered claims no grant', () => {
  bridge.when('permissions:capture', () => new Promise<CapturePermissions>(() => {}))
  render(<Onboarding onDone={() => {}} />)
  expect(screen.getByText('À autoriser')).toBeTruthy()
})
