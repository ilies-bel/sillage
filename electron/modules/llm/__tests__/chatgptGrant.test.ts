/**
 * DEC-36 — the ChatGPT subscription row.
 *
 * Two things are pinned here and they are not the same thing. The first is that
 * a grant is read correctly. The second, and the one worth the file, is that
 * **every way it can be unusable produces a different sentence** — because the
 * remedies differ, and a row that says « aucune clé enregistrée » next to a
 * provider with no key field has told the rep nothing they can act on.
 *
 * The endpoint's own rules are pinned in `openAiCompatible.test.ts`, where the
 * request body is; they were established against the live service and are the
 * kind of fact that rots silently.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { codexModel, readCodexGrant } from '../chatgptGrant.ts'

/** A JWT-shaped token whose `exp` sits `offset` seconds from `now`. */
const tokenExpiring = (offsetSeconds: number, now = Date.now()): string => {
  const exp = Math.floor(now / 1000) + offsetSeconds
  const payload = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url')
  return `header.${payload}.signature`
}

const fileOf = (body: unknown) => () => JSON.stringify(body)
const missing = () => {
  throw new Error('ENOENT')
}

test('reads the grant `codex login` stored', () => {
  const result = readCodexGrant({
    readFile: fileOf({ tokens: { access_token: tokenExpiring(3600), account_id: 'acct-1' } }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.grant.accountId, 'acct-1')
})

test('no file at all names the command that makes one', () => {
  const result = readCodexGrant({ readFile: missing })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /codex login/)
})

test('an expired grant says so, and does not say « aucune session »', () => {
  // The distinction is the whole point: someone who has never run `codex login`
  // and someone whose token lapsed last Tuesday are looking for two different
  // things, and only one of them is surprised to be told to log in.
  const now = Date.UTC(2026, 7, 7)
  const result = readCodexGrant({
    now,
    readFile: fileOf({ tokens: { access_token: tokenExpiring(-60, now), account_id: 'acct-1' } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /expirée/)
})

test('a grant with no account id is refused rather than sent', () => {
  // `chatgpt-account-id` is part of the auth, not a courtesy header: the
  // endpoint rejects an otherwise valid token without it. Failing here costs a
  // sentence; failing there costs the one extraction a meeting gets.
  const result = readCodexGrant({
    readFile: fileOf({ tokens: { access_token: tokenExpiring(3600) } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /incomplète/)
})

test('a Codex installed in API-key mode points at the OpenAI row, not at `codex login`', () => {
  // Running `codex login` again reproduces exactly what is already there. The
  // key is usable — one line up, on the row that has a field for it.
  const result = readCodexGrant({
    readFile: fileOf({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-xxxx' }),
  })
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /OpenAI/)
  assert.doesNotMatch(result.ok ? '' : result.reason, /codex login/)
})

test('an unparseable file is a refusal, never a crash', () => {
  const result = readCodexGrant({ readFile: () => 'not json at all' })
  assert.equal(result.ok, false)
})

test('a token with no `exp` claim is used rather than assumed dead', () => {
  // Absence of an expiry is not evidence of expiry. The endpoint is the
  // authority on whether a token still works, and refusing one we cannot date
  // would take a working provider off the table over a missing claim.
  const result = readCodexGrant({
    readFile: fileOf({ tokens: { access_token: 'header.notbase64.sig', account_id: 'a' } }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.grant.expiresAt, null)
})

// ── which model, out of Codex's own config ──────────────────────────────────

test('the model comes from the top-level table of config.toml', () => {
  const model = codexModel({
    readFile: () => 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n',
  })
  assert.equal(model, 'gpt-5.6-sol')
})

test('a model inside a profile is not mistaken for the one Codex uses', () => {
  // `[profiles.experimental]` is a table someone is not currently running.
  // Reading past the header picks whichever profile came first, and this
  // endpoint answers a name it does not serve with a 400, not a fallback.
  const model = codexModel({
    readFile: () => '# no top-level model\n[profiles.experimental]\nmodel = "gpt-9"\n',
  })
  assert.equal(model, null)
})

test('no config file is null, not a throw — the constant takes over', () => {
  assert.equal(codexModel({ readFile: missing }), null)
})
