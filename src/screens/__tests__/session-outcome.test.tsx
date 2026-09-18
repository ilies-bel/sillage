/**
 * **Every state the session screen can be in says something, and the abort says
 * what went wrong.**
 *
 * The one this was written for: with the whisper weights parked, the real main
 * process moves a meeting `recording → aborted` with the reason « aucun
 * fournisseur de transcription » — and the session screen drew
 *
 *     ['‹ Calendrier','Prise de besoin','Libre','Trame','Transcription','Masquer']
 *
 * with no `role="status"` and no `role="alert"` anywhere on it. Nothing in the
 * product said the recording had died except a control on the *calendar*, which
 * is a screen the rep is not on. It is reachable on Windows — the primary
 * platform (HR-2) — every time WASAPI loopback fails to open.
 *
 * **The enumeration is the instrument, not the abort case.** The rule is « no
 * state of this machine leaves this screen mute », and a test that drove one
 * state could not have seen `aborted`, which is precisely the state nothing
 * drove. So the first block walks `MeetingStateSchema.options` — all nine — and
 * a tenth added to the enum lands in it the day it is declared.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Meeting, MeetingState } from '../../../electron/core/contracts/meeting.ts'
import { MeetingStateSchema, STATE_REASON } from '../../../electron/core/contracts/meeting.ts'
import type { HealthSnapshot } from '../../../electron/core/contracts/health.ts'
import type { RecipeId } from '../../../electron/core/contracts/recipes.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Session } from '../Session.tsx'

let bridge: FakeBridge
let uninstall: () => void

const meeting = (state: MeetingState): Meeting => ({
  id: 'm-fin',
  state,
  title: 'Point Acme',
  eventId: null,
  clientName: 'Acme SA',
  scheduledStart: null,
  createdAt: 1,
  startedAt: 1,
  endedAt: null,
  confirmedAt: null,
  updatedAt: 1,
})

/** Everything well — the baseline the enumeration runs against. */
const WELL: HealthSnapshot = {
  capture: { state: 'ok' },
  transcribe: { state: 'ok' },
  llm: { state: 'ok' },
  calendar: { state: 'ok' },
  crm: { state: 'ok' },
  mail: { state: 'ok' },
}

/**
 * Exactly what `Orchestrator.#openDevices` publishes on the line above its
 * `dispatch(meetingId, 'abort', 'aucun fournisseur de transcription')`.
 */
const NO_TRANSCRIBER: HealthSnapshot = {
  ...WELL,
  transcribe: {
    state: 'down',
    reason: 'aucun fournisseur de transcription disponible',
    since: 1,
    retryable: true,
  },
}

const open = (
  state: MeetingState,
  options: {
    health?: HealthSnapshot
    compteRendu?: string | null
    onReglages?: (section?: string) => void
  } = {},
) => {
  bridge.when('meeting:get', () => ({
    meeting: meeting(state),
    segments: [],
    signals: [],
    outbox: [],
    document: null,
    compteRendu: options.compteRendu ?? null,
    recipe: 'besoin-commercial' as RecipeId,
  }))
  /*
    **`Enhancement.statusOf`, not a convenient constant** — and the first draft of
    this file used `{ status: 'idle' }` for every state, which made `ended` and
    `extracting` look mute in the enumeration below. They are not: `statusOf`
    cannot return `idle` for either of them (`extracting` is always `running`,
    and `ended` is `waitingForModel` or `failed`). A fixture simpler than the
    product is a fixture that cannot exercise the property it is standing in for.
  */
  bridge.when('enhancement:status', () =>
    state === 'extracting'
      ? ({ status: 'running', since: 1 } as const)
      : state === 'ended'
        ? ({ status: 'failed', reason: null } as const)
        : ({ status: 'idle' } as const),
  )
  bridge.when('health:snapshot', () => options.health ?? WELL)
  return render(
    <Session
      meetingId="m-fin"
      onBack={() => {}}
      onReview={() => {}}
      {...(options.onReglages ? { onReglages: options.onReglages } : {})}
    />,
  )
}

