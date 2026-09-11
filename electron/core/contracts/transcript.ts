/**
 * Transcript segments and the spans that every interpretive field must cite.
 *
 * Speaker attribution is free from the hardware — mic is the rep, system
 * loopback is everyone else (VISION.md §5) — so the channel is named for the
 * role, not the device. There is no diarization in v1.
 */
import { z } from 'zod'
import { TimestampSchema } from './meeting.ts'
import { MomentMarkSchema } from './marks.ts'

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
  /**
   * The rep's own bookmarks, made during the call (`core/contracts/marks.ts`).
   *
   * Shipped with the record rather than asked for separately: there are a
   * handful of them, they are read on exactly the screens that read the
   * transcript, and a second round trip would let a reader render a call
   * without the marks in it for one frame — which is the reader appearing to
   * have lost them.
   */
  marks: z.array(MomentMarkSchema).default([]),
})
export type TranscriptView = z.infer<typeof TranscriptViewSchema>


// ── Looking a quote up in the record (DEC-21) ───────────────────────────────

/**
 * **The one way a quote is looked up, because two ways is a contradiction on
 * screen.**
 *
 * It lived in `core/domain/spanVerification.ts`, which `src/*` may not import —
 * so `TranscriptReader` wrote its own: `segments.find((s) => s.text.includes(q))`,
 * raw, under a comment claiming it was « deliberately the same test
 * `spanVerification.ts` uses ». It was not the same test in four ways, and each
 * of them is routine:
 *
 *     accent lost by the STT    gate: verified   reader: introuvable
 *     typographic apostrophe    gate: verified   reader: introuvable
 *     trailing full stop        gate: verified   reader: introuvable
 *     quote spanning two turns  gate: verified   reader: introuvable
 *
 * The gate matches over a **normalised, channel-joined** haystack and never
 * rewrites the span's quote to the text it found; the reader matched raw, inside
 * one segment. The last case fails by construction for every quote the join was
 * written to bridge. So a rep pressed `[source ▸]` on a row the app had just
 * certified and landed on « Cet extrait est introuvable dans la transcription. »
 * — the one feature this product has over a general-purpose notetaker, telling
 * the rep its own evidence is fabricated.
 *
 * It is here for the reason `speakerLabel` and `meetingAnchor` are here: three
 * surfaces need it and `src/*` may import nothing else.
 */
/**
 * Shorter than this, a match is a coincidence rather than evidence: `à`, `oui`
 * and `520` occur in almost any French call, so they prove nothing about the
 * claim built on top of them. Counted after normalisation, so `TJM 520 €` (→
 * `tjm 520`, 7 chars) still qualifies and a bare `€` does not.
 */
export const MIN_QUOTE_CHARS = 4

/**
 * Fold away everything two renderings of the same sentence can disagree about.
 *
 * Case, punctuation, currency signs, typographic apostrophes and accents. The
 * accents are the debatable one and they are folded on purpose: French STT
 * routinely emits `demarrage` where the model writes `démarrage`, and refusing
 * that match would drop true chips. It cannot create a false one — folding only
 * merges characters, so an invented sentence stays absent.
 */
export const normalizeForVerification = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

interface ChannelIndex {
  haystack: string
  /** Normalised offsets back to the segment they came from. */
  parts: { start: number; end: number; segment: TranscriptSegment }[]
}

/**
 * One channel's final segments as a single normalised string.
 *
 * Joining is what lets a quote that straddles two segments verify — providers
 * cut on silence, not on sentences, and a model quoting a sentence has no idea
 * where the cut fell. It is also the one place this check is deliberately
 * generous: two utterances a minute apart are adjacent in the haystack, so a
 * quote could in principle bridge them. The alternative — refusing every
 * cross-segment quote — drops far more true citations than it stops false ones.
 */
const indexChannel = (segments: readonly TranscriptSegment[]): ChannelIndex => {
  const chunks: string[] = []
  const parts: ChannelIndex['parts'] = []
  let cursor = 0

  for (const segment of segments) {
    const normalized = normalizeForVerification(segment.text)
    if (normalized.length === 0) continue
    if (cursor > 0) cursor += 1 // the space `join` will insert
    parts.push({ start: cursor, end: cursor + normalized.length, segment })
    chunks.push(normalized)
    cursor += normalized.length
  }

  return { haystack: chunks.join(' '), parts }
}


const byStartMs = (a: TranscriptSegment, b: TranscriptSegment): number => a.startMs - b.startMs

/**
 * Every segment the quote touches, in order — empty when it is not in the
 * record.
 *
 * The segments rather than a span, because the two callers want different
 * things from the same search: the gate wants when it was said, the reader wants
 * which rows to highlight. One search, so they cannot disagree.
 *
 * Only final segments: an interim segment can be revised away by the provider,
 * and a citation must point at something the provider has committed to.
 */
export const locateSegments = (
  quote: string,
  segments: readonly TranscriptSegment[],
  channel: Channel | null = null,
): TranscriptSegment[] => {
  const needle = normalizeForVerification(quote)
  if (needle.length < MIN_QUOTE_CHARS) return []

  for (const candidate of channel === null ? (['rep', 'far'] as const) : [channel]) {
    const index = indexChannel(
      segments.filter((s) => s.isFinal && s.channel === candidate).sort(byStartMs),
    )
    const at = index.haystack.indexOf(needle)
    if (at === -1) continue
    const end = at + needle.length
    const touched = index.parts.filter((p) => p.start < end && p.end > at)
    if (touched.length > 0) return touched.map((p) => p.segment)
  }
  return []
}
