/**
 * **What the backlog's rows say, and in which colour they say it.**
 *
 * `PendingGates` had no test file of its own: every assertion about it was made
 * through `Agenda`, which stages one row at a time and therefore could never ask
 * the question this section actually poses — *what does a rep see when several
 * calls are waiting and they are not the same age*. That is the only shape in
 * which the defect below is visible.
 *
 * The staleness line is `--warn`, and `PendingGates`' own docblock says why:
 * « the staleness line below — « Rien n'a été envoyé depuis N jours » — keeps
 * `--warn`, because that one **is** a fault and is the only thing on this screen
 * making that claim ». Three further sentences in the product said the line is
 * drawn only past a week — `staleFor`'s docblock (« `null` while it is still
 * recent enough that the date on the row says it better than a number would »),
 * the span's own comment (« it appears only past a week … and silent everywhere
 * else ») and `Agenda.test.tsx`'s (« below it, it stays quiet ») — and the code
 * printed a bare « Rien n'a été envoyé » on every row that was *not* stale.
 *
 * So the fault colour was on every row of the section from the minute a call
 * ended, restating the heading eight pixels above it, and the one row that was
 * genuinely a fortnight old was painted in the same ink as one from this
 * morning.
 *
 * The test runs **both directions and the boundary**: below `STALE_DAYS` silent,
 * at it and past it spoken. A fixture that only staged the stale row is how the
 * silent half went unbuilt.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PendingGates } from '../PendingGates.tsx'
import type { HistoryRow } from '../../../../electron/core/contracts/history.ts'
import type { Meeting } from '../../../../electron/core/contracts/meeting.ts'

afterEach(cleanup)

const DAY_MS = 86_400_000
const NOW = Date.parse('2026-09-17T14:35:00Z')

const meeting = (id: string, daysAgo: number): Meeting => ({
  id,
  state: 'awaiting_confirmation',
  title: 'Nordis Retail — cadrage support N2',
  eventId: null,
  clientName: 'Nordis Retail',
  scheduledStart: NOW - daysAgo * DAY_MS,
  createdAt: NOW - daysAgo * DAY_MS,
  startedAt: NOW - daysAgo * DAY_MS,
  endedAt: NOW - daysAgo * DAY_MS + 1_800_000,
  confirmedAt: null,
  updatedAt: NOW - daysAgo * DAY_MS,
})

const row = (id: string, daysAgo: number): HistoryRow => ({
  meeting: meeting(id, daysAgo),
  status: 'À valider',
  intents: [],
  matches: [],
})

const draw = (rows: readonly HistoryRow[], total = rows.length) =>
  render(
    <PendingGates
      rows={rows}
      total={total}
      capped={false}
      emphasis={null}
      now={NOW}
      onSeeAll={() => {}}
      onOpen={() => {}}
    />,
  )

/** Every visible run of text on the row, so the census is of the row and not of one span. */
const saidOn = (title: string): string[] => {
  const heading = screen.getAllByText(title)[0]
  const row = heading.closest('li')
  if (!row) throw new Error(`no row for ${title}`)
  return [...row.querySelectorAll('span')]
    .filter((span) => span.children.length === 0)
    .map((span) => (span.textContent ?? '').trim())
    .filter((text) => text !== '')
}

/**
 * **A section is its rows.**
 *
 * `total` and `rows` are deliberately different numbers — the count is the whole
 * backlog and the rows are what is left after `Agenda` removes whatever the list
 * above is already drawing — and the subtraction can take all of them. The guard
 * at the top of the file asked only about the count, so `total: 2, rows: []`
 * drew the heading, the number, « Les 2 › », a sentence pointing upwards and an
 * empty `<ul>` with the section's accessible name on it. Measured on the shipped
 * renderer in *Mois* and in *Liste*: 672×49.05 of chrome and zero `<li>`.
 */
describe('PendingGates — with nothing left to draw', () => {
  test('a backlog entirely drawn above is a section that does not exist', () => {
    const { container } = draw([], 2)
    expect(container.innerHTML).toBe('')
  })

  test('and one row left is still a section', () => {
    draw([row('m-left', 1)], 2)
    expect(screen.getByText('En attente de validation')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Réunions en attente de validation' })).toBeTruthy()
    expect(screen.getByText('Une autre est dans la liste ci-dessus.')).toBeTruthy()
  })
})

describe('PendingGates — the staleness line', () => {
  test('a call waiting less than a week says nothing about how long', () => {
    draw([row('m-recent', 4)])

    /*
     * Four days. The date on the left says it, the heading above says the call
     * is waiting, and a third sentence in the product's fault colour adds
     * nothing but the colour.
     */
    expect(screen.queryByText(/Rien n’a été envoyé/)).toBeNull()
  })

  test('and the boundary is the boundary — six days silent, seven spoken', () => {
    draw([row('m-six', 6)])
    expect(screen.queryByText(/Rien n’a été envoyé/)).toBeNull()
    cleanup()

    draw([row('m-seven', 7)])
    expect(screen.getByText('Rien n’a été envoyé depuis 7 jours')).toBeTruthy()
  })

  test('a fortnight says how long, and keeps the fault colour to itself', () => {
    draw([row('m-old', 14)])

    const line = screen.getByText('Rien n’a été envoyé depuis 14 jours')
    expect(line.className).toContain('text-warn')
  })

  /**
   * **The shape one row could never show.** Four calls of four ages in one
   * section: the fault colour has to separate them, and it cannot do that if
   * every row wears it. Before the fix this printed the warn line four times.
   */
  test('a backlog of mixed ages marks only the ones that are stale', () => {
    draw([row('m-today', 0), row('m-three', 3), row('m-nine', 9), row('m-thirty', 30)])

    const warned = screen.queryAllByText(/Rien n’a été envoyé/)
    expect(warned.map((node) => node.textContent)).toEqual([
      'Rien n’a été envoyé depuis 9 jours',
      'Rien n’a été envoyé depuis 30 jours',
    ])
  })

  /**
   * **The row does not restate the section it is in.** « En attente de
   * validation » is the heading; « Rien n'a été envoyé » under it is the same
   * fact in different words, and `--echo` cannot see it because a repetition
   * *along a list* is exempt by rule — the exemption exists so « Ouvrir » on
   * five rows is one control offered five times, and it swallowed this.
   */
  test('a fresh row carries its date, its client and its title — and nothing else', () => {
    draw([row('m-fresh', 1)])

    expect(saidOn('Nordis Retail')).toEqual([
      '16/09',
      'Nordis Retail',
      'cadrage support N2',
    ])
  })
})
