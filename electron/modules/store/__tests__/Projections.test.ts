/**
 * Projections are derived, rebuildable and never authoritative — and the outbox
 * is the one whose correctness has teeth, because `POST /v1/crm/tasks` has no
 * idempotency key (ARCHITECTURE.md §5.F).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../index.ts'
import type { PushIntent } from '../../../core/contracts/push.ts'
import { meetingAnchor } from '../../../core/contracts/meeting.ts'
import { adHocContext, adHocMeetingId, adHocTitle } from '../../../core/domain/adHoc.ts'
import { AD_HOC_ID_PREFIX } from '../Projections.ts'
import {
  sampleExtraction,
  sampleSegment,
  sampleVerification,
} from '../../../core/contracts/fixtures.ts'

let now = 1000
const clock = () => now++

const opportunity: PushIntent = {
  id: 'i-oppy',
  meetingId: 'm1',
  kind: 'crm.opportunity',
  dependsOn: [],
  payload: {
    title: 'Acme — 2 Dev Java',
    description: '…',
    accountId: 'ACC-1042',
    amount: 120_000,
    currency: 'EUR',
    closingDate: 1_760_000_000_000,
    contextDescription: '',
    technicalEnvDescription: '',
    profileDescription: '',
    startingDate: null,
  },
}

// The ordering requirement from DEC-20: the task carries the opportunity's
// reference, so it cannot be written first.
const task: PushIntent = {
  id: 'i-task',
  meetingId: 'm1',
  kind: 'crm.task',
  dependsOn: ['i-oppy'],
  payload: {
    title: 'Compte-rendu Acme',
    body: '## Contexte',
    accountId: 'ACC-1042',
    opportunityRef: null,
    contactIds: [],
    dueAt: 1_760_000_000_000,
    endsAt: 1_760_003_600_000,
  },
}

const draft: PushIntent = {
  id: 'i-mail',
  meetingId: 'm1',
  kind: 'mail.draft',
  dependsOn: [],
  payload: { subject: 'Suite à notre échange', body: '…', to: ['camille@acme.fr'] },
}

const seeded = () => {
  const store = new Store(':memory:', clock)
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
  for (const intent of [opportunity, task, draft]) {
    store.append('m1', { type: 'push.intent.created', intent })
  }
  return store
}

const stateOf = (store: Store, id: string) =>
  store.projections.outboxFor('m1').find((e) => e.intentId === id)?.state

test('a dependent intent starts blocked; independents start pending', () => {
  const store = seeded()
  assert.equal(stateOf(store, 'i-oppy'), 'pending')
  assert.equal(stateOf(store, 'i-task'), 'blocked')
  assert.equal(stateOf(store, 'i-mail'), 'pending')
  assert.deepEqual(
    store.projections.drainable().map((e) => e.intentId).sort(),
    ['i-mail', 'i-oppy'],
  )
  store.close()
})

test('draining a dependency unblocks its dependant and records the remote id', () => {
  const store = seeded()
  store.append('m1', { type: 'push.attempted', intentId: 'i-oppy', attempt: 1 })
  store.append('m1', {
    type: 'push.settled',
    result: { ok: true, intentId: 'i-oppy', remoteId: 'OPP-9' },
  })

  const entry = store.projections.outboxFor('m1').find((e) => e.intentId === 'i-oppy')
  assert.equal(entry?.state, 'drained')
  assert.equal(entry?.remoteId, 'OPP-9')
  assert.equal(entry?.attempts, 1)
  assert.equal(stateOf(store, 'i-task'), 'pending')
  store.close()
})

test('a settled dependency releases its dependants — decided, either way', () => {
  /*
   * `blocked` means « a dependency has not settled yet », and it used to mean
   * « or has failed » — a terminal state with no exit. `drainable()` is
   * `state = 'pending'`, so no boot re-drain named the row again and the
   * compte-rendu task was never attempted, ever, while the meeting sat in
   * `pushing` for the life of the database and `updateReadiness` refused every
   * installer. One 503 on an *enrichment* permanently cost the product's
   * primary deliverable.
   */
  const store = seeded()
  assert.equal(stateOf(store, 'i-task'), 'blocked', 'en vol : la dépendance n’est pas décidée')

  store.append('m1', { type: 'push.attempted', intentId: 'i-oppy', attempt: 1 })
  store.append('m1', {
    type: 'push.settled',
    result: { ok: false, intentId: 'i-oppy', reason: 'VSA 503', retryable: false },
  })

  assert.equal(stateOf(store, 'i-oppy'), 'failed')
  assert.equal(stateOf(store, 'i-task'), 'pending', 'décidée : la dépendante repart')
  // DEC-26: a VSA outage must never stop the Outlook draft from shipping.
  assert.equal(stateOf(store, 'i-mail'), 'pending')
  store.close()
})

