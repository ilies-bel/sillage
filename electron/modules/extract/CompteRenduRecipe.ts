/**
 * The compte-rendu recipe (DEC-13, DEC-43). Two declared shapes, no free-text
 * template.
 *
 * Runs once, automatically, when the meeting ends. In goes the transcript, the
 * rep's raw notes and `MeetingContext`; out comes a whole `ExtractionESN` and
 * the French document that lands in the editor as grey text and, on *Valider*,
 * in the CRM task's description.
 *
 * ## What the recipe id changes, and what it does not
 *
 * `input.recipe` selects a *prompt pair and a reply schema* — the map stage's
 * and the reduce stage's — and nothing else. Chunking, the deterministic facts,
 * the leak check, the error kinds and the retry policy are identical for both,
 * because none of them is about what the document looks like. The branch is
 * therefore two `isFreeForm` reads and no second class: a second recipe class
 * would be a second place for the four refusals below to be forgotten, which is
 * exactly how one fixed recipe would have become two divergent ones.
 *
 * ## The four things it refuses to do
 *
 * 1. **Ask a model for deterministic data** (DEC-7). `facts` is built by
 *    `facts.ts` from Graph, in plain code, before any call is made. The reply
 *    schema has no key for a name or an address, and `deterministicLeaks.ts`
 *    covers the prose channel that a schema cannot.
 * 2. **Believe a citation** (DEC-21). Every span is measured by `locateQuote`
 *    against the stored transcript. A quote that will not verify downgrades its
 *    field to `faible`; it never invents a channel or a timing.
 * 3. **Return half an extraction.** Every failure below is an `ExtractionError`
 *    with a kind. A form at the review gate looks complete by construction, so
 *    a compte-rendu missing six minutes of a call is worse than no compte-rendu
 *    — the rep has no way to tell it happened.
 * 4. **Retry a chunk.** A provider that failed one map call will almost
 *    certainly fail the next, and twenty chunk-level retries is a ten-minute
 *    hang with a spinner on it. The transcript is already persisted, so the
 *    honest retry is the whole extraction, run again by the session when the
 *    rep asks — one decision, at the level that can see the failure.
 *
 * ## Why the rep's notes are in the prompt
 *
 * VISION.md §6: raw notes steer the enhancement and are quoted verbatim. They
 * steer it and they are never *cited* by it — see `NOTES_PREAMBLE`, which says
 * so in the prompt, because `groundReply` can only verify against what was
 * said and a model left to choose cites whichever source it read the fact in.
 * They are also the one input that legitimately contains the client's name, which
 * sits in tension with the leak check — a model that echoes a name out of them
 * fails the extraction. That is the intended outcome and not a bug: the names
 * are already in the header, rendered from Graph, and a model that cannot
 * follow "n'écris aucun nom" is not one whose account resolution should be
 * trusted either.
 */
import type { z } from 'zod'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { AccountRef, ExtractionESN, VerificationReport } from '../../core/contracts/extraction.ts'
import { freeFormInterpretation } from '../../core/contracts/extraction.ts'
import { LlmError, LlmSchemaError, type LlmPort } from '../../core/contracts/llm.ts'
import type { MeetingContext } from '../../core/contracts/meeting.ts'
import { DEFAULT_RECIPE, isFreeForm, type RecipeId } from '../../core/contracts/recipes.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'
import { chunkTranscript, type ChunkOptions, type TranscriptChunk } from './chunking.ts'
import { findDeterministicLeaks, forbiddenIdentitiesOf } from './deterministicLeaks.ts'
import { renderCompteRendu } from './compteRendu.ts'
import { ExtractionError, extractionErrorMessage } from './errors.ts'
import { buildFacts } from './facts.ts'
import {
  EXTRACT_INSTRUCTIONS,
  EXTRACT_SCHEMA_NAME,
  ExtractReplySchema,
  LIBRE_INSTRUCTIONS,
  LIBRE_NOTE_INSTRUCTIONS,
  LIBRE_NOTE_SCHEMA_NAME,
  LIBRE_SCHEMA_NAME,
  LibreNoteReplySchema,
  LibreReplySchema,
  NOTE_INSTRUCTIONS,
  NOTE_SCHEMA_NAME,
  NOTES_PREAMBLE,
  NoteReplySchema,
  renderNotes,
  type ExtractReply,
  type LibreReply,
  type RenderableNote,
} from './prompt.ts'
import { groundReply } from './toExtraction.ts'
import { locateQuote } from '../../core/domain/spanVerification.ts'

