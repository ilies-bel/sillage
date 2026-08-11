/**
 * Where the credentials come from, and nothing else.
 *
 * Split out of `registry.ts` on purpose: the registry decides *which provider is
 * legal*, and that decision must be testable with no credentials at all. This is
 * the one place in the module that resolves one. No key is ever written down
 * here — absent, the provider is simply not in `configured` and `selectLlm` says
 * so.
 *
 * ## Vault first, environment second (DEC-34)
 *
 * A key typed into Réglages goes to the OS credential store and arrives here as
 * `stored`. That is the supported path and the only one that exists in a
 * packaged build. `process.env` stays underneath it as a **development
 * override** — so `SILLAGE_OPENAI_API_KEY=… npm start` still works and CI needs
 * no keychain — and it is never the interface a rep is expected to use.
 *
 * BYOK, in the literal sense (HR-5): every hosted provider is off until someone
 * supplies their own key, and the self-hosted row needs only a URL.
 */
import type { LlmProviderDescriptor } from '../../core/contracts/providers.ts'
import {
  CHATGPT_BASE_URL,
  chatGptHeaders,
  codexAuthPath,
  codexConfigPath,
  codexModel,
  readCodexGrant,
} from './chatgptGrant.ts'
import { LLM_PROVIDERS } from './registry.ts'

/**
 * The last resort for the ChatGPT row, and the one value in this file that is
 * expected to rot.
 *
 * The real source is `~/.codex/config.toml` — see `codexModel`. This is what is
 * used when Codex is installed but has never had a model written down, and it is
 * a name verified against the live endpoint on 2026-08-07, which is a fact with
 * a date on it rather than a guarantee. When it stops being served the endpoint
 * says so in words (« The 'x' model is not supported… ») and that sentence
 * reaches the rep; the fix is the field in Réglages, not a release.
 */
export const DEFAULT_CHATGPT_MODEL = 'gpt-5.6-sol'

/** What an OpenAI-compatible adapter needs to make a call. */
export interface LlmEndpointConfig {
  providerId: string
  /**
   * The **complete** URL to POST a chat completion to, query string included.
   *
   * Not a base URL the adapter appends a path to. Azure pins its API version in
   * the query string, so `${base}/chat/completions` would produce
   * `…?api-version=2024-10-21/chat/completions` — a 404 that reads like a wrong
   * endpoint. Assembling the URL where the provider's shape is known keeps that
   * shape out of the adapter entirely.
   */
  chatUrl: string
  model: string
  /**
   * Absent for a local server that takes no auth.
   *
   * A **function** when the credential can change under a running app: the
   * ChatGPT grant is rotated in place by another program, and a token read once
   * at boot expires ten days later in the middle of a meeting. Resolved per
   * request, and allowed to throw — the thrower is the one that knows why.
   */
  apiKey?: string | (() => string)
  /** Provider-specific headers, e.g. Azure's `api-key`. */
  headers?: Record<string, string>
  /**
   * Which request shape this endpoint speaks. `chat` — the default — is
   * `POST …/chat/completions` with `messages`, which every row but one uses.
   *
   * `responses` is OpenAI's Responses API, and it is here for exactly one
   * reason: it is what `https://chatgpt.com/backend-api/codex` accepts. It is a
   * different body and a different reply, not a header difference, which is why
   * it is a field rather than something the adapter could sniff.
   */
  dialect?: 'chat' | 'responses'
}

/**
 * Everything a reader may look at.
 *
 * One object rather than two positional arguments, so a caller cannot pass the
 * environment where the vault was meant: that mistake would typecheck, and its
 * symptom would be a key entered in Réglages that saves and never takes effect.
 */
export interface LlmCredentialSource {
  /** Provider id → key, from `SecretVault`. The supported path. */
  stored?: Readonly<Record<string, string>>
  /**
   * Provider id → field key → value, from the settings store (DEC-34). The URL
   * of a self-hosted server, an Azure deployment name: everything a provider
   * needs that is not a secret and therefore has no business in a keychain.
   */
  fields?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Development override only. Defaults to the real environment. */
  env?: NodeJS.ProcessEnv
}

type Resolved = Required<LlmCredentialSource>

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim()
  return text ? text : undefined
}

/** The vault wins; the environment is the fallback underneath it. */
const keyFor = (providerId: string, source: Resolved, envVar: string): string | undefined =>
  trimmed(source.stored[providerId]) ?? trimmed(source.env[envVar])

