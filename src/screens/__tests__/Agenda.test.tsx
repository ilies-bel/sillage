/**
 * The calendar screen (DEC-31), and the two conditions that decision turns on.
 *
 * **The calendar is always drawn.** With `auth.status !== 'signedIn'` and on a
 * completely empty day. The first two blocks below assert the grid is *there* —
 * its month heading, its seven columns, its forty-two cells, the day the rep
 * can click — rather than merely that nothing threw. An empty grey box where
 * the calendar belongs is the specific failure DEC-31 names, and a test that
 * only checks for the absence of a crash would pass with one on screen.
 *
 * The rest are the guarantees that came with the screen it replaced:
 *
 *  - **HR-7: armed is an offer, never a recording.** Nothing here may start a
 *    session on its own. Opening one is a click.
 *  - **It works with no calendar at all.** Without an Entra registration the
 *    list is empty, the reason says so, and *Nouvelle réunion* is still there —
 *    because without Graph it is the only way into the product.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarEvent } from '../../../electron/core/contracts/calendar.ts'
import type {
  HistoryRow,
  HistorySearchResult,
} from '../../../electron/core/contracts/history.ts'
import type { InvokeRequest } from '../../../electron/core/contracts/ipc.ts'
import type { Meeting } from '../../../electron/core/contracts/meeting.ts'
import {
  addDays,
  atParis,
  dayKeyOf,
  monthMatrix,
  noonOf,
  spanOf,
  weekOf,
  type DayKey,
} from '../../app/calendar.ts'
import { formatDayLong } from '../../app/format.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Agenda } from '../Agenda.tsx'

let bridge: FakeBridge
let uninstall: () => void

const today = (): DayKey => dayKeyOf(Date.now())

// Inside today, whatever day the suite runs on — the screen selects the Paris
// day, so a fixed date would make this pass only in August 2026.
const at = (hour: number, minute = 0) => {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

const event = (
  id: string,
  subject: string,
  startHour: number,
  day: DayKey = today(),
): CalendarEvent => {
  const start = day === today() ? at(startHour) : atParis(day, startHour, 0)
  return {
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
      scheduledStart: start,
      scheduledEnd: start + 3_600_000,
      seriesMasterId: null,
      timeZone: 'Europe/Paris',
    },
  }
}

const meeting = (id: string, over: Partial<Meeting> = {}): Meeting => ({
  id,
  state: 'idle',
  title: 'Point Acme',
  eventId: null,
  clientName: 'Acme SA',
  scheduledStart: null,
  createdAt: 1,
  startedAt: null,
  endedAt: null,
  confirmedAt: null,
  updatedAt: 1,
  ...over,
})

/** The grid, as the rep reaches it: a named region, not a div nobody can find. */
const grid = () => screen.getByRole('region', { name: 'Calendrier' })

/** One day cell, by the French date its accessible name opens with. */
const cell = (day: DayKey) =>
  within(grid()).getByRole('button', { name: new RegExp(`^${formatDayLong(noonOf(day))},`) })

/**
 * The search's answer, as the main process would give it: already narrowed,
 * echoing back both halves of the question so a stale one can be dropped.
 */
const searched = (over: Partial<HistorySearchResult> = {}) =>
  bridge.when('history:search', (payload) => ({
    query: payload.query ?? '',
    filter: {
      client: payload.filter?.client ?? null,
      periode: payload.filter?.periode ?? 'toute',
      statut: payload.filter?.statut ?? 'tous',
      intention: payload.filter?.intention ?? 'toutes',
    },
    scanned: 0,
    clients: [],
    rows: [],
    ...over,
  }))

const historyRow = (over: Partial<Meeting> = {}): HistoryRow => ({
  meeting: meeting('m-hist', { title: 'Acme — restitution', ...over }),
  status: 'Validée',
  intents: [],
  matches: [{ where: 'transcript', excerpt: '…plutôt sur un TJM de 520 euros…' }],
})

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
  bridge.when('meeting:list', () => [])
  searched()
})

afterEach(() => {
  cleanup()
  uninstall()
})

const signedOut = () =>
  bridge
    .when('auth:state', () => ({ status: 'signedOut' }))
    .when('agenda:snapshot', () => ({
      events: [],
      syncedAt: 0,
      armed: null,
      reason: 'application Entra non configurée',
    }))

