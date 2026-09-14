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
import { AttendeeSchema, MeetingSchema } from './meeting.ts'
import { TranscriptSegmentSchema } from './transcript.ts'
import { MomentMarkSchema } from './marks.ts'
import { ConfidenceSchema } from './extraction.ts'
import { OutboxStateSchema, PushIntentKindSchema } from './push.ts'
import { ReviewFieldSchema } from './review.ts'

/**
 * Which of the five surfaces a query hit.
 *
 * **`meeting` was missing, and it is the one a rep types first.** The three
 * below are all *contents of a call*, so a search for « Néovia » — the client
 * name this very screen offers as a filter chip, one row above the box —
 * returned nothing unless somebody had happened to say the word out loud and the
 * transcriber had happened to spell it that way. Anything before the gate was
 * unreachable by name entirely: a scheduled call has no transcript, no notes and
 * no compte-rendu, and the search *replaces* the day list while it is active, so
 * the row was not visible either.
 *
 * The comment on this line said « four surfaces » over a three-value enum, which
 * is how long the omission had been half-noticed.
 *
 * **`marks` is the fifth, and it is the only one a rep can write from inside the
 * call** (`core/contracts/marks.ts`). A mark is typed one-handed over a client's
 * face, capped at 280 characters, drawn by the widget and by both readers — and
 * reached by no search, so « prix : ils bloquent à 550 » was in the record and
 * `550` did not find it. The surface the product built for a rep who is talking
 * was write-only.
 */
export const HistoryMatchWhereSchema = z.enum([
  'meeting',
  'marks',
  'transcript',
  'notes',
  'compteRendu',
])
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
   * How many meetings the main process read to answer — the whole corpus.
   *
   * Not decoration: it is the observable difference between searching here and
   * shipping every transcript to the renderer. **It was read by a test and by no
   * screen**, which is exactly the `diag:appended` shape — published, subscribed
   * to by nobody — one level down, in a payload field rather than a channel; and
   * it was the field that could have said the scan itself had stopped at five
   * hundred meetings while `capped` reported only the *result* cap. The scan
   * reads everything now, and *Historique* draws this number in the sentence
   * that says the list was truncated, so « fifty of how many » is answered
   * instead of assumed.
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
  /**
   * **Whether the cap was reached**, which the screen had no way to know.
   *
   * `history:search` stops at `limit` rows and said nothing, while the eight-row
   * preview a rep arrives *from* draws « Les premiers résultats — l'historique
   * les porte tous. » An ESN rep passes fifty calls matching « TJM » inside a
   * year, and from that point the screen that was just promised to carry all of
   * them silently carried fifty. Optional, so every stub and every call written
   * before this keeps working.
   *
   * **It is the `limit`th match that is not hidden.** This was `rows.length >=
   * limit`, so exactly fifty matches with nothing left over still drew « Affinez
   * la recherche pour en voir d'autres » — a screen telling a rep to narrow a
   * search that was already complete. The handler now collects one row past the
   * limit, drops it, and reports whether it existed.
   *
   * **And it is the only thing allowed to answer that question.** The fix above
   * landed in the handler, and the two screens that had *not* read this field
   * kept the arithmetic it replaced: the calendar's pane compared its own row
   * count to `RESULT_LIMIT`, the backlog section compared its own total to
   * `PENDING_LIMIT`, and both were the same off-by-one one layer out — eight
   * matches with nothing hidden sent a rep to *Historique* for results that do
   * not exist, and exactly fifty calls owed read « 50+ » over « Toutes › ».
   * `useHistorySearch` derives it once now, so no screen counts rows.
   *
   * **It is set for the plain listing too**, and that is not a defect — fifty of
   * sixty calls is a truncation whether or not anything was typed. What *was* a
   * defect is reading it as « a search was truncated »: *Historique*'s sentence
   * named « affinez la recherche » over an empty box, which is a remedy that is
   * not available. A screen drawing anything from this asks what question was
   * answered — both halves are echoed back beside it for exactly that.
   */
  capped: z.boolean().optional(),
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
  /**
   * The client-side people on the call, from the calendar (DEC-7).
   *
   * Carried so the reader can name the far speaker when there is exactly one of
   * them — the channel is measured by the hardware and the name comes from
   * Graph, so the join is a fact (`speakerLabel`). Empty for a meeting that
   * never reached an extraction, which is the correct answer: the app has
   * nobody to name.
   */
  interlocuteurs: z.array(AttendeeSchema),
  /** Each with its cited span, and a measured confidence (DEC-21). */
  fields: z.array(ReviewFieldSchema),
  overall: ConfidenceSchema,
  intents: z.array(HistoryIntentSchema),
  /**
   * The rep's own bookmarks (`core/contracts/marks.ts`). The reader here and
   * the reader at the gate draw the same record, so they draw the same marks —
   * two screens showing one call differently is two things to reconcile.
   */
  marks: z.array(MomentMarkSchema).default([]),
})
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>