/**
 * The settings store wins; the environment is the fallback underneath it.
 *
 * Same order as `keyFor`, and for the same reason: what a rep typed on screen
 * must beat a variable they cannot see. The alternative — environment first —
 * produces a field that saves, displays its new value, and changes nothing.
 */
const fieldFor = (
  providerId: string,
  source: Resolved,
  key: string,
  envVar: string,
): string | undefined => trimmed(source.fields[providerId]?.[key]) ?? trimmed(source.env[envVar])

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

/**
 * The self-hosted row (HR-5).
 *
 * Only a base URL is required. `SILLAGE_LLM_LOCAL_MODEL` defaults to nothing
 * rather than to a guess: Ollama, vLLM and LM Studio all reject an unknown model
 * name, and a wrong default fails at the first extraction with a 404 that looks
 * like an outage. An unset model is a configuration gap, and it reads as one.
 */
const localEndpoint = (source: Resolved): LlmEndpointConfig | null => {
  const baseUrl = fieldFor('local-openai', source, 'url', 'SILLAGE_LLM_LOCAL_URL')
  const model = fieldFor('local-openai', source, 'model', 'SILLAGE_LLM_LOCAL_MODEL')
  if (!baseUrl || !model) return null
  const apiKey = keyFor('local-openai', source, 'SILLAGE_LLM_LOCAL_API_KEY')
  return {
    providerId: 'local-openai',
    chatUrl: `${stripTrailingSlash(baseUrl)}/chat/completions`,
    model,
    ...(apiKey ? { apiKey } : {}),
  }
}

/**
 * The ChatGPT subscription, over the grant `codex login` left on disk (DEC-36).
 *
 * The only row whose credential is a **function**. The grant is rotated in place
 * by a program this app does not control, roughly every ten days, and a token
 * captured when the endpoint was built would expire in the middle of whichever
 * meeting happened to fall on the wrong afternoon. Re-reading per request is
 * what makes that rotation invisible.
 *
 * `accountId` is captured once, and that is not an inconsistency: it identifies
 * the ChatGPT account, not the session, and it does not change when the token
 * does.
 */
const chatgptEndpoint = (source: Resolved): LlmEndpointConfig | null => {
  const path = codexAuthPath(source.env)
  const result = readCodexGrant({ path })
  if (!result.ok) return null
  return {
    providerId: 'chatgpt',
    chatUrl: `${CHATGPT_BASE_URL}/responses`,
    // Codex's own choice ahead of ours: it is the one already known to be
    // served to this account.
    model:
      fieldFor('chatgpt', source, 'model', 'SILLAGE_CHATGPT_MODEL') ??
      codexModel({ path: codexConfigPath(source.env) }) ??
      DEFAULT_CHATGPT_MODEL,
    apiKey: () => {
      const fresh = readCodexGrant({ path })
      // Thrown, not swallowed to an empty string: an expired grant must reach
      // the health rail as `auth` with the sentence naming `codex login`, and a
      // request sent with no Authorization header would arrive there as an
      // anonymous 401 instead.
      if (!fresh.ok) throw new Error(fresh.reason)
      return fresh.grant.accessToken
    },
    headers: chatGptHeaders(result.grant.accountId),
    dialect: 'responses',
  }
}

const mistralEndpoint = (source: Resolved): LlmEndpointConfig | null => {
  const { env } = source
  const apiKey = keyFor('mistral', source, 'SILLAGE_MISTRAL_API_KEY')
  if (!apiKey) return null
  const base = stripTrailingSlash(trimmed(env.SILLAGE_MISTRAL_URL) ?? 'https://api.mistral.ai/v1')
  return {
    providerId: 'mistral',
    chatUrl: `${base}/chat/completions`,
    model: trimmed(env.SILLAGE_MISTRAL_MODEL) ?? 'mistral-large-latest',
    apiKey,
  }
}

/**
 * Azure OpenAI. The endpoint host is **required and never defaulted**.
 *
 * The endpoint host *is* the deployment region, so it cannot be something this
 * file guesses. A default host would silently pick a region on behalf of an
 * operator who has a contract about exactly that.
 */
