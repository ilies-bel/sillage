/**
 * The prompt behind *Demander*, and the one model call it makes.
 *
 * The register is `prompt.ts`'s (DEC-44) narrowed to a single job: answer one
 * question from one transcript, or say the transcript does not answer it. Three
 * rules do the work and each of them exists because of a specific way a model
 * fails at this:
 *
 *  · **Quote or do not claim.** A model asked a question about a meeting will
 *    happily answer it from what it knows about meetings in general. Requiring a
 *    verbatim fragment for every claim makes that visible — `askAnswer.ts` looks
 *    the fragment up, and an invented one comes back « introuvable ».
 *  · **« Le compte-rendu ne le dit pas » is a correct answer**, stated as such,
 *    because a model with no permission to fail invents instead.
 *  · **Verbatim means verbatim.** A quote that has been tidied — an « euh »
 *    removed, an agreement fixed — will not be found, so the answer that leans
 *    on it is marked unverified. Saying so in the prompt buys a real citation
 *    rate; leaving it out produces beautifully paraphrased quotes that all fail.
 *
 * The transcript is the input, unfiltered. Channel-bleed de-duplication (DEC-41)
 * is deliberately *not* applied: it exists so the recipe reads each sentence
 * once, and here a wrong attribution is worth less than a missing line — the
 * verification re-derives the channel from where the quote is actually found.
 */
import type { AskDraft } from '../../core/contracts/ask.ts'
import { AskDraftSchema } from '../../core/contracts/ask.ts'
import type { LlmPort } from '../../core/contracts/llm.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'
import { asExtractionError } from './errors.ts'

/** Two or three sentences and a handful of quotes. It is not a document. */
const ASK_MAX_OUTPUT_TOKENS = 700

/**
 * A rep is waiting in front of this one, unlike the compte-rendu, which runs
 * after the call is over. Fail fast and say so (DEC-26).
 */
const ASK_TIMEOUT_MS = 45_000

/**
 * How much of the call one question gets.
 *
 * A long meeting does not fit, and chunk-and-reduce — what the compte-rendu
 * does — would turn a question a rep asks while looking at the screen into
 * twenty sequential calls. The tail is kept rather than the head: the end of a
 * call carries the decisions, and the deterministic header a rep would ask about
 * (who, when, which client) never came from the transcript in the first place
 * (DEC-7). When it truncates, the answer says so.
 */
export const ASK_MAX_INPUT_CHARS = 60_000

export const ASK_INSTRUCTIONS = `Tu réponds à une question sur une réunion commerciale, à partir de la transcription de cette réunion et de rien d'autre.

Règles, dans l'ordre :

1. Ne réponds qu'avec ce que la transcription contient. Aucune connaissance générale, aucune déduction sur ce qui « se fait d'habitude », aucun conseil.
2. Si la transcription ne permet pas de répondre, mets "answered" à false, laisse "answer" vide et n'invente rien. C'est une réponse correcte et fréquente.
3. Chaque affirmation de ta réponse doit s'appuyer sur un extrait de la transcription, reporté dans "quotes".
4. Un extrait est copié **mot pour mot** depuis la transcription, hésitations et tournures orales comprises. Ne le corrige pas, ne le raccourcis pas au milieu, ne le reformule pas : un extrait retouché est introuvable dans l'enregistrement et la réponse est alors signalée comme non vérifiée.
5. Deux à quatre extraits suffisent. Prends les plus décisifs plutôt que tous.
6. "channel" vaut "rep" si c’est le commercial qui parle, "far" si c'est le client, null si tu ne peux pas trancher.
7. Réponds en français, en deux ou trois phrases. Rapporte ce qui a été dit et attribue-le ("Le client indique que…", "Le commercial propose…"). N'affirme jamais en ton nom propre ce que quelqu'un a dit.
8. Garde les approximations telles qu'elles ont été prononcées : « autour de 550 » ne devient pas « 550 ».`

/**
 * How the transcript is laid out for the model, and **how much of it was kept**.
 *
 * `from` is the meeting offset of the first turn the model was given, or null
 * when it was given all of them. Two things went wrong without it. The slice was
 * by *character*, so the model's first line was the fragment `l : On reprend le
 * point…` — half a speaker label — and it was silent: on a ninety-minute call
 * the first twenty minutes were dropped and the answer read « La transcription
 * de cet appel ne permet pas de répondre », which is a false statement about the
 * recording. The docblock on `ASK_MAX_INPUT_CHARS` has claimed otherwise since
 * it was written.
 */
const renderSegments = (
  segments: readonly TranscriptSegment[],
): { transcript: string; from: number | null } => {
  const ordered = segments
    .filter((segment) => segment.isFinal)
    .slice()
    .sort((a, b) => a.startMs - b.startMs)

  const lines = ordered.map((segment) => {
    const who = segment.channel === 'rep' ? 'Commercial' : 'Client'
    return `${who} : ${segment.text.trim()}`
  })

  const joined = lines.join('\n')
  if (joined.length <= ASK_MAX_INPUT_CHARS) return { transcript: joined, from: null }

  // Whole turns from the end, never a character slice: half a speaker label is
  // the model's first impression of the call.
  let kept = 0
  let first = ordered.length
  for (let i = ordered.length - 1; i >= 0; i--) {
    const cost = (lines[i]?.length ?? 0) + 1
    if (kept + cost > ASK_MAX_INPUT_CHARS) break
    kept += cost
    first = i
  }
  // At least one turn, however long it is: an empty transcript would be reported
  // as « nothing was said », which is a different and wrong answer.
  if (first === ordered.length) first = ordered.length - 1

  return {
    transcript: lines.slice(first).join('\n'),
    from: ordered[first]?.startMs ?? 0,
  }
}

export interface AskInput {
  question: string
  segments: readonly TranscriptSegment[]
  signal?: AbortSignal
}

/**
 * One call. Errors are normalised to `ExtractionError` so the IPC layer can put
 * a French sentence on screen rather than a provider's stack (DEC-26).
 */
export interface AskResult {
  draft: AskDraft
  /**
   * The meeting offset of the first turn the model was given, or null when it
   * was given the whole call. See `renderSegments`.
   */
  readFrom: number | null
}

export const askTranscript = async (llm: LlmPort, input: AskInput): Promise<AskResult> => {
  const { transcript, from } = renderSegments(input.segments)

  try {
    const reply = await llm.structured<AskDraft>({
      instructions: ASK_INSTRUCTIONS,
      input:
        `Question : ${input.question.trim()}\n\n` +
        // Told, rather than left to infer it from a conversation that starts
        // mid-sentence: a model that does not know the transcript is partial
        // answers « ce n'est pas dans la transcription » about the part it was
        // not given.
        (from === null
          ? ''
          : 'Attention : seule la fin de la réunion est fournie ci-dessous. ' +
            'Si la réponse n’y est pas, dis-le sans affirmer qu’elle est absente de la réunion.\n\n') +
        `Transcription :\n${transcript}`,
      schema: AskDraftSchema,
      schemaName: 'AskDraft',
      maxOutputTokens: ASK_MAX_OUTPUT_TOKENS,
      timeoutMs: ASK_TIMEOUT_MS,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })

    // Revalidated locally, for the reason `CompteRenduRecipe` revalidates: a
    // stub, a cache or a provider that promised schema enforcement can all hand
    // back something that never met the schema.
    return { draft: AskDraftSchema.parse(reply), readFrom: from }
  } catch (error) {
    throw asExtractionError(error)
  }
}
