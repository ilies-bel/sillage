/**
 * Checking an answer against the recording it claims to come from (DEC-21).
 *
 * The model is asked a question over the transcript and returns prose plus the
 * fragments it leaned on. This turns that into an `AskAnswer`, and everything it
 * does is a check:
 *
 *  · every quote is looked up in the **stored** segments with the same
 *    `locateQuote` the review gate verifies citations with, so an answer and a
 *    compte-rendu field are held to one standard;
 *  · the timestamps come from the segment that was found, never from the model;
 *  · a quote that is nowhere in the record is kept and marked, not dropped.
 *
 * That last one is the whole design. Dropping an unverifiable quote would leave
 * a confident paragraph with one fewer footnote and no sign anything was wrong —
 * the failure would be invisible in exactly the way DEC-21 exists to prevent. A
 * rep who sees « introuvable dans la transcription » beside a sentence knows to
 * distrust that sentence; a rep who sees nothing trusts all of it.
 *
 * Pure, and tested with no Electron, no model and no network: it takes a draft
 * and some segments and returns an answer.
 */
import type { AskAnswer, AskDraft } from '../contracts/ask.ts'
import type { TranscriptSegment } from '../contracts/transcript.ts'
import { MIN_QUOTE_CHARS, locateQuote } from './spanVerification.ts'

/**
 * Turn what the model said into what the screen shows.
 *
 * `question` is carried through rather than re-read from the draft: it is the
 * rep's own string and the model never gets to restate it.
 */
export const verifyAnswer = (
  question: string,
  draft: AskDraft,
  segments: readonly TranscriptSegment[],
): AskAnswer => {
  const answer = draft.answer.trim()

  /*
   * Two ways to have no answer, and they collapse into one here.
   *
   * The model can say so (`answered: false`), or it can say so by returning an
   * empty string while claiming otherwise. The second is not hypothetical —
   * `answered` is the field a model is most likely to get wrong, because it is
   * the one that asks it to admit failure.
   */
  if (!draft.answered || answer === '') {
    return { question, answered: false, answer: '', citations: [] }
  }

  const seen = new Set<string>()
  const citations = draft.quotes
    // The quote and the channel it was claimed on stay together through every
    // step — filtering a parallel array and then indexing the original by the
    // filtered position is how a citation ends up labelled with somebody else's
    // channel.
    .map((cited) => ({ quote: cited.quote.trim(), channel: cited.channel }))
    /*
     * Too short to verify is not a citation. `locateQuote` refuses anything
     * under `MIN_QUOTE_CHARS` because a three-character needle matches half the
     * call, so a fragment that short would arrive permanently unverifiable and
     * read as an app failure rather than as a model one.
     */
    .filter(({ quote }) => quote.length >= MIN_QUOTE_CHARS)
    .filter(({ quote }) => {
      // A model asked for evidence repeats itself. The same sentence twice is
      // one citation, and two identical rows under one paragraph read as two
      // independent confirmations of it.
      const key = quote.toLocaleLowerCase('fr')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(({ quote, channel }) => {
      /*
       * **The claimed channel is a hint, not a filter.**
       *
       * `locateQuote` narrows to one channel when given one, so passing the
       * model's guess straight through meant a sentence attributed to the wrong
       * speaker came back « introuvable » — the app calling a real quote invented
       * because the model got the *label* wrong. That is the worst possible
       * failure for this feature: it discredits the evidence rather than the
       * mistake.
       *
       * The hint still earns its place on the first pass. Where the laptop's
       * microphone heard the far end (DEC-41) the same sentence exists on both
       * channels, and searching blind resolves it to `rep` every time — so a
       * client's own words would be shown as the rep's.
       */
      const located = locateQuote(quote, segments, channel) ?? locateQuote(quote, segments, null)
      return {
        span: {
          quote,
          // The channel the quote was *found* on. A model that guesses « rep »
          // for something the client said would otherwise send the reader to
          // the wrong half of the call.
          channel: located?.channel ?? channel,
          startMs: located?.startMs ?? null,
          endMs: located?.endMs ?? null,
        },
        verified: located !== null,
      }
    })

  return { question, answered: true, answer, citations }
}