// ── DEC-31, condition one ───────────────────────────────────────────────────

describe('the calendar is drawn with no Microsoft account at all', () => {
  test('a signed-out rep gets the grid itself, not a panel where the grid belongs', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)

    // The grid, by its parts: seven weekday columns and six weeks of cells.
    const calendar = await screen.findByRole('region', { name: 'Calendrier' })
    expect(within(calendar).getAllByRole('columnheader')).toHaveLength(7)
    expect(within(calendar).getAllByRole('cell')).toHaveLength(42)

    // Today is in it, it is marked as today, and it is selected — so the rep
    // is looking at a day, not at an invitation to connect something.
    const current = cell(today())
    expect(current.getAttribute('aria-current')).toBe('date')
    expect(current.getAttribute('aria-pressed')).toBe('true')

    // And the way in is on screen, because without Graph it is the only one.
    expect(screen.getByRole('button', { name: 'Démarrer une réunion' })).toBeTruthy()
  })

  test('the calendar is navigable while signed out — months page, days select', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    const tomorrow = addDays(today(), 1)
    fireEvent.click(cell(tomorrow))
    expect(cell(tomorrow).getAttribute('aria-pressed')).toBe('true')

    // Paging keeps a grid on screen rather than emptying the column.
    fireEvent.click(within(grid()).getByRole('button', { name: 'Mois suivant' }))
    expect(within(grid()).getAllByRole('cell')).toHaveLength(42)
  })

  test('the sign-in state never becomes an app-level failure (DEC-26, DEC-32)', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)

    // Graph's own words, in the pane it affects. Not a banner, and not a
    // sentence claiming the product is unavailable.
    expect(await screen.findByText('application Entra non configurée')).toBeTruthy()
    expect(screen.queryByText(/indisponible/i)).toBeNull()
  })
})

// ── DEC-31, condition two ───────────────────────────────────────────────────

describe('the calendar is drawn on a day with nothing in it', () => {
  test('an empty day keeps the grid and says what is empty, and why', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [],
        syncedAt: Date.now(),
        armed: null,
        reason: 'aucune réunion dans la fenêtre de synchronisation',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)

    const calendar = await screen.findByRole('region', { name: 'Calendrier' })
    expect(within(calendar).getAllByRole('cell')).toHaveLength(42)
    expect(screen.getByText('Aucune réunion à venir.')).toBeTruthy()
    expect(
      screen.getByText('aucune réunion dans la fenêtre de synchronisation'),
    ).toBeTruthy()
  })

  test('an empty day is stated in the cell itself, not left to the colour of a dot', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    expect(cell(today()).getAttribute('aria-label')).toMatch(/aucune réunion$/)
  })

  test('a meeting can be created on an empty day, which is the point of drawing it', async () => {
    const opened: string[] = []
    const thursday = addDays(today(), 2)
    signedOut().when('meeting:create', () =>
      meeting('man-2', { scheduledStart: atParis(thursday, 9, 0) }),
    )

    render(<Agenda onOpen={(id) => opened.push(id)} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    // Another day keeps its form: this is scheduling, not a call about to start,
    // so the control names the day and asks for the hour (DEC-31).
    fireEvent.click(cell(thursday))
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter au / }))
    fireEvent.change(screen.getByPlaceholderText('Objet (facultatif)'), {
      target: { value: 'Cadrage Nordis' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    })

    const created = bridge.calls.find((c) => c.channel === 'meeting:create')
    expect(created?.payload).toEqual({
      title: 'Cadrage Nordis',
      clientName: null,
      // The day the rep chose, at the hour the field defaults to, in Paris.
      scheduledStart: atParis(thursday, 9, 0),
    })
    // A call that is two days away is not a session to sit in, and nothing
    // starts recording for it (HR-7).
    expect(opened).toEqual([])
    expect(bridge.calls.some((c) => c.channel === 'session:command')).toBe(false)
  })
})

// ── The day, the week, the month, the list ──────────────────────────────────