test('a dependency still in flight keeps its dependants blocked', () => {
  // The half the rule above exists for, and the half that is untouched: a task
  // sent before its opportunity is decided would carry no reference when one
  // was about to exist.
  const store = seeded()
  store.append('m1', { type: 'push.attempted', intentId: 'i-oppy', attempt: 1 })
  assert.equal(stateOf(store, 'i-oppy'), 'draining')
  assert.equal(stateOf(store, 'i-task'), 'blocked')
  store.close()
})

test('a retryable failure returns the intent to the queue, not to the bin', () => {
  const store = seeded()
  store.append('m1', { type: 'push.attempted', intentId: 'i-mail', attempt: 1 })
  store.append('m1', {
    type: 'push.settled',
    result: { ok: false, intentId: 'i-mail', reason: 'réseau', retryable: true },
  })
  const entry = store.projections.outboxFor('m1').find((e) => e.intentId === 'i-mail')
  assert.equal(entry?.state, 'pending')
  assert.equal(entry?.lastError, 'réseau')
  assert.equal(entry?.remoteId, null)
  store.close()
})

test('a drained intent is never re-offered for draining', () => {
  const store = seeded()
  store.append('m1', {
    type: 'push.settled',
    result: { ok: true, intentId: 'i-mail', remoteId: 'AAMk-1' },
  })
  assert.equal(
    store.projections.drainable().some((e) => e.intentId === 'i-mail'),
    false,
  )
  store.close()
})

test('rebuilding from the log reproduces both projections exactly', () => {
  const store = seeded()
  store.append('m1', { type: 'session.transition', from: 'idle', to: 'armed', command: 'arm', reason: null })
  store.append('m1', { type: 'session.transition', from: 'armed', to: 'recording', command: 'start', reason: null })
  store.append('m1', { type: 'transcript.segment', segment: sampleSegment })
  store.append('m1', { type: 'session.transition', from: 'recording', to: 'ended', command: 'end', reason: 'silence' })
  store.append('m1', {
    type: 'extraction.completed',
    extraction: sampleExtraction,
    verification: sampleVerification,
  })
  store.append('m1', { type: 'confirmation.recorded', intentIds: ['i-mail'], at: 5555 })
  store.append('m1', {
    type: 'push.settled',
    result: { ok: true, intentId: 'i-oppy', remoteId: 'OPP-9' },
  })

  const before = {
    meetings: store.projections.listMeetings(),
    outbox: store.projections.outboxFor('m1'),
  }

  store.projections.rebuild()

  const after = {
    meetings: store.projections.listMeetings(),
    outbox: store.projections.outboxFor('m1'),
  }

  assert.deepEqual(after.meetings, before.meetings)
  assert.deepEqual(after.outbox, before.outbox)

  const meeting = after.meetings[0]
  assert.equal(meeting?.clientName, 'Acme Industries')
  assert.equal(meeting?.state, 'ended')
  assert.equal(meeting?.confirmedAt, 5555)
  assert.ok(meeting?.startedAt !== null && meeting?.endedAt !== null)
  store.close()
})

