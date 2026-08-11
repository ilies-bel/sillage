import test from 'node:test'
import assert from 'node:assert/strict'
import { Outbox, INTERRUPTED_REASON, type MailDrafter } from '../Outbox.ts'
import { openMemoryStore, type Store } from '../../../modules/store/index.ts'
import type { CrmPort } from '../../../core/contracts/crm.ts'
import type {
  CompteRenduPayload,
  MailDraftPayload,
  OpportunityPayload,
  OutboxEntry,
  PushIntent,
  PushResult,
} from '../../../core/contracts/push.ts'

const MEETING = 'm-aura-2026-08-05'

const OPPORTUNITY: OpportunityPayload = {
  title: 'Migration DIMOS — 2 profils',
  description: 'Deux développeurs Java sur six mois.',
  accountId: 'acc-aura',
  amount: 180_000,
  currency: 'EUR',
  closingDate: Date.parse('2026-09-30T00:00:00Z'),
  contextDescription: 'Refonte du socle de facturation.',
  technicalEnvDescription: 'Java 21, Spring Boot, PostgreSQL.',
  profileDescription: 'Développeur confirmé, 5 ans.',
  startingDate: Date.parse('2026-10-01T00:00:00Z'),
}

const COMPTE_RENDU: CompteRenduPayload = {
  title: 'Point Aura — 5 août',
  body: '# Compte-rendu\n\nBesoin confirmé.',
  accountId: 'acc-aura',
  opportunityRef: null,
  contactIds: ['ct-marc'],
  dueAt: Date.parse('2026-08-12T08:00:00Z'),
  endsAt: Date.parse('2026-08-05T09:00:00Z'),
}

const DRAFT: MailDraftPayload = {
  subject: 'Suite à notre échange — Aura',
  body: 'Bonjour Marc,',
  to: ['marc@aura.fr'],
}

const OPP_INTENT: PushIntent = {
  id: 'i-opportunity',
  meetingId: MEETING,
  kind: 'crm.opportunity',
  dependsOn: [],
  payload: OPPORTUNITY,
}

/** The one edge of the DAG: the task carries the opportunity's reference (DEC-20). */
const TASK_INTENT: PushIntent = {
  id: 'i-task',
  meetingId: MEETING,
  kind: 'crm.task',
  dependsOn: ['i-opportunity'],
  payload: COMPTE_RENDU,
}

/** Depends on neither. Must ship with the CRM on fire (DEC-26). */
const MAIL_INTENT: PushIntent = {
  id: 'i-mail',
  meetingId: MEETING,
  kind: 'mail.draft',
  dependsOn: [],
  payload: DRAFT,
}

const seed = (intents: PushIntent[] = [OPP_INTENT, TASK_INTENT, MAIL_INTENT]): Store => {
  const store = openMemoryStore()
  for (const intent of intents) {
    store.append(MEETING, { type: 'push.intent.created', intent })
  }
  return store
}

const stateOf = (entries: OutboxEntry[], id: string): string | undefined =>
  entries.find((e) => e.intentId === id)?.state

const rowOf = (store: Store, id: string): OutboxEntry | undefined =>
  store.projections.outboxFor(MEETING).find((e) => e.intentId === id)

const ok = (remoteId: string): PushResult => ({ ok: true, intentId: '', remoteId })
const retryable = (reason: string): PushResult => ({ ok: false, intentId: '', reason, retryable: true })
const terminal = (reason: string): PushResult => ({ ok: false, intentId: '', reason, retryable: false })

interface CrmStub {
  port: CrmPort
  calls: string[]
  seenCompteRendu: CompteRenduPayload[]
}

const crmStub = (
  behaviour: {
    opportunity?: (p: OpportunityPayload) => Promise<PushResult>
    compteRendu?: (p: CompteRenduPayload) => Promise<PushResult>
  } = {},
): CrmStub => {
  const calls: string[] = []
  const seenCompteRendu: CompteRenduPayload[] = []
  const unused = async (): Promise<never> => {
    throw new Error('the outbox must not reach for this verb')
  }
  const port: CrmPort = {
    resolveAccount: unused,
    listSiblings: unused,
    createContact: unused,
    attachTranscript: unused,
    pushOpportunity: async (payload) => {
      calls.push('opportunity')
      return behaviour.opportunity ? behaviour.opportunity(payload) : ok('OPP-1')
    },
    pushCompteRendu: async (payload) => {
      calls.push('task')
      seenCompteRendu.push(payload)
      return behaviour.compteRendu ? behaviour.compteRendu(payload) : ok('TASK-1')
    },
  }
  return { port, calls, seenCompteRendu }
}

interface MailStub {
  port: MailDrafter
  calls: number
}

const mailStub = (result: () => Promise<PushResult> = async () => ok('AAMkAGI2')): MailStub => {
  const stub: MailStub = {
    calls: 0,
    port: {
      createDraft: async () => {
        stub.calls++
        return result()
      },
    },
  }
  return stub
}

