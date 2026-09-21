/**
 * **A control is an offer. It is not a statement of what the screen is.**
 *
 * `session-outcome.test.tsx` already walks all nine `MeetingState`s under the
 * rule « no state of the machine leaves this screen mute » — and it passes on a
 * screen that says nothing, because its `OWN_CONTROL` table accepts *Démarrer*
 * as the answer for `idle` and for `armed`. Driven on the shipped renderer, the
 * screen those two states actually draw (`agenda-preparer`, both smoke sizes):
 *
 *     arbre: 7 contrôle(s) et 2 champ(s) nommés, 0 titre(s), aucune prose
 *
 * Seven controls, two fields, no heading, no sentence, seven « — » in the
 * slate, « Client » showing its placeholder. That screen is where **both** human
 * entrances into recording land — *Préparer* on a calendar row, and the DEC-46
 * arming notice — and nothing on it said the meeting was armed, when the call
 * was, who was on the far side, or that nothing was being recorded yet.
 *
 * So this file states the rule one notch stronger than the one next door, over
 * the same nine states: **every state answers « what is happening » in words a
 * rep reads, and a button does not count.** The table is the instrument — the
 * two failing states are found by enumeration rather than named, and a tenth
 * state added to the machine does not compile until somebody has answered for
 * it.
 *
 * jsdom measures every box as zero, so nothing here asserts a geometry. The
 * strip's height, the reading measure and the objet's width are measured on the
 * shipped renderer through `scripts/harness/shot.mjs`; what is asserted here is
 * what the screen *says*, which is the half a screenshot cannot check either.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Meeting, MeetingState } from '../../../../electron/core/contracts/meeting.ts'
import { MeetingStateSchema } from '../../../../electron/core/contracts/meeting.ts'
import type { CalendarEvent } from '../../../../electron/core/contracts/calendar.ts'
import type { RecipeId } from '../../../../electron/core/contracts/recipes.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../../test/appBridge.ts'
import { Session } from '../../Session.tsx'
import { farSide } from '../ArmedBrief.tsx'

let bridge: FakeBridge
let uninstall: () => void

const REP = {
  name: 'Julien Marchand',
  email: 'julien.marchand@synapse-it.fr',
  type: 'required' as const,
  response: 'organizer' as const,
}
const guest = (name: string, email: string) => ({
  name,
  email,
  type: 'required' as const,
  response: 'accepted' as const,
})

/** 16:00 → 17:00 Paris on a fixed day, so « aujourd’hui » is decided by the clock. */
const START = Date.parse('2026-09-17T14:00:00Z')
const END = Date.parse('2026-09-17T15:00:00Z')

const EVENT: CalendarEvent = {
  id: 'evt-delcourt',
  isCancelled: false,
  isAllDay: false,
  lastModified: START,
  context: {
    eventId: 'evt-delcourt',
    subject: 'Banque Delcourt — négociation du cadre tarifaire 2026',
    agenda: '',
    organizer: REP,
    attendees: [
      guest('Anne-Laure Girard', 'al.girard@banque-delcourt.fr'),
      guest('Pierre Vasseur', 'pierre.vasseur@banque-delcourt.fr'),
    ],
    onlineMeetingJoinUrl: null,
    categories: [],
    sensitivity: 'normal',
    scheduledStart: START,
    scheduledEnd: END,
    seriesMasterId: null,
    timeZone: 'Europe/Paris',
  },
}

/**
 * **`clientName: null`, and it is the product's answer rather than a shortcut.**
 *
 * `Agenda.#arm` hands `orchestrator.create` the event's context and no client
 * name, so `Projections` writes null; the account is resolved against VerySwing
 * at the gate (DEC-7). A fixture that filled it in would be a fixture simpler
 * than the product, and it would hide the one thing the brief has to say about
 * that field.
 */
const meeting = (state: MeetingState, eventId: string | null = 'evt-delcourt'): Meeting => ({
  id: 'm-delcourt',
  state,
  title: 'Banque Delcourt — négociation du cadre tarifaire 2026',
  eventId,
  clientName: null,
  scheduledStart: START,
  createdAt: START,
  startedAt: state === 'idle' || state === 'armed' ? null : START,
  endedAt: null,
  confirmedAt: null,
  updatedAt: START,
})

