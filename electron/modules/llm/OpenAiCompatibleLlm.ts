/**
 * One adapter, four servers.
 *
 * Ollama, vLLM, LM Studio and every EU-hosted endpoint in the registry speak the
 * same `POST …/chat/completions` dialect, so HR-5's "BYOK plus a self-hosted
 * option" costs one class rather than two. What differs between them —
 * the URL, the auth header, the model name, whether a JSON schema can be
 * enforced — arrives as `LlmEndpointConfig` from `config.ts` and a boolean from
 * the registry descriptor. None of it is branched on here.
 *
 * `fetch` is injected, exactly as `RestSttSession` injects its upload: every
 * behaviour worth pinning in this file — that a 401 is not retryable, that a
 * timeout is, that a reply which does not match the caller's schema throws
 * rather than returning `{}` — is a behaviour, and behaviours are only checkable
 * if the transport can be replaced.
 */
import { z } from 'zod'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import {
  LlmError,
  LlmSchemaError,
} from '../../core/contracts/llm.ts'
import type { LlmPort, LlmRequest, LlmStructuredRequest } from '../../core/contracts/llm.ts'
import type { LlmEndpointConfig } from './config.ts'

/** The slice of `fetch` this adapter uses. Same shape as `modules/calendar`'s. */
export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  },
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

/**
 * Short enough that a dead provider cannot hold up the signal rail for longer
 * than the interval between two of its own calls (~1/minute, DEC-14).
 */
export const DEFAULT_COMPLETE_TIMEOUT_MS = 12_000
/** The end-of-meeting extraction. One call, and it is allowed to think. */
export const DEFAULT_STRUCTURED_TIMEOUT_MS = 120_000
const DEFAULT_COMPLETE_TOKENS = 256
const DEFAULT_STRUCTURED_TOKENS = 4_096
/** Enough of the bad reply to recognise it in a diagnostic, not enough to be a transcript. */
const RAW_EXCERPT = 2_000

export interface OpenAiCompatibleOptions {
  endpoint: LlmEndpointConfig
  /**
   * From the registry descriptor, never assumed. True asks the server to
   * enforce the schema; false asks for JSON in the prompt and revalidates.
   * Either way the caller's schema is what decides (DEC-7).
   */
  structuredOutput?: boolean
  fetch?: FetchLike
  diagnostics?: DiagRecorder
}

export class OpenAiCompatibleLlm implements LlmPort {
  readonly providerId: string

  #endpoint: LlmEndpointConfig
  #dialect: 'chat' | 'responses'
  #structuredOutput: boolean
  #fetch: FetchLike
  #diagnostics: DiagRecorder

  constructor(options: OpenAiCompatibleOptions) {
    this.#endpoint = options.endpoint
    this.providerId = options.endpoint.providerId
    this.#dialect = options.endpoint.dialect ?? 'chat'
    this.#structuredOutput = options.structuredOutput ?? false
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
  }