/** One chunk of a long call. Generous — the rep has left the room. */
export const NOTE_TIMEOUT_MS = 60_000
export const NOTE_MAX_OUTPUT_TOKENS = 900

/**
 * The final call. Three minutes, because this is the longest output the app
 * ever asks for and correctness is the requirement, not latency
 * (`core/contracts/llm.ts`).
 */
export const EXTRACT_TIMEOUT_MS = 180_000
export const EXTRACT_MAX_OUTPUT_TOKENS = 3_000

export interface ExtractionInput {
  context: MeetingContext
  /**
   * Which document to produce (DEC-43). Defaults to the ESN recipe, so a caller
   * that has not been taught about recipes gets what it has always got.
   *
   * Passed per run rather than held on the instance: the rep can switch after
   * the first extraction and ask for the other one, and a recipe baked into the
   * object at construction would mean `main.ts` rebuilding it to honour that.
   */
  recipe?: RecipeId
  /** The whole meeting. Interim segments are filtered out by `chunkTranscript`. */
  transcript: readonly TranscriptSegment[]
  /** The authenticated rep (MSAL account), null when Microsoft is not connected. */
  repEmail: string | null
  /** What the rep typed during the call, as plain text. Empty when they typed nothing. */
  notes?: string
  /** Resolved by `modules/crm`, injected by `app/`. */
  account?: AccountRef
  knownContactIds?: readonly string[]
  signal?: AbortSignal
}

export interface ExtractionResult {
  extraction: ExtractionESN
  verification: VerificationReport
  /** The French document. Grey text in the editor, `taskDescription` in VSA. */
  compteRendu: string
}

export interface CompteRenduRecipeDeps {
  llm: LlmPort
  diagnostics?: DiagRecorder
  /** Test seam. Production never passes this — DEC-13 means one set of numbers. */
  chunking?: ChunkOptions
}

const asExtractionError = (error: unknown): ExtractionError => {
  if (error instanceof ExtractionError) return error
  if (error instanceof LlmSchemaError) {
    return new ExtractionError({
      kind: 'reply-invalid',
      message: extractionErrorMessage('reply-invalid'),
      retryable: true,
      details: error.issues,
      cause: error,
    })
  }
  if (error instanceof LlmError) {
    return new ExtractionError({
      kind: 'llm',
      message: extractionErrorMessage('llm'),
      retryable: error.retryable,
      details: [`${error.kind}: ${error.message}`],
      cause: error,
    })
  }
  return new ExtractionError({
    kind: 'llm',
    message: extractionErrorMessage('llm'),
    retryable: true,
    details: [error instanceof Error ? error.message : String(error)],
    cause: error,
  })
}

export class CompteRenduRecipe {
  #llm: LlmPort
  #diagnostics: DiagRecorder
  #chunking: ChunkOptions

  constructor(deps: CompteRenduRecipeDeps) {
    this.#llm = deps.llm
    this.#diagnostics = deps.diagnostics ?? NULL_RECORDER
    this.#chunking = deps.chunking ?? {}
  }

