/**
 * *Demander* — a question about one call, answered from that call's record.
 *
 * ## What it is
 *
 * Granola pins an « Ask anything » box under every note, and it is the one thing
 * on that product Sillage had no answer to. This is that box, with the one
 * difference that matters here: **every sentence of the answer has to point at a
 * moment of the recording, and the app checks that the moment exists** (DEC-21).
 *
 * A general notetaker's chat answers from a document the model itself wrote, so
 * a mistake in the summary becomes a mistake in the answer with nothing left to
 * check it against. This one is asked over the stored transcript, the model is
 * required to quote, and `core/domain/askAnswer.ts` looks every quote up in the
 * segments before the answer reaches the screen. A quote that is not in the
 * record is marked as such and its timestamps stay null — never quietly dropped,
 * because a rep who cannot see that the app failed to verify something is worse
 * off than one who sees nothing at all.
 *
 * ## What it is not
 *
 * **It writes nothing.** Not into the rep's notes (DEC-5), not into the
 * compte-rendu, not into VerySwing. Nothing here is a second confirmation
 * (DEC-4) and no answer is stored as a fact about the meeting — it is a read
 * over the log, like *Historique* (DEC-25).
 *
 * **It is not available during the call** (DEC-23). A question box beside a
 * live meeting is a second thing to look at while somebody is talking, and the
 * transcript it would be answered from is the part that has already happened.
 *
 * **It is not a conversation.** One question, one answer, and the next question
 * is asked fresh. A thread would need history, a token budget and a summariser,
 * and none of that makes the first question better answered.
 */
import { z } from 'zod'
import { TranscriptSpanSchema } from './transcript.ts'

/**
 * One quote the answer leans on, after the app has looked for it.
 *
 * The span's `startMs` / `endMs` are **the located segment's**, never the
 * model's — a batch transcriber reports no acoustic time (DEC-41) and a model
 * asked for one invents it. `verified: false` means the quote was not found in
 * the record, and the timestamps are then null because there is nowhere to
 * point.
 */
export const AskCitationSchema = z.object({
  span: TranscriptSpanSchema,
  /** Measured by `locateQuote`, never claimed by the model (DEC-21). */
  verified: z.boolean(),
})
export type AskCitation = z.infer<typeof AskCitationSchema>

/**
 * What the model is asked to return, before anything has been checked.
 *
 * `answered: false` is a first-class outcome and the prompt says so. « The
 * record does not say » is the correct answer to most questions about most
 * meetings, and a model that has no way to give it will invent one instead.
 */
export const AskDraftSchema = z.strictObject({
  answered: z.boolean(),
  /** French prose, two or three sentences. Empty when `answered` is false. */
  answer: z.string(),
  /** Verbatim fragments of the transcript. May be empty when nothing was found. */
  quotes: z.array(
    z.strictObject({
      quote: z.string(),
      channel: z.enum(['rep', 'far']).nullable(),
    }),
  ),
})
export type AskDraft = z.infer<typeof AskDraftSchema>

/** The answer as the renderer receives it, with every quote already checked. */
export const AskAnswerSchema = z.object({
  question: z.string(),
  /**
   * Whether the record answers the question at all. False draws the honest
   * empty state and no prose — not a paragraph explaining that there is no
   * paragraph.
   */
  answered: z.boolean(),
  answer: z.string(),
  citations: z.array(AskCitationSchema),
})
export type AskAnswer = z.infer<typeof AskAnswerSchema>