test('folded reads return what the log holds', () => {
  const store = new Store(':memory:', clock)
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
  store.append('m1', { type: 'transcript.segment', segment: sampleSegment })
  store.append('m1', { type: 'document.snapshot', revision: 1, doc: { type: 'doc', content: [] } })
  store.append('m1', { type: 'document.snapshot', revision: 2, doc: { type: 'doc', content: ['x'] } })

  assert.equal(store.projections.segments('m1').length, 1)
  assert.deepEqual(store.projections.document('m1'), {
    revision: 2,
    doc: { type: 'doc', content: ['x'] },
  })
  assert.equal(store.projections.extraction('m1'), null)
  store.close()
})

/*
 * The recipe fold (DEC-43).
 *
 * The choice is an event and not a column, which means the thing worth testing
 * is that it *replays* — a projection rebuild is the recovery path for every
 * derived table in this store, and a value that survived until the first rebuild
 * and then disappeared is precisely the failure `meeting.renamed` was made an
 * event to avoid.
 */
test('a meeting with no choice recorded is on the default recipe', () => {
  const store = new Store(':memory:', clock)
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })

  assert.equal(store.projections.recipe('m1'), 'besoin-commercial')
  store.close()
})

test('the last choice wins, and it survives a rebuild', () => {
  const store = new Store(':memory:', clock)
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
  store.append('m1', { type: 'meeting.recipe.chosen', recipe: 'libre' })
  store.append('m1', { type: 'meeting.recipe.chosen', recipe: 'besoin-commercial' })
  store.append('m1', { type: 'meeting.recipe.chosen', recipe: 'libre' })

  assert.equal(store.projections.recipe('m1'), 'libre')

  store.projections.rebuild()
  assert.equal(store.projections.recipe('m1'), 'libre')
  store.close()
})

test('a choice belongs to its own meeting', () => {
  const store = new Store(':memory:', clock)
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
  store.append('m2', { type: 'meeting.created', title: 'Néovia', context: null })
  store.append('m1', { type: 'meeting.recipe.chosen', recipe: 'libre' })

  assert.equal(store.projections.recipe('m1'), 'libre')
  assert.equal(store.projections.recipe('m2'), 'besoin-commercial')
  store.close()
})

/**
 * **The list is ordered by the day a meeting belongs on, newest first.**
 *
 * It used to be `ORDER BY updated_at DESC`, which is not a date — it is the last
 * time the event log touched the row. A call validated late had been *edited*
 * more recently than a call held two days after it, so it sorted above it, and
 * *Historique*, whose only organising principle is recency, printed 10/09,
 * 09/09, 07/09, **01/09, 03/09**, 27/08. That is the defect a rep notices in the
 * first minute and never trusts again, and it took five screenshot reviews to
 * find because the harness fixture was a hand-written array in its own order.
 *
 * The anchor is `meetingAnchor` and the SQL has to agree with it, so this test
 * asserts against the function rather than restating the coalesce.
 */
test('meetings list by the day they belong on, not by when they were last touched', () => {
  const store = new Store(':memory:', clock)

  // Held first, and touched last — which is what the old ordering rewarded.
  store.append('old', {
    type: 'meeting.created',
    title: 'Lefort',
    context: null,
    scheduledStart: 1_000_000_000_000,
  })
  store.append('recent', {
    type: 'meeting.created',
    title: 'Nordis',
    context: null,
    scheduledStart: 1_700_000_000_000,
  })
  // Any later event on the older meeting: renaming it is the cheapest one, and
  // it is exactly what a rep does when they come back to a call to file it.
  store.append('old', { type: 'meeting.renamed', title: 'Groupe Lefort', clientName: null })

  const listed = store.projections.listMeetings()
  assert.deepEqual(
    listed.map((meeting) => meeting.id),
    ['recent', 'old'],
  )
  // And the order is the anchor's, so the two cannot drift apart.
  assert.deepEqual(
    [...listed].sort((a, b) => meetingAnchor(b) - meetingAnchor(a)).map((m) => m.id),
    listed.map((m) => m.id),
  )
  store.close()
})