  /** Throws `ExtractionError`, never returns an incomplete `ExtractionESN`. */
  async run(input: ExtractionInput): Promise<ExtractionResult> {
    const recipe = input.recipe ?? DEFAULT_RECIPE
    const chunks = chunkTranscript(input.transcript, this.#chunking)
    if (chunks.length === 0) {
      throw new ExtractionError({
        kind: 'empty-transcript',
        message: extractionErrorMessage('empty-transcript'),
        retryable: false,
      })
    }

    // Built before the model is asked anything, and never from the reply.
    const facts = buildFacts({
      context: input.context,
      repEmail: input.repEmail,
      ...(input.account === undefined ? {} : { account: input.account }),
      ...(input.knownContactIds === undefined ? {} : { knownContactIds: input.knownContactIds }),
    })

    const material = await this.#material(chunks, recipe, input)
    const reply = await this.#reduce(material, recipe, input.signal)

    // The schema closed the structured channel; this closes the prose one. Both
    // recipes pass through here: DEC-7 is about who owns a fact, not about which
    // document shape was asked for, and the free recipe's single prose key is
    // exactly the channel this check exists for.
    const leaks = findDeterministicLeaks(reply, forbiddenIdentitiesOf(input.context))
    if (leaks.length > 0) {
      this.#diagnostics.record({
        severity: 'error',
        code: 'extract.reply.deterministicLeak',
        module: 'extract',
        message: 'la réponse du modèle contenait des données déterministes — refusée',
        detail: { leaks },
      })
      throw new ExtractionError({
        kind: 'deterministic-leak',
        message: extractionErrorMessage('deterministic-leak'),
        retryable: true,
        details: leaks,
      })
    }

    /*
     * The free recipe produces no cited field, so there is nothing to ground and
     * nothing to verify — `fields` is empty and `overall` is `ok`.
     *
     * `ok` here means « rien à vérifier », not « vérifié », and that difference
     * is carried by the recipe rather than by the report: `reviewGate.ts` draws
     * no interpretive row for this recipe, so there is no line for a marker to
     * be missing from. The one place it could mislead is the review header's
     * « certains champs n'ont pas pu être vérifiés », which is conditioned on
     * `faible` and therefore stays silent — correctly, because no field claimed
     * anything.
     */
    const { interpretation, verification } = isFreeForm(recipe)
      ? {
          interpretation: freeFormInterpretation(recipe, (reply as LibreReply).compteRendu),
          verification: { fields: {}, overall: 'ok' as const },
        }
      : groundReply(reply as ExtractReply, input.transcript, recipe)
    const extraction: ExtractionESN = { facts, interpretation }

