/**
 * The VerySwing adapter: what it sends, what it refuses to send, and what it
 * says when the tenant is not what the adapter expects.
 *
 * Everything here runs against a stubbed `fetch`. No network, no credentials.
 * The fixtures — the only place a VSA column name may be written outside the
 * adapter — live in `../vsa/__tests__/fixtures.ts`, inside the containment
 * boundary that `scripts/check-crm-containment.mjs` enforces.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { VsaCrm } from '../vsa/VsaCrm.ts'
import { crmHealth } from '../index.ts'
import { VsaError, type FetchLike } from '../vsa/http.ts'
import { ReferentialCache, pick, PICK_HINTS, normalise, REFERENTIALS } from '../vsa/referentials.ts'
import { VsaSession } from '../vsa/http.ts'
import type { VsaConfig } from '../vsa/config.ts'
import type { CompteRenduPayload, OpportunityPayload } from '../../../core/contracts/push.ts'
import type { DiagEvent, DiagInput, DiagRecorder } from '../../../core/contracts/diagnostics.ts'
import {
  REFERENTIAL_BODIES,
  attachOf,
  contactOf,
  customerRow,
  linkOf,
  opportunityOf,
  prospectContactRow,
  prospectRow,
  taskOf,
  taskTypeRow,
} from '../vsa/__tests__/fixtures.ts'

const NOW = Date.parse('2026-08-05T08:00:00Z')
const BASE = 'https://vsa.test/api'

const CONFIG: VsaConfig = {
  baseUrl: BASE,
  login: 'api-user',
  password: 'secret',
  authType: 'api',
  actionUserId: 7,
  salesUserIds: [7, 9],
  entityId: 1,
  entityCode: 'ENT1',
  salesLogin: 'claire',
  ownEmailDomains: ['shodo.fr'],
}

interface Call {
  path: string
  method: string
  query: URLSearchParams
  body: Record<string, unknown>
  headers: Record<string, string>
}

type Reply = { ok?: boolean; status?: number; body?: unknown }
type Route = (call: Call) => Reply | undefined

/** A stand-in VSA. Routes on the path; every reply is JSON unless stated. */
const sandbox = (...routes: Route[]): { calls: Call[]; fetch: FetchLike } => {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url)
    const call: Call = {
      path: parsed.pathname.replace('/api', ''),
      method: init?.method ?? 'GET',
      query: parsed.searchParams,
      body: (() => {
        try {
          return init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
        } catch {
          return { raw: init?.body }
        }
      })(),
      headers: init?.headers ?? {},
    }
    calls.push(call)

    for (const route of [...routes, defaults]) {
      const reply = route(call)
      if (reply === undefined) continue
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(reply.body ?? {}),
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{}' }
  }
  return { calls, fetch }
}

const AURA = customerRow({ code: 'AURA', name: 'Aura Technologies' })
const NOVA = prospectRow({ code: 'NOVA', name: 'Nova Services' })
const MARC = prospectContactRow({ id: 11, firstname: 'Marc', lastname: 'Durand', email: 'marc@aura.fr', account: 'AURA' })

const defaults: Route = (call) => {
  if (call.path === '/login') return { body: { token: 'jeton' } }
  if (call.path in REFERENTIAL_BODIES) return { body: REFERENTIAL_BODIES[call.path] }
  if (call.path === '/v1/crm/customers') return { body: call.query.get('offset') === '1' ? [AURA] : [] }
  if (call.path === '/v1/prospects') return { body: call.query.get('offset') === '1' ? [NOVA] : [] }
  if (call.path === '/v1/prospect-contacts') {
    const email = call.query.get('email')
    if (email) return { body: email === 'marc@aura.fr' ? [MARC] : [] }
    return { body: call.query.get('offset') === '1' ? [MARC] : [] }
  }
  if (call.path === '/v1/crm/tasks' && call.method === 'POST') return { body: { success: true, id: 4242 } }
  if (call.path === '/v1/opportunity' && call.method === 'POST') return { body: { id: 777 } }
  if (call.path === '/v1/media/upload') return { status: 202, body: { id: 'file-9' } }
  if (/^\/v1\/crm\/tasks\/[^/]+\/attach$/.test(call.path)) return { body: {} }
  if (/^\/v1\/prospect\/[^/]+\/contact$/.test(call.path)) return { body: { id: 99 } }
  if (/^\/v1\/crm\/customer\/[^/]+\/contacts$/.test(call.path)) return { body: [] }
  return undefined
}

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
  closingDate: Date.parse('2026-09-30T00:00:00Z'),
  contextDescription: 'Refonte du socle de paiement',
  technicalEnvDescription: 'Java 21, Spring Boot',
  profileDescription: '2× Dev Java senior',
  startingDate: null,
}