const azureEndpoint = (source: Resolved): LlmEndpointConfig | null => {
  const { env } = source
  const host = fieldFor('azure-openai', source, 'endpoint', 'SILLAGE_AZURE_OPENAI_ENDPOINT')
  const deployment = fieldFor(
    'azure-openai',
    source,
    'deployment',
    'SILLAGE_AZURE_OPENAI_DEPLOYMENT',
  )
  const apiKey = keyFor('azure-openai', source, 'SILLAGE_AZURE_OPENAI_API_KEY')
  if (!host || !deployment || !apiKey) return null
  const version = trimmed(env.SILLAGE_AZURE_OPENAI_API_VERSION) ?? '2024-10-21'
  return {
    providerId: 'azure-openai',
    // Azure's OpenAI-compatible surface lives under the deployment, and the API
    // version rides in the query string rather than a header.
    chatUrl:
      `${stripTrailingSlash(host)}/openai/deployments/${deployment}` +
      `/chat/completions?api-version=${version}`,
    model: deployment,
    // Azure authenticates with `api-key`, not a bearer token. Both are sent
    // rather than branching in the adapter: an endpoint fronted by APIM often
    // wants the bearer form.
    apiKey,
    headers: { 'api-key': apiKey },
  }
}

const simpleEndpoint = (
  providerId: string,
  keyVar: string,
  defaultUrl: string,
  defaultModel: string,
  modelVar: string,
) => (source: Resolved): LlmEndpointConfig | null => {
  const apiKey = keyFor(providerId, source, keyVar)
  if (!apiKey) return null
  return {
    providerId,
    chatUrl: `${defaultUrl}/chat/completions`,
    model: trimmed(source.env[modelVar]) ?? defaultModel,
    apiKey,
  }
}

/**
 * Every provider's reader, keyed by the registry id.
 *
 * Anthropic is present and deliberately unreadable through this table: its API
 * is not OpenAI-compatible, so a key alone would not make it callable. It stays
 * in the table and `configuredLlmProviders` never reports it — which is honest,
 * rather than reporting it and failing at the first request.
 */
const READERS: Record<string, (source: Resolved) => LlmEndpointConfig | null> = {
  chatgpt: chatgptEndpoint,
  'local-openai': localEndpoint,
  'mistral': mistralEndpoint,
  'azure-openai': azureEndpoint,
  openai: simpleEndpoint(
    'openai',
    'SILLAGE_OPENAI_API_KEY',
    'https://api.openai.com/v1',
    'gpt-4o-mini',
    'SILLAGE_OPENAI_MODEL',
  ),
  groq: simpleEndpoint(
    'groq',
    'SILLAGE_GROQ_API_KEY',
    'https://api.groq.com/openai/v1',
    'llama-3.3-70b-versatile',
    'SILLAGE_GROQ_MODEL',
  ),
}

const filled = (source: LlmCredentialSource = {}): Resolved => ({
  stored: source.stored ?? {},
  fields: source.fields ?? {},
  env: source.env ?? process.env,
})

/** The endpoint for one provider, or null when it is not configured. */
export const llmEndpointFor = (
  providerId: string,
  source: LlmCredentialSource = {},
): LlmEndpointConfig | null => READERS[providerId]?.(filled(source)) ?? null

/**
 * The ids to hand `selectLlm({ configured })`.
 *
 * Ordered by the registry table rather than by `Object.keys`, so the list a
 * settings screen renders matches the list the selector ranks.
 */
export const configuredLlmProviders = (source: LlmCredentialSource = {}): string[] => {
  const resolved = filled(source)
  return LLM_PROVIDERS.filter(
    (p: LlmProviderDescriptor) => READERS[p.id]?.(resolved) != null,
  ).map((p) => p.id)
}

/**
 * Why a row is not configured, where this module knows something better than
 * « aucune clé enregistrée ».
 *
 * `providerRows` derives its refusal from the *tier*, which is right for every
 * row that is waiting for a key and wrong for the one that is not. « aucune clé
 * enregistrée » next to a provider that has no key field is a sentence a rep
 * cannot act on — and the four things that can be wrong with a Codex grant have
 * four different remedies, only one of which is running `codex login`.
 *
 * Empty when everything that could be configured is: a reason for a row that is
 * working would be rendered by nothing and would rot unnoticed.
 */
export const llmRefusalReasons = (
  source: LlmCredentialSource = {},
): Readonly<Record<string, string>> => {
  const grant = readCodexGrant({ path: codexAuthPath(filled(source).env) })
  return grant.ok ? {} : { chatgpt: grant.reason }
}