describe('a rep can select any day and see it', () => {
  test('the day list follows the selection, and shows one day at a time', async () => {
    const tomorrow = addDays(today(), 1)
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10), event('e2', 'Nordis — suivi', 14, tomorrow)],
        syncedAt: Date.now(),
        armed: null,
        reason: '',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Acme — cadrage')
    expect(screen.queryByText('Nordis — suivi')).toBeNull()

    fireEvent.click(cell(tomorrow))
    expect(screen.getByText('Nordis — suivi')).toBeTruthy()
    expect(screen.queryByText('Acme — cadrage')).toBeNull()
  })

  test('a day that carries something is marked, and says so in words', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Acme — cadrage')

    // Colour is never the only signal (VISION.md §6): the count and the armed
    // state are in the cell's accessible name.
    expect(cell(today()).getAttribute('aria-label')).toMatch(/1 réunion, dont une prête$/)
  })

  test('Semaine widens the same list to the week, without moving the grid', async () => {
    // Another day of *this* week, whichever weekday the suite runs on — the
    // one day guaranteed to be outside Jour and inside Semaine.
    const elsewhere = weekOf(today()).find((day) => day !== today()) as DayKey
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e2', 'Nordis — suivi', 14, elsewhere)],
        syncedAt: Date.now(),
        armed: null,
        reason: '',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    expect(screen.queryByText('Nordis — suivi')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Semaine' }))
    expect(screen.getByText('Nordis — suivi')).toBeTruthy()
    // The grid does not narrow with the view — it is the month grid in all
    // four (VISION.md §6), and only the list beside it changes span.
    expect(within(grid()).getAllByRole('cell')).toHaveLength(42)

    fireEvent.click(screen.getByRole('button', { name: 'Mois' }))
    expect(screen.getByText('Nordis — suivi')).toBeTruthy()
  })

  test('the four views are one control, and exactly one of them is on', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)

    const control = await screen.findByRole('group', { name: 'Période affichée' })
    const pressed = within(control)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toBe('Jour')

    for (const label of ['Jour', 'Semaine', 'Mois', 'Liste']) {
      expect(within(control).getByRole('button', { name: label })).toBeTruthy()
    }
  })
})

describe('meetings already held are reachable from the calendar', () => {
  test('a past meeting is under Passées, with its state', async () => {
    const yesterday = addDays(today(), -1)
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({ events: [], syncedAt: Date.now(), armed: null, reason: '' }))
      .when('meeting:list', () => [
        meeting('m-past', {
          title: 'Acme — restitution',
          state: 'done',
          scheduledStart: atParis(yesterday, 10, 0),
          startedAt: atParis(yesterday, 10, 0),
          endedAt: atParis(yesterday, 11, 0),
        }),
      ])

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    // Not on today — it is filed under the day it was held.
    expect(screen.queryByText('Acme — restitution')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Liste' }))
    expect(screen.getByText('Passées')).toBeTruthy()
    expect(screen.getByText('Acme — restitution')).toBeTruthy()
    expect(screen.getByText('Validée')).toBeTruthy()
  })

  test('a meeting created in the app sits in the grid beside the ones from Outlook', async () => {
    const thursday = addDays(today(), 3)
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        armed: null,
        reason: '',
      }))
      .when('meeting:list', () => [
        meeting('man-9', { title: 'Nordis — appel', scheduledStart: atParis(thursday, 9, 0) }),
      ])

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Acme — cadrage')

    // The mark reaches the accessible name, and each mark says a different
    // thing. This used to assert the bare count, which passed precisely because
    // `captured` and `scheduled` both fell through to it — a recorded meeting
    // and an untouched invite announced identically, while the legend under the
    // grid promised three distinguishable states.
    //
    // Note what this pins: `man-9` has never been recorded, and it is `captured`
    // all the same, because `entries.ts` reads the mark off `entry.meetingId`.
    // So the mark means "a meeting row exists here", and both the legend
    // (« réunion enregistrée ») and this name overstate it. Left as-is —
    // changing what the middle mark *means* is a design decision about the
    // legend and the dot, not a rename.
    expect(cell(thursday).getAttribute('aria-label')).toMatch(/1 réunion, dont une enregistrée$/)
    fireEvent.click(cell(thursday))
    expect(screen.getByText('Nordis — appel')).toBeTruthy()
  })

  test('a meeting armed from an invite is one row, not two', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))
      .when('meeting:list', () => [
        meeting('evt-abc', { title: 'Acme — cadrage', eventId: 'e1', state: 'armed' }),
      ])

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Acme — cadrage')

    expect(screen.getAllByText('Acme — cadrage')).toHaveLength(1)
    expect(cell(today()).getAttribute('aria-label')).toMatch(/1 réunion, dont une prête$/)
  })
})

