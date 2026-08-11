/**
 * Meeting identity, calendar context and the session state vocabulary.
 *
 * `MeetingContext` is the deterministic-fact source (DEC-15). Everything in it
 * comes from Microsoft Graph and none of it is ever produced by a model (DEC-7).
 */
import { z } from 'zod'

/** Opaque, app-minted. Not the Graph event id — a meeting can exist without one. */
export const MeetingIdSchema = z.string().min(1)
export type MeetingId = z.infer<typeof MeetingIdSchema>

export const AttendeeTypeSchema = z.enum(['required', 'optional', 'resource'])
export type AttendeeType = z.infer<typeof AttendeeTypeSchema>

export const ResponseStatusSchema = z.enum([
  'none',
  'organizer',
  'tentativelyAccepted',
  'accepted',
  'declined',
  'notResponded',
])
export type ResponseStatus = z.infer<typeof ResponseStatusSchema>

/**
 * `email` is deliberately not `z.email()`. Graph returns room resources and
 * on-premises mailboxes whose SMTP address does not round-trip through a strict
 * RFC check, and dropping an attendee is worse than carrying an odd string:
 * attendee surnames are the highest-value STT boost terms in the product
 * (DEC-17) and the address is the primary entity-resolution key (DEC-18).
 */
export const AttendeeSchema = z.object({
  name: z.string(),
  email: z.string(),
  type: AttendeeTypeSchema,
  response: ResponseStatusSchema,
})
export type Attendee = z.infer<typeof AttendeeSchema>

export const SensitivitySchema = z.enum(['normal', 'personal', 'private', 'confidential'])
export type Sensitivity = z.infer<typeof SensitivitySchema>

/** Epoch milliseconds, UTC. The app has exactly one time representation. */
export const TimestampSchema = z.number().int()

export const MeetingContextSchema = z.object({
  /** Graph `event.id`. Null for a manually started session with no calendar entry. */
  eventId: z.string().nullable(),
  subject: z.string(),
  /** Graph `event.bodyPreview` — the agenda, as text. Never the full HTML body. */
  agenda: z.string(),
  organizer: AttendeeSchema,
  attendees: z.array(AttendeeSchema),
  onlineMeetingJoinUrl: z.string().nullable(),
  categories: z.array(z.string()),
  sensitivity: SensitivitySchema,
  scheduledStart: TimestampSchema,
  /** Bounds the session and sizes the end-of-meeting grace window (DEC-16). */
  scheduledEnd: TimestampSchema,
  /** Links the calls in a recurring series (DEC-15). Deferred in step 3. */
  seriesMasterId: z.string().nullable(),
  /** IANA zone the event was read in. Always `Europe/Paris` in v1. */
  timeZone: z.string(),
})
export type MeetingContext = z.infer<typeof MeetingContextSchema>

/**
 * Arming is a pure decision over a calendar event plus the current audio state
 * (`core/domain/arming.ts`, step 3). `wait` carries the instant to re-evaluate,
 * so the caller never polls on a guess.
 */
export const ArmingDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('arm'), reason: z.string() }),
  z.object({ action: z.literal('wait'), untilMs: TimestampSchema, reason: z.string() }),
  z.object({ action: z.literal('skip'), reason: z.string() }),
])
export type ArmingDecision = z.infer<typeof ArmingDecisionSchema>

/**
 * The session state machine's vocabulary. Declared here rather than in
 * `app/session/` because the renderer reads it and the renderer may import
 * `core/contracts/` only.
 */
export const MeetingStateSchema = z.enum([
  'idle',
  'armed',
  'recording',
  'ended',
  'extracting',
  'awaiting_confirmation',
  'pushing',
  'done',
  'aborted',
])
export type MeetingState = z.infer<typeof MeetingStateSchema>

/**
 * Everything that can move the machine. Declared beside the states because a
 * transition table is only readable when both halves of it are in one place.
 */
export const SessionCommandSchema = z.enum([
  'arm',
  'disarm',
  'start',
  'end',
  'abort',
  'extract',
  'extractionSucceeded',
  'extractionFailed',
  'confirm',
  'pushSettled',
])
export type SessionCommand = z.infer<typeof SessionCommandSchema>

/**
 * The subset a human may issue. The rest are reported *by* modules as work
 * completes — the renderer cannot claim an extraction succeeded, and a module
 * cannot confirm on the rep's behalf (HR-7: a human confirms or it does not
 * ship).
 */
export const UserCommandSchema = z.enum(['start', 'end', 'abort', 'extract', 'confirm'])
export type UserCommand = z.infer<typeof UserCommandSchema>

/**
 * A projection row, not a source of truth. Rebuildable by folding the event
 * log (ARCHITECTURE.md §5.C). Never written to directly.
 */
export const MeetingSchema = z.object({
  id: MeetingIdSchema,
  state: MeetingStateSchema,
  title: z.string(),
  eventId: z.string().nullable(),
  /** Resolved client display name, when one is known. Not a CRM identifier. */
  clientName: z.string().nullable(),
  /**
   * The day this meeting belongs on — `context.scheduledStart` for a meeting
   * that came from the calendar, the day the rep placed it on for one they
   * created by hand (DEC-31).
   *
   * Null only for a meeting started for right now with no calendar entry, where
   * `createdAt` *is* the day. It is here and not derived in the renderer
   * because « le calendrier est toujours dessiné » means a meeting created on
   * Tuesday for Thursday has to be drawn on Thursday after a restart, and a
   * value the projection does not carry is a value the grid cannot place.
   */
  scheduledStart: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema.nullable(),
  confirmedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
})
export type Meeting = z.infer<typeof MeetingSchema>
