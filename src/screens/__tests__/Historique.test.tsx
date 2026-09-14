/**
 * *Historique* is a reader (DEC-25), so the invariants worth testing are not
 * about layout:
 *
 *   - the search string goes to the **main process**, and this component never
 *     receives a transcript it did not expand;
 *   - a row expands into the four sections plus the push status of each intent;
 *   - a failed push shows its reason, because a red row with no sentence is the
 *     dead control DEC-26 forbids.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type {
  HistoryFilter,
  HistoryRecord,
  HistoryRow,
  HistorySearchResult,
} from '../../../electron/core/contracts/history.ts'
import type { InvokeRequest } from '../../../electron/core/contracts/ipc.ts'
import type { Meeting } from '../../../electron/core/contracts/meeting.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { NO_FILTER } from '../search/filters.ts'
import { Historique } from '../Historique.tsx'

let bridge: FakeBridge
let uninstall: () => void

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'm1',
  state: 'done',
  title: 'Acme Industries — besoin Dev Java',
  eventId: 'AAMkAGI2-sample',
  clientName: 'Acme Industries',
  scheduledStart: null,
  createdAt: 1_760_000_000_000,
  startedAt: 1_760_000_000_000,
  endedAt: 1_760_003_600_000,
  confirmedAt: 1_760_003_700_000,
  updatedAt: 1_760_003_700_000,
  ...over,
})

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  meeting: meeting(),
  status: 'Validée',
  intents: [
    {
      intentId: 'm1:crm.task',
      kind: 'crm.task',
      label: 'Tâche compte-rendu (VerySwing)',
      state: 'drained',
      attempts: 1,
      lastError: null,
      remoteId: 'TASK-77',
    },
    {
      intentId: 'm1:mail.draft',
      kind: 'mail.draft',
      label: 'Brouillon de relance (Outlook)',
      state: 'failed',
      attempts: 3,
      lastError: 'jeton Microsoft expiré',
      remoteId: null,
    },
  ],
  matches: [],
  ...over,
})

const record = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  meeting: meeting(),
  marks: [],
  /*
   * Two of them, deliberately: with two people on the client's side the app
   * cannot say which one spoke, so the reader says « Client » and means it. The
   * one-attendee case — where it *can* say, from the calendar — has its own
   * test below.
   */
  interlocuteurs: [
    { name: 'Camille Le Roy', email: 'camille@acme.fr', type: 'required', response: 'accepted' },
    { name: 'Yann Ferrand', email: 'yann@acme.fr', type: 'required', response: 'accepted' },
  ],
  segments: [
    {
      id: 'seg-1',
      channel: 'far',
      text: 'on est plutôt sur un TJM de 520 euros',
      startMs: 812_000,
      endMs: 815_400,
      isFinal: true,
      provider: 'local-whisper',
      receivedAt: 1_760_001_000_000,
    },
    {
      id: 'seg-2',
      channel: 'rep',
      text: 'très bien, je vous envoie deux CV',
      startMs: 820_000,
      endMs: 823_000,
      isFinal: true,
      provider: 'local-whisper',
      receivedAt: 1_760_001_100_000,
    },
  ],
  notes: 'rappeler Camille jeudi',
  compteRendu: '## Contexte\n\nRenfort de deux profils Java sur la plateforme.',
  fields: [
    { key: 'account', label: 'Client', confidence: 'ok', span: null },
    {
      key: 'tjm',
      label: 'TJM',
      confidence: 'ok',
      span: { quote: 'un TJM de 520 euros', channel: 'far', startMs: 812_000, endMs: 815_400 },
    },
    {
      key: 'objections',
      label: 'Objections',
      confidence: 'faible',
      span: { quote: 'le délai nous inquiète', channel: 'far', startMs: null, endMs: null },
    },
  ],
  overall: 'faible',
  intents: [],
  ...over,
})

const answered = (result: Partial<HistorySearchResult> = {}) =>
  bridge.when('history:search', (payload) => ({
    query: payload.query ?? '',
    filter: withDefaults(payload.filter),
    scanned: 3,
    clients: ['Acme Industries', 'Nordis'],
    rows: [row()],
    ...result,
  }))

/**
 * What the main process does to a partial filter on the way in, restated here
 * because the fake bridge does not run the Zod schema — and the component drops
 * an answer whose `filter` does not match the one it asked with.
 */
