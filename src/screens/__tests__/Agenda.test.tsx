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
import { formatDayLong, formatMonthLong, upperFirst } from '../../app/format.ts'
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

/**
 * **Today, at a fixed hour — and the hour is the point.**
 *
 * `at()` is relative to the machine's clock on purpose: `dayKeyOf` selects the
 * Paris day, so a fixed *date* would make this suite pass only in the month it
 * was written. What was relative and should never have been is the **time of
 * day**, because `isPast` compares a fixture's end against `now`: every
 * assertion in this file about which rows carry a control was an assertion about
 * when the suite happened to run.
 *
 * Caught at 00:07, and it had been latent since the upcoming half of the list
 * grew its own *Enregistrer*. « only the armed row offers a way in » stages a
 * 14:00 invite as the unarmed row, so it passed in the afternoon — one
 * *Enregistrer*, the armed row's — and failed every morning, because at 00:07 a
 * 14:00 call is fourteen hours away and correctly carries the bordered
 * *Enregistrer* the upcoming list is supposed to have. A CI run before lunch
 * would have reported a defect that was not there, and, worse, the suite has
 * never once exercised the upcoming branch on a row it stages as past.
 *
 * 16:00 rather than a round midday: it is after the last fixture hour in the
 * file plus `OVERRUN_GRACE_MS`, which is the window these tests have in fact
 * been passing in. The two sides of `isPast` each have their own tests now,
 * driven at chosen instants (`agenda/__tests__/entries.test.ts`), which is where
 * a time-of-day question belongs.
 */
const SUITE_HOUR = 16

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const pinned = new Date()
  pinned.setHours(SUITE_HOUR, 0, 0, 0)
  vi.setSystemTime(pinned)
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
  bridge.when('meeting:list', () => [])
  searched()
})

afterEach(() => {
  cleanup()
  uninstall()
  vi.useRealTimers()
})

const signedOut = () =>
  bridge
    .when('auth:state', () => ({ status: 'signedOut' }))
    .when('agenda:snapshot', () => ({
      events: [],
      syncedAt: 0,
      window: { from: 0, to: 0 },
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
        window: { from: 0, to: 0 },
        armed: null,
        reason: 'aucune réunion dans la fenêtre de synchronisation',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)

    const calendar = await screen.findByRole('region', { name: 'Calendrier' })
    expect(within(calendar).getAllByRole('cell')).toHaveLength(42)
    expect(screen.getByText('Plus aucune réunion aujourd’hui.')).toBeTruthy()
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
    // so the control asks for the hour (DEC-31).
    //
    // On a day with nothing on it the control is the empty panel's own — the
    // header drops its copy rather than putting two of the same thing on one
    // screen, and the panel's is the one the rep is looking at.
    fireEvent.click(cell(thursday))
    expect(screen.queryByRole('button', { name: /^Ajouter au / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une réunion' }))
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
        window: { from: 0, to: 0 },
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
        window: { from: 0, to: 0 },
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
        window: { from: 0, to: 0 },
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
      .when('agenda:snapshot', () => ({ events: [], syncedAt: Date.now(), window: { from: 0, to: 0 }, armed: null, reason: '' }))
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
        window: { from: 0, to: 0 },
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
        window: { from: 0, to: 0 },
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

  /*
   * **The legend names what the day holds; the row names its state** (US-22's rule).
   *
   * The legend's middle entry was « prêt », which is `STATE_LABEL.armed` — so an
   * armed day drew that word twice, 248 pixels apart, once as the key for a 6px dot
   * and once as the condition of the row the dot points at. `shot.mjs --echo` found
   * it on `agenda-appel-imprevu` at both sizes; here it is pinned as a pair,
   * because a rename in either direction is silent to every other check.
   */
  test('the legend does not repeat the row’s state word', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))
      .when('meeting:list', () => [
        meeting('evt-abc', { title: 'Acme — cadrage', eventId: 'e1', state: 'armed' }),
      ])

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Acme — cadrage')

    // The row still says it, once, and the legend still explains the dot.
    expect(screen.getAllByText('Prêt')).toHaveLength(1)
    expect(within(grid()).getByText('réunion prête')).toBeTruthy()
    // And the accessible name of the cell says the same thing the legend does,
    // which is what `MARK_NAME`'s docblock promises and what « prêt » broke.
    expect(cell(today()).getAttribute('aria-label')).toMatch(/dont une prête$/)
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
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, window: { from: 0, to: 0 }, armed: null, reason: '' }))
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
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, window: { from: 0, to: 0 }, armed: null, reason: '' }))
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
        window: { from: 0, to: 0 },
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
        window: { from: 0, to: 0 },
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')

    /*
      An unarmed row is information, not a control — a dead button on it is
      exactly what DEC-26 forbids.

      And the armed one says *Enregistrer*, not *Ouvrir*: those are two
      different acts, and the row for the call that is starting now is the one
      control on this screen that should carry the weight. It used to wear the
      same outline as every other row while the filled primary in the header
      started a *different*, unscheduled meeting.
    */
    expect(screen.queryByRole('button', { name: 'Ouvrir' })).toBeNull()
    const record = screen.getByRole('button', { name: 'Enregistrer' })
    expect(record.className).toContain('bg-brand-700')
  })

  test('the armed row opens the meeting the agenda already created', async () => {
    const opened: string[] = []
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: { meetingId: 'evt-abc', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))

    render(<Agenda onOpen={(id) => opened.push(id)} onHistorique={() => {}} onReglages={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))

    expect(opened).toEqual(['evt-abc'])
  })
})