// ── What the screen carried before, and still does ──────────────────────────

describe('with no calendar the product still works', () => {
  test('an empty agenda states the reason and still offers a manual start', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)

    expect(await screen.findByText('application Entra non configurée')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Démarrer une réunion' })).toBeTruthy()
  })

  /*
   * One click, and the meeting is recording.
   *
   * This used to be a form: *Nouvelle réunion*, an objet, *Démarrer* — and then
   * the session opened `idle` with a **second** *Démarrer* in its header. Two
   * presses and a required field in front of a rep walking into a call, on the
   * one product whose single unacceptable failure is not recording. The test
   * that lived beside this one asserted that a blank title never reached the
   * main process; a blank title is now the normal case, and asserting it is
   * *sent* is the same guarantee pointed the other way.
   */
  test('starting a meeting creates it, records it and opens it — on one click', async () => {
    const opened: string[] = []
    bridge
      .when('auth:state', () => ({ status: 'signedOut' }))
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, armed: null, reason: '' }))
      .when('meeting:create', () => meeting('man-1'))
      .when('session:command', () => ({ ok: true, state: 'recording' }))

    render(<Agenda onOpen={(id) => opened.push(id)} onHistorique={() => {}} onReglages={() => {}} />)

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Démarrer une réunion' }))
    })

    await waitFor(() => expect(opened).toEqual(['man-1']))

    // Nothing is asked for. Null is "now" — today never asks a rep what time it
    // is, and nothing stands in for the objet they have not typed yet.
    expect(bridge.calls.find((c) => c.channel === 'meeting:create')?.payload).toEqual({
      title: '',
      clientName: null,
      scheduledStart: null,
    })

    // HR-7 still holds: a human pressed *Démarrer*. What changed is that they
    // pressed it once, and that the recording is running by the time the session
    // screen mounts rather than a press later.
    expect(bridge.calls.find((c) => c.channel === 'session:command')?.payload).toMatchObject({
      meetingId: 'man-1',
      command: 'start',
    })
    expect(screen.queryByLabelText('Heure de la réunion')).toBeNull()
  })

  test('a refused start still opens the session rather than stranding the rep', async () => {
    const opened: string[] = []
    bridge
      .when('auth:state', () => ({ status: 'signedOut' }))
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, armed: null, reason: '' }))
      .when('meeting:create', () => meeting('man-1'))
      .when('session:command', () => {
        throw new Error('canal indisponible')
      })

    render(<Agenda onOpen={(id) => opened.push(id)} onHistorique={() => {}} onReglages={() => {}} />)

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Démarrer une réunion' }))
    })

    await waitFor(() => expect(opened).toEqual(['man-1']))
  })
})

describe('armed is an offer, never a recording (HR-7)', () => {
  test('rendering an armed meeting sends no command', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: 'Teams émet du son',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Acme — cadrage')

    // The screen may read. It may not act.
    expect(bridge.calls.every((c) => c.channel !== 'session:command')).toBe(true)
    expect(screen.getByText('Prêt')).toBeTruthy()
  })

  test('only the armed row offers a way in', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10), event('e2', 'Nordis — suivi', 14)],
        syncedAt: Date.now(),
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')

    // An unarmed row is information, not a control — a dead button on it is
    // exactly what DEC-26 forbids.
    expect(screen.getAllByRole('button', { name: 'Ouvrir' })).toHaveLength(1)
  })

  test('the armed row opens the meeting the agenda already created', async () => {
    const opened: string[] = []
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))

    render(<Agenda onOpen={(id) => opened.push(id)} onHistorique={() => {}} onReglages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }))

    expect(opened).toEqual(['evt-abc'])
  })
})

