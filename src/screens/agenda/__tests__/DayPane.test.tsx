/**
 * **What the pane says about a day, versus what the day holds.**
 *
 * The empty state was keyed on the *upcoming* half of the day while the past
 * list was rendered unconditionally below it — so every past day that held a
 * call drew « Aucune réunion ce jour-là. » directly above that call.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayPane } from '../DayPane.tsx'
import type { AgendaEntry } from '../entries.ts'

const entry = (past: boolean): AgendaEntry => ({
  key: 'e1',
  day: '2026-08-04',
  start: Date.parse('2026-08-04T08:00:00Z'),
  end: Date.parse('2026-08-04T09:00:00Z'),
  title: 'Groupe Maréchal — qualification besoin ERP',
  subtitle: 'Groupe Maréchal',
  meetingId: 'm1',
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
        onOpen={() => {}}
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
        onOpen={() => {}}
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
        onOpen={() => {}}
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
        onOpen={() => {}}
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
        onOpen={() => {}}
      />,
    )

    expect(screen.getByText('Plus aucune réunion aujourd’hui.')).toBeTruthy()
  })
})