describe('the agenda is pushed, not polled', () => {
  test('an agenda:changed broadcast replaces the list', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedOut' }))
      .when('agenda:snapshot', () => ({ events: [], syncedAt: 0, window: { from: 0, to: 0 }, armed: null, reason: 'rien' }))

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('rien')

    await act(async () => {
      bridge.emit('agenda:changed', {
        events: [event('e9', 'Réunion arrivée par diffusion', 11)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
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
        window: { from: 0, to: 0 },
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
  test('the header carries no navigation — the rail does, and Réglages left it', async () => {
    const asked: string[] = []
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={(query) => asked.push(query)}
      onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    /*
      **The header holds the screen's subject and its controls, and no links.**

      *Réglages* was a word in it; it is in the rail's footer now, on every
      screen rather than on this one, which is what stops the same pane having
      two doors. *Historique* was never in it and still is not.
    */
    // The page header — the one holding the `h1`. The month grid has a `header`
    // of its own (its pager), which is why this is not `getByRole('banner')`.
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement
    expect(within(header).queryByRole('button', { name: 'Réglages' })).toBeNull()
    expect(within(header).queryByRole('button', { name: 'Historique' })).toBeNull()

    /*
      It is in the rail, and it is a destination there (V2). DEC-25's rule
      survives where it was aimed: the *query* is what opens the reader, so the
      rail opens it **empty** and the search box is still the only thing that
      carries a question into it.
    */
    const rail = screen.getByRole('navigation', { name: 'Navigation principale' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Historique' }))
    expect(asked).toEqual([''])

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
      meeting('m-hair', { title: 'Acme — TJM à revoir', clientName: 'Acme SA' }),
    ])
    searched({ rows: [] })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('TJM')

    expect(await screen.findByText('Aucun appel ne correspond.')).toBeTruthy()
    expect(screen.queryByText('Acme — TJM à revoir')).toBeNull()
  })

  /*
   * A meeting that reached the gate and was never confirmed is the product's
   * quietest failure: everything was captured and nothing was sent, and the rep
   * believes the call is filed. It is the one class of failure that does not
   * announce itself (DEC-26), so the home screen asks the question for them.
   */
  test('calls that were recorded and never validated are on the home screen', async () => {
    const yesterday = Date.now() - 86_400_000
    searched({
      clients: [],
      rows: [
        {
          ...historyRow({
            title: 'Nordis — cadrage support',
            clientName: null,
            createdAt: yesterday,
          }),
          status: 'À valider',
        },
      ],
    })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    expect(await screen.findByText('En attente de validation')).toBeTruthy()
    expect(screen.getByText('Nordis — cadrage support')).toBeTruthy()
    // Yesterday: the date on the left says it better than a number would.
    expect(screen.getByText('Rien n’a été envoyé')).toBeTruthy()
  })

  /*
   * « 27/08 » and « 09/09 » are the same pixel weight, and one of them is a
   * fortnight of a client's CRM being wrong. Past a week the row says so; below
   * it, it stays quiet, because « il y a 2 jours » on every row is a reproach
   * rather than a fact.
   */
  test('a gate left standing for a fortnight says how long', async () => {
    searched({
      clients: [],
      rows: [
        {
          ...historyRow({
            title: 'Lefort — découverte',
            clientName: null,
            createdAt: Date.now() - 14 * 86_400_000,
          }),
          status: 'À valider',
        },
      ],
    })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    expect(await screen.findByText('Rien n’a été envoyé depuis 14 jours')).toBeTruthy()
  })

  /**
   * The count is a fact about the rep's backlog, not about the day cell they
   * happen to have open. The day pane drops a pending call it is already
   * showing — the same meeting twice on one screen reads as two meetings — and
   * that de-duplication used to reach the number as well, so the backlog was
   * « 2 » on one day of the calendar and « 1 » on another with nothing having
   * changed.
   */
  test('the backlog states its own size, and the size does not move', async () => {
    const rows = [
      { ...historyRow({ title: 'Nordis — cadrage', clientName: null }), status: 'À valider' },
      { ...historyRow({ title: 'Lefort — CV' }), meeting: meeting('m-snug'), status: 'À valider' },
      { ...historyRow({ title: 'Sodexial — staffing' }), meeting: meeting('m-inline'), status: 'À valider' },
    ]
    searched({ clients: [], rows })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })

    // Scoped to the section: « 3 » is also a date in the grid behind it.
    const heading = await screen.findByText('En attente de validation')
    expect(heading.parentElement?.textContent).toContain('3')

    // All three are drawn, and none of them was dropped by the day pane's
    // de-duplication — these are not on the visible day.
    expect(screen.getAllByRole('button', { name: 'Ouvrir' })).toHaveLength(3)
  })

  test('a chip on its own is a search, with nothing typed', async () => {
    searched({ clients: [], rows: [historyRow()] })
    signedOut()

    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    expect(screen.getByText('Plus aucune réunion aujourd’hui.')).toBeTruthy()

    /*
     * The axes are not on the calendar until the rep asks for them: under a day
     * list, a permanent row of « 7 jours » and seven client names reads as a
     * filter on that list, and it is not one — pressing a chip *replaces* it.
     * Focusing the field is the ask, and it is the gesture that precedes
     * reaching for a chip anyway.
     */
    expect(screen.queryByRole('group', { name: 'Période' })).toBeNull()
    await act(async () => {
      fireEvent.focus(
        screen.getByLabelText('Rechercher un client, un sujet, une transcription ou une note'),
      )
    })

    const periode = screen.getByRole('group', { name: 'Période' })
    await act(async () => {
      fireEvent.click(within(periode).getByRole('button', { name: '30 jours' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    // « les réunions des 30 derniers jours » is a question, and it has no
    // query string. The day list gives way to the answer.
    expect(await screen.findByText('Acme — restitution')).toBeTruthy()
    expect(screen.queryByText('Plus aucune réunion aujourd’hui.')).toBeNull()
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

/*
 * ── the cap is the main process's answer, never the screen's arithmetic ───────
 *
 * `capped` has shipped on every reply since the channel existed and one screen
 * read it. These two counted their own rows against their own limit, which is
 * one *more* than the question: `rows.length >= limit` is true when a pane asked
 * for eight and was given eight with nothing behind them. Round 23 fixed the
 * same off-by-one in the handler; its regression test pins the copy on
 * *Historique* and by construction could not see either of these.
 *
 * Both directions, because a fix that simply never draws the sentence would pass
 * half of each of these — and the half it dropped is the one the rep is owed.
 */
describe('what is hidden is reported, and only when something is', () => {
  /** Answers the search with `rows`, and the pending question with `pending`. */
  const answering = (over: {
    rows?: readonly HistoryRow[]
    pending?: readonly HistoryRow[]
    capped?: boolean
    pendingCapped?: boolean
  }) =>
    bridge.when('history:search', (payload) => {
      const asking = payload.filter?.statut === 'a-valider'
      return {
        query: payload.query ?? '',
        filter: {
          client: payload.filter?.client ?? null,
          periode: payload.filter?.periode ?? 'toute',
          statut: payload.filter?.statut ?? 'tous',
          intention: payload.filter?.intention ?? 'toutes',
        },
        scanned: 99,
        clients: [],
        rows: [...(asking ? (over.pending ?? []) : (over.rows ?? []))],
        capped: asking ? (over.pendingCapped ?? false) : (over.capped ?? false),
      }
    })

  const rows = (count: number, prefix: string): HistoryRow[] =>
    Array.from({ length: count }, (_, i) => ({
      ...historyRow(),
      meeting: meeting(`${prefix}${i}`, { title: 'Acme — restitution' }),
    }))

  test('exactly RESULT_LIMIT matches with nothing hidden says nothing', async () => {
    // Eight matches, eight rows, `capped: false`. The pane used to draw « Les
    // premiers résultats — l'historique les porte tous », which sends a rep to a
    // second screen to look for results that are not there.
    answering({ rows: rows(8, 'm') })
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('TJM')

    await screen.findByRole('list', { name: 'Résultats' })
    expect(screen.queryByText(/Les premiers résultats/)).toBeNull()
  })

  test('and a ninth behind the pane is said out loud', async () => {
    answering({ rows: rows(8, 'm'), capped: true })
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    await typeQuery('TJM')

    expect(await screen.findByText(/Les premiers résultats/)).toBeTruthy()
  })

  test('exactly PENDING_LIMIT owed is a number, not a number with a plus', async () => {
    // Fifty calls owed and nothing hidden: « 50 » and « Les 50 › ». It drew
    // « 50+ » and « Toutes › » — a backlog rounded up, and a link that stopped
    // naming its own count, on the section whose whole point is the size.
    answering({ pending: rows(50, 'p') })
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('list', { name: 'Réunions en attente de validation' })

    expect(screen.getByLabelText('50 réunions en attente de validation').textContent).toBe('50')
    expect(screen.getByRole('button', { name: 'Les 50 ›' })).toBeTruthy()
  })

  test('and a fifty-first says so, to the eye and to a reader', async () => {
    answering({ pending: rows(50, 'p'), pendingCapped: true })
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('list', { name: 'Réunions en attente de validation' })

    // The `+` is on the screen and in the accessible name: a reader told « 50 »
    // where the screen shows « 50+ » has been given a certainty nobody claimed.
    expect(
      screen.getByLabelText('au moins 50 réunions en attente de validation').textContent,
    ).toBe('50+')
    expect(screen.getByRole('button', { name: 'Toutes ›' })).toBeTruthy()
  })
})

// ── US-22: the screen is named by what changed ──────────────────────────────

describe('the page is named by the day, and the day is drawn once', () => {
  const open = async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
  }

  /*
   * « Calendrier » was the `h1`, in 42px serif, over a calendar — the largest thing
   * on the screen and the one thing about it that never changes. The back link on
   * the other three screens keeps the word, because a destination needs a name.
   */
  test('« Calendrier » is no longer a heading on the screen it names', async () => {
    await open()
    expect(screen.queryByRole('heading', { name: 'Calendrier' })).toBeNull()
  })

  test('the h1 is the selected day, and it is the only one', async () => {
    await open()
    const day = formatDayLong(noonOf(today()))
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe(upperFirst(day))

    /*
     * The defect this replaces, asserted as a count and casefolded — which is how
     * it hid: the header's copy was `text-transform: uppercase`, so the DOM held
     * « dimanche 13 septembre » beside an `h2` holding « Dimanche 13 septembre »
     * and the two differed as strings. `shot.mjs --echo` measures it on the real
     * layout; here it is the elements owning the text.
     */
    const drawn = screen
      .getAllByText((_, el) => (el?.textContent ?? '').trim().toLowerCase() === day.toLowerCase())
      .filter((el) => el.children.length === 0)
    expect(drawn).toHaveLength(1)
  })

  /*
   * The `h2` it replaces answered « what is the right column showing » while the
   * header answered « what day is it today », so a rep who clicked another day read
   * that day's list under a title naming this one. One title, and it follows the
   * selection.
   */
  test('and it follows the day the rep selected, not today', async () => {
    await open()
    const other = addDays(today(), 3)
    fireEvent.click(cell(other))

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        upperFirst(formatDayLong(noonOf(other))),
      ),
    )
  })

  /*
   * The one range where the title had nothing of its own to say: the calendar's
   * pager, 70px above the list, already names the month and is the control that
   * changes it. `--echo` found it on `agenda-hors-fenetre` the moment the title
   * moved into the header. What switching to *Mois* asks is how much the month
   * holds, so that is what it answers.
   */
  test('Mois names the count, because the grid already names the month', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', 10), event('e2', 'Nordis — suivi', 14)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: null,
        reason: '',
      }))
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByText('Nordis — suivi')
    fireEvent.click(screen.getByRole('button', { name: 'Mois' }))

    const month = formatMonthLong(noonOf(today()))
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        upperFirst(`2 réunions en ${month}`),
      ),
    )
    // The grid's own pager still says the month, once, and nothing repeats it.
    expect(within(grid()).getByRole('heading', { name: upperFirst(month) })).toBeTruthy()
    expect(screen.getAllByText(upperFirst(month))).toHaveLength(1)
  })

  test('and an empty month says so rather than counting nothing', async () => {
    signedOut()
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
    fireEvent.click(screen.getByRole('button', { name: 'Mois' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        upperFirst(`Aucune réunion en ${formatMonthLong(noonOf(today()))}`),
      ),
    )
  })

  test('the range switch renames it, and nothing repeats it', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Liste' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Toutes les réunions'),
    )
    expect(screen.getAllByText('Toutes les réunions')).toHaveLength(1)
  })
})

// ── US-26: one filled control per list ──────────────────────────────────────

/**
 * **Six outlined controls of identical weight, and the rep's next action was one
 * of them.**
 *
 * Measured on the shipped home screen at 1280×800, at 14:35 with a call being
 * recorded: *Ouvrir* y=206, *Enregistrer* y=276 and y=345, *Ouvrir* y=464, y=534
 * and y=681, every one `rgb(255,255,255)` on a 1px border — and *Démarrer une
 * réunion* in the header bordered as well, because `NewMeeting` steps it down
 * beside an armed row and the armed row was the recording one. No fill anywhere.
 *
 * The count is what these assert, because a screen with two blues on it looks
 * entirely reasonable in a screenshot.
 */
describe('one filled control per list (US-26)', () => {
  const filled = () =>
    screen.getAllByRole('button').filter((b) => b.className.includes('bg-brand-700'))

  const owed = (id: string, hoursAgo: number): HistoryRow => ({
    ...historyRow(),
    meeting: meeting(id, {
      title: `Acme — restitution ${id}`,
      state: 'awaiting_confirmation',
      scheduledStart: at(SUITE_HOUR - hoursAgo),
    }),
    status: 'À valider',
  })

  const pendingRows = (rows: readonly HistoryRow[]) =>
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
      rows: payload.filter?.statut === 'a-valider' ? [...rows] : [],
    }))

  const draw = async () => {
    render(<Agenda onOpen={() => {}} onHistorique={() => {}} onReglages={() => {}} />)
    await screen.findByRole('region', { name: 'Calendrier' })
  }

  test('the live call takes the weight, and the header gives it up', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('meeting:list', () => [
        meeting('m-live', {
          state: 'recording',
          eventId: 'e1',
          title: 'Acme — cadrage',
          scheduledStart: at(SUITE_HOUR - 1),
        }),
      ])
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', SUITE_HOUR - 1), event('e2', 'Nordis — suivi', SUITE_HOUR + 2)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: { meetingId: 'm-live', eventId: 'e1', subject: 'Acme — cadrage' },
        reason: '',
      }))
    await draw()
    await screen.findByText('En cours')

    expect(filled()).toHaveLength(1)
    // The live call is *opened*, never started again — the verb is the row's own.
    expect(filled()[0].textContent).toBe('Ouvrir')
    /*
      And *Démarrer une réunion* is not the second blue. Its own comment records the
      measurement — two `--brand-700` controls 172px apart, horizontally overlapping
      — and the rule it states is about the fill, not about arming.
    */
    expect(
      screen.getByRole('button', { name: 'Démarrer une réunion' }).className,
    ).not.toContain('bg-brand-700')
  })

  test('with nothing live and nothing armed, the oldest à valider takes it', async () => {
    pendingRows([owed('m-recent', 2), owed('m-oldest', 9)])
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e2', 'Nordis — suivi', SUITE_HOUR + 2)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: null,
        reason: '',
      }))
    await draw()
    await screen.findByRole('list', { name: 'Réunions en attente de validation' })

    const one = filled()
    expect(one).toHaveLength(1)
    // The oldest, not the first row the store happened to return.
    const row = one[0].closest('li')
    expect(row?.textContent).toContain('m-oldest')
  })

  /*
   * The ranking, and it is the half a per-row rule cannot reach: a backlog row and a
   * live call are drawn by two different components, in two different lists.
   */
  test('a live call outranks the backlog, which then draws nothing', async () => {
    pendingRows([owed('m-oldest', 9)])
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('meeting:list', () => [
        meeting('m-live', {
          state: 'recording',
          eventId: 'e1',
          title: 'Acme — cadrage',
          scheduledStart: at(SUITE_HOUR - 1),
        }),
      ])
      .when('agenda:snapshot', () => ({
        events: [event('e1', 'Acme — cadrage', SUITE_HOUR - 1)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: null,
        reason: '',
      }))
    await draw()
    await screen.findByRole('list', { name: 'Réunions en attente de validation' })

    expect(filled()).toHaveLength(1)
    expect(filled()[0].closest('li')?.textContent).toContain('En cours')
  })

  /*
   * And a quiet day: nothing recording, nothing armed, nothing owed. Then the
   * header's *Démarrer une réunion* is the only fill on the screen, which is what
   * it was built to be — starting a call is the rep's next action.
   */
  test('a day that owes nothing leaves the header its fill', async () => {
    bridge
      .when('auth:state', () => ({ status: 'signedIn', account: account() }))
      .when('agenda:snapshot', () => ({
        events: [event('e2', 'Nordis — suivi', SUITE_HOUR + 2)],
        syncedAt: Date.now(),
        window: { from: 0, to: 0 },
        armed: null,
        reason: '',
      }))
    await draw()
    await screen.findByText('Nordis — suivi')

    const one = filled()
    expect(one).toHaveLength(1)
    expect(one[0].textContent).toBe('Démarrer une réunion')
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
