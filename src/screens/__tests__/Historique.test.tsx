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

    render(<Historique onBack={() => {}} />)
    await settled()

    await act(async () => {
      fireEvent.change(box(), { target: { value: 'TJM' } })
      // Past the debounce, which exists so a three-letter word costs one pass
      // over the log rather than three.
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    await waitFor(() => expect(queries).toContain('TJM'))
  })

  test('the matched excerpt is shown under the row, with the surface it came from', async () => {
    answered({
      rows: [
        row({
          matches: [
            { where: 'transcript', excerpt: '…plutôt sur un TJM de 520 euros…' },
            { where: 'notes', excerpt: 'penser au TJM avant la relance' },
          ],
        }),
      ],
    })

    render(<Historique onBack={() => {}} />)

    expect(await screen.findByText(/plutôt sur un TJM de 520 euros/)).toBeTruthy()
    expect(screen.getByText('Transcript')).toBeTruthy()
    expect(screen.getByText('Mes notes')).toBeTruthy()
  })

  test('an empty result says so rather than showing an empty box', async () => {
    answered({ rows: [] })
    render(<Historique onBack={() => {}} />)
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

describe('a row expands into the full record (DEC-25)', () => {
  test('the four sections are all there, and the transcript keeps its channels', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} />)
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

    render(<Historique onBack={() => {}} />)
    await expandTheRow()

    expect(await screen.findByText(/introuvable dans la transcription/)).toBeTruthy()
    expect(screen.getByText('⚠ faible')).toBeTruthy()
  })

  test('the record is only fetched when the row opens', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} />)
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

describe('push status per intent', () => {
  test('the row summarises each intent and a failure is legible without expanding', async () => {
    answered()
    render(<Historique onBack={() => {}} />)

    await settled()
    const text = document.body.textContent ?? ''
    expect(text).toContain('tâche✓')
    expect(text).toContain('mail⚠')
  })

  test('an expanded row states why a push failed (DEC-26)', async () => {
    answered()
    bridge.when('history:record', () => record())

    render(<Historique onBack={() => {}} />)
    await expandTheRow()

    expect(await screen.findByText('jeton Microsoft expiré')).toBeTruthy()
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
    render(<Historique onBack={() => backs.push(1)} />)

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

    render(<Historique onBack={() => {}} />)
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

    render(<Historique onBack={() => {}} />)
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
    await press('Intention', 'Tâche')
    await press('Client', 'Acme Industries')
    await waitFor(() => expect(asked.at(-1)?.filter?.client).toBe('Acme Industries'))

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

  test('the client chips come from the main process, never from the rows on screen', async () => {
    answered({ clients: ['Acme Industries', 'Nordis', 'Groupe Lefort'], rows: [row()] })
    render(<Historique onBack={() => {}} />)

    const client = await screen.findByRole('group', { name: 'Client' })
    // One row is on screen and three clients are offered — the corpus is the
    // main process's, and the chips are facet values it computed there.
    for (const name of ['Acme Industries', 'Nordis', 'Groupe Lefort']) {
      expect(within(client).getByRole('button', { name })).toBeTruthy()
    }
    // Three names offered and three chips drawn — no « Tous clients » at the
    // head of the axis. Un-pressing the pressed chip is what clears it.
    expect(within(client).getAllByRole('button')).toHaveLength(3)
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

    render(<Historique onBack={() => {}} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    expect(screen.queryByText('Réponse périmée')).toBeNull()
    expect(screen.getByText('Chargement…')).toBeTruthy()
  })
})
