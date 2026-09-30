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

/**
 * **Is this `reason` a sentence written for a rep, or a fragment written for
 * the machine?**
 *
 * `reason` is a free `string` and it is composed at sixteen sites across
 * `modules/capture`, `modules/transcribe`, `app/main.ts`,
 * `app/session/Orchestrator.ts`, `app/session/Recording.ts`,
 * `core/domain/capturePermission.ts` and `core/contracts/essai.ts`. They are not
 * one grade of sentence. Some open on a capital, name the side and end on a
 * remedy; others are a state machine talking to itself — « micro indisponible —
 * ${err.message} » — and five of those end in a JavaScript `Error`’s own words.
 * The widget substitutes its own sentence for the second kind
 * (`src/widget/healthSentence.ts`), because that card is 340px wide and drawn
 * over a live client call.
 *
 * An **allowlist over shapes**, which is the idiom this repo already uses for a
 * foreign payload (`detail` on a diagnostic). Three conditions:
 *
 *   · it opens on an uppercase letter
 *   · it closes on `.`, `!`, `?` or `…`
 *   · it carries at least one character ASCII does not have
 *
 * The third is not decoration. Every user-facing string in this repo is French
 * with the typographic apostrophe U+2019 (`npm run check:french` enforces it),
 * so a sentence the product wrote carries `’`, `—`, `«` or an accent. A
 * JavaScript `Error`’s message does not.
 *
 * **What it does not catch.** A foreign message that is capitalised, terminated
 * *and* non-ASCII passes as ours: Microsoft Graph’s French-locale errors would,
 * if one ever reached `capture` or `transcribe` (today none does — Graph feeds
 * `calendar` and `mail`). Closing that hole needs a field here saying who wrote
 * the string, a `code` or a `written: true`, which is a contract change and a
 * migration. Symmetrically, a sentence of ours that is pure ASCII would be
 * replaced; that direction is safe and no literal in the tree is in it.
 *
 * ## Why it is here and not beside the widget’s table
 *
 * It was in `src/widget/healthSentence.ts`, next to the four sentences the
 * window substitutes, and that file argued — correctly — that the *table* is a
 * property of a 340px card and not of the product. The predicate is not. It
 * asks whether a `reason` is fit for a rep, which is a question about this
 * type, and keeping it in `src/` had a cost the argument did not price: **the
 * renderer may import `core/contracts/` only**, so no test could drive a
 * producer in `core/domain/` through it. `capturePermission.ts`’s `degraded`
 * sentences opened on a lowercase channel name for the life of that file;
 * twelve of the twenty-one status pairs that produce a health were being thrown
 * away and replaced by a sentence that names no side, on the state DEC-32
 * reserves for « one channel is missing ». The corpus that was supposed to
 * catch it held hand-written samples of sentences the product cannot emit, and
 * it could not have held anything else from where it sat.
 */
const OPENS = /^\p{Lu}/u
const CLOSES = /[.!?…]$/u
const FRENCH = /[^\u0000-\u007F]/u

export const isWrittenSentence = (reason: string | null | undefined): boolean => {
  if (typeof reason !== 'string') return false
  const text = reason.trim()
  if (text === '') return false
  return OPENS.test(text) && CLOSES.test(text) && FRENCH.test(text)
}
