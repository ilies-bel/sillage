/**
 * The signal rail's producer (DEC-14, VISION.md §5).
 *
 * Final transcript segments in, `Signal`s out, roughly one cheap model call per
 * minute. Its whole job is proof of value to the rep during the call, and
 * nothing more.
 *
 * ## What it cannot do
 *
 * There is no method here that writes anything. It takes a callback that
 * receives `Signal`s and it holds no reference to a document, an editor, a
 * ProseMirror anything — DEC-5 and DEC-14 say the rep's document is never
 * written by AI during a call, and the way to keep that true is to build the
 * producer with no path to it. `__tests__/surface.test.ts` asserts the public
 * surface stays that small.
 *
 * ## What it must never do
 *
 * Break a meeting. Capture has zero network dependencies (DEC-26) and this is
 * about as far downstream as anything gets: every model failure is swallowed
 * into a diagnostic and the next chunk is attempted. A failed chunk is *not*
 * retried — the minute that just happened is worth less than the one about to,
 * and a retry queue behind a provider that has stopped answering is how the
 * rail ends up a minute behind the call.
 *
 * ## Why `structured` and not `complete`
 *
 * `core/contracts/llm.ts` points the rail at `complete` for latency. It is
 * called with `structured` anyway, held to `SignalReplySchema`: a reply this
 * small is not slower for being schema-held, and the alternative is parsing
 * prose — a guess rendered as a fact, on a surface with no room for a caveat.
 * Latency is defended by `SIGNAL_TIMEOUT_MS` instead, which is the honest lever.
 */
import { randomUUID } from 'node:crypto'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { LlmPort } from '../../core/contracts/llm.ts'
import type { Signal } from '../../core/contracts/signals.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'
import { isCitable, renderChunk, shouldFlush } from './chunking.ts'
import {
  SIGNAL_INSTRUCTIONS,
  SIGNAL_SCHEMA_NAME,
  SignalReplySchema,
  type SignalReply,
} from './prompt.ts'
import { dedupKey, toSignals } from './toSignals.ts'

/**
 * A hard deadline, and a short one. The rail is a side surface the rep glances
 * at; a chip that lands three minutes after the sentence is noise, so a slow
 * answer is a wrong answer and is better abandoned than awaited.
 */
export const SIGNAL_TIMEOUT_MS = 8_000

/** Six short French labels and their quotes. Anything longer is not a chip. */
export const SIGNAL_MAX_OUTPUT_TOKENS = 400

export interface SignalExtractorDeps {
  llm: LlmPort
  /** Where a verified, deduplicated chip goes. The only output of this module. */
  onSignal: (signal: Signal) => void
  diagnostics?: DiagRecorder
  clock?: () => number
  /** Injected in tests; ids are otherwise random and the suite stays honest. */
  newId?: (seq: number) => string
  /**
   * Chips already on the rail, from a replayed log. Seeds both the dedup set
   * and the next `seq`, so a resumed session neither restarts numbering nor
   * re-announces a fact the rep has already seen.
   */
  existing?: readonly Signal[]
}

export class SignalExtractor {
  #llm: LlmPort
  #onSignal: (signal: Signal) => void
  #diagnostics: DiagRecorder
  #clock: () => number
  #newId: (seq: number) => string

  /** Not yet sent to a model. */
  #pending: TranscriptSegment[] = []
  /** The whole meeting so far — a quote is verified against all of it. */
  #transcript: TranscriptSegment[] = []
  #seen = new Set<string>()
  #nextSeq = 0
  #inFlight: Promise<void> | null = null
  #abort: AbortController | null = null
  #stopped = false

  constructor(deps: SignalExtractorDeps) {
    this.#llm = deps.llm
    this.#onSignal = deps.onSignal
    this.#diagnostics = deps.diagnostics ?? NULL_RECORDER
    this.#clock = deps.clock ?? Date.now
    this.#newId = deps.newId ?? (() => randomUUID())

    for (const signal of deps.existing ?? []) {
      this.#seen.add(dedupKey(signal.kind, signal.label))
      this.#nextSeq = Math.max(this.#nextSeq, signal.seq + 1)
    }
  }

  /**
   * Accepts one transcript segment. Never throws, never blocks.
   *
   * Interim segments are ignored outright: a citation must point at something
   * the provider has committed to (DEC-21), and a chip built on text that is
   * revised away a second later cannot be unshown.
   */
  push(segment: TranscriptSegment): void {
    if (this.#stopped || !isCitable(segment)) return

    this.#transcript.push(segment)
    this.#pending.push(segment)

    // One call at a time. While it is out, segments keep accumulating and the
    // boundary is re-tested when it lands — two overlapping calls would race
    // for the same `seq` and duplicate the chunk's chips.
    if (this.#inFlight === null && shouldFlush(this.#pending)) this.#flush()
  }

  /** Resolves when no model call is outstanding. For tests and for shutdown. */
  async idle(): Promise<void> {
    while (this.#inFlight !== null) await this.#inFlight
  }

  /**
   * Stops producing. Aborts an in-flight call rather than waiting for it — the
   * meeting is over and its answer has nowhere to go.
   */
  stop(): void {
    this.#stopped = true
    this.#pending = []
    this.#abort?.abort()
  }

  #flush(): void {
    const chunk = this.#pending
    this.#pending = []
    const transcript = [...this.#transcript]

    this.#inFlight = this.#run(chunk, transcript).then(() => {
      this.#inFlight = null
      if (!this.#stopped && shouldFlush(this.#pending)) this.#flush()
    })
  }

  /** Swallows everything. Nothing in here may throw into the session (DEC-26). */
  async #run(
    chunk: readonly TranscriptSegment[],
    transcript: readonly TranscriptSegment[],
  ): Promise<void> {
    const controller = new AbortController()
    this.#abort = controller

    try {
      const reply = await this.#llm.structured<SignalReply>({
        instructions: SIGNAL_INSTRUCTIONS,
        input: renderChunk(chunk),
        schema: SignalReplySchema,
        schemaName: SIGNAL_SCHEMA_NAME,
        maxOutputTokens: SIGNAL_MAX_OUTPUT_TOKENS,
        timeoutMs: SIGNAL_TIMEOUT_MS,
        signal: controller.signal,
      })
      if (this.#stopped) return

      const result = toSignals({
        reply,
        segments: transcript,
        seen: this.#seen,
        nextSeq: this.#nextSeq,
        createdAt: this.#clock(),
        id: this.#newId,
      })

      for (const signal of result.signals) {
        this.#seen.add(dedupKey(signal.kind, signal.label))
        this.#nextSeq = signal.seq + 1
        this.#onSignal(signal)
      }

      if (result.unverified > 0) {
        // Not an error — a cheap model paraphrasing is expected, and the chips
        // were dropped exactly as DEC-21 requires. It is recorded because a
        // *rate* of it is the symptom of a prompt or a provider going wrong.
        this.#diagnostics.record({
          severity: 'warn',
          code: 'signals.span.unverified',
          module: 'signals',
          message: 'citation introuvable dans la transcription — signal ignoré',
          detail: { dropped: result.unverified, kept: result.signals.length },
        })
      }
    } catch (error) {
      this.#diagnostics.record({
        severity: 'warn',
        code: 'signals.chunk.failed',
        module: 'signals',
        message: error instanceof Error ? error.message : String(error),
        detail: { segments: chunk.length },
      })
    } finally {
      this.#abort = null
    }
  }
}