describe('the agenda is pushed, not polled', () => {
  test('an agenda:changed broadcast replaces the list', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedOut' }))
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, armed: null, reason: 'rien' }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('rien')

    await act(async () => {
      bridge.emit('agenda:changed', {
        events: [event('e9', 'Réunion arrivée par diffusion', 11)],
        syncedAt: Date.now(),
        armed: null,
        reason: '',
      })
    })

    expect(screen.getByText('Réunion arrivée par diffusion')).toBeTruthy()
  })

  test('cancelled events are not shown', async () => {
    const cancelled = { ...event('e3', 'Annulée', 9), isCancelled: true }
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [cancelled, event('e4', 'Maintenue', 15)],
        syncedAt: Date.now(),
        armed: null,
        reason: '',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Maintenue')
    expect(screen.queryByText('Annulée')).toBeNull()
  })
})

// ── The search, and Historique's new entry point (DEC-25, DEC-31) ───────────

/** The one field. Same accessible name on both screens, because it is one component. */
const box = () =>
  screen.getByLabelText('Rechercher un client, un sujet, une transcription ou une note')

/** Types into the box and waits out the debounce. */
const typeQuery = async (value: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(box(), { target: { value } })
    await new Promise((resolve) => setTimeout(resolve, 260))
  })
}