const recorder = (): { events: DiagEvent[]; diagnostics: DiagRecorder } => {
  const events: DiagEvent[] = []
  return {
    events: events as DiagEvent[],
    diagnostics: {
      record: (input: DiagInput) => {
        events.push({ ...input, id: 'x', ts: NOW, detail: input.detail ?? {}, meetingId: null } as DiagEvent)
      },
    },
  }
}

const posts = (calls: Call[], path: string): Call[] => calls.filter((c) => c.method === 'POST' && c.path === path)

// ── the compte-rendu ───────────────────────────────────────────────────────

test('the compte-rendu is one POST, built from the tenant’s own referentials', async () => {
  const { calls, fetch } = sandbox()
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)

  assert.deepEqual(result, { ok: true, intentId: '', remoteId: '4242' })

  const [posted] = posts(calls, '/v1/crm/tasks')
  assert.ok(posted)
  const task = taskOf(posted.body)
  assert.equal(task.name, COMPTE_RENDU.title)
  assert.equal(task.description, COMPTE_RENDU.body, 'the rendered compte-rendu is the description')
  assert.equal(task.actionUser, 7)
  assert.deepEqual(task.salesUsers, [7, 9])
  // Straight out of `REFERENTIAL_BODIES`, not out of this adapter.
  assert.equal(task.type, 'RDV')
  assert.equal(task.status, 'DONE')
  assert.equal(task.priority, 2, 'the referential returns a string, the task takes an integer')
  assert.equal(task.startsAt, '2026-08-05T13:05:02+00:00')
  assert.equal(posted.headers.Authorization, 'Bearer jeton')
})

test('the referentials are read from the tenant — change them and the body changes', async () => {
  const { calls, fetch } = sandbox((call) =>
    call.path === '/v1/crm/task/types'
      ? { body: [taskTypeRow('MAISON', 'Compte rendu maison')] }
      : undefined,
  )
  await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)
  assert.equal(taskOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {}).type, 'MAISON')
})

test('an empty referential is a refusal to guess, and it is retryable', async () => {
  const { calls, fetch } = sandbox((call) => (call.path === '/v1/crm/task/status' ? { body: [] } : undefined))
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.retryable, true)
  assert.equal(posts(calls, '/v1/crm/tasks').length, 0, 'nothing is posted with an invented status')
})

// ── linking, and the account that is never created ─────────────────────────

test('a resolved account links the task to the company, with its known contacts', async () => {
  const { calls, fetch } = sandbox()
  await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)

  const link = linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {})
  assert.equal(link.type, 'COMPANY')
  assert.equal(link.accountId, 'AURA')
  assert.deepEqual(link.customerContactIds, [11], 'AURA is a customer, so the customer array is used')
  assert.deepEqual(link.prospectContactIds, [])
})

test('a prospect account puts its contacts in the prospect array', async () => {
  const { calls, fetch } = sandbox()
  await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu({ ...COMPTE_RENDU, accountId: 'NOVA' })
  const link = linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {})
  assert.deepEqual(link.prospectContactIds, [11])
  assert.deepEqual(link.customerContactIds, [])
})

