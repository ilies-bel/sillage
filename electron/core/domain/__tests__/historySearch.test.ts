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
  meeting: 'Sodexial — comité de staffing\nSodexial',
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

test('the call’s own name is searchable, which is what a rep types first', () => {
  /*
   * **This surface was missing, and it is the one the screen advertises.**
   *
   * The other three are all *contents* of a call, so « Sodexial » — the client
   * name Historique offers as a filter chip one row above the search box —
   * returned nothing unless somebody had said the word aloud and the
   * transcriber had spelled it that way. A call that had not reached the gate
   * was unreachable by name at all: no transcript, no notes, no compte-rendu,
   * and the search replaces the day list while it is active, so the row was not
   * on screen either. Four French strings and VISION §6 all said this worked,
   * and the enum's own comment said « four surfaces » over three values.
   */
  assert.deepEqual(
    matchesFor(record, 'Sodexial').map((m) => m.where),
    ['meeting'],
  )
  // The objet too — « comité de staffing » is how a rep remembers the call.
  assert.deepEqual(
    matchesFor(record, 'staffing').map((m) => m.where),
    ['meeting'],
  )
})

test('the call’s name leads the excerpts, because it is the strongest answer', () => {
  // One excerpt per surface, in a fixed order: a hit on the call's own name
  // answers « which call was that » outright, a hit in four hundred lines of
  // transcript barely narrows it.
  const both = matchesFor(
    { meeting: 'Sodexial — point TJM', transcript: 'le TJM reste ouvert', notes: '', compteRendu: '' },
    'TJM',
  )
  assert.deepEqual(
    both.map((m) => m.where),
    ['meeting', 'transcript'],
  )
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
    {
      meeting: '',
      transcript: 'on démarre en septembre',
      notes: 'septembre, à confirmer',
      compteRendu: '',
    },
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

test('the apostrophe is folded, in both directions — a Windows keyboard types U+0027', () => {
  /*
   * Everything stored carries U+2019: `check:french` enforces it in repo prose,
   * `terms.fr-esn.ts` ships « appel d’offres » as a Whisper boost term, and both
   * the STT and the composer write it. A Windows AZERTY keyboard — the primary
   * platform (HR-2) — emits U+0027. So the product's only route back into a past
   * call answered « Aucun appel ne correspond. » about calls sitting in the
   * store, for every French contraction there is.
   */
  const curly = {
    meeting: 'Néovia — appel d’offres',
    transcript: 'Le client n’a pas validé l’offre aujourd’hui.',
    notes: '',
    compteRendu: '',
  }
  for (const query of ["appel d'offres", 'appel d’offres', "l'offre", 'l’offre', "aujourd'hui"]) {
    assert.ok(matchesFor(curly, query).length > 0, `« ${query} » ne trouve rien`)
  }
  // And the other direction: a record written with a straight quote, searched
  // with the curly one the app itself would produce.
  const straight = { ...curly, transcript: "Le client n'a pas validé l'offre." }
  assert.ok(matchesFor(straight, 'l’offre').length > 0)

  // Ligatures, for the same reason and with the same shape: NFD leaves `œ`
  // alone and `Cœur` is one word to a rep.
  assert.ok(matchesFor({ ...curly, notes: 'Groupe Cœur de Ville' }, 'coeur').length > 0)
  assert.ok(matchesFor({ ...curly, notes: 'Groupe Coeur de Ville' }, 'cœur').length > 0)
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
  const [match] = matchesFor({ meeting: '', transcript: 'TJM évoqué', notes: '', compteRendu: '' }, 'TJM')
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