const withDefaults = (filter: InvokeRequest<'history:search'>['filter']): HistoryFilter => ({
  client: filter?.client ?? null,
  periode: filter?.periode ?? 'toute',
  statut: filter?.statut ?? 'tous',
  intention: filter?.intention ?? 'toutes',
})

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

/** The one field on both screens (VISION.md §6). */
const box = () =>
  screen.getByLabelText('Rechercher un client, un sujet, une transcription ou une note')

/**
 * The first answer has landed and been drawn.
 *
 * These tests used to wait on the client's name appearing. That stopped meaning
 * "the results are here" the moment the filter chips arrived, because the chip
 * offering to narrow *to* Acme renders before and independently of any row
 * about Acme — so the wait could pass with the list still empty. Waiting on the
 * list itself is what was always intended.
 */
const settled = () => screen.findByRole('list', { name: 'Appels enregistrés' })

describe('search runs in the main process', () => {
  test('the query is sent over the channel, not applied to a local list', async () => {
    const queries: string[] = []
    bridge.when('history:search', (payload) => {
      queries.push(payload.query ?? '')
      return {
        query: payload.query ?? '',
        filter: withDefaults(payload.filter),
        scanned: 12,
        clients: [],
        rows: [row()],
      }
    })

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    await act(async () => {
      fireEvent.change(box(), { target: { value: 'TJM' } })
      // Past the debounce, which exists so a three-letter word costs one pass
      // over the log rather than three.
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    await waitFor(() => expect(queries).toContain('TJM'))
  })

  /**
   * **The truncation says how much was searched.**
   *
   * The sentence is the whole of what a rep has instead of paging, and it drew
   * « les 50 appels les plus récents » with nothing to be fifty *of* — while
   * `scanned`, the field that answers exactly that, was shipped on every answer
   * and read by no screen. It mattered: the scan itself stopped at five hundred
   * meetings and `capped` reported only the *result* cap, so the one number that
   * could have said the corpus had been cut short travelled unread.
   */
  test('the truncation names the corpus it is fifty of, and is silent when nothing is hidden', async () => {
    /*
     * **Opened on a question**, which is what this test was missing. `capped` is
     * set for the plain listing too, so rendering with an empty box and asserting
     * « affinez la recherche » was asserting the defect below: the remedy has to
     * be available for the sentence to be allowed to name it.
     */
    answered({ rows: Array.from({ length: 50 }, () => row()), scanned: 812, capped: true })
    render(<Historique onBack={() => {}} onReglages={() => {}} query="TJM" />)
    await settled()

    const said = await screen.findByText(/Affinez la recherche/)
    expect(said.textContent).toMatch(/Les 50 appels les plus récents qui correspondent/)
    expect(said.textContent).toMatch(/sur 812 appels parcourus/)

    cleanup()
    // Exactly fifty matches with nothing left over: no sentence at all. Telling a
    // rep to narrow a search that is already complete is worse than saying
    // nothing, and `capped` was `rows.length >= limit` for as long as it existed.
    answered({ rows: Array.from({ length: 50 }, () => row()), scanned: 812, capped: false })
    render(<Historique onBack={() => {}} onReglages={() => {}} query="TJM" />)
    await settled()
    expect(screen.queryByText(/Affinez la recherche/)).toBeNull()
  })

  /**
   * **The truncation must not name a remedy that is not there.**
   *
   * `capped` is shipped for the listing as well as for a search — the loop stops
   * one row past `limit` either way — and the sentence was gated on it alone. So
   * with an empty box and sixty calls in the store the screen drew « Les 50
   * appels les plus récents **qui correspondent** … **affinez la recherche** »
   * over an empty search field: two clauses about a question nobody asked, and a
   * remedy pointing at a control the rep has not touched. DEC-26's rule about
   * dead controls in prose.
   *
   * Both halves are asserted, because the fix that draws nothing at all would
   * pass half of this: fifty of sixty *is* a truncation and the rep is owed it.
   */
  test('the listing says what it is fifty of and points at something that exists', async () => {
    answered({ rows: Array.from({ length: 50 }, () => row()), scanned: 60, capped: true })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    const said = await screen.findByText(/Les 50 appels les plus récents/)
    expect(said.textContent).toMatch(/sur 60 appels enregistrés/)
    // The remedy is the box above, which is a thing the rep can do next.
    expect(said.textContent).toMatch(/Cherchez un client, un sujet ou un mot prononcé/)
    // And neither clause that belongs to a search nobody ran.
    expect(said.textContent).not.toMatch(/correspondent/)
    expect(said.textContent).not.toMatch(/Affinez la recherche/)
  })

  /**
   * A chip is a question too, so the search sentence is the right one — the
   * discriminator is « did the rep ask something », not « is the box non-empty ».
   */
  test('a chip on with an empty box still reads as a search', async () => {
    answered({
      rows: Array.from({ length: 50 }, () => row()),
      scanned: 60,
      capped: true,
    })
    render(<Historique onBack={() => {}} onReglages={() => {}} filter={{ ...NO_FILTER, statut: 'a-valider' }} />)
    await settled()

    const said = await screen.findByText(/Les 50 appels les plus récents/)
    expect(said.textContent).toMatch(/qui correspondent/)
    expect(said.textContent).toMatch(/Affinez la recherche/)
  })

  test('the matched excerpt is shown under the row, with the surface it came from', async () => {
    answered({
      rows: [
        row({
          matches: [
            { where: 'transcript', excerpt: '…plutôt sur un TJM de 520 euros…' },
            { where: 'notes', excerpt: 'penser au TJM avant la relance' },
            // The fifth surface, and the only one the rep can write during the
            // call: it is named here with the word the widget uses.
            { where: 'marks', excerpt: 'prix : ils bloquent à 550' },
          ],
        }),
      ],
    })

    render(<Historique onBack={() => {}} onReglages={() => {}} />)

    expect(await screen.findByText(/plutôt sur un TJM de 520 euros/)).toBeTruthy()
    // French, and the same word the review gate's own tab uses.
    expect(screen.getByText('Transcription')).toBeTruthy()
    expect(screen.getByText('Mes notes')).toBeTruthy()
    expect(screen.getByText('Moments marqués')).toBeTruthy()
    expect(screen.getByText(/ils bloquent à 550/)).toBeTruthy()
  })

  test('an empty result says so rather than showing an empty box', async () => {
    answered({ rows: [] })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    expect(await screen.findByText('Aucun appel enregistré.')).toBeTruthy()
  })
})

/**
 * The list of calls, addressed by name.
 *
 * Not `screen` — a client's name is on screen twice once the search chips are
 * drawn, as the chip that filters to them and as the row that results. Both are
 * legitimately called « Acme Industries », so every query below is scoped to
 * the results rather than made unambiguous by wording it more narrowly.
 */
const calls = () => within(screen.getByRole('list', { name: 'Appels enregistrés' }))

/** Opens the one row on screen. Every expansion test starts here. */
const expandTheRow = async (): Promise<void> => {
  await screen.findByRole('list', { name: 'Appels enregistrés' })
  const opener = calls().getByRole('button', { name: /Acme Industries/ })
  await act(async () => {
    fireEvent.click(opener)
  })
}

/**
 * **The title, which is the one thing on this screen that is information.**
 *
 * Every assertion here is about a *string*, which is why it can live in jsdom:
 * the geometry — that the count is the tallest text box above the fold, and that
 * nothing on the screen is drawn twice — is measured on the shipped renderer at
 * both smoke sizes, because every box in jsdom is zero.
 */
describe('the screen is named by what it holds, not by what it is (US-22)', () => {
  const titleOf = () => screen.getByRole('heading', { level: 1 }).textContent

  test('the count is the number of calls in the list, and « Historique » is gone', async () => {
    answered({
      rows: [
        row(),
        row({ meeting: meeting({ id: 'm2' }) }),
        row({ meeting: meeting({ id: 'm3' }) }),
      ],
    })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    expect(titleOf()).toBe('3 appels')
    /*
      The word named the furniture, and it still does not head the screen: the
      title is the count. It *is* in the rail, as the destination this screen is
      (V2) — a rail item is a label for somewhere to go, which is the one place
      a noun is the right word. So the assertion is about the page, not the app.
    */
    const page = screen.getByRole('main')
    expect(within(page).queryByText('Historique')).toBeNull()
    expect(within(screen.getByRole('banner')).queryByText('Historique')).toBeNull()
  })

  test('one row is one appel', async () => {
    answered({ rows: [row()] })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()
    expect(titleOf()).toBe('1 appel')
  })

  /*
   * An empty list is a count, and the chips beside it are why: « Aucun appel ·
   * 7 jours » says the période is the reason, which is more than the empty state
   * under it can say.
   */
  test('an empty list still says what it is empty of', async () => {
    answered({ rows: [] })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await screen.findByText('Aucun appel enregistré.')
    expect(titleOf()).toBe('Aucun appel')
  })

  /*
   * **The ceiling, and the one number it must never print.** `history:search`
   * collects one row past its limit and drops it, so what is known is « more than
   * fifty » — never how many. This screen has already shipped that ceiling
   * *silently* once, under a preview promising « l’historique les porte tous ».
   */
  test('fifty rows with more behind them never claim fifty', async () => {
    answered({ rows: Array.from({ length: 50 }, () => row()), scanned: 812, capped: true })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    expect(titleOf()).toBe('Plus de 50 appels')
    expect(titleOf()!.startsWith('50')).toBe(false)
  })

  test('exactly fifty rows with nothing behind them is a plain count', async () => {
    answered({ rows: Array.from({ length: 50 }, () => row()), scanned: 60, capped: false })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()
    expect(titleOf()).toBe('50 appels')
  })

  test('a pressed chip is named in the title, in the chip’s own words', async () => {
    bridge.when('history:search', (payload) => ({
      query: payload.query ?? '',
      filter: withDefaults(payload.filter),
      scanned: 9,
      clients: ['Acme Industries'],
      // The main process is what narrows; the answer is what the title describes.
      rows: withDefaults(payload.filter).statut === 'validees' ? [row()] : [row(), row()],
    }))

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()
    expect(titleOf()).toBe('2 appels')

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', {
          name: 'Validées',
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    await waitFor(() => expect(titleOf()).toBe('1 appel · Validées'))
  })

  /*
   * The query is **not** in the title: it is in the box three rows below, where
   * the rep typed it. What it does to the title is change the number.
   */
  test('the typed query narrows the count and is not restated in it', async () => {
    bridge.when('history:search', (payload) => ({
      query: payload.query ?? '',
      filter: withDefaults(payload.filter),
      scanned: 9,
      clients: [],
      rows: (payload.query ?? '') === '' ? [row(), row()] : [row()],
    }))

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    await act(async () => {
      fireEvent.change(box(), { target: { value: 'TJM' } })
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    await waitFor(() => expect(titleOf()).toBe('1 appel'))
    expect(titleOf()).not.toContain('TJM')
  })
})

/**
 * **A pane is named by its content (US-23).**
 *
 * Two of the record’s four panes name themselves — a transcript is offsets, sides
 * and sentences; a compte-rendu opens on its own `#` heading — and two do not:
 * « Mes notes » and « Extraction » are blocks of plain French prose side by side,
 * and nothing about either box says which is the rep’s own typing.
 *
 * What this cannot see is the pixels, so those are measured on the shipped
 * renderer: the head row of each captionless pane, and the record’s own height.
 */
describe('a caption only where the content cannot name itself (US-23)', () => {
  const headings = () => screen.getAllByRole('heading').map((h) => (h.textContent ?? '').trim())

  test('the transcript and the compte-rendu are not captioned; the two prose panes are', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()
    await screen.findByText('on est plutôt sur un TJM de 520 euros')

    expect(headings()).not.toContain('Transcription')
    expect(headings()).not.toContain('Compte-rendu')
    expect(headings()).toContain('Mes notes')
    expect(headings()).toContain('Extraction')
  })

  /*
   * **Deleting the caption must not take the control with it.** Both captionless
   * panes carried their *Copier* on the same row as the heading, and that is the
   * one gesture a rep needs from an archive — a compte-rendu from three weeks ago,
   * pasted into a proposal.
   */
  test('both panes keep the control that was beside the caption', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()
    await screen.findByText('on est plutôt sur un TJM de 520 euros')

    expect(screen.getByRole('button', { name: 'Copier la transcription' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copier le compte-rendu' })).toBeTruthy()
  })

  /*
   * **A pane with no caption and nothing to copy draws no head row at all.** A
   * call whose transcription failed has no segments, so there is nothing to put on
   * the clipboard either — and an empty 24-pixel band above « Aucune transcription
   * pour cet appel. » would be the caption's hole rather than its absence.
   */
  test('a call with no transcript draws no head row over the sentence saying so', async () => {
    answered()
    bridge.when('history:record', () => record({ segments: [], marks: [] }))

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()
    await screen.findByText('Aucune transcription pour cet appel.')

    expect(screen.queryByRole('button', { name: 'Copier la transcription' })).toBeNull()
    expect(headings()).not.toContain('Transcription')
  })

  /*
   * **And no typesetting manual on a read-only record.** « Les marques # ## – ∗∗
   * font partie du texte : VerySwing reçoit exactement ce qui est affiché » is a
   * real promise, owed once, where the rep can act on it: the gate, where the
   * document is editable and where the press that writes it into VerySwing lives.
   * `Review.test.tsx` asserts it is there and `session-output.test.tsx` that it is
   * not on the call screen; this was the third call site, on the one surface where
   * nothing can be corrected and nothing ships anywhere.
   */
  test('the record explains nothing about its own typesetting', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()
    await screen.findByText(/Renfort de deux profils Java/)

    expect(screen.queryByText(/font partie du texte/)).toBeNull()
  })

  /*
   * **And the word survives where it is doing work.** Under a collapsed row the
   * five surfaces a query can hit are five one-line fragments of identical shape,
   * and that first column is the only thing saying which one matched — « what the
   * rep typed was in the transcript » and « …in their own notes » are two
   * different facts. Deleting it there would be the opposite mistake.
   */
  test('the search excerpt keeps the surface it came from', async () => {
    answered({
      rows: [
        row({
          matches: [
            { where: 'transcript', excerpt: '…plutôt sur un TJM de 520 euros…' },
            { where: 'compteRendu', excerpt: '…un TJM de 520 euros…' },
          ],
        }),
      ],
    })

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    expect(screen.getByText('Transcription')).toBeTruthy()
    expect(screen.getByText('Compte-rendu')).toBeTruthy()
    // …and neither of them is a heading, which is what a pane caption is.
    expect(headings()).not.toContain('Transcription')
    expect(headings()).not.toContain('Compte-rendu')
  })
})

describe('a row expands into the full record (DEC-25)', () => {
  test('the four sections are all there, and the transcript keeps its channels', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    // 1. transcript, with the speaker channel that came free from the hardware
    expect(await screen.findByText('on est plutôt sur un TJM de 520 euros')).toBeTruthy()
    expect(screen.getByText('Moi')).toBeTruthy()
    // `Client` is also the label of the account row, so this asserts on the
    // channel column rather than on the word being present somewhere.
    expect(screen.getAllByText('Client').length).toBeGreaterThan(1)
    // 2. the rep's raw notes, a permanent separate layer (DEC-5)
    expect(screen.getByText('rappeler Camille jeudi')).toBeTruthy()
    // 3. the enhanced compte-rendu
    expect(screen.getByText(/Renfort de deux profils Java/)).toBeTruthy()
    // 4. the extraction, each field citing where it was read from (DEC-21)
    expect(screen.getByText(/« un TJM de 520 euros »/)).toBeTruthy()
    expect(
      screen.getByText('Du calendrier Outlook et de VerySwing — jamais lu sur la transcription.'),
    ).toBeTruthy()
  })

  test('a span that could not be located says so, and wears ⚠ faible', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    expect(await screen.findByText(/introuvable dans la transcription/)).toBeTruthy()
    expect(screen.getByText('⚠ faible')).toBeTruthy()
  })

  test('the record is only fetched when the row opens', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    // A transcript is the biggest thing in the product; fifty of them must not
    // arrive with every search.
    expect(bridge.calls.some((c) => c.channel === 'history:record')).toBe(false)

    await expandTheRow()
    await waitFor(() =>
      expect(bridge.calls.some((c) => c.channel === 'history:record')).toBe(true),
    )
  })
})

describe('who a turn belongs to (DEC-7)', () => {
  /*
   * The reader wrote « Client » for every far-channel turn on every call. With
   * one client contact that is a name the app has, from the calendar, and was
   * throwing away — and `[source ▸]` landing a rep on « Client » tells them
   * nothing about whether the cap came from the buyer or from the DSI.
   */
  test('two people on the client’s side stays « Client »', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    // The app cannot say which of them spoke, and must not pick the first.
    const turn = (await screen.findByText('on est plutôt sur un TJM de 520 euros')).closest('li')
    expect(within(turn as HTMLElement).getByText('Client')).toBeTruthy()
  })

  test('one person on the client’s side is that person, by first name', async () => {
    answered()
    bridge.when('history:record', () =>
      record({
        interlocuteurs: [
          {
            name: 'Camille Le Roy',
            email: 'camille@acme.fr',
            type: 'required',
            response: 'accepted',
          },
        ],
      }),
    )

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    const turn = (await screen.findByText('on est plutôt sur un TJM de 520 euros')).closest('li')
    // The channel is measured by the hardware, the name comes from Graph, and
    // the join of the two is a fact rather than a guess.
    expect(within(turn as HTMLElement).getByText('Camille')).toBeTruthy()
    expect(within(turn as HTMLElement).queryByText('Client')).toBeNull()
    // The rep is still the rep — the microphone settles that one.
    const mine = screen.getByText('très bien, je vous envoie deux CV').closest('li')
    expect(within(mine as HTMLElement).getByText('Moi')).toBeTruthy()
  })
})

