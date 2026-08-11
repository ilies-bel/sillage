/**
 * The ChatGPT subscription grant that `codex login` leaves on disk.
 *
 * This is the app's second real OAuth path, and the only one for OpenAI. The
 * Platform API has none — authentication there *is* the bearer key, and there is
 * no authorization-code flow a third-party desktop app can complete against
 * `api.openai.com`. What does exist is the grant OpenAI's own CLI obtains for a
 * *ChatGPT account* and writes to `~/.codex/auth.json`. Sillage borrows it and
 * calls the same endpoint Codex calls.
 *
 * ## What this deliberately does not do
 *
 * **It does not run the flow itself.** Doing so would mean registering as
 * `codex_cli_rs` — claiming to be a different application to OpenAI's
 * authorization server — and it would put a second copy of a live credential on
 * disk. Borrowing the existing grant asks for nothing that has not already been
 * granted on this machine, by this person, in a program they installed.
 *
 * **It does not refresh, and it never writes.** The file holds a
 * `refresh_token`, and rotating it would be the natural next step and a bad one:
 * refresh tokens rotate on use, so a refresh performed here and not written back
 * invalidates the one Codex holds, and a refresh written back means two programs
 * racing on one file. Codex refreshes it (about every ten days, in place); we
 * re-read. That is why nothing here caches — a long-running Sillage picks up the
 * rotation without a restart, which is the whole benefit of not caching.
 *
 * **Never log the token.** It is a live credential for an entire ChatGPT
 * account, not a scoped API key, and unlike a key nobody can revoke just this
 * one.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Codex's own endpoint. Responses-shaped, not `chat/completions`-shaped. */
export const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/**
 * The headers this endpoint requires beyond the bearer token.
 *
 * Not politeness — part of the auth. Without `chatgpt-account-id` it rejects an
 * otherwise valid grant, and `originator` is what identifies the traffic as
 * coming from the Codex surface rather than the Platform API.
 */
export const chatGptHeaders = (accountId: string): Record<string, string> => ({
  'chatgpt-account-id': accountId,
  originator: 'codex_cli_rs',
  'OpenAI-Beta': 'responses=experimental',
})

export interface CodexGrant {
  accessToken: string
  accountId: string
  /** Unix seconds from the token's `exp` claim; null when it carries none. */
  expiresAt: number | null
}

/**
 * Read or refused, never thrown.
 *
 * `configuredLlmProviders` asks this question about every provider on every
 * settings read, and an absent grant is the ordinary case, not an error. The
 * reason travels with the refusal because it is what the row renders: « aucune
 * session » and « la session a expiré le 12 août » send a rep to two different
 * places, and only one of them is `codex login`.
 */
export type GrantResult = { ok: true; grant: CodexGrant } | { ok: false; reason: string }

export const codexAuthPath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.SILLAGE_CODEX_AUTH_PATH?.trim() || join(homedir(), '.codex', 'auth.json')

export const codexConfigPath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.SILLAGE_CODEX_CONFIG_PATH?.trim() || join(homedir(), '.codex', 'config.toml')

/**
 * The model name out of `~/.codex/config.toml`, and why this is not a nicety.
 *
 * This endpoint accepts a **short, account-specific** list of names and refuses
 * everything else — `gpt-5`, `gpt-5.1`, `gpt-5-codex`, `gpt-5.1-codex` and
 * `codex-mini-latest` were all answered with *"The 'x' model is not supported
 * when using Codex with a ChatGPT account"*, while the name in this machine's
 * `config.toml` was accepted. The list tracks what OpenAI has rolled out to the
 * account, so a name compiled into this app is wrong for most people on most
 * days. Codex already knows the right one; asking it is the only source here
 * that stays true.
 *
 * **Not a TOML parser, deliberately.** One key is needed, TOML would be a
 * dependency for it, and adding one to read a file another program owns is a
 * cost with no matching benefit. `model` is read from the top-level table only —
 * scanning past a `[profiles.foo]` header would pick up whichever profile
 * happened to come first, which is a name Codex itself is not using.
 */
export const codexModel = (options: {
  path?: string
  readFile?: (path: string) => string
} = {}): string | null => {
  const read = options.readFile ?? ((target: string) => readFileSync(target, 'utf8'))
  let raw: string
  try {
    raw = read(options.path ?? codexConfigPath())
  } catch {
    return null
  }
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (text.startsWith('[')) break
    const match = /^model\s*=\s*["']([^"']+)["']/.exec(text)
    if (match) return match[1]!.trim() || null
  }
  return null
}

/**
 * `exp`, out of the JWT payload, unverified.
 *
 * We are not the audience and hold none of the keys, so there is nothing here to
 * verify against. The claim is read for one purpose: to fail with a sentence
 * naming the fix, rather than letting the endpoint answer 401 in the middle of
 * the one extraction a meeting gets.
 */
const expiryOf = (token: string): number | null => {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const exp = (claims as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export interface ReadGrantOptions {
  path?: string
  /** Injected so the expiry check is a fact about a fixture, not about the clock. */
  now?: number
  readFile?: (path: string) => string
}

export const readCodexGrant = (options: ReadGrantOptions = {}): GrantResult => {
  const path = options.path ?? codexAuthPath()
  const read = options.readFile ?? ((target: string) => readFileSync(target, 'utf8'))

  let raw: string
  try {
    raw = read(path)
  } catch {
    return { ok: false, reason: 'aucune session ChatGPT — exécutez `codex login`' }
  }

  let file: { tokens?: unknown; auth_mode?: unknown; OPENAI_API_KEY?: unknown }
  try {
    file = JSON.parse(raw) as typeof file
  } catch {
    return { ok: false, reason: 'session ChatGPT illisible — exécutez `codex login` à nouveau' }
  }

  const tokens = (file.tokens ?? {}) as { access_token?: unknown; account_id?: unknown }
  const accessToken = asString(tokens.access_token)
  const accountId = asString(tokens.account_id)

  if (!accessToken || !accountId) {
    // The other thing `codex login` can leave here. Distinguishing it matters:
    // the fix is not to log in again, it is to paste that key on the OpenAI row
    // one line up — and telling someone to re-run a command that will reproduce
    // what they already have is the worst kind of accurate message.
    if (asString(file.OPENAI_API_KEY)) {
      return {
        ok: false,
        reason: 'ce compte Codex utilise une clé API — saisissez-la sur la ligne OpenAI',
      }
    }
    return { ok: false, reason: 'session ChatGPT incomplète — exécutez `codex login` à nouveau' }
  }

  const expiresAt = expiryOf(accessToken)
  const now = options.now ?? Date.now()
  if (expiresAt !== null && expiresAt * 1000 <= now) {
    const on = new Date(expiresAt * 1000).toLocaleDateString('fr-FR')
    return { ok: false, reason: `session ChatGPT expirée le ${on} — exécutez \`codex login\`` }
  }

  return { ok: true, grant: { accessToken, accountId, expiresAt } }
}