/**
 * `createContact` returns `contactId: idFrom(answer)`, and `POST
 * /v1/prospect/{code}/contact` documents a 200 with no body schema — so a
 * contact that was really created can still come back with a blank id. The
 * filter that catches it has to reject `''`, and `Number('')` is 0, not NaN.
 * Zero passed `Number.isFinite` and went out as a link to contact zero.
 */
test('a blank contact id is dropped, not posted as contact zero', async () => {
  const { calls, fetch } = sandbox()
  await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu({
    ...COMPTE_RENDU,
    contactIds: ['', '  ', '11'],
  })

  const link = linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {})
  assert.deepEqual(link.customerContactIds, [11], 'only the real id survives')
})

test('a compte-rendu whose every contact id is blank links to the company alone', async () => {
  const { calls, fetch } = sandbox()
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu({
    ...COMPTE_RENDU,
    contactIds: [''],
  })

  assert.equal(result.ok, true, 'an unlinkable contact never costs the compte-rendu')
  const link = linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {})
  assert.equal(link.type, 'COMPANY')
  assert.deepEqual(link.customerContactIds, [])
})

test('an unknown company links free against the contact — no account is created', async () => {
  const { calls, fetch } = sandbox()
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu({ ...COMPTE_RENDU, accountId: null })

  assert.equal(result.ok, true)
  const link = linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {})
  assert.equal(link.type, 'FREE')
  assert.equal(link.freeContactId, 11)
  assert.equal(link.accountId, null)
  assert.equal(posts(calls, '/v1/prospect').length, 0)
})

test('neither an account nor a contact still creates the compte-rendu, unlinked', async () => {
  const { calls, fetch } = sandbox()
  const { events, diagnostics } = recorder()
  const result = await new VsaCrm({ config: CONFIG, fetch, diagnostics }).pushCompteRendu({
    ...COMPTE_RENDU,
    accountId: null,
    contactIds: [],
  })

  assert.equal(result.ok, true, 'a meeting is never lost for want of a link')
  assert.equal(linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {}).type, null)
  assert.ok(events.some((event) => event.code === 'crm.task.unlinked'))
})

test('an opportunity pushed first carries the task', async () => {
  const { calls, fetch } = sandbox()
  await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu({ ...COMPTE_RENDU, opportunityRef: '777' })
  const link = linkOf(posts(calls, '/v1/crm/tasks')[0]?.body ?? {})
  assert.equal(link.type, 'OPPY')
  assert.equal(link.opportunityId, '777')
})

test('no flow ever creates a prospect account', async () => {
  const { calls, fetch } = sandbox()
  const crm = new VsaCrm({ config: CONFIG, fetch })
  await crm.resolveAccount({ attendeeEmails: ['marc@aura.fr', 'claire@shodo.fr'], hint: 'Aura' })
  await crm.pushCompteRendu({ ...COMPTE_RENDU, accountId: null })
  await crm.pushOpportunity(OPPORTUNITY)
  await crm.createContact({
    firstName: 'Sophie',
    lastName: 'Petit',
    email: 'sophie@aura.fr',
    job: 'DSI',
    accountId: 'AURA',
  })
  await crm.attachTranscript('4242', 'transcription.txt', 'bonjour')

  assert.deepEqual(
    calls.filter((c) => c.method === 'POST' && c.path === '/v1/prospect'),
    [],
    '`POST /v1/prospect` needs address, activity and tax fields a meeting cannot produce (DEC-18)',
  )
})

test('the adapter has no account-creation path in its source at all', () => {
  // The runtime check above proves the flows we exercised; this one proves
  // there is no fourth flow waiting to be called.
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, '..', 'vsa')
  const sources: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'generated' && entry.name !== '__tests__') walk(path)
        continue
      }
      if (entry.name.endsWith('.ts')) sources.push(readFileSync(path, 'utf8'))
    }
  }
  walk(root)

  for (const source of sources) {
    assert.equal(
      /operationPath:\s*['"]\/v1\/prospect['"]/.test(source),
      false,
      'a prospect account must never be created from a meeting',
    )
    assert.equal(/VSA_OPERATIONS\.createProspect\b/.test(source), false)
  }
})