describe('« Demander » on the record (DEC-25, DEC-21)', () => {
  /*
   * This is the screen the panel was written for — its own docblock opens on
   * « a rep three weeks later », and three weeks later they are here. It was on
   * the two screens where the call is still fresh and on neither of the ones
   * where it is not.
   */
  const answer = () => ({
    question: 'Qu’est-ce qui a été dit sur le TJM ?',
    answered: true,
    answer: 'Le client parle d’un TJM de 520 euros.',
    citations: [
      {
        span: {
          quote: 'on est plutôt sur un TJM de 520 euros',
          channel: 'far' as const,
          startMs: 61_000,
          endMs: 64_000,
        },
        verified: true,
      },
    ],
  })

  test('it is on the record, and it reads rather than writes', async () => {
    answered()
    bridge.when('history:record', () => record())
    bridge.when('meeting:ask', () => answer())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    fireEvent.change(screen.getByLabelText('Poser une question sur cet appel'), {
      target: { value: 'Quel TJM ?' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Demander' }))
    })

    expect(await screen.findByText(/TJM de 520 euros\.$/)).toBeTruthy()
    // A reader writes nothing (DEC-25): the only channels this screen has
    // touched are the two reads plus the search it opened with.
    const written = bridge.calls.filter((call) =>
      /confirm|create|rename|snapshot|seen/.test(call.channel),
    )
    expect(written).toEqual([])
  })

  /*
   * The citation has to *lead somewhere*, and here it can: the record's own
   * transcription is in the same box. On a surface with no transcript the quote
   * is still drawn and simply not followable, which the panel states rather than
   * offering a control that goes nowhere (DEC-26) — but this is not that
   * surface, and offering the degraded version here would waste the one place
   * the evidence is already on screen.
   */
  test('following a citation lights the turn it came from', async () => {
    answered()
    bridge.when('history:record', () => record())
    bridge.when('meeting:ask', () => answer())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    fireEvent.change(screen.getByLabelText('Poser une question sur cet appel'), {
      target: { value: 'Quel TJM ?' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Demander' }))
    })

    const citation = await screen.findByRole('button', { name: /TJM de 520 euros/ })
    await act(async () => {
      fireEvent.click(citation)
    })

    // The transcript turn, not the citation itself.
    const turn = screen.getByText('on est plutôt sur un TJM de 520 euros').closest('li')
    expect(turn?.className).toMatch(/bg-brand-50/)
    // And exactly one: a phrase said twice would otherwise light the column and
    // point at nothing.
    expect(document.querySelectorAll('li.bg-brand-50')).toHaveLength(1)
  })
})

describe('push status per intent', () => {
  test('the row summarises each intent and a failure is legible without expanding', async () => {
    answered()
    render(<Historique onBack={() => {}} onReglages={() => {}} />)

    await settled()
    const text = document.body.textContent ?? ''
    // A count on the row, and the one state a rep scans for named first. Words
    // either way — « ✓ » is guessable and « ↻ » is not, and there is no glyph
    // key anywhere in the product.
    expect(text).toContain('en échec')
    // The ledger itself — each intent, its state, its id, its reason — is
    // « Envois » in the expanded record, and is asserted by the test below.
    expect(screen.getByTitle(/tâche envoyée/)).toBeTruthy()
  })

  /*
   * Twice, and deliberately: on the collapsed row, where the orange count is,
   * and again in « Envois » with the remote ids beside it.
   *
   * The row used to carry the count alone — « 1 envoi en échec » in orange, no
   * cause, no action — which told a rep their compte-rendu may or may not be in
   * the client's CRM and declined to say which. Réglages gives a broken
   * *connector* a *Réessayer*; the row where the write actually failed gave
   * nothing at all. The cause was two clicks below, and two clicks is exactly
   * the distance at which a rep stops looking.
   */
  test('a failed push says why on the row itself, before anything is expanded', async () => {
    answered()
    render(<Historique onBack={() => {}} onReglages={() => {}} />)

    // Nothing expanded — this is the list as the rep first sees it.
    expect(await screen.findByText(/jeton Microsoft expiré/)).toBeTruthy()
    expect(screen.getByText(/Brouillon de relance \(Outlook\) — échec/)).toBeTruthy()
    /*
      And the instruction names the system that was being written to. « À
      vérifier dans VerySwing » under a failed *Outlook* draft sends the rep to
      the wrong application, and the intent's own kind is what settles it.

      No *Réessayer*: `failed` is the state the outbox uses when an attempt
      threw, so nobody knows whether the record was created, and
      `POST /v1/crm/tasks` has no idempotency key. Everything that *can* be
      retried safely is retried by the outbox itself and never reaches this
      state.
    */
    expect(screen.getByText(/À vérifier dans Outlook avant de refaire l’envoi/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull()
  })

  test('an expanded row states why a push failed (DEC-26)', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await expandTheRow()

    // Twice now: once on the row, once in « Envois » beside the remote ids.
    expect((await screen.findAllByText(/jeton Microsoft expiré/)).length).toBeGreaterThan(0)
    expect(screen.getByText('Tâche compte-rendu (VerySwing)')).toBeTruthy()
    // The remote id is the proof the task really landed.
    expect(screen.getByText(/TASK-77/)).toBeTruthy()
  })
})

// ── The new entry point (DEC-25, DEC-31, VISION.md §6) ──────────────────────

describe('Historique is the expanded form of the calendar’s search', () => {
  test('the way back names the screen it goes to', async () => {
    const backs: number[] = []
    answered()
    render(<Historique onBack={() => backs.push(1)} onReglages={() => {}} />)

    // Not « ← Aujourd'hui »: that screen is called *Calendrier* now, and a back
    // link naming a title nothing carries is a link a rep has to try to read.
    const back = await screen.findByRole('button', { name: '‹ Calendrier' })
    fireEvent.click(back)
    expect(backs).toEqual([1])
  })

  test('it opens on the query and the chips it was handed, and asks with them', async () => {
    const asked: InvokeRequest<'history:search'>[] = []
    bridge.when('history:search', (payload) => {
      asked.push(payload)
      return {
        query: payload.query ?? '',
        filter: withDefaults(payload.filter),
        scanned: 4,
        clients: ['Acme Industries'],
        rows: [row()],
      }
    })

    render(
      <Historique
        onBack={() => {}}
        onReglages={() => {}}
        query="TJM"
        filter={{
          client: 'Acme Industries',
          periode: '30j',
          statut: 'validees',
          intention: 'crm.task',
        }}
      />,
    )
    await settled()

    // The field carries the word the rep typed on the calendar…
    expect((box() as HTMLInputElement).value).toBe('TJM')
    // …and the chips carry the axes they left pressed.
    await waitFor(() =>
      expect(asked.at(-1)).toEqual({
        query: 'TJM',
        limit: 50,
        filter: {
          client: 'Acme Industries',
          periode: '30j',
          statut: 'validees',
          intention: 'crm.task',
        },
      }),
    )
  })

  test('a chip is a question for the main process, never a local narrowing', async () => {
    const asked: InvokeRequest<'history:search'>[] = []
    bridge.when('history:search', (payload) => {
      asked.push(payload)
      return {
        query: payload.query ?? '',
        filter: withDefaults(payload.filter),
        scanned: 4,
        clients: ['Acme Industries', 'Nordis'],
        rows: [row()],
      }
    })

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    const statut = screen.getByRole('group', { name: 'Statut' })
    await act(async () => {
      fireEvent.click(within(statut).getByRole('button', { name: 'Validées' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    await waitFor(() => expect(asked.at(-1)?.filter?.statut).toBe('validees'))
    // The pressed state is in the markup, not only in a colour.
    expect(
      within(statut).getByRole('button', { name: 'Validées' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  test('a pressed chip un-presses, and « Effacer » clears every axis at once', async () => {
    // There is no « Toute période » chip to press any more: the row is one
    // line, and the reset it used to be lives in the toggle and in « Effacer ».
    const asked: InvokeRequest<'history:search'>[] = []
    bridge.when('history:search', (payload) => {
      asked.push(payload)
      return {
        query: payload.query ?? '',
        filter: withDefaults(payload.filter),
        scanned: 4,
        clients: ['Acme Industries'],
        rows: [row()],
      }
    })

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await settled()

    const press = async (group: string, name: string) => {
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole('group', { name: group })).getByRole('button', { name }),
        )
        await new Promise((resolve) => setTimeout(resolve, 260))
      })
    }

    await press('Période', '30 jours')
    await waitFor(() => expect(asked.at(-1)?.filter?.periode).toBe('30j'))

    // The same chip again — the axis comes off, and nothing else moves.
    await press('Période', '30 jours')
    await waitFor(() => expect(asked.at(-1)?.filter?.periode).toBe('toute'))

    // Nothing is filtered, so there is nothing to clear and no control saying
    // otherwise (DEC-26).
    expect(screen.queryByRole('button', { name: 'Effacer' })).toBeNull()

    await press('Statut', 'Validées')
    await waitFor(() => expect(asked.at(-1)?.filter?.statut).toBe('validees'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Effacer' }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    await waitFor(() =>
      expect(asked.at(-1)?.filter).toEqual({
        client: null,
        periode: 'toute',
        statut: 'tous',
        intention: 'toutes',
      }),
    )
    expect(screen.queryByRole('button', { name: 'Effacer' })).toBeNull()
  })

  /**
   * **The reader offers two axes, and the two data axes are the calendar's** (V2).
   *
   * *Intention* and *Client* were here, and the client row in particular turned
   * the one screen built for reading a record into a facet browser: seven client
   * names under a search field, on a screen whose whole argument (DEC-25) is
   * that a rep enters the past by **typing**. They are still offered on the
   * calendar, where the search is a lookup and a name is the fastest way into a
   * call the rep half remembers — `SearchBarProps.dataAxes`.
   *
   * Nothing is lost from here: typing « Acme » into the box beside these chips
   * is the same query, asked in the main process, over the same corpus.
   */
  test('the reader asks how far back and in what state, and offers no data axes', async () => {
    answered({ clients: ['Acme Industries', 'Nordis', 'Groupe Lefort'], rows: [row()] })
    render(<Historique onBack={() => {}} onReglages={() => {}} />)

    expect(await screen.findByRole('group', { name: 'Période' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Statut' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Intention' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Client' })).toBeNull()
    // Offered by the main process and still not drawn here — the axis is the
    // calendar's, and this is not a screen that lost its data.
    expect(screen.queryByRole('button', { name: 'Acme Industries' })).toBeNull()
  })

  test('an answer to a question nobody is asking any more is dropped', async () => {
    // The channel echoes the filter back. An answer carrying a filter the
    // screen has moved on from must not repaint the list.
    bridge.when('history:search', (payload) => ({
      query: payload.query ?? '',
      filter: { client: null, periode: '90j', statut: 'tous', intention: 'toutes' },
      scanned: 1,
      clients: [],
      rows: [row({ meeting: meeting({ id: 'stale', clientName: 'Réponse périmée' }) })],
    }))

    render(<Historique onBack={() => {}} onReglages={() => {}} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    expect(screen.queryByText('Réponse périmée')).toBeNull()
    expect(screen.getByText('Chargement…')).toBeTruthy()
  })
})
