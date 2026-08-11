/**
 * The client's words, recorded as the rep's — and how to stop believing them.
 *
 * ## The measurement
 *
 * A real call on a MacBook, speakers on, built-in microphone: three of the five
 * far-end utterances came back **duplicated onto the rep channel**, sharing 61 %,
 * 88 % and 91 % of the rep segment's words with the far segment they overlapped
 * in time. The cause is not in the software. The far end plays out of the
 * speakers, the microphone hears the speakers, and there is no echo cancellation
 * on the capture path — so the client is transcribed twice, once correctly on
 * `far` and once wrongly on `rep`.
 *
 * ## Why it cannot be left alone
 *
 * `modules/extract`'s prompt tells the model that the « (commercial) » /
 * « (client) » marker beside each note is *« une mesure faite sur la
 * transcription, pas une supposition »* — a measurement, not a guess. Bleed
 * makes it a wrong measurement, and the fields it corrupts are exactly the ones
 * that reach the CRM: who raised the objection, who committed to the next step,
 * who said the TJM. A compte-rendu that attributes the client's price ceiling to
 * the rep is worse than one that omits it.
 *
 * ## What this does, and what it deliberately does not
 *
 * It drops the **rep** copy of an utterance that also arrived on **far**. One
 * direction only, because the bleed has one direction: the speakers reach the
 * microphone, and nothing carries the rep's own voice back into a tap on the
 * speaker output.
 *
 * It is a **read-time filter over what the model is given**, never a mutation of
 * the store. The transcript is the record and the record keeps everything it
 * captured — DEC-21's span check runs against the stored segments, so a segment
 * hidden from the model is still there to verify a citation against, and the
 * `[source ▸]` affordance still finds it. Filtering the archive to make the
 * analysis tidier would be destroying evidence to improve a summary.
 *
 * It does **not** clean the audio. Acoustic echo cancellation in the native
 * module is the fix for that and is a separate piece of work; this is the fix
 * for the attribution, which is the half that ships to a client's CRM.
 */
import type { Channel, TranscriptSegment } from '../contracts/transcript.ts'

/**
 * How much of the rep segment has to be present in the far segment.
 *
 * 0.6, against measured bleed at 0.61 / 0.88 / 0.91 and with the honest
 * admission that three samples is three samples. The threshold is deliberately
 * set at the bottom of that range rather than in the middle of it, because the
 * two errors are not symmetric: keeping a bleed segment costs one wrongly
 * attributed sentence in a compte-rendu, and dropping a real one costs a thing
 * the rep actually said. When in doubt this keeps.
 */
export const BLEED_WORD_RATIO = 0.6

/**
 * Below this many words, a rep segment is never dropped — *is this a sentence
 * or a grunt*.
 *
 * Short utterances are where the ratio lies. « Oui », « d'accord », « ouais » —
 * a rep backchannel while the client talks is a real utterance that overlaps in
 * time and scores 1.0 against any far segment containing the same word. Those
 * carry no extractable fact either way, so the cost of keeping a bleed one is
 * nil and the cost of eating a real one is a rep who said something and cannot
 * find it.
 *
 * Counted on **raw** words rather than on content words, and that distinction
 * cost a test: « Est-ce que vous voyez bien mon écran ? Ok, on va commencer. »
 * is unmistakably a sentence and reduces to three content words, because the
 * filtering below is deliberately harsh. A guard asking "is this substantial"
 * has to count what was said, not what survived the sieve.
 */
export const BLEED_MIN_WORDS = 6

/**
 * And below this many *content* words, the ratio itself is not worth trusting —
 * *is the comparison meaningful*.
 *
 * The second half of the same guard. A six-word sentence that reduces to one
 * distinctive word scores 1.0 on that single word, which is a coincidence
 * dressed as evidence: « je pense que c'est bien ça » shares « pense » with any
 * far segment containing it. Three distinctive words shared at the same instant
 * is not a coincidence.
 */
export const BLEED_MIN_CONTENT = 3

/**
 * Words too short or too common to be evidence of anything.
 *
 * Not a stop-word list for its own sake: the ratio is meaningless if « que », « de »
 * and « pas » count toward it, because every French sentence shares those with
 * every other French sentence. Length alone does most of the work, and this is
 * the handful of longer function words that would otherwise inflate a score
 * between two unrelated utterances.
 */
const NOISE = new Set([
  'dans',
  'pour',
  'avec',
  'mais',
  'donc',
  'cette',
  'elle',
  'nous',
  'vous',
  'plus',
  'sont',
  'était',
  'être',
  'avoir',
  'fait',
  'très',
  'bien',
  'alors',
  'comme',
  'tout',
  'tous',
  'leur',
  'sans',
])

/**
 * The words a comparison is allowed to look at.
 *
 * Lower-cased and stripped of everything but letters, because the two channels
 * are transcribed independently and the same sentence comes back with different
 * punctuation, different capitalisation and different dash conventions almost
 * every time — comparing raw text would score two transcriptions of one
 * utterance as unrelated.
 */