  /**
   * The bearer credential for *this* request.
   *
   * A resolver that throws is the ChatGPT row saying its grant expired, and that
   * is an auth failure in every sense the UI cares about: not retryable, and the
   * remedy is a command the rep runs, not a button. Letting the raw throw escape
   * would surface it as an unknown crash in the middle of an extraction.
   */
  #credential(): string | undefined {
    const source = this.#endpoint.apiKey
    if (typeof source !== 'function') return source
    try {
      return source()
    } catch (error) {
      throw new LlmError({
        kind: 'auth',
        message: error instanceof Error ? error.message : 'identifiant du modèle indisponible',
        retryable: false,
        cause: error,
      })
    }
  }

  async complete(request: LlmRequest): Promise<string> {
    const text = await this.#chat(request, {
      timeoutMs: request.timeoutMs ?? DEFAULT_COMPLETE_TIMEOUT_MS,
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_COMPLETE_TOKENS,
    })
    const trimmed = text.trim()
    if (!trimmed) {
      throw new LlmError({ kind: 'unknown', message: 'réponse vide du modèle', retryable: true })
    }
    return trimmed
  }

  /**
   * The reply is parsed and revalidated **whatever the server promised**.
   *
   * A server that advertises schema enforcement still returns prose when it hits
   * its token ceiling mid-object, and a truncated JSON object is the single most
   * likely bad reply here — the extraction is the longest output the app ever
   * asks for. Trusting `response_format` and skipping the check is how a
   * compte-rendu ends up half-empty with nothing logged.
   */
  async structured<T>(request: LlmStructuredRequest<T>): Promise<T> {
    const jsonSchema = this.#structuredOutput ? toJsonSchema(request.schema) : null
    const name = request.schemaName ?? 'extraction'
    // The same two modes in each dialect's own spelling. `json_schema` is nested
    // under `json_schema` in the chat body and flat in the Responses body; a
    // shape sent to the wrong one is a 400 that reads like a bad schema.
    const responseFormat =
      this.#dialect === 'responses'
        ? jsonSchema
          ? { type: 'json_schema', name, strict: true, schema: jsonSchema }
          : { type: 'json_object' }
        : jsonSchema
          ? { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } }
          : { type: 'json_object' }

    const raw = await this.#chat(request, {
      timeoutMs: request.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS,
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_STRUCTURED_TOKENS,
      responseFormat,
      // Servers without native enforcement need to be told, and the word "JSON"
      // has to appear in the prompt for `json_object` mode to be accepted at all
      // on several of them.
      ...(jsonSchema ? {} : { jsonNudge: true }),
    })

    const candidate = jsonText(raw)
    if (!candidate) {
      throw new LlmSchemaError({
        message: 'le modèle n’a pas renvoyé de JSON',
        issues: [],
        raw: raw.slice(0, RAW_EXCERPT),
      })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch (error) {
      throw new LlmSchemaError({
        message: 'JSON invalide dans la réponse du modèle',
        issues: [error instanceof Error ? error.message : String(error)],
        raw: candidate.slice(0, RAW_EXCERPT),
      })
    }

    const result = request.schema.safeParse(parsed)
    if (!result.success) {
      // Named fields, not a count. The likeliest cause is a model inventing a
      // field `LlmInterpretation` deliberately does not have (DEC-7), and the
      // path is what says so.
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(racine)'}: ${issue.message}`,
      )
      this.#diagnostics.record({
        severity: 'error',
        code: 'llm.schema.rejected',
        module: 'llm',
        message: issues.slice(0, 5).join(' | '),
        detail: { provider: this.providerId, issues: issues.length },
      })
      throw new LlmSchemaError({
        message: 'la réponse du modèle ne correspond pas au format attendu',
        issues,
        raw: candidate.slice(0, RAW_EXCERPT),
      })
    }
    return result.data
  }

  async #chat(
    request: LlmRequest,
    options: {
      timeoutMs: number
      maxOutputTokens: number
      responseFormat?: unknown
      jsonNudge?: boolean
    },
  ): Promise<string> {
    const responses = this.#dialect === 'responses'
    const nudge = 'Réponds uniquement avec un objet JSON valide, sans texte autour.'

    /*
     * Which half of the request the nudge goes in, and why it is not a style
     * choice.
     *
     * `json_object` mode is refused unless the word "json" appears in the
     * prompt, and the two dialects disagree about where it has to be. The
     * ChatGPT endpoint checks the *input* — « Response input messages must
     * contain the word 'json' in some form » — so a nudge appended to
     * `instructions` there is a 400 rather than a hint. In the chat dialect the
     * system message counts and the input is the transcript, which is the last
     * place to put an instruction.
     */
    const instructions =
      options.jsonNudge && !responses ? `${request.instructions}\n\n${nudge}` : request.instructions
    const input = options.jsonNudge && responses ? `${request.input}\n\n${nudge}` : request.input
    const body = JSON.stringify(
      responses
        ? {
            model: this.#endpoint.model,
            instructions,
            input: [{ role: 'user', content: [{ type: 'input_text', text: input }] }],
            /*
             * Three things this body does not say, each one measured against
             * the live endpoint rather than assumed:
             *
             *  · `store` must be present and false — « Store must be set to
             *    false ». Omitting it is a 400, not a default.
             *  · `stream` must be true — « Stream must be set to true ». It is
             *    the only mode served, which is why the reply is parsed as SSE.
             *  · **no `max_output_tokens`** — « Unsupported parameter ». The
             *    ceiling the callers pass is honoured by every other row and
             *    silently dropped here, which is the right way round: the
             *    alternative is a 400 on every single call.
             *
             * `temperature` is absent for the same reason it is 0 elsewhere —
             * this endpoint fixes it, and sending it is one more parameter to
             * be refused for no gain.
             */
            store: false,
            stream: true,
            ...(options.responseFormat ? { text: { format: options.responseFormat } } : {}),
          }
        : {
            model: this.#endpoint.model,
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: input },
            ],
            // Deterministic by default. The extraction is evidence about a client
            // call, not a creative task, and a rerun that produces different numbers
            // is unarguable with.
            temperature: 0,
            max_tokens: options.maxOutputTokens,
            stream: false,
            ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
          },
    )

    const credential = this.#credential()
    const deadline = withDeadline(options.timeoutMs, request.signal)
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.#fetch(this.#endpoint.chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The stream is consumed whole rather than incrementally — nothing in
          // this app renders a partial completion — but the endpoint still has to
          // be told which encoding it may answer in.
          Accept: responses ? 'text/event-stream' : 'application/json',
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          ...this.#endpoint.headers,
        },
        body,
        signal: deadline.signal,
      })
    } catch (error) {
      // An abort we caused is a timeout; an abort the caller caused is a
      // cancellation and must not be reported as a provider failure.
      if (deadline.expired) {
        throw new LlmError({
          kind: 'timeout',
          message: `le modèle n’a pas répondu en ${Math.round(options.timeoutMs / 1000)} s`,
          retryable: true,
          cause: error,
        })
      }
      if (request.signal?.aborted) throw error
      throw new LlmError({
        kind: 'network',
        message: 'fournisseur de modèle injoignable',
        retryable: true,
        cause: error,
      })
    } finally {
      deadline.dispose()
    }

    if (!response.ok) throw await this.#httpError(response)
    const text = await response.text()
    return responses ? responseTextOf(text) : contentOf(text)
  }

  async #httpError(response: Awaited<ReturnType<FetchLike>>): Promise<LlmError> {
    const body = await response.text().catch(() => '')
    const detail = messageOf(body)
    const status = response.status

    // The one split that matters to the UI: a key nobody fixed is not fixed by
    // a retry, and the button that offers one is dead (DEC-26).
    if (status === 401 || status === 403) {
      return new LlmError({
        kind: 'auth',
        message: `clé API du modèle refusée${detail ? ` — ${detail}` : ''}`,
        retryable: false,
        status,
      })
    }
    if (status === 429) {
      return new LlmError({
        kind: 'quota',
        message: `quota du fournisseur de modèle atteint${detail ? ` — ${detail}` : ''}`,
        retryable: true,
        status,
      })
    }
    if (status >= 500) {
      return new LlmError({
        kind: 'server',
        message: `le fournisseur de modèle a répondu ${status}`,
        retryable: true,
        status,
      })
    }
    // Any other 4xx is our request: a model name that does not exist on this
    // server, a context overflow, a schema the server refuses. Retrying it
    // unchanged reproduces it.
    return new LlmError({
      kind: 'unknown',
      message: detail || `le fournisseur de modèle a répondu ${status}`,
      retryable: false,
      status,
    })
  }
}