/**
 * Which states the product would have put a compte-rendu on — the same table
 * `session-outcome.test.tsx` keeps, and for its reason: nothing reaches
 * `awaiting_confirmation` without one, and its two successors are downstream.
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
  aborted: false,
}

/**
 * **The rep's own notes, with a heading in them — and the fixture is the point.**
 *
 * `document: null` was the convenient fixture and it cannot exercise the rule
 * this file states. A rep who opens an armed meeting and types `# Banque
 * Delcourt` puts an `h1` in the accessibility tree, and a check counting
 * headings would then pass over the same blank screen it was written for — which
 * is this repo's first shape, a fixture that cannot reach the property it is
 * named after. Measured on the shipped renderer (`agenda` scenario, the session
 * screen): the only two headings it draws are `h1 « Néovia Santé — cadrage
 * data »` and `h2 « À retenir »`, both inside `.notepad`. So the fixture carries
 * the same shape, `spoken()` excludes that subtree, and deleting the exclusion
 * turns the `idle` and `armed` rows green with nothing on the screen.
 */
const NOTES_WITH_A_HEADING = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Banque Delcourt' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Préparer les trois profils.' }] },
  ],
}

const open = (
  state: MeetingState,
  options: { eventId?: string | null; events?: CalendarEvent[]; signedIn?: boolean } = {},
) => {
  const eventId = options.eventId === undefined ? 'evt-delcourt' : options.eventId
  bridge.when('meeting:get', () => ({
    meeting: meeting(state, eventId),
    segments: [],
    signals: [],
    document: NOTES_WITH_A_HEADING,
    compteRendu: HAS_COMPTE_RENDU[state] ? '# Delcourt\n\n## Résumé\n\nRien.\n' : null,
    recipe: 'besoin-commercial' as RecipeId,
  }))
  bridge.when('agenda:snapshot', () => ({
    events: options.events ?? [EVENT],
    syncedAt: START,
    window: { from: START - 86_400_000, to: START + 86_400_000 },
    armed: null,
    reason: '',
  }))
  bridge.when('auth:state', () =>
    options.signedIn === false
      ? ({ status: 'signedOut' } as const)
      : ({
          status: 'signedIn',
          account: {
            homeAccountId: 'h-julien',
            username: 'julien.marchand@synapse-it.fr',
            name: 'Julien Marchand',
            tenantId: 'synapse-it.onmicrosoft.com',
          },
        } as const),
  )
  bridge.when('enhancement:status', () =>
    state === 'extracting'
      ? ({ status: 'running', since: START } as const)
      : state === 'ended'
        ? ({ status: 'failed', reason: null } as const)
        : ({ status: 'idle' } as const),
  )
  bridge.when('health:snapshot', () => ({
    capture: { state: 'ok' as const },
    transcribe: { state: 'ok' as const },
    llm: { state: 'ok' as const },
    calendar: { state: 'ok' as const },
    crm: { state: 'ok' as const },
    mail: { state: 'ok' as const },
  }))
  return render(
    <Session meetingId="m-delcourt" onBack={() => {}} onReview={() => {}} onReglages={() => {}} />,
  )
}

/**
 * **What counts as the screen speaking**, and the list is deliberately generous
 * in every direction but one.
 *
 * A heading, a live region with text in it, or the accessible name of a live
 * region — which is what makes `recording` pass on its own terms: US-27 took the
 * *word* off that pill because the dot, the clock and the moving meter already
 * say it (DEC-38), and the pill carries `aria-label="Enregistrement en cours"`.
 * What is **not** on the list is a `button`. A control is an offer; it says what
 * the rep may do, never what the screen is, and accepting one is exactly how the
 * instrument next door stayed green over a screen with nothing on it.
 *
 * And **not the two content columns**. The notepad is a live ProseMirror view
 * holding the rep's own document, and it really does put headings in the tree —
 * driven on the `agenda` scenario, the session screen's only two are `h1
 * « Néovia Santé — cadrage data »` and `h2 « À retenir »`, both inside
 * `.notepad`. A rep who types `# Réunion` would otherwise satisfy this rule on
 * every screen in the product, which is a check measuring the fixture's content
 * instead of the product's. The same exclusion covers the `aside` columns: what
 * this asks is whether the app states the *session's* condition, never whether
 * the meeting's material happens to contain a sentence.
 */