    const faible = Object.values(verification.fields).filter((c) => c === 'faible').length
    this.#diagnostics.record({
      severity: faible === 0 ? 'info' : 'warn',
      code: 'extract.completed',
      module: 'extract',
      message: 'compte-rendu généré',
      detail: {
        recipe,
        chunks: chunks.length,
        fields: Object.keys(verification.fields).length,
        faible,
        overall: verification.overall,
      },
    })

    return { extraction, verification, compteRendu: renderCompteRendu(extraction, verification) }
  }

  /**
   * What the reduce call reads.
   *
   * Short meeting: the transcript itself, so the final citations are the
   * transcript's own words with no hop in between. Long meeting: cited notes
   * from the map stage — which is why the map stage does not summarise (see
   * `chunking.ts`), because a paraphrase cannot be verified and every field
   * would arrive `faible`.
   *
   * Both paths carry the channel split. The short one gets it for free, in the
   * `commercial:` / `client:` prefixes `renderSegment` already writes; the long
   * one gets it from `#attribute`, because the map stage's reply schema has no
   * room for a speaker and should not have one.
   */
  async #material(
    chunks: TranscriptChunk[],
    recipe: RecipeId,
    input: ExtractionInput,
  ): Promise<string> {
    const stage = isFreeForm(recipe)
      ? {
          instructions: LIBRE_NOTE_INSTRUCTIONS,
          schemaName: LIBRE_NOTE_SCHEMA_NAME,
          schema: LibreNoteReplySchema,
        }
      : {
          instructions: NOTE_INSTRUCTIONS,
          schemaName: NOTE_SCHEMA_NAME,
          schema: NoteReplySchema,
        }

    const body =
      chunks.length === 1 && chunks[0] !== undefined
        ? `Transcription de la réunion :\n${chunks[0].text}`
        : `Notes prises sur chaque partie de la réunion :\n${renderNotes(
            this.#attribute(await this.#map(chunks, stage, input.signal), input.transcript),
          )}`

    const notes = input.notes?.trim() ?? ''
    if (notes === '') return body
    return [
      body,
      '',
      NOTES_PREAMBLE,
      notes,
    ].join('\n')
  }

  /**
   * Who said each note's citation — read off the transcript, never asked for.
   *
   * The same move `toExtraction.ts` makes for spans, one stage earlier and for
   * the same reason (DEC-21). A chunk contains both roles, so a model asked to
   * report the speaker would answer plausibly and unfalsifiably; `locateQuote`
   * instead finds the citation in the stored transcript and the channel is
   * simply *where it was found*. The map stage's own prompt tells it to strip
   * the `commercial:` / `client:` prefix from the citation, which is what makes
   * the quote locatable here at all.
   *
   * A citation that will not locate keeps no marker. That case is already
   * survivable — the same quote reaching `groundReply` will land the field on
   * `⚠ faible` — and inventing an attribution for it would be the one failure
   * this whole path exists to avoid.
   */
  #attribute(
    notes: readonly RenderableNote[],
    transcript: readonly TranscriptSegment[],
  ): RenderableNote[] {
    return notes.map((note) => {
      const located = locateQuote(note.citation, transcript)
      if (located === null) return note
      return { ...note, locuteur: located.channel === 'rep' ? 'commercial' : 'client' }
    })
  }

  /**
   * One call per chunk, sequentially.
   *
   * Not in parallel: twenty simultaneous calls is how a BYOK key meets its rate
   * limit, and the failure would land at the exact moment the rep is waiting.
   * The meeting is over — there is time.
   */
  async #map<T extends { notes: readonly RenderableNote[] }>(
    chunks: TranscriptChunk[],
    stage: { instructions: string; schemaName: string; schema: z.ZodType<T> },
    signal?: AbortSignal,
  ): Promise<RenderableNote[]> {
    const notes: RenderableNote[] = []

    for (const chunk of chunks) {
      let reply: T
      try {
        reply = await this.#llm.structured<T>({
          instructions: stage.instructions,
          input: chunk.text,
          schema: stage.schema,
          schemaName: stage.schemaName,
          maxOutputTokens: NOTE_MAX_OUTPUT_TOKENS,
          timeoutMs: NOTE_TIMEOUT_MS,
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        const failure = asExtractionError(error)
        this.#diagnostics.record({
          severity: 'error',
          code: 'extract.chunk.failed',
          module: 'extract',
          message: failure.message,
          detail: { chunk: chunk.index, of: chunks.length, kind: failure.kind },
        })
        throw failure
      }

      // Revalidated locally: a stub, a cache or a provider that promised schema
      // enforcement can all hand back something that never met the schema.
      const parsed = stage.schema.safeParse(reply)
      if (!parsed.success) {
        throw new ExtractionError({
          kind: 'reply-invalid',
          message: extractionErrorMessage('reply-invalid'),
          retryable: true,
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        })
      }
      notes.push(...parsed.data.notes)
    }

    return notes
  }

  /**
   * The final call, in whichever shape the recipe asked for.
   *
   * The budget is the same for both. The free recipe returns one long string
   * where the ESN one returns a document plus nine fields, so the token count is
   * comparable — and a free-form compte-rendu truncated three sections in is the
   * same failure as a truncated ESN one, which is the thing the ceiling exists
   * to keep away from.
   */
  async #reduce(
    material: string,
    recipe: RecipeId,
    signal?: AbortSignal,
  ): Promise<ExtractReply | LibreReply> {
    const free = isFreeForm(recipe)
    // Widened once, here. `LlmStructuredRequest<T>` wants a `z.ZodType<T>` and
    // the two concrete object schemas are each a `ZodType` of their own shape;
    // the parse below is still the real one, and it is the narrow schema.
    const schema = (free ? LibreReplySchema : ExtractReplySchema) as unknown as z.ZodType<
      ExtractReply | LibreReply
    >

    let reply: ExtractReply | LibreReply
    try {
      reply = await this.#llm.structured<ExtractReply | LibreReply>({
        instructions: free ? LIBRE_INSTRUCTIONS : EXTRACT_INSTRUCTIONS,
        input: material,
        schema,
        schemaName: free ? LIBRE_SCHEMA_NAME : EXTRACT_SCHEMA_NAME,
        maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        timeoutMs: EXTRACT_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw asExtractionError(error)
    }

    const parsed = schema.safeParse(reply)
    if (!parsed.success) {
      throw new ExtractionError({
        kind: 'reply-invalid',
        message: extractionErrorMessage('reply-invalid'),
        retryable: true,
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    }
    return parsed.data
  }
}
