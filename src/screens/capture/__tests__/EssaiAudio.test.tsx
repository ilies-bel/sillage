/**
 * **The dry run's remedy, and whether pressing it can change anything.**
 *
 * The card is the one surface in the product that *establishes* the failure this
 * whole product exists to prevent — the client's half of the call not being
 * recorded — and for a round it answered that with an *Autoriser* drawn on
 * `!line.heard` and nothing else. It called `health:retry('capture')`, which on
 * a host whose permissions are granted asks the OS nothing at all
 * (`actionFor('granted') === 'nothing'`), republishes `ok`, and re-runs the same
 * twenty seconds. On Windows — the primary platform (HR-2), which has no
 * screen-recording permission to hold back — that is every machine, so the
 * remedy for « the client would not be recorded » was a button that could never
 * do anything, for ever.
 *
 * `contracts/permissions.ts` states the rule the card was breaking: « a screen
 * that offers *Autoriser* on a refusal draws a control that can never do
 * anything — the thing DEC-26 forbids », and the pane is the whole remedy.
 *
 * **These tests are wide on purpose.** The subject of the rule is « a control is
 * offered only where it changes something », so the table below walks *every*
 * `CapturePermissionState` against *every* silent channel rather than
 * photographing the one that broke. A card that grows a third control gets
 * measured against the same question on the day it arrives.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type {
  CaptureChannel,
  CapturePermission,
  CapturePermissionState,
} from '../../../../electron/core/contracts/permissions.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../../test/appBridge.ts'
import { EssaiAudio } from '../EssaiAudio.tsx'

let bridge: FakeBridge
let uninstall: () => void

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

const consent = (
  state: CapturePermissionState,
  channel: CaptureChannel | null,
  canOpenSettings = true,
): CapturePermission => ({
  state,
  channel,
  reason: state === 'ready' ? null : 'raison composée par le processus principal',
  canOpenSettings,
})

/** Both channels silent unless told otherwise — the quiet-room run. */
const heard = (rep: boolean, far: boolean) => ({
  rep: { heard: rep, peak: rep ? 0.4 : 0.001 },
  far: { heard: far, peak: far ? 0.4 : 0.001 },
  floor: 0.008,
  seconds: 20,
})

/** Mounts the card, runs the trial, and waits for the verdict to land. */
const run = async (options: {
  permission?: CapturePermission
  result?: ReturnType<typeof heard>
  onReglages?: () => void
}) => {
  if (options.permission) bridge.when('capture:permission', () => options.permission!)
  bridge.when('capture:essai', () => options.result ?? heard(false, false))
  bridge.when('capture:permission:open', () => ({ opened: true }))
  bridge.when('health:retry', () => ({ state: 'ok' as const }))
  render(<EssaiAudio {...(options.onReglages ? { onReglages: options.onReglages } : {})} />)
  screen.getByRole('button', { name: /^Essai de/ }).click()
  await waitFor(() => screen.getByRole('button', { name: 'Recommencer' }))
}

