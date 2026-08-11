/**
 * `selectLlm` is pure, so every rule it carries is provable with no network, no
 * key and no provider account — and `config.ts` is a separate file so the
 * environment can be handed in as a plain object.
 *
 * Where a provider runs lives here only as *data*: each row declares it and
 * Réglages shows it. It refuses nothing, and it no longer breaks ties either
 * (DEC-37). The rule that still refuses is `offlineOnly`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { LLM_PROVIDERS, descriptorFor, selectLlm } from '../registry.ts'
import { configuredLlmProviders, llmEndpointFor } from '../config.ts'

const reasonOf = (selection: ReturnType<typeof selectLlm>): string =>
  selection.ok === false ? selection.reason : ''

test('every descriptor declares a location the schema knows', () => {
  for (const provider of LLM_PROVIDERS) {
    assert.ok(['local', 'remote'].includes(provider.capabilities.residency), provider.id)
  }
})

test('a hosted provider is selected when it is the one configured', () => {
  assert.deepEqual(selectLlm({ configured: ['openai'] }), { ok: true, id: 'openai' })
})

test('nothing configured says so, and blames nothing else', () => {
  const chosen = selectLlm({ configured: [] })
  assert.equal(chosen.ok, false)
  // The rep reads this sentence, so it names the missing thing rather than a
  // requirement id (HR-6).
  assert.match(reasonOf(chosen), /aucun modèle/)
  assert.doesNotMatch(reasonOf(chosen), /HR-\d+/)
})

test('a hosted provider wins over the local floor when both are usable', () => {
  const chosen = selectLlm({ configured: ['local-openai', 'mistral'] })
  assert.deepEqual(chosen, { ok: true, id: 'mistral' })
})

test('the local floor wins when nothing else is usable (HR-5)', () => {
  const chosen = selectLlm({ configured: ['local-openai'] })
  assert.deepEqual(chosen, { ok: true, id: 'local-openai' })
})

test('the local row is the floor, so a hosted model outranks it', () => {
  const chosen = selectLlm({ configured: ['local-openai', 'openai'] })
  assert.deepEqual(chosen, { ok: true, id: 'openai' })
})

test('local is chosen the moment nothing hosted is configured', () => {
  assert.deepEqual(selectLlm({ configured: ['local-openai'] }), { ok: true, id: 'local-openai' })
})

test('offlineOnly refuses a hosted provider even when it is configured', () => {
  const chosen = selectLlm({ configured: ['local-openai', 'mistral'], offlineOnly: true })
  assert.deepEqual(chosen, { ok: true, id: 'local-openai' })
})

test('offlineOnly with no local server names the offline mode as the constraint', () => {
  const chosen = selectLlm({ configured: ['mistral'], offlineOnly: true })
  assert.equal(chosen.ok, false)
  assert.match(reasonOf(chosen), /hors ligne/)
})

test('a hosted provider is selected on its key alone — where it runs does not gate', () => {
  // Where a transcript may be processed is a deployment decision, not one this
  // registry makes. Configuring the key *is* the decision.
  assert.deepEqual(selectLlm({ configured: ['groq'] }), { ok: true, id: 'groq' })
  assert.deepEqual(selectLlm({ configured: ['openai'] }), { ok: true, id: 'openai' })
})

test('table order breaks a tie between two providers that are otherwise equal', () => {
  // Both bind a schema natively and both are hosted, so nothing in `rank`
  // separates them. The sort is stable, so the tie falls to the order written
  // in LLM_PROVIDERS — which used to be settled by a residency claim the rows
  // no longer make (DEC-37). A preference, not a rule: the test above proves
  // either is still reachable on its own key.
  const chosen = selectLlm({ configured: ['openai', 'mistral'] })
  assert.deepEqual(chosen, { ok: true, id: 'mistral' })
})

test('native schema binding outranks a provider without it', () => {
  // The one that can be held to a schema natively is preferred.
  const chosen = selectLlm({ configured: ['mistral', 'azure-openai'] })
  assert.equal(chosen.ok, true)
  assert.equal(descriptorFor(chosen.ok ? chosen.id : '')?.capabilities.residency, 'remote')
})

test('offlineOnly still refuses every hosted provider', () => {
  // The one guarantee that survives: the rep asked for nothing to leave the
  // machine, and that is a request made in the product about this meeting.
  const chosen = selectLlm({ configured: ['openai', 'mistral'], offlineOnly: true })
  assert.equal(chosen.ok, false)
  assert.match(reasonOf(chosen), /hors ligne/)
})

/**
 * An environment that configures nothing, on a machine that may configure
 * something anyway.
 *
 * `chatgpt` reads a grant off the disk rather than out of the environment
 * (DEC-36), exactly as `local-whisper` reads its weights, so `{ env: {} }` alone
 * is not a clean room: on a developer's machine with Codex installed this suite
 * would pass or fail depending on whose laptop it ran on — the worst kind of
 * flake, because it reproduces nowhere. Pointing the path at a file that does
 * not exist is what makes "nothing is configured" mean it.
 */
