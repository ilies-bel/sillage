/**
 * Errors are events in the same log (DEC-27, ARCHITECTURE.md §5.I).
 *
 * One store, one query path, one retention mechanism. Two independent
 * retentions: diagnostics expire on a rolling 90 days, meeting content never
 * auto-expires.
 */
import { z } from 'zod'
import { MeetingIdSchema, TimestampSchema } from './meeting.ts'

export const SeveritySchema = z.enum(['debug', 'info', 'warn', 'error'])
export type Severity = z.infer<typeof SeveritySchema>

export const DiagEventSchema = z.object({
  id: z.string().min(1),
  ts: TimestampSchema,
  severity: SeveritySchema,
  /**
   * Stable, greppable, dot-separated: `capture.device.lost`,
   * `crm.probe.fieldMissing`, `outbox.retry`. The code is the thing a support
   * conversation quotes, so it must not carry a message's variability.
   */
  code: z.string().min(1),
  /** The emitting module: `capture`, `transcribe`, `crm`, `session`. */
  module: z.string().min(1),
  message: z.string(),
  /**
   * Structured detail. Passed through `core/domain/redactDiagnostics.ts` before
   * it can leave the machine — the redacted export is the one the button
   * reaches first, so this must survive being wrong.
   */
  detail: z.record(z.string(), z.unknown()),
  meetingId: MeetingIdSchema.nullable(),
})
export type DiagEvent = z.infer<typeof DiagEventSchema>

export const RetentionPolicySchema = z.object({
  /** Default 90, configurable. Purged on a rolling basis, on boot. */
  diagnosticsDays: z.number().int().positive(),
  /**
   * Not a setting. Meeting content is deleted by a human or not at all
   * (DEC-23: unvalidated items never expire and never delete).
   */
  meetingContent: z.literal('never'),
})
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>

export const DEFAULT_RETENTION: RetentionPolicy = {
  diagnosticsDays: 90,
  meetingContent: 'never',
}

export const ExportModeSchema = z.enum([
  /**
   * Events, timings, error codes, environment. **No transcript or note
   * content.** Safe to send, and deliberately the effortless one — a bundle
   * full of prospect transcripts sitting in a support mailbox is a GDPR
   * incident.
   */
  'redacted',
  /** Includes client conversation content, and says so before it runs. */
  'full',
])
export type ExportMode = z.infer<typeof ExportModeSchema>

/** The environment block every bundle carries. Contains nothing about a client. */
export const DiagEnvironmentSchema = z.object({
  appVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  osRelease: z.string(),
  electron: z.string(),
  node: z.string(),
  /** The native-arch gate's verdict — the first thing to check on a capture bug. */
  nativeArch: z.string(),
})
export type DiagEnvironment = z.infer<typeof DiagEnvironmentSchema>

export const DiagBundleSchema = z.object({
  mode: ExportModeSchema,
  generatedAt: TimestampSchema,
  environment: DiagEnvironmentSchema,
  events: z.array(DiagEventSchema),
})
export type DiagBundle = z.infer<typeof DiagBundleSchema>

/** What a caller supplies. `id` and `ts` are minted by the sink. */
export interface DiagInput {
  severity: Severity
  code: string
  module: string
  message: string
  detail?: Record<string, unknown>
  meetingId?: string | null
}

/**
 * The emitter, as a port.
 *
 * Every module needs to report failures, and `modules/X` may not import
 * `modules/Y` — so `modules/diagnostics` cannot be imported by `modules/crm`.
 * The orchestrator injects an implementation of this instead. That is not
 * ceremony: it is what keeps the boundary rule true while still putting every
 * error in one log (DEC-27).
 */
export interface DiagRecorder {
  record(input: DiagInput): void
}

/** Discards everything. For unit tests and for boot before the store is open. */
export const NULL_RECORDER: DiagRecorder = { record: () => {} }
