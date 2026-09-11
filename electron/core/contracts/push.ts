/**
 * What one confirmation fans out into (DEC-4, DEC-20) and how the outbox
 * tracks it (ARCHITECTURE.md §5.F).
 *
 * Up to three intents ship per confirmation and they form a **DAG, not a
 * queue**: the opportunity must land before the task that carries its
 * reference, while the Outlook draft is independent and must ship even when
 * the CRM is unreachable (DEC-26).
 */
import { z } from 'zod'
import { MeetingIdSchema, TimestampSchema } from './meeting.ts'

export const PushIntentKindSchema = z.enum(['crm.task', 'crm.opportunity', 'mail.draft'])
export type PushIntentKind = z.infer<typeof PushIntentKindSchema>

/** The compte-rendu itself, in domain language. `modules/crm/` maps it. */
export const CompteRenduPayloadSchema = z.object({
  title: z.string(),
  /** Rendered markdown of the rep's document. */
  body: z.string(),
  accountId: z.string().nullable(),
  opportunityRef: z.string().nullable(),
  contactIds: z.array(z.string()),
  dueAt: TimestampSchema,
  endsAt: TimestampSchema,
})
export type CompteRenduPayload = z.infer<typeof CompteRenduPayloadSchema>

export const OpportunityPayloadSchema = z.object({
  title: z.string(),
  description: z.string(),
  accountId: z.string(),
  amount: z.number(),
  currency: z.string(),
  closingDate: TimestampSchema,
  contextDescription: z.string(),
  technicalEnvDescription: z.string(),
  profileDescription: z.string(),
  startingDate: TimestampSchema.nullable(),
})
export type OpportunityPayload = z.infer<typeof OpportunityPayloadSchema>

export const MailDraftPayloadSchema = z.object({
  subject: z.string(),
  body: z.string(),
  to: z.array(z.string()),
})
export type MailDraftPayload = z.infer<typeof MailDraftPayloadSchema>

export const PushIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    meetingId: MeetingIdSchema,
    kind: z.literal('crm.task'),
    /** Intent ids that must be drained first. A failed dependency blocks only its dependants. */
    dependsOn: z.array(z.string()),
    payload: CompteRenduPayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    meetingId: MeetingIdSchema,
    kind: z.literal('crm.opportunity'),
    dependsOn: z.array(z.string()),
    payload: OpportunityPayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    meetingId: MeetingIdSchema,
    kind: z.literal('mail.draft'),
    dependsOn: z.array(z.string()),
    payload: MailDraftPayloadSchema,
  }),
])
export type PushIntent = z.infer<typeof PushIntentSchema>

export const PushResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    intentId: z.string(),
    /** The id the remote system returned. Persisted in the same transaction that drains. */
    remoteId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    intentId: z.string(),
    reason: z.string(),
    /** False for a 4xx we caused — retrying it forever is how a queue jams. */
    retryable: z.boolean(),
    /**
     * **How long the server said to wait, when it said.**
     *
     * `429` is the one status that states the request was *not processed*, and
     * it is the only one that returns a row to `pending`. Both adapters parsed
     * `Retry-After` — `VsaError.retryAfterMs`, `GraphError.retryAfterMs` — and
     * both dropped it at this boundary, so the outbox answered « wait 120
     * seconds » with a re-POST after one, three times a pass and again on every
     * launch. Against Graph's mailbox throttling that is the pattern that
     * *extends* a throttle rather than clearing it.
     *
     * Optional rather than required: every `push.settled` written before this
     * existed must still replay (the `LlmInterpretation.recipe` rule), and most
     * failures carry no `Retry-After` at all.
     */
    retryAfterMs: z.number().int().nonnegative().nullable().optional(),
  }),
])
export type PushResult = z.infer<typeof PushResultSchema>

export const OutboxStateSchema = z.enum([
  /** Ready to drain. */
  'pending',
  /** A dependency has not drained yet, or has failed. */
  'blocked',
  /** A request is in flight. */
  'draining',
  /** Succeeded. `remoteId` is set. **Never re-posted** — there is no idempotency key. */
  'drained',
  /** Terminally failed. The rep can retry from the UI; the app will not. */
  'failed',
])
export type OutboxState = z.infer<typeof OutboxStateSchema>

/**
 * A projection row (rebuildable from the log), with one exception that matters:
 * `remoteId` is the record that stops a double-create. `POST /v1/crm/tasks` has
 * no idempotency key, so a drained intent must never be re-posted, and the id
 * has to be written in the same transaction that marks it drained.
 */
export const OutboxEntrySchema = z.object({
  intentId: z.string().min(1),
  meetingId: MeetingIdSchema,
  kind: PushIntentKindSchema,
  state: OutboxStateSchema,
  dependsOn: z.array(z.string()),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  remoteId: z.string().nullable(),
  updatedAt: TimestampSchema,
})
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>
