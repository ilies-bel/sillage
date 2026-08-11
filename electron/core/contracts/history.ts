/**
 * *Historique* — a reader over the event log (DEC-25).
 *
 * There is no history table and there is not going to be one. Every shape below
 * is folded from `events` on demand, which is why the screen can show a call
 * captured before a field existed: the log is the record, and a projection that
 * disagreed with it would be a second truth to keep honest.
 *
 * Two things the shapes here deliberately refuse:
 *
 *  - **The renderer never receives a transcript it did not ask for.** A row
 *    carries a `HistoryMatch` — where the query hit and forty characters either
 *    side — not the text it was found in. Shipping every transcript to the
 *    renderer so it could filter them would put the whole corpus in a devtools
 *    console and make search cost the same whether anybody was searching.
 *  - **Nothing here is editable.** Historique is a reader; the only gesture in
 *    the product that writes to an external system is *Valider* (DEC-4).
 */
import { z } from 'zod'
import { MeetingSchema } from './meeting.ts'
import { TranscriptSegmentSchema } from './transcript.ts'
import { ConfidenceSchema } from './extraction.ts'
import { OutboxStateSchema, PushIntentKindSchema } from './push.ts'
import { ReviewFieldSchema } from './review.ts'

/** Which of the four surfaces a query hit. */
export const HistoryMatchWhereSchema = z.enum(['transcript', 'notes', 'compteRendu'])
export type HistoryMatchWhere = z.infer<typeof HistoryMatchWhereSchema>

export const HistoryMatchSchema = z.object({
  where: HistoryMatchWhereSchema,
  /** The hit with a little context either side. Never the whole surface. */
  excerpt: z.string(),
})
export type HistoryMatch = z.infer<typeof HistoryMatchSchema>

/**
 * What became of one intent (DEC-20).
 *
 * `remoteId` is the proof it landed — the outbox persists it in the same
 * transaction that drains, precisely so this row can never claim a push that
 * did not happen. `lastError` is mandatory reading when the state is `failed`:
 * a red row with no sentence is the dead control DEC-26 forbids.
 */
export const HistoryIntentSchema = z.object({
  intentId: z.string().min(1),
  kind: PushIntentKindSchema,
  /** French, the same label the review gate used. */
  label: z.string(),
  state: OutboxStateSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  remoteId: z.string().nullable(),
})
export type HistoryIntent = z.infer<typeof HistoryIntentSchema>

export const HistoryRowSchema = z.object({
  meeting: MeetingSchema,
  /** French, one word: `Validée`, `À valider`, `En cours`… */
  status: z.string(),
  intents: z.array(HistoryIntentSchema),
  /** Empty when the query was empty. Non-empty is *why* the row is in the list. */
  matches: z.array(HistoryMatchSchema),
})
export type HistoryRow = z.infer<typeof HistoryRowSchema>

// ── The filter chips (DEC-25, DEC-31) ───────────────────────────────────────
//
// Four axes, and every one of them is applied **in the main process**, beside
// the text match and for the same reason. A filter the renderer applied would
// need the corpus to apply it to, which is the one thing this channel exists
// not to send. What crosses is the axis, not the rows it eliminated.
//
// Each axis carries its own "any" value rather than being nullable, so the
// chip row always has exactly one pressed chip per group and « no filter » is
// a state the rep can see and press, not the absence of one.

/** How far back. Relative to the main process's clock, never the renderer's. */
export const HistoryPeriodSchema = z.enum(['toute', '7j', '30j', '90j'])
export type HistoryPeriod = z.infer<typeof HistoryPeriodSchema>

/**
 * Where a call sits relative to the one gate (DEC-4), in the rep's words.
 *
 * The three buckets partition the states a call reaches *after* it was held.
 * `idle`, `armed` and `recording` are in none of them on purpose: a meeting
 * that has not happened yet is not a history entry, and `tous` is where it
 * shows.
 */
export const HistoryStatusSchema = z.enum(['tous', 'a-valider', 'validees', 'abandonnees'])
export type HistoryStatus = z.infer<typeof HistoryStatusSchema>

/** Which intent a call produced. The `PushIntentKind`s, plus « toutes ». */
export const HistoryIntentionSchema = z.enum([
  'toutes',
  'crm.task',
  'crm.opportunity',
  'mail.draft',
])
export type HistoryIntention = z.infer<typeof HistoryIntentionSchema>

export const HistoryFilterSchema = z.object({
  /**
   * An exact client name, chosen from the `clients` the last answer carried.
   * Exact rather than fuzzy because the value came from the corpus itself —
   * the free-text half of the search is the query box, right next to it.
   */
  client: z.string().max(200).nullable().default(null),
  periode: HistoryPeriodSchema.default('toute'),
  statut: HistoryStatusSchema.default('tous'),
  intention: HistoryIntentionSchema.default('toutes'),
})
export type HistoryFilter = z.infer<typeof HistoryFilterSchema>

export const HistorySearchResultSchema = z.object({
  /** Echoed back, so a late answer to a stale query can be dropped. */
  query: z.string(),
  /** Echoed for the same reason, because a chip changes the answer too. */
  filter: HistoryFilterSchema,
  /**
   * How many meetings the main process read to answer.
   *
   * Not decoration: it is the observable difference between searching here and
   * shipping every transcript to the renderer, and a test asserts on it.
   */
  scanned: z.number().int().nonnegative(),
  /**
   * The client names the chips offer, most recent first.
   *
   * Facet values, not rows: the renderer cannot compute this list without the
   * corpus, so the main process computes it over everything it scanned — before
   * the filter, or selecting a client would erase every other chip.
   */
  clients: z.array(z.string()),
  rows: z.array(HistoryRowSchema),
})
export type HistorySearchResult = z.infer<typeof HistorySearchResultSchema>

/**
 * One expanded row: the whole record of a call.
 *
 * The four sections of DEC-25, in the order the screen draws them — transcript
 * with speaker channels, the rep's raw notes, the enhanced compte-rendu, the
 * extraction with each field's source span — plus what became of each intent.
 */
export const HistoryRecordSchema = z.object({
  meeting: MeetingSchema,
  /** Final segments only. Interim text was never persisted (DEC-12, DEC-21). */
  segments: z.array(TranscriptSegmentSchema),
  /**
   * What the rep typed, flattened to text. A permanent separate layer (DEC-5):
   * whatever the agent wrote at meeting end, this is still what was typed.
   */
  notes: z.string(),
  /** Null when the meeting never reached the gate. */
  compteRendu: z.string().nullable(),
  /** Each with its cited span, and a measured confidence (DEC-21). */
  fields: z.array(ReviewFieldSchema),
  overall: ConfidenceSchema,
  intents: z.array(HistoryIntentSchema),
})
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>