describe('the search is the only entry into the past', () => {
  test('there is no Historique link in the header any more', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    // VISION.md §6: *Historique* is not in the navigation. It is where the
    // search goes, and it is reached by typing — not by aiming at a word.
    expect(screen.queryByRole('button', { name: 'Historique' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Réglages' })).toBeTruthy()
    expect(box()).toBeTruthy()
  })

  test('the query and the chips go to the main process, not to a local list', async () => {
    const asked: InvokeRequest<'history:search'>[] = []
    bridge.when('history:search', (payload) => {
      asked.push(payload)
      return {
        query: payload.query ?? '',
        filter: {
          client: payload.filter?.client ?? null,
          periode: payload.filter?.periode ?? 'toute',
          statut: payload.filter?.statut ?? 'tous',
          intention: payload.filter?.intention ?? 'toutes',
        },
        scanned: 9,
        clients: ['Acme SA'],
        rows: [historyRow()],
      }
    })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('TJM')

    await waitFor(() => expect(asked.at(-1)?.query).toBe('TJM'))
    // The excerpt is the evidence, and it is a window — never the transcript
    // it was cut from.
    expect(await screen.findByText(/plutôt sur un TJM de 520 euros/)).toBeTruthy()

    const statut = screen.getByRole('group', { name: 'Statut' })
    await act(async () => {
      fireEvent.click(within(statut).getByRole('button', { name: 'Validées' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    await waitFor(() => expect(asked.at(-1)?.filter?.statut).toBe('validees'))
    expect(asked.at(-1)?.query).toBe('TJM')
  })

  test('the renderer never narrows a list of its own', async () => {
    // `meeting:list` holds a meeting whose title contains the query. The
    // search returned nothing. The screen says nothing matched — because it
    // has no corpus to search and never tries.
    bridge.when('meeting:list', () => [
      meeting('m-1', { title: 'Acme — TJM à revoir', clientName: 'Acme SA' }),
    ])
    searched({ rows: [] })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('TJM')

    expect(await screen.findByText('Aucun appel ne correspond.')).toBeTruthy()
    expect(screen.queryByText('Acme — TJM à revoir')).toBeNull()
  })

  test('a chip on its own is a search, with nothing typed', async () => {
    searched({ clients: [], rows: [historyRow()] })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    expect(screen.getByText('Aucune réunion à venir.')).toBeTruthy()

    const periode = screen.getByRole('group', { name: 'Période' })
    await act(async () => {
      fireEvent.click(within(periode).getByRole('button', { name: '30 jours' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    // « les réunions des 30 derniers jours » is a question, and it has no
    // query string. The day list gives way to the answer.
    expect(await screen.findByText('Acme — restitution')).toBeTruthy()
    expect(screen.queryByText('Aucune réunion à venir.')).toBeNull()
  })

  test('the view switch does not stay on screen over results it cannot change', async () => {
    searched({ rows: [historyRow()] })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    expect(await screen.findByRole('group', { name: 'Période affichée' })).toBeTruthy()

    await typeQuery('TJM')
    // Four buttons that change nothing is the dead control DEC-26 forbids.
    expect(screen.queryByRole('group', { name: 'Période affichée' })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    expect(screen.getByRole('group', { name: 'Période affichée' })).toBeTruthy()
  })

  test('the way into Historique carries the query and the chips', async () => {
    const opened: Array<[string, unknown]> = []
    searched({ clients: ['Acme SA'], rows: [historyRow()] })
    signedOut()

    render(
      <Agenda
        onOpen={() => {}}
        onHistorique={(query, filter) => opened.push([query, filter])}
        onReglages={() => {}}
      />,
    )
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('TJM')

    const client = await screen.findByRole('group', { name: 'Client' })
    await act(async () => {
      fireEvent.click(within(client).getByRole('button', { name: 'Acme SA' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Tout l’historique ›' }))
    expect(opened).toEqual([
      ['TJM', { client: 'Acme SA', periode: 'toute', statut: 'tous', intention: 'toutes' }],
    ])
  })

  /*
   * The regression this pins: the only link into *Historique* used to be the
   * last line of the result list, so it existed only once a search had matched
   * something. On a fresh install — no meetings, no transcripts, nothing to
   * match — the screen holding the whole record could not be opened at all.
   */
  test('Historique is reachable with an empty box and an empty corpus', async () => {
    const opened: Array<[string, unknown]> = []
    searched({ clients: [], rows: [] })
    signedOut()

    render(
      <Agenda
        onOpen={() => {}}
        onHistorique={(query, filter) => opened.push([query, filter])}
        onReglages={() => {}}
      />,
    )
    await screen.findByRole('region', { name: 'Calendrier' })

    fireEvent.click(await screen.findByRole('button', { name: 'Tout l’historique ›' }))
    expect(opened).toEqual([
      ['', { client: null, periode: 'toute', statut: 'tous', intention: 'toutes' }],
    ])
  })

  test('search works signed out and on an empty corpus, and the grid stays drawn', async () => {
    // No account, no meetings, no clients to offer. The store is local and owes
    // Graph nothing (DEC-26, DEC-32) — the search still answers, and the grid
    // is still a grid rather than a placeholder (DEC-31).
    signedOut()
    searched({ rows: [], clients: [] })

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('Acme')

    expect(await screen.findByText('Aucun appel ne correspond.')).toBeTruthy()
    expect(within(grid()).getAllByRole('cell')).toHaveLength(42)
    // A *Client* row holding only « Tous » is a control that does nothing.
    expect(screen.queryByRole('group', { name: 'Client' })).toBeNull()
    // And the way in is still there — without Graph it is the only one.
    expect(screen.getByRole('button', { name: 'Démarrer une réunion' })).toBeTruthy()
  })
})

describe('the calendar asks for the window it draws (meeting:list)', () => {
  const listCalls = (): InvokeRequest<'meeting:list'>[] =>
    bridge.calls
      .filter((call) => call.channel === 'meeting:list')
      .map((call) => call.payload as InvokeRequest<'meeting:list'>)

  test('a month grid asks for its own six weeks, not for the most recent N rows', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    const first = listCalls()[0]
    const weeks = monthMatrix(today())
    const span = spanOf(weeks[0][0], weeks[5][6])
    expect(first).toEqual({ limit: 500, from: span.from, to: span.to })
  })

  test('paging the grid moves the range, so a month a year back still has its rows', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    const before = listCalls().at(-1)
    await act(async () => {
      fireEvent.click(within(grid()).getByRole('button', { name: 'Mois précédent' }))
    })

    const after = listCalls().at(-1)
    expect(after?.from).toBeLessThan(before?.from as number)
    // The old `limit: 200` was a flat "most recently updated": paging back far
    // enough outran it and the dots quietly stopped appearing.
    expect(after?.to).toBeLessThan(before?.to as number)
  })

  test('Liste is the one view that asks for everything', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Liste' }))
    })

    expect(listCalls().at(-1)).toEqual({ limit: 500, from: null, to: null })
  })
})

const account = () => ({
  homeAccountId: 'h1',
  username: 'moi@esn.fr',
  name: 'Moi',
  tenantId: 't1',
})

// Guard against the suite silently passing because nothing rendered.
test('the fixtures are inside today, or these tests prove nothing', () => {
  vi.setSystemTime(new Date())
  const start = event('e1', 'x', 10).context.scheduledStart
  expect(new Date(start).toDateString()).toBe(new Date().toDateString())
  expect(dayKeyOf(start)).toBe(today())
})
