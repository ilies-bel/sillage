/**
 * **What the pane says about a day, versus what the day holds.**
 *
 * The empty state was keyed on the *upcoming* half of the day while the past
 * list was rendered unconditionally below it — so every past day that held a
 * call drew « Aucune réunion ce jour-là. » directly above that call.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DayPane } from '../DayPane.tsx'
import type { AgendaEntry } from '../entries.ts'

/**
 * The row, with everything about it nameable.
 *
 * It took `past` and nothing else, so the component had **never been rendered with
 * `armed: true`** — which is the offer, the day's one filled primary, and the whole
 * of HR-7's case. The state that row is *in* had never been varied either.
 */
const row = (over: Partial<AgendaEntry> = {}): AgendaEntry => ({ ...entry(false), ...over })

/*
 * **Unmounted between tests, and it was not.** The file had one test per `describe`,
 * so nothing noticed that renders accumulate in one document: the second test in this
 * file read the first one's DOM and « found multiple elements ». A suite that can only
 * hold one test is a suite that will be added to.
 */
afterEach(cleanup)

const entry = (past: boolean): AgendaEntry => ({
  key: 'e1',
  day: '2026-08-04',
  start: Date.parse('2026-08-04T08:00:00Z'),
  end: Date.parse('2026-08-04T09:00:00Z'),
  title: 'Groupe Maréchal — qualification besoin ERP',
  subtitle: 'Groupe Maréchal',
  meetingId: 'm1',
  eventId: null,
  armed: false,
  state: 'done',
  past,
})

describe('DayPane — the day it is describing', () => {
  test('a past day that holds a call does not claim it holds none', () => {
    render(
      <DayPane
        entries={[entry(true)]}
        reason={null}
        signedOut={false}
        when="past"
        showDay={false}
        unsynced={false}
        onOpen={() => {}} onArm={() => {}}
      />,
    )

    expect(screen.getByText('Passées')).toBeTruthy()
    expect(screen.getAllByText(/Groupe Maréchal/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Aucune réunion/)).toBeNull()
  })

  test('and never that the calendar was not asked about a day it recorded on', () => {
    /*
     * The worse half. « Ces jours sont hors de la période synchronisée — le
     * calendrier n'a pas été interrogé dessus » was drawn over a call **this
     * app recorded**, which it has first-hand knowledge of.
     */
    render(
      <DayPane
        entries={[entry(true)]}
        reason={null}
        signedOut={false}
        when="past"
        showDay={false}
        unsynced
        onOpen={() => {}} onArm={() => {}}
      />,
    )

    expect(screen.queryByText(/hors de la période synchronisée/)).toBeNull()
    expect(screen.getAllByText(/Groupe Maréchal/).length).toBeGreaterThan(0)
  })

  test('the way to create one survives the card that used to carry it (DEC-31)', () => {
    render(
      <DayPane
        entries={[entry(true)]}
        reason={null}
        signedOut={false}
        when="past"
        showDay={false}
        unsynced={false}
        action={<button type="button">Ajouter au 4 août</button>}
        onOpen={() => {}} onArm={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Ajouter au 4 août' })).toBeTruthy()
  })

  test('a day that really is empty still says so', () => {
    render(
      <DayPane
        entries={[]}
        reason={null}
        signedOut={false}
        when="past"
        showDay={false}
        unsynced={false}
        onOpen={() => {}} onArm={() => {}}
      />,
    )

    expect(screen.getByText('Aucune réunion ce jour-là.')).toBeTruthy()
  })

  test('today keeps its own sentence, which was written for a day with a past list', () => {
    render(
      <DayPane
        entries={[entry(true)]}
        reason={null}
        signedOut={false}
        when="today"
        showDay={false}
        unsynced={false}
        onOpen={() => {}} onArm={() => {}}
      />,
    )

    expect(screen.getByText('Plus aucune réunion aujourd’hui.')).toBeTruthy()
  })
})

describe('DayPane — a call under way is not a call about to start', () => {
  const draw = (over: Partial<AgendaEntry>) =>
    render(
      <DayPane
        entries={[row(over)]}
        reason={null}
        signedOut={false}
        when="today"
        showDay={false}
        unsynced={false}
        onOpen={() => {}}
        onArm={() => {}}
      />,
    )

  /*
   * `Agenda.#arm` keeps `#armed` on the meeting through `recording` — deliberately,
   * « a call under way is precisely the row to show ». `DayPane` read that flag
   * *before* it read the state, so `STATE_LABEL.recording` was unreachable on the
   * agenda for every calendar-armed meeting, which is the primary path (HR-9).
   * Measured on the shipped screen: fifty minutes into a recording the row still read
   * « Prêt » and still wore the day's one filled *Enregistrer*, whose whole case is
   * that it points at the one thing the rep is there to do.
   */
  test('the offer says Prêt and carries the day’s one filled primary', () => {
    draw({ armed: true, state: 'armed' })
    expect(screen.getByText('Prêt')).toBeTruthy()
    const control = screen.getByRole('button', { name: 'Enregistrer' })
    expect(control.className).toContain('bg-brand-700')
  })

  test('and the recording says En cours, and is opened rather than started again', () => {
    draw({ armed: true, state: 'recording' })
    expect(screen.queryByText('Prêt')).toBeNull()
    expect(screen.getByText('En cours')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    const control = screen.getByRole('button', { name: 'Ouvrir' })
    expect(control.className).not.toContain('bg-brand-700')
  })

  /*
   * The guard against fixing this by deleting the dot: an *unarmed* row that is
   * somehow recording — a crash sweep's stranded row, a second window — still says
   * what it is, and an armed row that has not started still gets the weight.
   */
  test('an unarmed recording still names itself', () => {
    draw({ armed: false, state: 'recording' })
    expect(screen.getByText('En cours')).toBeTruthy()
  })
})