/**
 * **The control that belongs to the state itself**, or `null` where the state
 * has none and therefore has to speak.
 *
 * Declared rather than inferred, and the first draft of this file inferred it —
 * « any button that is not one of the six header controls » — which is the
 * shape this repo keeps finding: an instrument that passes on evidence that has
 * nothing to do with its subject. A `done` meeting carries a compte-rendu, a
 * compte-rendu draws the *Demander* aside, and *Demander* would have answered
 * for `done` while saying nothing whatever about the meeting being over. The
 * same subtraction let `aborted` through the moment a document was in the
 * fixture.
 *
 * A table over `MeetingState`, so a tenth state does not compile until somebody
 * has said which of the two answers it takes.
 */
const OWN_CONTROL: Record<MeetingState, string | null> = {
  idle: 'Démarrer',
  armed: 'Démarrer',
  recording: 'Terminer',
  // `EnhancementNotice`'s two. They have no control of their own and they are
  // not supposed to: what a rep is owed there is the wait, stated.
  ended: null,
  extracting: null,
  awaiting_confirmation: 'Relire et valider',
  pushing: null,
  done: null,
  aborted: null,
}

/**
 * **Whether the product would have put a compte-rendu on this meeting.**
 *
 * `null` for every state was the convenient fixture and it is wrong for three
 * of them: nothing reaches `awaiting_confirmation` without one, and `pushing`
 * and `done` are downstream of that. Measured with the honest document, HEAD
 * still drew nothing for `pushing`, `done` and `aborted` — but a fixture that
 * is simpler than the product proves the property for a screen the product
 * never renders, which is no proof at all.
 */
