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

/** One turn of the microtask queue, so an in-flight pass has actually started. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

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

test('a terminal failure costs its own row and nothing else — the compte-rendu still ships', async () => {
  /*
   * **This asserted the defect, in the words of the rule it came from.**
   *
   * « a dependency that failed terminally blocks its dependants » — and
   * `blocked` had no exit: `drainable()` is `state = 'pending'`, so no boot
   * re-drain ever named the row again, `allIntentsSettled` never counted it, the
   * meeting stayed in `pushing` for the life of the database, and
   * `updateReadiness` refused every installer from that moment on. One VSA 500
   * on the *opportunity* — an enrichment — permanently cost the **compte-rendu**,
   * which is the product's primary deliverable into the client's CRM, and
   * *Historique* drew « en attente d'un autre envoi » over it, which was false.
   *
   * The ordering exists to carry the opportunity's remote id into the task, and
   * `#withDependencyRef` already handles a dependency that did not drain: the
   * reference stays null and `VsaCrm.link()` falls through to the company. A
   * compte-rendu linked to the account beats no compte-rendu at all, and DEC-26
   * says as much. What blocking protects is untouched — the task is never sent
   * before the opportunity is *decided*, only after it is decided either way.
   */
  const store = seed()
  const crm = crmStub({ opportunity: async () => terminal('champ obligatoire manquant') })
  const mail = mailStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: mail.port, sleep: nowhere })

  const entries = await outbox.drain(MEETING)

  assert.equal(stateOf(entries, 'i-opportunity'), 'failed')
  assert.equal(stateOf(entries, 'i-task'), 'drained', 'le compte-rendu part quand même')
  assert.equal(stateOf(entries, 'i-mail'), 'drained')
  assert.equal(rowOf(store, 'i-opportunity')?.lastError, 'champ obligatoire manquant')
  // One attempt only: a terminal failure is not retried, by the app or by this pass.
  assert.equal(crm.calls.filter((c) => c === 'opportunity').length, 1)
  // And it ships with no reference rather than with an invented one (DEC-7).
  assert.equal(crm.seenCompteRendu[0]?.opportunityRef, null)
  // Nothing is left non-terminal, so the meeting can reach `done`.
  assert.deepEqual(
    entries.filter((e) => e.state !== 'drained' && e.state !== 'failed'),
    [],
  )
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
  assert.equal(outbox.settledSynchronously(), true)
  store.close()
})

test('a quit waits for a push already on the wire, and never for ever', async () => {
  /*
   * `review:confirm` fires the drain without awaiting it, so « press *Valider*,
   * close the window » — the ordinary gesture on Windows, where closing quits —
   * used to kill the process with the POST in flight. `before-quit` asked only
   * whether a meeting was *recording*.
   */
  const store = seed([OPP_INTENT])
  let release = (): void => {}
  const crm = crmStub({
    opportunity: async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return ok('OPP-1')
    },
  })
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: null, sleep: nowhere })

  const pass = outbox.drain(MEETING)
  await tick()
  assert.equal(outbox.settledSynchronously(), false, 'the pass is in flight')

  // Bounded: a quit that waited on a wedged POST would be a window that will
  // not go away. The row is reclaimed on the next launch either way.
  assert.equal(await outbox.settle(1), false, 'a wedged pass does not hold the quit')

  release()
  assert.equal(await outbox.settle(), true, 'and the pass that finishes is waited for')
  await pass
  assert.equal(stateOf(store.projections.outboxFor(MEETING), 'i-opportunity'), 'drained')
  store.close()
})

test('every row is terminal after a pass, so the meeting can leave pushing', async () => {
  /*
   * **The property `allIntentsSettled` needs and nothing guaranteed.**
   *
   * It counts `drained` and `failed`; `blocked` was neither, and there was no
   * path out of it. So a meeting whose opportunity failed sat in `pushing` for
   * the life of the database — and because `Orchestrator.session()` caches the
   * rehydrated session, `liveStates()` carried `pushing` from boot onwards and
   * `updateGate` refused every installer for ever, on the primary platform.
   *
   * Asserted over the three ways a dependency can be decided, because the guard
   * is about all of them and the old test only ever drove one.
   */
  for (const [label, behaviour] of [
    ['terminal', async () => terminal('champ obligatoire manquant')],
    ['retryable, then exhausted', async () => retryable('502')],
    ['clean', null],
  ] as const) {
    const store = seed()
    const crm = crmStub(behaviour ? { opportunity: behaviour } : {})
    const outbox = new Outbox({
      journal: store,
      crm: crm.port,
      mail: mailStub().port,
      sleep: nowhere,
    })

    const entries = await outbox.drain(MEETING)
    const settled = (id: string): boolean => {
      const state = entries.find((e) => e.intentId === id)?.state
      return state === 'drained' || state === 'failed'
    }
    /*
     * `blocked` is legitimate only while a dependency is genuinely undecided.
     * A row blocked behind a *settled* dependency is the state with no exit:
     * `drainable()` never names it, `allIntentsSettled` never counts it, and
     * nothing in the product can move it again.
     */
    const stuck = entries.filter(
      (entry) =>
        entry.state === 'blocked' &&
        (store.projections.intents(MEETING).find((i) => i.id === entry.intentId)?.dependsOn ?? [])
          .every(settled),
    )
    assert.deepEqual(
      stuck.map((e) => [e.kind, e.state]),
      [],
      `${label} : une dépendante bloquée derrière une dépendance décidée`,
    )
    store.close()
  }
})