const nowhere = async (): Promise<void> => {}

// ── the DAG ────────────────────────────────────────────────────────────────

test('the opportunity drains before the task that carries its reference', async () => {
  const store = seed()
  const crm = crmStub()
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mail.port, sleep: nowhere })

  const entries = await outbox.drain(MEETING)

  assert.deepEqual(crm.calls, ['opportunity', 'task'])
  assert.equal(stateOf(entries, 'i-opportunity'), 'drained')
  assert.equal(stateOf(entries, 'i-task'), 'drained')
  assert.equal(stateOf(entries, 'i-mail'), 'drained')
  // The reference is the remote system's, filled in after the fact — never the
  // model's (DEC-7). The intent was created with none.
  assert.equal(COMPTE_RENDU.opportunityRef, null)
  assert.equal(crm.seenCompteRendu[0]?.opportunityRef, 'OPP-1')
  store.close()
})

test('the CRM being unreachable still ships the Outlook draft (DEC-26)', async () => {
  const store = seed()
  const crm = crmStub({ opportunity: async () => retryable('VSA injoignable') })
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mail.port, sleep: nowhere })

  const entries = await outbox.drain(MEETING)

  assert.equal(mail.calls, 1)
  assert.equal(stateOf(entries, 'i-mail'), 'drained')
  assert.equal(rowOf(store, 'i-mail')?.remoteId, 'AAMkAGI2')
  // Retryable: back to pending, so the next drain picks it up.
  assert.equal(stateOf(entries, 'i-opportunity'), 'pending')
  assert.equal(stateOf(entries, 'i-task'), 'blocked')
  assert.equal(crm.calls.includes('task'), false, 'the task must not ship without its dependency')
  store.close()
})

test('a terminal failure blocks its dependants and nothing else', async () => {
  const store = seed()
  const crm = crmStub({ opportunity: async () => terminal('champ obligatoire manquant') })
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mail.port, sleep: nowhere })

  const entries = await outbox.drain(MEETING)

  assert.equal(stateOf(entries, 'i-opportunity'), 'failed')
  assert.equal(stateOf(entries, 'i-task'), 'blocked')
  assert.equal(stateOf(entries, 'i-mail'), 'drained')
  assert.equal(rowOf(store, 'i-opportunity')?.lastError, 'champ obligatoire manquant')
  // One attempt only: a terminal failure is not retried, by the app or by this pass.
  assert.equal(crm.calls.filter((c) => c === 'opportunity').length, 1)
  store.close()
})

test('an independent intent is not blocked by an unconfigured connector', async () => {
  const store = seed()
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: null, mail: mail.port, sleep: nowhere })

  const entries = await outbox.drain(MEETING)

  assert.equal(stateOf(entries, 'i-mail'), 'drained')
  // Pending, not failed: nothing was attempted, so nothing failed.
  assert.equal(stateOf(entries, 'i-opportunity'), 'pending')
  assert.equal(rowOf(store, 'i-opportunity')?.attempts, 0)
  const attempted = store.log
    .read(MEETING)
    .filter(({ event }) => event.type === 'push.attempted' && event.intentId === 'i-opportunity')
  assert.equal(attempted.length, 0)
  store.close()
})

// ── the no-idempotency-key hazard ──────────────────────────────────────────

test('a drained intent is never posted again', async () => {
  const store = seed()
  const crm = crmStub()
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mail.port, sleep: nowhere })

  await outbox.drain(MEETING)
  await outbox.drain(MEETING)
  await outbox.drain(MEETING)

  assert.deepEqual(crm.calls, ['opportunity', 'task'])
  assert.equal(mail.calls, 1)
  store.close()
})

test('an intent already settled elsewhere is not attempted', async () => {
  const store = seed()
  // As if a previous run had drained the draft and died before the next one.
  store.append(MEETING, {
    type: 'push.settled',
    result: { ok: true, intentId: 'i-mail', remoteId: 'AAMkDÉJÀ' },
  })

  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crmStub().port, mail: mail.port, sleep: nowhere })
  await outbox.drain(MEETING)

  assert.equal(mail.calls, 0)
  assert.equal(rowOf(store, 'i-mail')?.remoteId, 'AAMkDÉJÀ')
  store.close()
})

test('the remote id and the drained state are written together', async () => {
  const store = seed([OPP_INTENT])
  const outbox = new Outbox({
    journal: store,
    crm: crmStub().port,
    mail: mailStub().port,
    sleep: nowhere,
  })
  await outbox.drain(MEETING)

  const row = rowOf(store, 'i-opportunity')
  assert.equal(row?.state, 'drained')
  assert.equal(row?.remoteId, 'OPP-1')

  // One event carries both, so there is no ordering to get wrong and no window
  // in which the row reads drained without an id.
  const settled = store.log
    .read(MEETING)
    .filter(({ event }) => event.type === 'push.settled')
    .map(({ event }) => (event.type === 'push.settled' ? event.result : null))
  assert.equal(settled.length, 1)
  assert.deepEqual(settled[0], { ok: true, intentId: 'i-opportunity', remoteId: 'OPP-1' })

  // And the pair survives a fold from scratch — the projection is derived, and
  // a derivation that could separate them would be the same bug.
  store.projections.rebuild()
  const rebuilt = rowOf(store, 'i-opportunity')
  assert.equal(rebuilt?.state, 'drained')
  assert.equal(rebuilt?.remoteId, 'OPP-1')
  store.close()
})