const spoken = (): string[] => {
  const out: string[] = []
  for (const node of [
    ...screen.queryAllByRole('status'),
    ...screen.queryAllByRole('alert'),
    ...screen.queryAllByRole('heading'),
  ]) {
    if (node.closest('.notepad') !== null || node.closest('aside') !== null) continue
    const said = (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()
    // A clock on its own is a value, not a sentence: two characters of letters
    // is the floor, the same one `--echo` uses to tell a reading from a number.
    if (/\p{L}\p{L}/u.test(said)) out.push(said.replace(/\s+/g, ' '))
  }
  return out
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
  vi.setSystemTime(START)
})

afterEach(() => {
  cleanup()
  uninstall()
  vi.useRealTimers()
})

/**
 * **The one exemption, and what it stops measuring.**
 *
 * `awaiting_confirmation` fails the rule below on `main` and still fails it with
 * this round's fix in place — the check found a second state, not only the two
 * the story named. What that screen draws is the compte-rendu column and a
 * *Relire et valider*, and the product has no sentence for it: `STATE_REASON`
 * says « En attente de votre validation. » and that string reaches this screen
 * nowhere. `OutcomeNotice`'s own `SPEAKS_FOR` excuses it in exactly the terms
 * this file refutes — « `awaiting_confirmation` has *Relire et valider* ».
 *
 * It is left as a finding rather than fixed here, because the remedy is a
 * permanent strip on the *post-call* screen and that is a second story with its
 * own trade (US-25 spent this round taking two permanent sentences off the
 * session screen). What this exemption therefore **stops measuring**: whether a
 * rep who has just pressed *Terminer* is told, in words, that the wait is over
 * and what the machine is waiting on now.
 *
 * It is written to expire. The entry asserts the gap it excuses — no spoken
 * statement — as well as the ground it stands on — the document really is drawn
 * — so the day somebody gives that state a sentence, this test goes red and
 * whoever landed it deletes the entry. A blanket exemption that grows and never
 * shrinks is the rot `--echo`'s stale-allowance half exists to stop.
 */
const MUTE_FOR_NOW: ReadonlySet<MeetingState> = new Set<MeetingState>(['awaiting_confirmation'])

describe('every state of this screen says what it is, and a button is not saying it', () => {
  for (const state of MeetingStateSchema.options) {
    if (MUTE_FOR_NOW.has(state)) continue
    test(`${state}`, async () => {
      open(state)
      await waitFor(() => screen.getByRole('button', { name: '‹ Calendrier' }))
      await waitFor(() => {
        const said = spoken()
        const buttons = screen.queryAllByRole('button').map((b) => b.textContent?.trim() ?? '')
        expect(
          said.length > 0,
          `« ${state} » ne dit rien : ${buttons.length} contrôle(s) ` +
            `${JSON.stringify(buttons)} et aucune phrase. Un bouton est une offre, ` +
            'pas un état.',
        ).toBe(true)
      })
    })
  }

  for (const state of MUTE_FOR_NOW) {
    test(`${state} est dispensé — et la dispense est datée`, async () => {
      open(state)
      await waitFor(() => screen.getByRole('button', { name: 'Relire et valider' }))
      // The ground the exemption stands on: there is a document on screen. Take
      // it away and the exemption is excusing a blank screen.
      await waitFor(() => expect(screen.getByText('Résumé')).toBeTruthy())
      expect(
        spoken(),
        `« ${state} » dit désormais quelque chose : supprimez-le de MUTE_FOR_NOW ` +
          'et laissez-le passer la règle comme les huit autres.',
      ).toEqual([])
    })
  }
})

