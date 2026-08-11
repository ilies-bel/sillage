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