const NO_CODEX = { SILLAGE_CODEX_AUTH_PATH: '/nonexistent/codex/auth.json' }

test('no provider is configured by an empty environment — BYOK means BYOK', () => {
  assert.deepEqual(configuredLlmProviders({ env: NO_CODEX }), [])
})

test('the local endpoint needs a URL and a model, and defaults neither', () => {
  assert.equal(
    llmEndpointFor('local-openai', { env: { SILLAGE_LLM_LOCAL_URL: 'http://127.0.0.1:11434/v1' } }),
    null,
  )
  const endpoint = llmEndpointFor('local-openai', {
    env: {
      SILLAGE_LLM_LOCAL_URL: 'http://127.0.0.1:11434/v1/',
      SILLAGE_LLM_LOCAL_MODEL: 'mistral-small',
    },
  })
  assert.equal(endpoint?.chatUrl, 'http://127.0.0.1:11434/v1/chat/completions')
  // A local server that takes no auth must not be handed an empty bearer.
  assert.equal(endpoint?.apiKey, undefined)
})

test('the Azure endpoint is never defaulted, because the row claims its region', () => {
  assert.equal(
    llmEndpointFor('azure-openai', { env: { SILLAGE_AZURE_OPENAI_API_KEY: 'k' } }),
    null,
  )
  const endpoint = llmEndpointFor('azure-openai', {
    env: {
      SILLAGE_AZURE_OPENAI_ENDPOINT: 'https://esn-fr.openai.azure.com',
      SILLAGE_AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
      SILLAGE_AZURE_OPENAI_API_KEY: 'k',
    },
  })
  assert.match(endpoint?.chatUrl ?? '', /\/chat\/completions\?api-version=/)
})

test('a key alone puts the provider in `configured`, and the selector uses it', () => {
  const source = { env: { ...NO_CODEX, SILLAGE_GROQ_API_KEY: 'gsk_test' } }
  assert.deepEqual(configuredLlmProviders(source), ['groq'])
  assert.deepEqual(selectLlm({ configured: configuredLlmProviders(source) }), { ok: true, id: 'groq' })
})

// ── DEC-34: the vault is the interface, the environment is the override ─────

test('a key from the vault configures a provider with no environment at all', () => {
  const source = { stored: { openai: 'sk-from-the-keychain' }, env: NO_CODEX }
  assert.deepEqual(configuredLlmProviders(source), ['openai'])
  assert.equal(llmEndpointFor('openai', source)?.apiKey, 'sk-from-the-keychain')
})

test('the vault wins over the environment for the same provider', () => {
  // Which way round this goes is the whole of DEC-34. If the environment won,
  // a rep who pasted a key into Réglages would watch it save and then watch a
  // stale developer variable keep being used — with nothing on screen to
  // explain it, because the row would correctly say a key is stored.
  const endpoint = llmEndpointFor('openai', {
    stored: { openai: 'sk-typed-in-reglages' },
    env: { SILLAGE_OPENAI_API_KEY: 'sk-left-over-in-dotenv' },
  })
  assert.equal(endpoint?.apiKey, 'sk-typed-in-reglages')
})

test('an empty vault entry does not shadow the environment', () => {
  // Deleting a key leaves nothing, not an empty string — but a store that
  // rounds absence to '' must not turn the development override off with it.
  const endpoint = llmEndpointFor('openai', {
    stored: { openai: '   ' },
    env: { SILLAGE_OPENAI_API_KEY: 'sk-from-the-environment' },
  })
  assert.equal(endpoint?.apiKey, 'sk-from-the-environment')
})

