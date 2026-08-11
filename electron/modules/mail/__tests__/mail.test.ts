import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OutlookMail, MAIL_SCOPES } from '../OutlookMail.ts'
import { ForbiddenScopeError, GraphError, draftsUrl, type FetchLike } from '../graph.ts'
import { mailHealth } from '../index.ts'
import { ConsentRequiredError, InteractionRequiredError, type IdentityPort } from '../../../core/contracts/identity.ts'
import type { MailDraftPayload } from '../../../core/contracts/push.ts'

const NOW = Date.parse('2026-08-05T08:00:00Z')

const identity: IdentityPort = {
  account: () => ({ homeAccountId: 'h', username: 'claire@shodo.fr', name: 'Claire', tenantId: 't' }),
  signIn: async () => {
    throw new Error('never in a test')
  },
  signOut: async () => {},
  token: async () => 'jeton',
}

const PAYLOAD: MailDraftPayload = {
  subject: 'Suite à notre échange — Aura',
  body: 'Bonjour,\n\nMerci pour le temps accordé.',
  to: ['marc@aura.fr', 'claire@shodo.fr'],
}

interface Call {
  url: string
  method: string | undefined
  headers: Record<string, string> | undefined
  body: string | undefined
}

/** Records every request the module makes, so the assertions can be about all of them. */
const recorder = (
  reply: (call: Call) => { ok: boolean; status: number; body: string; retryAfter?: string },
): { calls: Call[]; fetch: FetchLike } => {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, method: init?.method, headers: init?.headers, body: init?.body }
    calls.push(call)
    const answer = reply(call)
    return {
      ok: answer.ok,
      status: answer.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? answer.retryAfter ?? null : null) },
      text: async () => answer.body,
    }
  }
  return { calls, fetch }
}

const created = () => ({ ok: true, status: 201, body: JSON.stringify({ id: 'AAMkAGI2', isDraft: true }) })

// ── the draft ──────────────────────────────────────────────────────────────

test('a draft is one POST to the messages resource, and returns its id', async () => {
  const { calls, fetch } = recorder(created)
  const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://graph.microsoft.com/v1.0/me/messages')
  assert.equal(calls[0]?.method, 'POST')
  assert.equal(calls[0]?.headers?.Authorization, 'Bearer jeton')

  const sent = JSON.parse(calls[0]?.body ?? '{}')
  assert.equal(sent.subject, PAYLOAD.subject)
  assert.equal(sent.body.contentType, 'Text')
  assert.deepEqual(
    sent.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address),
    PAYLOAD.to,
  )

  assert.deepEqual(result, { ok: true, intentId: '', remoteId: 'AAMkAGI2' })
})

test('the outbox stamps the intent id, not the adapter', async () => {
  const { fetch } = recorder(created)
  const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)
  // Empty rather than guessed: the adapter is handed a payload, never a row.
  assert.equal(result.intentId, '')
})

// ── HR-8: no send path exists ──────────────────────────────────────────────

const MODULE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const moduleSources = (): Array<{ file: string; source: string }> =>
  readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, source: readFileSync(join(MODULE_DIR, f), 'utf8') }))

test('HR-8 — no file in the module can name a send endpoint or the send scope', () => {
  const files = moduleSources()
  assert.ok(files.length >= 3, 'the module should have been scanned')

  // Assembled from fragments so this test file is not itself a place the
  // forbidden strings live — the check would then always pass on itself.
  const banned = [`/${'send'}`, `Mail.${'Send'}`, `${'send'}Mail`, `${'send'}mail`]

  for (const { file, source } of files) {
    const haystack = source.toLowerCase()
    for (const needle of banned) {
      assert.ok(
        !haystack.includes(needle.toLowerCase()),
        `${file} names "${needle}" — HR-8 says this module creates drafts and nothing else`,
      )
    }
  }
})

test('HR-8 — the only URL the module can build is the messages resource', () => {
  assert.equal(draftsUrl(), 'https://graph.microsoft.com/v1.0/me/messages')
  // No arguments: there is no segment a caller can append or substitute.
  assert.equal(draftsUrl.length, 0)
  assert.deepEqual(MAIL_SCOPES, ['Mail.ReadWrite'])
})

