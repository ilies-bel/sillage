/**
 * `LlmPort` — what the app asks a language model for, in the app's own words.
 *
 * Two verbs, because there are exactly two jobs and they have opposite budgets:
 *
 *   `complete`    short, cheap, ~1 call per minute *during* a live call
 *                 (`modules/signals/`). Latency is the requirement; a slow
 *                 answer is a wrong answer, because the rail is a side surface
 *                 the rep glances at (DEC-14).
 *   `structured`  one large call at the end (`modules/extract/`), held to a
 *                 schema the caller supplies. Correctness is the requirement.
 *
 * There is no third verb and no streaming verb. Nothing an LLM produces is ever
 * written into the rep's document while the call runs (DEC-5), so there is no
 * surface that would consume tokens as they arrive.
 *
 * **No provider vocabulary lives here.** No `model`, no `messages`, no roles, no
 * `temperature`, no key. Those belong to whichever adapter is wired in — which
 * is the point: swapping Mistral for a local Ollama must not reach past
 * `modules/llm/`.
 */
import type { z } from 'zod'

export interface LlmRequest {
  /**
   * What the model must do. Stable across calls of the same kind, and the place
   * "réponds en français" is stated (HR-6) — the output language is a property
   * of the instruction, never of the provider.
   */
  instructions: string
  /** The material to work on: a transcript excerpt, a chunk, a section. */
  input: string
  /** Upper bound on the reply. Omitted, the adapter picks a sane ceiling. */
  maxOutputTokens?: number
  /**
   * Hard deadline. `complete` is called during a live call, so it must fail
   * fast rather than block the rail behind a provider that has stopped
   * answering.
   */
  timeoutMs?: number
  /** Cancellation, e.g. the meeting ended while a signal call was in flight. */
  signal?: AbortSignal
}

export interface LlmStructuredRequest<T> extends LlmRequest {
  /**
   * The caller owns the shape. The adapter validates against *this* and returns
   * `T`, so a provider that invents a field fails here rather than downstream —
   * which is what makes `LlmInterpretation`'s missing fields load-bearing
   * (DEC-7).
   */
  schema: z.ZodType<T>
  /**
   * A name for the shape. Providers that can be held to a schema natively need
   * one; the others ignore it. Not provider vocabulary — a schema having a name
   * is true of the domain.
   */
  schemaName?: string
}

export interface LlmPort {
  /** Short and fast. Returns the reply text, trimmed. */
  complete(request: LlmRequest): Promise<string>
  /** Large and validated. Returns the parsed value, or throws `LlmSchemaError`. */
  structured<T>(request: LlmStructuredRequest<T>): Promise<T>
}

/**
 * Why the call failed, at the granularity the app can act on.
 *
 * The split that matters is `auth` versus everything else: a wrong key is not
 * fixed by waiting, and offering a retry button for it is the dead affordance
 * DEC-26 forbids.
 */
export type LlmErrorKind =
  | 'auth'
  | 'quota'
  | 'timeout'
  | 'server'
  | 'network'
  /** The reply did not match the caller's schema. Never a silent empty result. */
  | 'schema'
  | 'unknown'

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  /** Worth sending the same request again, unchanged. */
  readonly retryable: boolean
  /** HTTP status when there was one. Null for a transport or schema failure. */
  readonly status: number | null

  constructor(input: {
    kind: LlmErrorKind
    message: string
    retryable: boolean
    status?: number | null
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'LlmError'
    this.kind = input.kind
    this.retryable = input.retryable
    this.status = input.status ?? null
  }
}

/**
 * The reply was not the shape the caller asked for.
 *
 * This is an error and not an empty result on purpose. An extraction that comes
 * back `{}` looks like "the call said nothing quantifiable", which is a real and
 * common outcome; it must not be indistinguishable from "the model returned
 * prose and we threw it away". The raw text is kept so a diagnostic can show
 * what actually came back.
 *
 * Retryable: a regeneration is the natural remedy, and the connector itself is
 * healthy.
 */
export class LlmSchemaError extends LlmError {
  /** Zod's issues, flattened to `path: message`. */
  readonly issues: string[]
  /** What the model actually returned, truncated by the adapter. */
  readonly raw: string

  constructor(input: { message: string; issues: string[]; raw: string }) {
    super({ kind: 'schema', message: input.message, retryable: true })
    this.name = 'LlmSchemaError'
    this.issues = input.issues
    this.raw = input.raw
  }
}
