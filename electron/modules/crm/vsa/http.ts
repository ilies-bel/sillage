/**
 * The HTTP edge of VerySwing, and the session that keeps a bearer token alive.
 *
 * Same shape and the same reasoning as `modules/calendar/graph.ts`: the point of
 * the file is the error mapping. VSA answers 401 when the token has expired *and*
 * when the credentials are wrong, and those two need opposite things from the
 * app — one is fixed by re-logging in silently, the other by a human editing
 * Réglages. Collapsing them into `throw new Error` is how a connector ends up
 * permanently `down` because a JWT aged out mid-demo.
 *
 * There is no refresh endpoint (`docs/reference/vsa-api.md`): re-login is the
 * refresh, and `VsaSession` does it once per request at most.
 */
import type { Login, LoginResponse } from './generated/schemas.ts'

export class VsaError extends Error {
  readonly status: number
  /** Worth trying the same request again, unchanged. */
  readonly retryable: boolean
  /** The server said how long to wait, in ms. Null when it did not. */
  readonly retryAfterMs: number | null
  /**
   * The credentials themselves are the problem. Distinct from a stale token,
   * which `VsaSession` handles without anyone hearing about it — by the time
   * this is true, re-login has already been tried and refused.
   */
  readonly badCredentials: boolean
  /** The endpoint is not on this tenant. Read by `probe.ts` as a capability gap. */
  readonly notFound: boolean

  constructor(input: {
    status: number
    message: string
    retryable: boolean
    retryAfterMs?: number | null
    badCredentials?: boolean
    notFound?: boolean
  }) {
    super(input.message)
    this.name = 'VsaError'
    this.status = input.status
    this.retryable = input.retryable
    this.retryAfterMs = input.retryAfterMs ?? null
    this.badCredentials = input.badCredentials ?? false
    this.notFound = input.notFound ?? false
  }
}

/** Injectable so the whole adapter runs in a test with no network. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

const retryAfterOf = (headers: { get(name: string): string | null }): number | null => {
  const raw = headers.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** VSA's error body, when it has one worth quoting. */
const messageOf = (body: string, status: number): string => {
  try {
    const parsed: unknown = JSON.parse(body)
    const record = parsed as { message?: unknown; error?: unknown }
    for (const candidate of [record?.message, record?.error]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  } catch {
    /* not JSON — the status line is all there is */
  }
  return `VerySwing a répondu ${status}`
}

export const vsaError = (status: number, body: string): VsaError =>
  new VsaError({
    status,
    message: messageOf(body, status),
    // 429 and 5xx are weather. A 4xx we caused is not, and retrying it forever
    // is how an outbox jams (`core/contracts/push.ts`).
    retryable: status === 429 || status >= 500,
    retryAfterMs: null,
    notFound: status === 404,
  })

export interface VsaRequest {
  operationPath: string
  method: 'GET' | 'POST'
  /** Replaces `{id}` / `{code}` placeholders. Values are URL-encoded here. */
  params?: Record<string, string>
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** For `POST /v1/media/upload`, which takes bytes rather than JSON. */
  raw?: { contentType: string; content: string; disposition?: string }
}

export const urlFor = (baseUrl: string, request: VsaRequest): string => {
  const path = request.operationPath.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = request.params?.[name]
    if (value === undefined) throw new VsaError({ status: 0, message: `paramètre ${name} manquant`, retryable: false })
    return encodeURIComponent(value)
  })
  const query = Object.entries(request.query ?? {}).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '',
  )
  const search = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  return `${baseUrl}${path}${search ? `?${search}` : ''}`
}

/**
 * One authenticated VSA session: logs in on demand, retries exactly once when a
 * token is refused, and never retries a refusal of the credentials themselves.
 *
 * "Exactly once" matters more than it looks. `POST /v1/crm/tasks` has no
 * idempotency key, so a blind retry loop around a write is a duplicate
 * compte-rendu in the client's CRM. The retry here fires only on a 401 — the
 * one status that means the request was rejected before it did anything.
 */
export class VsaSession {
  #baseUrl: string
  #credentials: Login
  #fetch: FetchLike
  #token: string | null = null

  constructor(options: { baseUrl: string; credentials: Login; fetch: FetchLike }) {
    this.#baseUrl = options.baseUrl
    this.#credentials = options.credentials
    this.#fetch = options.fetch
  }

  /** Exposed so `probe.ts` can report whether the tenant even authenticates. */
  async token(): Promise<string> {
    if (this.#token) return this.#token
    const response = await this.#fetch(`${this.#baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(this.#credentials),
    })
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      throw new VsaError({
        status: response.status,
        message:
          response.status === 401 || response.status === 403
            ? 'identifiants VerySwing refusés'
            : messageOf(body, response.status),
        // A refused login is not weather. Retrying it locks the account.
        retryable: response.status >= 500,
        badCredentials: response.status === 401 || response.status === 403,
      })
    }
    const parsed = safeJson(body) as LoginResponse | null
    const token = typeof parsed?.token === 'string' ? parsed.token : ''
    if (!token) {
      throw new VsaError({ status: response.status, message: 'connexion VerySwing sans jeton', retryable: false })
    }
    this.#token = token
    return token
  }

  /** Forces the next request to log in again. Called on a 401, and by reconnect. */
  forget(): void {
    this.#token = null
  }

  async request(request: VsaRequest): Promise<unknown> {
    const first = await this.#send(request)
    if (first.status !== 401) return this.#settle(first, request)

    // The token aged out. Re-login and replay once — the request was refused
    // before it reached the resource, so replaying it cannot duplicate a write.
    this.forget()
    const second = await this.#send(request)
    if (second.status === 401) {
      const body = await second.text().catch(() => '')
      throw new VsaError({
        status: 401,
        message: messageOf(body, 401) === 'VerySwing a répondu 401' ? 'session VerySwing refusée' : messageOf(body, 401),
        retryable: false,
        badCredentials: true,
      })
    }
    return this.#settle(second, request)
  }

  async #send(request: VsaRequest): Promise<Awaited<ReturnType<FetchLike>>> {
    const token = await this.token()
    const url = urlFor(this.#baseUrl, request)
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    if (request.raw) {
      headers['Content-Type'] = request.raw.contentType
      if (request.raw.disposition) headers['Content-Disposition'] = request.raw.disposition
      return this.#fetch(url, { method: request.method, headers, body: request.raw.content })
    }
    if (request.body !== undefined) headers['Content-Type'] = 'application/json'
    return this.#fetch(url, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    })
  }

  async #settle(
    response: Awaited<ReturnType<FetchLike>>,
    request: VsaRequest,
  ): Promise<unknown> {
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      const error = vsaError(response.status, body)
      throw new VsaError({
        status: error.status,
        message: `${error.message} (${request.method} ${request.operationPath})`,
        retryable: error.retryable,
        retryAfterMs: retryAfterOf(response.headers),
        notFound: error.notFound,
      })
    }
    if (!body) return {}
    const parsed = safeJson(body)
    if (parsed === null) {
      throw new VsaError({ status: response.status, message: 'réponse VerySwing illisible', retryable: false })
    }
    return parsed
  }
}

const safeJson = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