test('DEC-10 — the module never names the calendar resource it must not write', () => {
  for (const { file, source } of moduleSources()) {
    assert.ok(
      !source.toLowerCase().includes(`/me/${'events'}`),
      `${file} names the events resource — DEC-10 forbids writing an Outlook event body`,
    )
  }
})

test('a forbidden scope is refused at construction, before any network call', () => {
  const { calls, fetch } = recorder(created)
  assert.throws(
    () => new OutlookMail({ identity, fetch, scopes: ['Mail.ReadWrite', `Mail.${'Send'}`] }),
    ForbiddenScopeError,
  )
  assert.equal(calls.length, 0)
})

test('a forbidden scope added after construction is refused before the request', async () => {
  const { calls, fetch } = recorder(created)
  const scopes = ['Mail.ReadWrite']
  const mail = new OutlookMail({ identity, fetch, scopes })
  scopes.push(`Mail.${'Send'}`)

  await assert.rejects(() => mail.createDraft(PAYLOAD), ForbiddenScopeError)
  assert.equal(calls.length, 0, 'the guard must run before the token and before the fetch')
})

test('the token is requested for the mail scopes only', async () => {
  const asked: Array<readonly string[] | undefined> = []
  const { fetch } = recorder(created)
  const spy: IdentityPort = {
    ...identity,
    token: async (scopes) => {
      asked.push(scopes)
      return 'jeton'
    },
  }
  await new OutlookMail({ identity: spy, fetch }).createDraft(PAYLOAD)
  assert.deepEqual(asked, [['Mail.ReadWrite']])
})

// ── failures ───────────────────────────────────────────────────────────────

test('a throttled draft comes back retryable, a rejected one does not', async () => {
  const throttled = recorder(() => ({ ok: false, status: 429, body: '', retryAfter: '30' }))
  const first = await new OutlookMail({ identity, fetch: throttled.fetch }).createDraft(PAYLOAD)
  assert.equal(first.ok, false)
  assert.equal(first.ok === false && first.retryable, true)

  const rejected = recorder(() => ({
    ok: false,
    status: 400,
    body: JSON.stringify({ error: { message: 'destinataire invalide' } }),
  }))
  const second = await new OutlookMail({ identity, fetch: rejected.fetch }).createDraft(PAYLOAD)
  assert.equal(second.ok, false)
  assert.equal(second.ok === false && second.retryable, false)
  assert.equal(second.ok === false && second.reason, 'destinataire invalide')
})

test('a created draft with no id is terminal — a second POST would leave two drafts', async () => {
  const { fetch } = recorder(() => ({ ok: true, status: 201, body: '{}' }))
  const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.retryable, false)
})

// ── health ─────────────────────────────────────────────────────────────────

test('every failure a rep can hit maps to a reason and an honest retry flag', () => {
  const consent = mailHealth(new ConsentRequiredError(), NOW)
  assert.equal(consent.state, 'down')
  assert.equal(consent.state === 'down' && consent.retryable, false)

  const signIn = mailHealth(new InteractionRequiredError(), NOW)
  assert.equal(signIn.state === 'down' && signIn.retryable, true)

  const forbidden = mailHealth(new ForbiddenScopeError([`Mail.${'Send'}`]), NOW)
  assert.equal(forbidden.state, 'down')
  assert.equal(forbidden.state === 'down' && forbidden.retryable, false)

  const throttled = mailHealth(
    new GraphError({ status: 429, message: 'throttled', retryable: true, retryAfterMs: 30_000 }),
    NOW,
  )
  assert.equal(throttled.state, 'degraded')
  assert.ok(throttled.state === 'degraded' && throttled.reason.includes('30 s'))

  const noScope = mailHealth(new GraphError({ status: 403, message: 'denied', retryable: false }), NOW)
  assert.equal(noScope.state === 'down' && noScope.retryable, false)

  const unknown = mailHealth(new Error('câble débranché'), NOW)
  assert.equal(unknown.state, 'down')
  assert.equal(unknown.state === 'down' && unknown.reason, 'câble débranché')
})