test('a push interrupted mid-POST is reclaimed by the next launch', async () => {
  /*
   * **The row the boot re-drain could not see.** `drainable()` is
   * `state = 'pending'`, and a row that reached `push.started` is `draining` —
   * so a meeting whose only non-terminal row was in flight when the process died
   * was never passed to `drain()`, and `#reclaim`, which exists for exactly this
   * row, ran for nobody. The Historique row said « envoi en cours » for the life
   * of the database, `pushSettled` never fired so the meeting never reached
   * `done`, and `POST /v1/crm/tasks` has no idempotency key, so the rep could
   * not find out by sending it again.
   */
  const store = seed([OPP_INTENT])
  // Exactly what `#attempt` appends before the POST goes on the wire.
  store.append(MEETING, { type: 'push.attempted', intentId: 'i-opportunity', attempt: 1 })

  assert.deepEqual(store.projections.drainable(), [], 'nothing is pending — this is the trap')
  const stalled = store.projections.interrupted()
  assert.deepEqual(
    stalled.map((entry) => entry.intentId),
    ['i-opportunity'],
    'and this is what the boot sweep now sees',
  )

  // The boot re-drain, verbatim in shape: the union of both projections.
  const crm = crmStub()
  const outbox = new Outbox({ journal: store, crm: crm.port, mail: null, sleep: nowhere })
  for (const meetingId of new Set(
    [...store.projections.drainable(), ...stalled].map((entry) => entry.meetingId),
  )) {
    await outbox.drain(meetingId)
  }

  const entry = store.projections.outboxFor(MEETING)[0]
  assert.equal(entry?.state, 'failed')
  assert.equal(entry?.lastError, INTERRUPTED_REASON)
  // Never re-POSTed: nobody knows whether the first one landed.
  assert.deepEqual(crm.calls, [])
  store.close()
})

// ── retries and resume ─────────────────────────────────────────────────────

test('a 429 is answered when the server said to, not one second later', async () => {
  /*
   * `429` is the one status that states the request was **not processed**, which
   * is why it is the only one that returns a row to `pending` — and the only one
   * that comes with an instruction. Both adapters parsed `Retry-After` and both
   * dropped it at `PushResult`, so the outbox answered « wait two minutes » with
   * a re-POST after one, three times a pass and again on every launch. Against
   * Graph's mailbox throttling that is the pattern that extends a throttle.
   */
  const store = seed([OPP_INTENT])
  const waits: number[] = []
  const crm = crmStub({
    opportunity: async () => ({
      ok: false as const,
      intentId: '',
      reason: 'quota VerySwing atteint',
      retryable: true,
      retryAfterMs: 30_000,
    }),
  })
  const outbox = new Outbox({
    journal: store,
    crm: crm.port,
    mail: null,
    backoffMs: 1_000,
    sleep: async (ms) => {
      waits.push(ms)
    },
  })

  await outbox.drain(MEETING)

  assert.ok(
    waits.every((ms) => ms >= 30_000),
    `the server's own instruction is the floor — waited ${JSON.stringify(waits)}`,
  )
  // Still pending, never failed: nothing was written, so the next launch is
  // entitled to try again.
  assert.equal(stateOf(store.projections.outboxFor(MEETING), 'i-opportunity'), 'pending')
  store.close()
})

test('a Retry-After longer than a minute ends the pass instead of holding a timer', async () => {
  // DEC-26: nothing here outlives a meeting. A server entitled to say « an hour »
  // is not entitled to a background timer that lives that long — the row stays
  // pending and the next launch is the retry.
  const store = seed([OPP_INTENT])
  const waits: number[] = []
  const crm = crmStub({
    opportunity: async () => ({
      ok: false as const,
      intentId: '',
      reason: 'quota VerySwing atteint',
      retryable: true,
      retryAfterMs: 3_600_000,
    }),
  })
  const outbox = new Outbox({
    journal: store,
    crm: crm.port,
    mail: null,
    backoffMs: 1_000,
    sleep: async (ms) => {
      waits.push(ms)
    },
  })

  await outbox.drain(MEETING)

  assert.deepEqual(waits, [60_000], 'one capped wait, then the pass ends')
  assert.deepEqual(crm.calls, ['opportunity'], 'and exactly one POST went out')
  assert.equal(stateOf(store.projections.outboxFor(MEETING), 'i-opportunity'), 'pending')
  store.close()
})

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