const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{Letter}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')

/** Everything that was said, for the "is this a sentence" half of the guard. */
export const wordCount = (text: string): number => tokens(text).length

export const contentWords = (text: string): string[] =>
  tokens(text).filter((word) => word.length > 3 && !NOISE.has(word))

/**
 * How far apart two segments may arrive and still be one utterance.
 *
 * **Not an interval overlap, and that cost a rewrite.** The first version asked
 * whether `[startMs, endMs]` intersected, which is the natural model and is
 * wrong for this pipeline: `modules/transcribe` sets `startMs === endMs`, both
 * to the instant the *batch arrived*, and says so — a batch provider cannot
 * report the acoustic time of the words inside it. Two instants from two
 * independently batched channels never coincide exactly, so the rule passed
 * every unit test and dropped nothing at all on a real 56-segment call.
 *
 * So the question is proximity of arrival. Sized from that call: every true
 * bleed pair arrived within **730 ms**, most within 200 ms, while the nearest
 * coincidence — a rep sentence sharing its one distinctive word with a far
 * segment — was 40 seconds away. 2.5 s sits far above the first and far below
 * the second.
 *
 * The known miss: one pair 6.7 s apart, where a long rep batch had swallowed a
 * far utterance reported later. It is left in. A miss keeps a segment, which is
 * the direction this whole file errs in.
 */
export const BLEED_WINDOW_MS = 2_500

const arrivesTogether = (a: TranscriptSegment, b: TranscriptSegment): boolean =>
  Math.abs(a.startMs - b.startMs) <= BLEED_WINDOW_MS

/**
 * How much of `inner` is contained in `outer`, as a fraction of `inner`'s own
 * content words. Directional on purpose: a short rep segment fully contained in
 * a long far one is bleed, and asking the question the other way round would
 * score that same pair near zero.
 */
export const containmentRatio = (inner: readonly string[], outer: readonly string[]): number => {
  if (inner.length === 0) return 0
  const haystack = new Set(outer)
  return inner.filter((word) => haystack.has(word)).length / inner.length
}

/**
 * True when this rep segment is the microphone hearing the speakers.
 *
 * Both conditions, and neither alone would do. **Time alone** eats every
 * legitimate interruption — a rep answering « non, sur douze mois » over the
 * client is overlapping speech, not an echo. **Words alone** eats the most
 * ordinary move in a sales call: repeating the client's own figure back at them
 * a minute later to confirm it. Bleed is the conjunction — the same words, at
 * the same instant, on both channels.
 */
export const isBleed = (rep: TranscriptSegment, far: readonly TranscriptSegment[]): boolean => {
  if (wordCount(rep.text) < BLEED_MIN_WORDS) return false
  const words = contentWords(rep.text)
  if (words.length < BLEED_MIN_CONTENT) return false

  /*
   * Compared against the *union* of the far segments in the window, not against
   * each one in turn. The two channels are batched independently — different
   * suppressor thresholds, different hangovers — so one utterance is routinely
   * cut into one segment on one side and two on the other. Asking each far
   * segment separately scores a rep segment that straddles a far boundary at
   * roughly half its true containment, and lets exactly the longest, most
   * fact-carrying bleed through.
   */
  const haystack = far
    .filter((candidate) => arrivesTogether(rep, candidate))
    .flatMap((candidate) => contentWords(candidate.text))

  return containmentRatio(words, haystack) >= BLEED_WORD_RATIO
}

const REP: Channel = 'rep'
const FAR: Channel = 'far'

/**
 * The transcript as the model should read it: every far-end utterance once, and
 * attributed to the far end.
 *
 * Order is preserved and nothing is rewritten — a segment is either passed
 * through untouched or left out. The far channel is never filtered: it is a
 * direct tap on the audio device and has no acoustic path to contaminate it, so
 * there is nothing there to be a duplicate *of*.
 */
export const withoutChannelBleed = (
  segments: readonly TranscriptSegment[],
): TranscriptSegment[] => {
  const far = segments.filter((segment) => segment.channel === FAR)
  if (far.length === 0) return [...segments]

  return segments.filter(
    (segment) => segment.channel !== REP || !isBleed(segment, far),
  )
}

/**
 * What was dropped and why, for the diagnostic that reports it.
 *
 * Separate from the filter because a rep whose microphone is bleeding should be
 * told — the real fix is headphones, and nobody discovers that from a
 * compte-rendu that is quietly correct. `withoutChannelBleed` stays a pure
 * filter; this is what `app/` records beside it.
 */
export const bleedReport = (
  segments: readonly TranscriptSegment[],
): { dropped: number; repSegments: number } => {
  const far = segments.filter((segment) => segment.channel === FAR)
  const rep = segments.filter((segment) => segment.channel === REP)
  const dropped = far.length === 0 ? 0 : rep.filter((segment) => isBleed(segment, far)).length
  return { dropped, repSegments: rep.length }
}