/*
 * ── the compte-rendu the rep validated ──────────────────────────────────────
 *
 * `edits.compteRendu` used to reach `draftIntents` and nothing else, so the
 * string VerySwing received and the string *Historique* drew were two different
 * documents from the moment a rep corrected a sentence at the gate. The fold is
 * where the correction now lives; the two cases below are the whole of its
 * contract, and the second is what makes every meeting confirmed before the
 * field existed read exactly as it always has.
 */
test('the confirmed compte-rendu is folded out of the confirmation, last one winning', () => {
  const store = new Store(':memory:', clock)
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })

  // Nothing confirmed yet: an absence, so the caller renders the extraction.
  assert.equal(store.projections.confirmedCompteRendu('m1'), null)

  store.append('m1', {
    type: 'confirmation.recorded',
    intentIds: ['i-1'],
    at: 5_000,
    compteRendu: '# Acme\n\nCorrigé par le commercial.',
  })
  assert.equal(store.projections.confirmedCompteRendu('m1'), '# Acme\n\nCorrigé par le commercial.')

  store.append('m1', {
    type: 'confirmation.recorded',
    intentIds: ['i-2'],
    at: 6_000,
    compteRendu: '# Acme\n\nCorrigé deux fois.',
  })
  assert.equal(store.projections.confirmedCompteRendu('m1'), '# Acme\n\nCorrigé deux fois.')
  store.close()
})

test('a confirmation written before the field existed is an absence, and « » is not', () => {
  const store = new Store(':memory:', clock)

  // Exactly the shape every meeting confirmed before this field existed has:
  // no key at all. It must replay — and answer « nobody recorded this », so the
  // caller falls back to the stored extraction, which is what those meetings
  // have always shown.
  store.append('old', { type: 'meeting.created', title: 'Lefort', context: null })
  store.append('old', { type: 'confirmation.recorded', intentIds: ['i-1'], at: 5_000 })
  assert.equal(store.projections.confirmedCompteRendu('old'), null)

  // And the empty string is a *value*: a rep who selected the document, deleted
  // it and validated anyway did something `reviewGate.ts` deliberately allows,
  // and the record says so rather than reinstating the model's draft over it.
  store.append('vidé', { type: 'meeting.created', title: 'Nordis', context: null })
  store.append('vidé', {
    type: 'confirmation.recorded',
    intentIds: [],
    at: 5_000,
    compteRendu: '',
  })
  assert.equal(store.projections.confirmedCompteRendu('vidé'), '')
  store.close()
})

/*
 * ── an offer nobody accepted is not a meeting the rep had ────────────────────
 *
 * The detector calls `create()` at the moment it makes an *offer* (DEC-46), so
 * every false positive used to write a permanent row into the rep's own record —
 * drawn in the day grid with an *Ouvrir* button onto an empty meeting, indexed by
 * the search, and with no delete verb anywhere in the product. A browser tab
 * holding the microphone for a Loom recording is enough.
 *
 * The predicate is *provenance plus never started*, and the three rows below are
 * the reason it is not the structural « no event, no start, idle »: two of them
 * look exactly like the residue and both are meetings the rep asked for.
 */
const declineAnAdHocOffer = (store: Store, heldSince: number): string => {
  const id = adHocMeetingId(heldSince)
  store.append(id, {
    type: 'meeting.created',
    title: adHocTitle('Navigateur'),
    context: adHocContext('Navigateur', heldSince),
  })
  store.append(id, {
    type: 'session.transition',
    from: 'idle',
    to: 'armed',
    command: 'arm',
    reason: 'appel Navigateur hors calendrier',
  })
  store.append(id, {
    type: 'session.transition',
    from: 'armed',
    to: 'idle',
    command: 'disarm',
    reason: 'l’appel s’est terminé sans enregistrement',
  })
  return id
}