describe('a control is offered only where a control changes something', () => {
  /**
   * The whole matrix. `offers` is whether the *far* row — the client's half, the
   * one this product exists for — should carry the pane button.
   */
  const MATRIX: Array<{
    state: CapturePermissionState
    channel: CaptureChannel | null
    canOpenSettings: boolean
    offers: boolean
    why: string
  }> = [
    // Windows with everything granted, and macOS after both prompts were
    // accepted: nothing is being withheld, so the silence is a muted microphone
    // or an audio route, and no button on this card touches either.
    { state: 'ready', channel: null, canOpenSettings: false, offers: false, why: 'rien à accorder' },
    // A managed device. `permissions.ts`: neither asking nor visiting the pane
    // changes it, so the sentence is the whole of what can be said.
    { state: 'blocked', channel: 'both', canOpenSettings: false, offers: false, why: 'appareil géré' },
    // Never answered, and refused: the pane is the remedy in both cases.
    { state: 'to-grant', channel: 'screen', canOpenSettings: true, offers: true, why: 'jamais demandé' },
    { state: 'denied', channel: 'screen', canOpenSettings: true, offers: true, why: 'refusé' },
    { state: 'denied', channel: 'both', canOpenSettings: true, offers: true, why: 'les deux refusés' },
    // The refusal is on the *other* side of the call. Offering the screen pane
    // on the microphone row sends the rep to fix a permission that is granted.
    { state: 'denied', channel: 'microphone', canOpenSettings: true, offers: false, why: 'autre canal' },
    // A host with no pane at all: `canOpenSettings` is a capability, and a
    // button that opens nothing is the same dead control one level down.
    { state: 'denied', channel: 'screen', canOpenSettings: false, offers: false, why: 'aucun volet' },
  ]

  for (const row of MATRIX) {
    test(`far silent, ${row.state}/${row.channel ?? '—'} (${row.why}) → ${
      row.offers ? 'le volet' : 'aucun bouton'
    }`, async () => {
      await run({
        permission: consent(row.state, row.channel, row.canOpenSettings),
        result: heard(true, false),
      })

      await screen.findByText(/c’est la moitié qui compte le plus/)
      const pane = screen.queryByRole('button', { name: 'Ouvrir les réglages' })
      expect(pane === null).toBe(!row.offers)

      /*
        And never the old one, whatever the state. *Autoriser* on this card asked
        `health:retry`, which is the prompt — and a prompt is not the remedy for
        anything the pane is the remedy for.
      */
      expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
      expect(bridge.calls.some((call) => call.channel === 'health:retry')).toBe(false)
    })
  }

  test('the microphone row takes its own permission, not the screen’s', async () => {
    await run({
      permission: consent('denied', 'microphone'),
      result: heard(false, true),
    })

    await screen.findByText(/Le client serait capté, vous non/)
    expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
  })

  /**
   * The quiet room, which is the commonest run of all: a rep presses the button,
   * says nothing, and both channels read silent. `essaiHealth` refuses to call
   * that a degradation for exactly this reason — it establishes nothing — so the
   * card must not put two remedies in front of them either.
   */
  test('two silent channels on a healthy machine offer no remedy at all', async () => {
    await run({ permission: consent('ready', null, false) })

    await screen.findByText(/Rien n’a été entendu pendant l’essai/)
    expect(screen.queryAllByRole('button', { name: 'Ouvrir les réglages' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Autoriser' })).toHaveLength(0)
    // *Recommencer* is the honest re-run and it is still there.
    expect(screen.getByRole('button', { name: 'Recommencer' })).toBeTruthy()
  })

  /**
   * An older main process, or a channel that threw: the card has no consent to
   * branch on. It draws no pane button rather than guessing one — the guess is
   * what put a dead control on the primary platform.
   */
  test('a consent the main process could not answer draws no button', async () => {
    bridge.when('capture:permission', () => {
      throw new Error('canal absent')
    })
    bridge.when('capture:essai', () => heard(true, false))
    render(<EssaiAudio />)
    screen.getByRole('button', { name: /^Essai de/ }).click()
    await screen.findByText(/c’est la moitié qui compte le plus/)

    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
  })
})

describe('the pane, once pressed', () => {
  test('opens the pane and re-measures, because a grant is only proved by listening', async () => {
    await run({ permission: consent('denied', 'screen'), result: heard(true, false) })
    await screen.findByText(/c’est la moitié qui compte le plus/)

    const before = bridge.calls.length
    screen.getByRole('button', { name: 'Ouvrir les réglages' }).click()
    await waitFor(() =>
      expect(
        bridge.calls.slice(before).filter((call) => call.channel === 'capture:essai'),
      ).toHaveLength(1),
    )

    const fired = bridge.calls.slice(before).map((call) => call.channel)
    expect(fired).toContain('capture:permission:open')
    // Re-read, because a rep grants it in the window that just came up and comes
    // straight back to a card that must not still be offering the same button.
    expect(fired).toContain('capture:permission')
  })

  test('a pane that did not open says so instead of appearing to work', async () => {
    bridge.when('capture:permission', () => consent('denied', 'screen'))
    bridge.when('capture:essai', () => heard(true, false))
    bridge.when('capture:permission:open', () => ({ opened: false }))
    render(<EssaiAudio />)
    screen.getByRole('button', { name: /^Essai de/ }).click()
    await screen.findByText(/c’est la moitié qui compte le plus/)

    screen.getByRole('button', { name: 'Ouvrir les réglages' }).click()
    expect(await screen.findByText(/ne se sont pas ouverts/)).toBeTruthy()
  })
})