/**
 * A deadline that can tell a timeout from a cancellation.
 *
 * `AbortSignal` alone cannot: both arrive at `fetch` as the same abort, and
 * reporting the rep closing a meeting as "le modèle n'a pas répondu" would put
 * a false degradation in the health rail.
 */
const withDeadline = (
  timeoutMs: number,
  caller: AbortSignal | undefined,
): { signal: AbortSignal; expired: boolean; dispose: () => void } => {
  const controller = new AbortController()
  const state = {
    signal: controller.signal,
    expired: false,
    dispose: () => {
      clearTimeout(timer)
      caller?.removeEventListener('abort', forward)
    },
  }
  const timer = setTimeout(() => {
    state.expired = true
    controller.abort()
  }, timeoutMs)
  const forward = () => controller.abort()
  if (caller?.aborted) controller.abort()
  else caller?.addEventListener('abort', forward)
  return state
}

/**
 * The zod schema as JSON Schema, or null when it cannot be expressed.
 *
 * Null is not a failure: it demotes the call to `json_object` plus revalidation,
 * which is the same guarantee by a slower route. Throwing here would make an
 * exotic schema — a refinement, a transform — an outage.
 */
export const toJsonSchema = (schema: z.ZodType<unknown>): unknown => {
  try {
    return z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })
  } catch {
    return null
  }
}