test('a crash between the call and the settle is failed, never silently retried', async () => {
  const store = seed([OPP_INTENT])
  // What a killed process leaves behind: attempted, never settled.
  store.append(MEETING, { type: 'push.attempted', intentId: 'i-opportunity', attempt: 1 })
  assert.equal(rowOf(store, 'i-opportunity')?.state, 'draining')

  const crm = crmStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mailStub().port, sleep: nowhere })
  const entries = await outbox.drain(MEETING)

  assert.equal(crm.calls.length, 0, 'the remote may already hold the record — do not post again')
  assert.equal(stateOf(entries, 'i-opportunity'), 'failed')
  assert.equal(rowOf(store, 'i-opportunity')?.lastError, INTERRUPTED_REASON)
  store.close()
})

test('a thrown port is terminal, because a throw does not say whether the record exists', async () => {
  const store = seed([OPP_INTENT])
  const crm = crmStub({
    opportunity: async () => {
      throw new Error('socket coupé après envoi')
    },
  })
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mailStub().port, sleep: nowhere })
  const entries = await outbox.drain(MEETING)

  assert.equal(crm.calls.length, 1)
  assert.equal(stateOf(entries, 'i-opportunity'), 'failed')
  assert.equal(rowOf(store, 'i-opportunity')?.lastError, 'socket coupé après envoi')
  store.close()
})

test('two concurrent drains are one drain', async () => {
  const store = seed()
  const crm = crmStub()
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mail.port, sleep: nowhere })

  const [a, b] = await Promise.all([outbox.drain(MEETING), outbox.drain(MEETING)])

  assert.deepEqual(crm.calls, ['opportunity', 'task'])
  assert.equal(mail.calls, 1)
  assert.deepEqual(a, b)
  assert.equal(outbox.isDraining(MEETING), false)
  store.close()
})

// ── retries and resume ─────────────────────────────────────────────────────

test('retries are bounded and backed off', async () => {
  const store = seed([OPP_INTENT])
  const waits: number[] = []
  const crm = crmStub({ opportunity: async () => retryable('502') })
  const outbox = new Outbox({
    journal: store,
    crm: crm.port,
    mail: mailStub().port,
    maxAttempts: 3,
    backoffMs: 100,
    sleep: async (ms) => {
      waits.push(ms)
    },
  })

  const entries = await outbox.drain(MEETING)

  assert.equal(crm.calls.length, 3)
  assert.deepEqual(waits, [100, 200])
  assert.equal(rowOf(store, 'i-opportunity')?.attempts, 3)
  // Still pending, not failed: the failure was retryable and the next drain owns it.
  assert.equal(stateOf(entries, 'i-opportunity'), 'pending')
  store.close()
})

test('a restart resumes an undrained outbox', async () => {
  const store = seed()
  const down = crmStub({ opportunity: async () => retryable('VSA injoignable') })
  const firstMail = mailStub()
  await new Outbox({
    journal: store,
    crm: down.port,
    mail: firstMail.port,
    maxAttempts: 2,
    sleep: nowhere,
  }).drain(MEETING)

  assert.equal(stateOf(store.projections.outboxFor(MEETING), 'i-opportunity'), 'pending')

  // A new process: nothing is carried over but the log, and the projection is
  // folded from it.
  store.projections.rebuild()
  const back = crmStub()
  const secondMail = mailStub()
  const entries = await new Outbox({
    journal: store,
    crm: back.port,
    mail: secondMail.port,
    sleep: nowhere,
  }).drain(MEETING)

  assert.deepEqual(back.calls, ['opportunity', 'task'])
  assert.equal(secondMail.calls, 0, 'the draft went out before the restart')
  assert.equal(stateOf(entries, 'i-opportunity'), 'drained')
  assert.equal(stateOf(entries, 'i-task'), 'drained')
  assert.equal(stateOf(entries, 'i-mail'), 'drained')
  assert.equal(back.seenCompteRendu[0]?.opportunityRef, 'OPP-1')
  store.close()
})

test('draining a meeting with nothing pending is a no-op', async () => {
  const store = openMemoryStore()
  const crm = crmStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mailStub().port, sleep: nowhere })

  assert.deepEqual(await outbox.drain(MEETING), [])
  assert.equal(crm.calls.length, 0)
  store.close()
})
