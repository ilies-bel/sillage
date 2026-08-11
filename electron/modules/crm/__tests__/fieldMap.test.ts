/**
 * The field map — that it is really a table, and that every row's codec is
 * really an inverse.
 *
 * The round trip is the point. A mapping table is only worth having if a wrong
 * row fails here rather than in the client's CRM, and the two date formats
 * (`docs/reference/vsa-api.md` calls them out as easy to get wrong) are exactly
 * the kind of row that goes wrong silently.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATOM,
  DAY,
  TEXT,
  columnsFor,
  domainFor,
  field,
  EXTRACTION_FIELDS,
  OPPORTUNITY_FIELDS,
  TASK_FIELDS,
  ALL_FIELD_TABLES,
} from '../vsa/fieldMap.ts'
import type { ExtractionESN } from '../../../core/contracts/extraction.ts'
import type { CompteRenduPayload, OpportunityPayload } from '../../../core/contracts/push.ts'

const SPAN = { quote: 'deux développeurs Java', channel: null, startMs: null, endMs: null }

const COMPTE_RENDU: CompteRenduPayload = {
  title: 'Aura Technologies — cadrage',
  body: '## Besoin\n\nDeux développeurs Java senior.',
  accountId: 'AURA',
  opportunityRef: null,
  contactIds: ['11'],
  dueAt: Date.parse('2026-08-05T13:05:02Z'),
  endsAt: Date.parse('2026-08-05T14:00:00Z'),
}

const OPPORTUNITY: OpportunityPayload = {
  title: 'Aura — 2 devs Java',
  description: 'Renfort équipe paiement',
  accountId: 'AURA',
  amount: 120000,
  currency: 'EUR',
  closingDate: Date.parse('2026-09-30T09:12:00Z'),
  contextDescription: 'Refonte du socle de paiement',
  technicalEnvDescription: 'Java 21, Spring Boot, Kafka',
  profileDescription: '2× Dev Java senior',
  startingDate: Date.parse('2026-09-01T00:00:00Z'),
}

const EXTRACTION: ExtractionESN = {
  facts: {
    taskName: 'Aura Technologies — cadrage',
    startsAt: COMPTE_RENDU.dueAt,
    endsAt: COMPTE_RENDU.endsAt,
    interlocuteurs: [],
    repEmail: 'claire@shodo.fr',
    account: { accountId: 'AURA', name: 'Aura Technologies', confidence: 'ok' },
    knownContactIds: ['11'],
  },
  interpretation: {
    recipe: 'besoin-commercial',
    compteRendu: '## Besoin',
    besoin: { value: 'Renfort de deux développeurs Java', span: SPAN },
    profilsRecherches: [
      { value: { intitule: 'Dev Java', seniorite: 'senior', stack: ['Java', 'Spring'], nombre: 2 }, span: SPAN },
    ],
    modeCollaboration: { value: 'régie', span: SPAN },
    tjmEvoque: null,
    dateDemarrage: { value: 'septembre', span: SPAN },
    dureeMission: null,
    contexteTechnique: { value: 'Java 21, Spring Boot, Kafka', span: SPAN },
    objections: [],
    prochainesEtapes: [],
  },
}

// ── the round trip ─────────────────────────────────────────────────────────

test('every row of every table round-trips through its codec', () => {
  const cases = [
    { rows: TASK_FIELDS, source: COMPTE_RENDU },
    { rows: OPPORTUNITY_FIELDS, source: OPPORTUNITY },
    { rows: EXTRACTION_FIELDS, source: EXTRACTION },
  ]

  for (const { rows, source } of cases) {
    for (const row of rows) {
      const value = (row.read as (s: unknown) => string | number | null)(source)
      if (value === null) continue
      const column = row.codec.toColumn(value)
      const back = row.codec.toDomain(column)
      // `DAY` is lossy by design — a closing *day* has no time of day — so the
      // invariant is stated in column space, where it holds for every codec.
      assert.deepEqual(
        row.codec.toColumn(back),
        column,
        `${row.domain} → ${row.column} is not stable through ${row.codec.id}`,
      )
    }
  }
})

test('a folded body reads back as the same domain values', () => {
  const body = columnsFor(TASK_FIELDS, COMPTE_RENDU)
  const back = domainFor(TASK_FIELDS, body)
  assert.equal(back.title, COMPTE_RENDU.title)
  assert.equal(back.body, COMPTE_RENDU.body)
  // ATOM carries whole seconds, and the fixture is on a second boundary.
  assert.equal(back.dueAt, COMPTE_RENDU.dueAt)
  assert.equal(back.endsAt, COMPTE_RENDU.endsAt)
})

// ── the two date formats, which is the gotcha the codecs exist for ─────────

test('the task carries ATOM and the opportunity carries yyyy-mm-dd', () => {
  const task = columnsFor(TASK_FIELDS, COMPTE_RENDU)
  const opportunity = columnsFor(OPPORTUNITY_FIELDS, OPPORTUNITY)

  const dates = Object.entries(task).filter(([, value]) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
  assert.equal(dates.length, 2, 'both task dates are full timestamps')
  for (const [, value] of dates) assert.match(String(value), /\+00:00$/)

  assert.equal(ATOM.toColumn(Date.parse('2026-08-05T13:05:02Z')), '2026-08-05T13:05:02+00:00')
  assert.equal(DAY.toColumn(Date.parse('2026-09-30T09:12:00Z')), '2026-09-30')
  assert.ok(
    Object.values(opportunity).some((value) => value === '2026-09-30'),
    'the opportunity closes on a day, not an instant',
  )
})

// ── omission and the one column that is never omitted ──────────────────────

test('a null reads as an absent column, except where the row says otherwise', () => {
  const withoutStart = columnsFor(OPPORTUNITY_FIELDS, { ...OPPORTUNITY, startingDate: null })
  const startColumn = OPPORTUNITY_FIELDS.find((row) => row.domain === 'startingDate')?.column ?? ''
  assert.equal(startColumn in withoutStart, false, 'an unknown start date is not sent as an empty string')

  const emptyReport = columnsFor(TASK_FIELDS, { ...COMPTE_RENDU, body: '' })
  const bodyColumn = TASK_FIELDS.find((row) => row.domain === 'body')?.column ?? ''
  assert.equal(emptyReport[bodyColumn], '', 'an empty compte-rendu is visible in VSA, never absent')
})

test('the extraction table renders profiles the way the column is named for', () => {
  const columns = columnsFor(EXTRACTION_FIELDS, EXTRACTION)
  const profiles = EXTRACTION_FIELDS.find((row) => row.domain === 'interpretation.profilsRecherches')?.column ?? ''
  assert.equal(columns[profiles], '2× Dev Java senior (Java, Spring)')
})

test('a spoken start date stays free text and never reaches a date column', () => {
  const columns = columnsFor(EXTRACTION_FIELDS, EXTRACTION)
  assert.ok(
    Object.values(columns).includes('septembre'),
    'the approximation is kept as it was said',
  )
  for (const [column, value] of Object.entries(columns)) {
    if (typeof value !== 'string') continue
    if (value === 'septembre') {
      assert.equal(/date/i.test(column), false, `"septembre" must not be written into ${column}`)
    }
  }
})

// ── the seam a client column uses ──────────────────────────────────────────

test('a client column is one row, and needs no code change to be written', () => {
  const clientRow = field({
    domain: 'title',
    column: 'reference',
    read: (p: CompteRenduPayload) => p.title.slice(0, 8),
    codec: TEXT,
  })
  const body = columnsFor([...TASK_FIELDS, clientRow], COMPTE_RENDU)
  assert.equal(body.reference, 'Aura Tec')
  assert.equal(Object.keys(body).length, TASK_FIELDS.length + 1)
})

test('every table is reachable as data, for the probe to check', () => {
  assert.deepEqual(Object.keys(ALL_FIELD_TABLES).sort(), ['createOpportunity', 'createTask', 'extraction'])
  for (const rows of Object.values(ALL_FIELD_TABLES)) {
    for (const row of rows) {
      assert.ok(row.column.length > 0)
      assert.ok(row.domain.length > 0)
    }
  }
})