// ── the opportunity ────────────────────────────────────────────────────────

test('the opportunity carries the ESN recipe’s columns and the tenant’s stage', async () => {
  const { calls, fetch } = sandbox()
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushOpportunity(OPPORTUNITY)

  assert.deepEqual(result, { ok: true, intentId: '', remoteId: '777' })
  const posted = opportunityOf(posts(calls, '/v1/opportunity')[0]?.body ?? {})
  assert.equal(posted.entity, 'ENT1')
  assert.equal(posted.sales, 'claire')
  assert.equal(posted.accountType, 'CUSTOMER', 'read from the directory, not assumed')
  assert.equal(posted.accountCode, 'AURA')
  assert.equal(posted.stage, 'QUAL')
  assert.equal(posted.probability, 'P25')
  assert.equal(posted.context, OPPORTUNITY.contextDescription)
  assert.equal(posted.stack, OPPORTUNITY.technicalEnvDescription)
  assert.equal(posted.profiles, OPPORTUNITY.profileDescription)
  assert.equal(posted.closingDate, '2026-09-30', 'a day here, an instant on the task')
})

// ── contacts and the transcript ────────────────────────────────────────────

test('a contact is created under an existing account, with the account’s address', async () => {
  const { calls, fetch } = sandbox()
  const ref = await new VsaCrm({ config: CONFIG, fetch }).createContact({
    firstName: 'Sophie',
    lastName: 'Petit',
    email: 'sophie@aura.fr',
    job: 'DSI',
    accountId: 'AURA',
  })

  assert.equal(ref.contactId, '99')
  assert.equal(ref.accountId, 'AURA')
  const [posted] = posts(calls, '/v1/prospect/AURA/contact')
  assert.ok(posted)
  const contact = contactOf(posted.body)
  assert.equal(contact.firstName, 'Sophie')
  assert.equal(contact.useParentAddress, true, 'an address is never invented from a meeting')
  assert.deepEqual(contact.entities, [1])
})

test('the transcript is uploaded first, then attached to the task', async () => {
  const { calls, fetch } = sandbox()
  const result = await new VsaCrm({ config: CONFIG, fetch }).attachTranscript('4242', 'transcription.txt', 'bonjour')

  assert.equal(result.ok, true)
  const upload = calls.find((c) => c.path === '/v1/media/upload')
  const attach = calls.find((c) => c.path === '/v1/crm/tasks/4242/attach')
  assert.ok(upload && attach)
  assert.ok(calls.indexOf(upload) < calls.indexOf(attach), 'the file id has to exist before it can be bound')
  assert.equal(upload.headers['Content-Type'], 'application/octet-stream')
  assert.match(upload.headers['Content-Disposition'] ?? '', /transcription\.txt/)
  assert.equal(attachOf(attach.body).fileId, 'file-9')
})

// ── resolution through the adapter ─────────────────────────────────────────

test('resolveAccount asks for the exact address first and records why it ranked', async () => {
  const { calls, fetch } = sandbox()
  const { events, diagnostics } = recorder()
  const candidates = await new VsaCrm({ config: CONFIG, fetch, diagnostics }).resolveAccount({
    attendeeEmails: ['claire@shodo.fr', 'marc@aura.fr'],
    hint: 'Aura — cadrage',
  })

  const lookups = calls.filter((c) => c.path === '/v1/prospect-contacts' && c.query.get('email'))
  assert.deepEqual(
    lookups.map((c) => c.query.get('email')),
    ['marc@aura.fr'],
    'the rep’s own address is not looked up',
  )
  assert.equal(candidates[0]?.accountId, 'AURA')
  assert.ok(candidates[0]?.signals.includes('contact-email'))

  const ranked = events.find((event) => event.code === 'crm.resolve.ranked')
  assert.ok(ranked, 'a mis-attribution has to be diagnosable afterwards (DEC-18)')
  assert.ok(JSON.stringify(ranked.detail).includes('contact-email'))
})