test('a vault key for one provider does not configure another', () => {
  const source = { stored: { openai: 'sk-test' }, env: NO_CODEX }
  assert.deepEqual(configuredLlmProviders(source), ['openai'])
  assert.equal(llmEndpointFor('groq', source), null)
})

test('anthropic is never reported as configured — its API is not OpenAI-compatible', () => {
  assert.deepEqual(
    configuredLlmProviders({ env: { ...NO_CODEX, SILLAGE_ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    [],
  )
  assert.ok(descriptorFor('anthropic'), 'the row still exists so the settings screen can explain it')
})

// ── DEC-34: the settings store is the interface, the environment is the override ──

test('a self-hosted row is configured from Réglages with no environment at all', () => {
  // The gap this closes. Both of these came from environment variables, so the
  // row that most needs configuring was the one a rep could not configure —
  // a packaged build has no `.env` and nobody is setting a variable for it.
  const source = {
    env: NO_CODEX,
    fields: { 'local-openai': { url: 'http://localhost:11434/v1', model: 'llama3.1:8b' } },
  }
  assert.deepEqual(configuredLlmProviders(source), ['local-openai'])
  assert.equal(
    llmEndpointFor('local-openai', source)?.chatUrl,
    'http://localhost:11434/v1/chat/completions',
  )
})

test('a required field left empty leaves the row unconfigured rather than guessed', () => {
  // A URL with no model is not "nearly configured": every server behind this
  // row rejects an unknown model name, so a default would fail at the first
  // extraction with a 404 that reads like an outage.
  const source = { env: NO_CODEX, fields: { 'local-openai': { url: 'http://localhost:11434/v1' } } }
  assert.deepEqual(configuredLlmProviders(source), [])
})

test('a field typed in Réglages wins over the same value in the environment', () => {
  // Which way round this goes is the whole of DEC-34, and the failure it
  // prevents is silent: a rep corrects the URL, the field shows the new value,
  // and a stale developer variable keeps being called.
  const endpoint = llmEndpointFor('azure-openai', {
    stored: { 'azure-openai': 'k' },
    fields: { 'azure-openai': { endpoint: 'https://from-reglages.openai.azure.com' } },
    env: { ...NO_CODEX, SILLAGE_AZURE_OPENAI_ENDPOINT: 'https://from-dotenv.openai.azure.com', SILLAGE_AZURE_OPENAI_DEPLOYMENT: 'gpt-4o' },
  })
  assert.match(endpoint?.chatUrl ?? '', /from-reglages/)
})

/**
 * A grant on disk, so the `chatgpt` row can be exercised like any other.
 *
 * Its credential is a file rather than a field, so `NO_CODEX` — which is what
 * makes the rest of this suite hermetic — is exactly what stops it from ever
 * being configured. Writing a fixture is the way to test the row's *fields*
 * without also asserting something about the developer's home directory.
 */
const GRANT_FIXTURE = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'sillage-codex-'))
  const path = join(dir, 'auth.json')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const payload = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url')
  writeFileSync(
    path,
    JSON.stringify({ tokens: { access_token: `h.${payload}.s`, account_id: 'acct-fixture' } }),
  )
  return path
})()

test('every declared field is one a reader actually consults', () => {
  // The failure mode a declaration invites: a field that renders, saves, and is
  // read by nothing. There is no type that can catch it — the registry declares
  // strings and `config.ts` reads strings — so it is checked here, against the
  // one thing both agree on, which is that supplying the field changes the
  // endpoint.
  for (const descriptor of LLM_PROVIDERS) {
    for (const field of descriptor.fields ?? []) {
      const withValue = llmEndpointFor(descriptor.id, {
        stored: { [descriptor.id]: 'k' },
        fields: {
          [descriptor.id]: Object.fromEntries(
            (descriptor.fields ?? []).map((f) => [f.key, f.key === field.key ? 'sentinelle' : 'x']),
          ),
        },
        env:
          descriptor.id === 'chatgpt'
            ? { SILLAGE_CODEX_AUTH_PATH: GRANT_FIXTURE }
            : NO_CODEX,
      })
      assert.ok(
        withValue !== null,
        `${descriptor.id}: filling every declared field must configure the row`,
      )
      assert.ok(
        JSON.stringify(withValue).includes('sentinelle'),
        `${descriptor.id}.${field.key} is declared but nothing reads it`,
      )
    }
  }
})
