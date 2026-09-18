/**
 * **One verb, one act — over every control the home screen draws.**
 *
 * ## What it caught
 *
 * The calendar is the screen a rep opens every morning and it carried the
 * product's capture verb on two controls, neither of which captures. Driven
 * through the shipped `Agenda` with an armed row and an upcoming invite on one
 * day — which is an ordinary Tuesday, not a contrived state:
 *
 *     VERBS ON SCREEN: ["Démarrer une réunion","Enregistrer","Enregistrer"]
 *     PRESS «Enregistrer» #0: channels=[]                             navigated=true
 *     PRESS «Enregistrer» #1: channels=["agenda:arm","agenda:snapshot","meeting:list"]
 *     PRESS «Démarrer une réunion»: channels=["meeting:create","session:command", …]
 *
 * Two rectangles of the same size, the same word, 70 px apart, doing two
 * different things — and the *only* control on the screen that dispatches
 * `session:command { start }` is the one whose word is not « Enregistrer ».
 * `Session.tsx` calls that press *Démarrer*; so does the header. So the capture
 * verb was on the two presses that do not capture, on the primary screen, in
 * front of HR-7's « armed is an offer, never a recording ».
 *
 * Neither half was visible to anything that existed:
 *
 *  · `Agenda.test.tsx` asserted « the armed row says *Enregistrer*, not *Ouvrir*:
 *    those are two different acts » — the defect written down as the
 *    requirement — and the test directly under it, « the armed row opens the
 *    meeting the agenda already created », proved the act was `onOpen` and
 *    nothing else. Both passed. Neither compared them.
 *  · `DayPane.test.tsx` renders one row at a time, so no fixture of its could
 *    ever hold two labels to compare.
 *  · `shot.mjs`'s `agenda-appel-imprevu` asserted « at least one *Enregistrer* »
 *    and `agenda-demarrer-tot` « at least two », so both got louder as the
 *    collision got worse.
 *
 * ## Why it is written this way
 *
 * **The act is executed, never declared.** No `data-act`, no attribute the
 * component sets for the benefit of a test — a marker like that is a second
 * statement of the same fact, and the two drift. What a control *does* is the
 * set of IPC channels a press reaches plus whether it navigates, and
 * `FakeBridge` already records every invoke. Pressing it is the only honest way
 * to ask.
 *
 * **It reads the whole screen, not a row.** The rule is « how many acts hide
 * under one word on this screen », and the subject of that question is the
 * screen. So the test enumerates every control the day list and the backlog
 * draw, presses each one on a fresh render, and asserts the label → act map is a
 * function *and* injective: no word may cover two acts, and no act may go by two
 * words. A check that read one row could not see either direction.
 *
 * `Démarrer une réunion` is deliberately in the census. It is the act the other
 * two were claiming, and leaving it out would let the capture verb wander back
 * onto a row while the three words stayed pairwise distinct.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CalendarEvent } from '../../../../electron/core/contracts/calendar.ts'
import type { Meeting } from '../../../../electron/core/contracts/meeting.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../../test/appBridge.ts'
import { Agenda } from '../../Agenda.tsx'

let bridge: FakeBridge
let uninstall: () => void

/** Today at `h:m`, in the machine's own zone — the screen selects the Paris day. */
const at = (h: number, m = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

const event = (id: string, subject: string, hour: number): CalendarEvent => ({
  id,
  isCancelled: false,
  isAllDay: false,
  lastModified: 1000,
  context: {
    eventId: id,
    subject,
    agenda: '',
    organizer: { name: 'Moi', email: 'moi@esn.fr', type: 'required', response: 'organizer' },
    attendees: [
      { name: 'M. Dupont', email: 'dupont@acme.fr', type: 'required', response: 'accepted' },
    ],
    onlineMeetingJoinUrl: null,
    categories: [],
    sensitivity: 'normal',
    scheduledStart: at(hour),
    scheduledEnd: at(hour) + 3_600_000,
    seriesMasterId: null,
    timeZone: 'Europe/Paris',
  },
})

const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  state: 'idle',
  title: 'Point',
  eventId: null,
  clientName: null,
  scheduledStart: null,
  createdAt: 1,
  startedAt: null,
  endedAt: null,
  confirmedAt: null,
  updatedAt: 1,
  ...over,
})

/**
 * **An ordinary afternoon**, and every row grammar the day list can draw is in
 * it: an armed invite, two invites still ahead with no meeting behind them, a
 * call already held and awaiting the gate, and one already validated.
 *
 * Hours are chosen so nothing here depends on the wall clock the suite runs at:
 * `isPast` reads `scheduledEnd + OVERRUN_GRACE_MS`, so the two « ahead » rows
 * are placed at 23:00 and 23:30 and the two held ones at 00:00 and 01:00.
 */