const HAS_COMPTE_RENDU: Record<MeetingState, boolean> = {
  idle: false,
  armed: false,
  recording: false,
  ended: false,
  extracting: false,
  awaiting_confirmation: true,
  pushing: true,
  done: true,
  // Terminal before the recipe ever ran. This one really is `null`, and it is
  // the state the notice was written for.
  aborted: false,
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('no state of the machine leaves this screen mute', () => {
  for (const state of MeetingStateSchema.options) {
    const control = OWN_CONTROL[state]

    test(`${state} ${control ? `offers « ${control} »` : 'says what happened'}`, async () => {
      open(state, {
        onReglages: () => {},
        ...(HAS_COMPTE_RENDU[state] ? { compteRendu: '# Acme\n\n## Résumé\n\nRien.\n' } : {}),
      })
      await waitFor(() => screen.getByRole('button', { name: '‹ Calendrier' }))

      /*
        Inside `waitFor`, because both answers arrive on a channel rather than
        with the first frame — `enhancement:status` for the waiting states and
        `health:snapshot` for the abort's cause. Asserting on the frame after
        the header would have reported `ended` mute, which it is not; what the
        rule says is « this screen does not *stay* mute ».
      */
      await waitFor(() => {
        const said = [...screen.queryAllByRole('status'), ...screen.queryAllByRole('alert')]
          .map((node) => node.textContent?.trim() ?? '')
          .filter((text) => text.length > 0)
        const buttons = screen
          .queryAllByRole('button')
          .map((button) => button.textContent?.trim() ?? '')

        if (control) {
          expect(
            buttons,
            `${state} ne dessine pas son propre contrôle — boutons ${JSON.stringify(buttons)}`,
          ).toContain(control)
          return
        }

        // A state with no control of its own has to say what it is. Nothing
        // else counts: the rep pressed something, arrived here, and the screen
        // has stopped answering them.
        expect(
          said.length > 0,
          `${state} n’a aucun contrôle qui lui soit propre et ne dit rien — ` +
            `boutons ${JSON.stringify(buttons)}, phrases ${JSON.stringify(said)}`,
        ).toBe(true)
      })
    })
  }
})

describe('the abort', () => {
  test('names the cause the orchestrator wrote, verbatim', async () => {
    open('aborted', { health: NO_TRANSCRIBER, onReglages: () => {} })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(STATE_REASON.aborted)
    // Verbatim from the connector, never composed here (DEC-32's `reason`).
    await waitFor(() =>
      expect(alert.textContent).toContain('aucun fournisseur de transcription disponible'),
    )
    // And the consequence the state word alone does not carry.
    expect(alert.textContent).toContain('il n’y aura pas de compte-rendu')
  })

  test('the way out lands on the pane where the named subsystem is repaired', async () => {
    const opened: Array<string | undefined> = []
    open('aborted', { health: NO_TRANSCRIBER, onReglages: (section) => opened.push(section) })

    const button = await screen.findByRole('button', { name: 'Ouvrir les réglages' })
    button.click()
    expect(opened).toEqual(['transcription'])
  })

  test('a dead capture sends them to the connectors instead', async () => {
    const opened: Array<string | undefined> = []
    open('aborted', {
      health: {
        ...WELL,
        capture: {
          state: 'down',
          reason: 'capture indisponible — loopback device could not be opened',
          since: 1,
          retryable: true,
        },
      },
      onReglages: (section) => opened.push(section),
    })

    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(alert.textContent).toContain('loopback device could not be opened'))
    screen.getByRole('button', { name: 'Ouvrir les réglages' }).click()
    expect(opened).toEqual(['connecteurs'])
  })

  /**
   * A meeting abandoned before this process booted, opened out of *Historique*.
   * There is no live health to blame and the notice must not invent one — but it
   * still has to say the meeting was abandoned, which is the whole point.
   */
  test('with nothing wrong now, it states the case and offers no button', async () => {
    open('aborted', { health: WELL, onReglages: () => {} })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(STATE_REASON.aborted)
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
  })

  /**
   * The harness and the tests mount this screen with no router. The sentence is
   * the part that matters and it must survive the shortcut's absence.
   */
  test('without a router it still says what happened', async () => {
    open('aborted', { health: NO_TRANSCRIBER })

    const alert = await screen.findByRole('alert')
    await waitFor(() =>
      expect(alert.textContent).toContain('aucun fournisseur de transcription disponible'),
    )
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
  })

  /**
   * It arrives on the broadcast, which is how a rep actually meets it: they are
   * on this screen watching a meeting start, and it dies under them.
   */
  test('it appears when the recording dies under the rep, not only on a reload', async () => {
    open('recording', { onReglages: () => {} })
    await screen.findByRole('button', { name: 'Terminer' })
    expect(screen.queryByRole('alert')).toBeNull()

    bridge.emit('health:changed', {
      connector: 'transcribe',
      health: NO_TRANSCRIBER.transcribe,
      at: 2,
    })
    bridge.emit('session:changed', { meetingId: 'm-fin', state: 'aborted' })

    const alert = await screen.findByRole('alert')
    await waitFor(() =>
      expect(alert.textContent).toContain('aucun fournisseur de transcription disponible'),
    )
    // And the pill is gone with it: bars that kept moving would say the app is
    // still listening.
    expect(screen.queryByRole('button', { name: 'Terminer' })).toBeNull()
  })
})

describe('the states that are not an abort', () => {
  test('a meeting still pushing says so, in red to nobody', async () => {
    open('pushing')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(STATE_REASON.pushing)
    expect(alert.querySelector('.text-danger')).toBeNull()
  })

  test('a validated meeting says it is done rather than showing a bare document', async () => {
    open('done', { compteRendu: '# Acme\n\n## Résumé\n\nRien.\n' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(STATE_REASON.done)
    // DEC-4: it is a statement, not a second door.
    expect(screen.queryByRole('button', { name: 'Relire et valider' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
  })

  /**
   * `ended` and `extracting` are `EnhancementNotice`'s, and two strips saying
   * different halves of one wait is worse than one.
   */
  test('the waiting states are left to the strip that owns them', async () => {
    open('extracting')
    await waitFor(() => screen.getByRole('button', { name: '‹ Calendrier' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