// ── referentials: fetched, cached, and expiring ────────────────────────────

test('referentials are fetched once and served from the cache until they expire', async () => {
  let clock = NOW
  const { calls, fetch } = sandbox()
  const session = new VsaSession({
    baseUrl: BASE,
    credentials: { login: 'l', password: 'p', authType: 'api' },
    fetch,
  })
  const cache = new ReferentialCache({ session, now: () => clock, ttlMs: 60_000 })

  await cache.all()
  await cache.all()
  const first = calls.filter((c) => c.path === '/v1/crm/task/types').length
  assert.equal(first, 1, 'the second read is free')
  assert.equal(cache.stale, false)

  clock += 60_001
  assert.equal(cache.stale, true, 'the window is explicit and it closes')
  await cache.all()
  assert.equal(calls.filter((c) => c.path === '/v1/crm/task/types').length, 2)
})

test('no referential value is written down in this module', () => {
  // Every list has a spec that says *where* to read it; none has a value.
  for (const spec of REFERENTIALS) {
    assert.ok(spec.operation.length > 0)
    assert.ok(spec.codeKey.length > 0)
  }
  const entries = normalise(REFERENTIALS[0]!, REFERENTIAL_BODIES['/v1/crm/task/types'])
  const chosen = pick(entries, PICK_HINTS.taskTypes)
  assert.equal(chosen?.why, 'preferred')
  // With no hint matching, the tenant's first row wins and says it was a fallback.
  assert.equal(pick(entries, ['introuvable'])?.why, 'fallback')
  assert.equal(pick([], PICK_HINTS.taskTypes), null, 'an empty tenant list yields nothing, never a literal')
})

// ── the probe ──────────────────────────────────────────────────────────────

test('the probe reports a missing capability as data rather than throwing', async () => {
  const { fetch } = sandbox((call) =>
    call.path === '/v1/prospects' ? { ok: false, status: 404, body: { message: 'not found' } } : undefined,
  )
  const report = await new VsaCrm({ config: CONFIG, fetch }).probe()

  assert.equal(report.authenticated, true)
  assert.equal(report.ok, false)
  const finding = report.findings.find((f) => f.id === 'listProspects')
  assert.equal(finding?.state, 'missing')
  assert.equal(finding?.required, true)
  assert.ok(finding?.matters.length > 0, 'the report says what stops working')
  assert.match(report.summary, /capacité/)
  // Everything else is still reported — one gap does not blank the page.
  assert.equal(report.findings.find((f) => f.id === 'listCustomers')?.state, 'ok')
})

test('the probe tells an empty referential from an absent endpoint', async () => {
  const { fetch } = sandbox((call) => (call.path === '/v1/crm/task/status' ? { body: [] } : undefined))
  const report = await new VsaCrm({ config: CONFIG, fetch }).probe()
  const finding = report.findings.find((f) => f.id === 'taskStatuses')
  assert.equal(finding?.state, 'missing')
  assert.match(finding?.detail ?? '', /vide/)
  assert.equal(report.findings.find((f) => f.id === 'createTask')?.state, 'missing')
})

test('the probe never writes', async () => {
  const { calls, fetch } = sandbox()
  const report = await new VsaCrm({ config: CONFIG, fetch }).probe()
  const writes = calls.filter((c) => c.method === 'POST' && c.path !== '/login')
  assert.deepEqual(writes, [], 'a probe that POSTs leaves a task in the client’s CRM on every start')
  assert.equal(report.ok, true)
  assert.equal(report.findings.find((f) => f.id === 'createTask')?.state, 'unverified')
})

test('refused credentials make every other finding moot, and say so', async () => {
  const { fetch } = sandbox((call) => (call.path === '/login' ? { ok: false, status: 401, body: {} } : undefined))
  const report = await new VsaCrm({ config: CONFIG, fetch }).probe()
  assert.equal(report.authenticated, false)
  assert.equal(report.ok, false)
  assert.equal(report.findings.length, 1)
  assert.match(report.summary, /identifiants/)
})