test('an unscheduled call that was offered and never accepted leaves no row to read', () => {
  const store = new Store(':memory:', clock)
  const declined = declineAnAdHocOffer(store, 1_700_000_000_000)

  assert.deepEqual(store.projections.listMeetings(null), [])
  // The log keeps it: that is genuine history, and DEC-27 leaves exactly one
  // delete in this codebase. Only the *view* drops it — and `getMeeting` still
  // answers, because the orchestrator rehydrates by id.
  assert.ok(store.log.read(declined).some((stored) => stored.event.type === 'meeting.created'))
  assert.ok(store.projections.getMeeting(declined))
  store.close()
})

test('and every unscheduled call the rep did something about is still listed', () => {
  const store = new Store(':memory:', clock)
  declineAnAdHocOffer(store, 1_700_000_000_000)

  // Accepted and recorded: `started_at` is set, which is half the predicate.
  const accepted = adHocMeetingId(1_700_000_060_000)
  store.append(accepted, {
    type: 'meeting.created',
    title: adHocTitle('Teams'),
    context: adHocContext('Teams', 1_700_000_060_000),
  })
  store.append(accepted, {
    type: 'session.transition',
    from: 'armed',
    to: 'recording',
    command: 'start',
    reason: null,
  })

  // Still standing: `armed`, never withdrawn. That one wants attention.
  const standing = adHocMeetingId(1_700_000_120_000)
  store.append(standing, {
    type: 'meeting.created',
    title: adHocTitle('Zoom'),
    context: adHocContext('Zoom', 1_700_000_120_000),
  })
  store.append(standing, {
    type: 'session.transition',
    from: 'idle',
    to: 'armed',
    command: 'arm',
    reason: 'appel Zoom hors calendrier',
  })

  assert.deepEqual(
    store.projections.listMeetings(null).map((meeting) => meeting.id).sort(),
    [accepted, standing].sort(),
  )
  store.close()
})

test('a meeting the rep created by hand is never residue, whatever state it sits in', () => {
  const store = new Store(':memory:', clock)

  /*
   * **The two rows the structural predicate would have taken with it**, and the
   * reason this one tests the id rather than the shape. Both are `idle`, both
   * have no `event_id` and no `started_at` — which is exactly what the residue
   * looks like — and both are meetings the rep asked for: « Ajouter au jeudi »
   * (DEC-31, a rep may place a call on any day) and « Démarrer une réunion »
   * between `meeting:create` and a `start` that was refused. Hiding the first
   * empties the calendar cell the rep put it in; hiding the second strands them
   * on a session screen with no row anywhere to reach it by again.
   */
  store.append('man-jeudi', {
    type: 'meeting.created',
    title: 'Sodexial — point staffing',
    context: null,
    clientName: 'Sodexial',
    scheduledStart: 1_789_628_400_000,
  })
  store.append('man-maintenant', {
    type: 'meeting.created',
    title: '',
    context: null,
    clientName: null,
    scheduledStart: null,
  })

  assert.deepEqual(
    store.projections.listMeetings(null).map((meeting) => meeting.id).sort(),
    ['man-jeudi', 'man-maintenant'],
  )
  store.close()
})

test('the prefix the exclusion matches on is the one adHoc.ts mints', () => {
  // Source as evidence, the `preloadUnwrap.test.ts` shape: the id convention
  // lives in `core/domain/adHoc.ts` and the SQL above restates its stem. The day
  // the convention moves, this fails — rather than the predicate quietly
  // matching nothing and the residue coming back.
  assert.ok(adHocMeetingId(0).startsWith(AD_HOC_ID_PREFIX))
  assert.ok(adHocMeetingId(1_700_000_000_000).startsWith(AD_HOC_ID_PREFIX))
  assert.equal(AD_HOC_ID_PREFIX.includes('%'), false, 'un joker dans un LIKE élargirait la règle')
  assert.equal(AD_HOC_ID_PREFIX.includes('_'), false)
})
