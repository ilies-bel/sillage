/**
 * The HTTP edge of Microsoft Graph. One verb, because this module only reads.
 *
 * The point of the file is the error mapping. Graph answers a dozen ways and
 * three of them mean very different things to the app: 401 means the token is
 * finished and a human has to act, 429 means slow down and try the same request
 * again, 5xx means try again later. Collapsing those into `throw new Error` is
 * how a connector ends up permanently `down` because of one throttled request.
 */

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

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

/** Injectable so the whole sync path runs in a test with no network. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
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

export interface GraphGetOptions {
  token: string
  fetch: FetchLike
  headers?: Record<string, string>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const graphGet = async (url: string, options: GraphGetOptions): Promise<any> => {
  const response = await options.fetch(url, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
      ...options.headers,
    },
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
    throw new GraphError({ status: response.status, message: 'réponse Graph illisible', retryable: false })
  }
}