describe('what the armed screen states, and what it refuses to invent', () => {
  test('the hour and the far side come from the calendar, and the rep is not on it', async () => {
    open('armed')
    const brief = await screen.findByRole('heading', { level: 2 })
    const strip = brief.parentElement as HTMLElement

    await waitFor(() => expect(strip.textContent).toContain('de 16:00 à 17:00'))
    expect(strip.textContent).toContain('aujourd’hui')
    expect(strip.textContent).toContain('Anne-Laure Girard')
    expect(strip.textContent).toContain('Pierre Vasseur')
    // « En face » is the other side of the call, and the rep is not on it.
    expect(strip.textContent).not.toContain('Julien Marchand')
  })

  test('it says the recording has not begun and names the press that begins it', async () => {
    open('armed')
    const brief = await screen.findByRole('heading', { level: 2 })
    const strip = brief.parentElement as HTMLElement

    expect(brief.textContent).toContain('rien n’est encore enregistré')
    await waitFor(() => expect(strip.textContent).toContain('Démarrer'))
    // And the control it names is really there, unpressed.
    expect(screen.getByRole('button', { name: 'Démarrer' })).toBeTruthy()
  })

  test('the empty client field is accounted for, and nothing fills it', async () => {
    open('armed')
    const brief = await screen.findByRole('heading', { level: 2 })
    const strip = brief.parentElement as HTMLElement

    await waitFor(() => expect(strip.textContent).toContain('VerySwing'))
    /*
      DEC-7, and the reason this assertion is here rather than in a comment: the
      obvious way to « fill the emptiest screen in the app » is to parse the
      client out of the objet line, which is exactly the invented deterministic
      fact the decision forbids.
    */
    expect((screen.getByLabelText('Client') as HTMLInputElement).value).toBe('')
    expect(strip.textContent).not.toContain('Banque Delcourt')
  })

  test('a call with no invitation says so rather than naming nobody', async () => {
    open('armed', { eventId: null })
    const brief = await screen.findByRole('heading', { level: 2 })
    const strip = brief.parentElement as HTMLElement

    await waitFor(() => expect(strip.textContent).toContain('n’a pas d’invitation'))
    // The meeting's own anchor survives a calendar that knows nothing about it.
    expect(strip.textContent).toContain('à 16:00')
    expect(strip.textContent).not.toContain('En face')
  })

  test('an invitation the calendar no longer holds degrades to the meeting’s own hour', async () => {
    open('armed', { events: [] })
    const brief = await screen.findByRole('heading', { level: 2 })
    const strip = brief.parentElement as HTMLElement

    await waitFor(() => expect(strip.textContent).toContain('à 16:00'))
    expect(strip.textContent).not.toContain('Anne-Laure Girard')
  })

  test('it is gone the moment the recording starts', async () => {
    open('recording')
    await waitFor(() => screen.getByRole('button', { name: 'Terminer' }))
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    /*
      And the two reads it needs are not made on the call. DEC-26: the capture
      path has no network dependency, and `agenda:snapshot` is the Graph fold.
    */
    expect(bridge.calls.map((call) => call.channel)).not.toContain('agenda:snapshot')
  })
})

describe('the far side, as Graph spells it', () => {
  const ctx = EVENT.context

  test('the organiser is on the list when the organiser is the client', () => {
    const theirs = {
      ...ctx,
      organizer: guest('Anne-Laure Girard', 'al.girard@banque-delcourt.fr'),
      attendees: [REP, guest('Pierre Vasseur', 'pierre.vasseur@banque-delcourt.fr')],
    }
    expect(farSide(theirs, REP.email)).toEqual(['Anne-Laure Girard', 'Pierre Vasseur'])
  })

  test('the rep is removed whichever half of the invitation they are in', () => {
    expect(farSide(ctx, REP.email)).toEqual(['Anne-Laure Girard', 'Pierre Vasseur'])
    expect(farSide({ ...ctx, attendees: [REP, ...ctx.attendees] }, REP.email)).toEqual([
      'Anne-Laure Girard',
      'Pierre Vasseur',
    ])
  })

  test('a room is not a person', () => {
    const withRoom = {
      ...ctx,
      attendees: [
        ...ctx.attendees,
        { name: 'Salle Vercors', email: 'vercors@synapse-it.fr', type: 'resource' as const, response: 'accepted' as const },
      ],
    }
    expect(farSide(withRoom, REP.email)).toEqual(['Anne-Laure Girard', 'Pierre Vasseur'])
  })

  test('signed out, nothing is removed — there is no « me » to remove', () => {
    expect(farSide(ctx, null)).toEqual([
      'Julien Marchand',
      'Anne-Laure Girard',
      'Pierre Vasseur',
    ])
  })

  test('an attendee with no name is named by the address Graph gave', () => {
    const anonymous = { ...ctx, attendees: [guest('', 'achats@banque-delcourt.fr')] }
    expect(farSide(anonymous, REP.email)).toEqual(['achats@banque-delcourt.fr'])
  })
})
