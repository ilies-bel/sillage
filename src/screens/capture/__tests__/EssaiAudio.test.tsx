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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
   * The whole matrix. `remedy` is which control the *far* row — the client's
   * half, the one this product exists for — should carry.
   *
   * **It was a boolean, and that is what hid a defect for a round.** `offers`
   * answered « the pane, or nothing », so `to-grant` and `denied` sat in the
   * table as one case with the comment « Never answered, and refused: the pane
   * is the remedy in both cases » — and the block below asserted *Autoriser*
   * was wrong « whatever the state », on the reasoning that « a prompt is not
   * the remedy for anything the pane is the remedy for ». A privacy pane does
   * not list an application which has never attempted capture, so for the one
   * state a rep meets on their first launch the pane is not a remedy at all.
   * The third value is the whole point of the type.
   */
  const MATRIX: Array<{
    state: CapturePermissionState
    channel: CaptureChannel | null
    canOpenSettings: boolean
    remedy: 'ask' | 'open' | 'none'
    why: string
  }> = [
    // Windows with everything granted, and macOS after both prompts were
    // accepted: nothing is being withheld, so the silence is a muted microphone
    // or an audio route, and no button on this card touches either.
    { state: 'ready', channel: null, canOpenSettings: false, remedy: 'none', why: 'rien à accorder' },
    // A managed device. `permissions.ts`: neither asking nor visiting the pane
    // changes it, so the sentence is the whole of what can be said.
    { state: 'blocked', channel: 'both', canOpenSettings: false, remedy: 'none', why: 'appareil géré' },
    // Never answered — the OS will still prompt, and the pane would be a list
    // this app is not in until something has tried.
    { state: 'to-grant', channel: 'screen', canOpenSettings: true, remedy: 'ask', why: 'jamais demandé' },
    // A prompt is a capability of the application, so the ask does not need a
    // pane to exist: the one host-capability case is `open`'s, below.
    { state: 'to-grant', channel: 'screen', canOpenSettings: false, remedy: 'ask', why: 'jamais demandé, aucun volet' },
    // Refused. The OS silently returns the old answer to a second ask, so the
    // pane is the only remedy left — `permissions.ts` says so outright.
    { state: 'denied', channel: 'screen', canOpenSettings: true, remedy: 'open', why: 'refusé' },
    { state: 'denied', channel: 'both', canOpenSettings: true, remedy: 'open', why: 'les deux refusés' },
    // The refusal is on the *other* side of the call. Offering the screen pane
    // on the microphone row sends the rep to fix a permission that is granted.
    { state: 'denied', channel: 'microphone', canOpenSettings: true, remedy: 'none', why: 'autre canal' },
    // A host with no pane at all: `canOpenSettings` is a capability, and a
    // button that opens nothing is the same dead control one level down.
    { state: 'denied', channel: 'screen', canOpenSettings: false, remedy: 'none', why: 'aucun volet' },
  ]

  for (const row of MATRIX) {
    const WORD = { ask: 'Autoriser', open: 'le volet', none: 'aucun bouton' }
    test(`far silent, ${row.state}/${row.channel ?? '—'} (${row.why}) → ${
      WORD[row.remedy]
    }`, async () => {
      await run({
        permission: consent(row.state, row.channel, row.canOpenSettings),
        result: heard(true, false),
      })

      await screen.findByText(/c’est la moitié qui compte le plus/)
      const pane = screen.queryByRole('button', { name: 'Ouvrir les réglages' })
      const prompt = screen.queryByRole('button', { name: 'Autoriser' })
      expect(pane === null).toBe(row.remedy !== 'open')
      expect(prompt === null).toBe(row.remedy !== 'ask')

      /*
        And the ask goes through `capture:permission:request`, never through
        `health:retry`. That is the control this card drew for a round: on a
        machine whose permissions are granted — every Windows machine — the retry
        probes the native module, finds `actionFor('granted') === 'nothing'`,
        calls no OS API and republishes `ok`.
      */
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

describe('the prompt, once pressed', () => {
  /*
   * **The press that was missing, and the hand-over after it.**
   *
   * `capture:permission:request` raises the OS prompt — the act `actionFor`
   * has called `ask` since `capturePermission.ts` was written and which no
   * screen could reach until the channel landed. This card drew the pane for
   * `to-grant` instead, which on a first launch is a list the app is not in.
   *
   * Then it hands over, and that is not politeness: on macOS the
   * screen-recording grant does not land until the app is relaunched, so the
   * honest answer to an ask can be the identical `to-grant`, and re-offering
   * the same press is the control DEC-26 forbids. The attempt is also what puts
   * the app in the pane, so the pane becomes a real remedy exactly then.
   */
  test('asks the OS, then hands over to the pane the attempt has just made useful', async () => {
    await run({ permission: consent('to-grant', 'screen'), result: heard(true, false) })
    await screen.findByText(/c’est la moitié qui compte le plus/)
    // The sentence agrees with the control, which is the whole point of
    // `channelRemedyFor` being read by both.
    expect(screen.getByText(/n’a pas encore été autorisé/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()

    const before = bridge.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }))
    })
    const fired = bridge.calls.slice(before).map((call) => call.channel)
    expect(fired).toContain('capture:permission:request')
    // And it listens again: a grant that changed nothing and a grant that fixed
    // it look identical until something listens.
    expect(fired).toContain('capture:essai')

    // The hand-over, on both surfaces at once.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy(),
    )
    expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
    expect(screen.getByText(/réglages de confidentialité du système/)).toBeTruthy()
  })

  /*
   * An older main process has no such channel, so the invoke rejects. The row
   * must not be left holding a press that threw: it counts as asked and falls
   * through to the pane, which is what this card had before the channel existed.
   */
  test('a channel the main process does not have still leaves a remedy', async () => {
    bridge.when('capture:permission', () => consent('to-grant', 'screen'))
    bridge.when('capture:essai', () => heard(true, false))
    bridge.when('capture:permission:request', () => {
      throw new Error('canal inconnu')
    })
    render(<EssaiAudio />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })
    await screen.findByText(/c’est la moitié qui compte le plus/)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }))
    })
    expect(await screen.findByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
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
