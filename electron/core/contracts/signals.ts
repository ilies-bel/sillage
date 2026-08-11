/**
 * The in-call signal rail (DEC-14).
 *
 * Read-only chips that appear beside the notepad while the call runs. They are
 * proof of value, not a working surface: they append at the bottom, never
 * reorder, never animate, and **never enter the rep's document**.
 */
import { z } from 'zod'
import { TimestampSchema } from './meeting.ts'
import { TranscriptSpanSchema } from './transcript.ts'

/** French, because the label is rendered verbatim (HR-6). */
export const SignalKindSchema = z.enum([
  'tjm',
  'profil',
  'demarrage',
  'duree',
  'mode',
  'objection',
  'etape',
  'autre',
])
export type SignalKind = z.infer<typeof SignalKindSchema>

export const SignalSchema = z.object({
  id: z.string().min(1),
  /**
   * Append order. The rail renders by ascending `seq` and nothing else, which
   * is what makes "never reorders" a property of the data rather than a promise
   * about the component.
   */
  seq: z.number().int().nonnegative(),
  kind: SignalKindSchema,
  /** What the chip shows, e.g. `TJM 520 €`. Already French, already short. */
  label: z.string().min(1),
  source: TranscriptSpanSchema,
  createdAt: TimestampSchema,
})
export type Signal = z.infer<typeof SignalSchema>
