/**
 * Historique's matcher (DEC-25).
 *
 * The search runs in the main process, so this function is the only place its
 * behaviour is observable. Two things it has to get right for French — folded
 * accents and folded case — and one thing it has to get right for the boundary:
 * the excerpt is a window, not the surface it was cut from.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { HistoryFilter, HistoryIntent } from '../../contracts/history.ts'
import type { Meeting } from '../../contracts/meeting.ts'
import {
  NO_FILTER,
  fold,
  isFiltering,
  isSearching,
  matchesFor,
  meetingAnchor,
  passesFilter,
  sameFilter,
  withFilterDefaults,
} from '../historySearch.ts'

const record = {
  transcript:
    'alors sur le budget, on est plutôt sur un TJM de 520 euros par jour, et il faudra que Camille valide avant la fin du mois',
  notes: 'penser au démarrage septembre',
  compteRendu: '## Contexte\n\nRenfort de deux profils Java sur la plateforme.',
}

test('an empty query matches nothing and is not a search', () => {
  assert.equal(isSearching(''), false)
  assert.equal(isSearching('   '), false)
  assert.deepEqual(matchesFor(record, ''), [])
  assert.deepEqual(matchesFor(record, '   '), [])
})

test('each surface is searched, and the match says which one it came from', () => {
  assert.deepEqual(
    matchesFor(record, 'TJM').map((m) => m.where),
    ['transcript'],
  )
  assert.deepEqual(
    matchesFor(record, 'septembre').map((m) => m.where),
    ['notes'],
  )
  assert.deepEqual(
    matchesFor(record, 'Renfort').map((m) => m.where),
    ['compteRendu'],
  )
})

test('one query can match several surfaces, in a fixed order', () => {
  const both = matchesFor(
    { transcript: 'on démarre en septembre', notes: 'septembre, à confirmer', compteRendu: '' },
    'septembre',
  )
  assert.deepEqual(
    both.map((m) => m.where),
    ['transcript', 'notes'],
  )
})

test('accents and case are folded — a rep who types `demarrage` means `démarrage`', () => {
  assert.equal(fold('Démarrage'), 'demarrage')
  assert.equal(matchesFor(record, 'demarrage').length, 1)
  assert.equal(matchesFor(record, 'DÉMARRAGE').length, 1)
  assert.equal(matchesFor(record, 'tjm').length, 1)
})

test('the match is a substring, because ESN vocabulary is compound and inflected', () => {
  // A word-boundary matcher would miss the plural of the most searched term in
  // the product.
  assert.equal(matchesFor({ ...record, notes: 'comparer les TJMs' }, 'TJM').length, 2)
})

test('the excerpt is a window around the hit, not the surface it was cut from', () => {
  const [match] = matchesFor(record, 'TJM')
  assert.ok(match)
  assert.match(match.excerpt, /TJM de 520 euros/)
  // The tail of the sentence stays on the main process's side of the boundary.
  assert.equal(match.excerpt.includes('avant la fin du mois'), false)
  assert.ok(match.excerpt.length < 120)
  // Elided at both ends, so nobody reads it as the whole of what was said.
  assert.ok(match.excerpt.startsWith('…') && match.excerpt.endsWith('…'))
})

test('a hit at the very start is not elided at the front', () => {
  const [match] = matchesFor({ transcript: 'TJM évoqué', notes: '', compteRendu: '' }, 'TJM')
  assert.equal(match?.excerpt, 'TJM évoqué')
})

test('the excerpt is cut from the original text, accents intact', () => {
  const [match] = matchesFor(record, 'renfort')
  // Folded to find it, sliced from the original to show it: a search that
  // returned « Renfort de deux profils » stripped of its accents would look
  // like a transcription bug.
  assert.match(match?.excerpt ?? '', /Renfort de deux profils Java/)
})

test('whitespace is collapsed, so a markdown excerpt is one readable line', () => {
  const [match] = matchesFor(record, 'Contexte')
  assert.equal((match?.excerpt ?? '').includes('\n'), false)
})

// ── The filter chips (DEC-25, DEC-31) ───────────────────────────────────────
//
// The chips run in the main process beside the matcher, so — like the matcher —
// this is the only place their behaviour is observable. Four axes, and the two
// that are easy to get quietly wrong are `période` (which day does a meeting
// belong on?) and `statut` (which states count as « à valider »?).

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'm1',
  state: 'done',
  title: 'Acme — cadrage',
  eventId: null,
  clientName: 'Acme SA',
  scheduledStart: null,
  createdAt: 0,
  startedAt: null,
  endedAt: null,
  confirmedAt: null,
  updatedAt: 0,
  ...over,
})

const intent = (kind: HistoryIntent['kind']): HistoryIntent => ({
  intentId: `m1:${kind}`,
  kind,
  label: kind,
  state: 'drained',
  attempts: 1,
  lastError: null,
  remoteId: 'X-1',
})

const NOW = Date.parse('2026-08-05T10:00:00Z')
const daysAgo = (days: number): number => NOW - days * 86_400_000

const passes = (
  over: Partial<HistoryFilter>,
  m: Meeting = meeting(),
  intents: HistoryIntent[] = [],
): boolean => passesFilter({ meeting: m, intents, filter: { ...NO_FILTER, ...over }, now: NOW })

test('no chip on passes everything — that is the listing, and it is the same code path', () => {
  assert.equal(isFiltering(NO_FILTER), false)
  assert.equal(passes({}), true)
  assert.equal(passes({}, meeting({ state: 'aborted', clientName: null })), true)
})

test('a partial filter over IPC is filled in, and an undefined field is not a value', () => {
  assert.deepEqual(withFilterDefaults(undefined), NO_FILTER)
  assert.deepEqual(withFilterDefaults({}), NO_FILTER)
  // The trap this function exists for: spreading `{ client: undefined }` over a
  // default yields `undefined`, which is neither « aucun client » nor a client.
  assert.deepEqual(withFilterDefaults({ client: undefined }), NO_FILTER)
  assert.deepEqual(withFilterDefaults({ statut: 'validees' }), { ...NO_FILTER, statut: 'validees' })
})

test('client is exact, because the value came from the corpus and not from a rep', () => {
  assert.equal(passes({ client: 'Acme SA' }), true)
  assert.equal(passes({ client: 'Acme' }), false)
  assert.equal(passes({ client: 'Acme SA' }, meeting({ clientName: null })), false)
})

test('période measures against the day the meeting is drawn on, not against created_at', () => {
  // A call the rep placed on the calendar for last week, created a month ago:
  // it is drawn on last week, so « 7 jours » has to find it. Measuring from
  // `createdAt` would drop the row out of the range it is visibly in.
  const placed = meeting({ createdAt: daysAgo(30), scheduledStart: daysAgo(3) })
  assert.equal(passes({ periode: '7j' }, placed), true)

  const old = meeting({ createdAt: daysAgo(3), scheduledStart: daysAgo(40) })
  assert.equal(passes({ periode: '7j' }, old), false)
  assert.equal(passes({ periode: '90j' }, old), true)
  assert.equal(passes({ periode: 'toute' }, old), true)
})

test('a meeting with neither a placed day nor a start falls back to created_at', () => {
  assert.equal(meetingAnchor(meeting({ createdAt: daysAgo(2) })), daysAgo(2))
  assert.equal(
    meetingAnchor(meeting({ createdAt: daysAgo(30), startedAt: daysAgo(2) })),
    daysAgo(2),
  )
  assert.equal(passes({ periode: '7j' }, meeting({ createdAt: daysAgo(2) })), true)
})

test('statut partitions what happens after the call, and pushing is already validée', () => {
  const inState = (state: Meeting['state']) => meeting({ state })

  for (const state of ['ended', 'extracting', 'awaiting_confirmation'] as const) {
    assert.equal(passes({ statut: 'a-valider' }, inState(state)), true, state)
    assert.equal(passes({ statut: 'validees' }, inState(state)), false, state)
  }
  // The rep confirmed and the outbox is draining. Asking them to validate a
  // second time is the one thing DEC-4 forbids, so it is not « à valider ».
  assert.equal(passes({ statut: 'validees' }, inState('pushing')), true)
  assert.equal(passes({ statut: 'validees' }, inState('done')), true)
  assert.equal(passes({ statut: 'abandonnees' }, inState('aborted')), true)

  // A call that has not happened is in none of the three buckets — it is not
  // history — and `tous` is where it shows.
  for (const state of ['idle', 'armed', 'recording'] as const) {
    assert.equal(passes({ statut: 'a-valider' }, inState(state)), false, state)
    assert.equal(passes({ statut: 'tous' }, inState(state)), true, state)
  }
})

test('intention asks what the call produced, from the outbox and not from the model', () => {
  const withTask = [intent('crm.task'), intent('mail.draft')]
  assert.equal(passes({ intention: 'crm.task' }, meeting(), withTask), true)
  assert.equal(passes({ intention: 'crm.opportunity' }, meeting(), withTask), false)
  assert.equal(passes({ intention: 'toutes' }, meeting(), []), true)
  assert.equal(passes({ intention: 'mail.draft' }, meeting(), []), false)
})

test('the axes are ANDed — every chip narrows, none of them widens', () => {
  const m = meeting({ state: 'done', clientName: 'Acme SA', scheduledStart: daysAgo(3) })
  const intents = [intent('crm.task')]
  const all: Partial<HistoryFilter> = {
    client: 'Acme SA',
    periode: '7j',
    statut: 'validees',
    intention: 'crm.task',
  }
  assert.equal(passes(all, m, intents), true)
  assert.equal(passes({ ...all, client: 'Nordis' }, m, intents), false)
  assert.equal(passes({ ...all, periode: '7j' }, meeting({ ...m, scheduledStart: daysAgo(40) }), intents), false)
  assert.equal(passes({ ...all, statut: 'abandonnees' }, m, intents), false)
  assert.equal(passes({ ...all, intention: 'mail.draft' }, m, intents), false)
})

test('two filters are the same question, field by field and never by identity', () => {
  assert.equal(sameFilter(NO_FILTER, { ...NO_FILTER }), true)
  assert.equal(sameFilter(NO_FILTER, { ...NO_FILTER, periode: '7j' }), false)
  assert.equal(isFiltering({ ...NO_FILTER, client: 'Acme SA' }), true)
  assert.equal(isFiltering({ ...NO_FILTER, intention: 'mail.draft' }), true)
})
