/**
 * Transcript segments and the spans that every interpretive field must cite.
 *
 * Speaker attribution is free from the hardware — mic is the rep, system
 * loopback is everyone else (VISION.md §5) — so the channel is named for the
 * role, not the device. There is no diarization in v1.
 */
import { z } from 'zod'
import { TimestampSchema } from './meeting.ts'

export const ChannelSchema = z.enum(['rep', 'far'])
export type Channel = z.infer<typeof ChannelSchema>

/**
 * **Who a turn belongs to — named when the app can prove it, and only then.**
 *
 * Every screen that draws a transcript wrote « Client » for the far channel and
 * « Moi » for the near one. On a call with one client contact that is a name
 * the app *has*, from Graph, and is throwing away; on a call with three it is
 * the only honest thing to say. The two were collapsed into the second, so the
 * common ESN case — one acheteur, one commercial — read as anonymously as a
 * committee.
 *
 * The rule is arithmetic, not inference. **Exactly one interlocutor on the far
 * side means the far channel is that person**: the channel is measured by the
 * hardware (VISION.md §5), the name comes from the calendar (DEC-7), and the
 * join of the two is a fact rather than a guess. Two or more and the app cannot
 * say which of them spoke — there is no diarisation, and Granola buys theirs
 * with an accessibility grant this product does not ask for — so it says
 * « Client » and means it.
 *
 * This is what keeps DEC-21 honest at the level of the *turn*. `[source ▸]`
 * lands a rep on the sentence a field was read from; on a four-person call
 * « Client » does not tell them whether the 550 € cap came from the buyer or
 * from the DSI, which in a staffing negotiation is the difference between a
 * blocker and an opinion. Naming the one case the record settles is not a
 * weaker version of diarisation — it is the part of it that is true.
 */
export const speakerLabel = (
  channel: Channel,
  interlocuteurs: readonly { name: string; email: string }[],
): string => {
  if (channel === 'rep') return 'Moi'
  const named = interlocuteurs.filter((person) => person.name.trim() !== '')
  // First names only: the surname is on the compte-rendu's header line, and a
  // transcript column is fourteen characters wide.
  return named.length === 1 ? (named[0]?.name.trim().split(/\s+/)[0] ?? 'Client') : 'Client'
}

export const TranscriptSegmentSchema = z.object({
  id: z.string().min(1),
  channel: ChannelSchema,
  text: z.string(),
  /** Milliseconds since the recording started, not wall clock. */
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  /**
   * Interim segments are shown in the transcript pane and replaced in place.
   * Only final segments are persisted as events and only they can be cited.
   */
  isFinal: z.boolean(),
  /** Provider id, for diagnostics and for the mid-session failover trail. */
  provider: z.string(),
  receivedAt: TimestampSchema,
})
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>

/**
 * The evidence for one extracted field (DEC-21).
 *
 * `quote` is the load-bearing part: `core/domain/spanVerification.ts` checks it
 * really occurs in the stored transcript. The timings are hints for the
 * `[source ▸]` affordance and are never trusted for verification — a model that
 * invents a plausible time range is exactly the failure this defends against.
 */
export const TranscriptSpanSchema = z.object({
  quote: z.string().min(1),
  channel: ChannelSchema.nullable(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
})
export type TranscriptSpan = z.infer<typeof TranscriptSpanSchema>

export const TranscriptViewSchema = z.object({
  segments: z.array(TranscriptSegmentSchema),
})
export type TranscriptView = z.infer<typeof TranscriptViewSchema>
