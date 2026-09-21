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
import type { ReactNode } from 'react'
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
        when="past"
        showDay={false}
        unsynced={false}
        emphasis={null}
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
        when="past"
        showDay={false}
        unsynced
        emphasis={null}
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
        when="past"
        showDay={false}
        unsynced={false}
        action={<button type="button">Ajouter au 4 août</button>}
        emphasis={null}
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
        when="past"
        showDay={false}
        unsynced={false}
        emphasis={null}
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
        when="today"
        showDay={false}
        unsynced={false}
        emphasis={null}
        onOpen={() => {}} onArm={() => {}}
      />,
    )

    expect(screen.getByText('Plus aucune réunion aujourd’hui.')).toBeTruthy()
  })
})

describe('DayPane — a call under way is not a call about to start', () => {
  /*
   * `emphasis` defaults to this row, because `Agenda` names the live call first and
   * the armed offer second and both of those are what this block draws. A test that
   * passed `null` here would be asserting the ink of a row the screen did not choose.
   */
  const draw = (over: Partial<AgendaEntry>, emphasis: string | null = 'm1') =>
    render(
      <DayPane
        entries={[row(over)]}
        reason={null}
        when="today"
        showDay={false}
        unsynced={false}
        emphasis={emphasis}
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
   * « Prêt » and still wore the day's one filled control, whose whole case is
   * that it points at the one thing the rep is there to do.
   *
   * **The verb is *Ouvrir* and it used to be *Enregistrer*.** The press is
   * `onOpen` on both branches — driven at the bridge in
   * `agenda/__tests__/verbs.test.tsx`, it reaches no IPC channel at all — so the
   * word was the product's capture verb on a control that does not capture, and
   * the *same* word as the arm control on an upcoming row, which is a different
   * act. What distinguishes the offer is « PRÊT » and the fill, both asserted here.
   */
  test('the offer says Prêt and carries the day’s one filled primary', () => {
    draw({ armed: true, state: 'armed' })
    expect(screen.getByText('Prêt')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    const control = screen.getByRole('button', { name: 'Ouvrir' })
    expect(control.className).toContain('bg-brand-700')
  })

  /*
   * **The verb and the ink are two questions, and this test used to conflate them.**
   *
   * It asserted that a recording row is *not* filled, which was true and was the
   * defect US-26 names: on the shipped screen the live call wore the same outline as
   * a 17:30 invite, and the header's primary had already stepped down beside it, so
   * the home screen a rep opens mid-call carried no fill at all. The verb assertion
   * is the one that stands — a call under way is opened, never started again.
   */
  test('and the recording says En cours, is opened rather than started again, and gets the weight', () => {
    draw({ armed: true, state: 'recording' })
    expect(screen.queryByText('Prêt')).toBeNull()
    expect(screen.getByText('En cours')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    const control = screen.getByRole('button', { name: 'Ouvrir' })
    expect(control.className).toContain('bg-brand-700')
  })

  /*
   * **The pane obeys the screen's decision and never re-derives it** (US-26).
   *
   * Reading `entry.armed` for the ink is what made « exactly one filled control »
   * impossible: this pane cannot see the live call in another view, and it cannot see
   * *En attente de validation* below it, which holds the same kind of row and offers
   * the same *Ouvrir*. So an armed row that `Agenda` did not name stays quiet.
   */
  test('an armed row the screen did not name keeps the quiet ink', () => {
    draw({ armed: true, state: 'armed' }, null)
    expect(screen.getByText('Prêt')).toBeTruthy()
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

/*
 * **Exactly one filled control across both of the pane's lists** (US-26).
 *
 * The shipped home screen drew six outlined controls of identical weight in the
 * right-hand column — four *Ouvrir* and two arm controls, measured at 1280×800 —
 * and the rep's next action was exactly one of them. The count is what regressed
 * and what a screenshot cannot state, so it is asserted as a count: a pane drawing
 * two blues looks perfectly reasonable in a picture.
 *
 * It is driven over a day that holds an upcoming half *and* a `Passées` half,
 * because `DayPane` renders two `List`s and an earlier version decided the ink per
 * row — which is one fill per list, not one per screen.
 */
describe('DayPane — one filled control for the whole pane', () => {
  const day: readonly AgendaEntry[] = [
    row({ key: 'a', meetingId: 'm-live', state: 'recording', armed: true, past: false }),
    row({ key: 'b', meetingId: null, eventId: 'ev-b', state: null, past: false }),
    row({ key: 'c', meetingId: null, eventId: 'ev-c', state: null, past: false }),
    row({ key: 'd', meetingId: 'm-owed', state: 'awaiting_confirmation', past: true }),
    row({ key: 'e', meetingId: 'm-done', state: 'done', past: true }),
  ]

  const drawDay = (emphasis: string | null) =>
    render(
      <DayPane
        entries={day}
        reason={null}
        when="today"
        showDay={false}
        unsynced={false}
        emphasis={emphasis}
        onOpen={() => {}}
        onArm={() => {}}
      />,
    )

  const filled = () =>
    screen.getAllByRole('button').filter((b) => b.className.includes('bg-brand-700'))

  test('the live call takes it, and nothing else on the day does', () => {
    drawDay('m-live')
    // Five rows, five controls: nothing gains or loses an affordance (US-26).
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(filled()).toHaveLength(1)
    expect(filled()[0].textContent).toBe('Ouvrir')
  })

  test('a row under *Passées* can take it, and still only one does', () => {
    drawDay('m-owed')
    expect(filled()).toHaveLength(1)
  })

  test('and a day the screen named nothing on draws no fill at all', () => {
    drawDay(null)
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(filled()).toHaveLength(0)
  })
})

/**
 * **Where an arming refusal is drawn, which is the one thing about it jsdom can
 * measure.**
 *
 * The harm is geometric and this file cannot see it: every box here is zero, so
 * « the list fell 71.2px and *Ouvrir* on the live call took the pointer » is
 * `shot.mjs --press`'s measurement and only its. What survives the move to jsdom
 * is the fact underneath it — **document order**. A refusal drawn above the list
 * moves every row in it; one drawn after the row it answers about moves only the
 * rows below. So this asserts the order, and it is red the moment the notice
 * goes back to being a sibling of the list.
 */
describe('DayPane — where an arming refusal is drawn', () => {
  const week = [
    row({ key: 'live', meetingId: 'm-live', eventId: null, state: 'recording', title: 'Néovia Santé — cadrage renfort data' }),
    row({ key: 'asked', meetingId: null, eventId: 'evt-delcourt', state: null, title: 'Banque Delcourt — négociation' }),
    row({ key: 'after', meetingId: null, eventId: 'evt-arkelia', state: null, title: 'Arkelia Logistique — point' }),
  ]

  const draw = (refusal: { eventId: string; notice: ReactNode } | null) =>
    render(
      <DayPane
        entries={week}
        reason={null}
        when="today"
        showDay={false}
        unsynced={false}
        emphasis={null}
        onOpen={() => {}}
        onArm={() => {}}
        refusal={refusal}
      />,
    )

  const notice = <div role="alert">« Néovia Santé — cadrage renfort data » est déjà en cours d’enregistrement.</div>

  test('it follows the row that was pressed, and nothing above that row moves', () => {
    draw({ eventId: 'evt-delcourt', notice })

    const items = [...document.querySelectorAll('li')]
    const pressed = items.findIndex((li) => li.textContent?.includes('Banque Delcourt'))
    const carrying = items.findIndex((li) => li.querySelector('[role="alert"]') !== null)
    const live = items.findIndex((li) => li.textContent?.includes('Néovia Santé — cadrage'))
    const below = items.findIndex((li) => li.textContent?.includes('Arkelia'))

    expect(pressed).toBeGreaterThanOrEqual(0)
    // Immediately after the pressed row: not above the list, and not at its end.
    expect(carrying).toBe(pressed + 1)
    // The live call's row — the one whose *Ouvrir* took the pointer — is above it.
    expect(live).toBeLessThan(carrying)
    expect(below).toBeGreaterThan(carrying)
  })

  test('no refusal, no row: the list is exactly the day', () => {
    draw(null)
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
    expect(document.querySelectorAll('li')).toHaveLength(3)
  })

  /**
   * The stated limit of the placement: a sentence about a row that is no longer
   * on screen is not drawn at all, rather than stranded at the top of a list it
   * is no longer about.
   */
  test('a refusal about an event this range no longer holds is not drawn', () => {
    draw({ eventId: 'evt-parti', notice })
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
    expect(document.querySelectorAll('li')).toHaveLength(3)
  })
})
