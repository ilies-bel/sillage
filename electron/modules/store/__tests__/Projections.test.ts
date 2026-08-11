/**
 * Projections are derived, rebuildable and never authoritative — and the outbox
 * is the one whose correctness has teeth, because `POST /v1/crm/tasks` has no
 * idempotency key (ARCHITECTURE.md §5.F).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../index.ts'
import type { PushIntent } from '../../../core/contracts/push.ts'
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

test('a failed dependency blocks its dependants and nothing else', () => {
  const store = seeded()
  store.append('m1', { type: 'push.attempted', intentId: 'i-oppy', attempt: 1 })
  store.append('m1', {
    type: 'push.settled',
    result: { ok: false, intentId: 'i-oppy', reason: 'VSA 503', retryable: false },
  })

  assert.equal(stateOf(store, 'i-oppy'), 'failed')
  assert.equal(stateOf(store, 'i-task'), 'blocked')
  // DEC-26: a VSA outage must never stop the Outlook draft from shipping.
  assert.equal(stateOf(store, 'i-mail'), 'pending')
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
