/**
 * The HTTP edge of Microsoft Graph for mail. **One verb, one URL.**
 *
 * `modules/calendar` has a file of the same shape and this one deliberately
 * does not import it — a module may not import another module, and the
 * duplication is the price of that rule. It buys something here: this copy can
 * be narrower than the general one.
 *
 * Narrower in the way that matters for HR-8. The only URL this module can
 * build is `DRAFTS_URL`, because `draftsUrl()` is the only builder and it takes
 * no arguments. There is no path parameter to concatenate, no template a copied
 * snippet can slip a different segment into, and therefore no way for a request
 * that delivers mail to be constructed from this file. The module creates a
 * draft in the rep's own Drafts folder and stops there (HR-8).
 *
 * And it never names the calendar's own resource: writing to an Outlook event
 * body mails the attendees and destroys the Teams join blob (DEC-10). The
 * calendar module reads events; nothing in the product writes one.
 */

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/** The single resource this module posts to. A POST here creates a draft. */
export const MESSAGES_PATH = '/me/messages'

/** The only URL the module can build. Takes no arguments, on purpose. */
export const draftsUrl = (): string => `${GRAPH_BASE}${MESSAGES_PATH}`

export class GraphError extends Error {
  readonly status: number
  /** Worth trying the same request again, unchanged. */
  readonly retryable: boolean
  /** The server said how long to wait, in ms. Null when it did not. */
  readonly retryAfterMs: number | null
  /** The token is finished; only a sign-in fixes it. */
  readonly needsSignIn: boolean

  constructor(input: {
    status: number
    message: string
    retryable: boolean
    retryAfterMs?: number | null
    needsSignIn?: boolean
  }) {
    super(input.message)
    this.name = 'GraphError'
    this.status = input.status
    this.retryable = input.retryable
    this.retryAfterMs = input.retryAfterMs ?? null
    this.needsSignIn = input.needsSignIn ?? false
  }
}

/**
 * A scope this application must never ask for reached the token request
 * (`FORBIDDEN_SCOPES` in `core/contracts/identity.ts`).
 *
 * Thrown before the network is touched, and thrown rather than returned: it is
 * a programming error, not an outage, and there is no runtime remedy for it.
 */
export class ForbiddenScopeError extends Error {
  readonly scopes: string[]

  constructor(scopes: string[]) {
    super(`autorisation interdite demandée : ${scopes.join(', ')}`)
    this.name = 'ForbiddenScopeError'
    this.scopes = scopes
  }
}

/** Injectable so the whole draft path runs in a test with no network. */
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
  // Graph sends seconds; the HTTP spec also allows a date, which is rare enough
  // here that falling through to "no hint" beats parsing it wrong.
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** Graph's error body, when it has one worth quoting. */
const messageOf = (body: string, status: number): string => {
  try {
    const parsed: unknown = JSON.parse(body)
    const message = (parsed as { error?: { message?: unknown } })?.error?.message
    if (typeof message === 'string' && message.trim()) return message
  } catch {
    /* not JSON — the status line is all there is */
  }
  return `Graph a répondu ${status}`
}

export interface GraphPostOptions {
  token: string
  fetch: FetchLike
  body: unknown
}

/**
 * POSTs JSON to `draftsUrl()`. The URL is not a parameter — see the file
 * header. Returns the parsed response body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const postDraft = async (options: GraphPostOptions): Promise<any> => {
  const response = await options.fetch(draftsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const status = response.status
    throw new GraphError({
      status,
      message: messageOf(body, status),
      retryable: status === 429 || status === 503 || status === 504 || status >= 500,
      retryAfterMs: retryAfterOf(response.headers),
      needsSignIn: status === 401,
    })
  }

  const body = await response.text()
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    // The draft may well exist on the server. Not retryable for exactly that
    // reason: there is no idempotency key on a message create either, and a
    // second POST would leave the rep with two drafts.
    throw new GraphError({ status: response.status, message: 'réponse Graph illisible', retryable: false })
  }
}