/** `choices[0].message.content`, defensively. */
export const contentOf = (body: string): string => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new LlmError({
      kind: 'unknown',
      message: 'réponse illisible du fournisseur de modèle',
      retryable: false,
    })
  }
  const choice = (parsed as { choices?: unknown[] })?.choices?.[0]
  const content = (choice as { message?: { content?: unknown } })?.message?.content
  if (typeof content === 'string') return content
  // Some servers return the content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: unknown })?.text ?? '')))
      .filter((part): part is string => typeof part === 'string')
      .join('')
  }
  return ''
}

/**
 * The text out of a Responses reply, streamed or whole.
 *
 * The ChatGPT endpoint only serves SSE, so the ordinary path is the event
 * stream; the plain-object branch is here because the Responses API *itself*
 * answers with one object when `stream` is false, and a parser that only handled
 * the shape we currently ask for would break the moment someone pointed this
 * dialect at `api.openai.com`.
 *
 * The whole body is already in hand — nothing in this app renders a partial
 * completion (DEC-5 puts AI text in the document exactly once, at the end), so
 * there is nothing to gain from consuming it incrementally and a stream reader
 * to maintain if we did.
 */
export const responseTextOf = (body: string): string => {
  const trimmed = body.trim()
  if (!trimmed.startsWith('data:') && !trimmed.startsWith('event:')) {
    return outputTextOf(safeJson(trimmed))
  }

  let deltas = ''
  let final = ''
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    const event = safeJson(payload) as { type?: unknown; delta?: unknown; response?: unknown }
    if (event === null) continue

    // A failure mid-stream arrives as an event with a 200 on the response, so
    // the HTTP status has already said everything is fine. Ignoring it would
    // turn a refused request into an empty completion, which reads as "the
    // model had nothing to say" — the wrong sentence entirely.
    if (event.type === 'error' || event.type === 'response.failed') {
      throw new LlmError({
        kind: 'server',
        message: errorTextOf(event) || 'le fournisseur de modèle a interrompu la réponse',
        retryable: true,
      })
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      deltas += event.delta
    }
    if (event.type === 'response.completed') final = outputTextOf(event.response)
  }

  // Deltas first: they are the whole answer whenever the stream completed
  // normally. The terminal event is the fallback for a server that sends only
  // the finished object, which several Responses-compatible gateways do.
  return deltas || final
}

/** `output[].content[].text`, defensively — the Responses reply shape. */
const outputTextOf = (parsed: unknown): string => {
  const direct = (parsed as { output_text?: unknown })?.output_text
  if (typeof direct === 'string') return direct
  if (Array.isArray(direct)) return direct.filter((part) => typeof part === 'string').join('')

  const output = (parsed as { output?: unknown })?.output
  if (!Array.isArray(output)) return ''
  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown })?.content
      return Array.isArray(content) ? content : []
    })
    .map((part) => {
      const text = (part as { text?: unknown })?.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const errorTextOf = (event: { response?: unknown } & Record<string, unknown>): string => {
  const error =
    (event as { error?: { message?: unknown } }).error ??
    ((event.response as { error?: { message?: unknown } } | undefined)?.error)
  const message = error?.message
  return typeof message === 'string' ? message.trim() : ''
}

/**
 * The JSON object inside a reply, fences and all.
 *
 * Models that were told to answer with JSON still wrap it in ```json more often
 * than not, and a local 7B does it almost always. Stripping the wrapper is not
 * leniency about the schema — the schema check happens afterwards, unchanged.
 */
export const jsonText = (raw: string): string | null => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const text = (fenced?.[1] ?? raw).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

/**
 * The provider's own error prose, when it has any worth quoting.
 *
 * `detail` is the ChatGPT endpoint's field and it is where the only actionable
 * sentence lives — « The 'gpt-5' model is not supported when using Codex with a
 * ChatGPT account » is a complete diagnosis and a complete fix. Reading only
 * `error.message` reduced it to « le fournisseur de modèle a répondu 400 », which
 * is how a wrong model name becomes an afternoon.
 */
const messageOf = (body: string): string => {
  try {
    const parsed: unknown = JSON.parse(body)
    const message =
      (parsed as { error?: { message?: unknown } })?.error?.message ??
      (parsed as { detail?: unknown })?.detail ??
      (parsed as { message?: unknown })?.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  } catch {
    /* not JSON — the status is all there is */
  }
  return ''
}
