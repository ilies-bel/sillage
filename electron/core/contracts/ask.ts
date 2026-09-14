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
      /*
       * **`min(1)`, because an empty string is not a citation.**
       *
       * `verifyAnswer` refuses an answer whose `quotes` is empty — « an answer
       * with no citation is not a weaker answer, it is no answer » (DEC-21) —
       * and one empty string walked straight past that count: a confident
       * paragraph with a footnote list holding nothing, which is the exact
       * rendering the rule exists to prevent. The model has no reason to send
       * one, which is precisely why nothing downstream was looking.
       */
      /*
       * **And it is `trim()` without `min(1)`, because refusing here costs the
       * whole answer.**
       *
       * `min(1)` accepted a single space, and `TranscriptSpanSchema`'s own
       * `min(1)` — applied *after* trimming — rejected it two schemas later, so
       * `register.ts` threw a raw Zod issue array into a French panel:
       *
       *     [{"code":"too_small","path":["citations",0,"span","quote"], ...}]
       *
       * `AskPanel` prints `error.message`, and it is not a `refuse()`, so the
       * same line also landed in the diagnostics at `severity: 'error'`. A
       * perfectly good verified citation in the same answer went with it.
       *
       * Tightening it here would still cost the answer — one blank among four
       * real quotes would refuse the draft. A blank carries no claim, so there
       * is nothing to mark and nothing for a rep to distrust: `verifyAnswer`
       * drops it before it counts them, which leaves the other three and leaves
       * the « an answer with no citation is no answer » rule intact, because an
       * answer whose quotes were *all* blank still ends with none.
       */
      quote: z.string().trim(),
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
  /**
   * **How much of the call the model was actually given**, when it was not all
   * of it.
   *
   * `ASK_MAX_INPUT_CHARS` keeps the *tail* of a long meeting, and `ask.ts`'s
   * docblock has said « when it truncates, the answer says so » since it was
   * written. Nothing said so: the constant had no reader outside its own file,
   * no flag reached here, and the model was never told the transcript was
   * partial. Measured on a ninety-minute call — 124 765 characters, 60 065
   * sent — a question about the need stated in the first twenty minutes came
   * back « La transcription de cet appel ne permet pas de répondre. », which is
   * a false statement about the recording, from the one feature whose whole
   * claim is that it answers from the recording.
   *
   * Null when the whole call was read, which is the ordinary case.
   */
  readFrom: z.number().int().nonnegative().nullable().optional(),
})
export type AskAnswer = z.infer<typeof AskAnswerSchema>
