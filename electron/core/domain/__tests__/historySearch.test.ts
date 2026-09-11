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
  /** The rep's own marks, typed from the widget during the call (DEC-49). */
  marks: 'prix : ils bloquent à 550',
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
    {
      meeting: 'Sodexial — point TJM',
      marks: '',
      transcript: 'le TJM reste ouvert',
      notes: '',
      compteRendu: '',
    },
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
    matchesFor(record, 'bloquent').map((m) => m.where),
    ['marks'],
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
      marks: '',
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
    marks: '',
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

/**
 * **The one thing a rep can type from inside the call, and no search reached it.**
 *
 * A mark (`core/contracts/marks.ts`) is pressed on the widget floating over
 * Teams — the only Sillage surface a rep can see while the client is talking —
 * and its note is typed one-handed, capped at 280 characters. The widget drew
 * it, both readers drew it, `Projections.marks` folded it, and `searchableRecord`
 * folded four surfaces of which this was not one: « prix : ils bloquent à 550 »
 * was in the record and `550` did not find it. The product's answer to « a rep
 * who is talking is not looking for a button » was write-only.
 */
test('the rep’s own marks are searchable — the one surface they can write in the call', () => {
  assert.deepEqual(
    matchesFor(record, '550').map((m) => m.where),
    ['marks'],
  )
  // Typed one-handed, so found the way it was typed: folded like everything else.
  assert.deepEqual(
    matchesFor(record, 'BLOQUENT').map((m) => m.where),
    ['marks'],
  )
  // Second in the order, above the rep's own notes and above the transcript: a
  // mark is one sentence the rep chose to type *while the client was talking*.
  const everywhere = matchesFor(
    {
      meeting: 'Sodexial — point TJM',
      marks: 'TJM bloqué à 550',
      transcript: 'le TJM reste ouvert',
      notes: 'TJM à revoir',
      compteRendu: 'Le TJM retenu est de 550 euros.',
    },
    'TJM',
  )
  assert.deepEqual(
    everywhere.map((m) => m.where),
    ['meeting', 'marks', 'transcript', 'notes', 'compteRendu'],
  )
})

/**
 * **One « œ » used to destroy every excerpt on the surface.**
 *
 * The index was found in a folded copy and applied to the original only after
 * both were checked to be the same length; when they were not, the excerpt fell
 * back to the first eighty characters of the surface — which is true, readable,
 * and **not an excerpt**: the row exists to say which surface matched *and
 * where*. The justification named `ﬁ` as the character that folds to two, and
 * `ﬁ` does not — its decomposition is a compatibility one, so `NFD` leaves it
 * alone. The two that do are the two this fold writes itself, and « mise en
 * œuvre », « cœur de métier » and « nœud » are ordinary ESN French.
 */
test('the excerpt finds the hit even when the fold is not length-preserving', () => {
  // Executed, not asserted from a docblock: `ﬁ` is length-preserving here and
  // the ligatures this fold writes are not.
  assert.equal(fold('ﬁ').length, 'ﬁ'.length)
  assert.equal(fold('œ'), 'oe')
  assert.equal(fold('æ'), 'ae')
  assert.ok(fold('œ').length > 'œ'.length)

  const transcript =
    'Alors, sur la mise en œuvre : on démarre le lot 1 en septembre, avec deux ' +
    'ingénieurs sur site. Le cœur de métier reste la plateforme de facturation. ' +
    'Côté budget, leur grille achats plafonne le TJM à 520 euros sur un profil ' +
    'confirmé, et Camille doit valider avant la fin du mois.'
  const oeuvre = { meeting: '', marks: '', transcript, notes: '', compteRendu: '' }

  for (const query of ['TJM', 'Camille', 'facturation']) {
    const [match] = matchesFor(oeuvre, query)
    assert.ok(match, `« ${query} » ne trouve rien`)
    assert.ok(
      match.excerpt.includes(query),
      `l’extrait de « ${query} » ne contient pas ce qui a été trouvé : ${match.excerpt}`,
    )
  }

  // And the window is the same one the ligature-free spelling produces, because
  // the offsets are mapped rather than abandoned.
  const plain = transcript.replace(/œ/g, 'oe')
  assert.equal(
    matchesFor({ ...oeuvre, transcript }, 'TJM')[0]?.excerpt,
    matchesFor({ ...oeuvre, transcript: plain }, 'TJM')[0]?.excerpt,
  )

  // The hit itself can be the ligature. « nœud » typed either way finds the
  // other, and the excerpt still opens on the word rather than on the call.
  const nodes =
    'On garde le nœud de routage actuel pendant toute la phase 1, ' +
    'et on bascule ensuite sur la nouvelle plateforme de facturation en juin.'
  for (const query of ['nœud', 'noeud']) {
    const [match] = matchesFor({ ...oeuvre, transcript: nodes }, query)
    assert.ok(match, `« ${query} » ne trouve rien`)
    assert.match(match.excerpt, /nœud de routage/)
  }
})

/**
 * **The property the excerpt has, proved over every window of real French.**
 *
 * The two length-changing characters were found by reading; the guard they broke
 * was justified with a third that does not have the property at all. So the rule
 * is stated once and checked exhaustively instead of by example: whatever a rep
 * types, if it is found, the window that comes back contains it. Whitespace is
 * collapsed on both sides because `ellipsise` collapses it in the excerpt.
 */
test('whatever is found is inside the excerpt — every window, not a chosen one', () => {
  const corpus = [
    'Sur la mise en œuvre du lot 2, le cœur de métier reste la facturation, et le nœud de routage ne bouge pas.',
    'Leur grille achats plafonne le TJM à 520 euros ; Camille valide avant la fin du mois.',
    'Le client n’a pas validé l’offre aujourd’hui — l’appel d’offres part en février.',
    'Deux profils Java confirmés, démarrage septembre, astreinte à cadrer avec les achats.',
    'Ex æquo sur les deux candidats : on part sur celui qui connaît déjà la plateforme.',
  ]
  const flat = (value: string): string => fold(value).replace(/\s+/g, ' ').trim()
  let windows = 0
  for (const text of corpus) {
    for (const length of [3, 7, 14, 31]) {
      for (let start = 0; start + length <= text.length; start += 1) {
        const needle = text.slice(start, start + length)
        if (needle.trim() === '') continue
        const [match] = matchesFor({ meeting: '', marks: '', transcript: text, notes: '', compteRendu: '' }, needle)
        assert.ok(match, `« ${needle} » ne trouve rien dans un texte qui le contient`)
        assert.ok(
          flat(match.excerpt).includes(flat(needle)),
          `l’extrait ne contient pas « ${needle} » : ${match.excerpt}`,
        )
        windows += 1
      }
    }
  }
  // A check that measures nothing is worse than no check.
  assert.ok(windows > 1000, `seulement ${windows} fenêtres mesurées`)
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
  const [match] = matchesFor(
    { meeting: '', marks: '', transcript: 'TJM évoqué', notes: '', compteRendu: '' },
    'TJM',
  )
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
