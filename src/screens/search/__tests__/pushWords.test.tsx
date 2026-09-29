/**
 * **Two screens, one click apart, saying what became of the same three pushes.**
 *
 * The row summary in *Historique* and the « Envois » ledger under it are the
 * same five outbox states seen at two zoom levels, and they were two hand-written
 * tables. Measured on the shipped surfaces before this file existed, with all
 * three intents `drained`:
 *
 *     la ligne     tâche envoyée · opportunité envoyée · mail envoyée
 *     « Envois »   Tâche compte-rendu (VerySwing) envoyé
 *                  Opportunité (VerySwing) envoyé
 *                  Brouillon de relance (Outlook) envoyé
 *
 * Four of six wrong, in opposite directions, on the one column that says whether
 * a client's CRM received anything — and the write behind it has no idempotency
 * key and no delete verb, so a rep who cannot read the state cannot recover from
 * it either.
 *
 * Both blocks drive the **rendered** surfaces rather than the tables, because a
 * test over the tables is a test that the tables agree with themselves.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { HistoryIntent } from '../../../../electron/core/contracts/history.ts'
import type { Meeting } from '../../../../electron/core/contracts/meeting.ts'
import { OutboxStateSchema, PushIntentKindSchema } from '../../../../electron/core/contracts/push.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../../test/appBridge.ts'
import { Historique } from '../../Historique.tsx'
import { INTENT_SHORT, pushWord } from '../pushWords.ts'

let bridge: FakeBridge
let uninstall: () => void

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

/** The gate's own labels (`INTENT_LABEL`), which is what the ledger prints. */
const LABEL: Record<HistoryIntent['kind'], string> = {
  'crm.task': 'Tâche compte-rendu (VerySwing)',
  'crm.opportunity': 'Opportunité (VerySwing)',
  'mail.draft': 'Brouillon de relance (Outlook)',
}

const intents = (state: HistoryIntent['state']): HistoryIntent[] =>
  PushIntentKindSchema.options.map((kind) => ({
    intentId: `i:${kind}`,
    kind,
    label: LABEL[kind],
    state,
    attempts: 1,
    lastError: null,
    remoteId: state === 'drained' ? `R-${kind}` : null,
  }))

const meeting: Meeting = {
  id: 'm1',
  state: 'done',
  title: 'Point Acme',
  eventId: null,
  clientName: 'Acme',
  scheduledStart: null,
  createdAt: 1,
  startedAt: 1,
  endedAt: 2,
  confirmedAt: 3,
  updatedAt: 3,
}

/** Opens *Historique* on one meeting whose three pushes are all in `state`. */
const openRecord = async (state: HistoryIntent['state']) => {
  const rows = intents(state)
  bridge.when('history:search', (payload) => ({
    query: payload.query ?? '',
    filter: { client: null, periode: 'toute', statut: 'tous', intention: 'toutes' },
    scanned: 1,
    clients: [],
    rows: [{ meeting, status: 'Validée', intents: rows, matches: [] }],
  }))
  bridge.when('history:record', () => ({
    meeting,
    marks: [],
    interlocuteurs: [],
    segments: [],
    notes: '',
    compteRendu: '## Résumé\n\nRien.',
    fields: [],
    overall: 'ok' as const,
    intents: rows,
  }))
  render(<Historique onBack={() => {}} onReglages={() => {}} />)
  await screen.findByRole('list', { name: 'Appels enregistrés' })
  const row = screen.getAllByRole('button').find((b) => (b.textContent ?? '').includes('Acme'))
  await act(async () => {
    fireEvent.click(row!)
  })
  await waitFor(() => screen.getByText('Envois'))
  return screen.getByText('Envois').parentElement as HTMLElement
}

/** The collapsed row's summary cell, which carries the per-intent wording. */
const summaryTooltip = (): string => {
  const cell = document.querySelector('[title]')
  expect(cell, 'la ligne repliée ne résume plus ses envois').toBeTruthy()
  return cell?.getAttribute('title') ?? ''
}

describe('the push state agrees with the thing the push creates', () => {
  /**
   * The whole cross-product, because the defect was never one word: it was two
   * tables, and every row of one was free to drift from the other. Five states
   * × three kinds, read off both rendered surfaces.
   */
  for (const state of OutboxStateSchema.options) {
    test(`« ${state} » reads the same on the row and in the ledger`, async () => {
      const ledger = await openRecord(state)
      /*
        The collapsed row draws `counted()` — « 1 envoi en échec · 2 effectués »
        — and carries the per-intent wording in its `title`, which is the only
        place the row and the ledger say the same thing in the same words.
      */
      const tooltip = summaryTooltip()

      for (const kind of PushIntentKindSchema.options) {
        const word = pushWord(state, kind)
        const line = [...ledger.querySelectorAll('li')].find((li) =>
          (li.textContent ?? '').startsWith(LABEL[kind]),
        )
        expect(line?.textContent, `« Envois » ne dit pas « ${LABEL[kind]} ${word} »`).toContain(
          `${LABEL[kind]} ${word}`,
        )
        expect(
          tooltip,
          `le résumé de la ligne ne dit pas « ${INTENT_SHORT[kind]} ${word} »`,
        ).toContain(`${INTENT_SHORT[kind]} ${word}`)
      }
    })
  }

  /**
   * Named separately from the loop above, because this is the half a reviewer
   * has to be able to read without running anything: « mail envoyée » and
   * « Tâche compte-rendu (VerySwing) envoyé » both shipped, and both are the
   * same mistake made from opposite ends.
   */
  test('« envoyé » is the only state word that inflects, and it does', () => {
    expect(pushWord('drained', 'crm.task')).toBe('envoyée')
    expect(pushWord('drained', 'crm.opportunity')).toBe('envoyée')
    expect(pushWord('drained', 'mail.draft')).toBe('envoyé')
    for (const state of OutboxStateSchema.options) {
      if (state === 'drained') continue
      const spoken = new Set(PushIntentKindSchema.options.map((kind) => pushWord(state, kind)))
      expect(spoken.size, `« ${state} » varie avec le genre sans raison`).toBe(1)
    }
  })
})
