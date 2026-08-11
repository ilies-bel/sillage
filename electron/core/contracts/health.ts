/**
 * Degradation is a first-class state, not an error path (DEC-26,
 * ARCHITECTURE.md §5.H).
 *
 * The invariant this file exists to enforce: **a disabled control always states
 * why.** A greyed button with no explanation is the worst possible outcome and
 * it is the default one unless the type makes the reason mandatory — so
 * `reason` is not optional on `degraded` or `down`, by design.
 */
import { z } from 'zod'
import { TimestampSchema } from './meeting.ts'

export const ConnectorIdSchema = z.enum([
  /**
   * Audio in. Listed for completeness only: `capture` has **zero network
   * dependencies**, so it does not degrade because something else did. Nothing
   * downstream may stop a meeting being recorded.
   */
  'capture',
  'transcribe',
  'calendar',
  'llm',
  'crm',
  'mail',
])
export type ConnectorId = z.infer<typeof ConnectorIdSchema>

/**
 * ARCHITECTURE.md §5.H writes this type with a `retry: () => void` member. A
 * function cannot cross the IPC boundary, and health is read by the renderer,
 * so retry is a channel (`health:retry`) rather than a field. `retryable` keeps
 * the affordance discoverable from the data alone: never a dead button.
 */
export const ConnectorHealthSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok') }),
  z.object({
    state: z.literal('degraded'),
    reason: z.string().min(1),
    since: TimestampSchema,
    retryable: z.boolean(),
  }),
  z.object({
    state: z.literal('down'),
    reason: z.string().min(1),
    since: TimestampSchema,
    retryable: z.boolean(),
  }),
])
export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>

export const HealthSnapshotSchema = z.record(ConnectorIdSchema, ConnectorHealthSchema)
export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>