const anOrdinaryAfternoon = () => {
  bridge
    .when('auth:state', () => ({
      status: 'signedIn',
      account: { homeAccountId: 'h1', username: 'r@esn.fr', name: 'R', tenantId: 't1' },
    }))
    .when('agenda:snapshot', () => ({
      events: [
        event('e-armee', 'Acme — cadrage', 22),
        event('e-a-venir-1', 'Nordis — suivi', 23),
        event('e-a-venir-2', 'Delcourt — tarifs', 23),
        event('e-tenue', 'Lefort — CV', 0),
      ],
      syncedAt: Date.now(),
      window: { from: 0, to: 0 },
      armed: { meetingId: 'm-armee', eventId: 'e-armee', subject: 'Acme — cadrage' },
      reason: '',
    }))
    .when('meeting:list', () => [
      meeting({ id: 'm-armee', state: 'armed', eventId: 'e-armee', title: 'Acme — cadrage' }),
      meeting({
        id: 'm-tenue',
        state: 'awaiting_confirmation',
        eventId: 'e-tenue',
        title: 'Lefort — CV',
        startedAt: at(0),
        endedAt: at(1),
      }),
    ])
    .when('agenda:arm', () => ({ meetingId: 'm-neuve' }))
    .when('agenda:snapshot', () => ({
      events: [
        event('e-armee', 'Acme — cadrage', 22),
        event('e-a-venir-1', 'Nordis — suivi', 23),
        event('e-a-venir-2', 'Delcourt — tarifs', 23),
        event('e-tenue', 'Lefort — CV', 0),
      ],
      syncedAt: Date.now(),
      window: { from: 0, to: 0 },
      armed: { meetingId: 'm-armee', eventId: 'e-armee', subject: 'Acme — cadrage' },
      reason: '',
    }))
    .when('meeting:create', (payload) =>
      meeting({ id: 'm-creee', title: payload.title ?? '', scheduledStart: null }),
    )
    .when('session:command', () => ({ ok: true, state: 'recording' }))
    .when('history:search', (payload) => ({
      query: payload.query ?? '',
      filter: {
        client: payload.filter?.client ?? null,
        periode: payload.filter?.periode ?? 'toute',
        statut: payload.filter?.statut ?? 'tous',
        intention: payload.filter?.intention ?? 'toutes',
      },
      rows: [],
      clients: [],
      scanned: 0,
      capped: false,
    }))
}

/** Every control on the screen that offers a way into a meeting. */
const VERBS = /^(Ouvrir|Préparer|Enregistrer|Démarrer une réunion|Démarrer)$/

const labelsOnScreen = (): string[] =>
  [...document.querySelectorAll('button')]
    .map((button) => (button.textContent ?? '').trim())
    .filter((label) => VERBS.test(label))

/**
 * What a press *does*, as a string two presses can be compared on: the IPC
 * channels it reached, in order, plus whether the screen navigated.
 *
 * Channels and not a hand-written name, because a name is a declaration and the
 * point of this file is that a declaration is what drifted.
 */
interface Act {
  label: string
  channels: string[]
  navigated: boolean
}

const pressEvery = async (): Promise<Act[]> => {
  const labels = labelsOnScreen()
  const acts: Act[] = []

  for (let index = 0; index < labels.length; index += 1) {
    // A fresh render per press: arming changes the list under us, and a census
    // taken across a mutating screen is a census of two screens.
    cleanup()
    const opened: string[] = []
    anOrdinaryAfternoon()
    render(<Agenda onOpen={(id) => opened.push(id)} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')

    const here = [...document.querySelectorAll('button')].filter((button) =>
      VERBS.test((button.textContent ?? '').trim()),
    )
    const button = here[index]
    if (button === undefined) throw new Error(`le contrôle ${index} a disparu entre deux rendus`)
    const label = (button.textContent ?? '').trim()

    const before = bridge.calls.length
    fireEvent.click(button)
    // Long enough for the handler's awaits to settle; the debounced search that
    // the screen fires on its own is excluded below rather than waited out.
    await new Promise((resolve) => setTimeout(resolve, 60))

    acts.push({
      label,
      channels: bridge.calls
        .slice(before)
        .map((call) => call.channel)
        // The backlog re-asks itself on a timer of its own. It is not an act.
        .filter((channel) => channel !== 'history:search'),
      navigated: opened.length > 0,
    })
  }
  return acts
}

const signature = (act: Act): string => `${act.channels.join('+') || '—'} / nav=${act.navigated}`

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})
afterEach(() => {
  cleanup()
  uninstall()
})

describe('one verb, one act', () => {
  test('no word on the calendar covers two different acts', async () => {
    anOrdinaryAfternoon()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')

    const acts = await pressEvery()

    const byLabel = new Map<string, Set<string>>()
    for (const act of acts) {
      const seen = byLabel.get(act.label) ?? new Set<string>()
      seen.add(signature(act))
      byLabel.set(act.label, seen)
    }

    const ambiguous = [...byLabel]
      .filter(([, seen]) => seen.size > 1)
      .map(([label, seen]) => `« ${label} » → ${[...seen].join('  |  ')}`)

    expect(
      ambiguous,
      'un même mot pour deux actes différents sur l’écran d’accueil',
    ).toEqual([])
  })

  test('no act on the calendar goes by two different words', async () => {
    anOrdinaryAfternoon()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')

    const acts = await pressEvery()

    const byAct = new Map<string, Set<string>>()
    for (const act of acts) {
      const seen = byAct.get(signature(act)) ?? new Set<string>()
      seen.add(act.label)
      byAct.set(signature(act), seen)
    }

    const doubled = [...byAct]
      .filter(([, words]) => words.size > 1)
      .map(([act, words]) => `${act} → ${[...words].join(' / ')}`)

    expect(doubled, 'un même acte sous deux mots différents').toEqual([])
  })

  /**
   * **The capture verb belongs to the press that opens the microphone.**
   *
   * The two checks above are about *distinctness* and a screen can be perfectly
   * distinct and still lie: rename the header to « Ouvrir 2 » and they both pass.
   * This one names the fact — exactly one control on this screen dispatches
   * `session:command`, and it is the one that says *Démarrer*.
   */
  test('only the control that says Démarrer reaches session:command', async () => {
    anOrdinaryAfternoon()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')

    const acts = await pressEvery()
    const recording = acts.filter((act) => act.channels.includes('session:command'))

    expect(recording.map((act) => act.label)).toEqual(['Démarrer une réunion'])
    for (const act of acts) {
      if (act.channels.includes('session:command')) continue
      expect(
        /enregistr/i.test(act.label),
        `« ${act.label} » porte le verbe de capture et n’atteint pas session:command — ${signature(act)}`,
      ).toBe(false)
    }
  })
})
