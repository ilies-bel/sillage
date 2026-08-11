/**
 * The append-only log's alphabet (DEC-12, ARCHITECTURE.md §5.C).
 *
 * Current state is a fold over these. Crash recovery is replay; nothing is
 * silently mutable. Raw audio is never an event — it is transcribed and
 * discarded at frame level.
 *
 * Adding a variant is additive by construction: readers switch on `type` and
 * old logs stay readable. Changing an existing payload's shape is not — the log
 * is permanent, so a changed field needs a new `type`.
 */
import { z } from 'zod'
import { MeetingContextSchema, MeetingStateSchema, TimestampSchema } from './meeting.ts'
import { RecipeIdSchema } from './recipes.ts'
import { TranscriptSegmentSchema } from './transcript.ts'
import { SignalSchema } from './signals.ts'
import { ExtractionESNSchema, VerificationReportSchema } from './extraction.ts'
import { PushIntentSchema, PushResultSchema } from './push.ts'
import { DiagEventSchema } from './diagnostics.ts'

/**
 * Events not scoped to a meeting — boot, connector health, probe results — go
 * under this reserved `meeting_id` so there is exactly one table and one query
 * path. It is not a valid `MeetingId`; nothing mints it but the store.
 */
export const APP_SCOPE = '~app'

export const MeetingEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meeting.created'),
    title: z.string(),
    context: MeetingContextSchema.nullable(),
    /**
     * The client the rep named when starting a meeting by hand. Null for a
     * calendar-armed session, where the account is resolved from attendee
     * domains at the review gate instead (DEC-18).
     *
     * It lives on the creation event rather than being written straight into
     * the projection because the projections are a fold and nothing else
     * (ARCHITECTURE.md §5.C) — a value written directly would survive until the
     * first rebuild and then quietly disappear. It is a display name and never
     * a CRM identifier (DEC-7); the account is still resolved against VSA.
     *
     * `nullish`, not `nullable().default(null)`: events written before this
     * field existed have no key at all, and they must still replay. A default
     * would make the field required on the way *in* and rewrite history on the
     * way out.
     */
    clientName: z.string().nullish(),
    /**
     * The day and time the rep placed the meeting on, when they placed it
     * somewhere other than now (DEC-31).
     *
     * A meeting created from the calendar carries its schedule inside
     * `context`; one started by hand has no context at all, and without this
     * the only instant it knows is the one it was typed at. That is what used
     * to make « une réunion sur n'importe quel jour » undrawable: a meeting
     * created on Tuesday for Thursday would have sat in Tuesday's cell.
     *
     * `nullish` for the same reason `clientName` is — every event written
     * before this field existed must still replay unchanged.
     */
    scheduledStart: TimestampSchema.nullish(),
  }),
  z.object({ type: z.literal('meeting.context.updated'), context: MeetingContextSchema }),

  /**
   * The rep naming a meeting they started by hand, during or after the call.
   *
   * A meeting now starts on one click and therefore starts with no subject at
   * all — nothing invents « Rendez-vous client » on their behalf, so the objet
   * arrives later or not at all. This is that "later", and it is an event rather
   * than an `UPDATE` for the reason `clientName` is one on `meeting.created`:
   * the projections are a fold and nothing else (ARCHITECTURE.md §5.C), so a
   * value written straight into the table would survive until the first rebuild
   * and then quietly disappear.
   *
   * Both fields are the rep's own words. `clientName` stays a display name and
   * never a CRM identifier (DEC-7); the account is still resolved against VSA at
   * the review gate, and typing one here does not resolve anything.
   */
  z.object({
    type: z.literal('meeting.renamed'),
    title: z.string().max(200),
    /** Null leaves the stored client name alone; `''` is the rep clearing it. */
    clientName: z.string().max(200).nullable(),
  }),

  /**
   * The rep choosing which compte-rendu this meeting produces (DEC-43).
   *
   * An event and not a column, for the reason `meeting.renamed` is one: the
   * projections are a fold and nothing else (ARCHITECTURE.md §5.C). It is also
   * the honest record of a choice that can be made more than once — a rep who
   * switches mid-call and switches back leaves two entries, and the last one
   * wins, which is exactly how the fold reads it.
   *
   * Absent from a meeting's log means the default (`recipes.ts`), not "unknown".
   * Every meeting recorded before this event existed was a prise de besoin.
   */
  z.object({ type: z.literal('meeting.recipe.chosen'), recipe: RecipeIdSchema }),

  /**
   * The transition itself. This is what makes replay reconstruct state rather
   * than infer it: `MeetingSession.replay()` folds these and nothing else.
   */
  z.object({
    type: z.literal('session.transition'),
    from: MeetingStateSchema,
    to: MeetingStateSchema,
    command: z.string(),
    reason: z.string().nullable(),
  }),

  /** Persisted as they arrive, final segments only (DEC-12). */
  z.object({ type: z.literal('transcript.segment'), segment: TranscriptSegmentSchema }),

  /**
   * Every ProseMirror transaction, on a ~500ms debounce (DEC-12). A crash at
   * minute 40 costs at most half a second of typing.
   */
  z.object({
    type: z.literal('document.snapshot'),
    revision: z.number().int().nonnegative(),
    doc: z.unknown(),
  }),

  /** Read-only, rail only. Never enters the document (DEC-14). */
  z.object({ type: z.literal('signal.appended'), signal: SignalSchema }),

  z.object({ type: z.literal('extraction.started'), attempt: z.number().int().positive() }),
  z.object({
    type: z.literal('extraction.completed'),
    extraction: ExtractionESNSchema,
    verification: VerificationReportSchema,
  }),
  z.object({ type: z.literal('extraction.failed'), reason: z.string() }),

  /**
   * The one human gate (DEC-4). `intentIds` is what the rep left checked —
   * unchecking the opportunity is recorded, not inferred from its absence.
   */
  z.object({
    type: z.literal('confirmation.recorded'),
    intentIds: z.array(z.string()),
    at: TimestampSchema,
  }),

  z.object({ type: z.literal('push.intent.created'), intent: PushIntentSchema }),
  z.object({
    type: z.literal('push.attempted'),
    intentId: z.string(),
    attempt: z.number().int().positive(),
  }),
  /**
   * Carries the remote id on success. The outbox projection is folded from
   * this, which is how "persist the id in the same transaction that drains the
   * intent" becomes structural: there is only one write.
   */
  z.object({ type: z.literal('push.settled'), result: PushResultSchema }),

  /** Same log, same retention machinery, different policy (DEC-27). */
  z.object({ type: z.literal('diag'), event: DiagEventSchema }),
])
export type MeetingEvent = z.infer<typeof MeetingEventSchema>

export type MeetingEventType = MeetingEvent['type']

/** An event as it comes back out of the log, with its position. */
export const StoredEventSchema = z.object({
  meetingId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: TimestampSchema,
  event: MeetingEventSchema,
})
export type StoredEvent = z.infer<typeof StoredEventSchema>

/** The only event class the rolling purge may delete (DEC-27). */
export const isDiagnostic = (e: MeetingEvent): boolean => e.type === 'diag'