// ── the session ────────────────────────────────────────────────────────────

test('a stale token is re-logged in once and the request replayed', async () => {
  let served = 0
  const { calls, fetch } = sandbox((call) => {
    if (call.path !== '/v1/crm/task/types') return undefined
    served += 1
    return served === 1 ? { ok: false, status: 401, body: {} } : undefined
  })
  const session = new VsaSession({
    baseUrl: BASE,
    credentials: { login: 'l', password: 'p', authType: 'api' },
    fetch,
  })
  const rows = await session.request({ operationPath: '/v1/crm/task/types', method: 'GET' })

  assert.ok(Array.isArray(rows))
  assert.equal(calls.filter((c) => c.path === '/login').length, 2, 'the token was refreshed exactly once')
})

test('a second refusal is the credentials, not the token', async () => {
  const { fetch } = sandbox((call) => (call.path === '/v1/crm/task/types' ? { ok: false, status: 401, body: {} } : undefined))
  const session = new VsaSession({
    baseUrl: BASE,
    credentials: { login: 'l', password: 'p', authType: 'api' },
    fetch,
  })
  await assert.rejects(
    () => session.request({ operationPath: '/v1/crm/task/types', method: 'GET' }),
    (error: unknown) => error instanceof VsaError && error.badCredentials && !error.retryable,
  )
})

// ── health ─────────────────────────────────────────────────────────────────

test('refused credentials are down and not retryable; a 5xx is degraded and is', () => {
  const auth = crmHealth(
    new VsaError({ status: 401, message: 'identifiants VerySwing refusés', retryable: false, badCredentials: true }),
    NOW,
  )
  assert.equal(auth.state, 'down')
  assert.equal(auth.state === 'down' && auth.retryable, false)
  assert.match(auth.state === 'down' ? auth.reason : '', /identifiants/)

  const outage = crmHealth(new VsaError({ status: 503, message: 'VerySwing a répondu 503', retryable: true }), NOW)
  assert.equal(outage.state, 'degraded')
  assert.equal(outage.state === 'degraded' && outage.retryable, true)
})

test('a forbidden account is down with no retry, and a throttle names the wait', () => {
  const forbidden = crmHealth(new VsaError({ status: 403, message: 'interdit', retryable: false }), NOW)
  assert.equal(forbidden.state, 'down')
  assert.equal(forbidden.state === 'down' && forbidden.retryable, false)

  const throttled = crmHealth(
    new VsaError({ status: 429, message: 'trop de requêtes', retryable: true, retryAfterMs: 30_000 }),
    NOW,
  )
  assert.equal(throttled.state, 'degraded')
  assert.match(throttled.state === 'degraded' ? throttled.reason : '', /30 s/)
})

test('an unknown failure is down but retryable, and never silent', () => {
  const health = crmHealth(new Error('socket coupé'), NOW)
  assert.equal(health.state, 'down')
  assert.equal(health.state === 'down' && health.retryable, true)
  assert.equal(health.state === 'down' ? health.reason : '', 'socket coupé')
})

test('a push failure is settled, never thrown — the Outlook draft must still ship', async () => {
  const { fetch } = sandbox((call) =>
    call.path === '/v1/crm/tasks' ? { ok: false, status: 500, body: { message: 'boom' } } : undefined,
  )
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.retryable, true)
})

test('a refusal of the content is terminal — a queue that retries a 400 forever jams', async () => {
  const { fetch } = sandbox((call) =>
    call.path === '/v1/crm/tasks' ? { body: { success: false, message: 'type de tâche inconnu' } } : undefined,
  )
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.retryable, false)
  assert.equal(result.ok === false && result.reason, 'type de tâche inconnu')
})

test('a create with no id is terminal — there is no idempotency key to retry behind', async () => {
  const { fetch } = sandbox((call) => (call.path === '/v1/crm/tasks' ? { body: { success: true } } : undefined))
  const result = await new VsaCrm({ config: CONFIG, fetch }).pushCompteRendu(COMPTE_RENDU)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.retryable, false)
})
