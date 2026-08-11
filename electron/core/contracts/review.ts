/**
 * The review gate's payloads (DEC-4, DEC-6, DEC-18, DEC-20, DEC-21, DEC-23).
 *
 * This is the only human confirmation in the product, so the shapes here are
 * deliberately narrow.
 *
 * ## The gate is a closed union, not a hidden panel
 *
 * `ReviewSnapshot` is discriminated on `open`. When the meeting is `recording`
 * the response carries **no panel at all** — not an empty one, not a disabled
 * one. There is nothing for the renderer to leak, badge or count, which is what
 * makes DEC-23 structural rather than a rule somebody has to remember.
 *
 * ## What the rep may edit
 *
 * `ReviewEdits` is exactly the set of values that reach an external system, and
 * it is what `review:confirm` takes back. Everything else on the screen is
 * read-only: attendee names, e-mail addresses and dates come from Graph and the
 * CRM (DEC-7), and confidence is measured by the app (DEC-21) — a renderer that
 * could send those could send a model's opinion of them.
 */
import { z } from 'zod'
import { AttendeeSchema, MeetingSchema, MeetingStateSchema } from './meeting.ts'
import { AccountRefSchema, ConfidenceSchema } from './extraction.ts'
import { TranscriptSpanSchema } from './transcript.ts'
import { PushIntentKindSchema } from './push.ts'

/**
 * The form, pre-filled from the extraction and posted back as the rep left it.
 *
 * Every field is a string or a number because the gate edits *values*, not
 * schemas: a rep correcting « 2× Dev Java senior » to « 3× Dev Java senior »
 * must not have to satisfy `ProfilRechercheSchema`. The structured extraction
 * stays in the log untouched; this is what gets sent.
 *
 * There is no `to` for the mail and no `confidence` anywhere. Recipients are
 * deterministic (DEC-7) and confidence is measured (DEC-21); both are computed
 * in the main process and neither is accepted from the renderer.
 */
export const ReviewEditsSchema = z.object({
  /**
   * The CRM task's `taskName`. VSA requires one, and it may still arrive here
   * blank — a meeting started by hand carries no subject and nothing invents one
   * (see `modules/extract/facts.ts`).
   *
   * So the requirement is enforced where it can be *stated* rather than where it
   * can only throw: `draftIntents` marks `crm.task` unavailable with the reason
   * on the row (DEC-26), and the rep types the objet at the gate. `min(1)` here
   * would instead reject the whole confirmation with a schema error, on the one
   * screen in the product that must never lose what the rep is holding.
   */
  taskName: z.string().trim().max(300),
  /**
   * The account the rep left in the field, blank while the CRM has not matched
   * one. It used to be pre-filled with « Client à confirmer » so that DEC-18's
   * "never an empty account field" held literally — a phrase that then travelled
   * into `meetings.client_name` and the lexicon scope as though it were a name.
   * `⚠ faible` on the row is the part of DEC-18 that was doing the work.
   *
   * `accountId` is null while the account is unresolved, which is what makes the
   * opportunity undraftable (DEC-20) — that gate is unchanged.
   */
  accountId: z.string().nullable(),
  accountName: z.string().trim().max(300),
  /** The rendered compte-rendu, as the rep left it. Lands in `taskDescription`. */
  compteRendu: z.string().min(1),

  // The interpretive rows, in the order VISION.md §6 draws them.
  besoin: z.string().max(4000),
  profils: z.string().max(4000),
  modeCollaboration: z.string().max(400),
  tjm: z.string().max(400),
  dateDemarrage: z.string().max(400),
  dureeMission: z.string().max(400),
  contexteTechnique: z.string().max(4000),
  objections: z.string().max(4000),
  prochainesEtapes: z.string().max(4000),

  /** The opportunity's amount. Null when no TJM was evoked. */
  montant: z.number().nullable(),
  devise: z.string().max(8),

  /** The relance draft. A draft, never a send (HR-8). */
  mailSubject: z.string().trim().min(1).max(400),
  mailBody: z.string().min(1).max(20000),
})
export type ReviewEdits = z.infer<typeof ReviewEditsSchema>

/** The keys of `ReviewEdits` a `[source ▸]` affordance can be attached to. */
export const ReviewFieldKeySchema = z.enum([
  'taskName',
  'account',
  'besoin',
  'profils',
  'modeCollaboration',
  'tjm',
  'dateDemarrage',
  'dureeMission',
  'contexteTechnique',
  'objections',
  'prochainesEtapes',
])
export type ReviewFieldKey = z.infer<typeof ReviewFieldKeySchema>

/**
 * One row of the form: what to call it, how confident the app is, and where the
 * value came from.
 *
 * `confidence` is read off the `VerificationReport`, never off the model
 * (DEC-21). `span` is what `[source ▸]` reveals; it is null only for the two
 * rows that were never interpreted in the first place — the task name and the
 * account, both deterministic (DEC-7).
 */
export const ReviewFieldSchema = z.object({
  key: ReviewFieldKeySchema,
  /** French. The label the rep reads. */
  label: z.string(),
  confidence: ConfidenceSchema,
  span: TranscriptSpanSchema.nullable(),
})
export type ReviewField = z.infer<typeof ReviewFieldSchema>

/**
 * One checkbox (DEC-20). All three are drafted automatically; each can be
 * unchecked, and unchecking is recorded rather than inferred.
 *
 * `available: false` is not the same as unchecked: it means the intent cannot
 * be drafted at all — an opportunity against an unresolved account, a mail with
 * nobody to send it to — and `reason` says which, inline, because a disabled
 * control always states why (DEC-26).
 */
export const ReviewIntentSchema = z.object({
  /** Deterministic: `${meetingId}:${kind}`. Stable between get and confirm. */
  id: z.string().min(1),
  kind: PushIntentKindSchema,
  /** French, for the checkbox. */
  label: z.string(),
  /** One line of what will actually be written. */
  summary: z.string(),
  available: z.boolean(),
  reason: z.string().nullable(),
})
export type ReviewIntent = z.infer<typeof ReviewIntentSchema>

export const ReviewPanelSchema = z.object({
  meeting: MeetingSchema,
  /** The pre-filled form. Exactly the shape `review:confirm` takes back. */
  edits: ReviewEditsSchema,
  fields: z.array(ReviewFieldSchema),
  /**
   * Candidate accounts sharing the resolved one's group, listed inline under
   * the field (DEC-18, mitigation *a*): the rep sees that a choice exists
   * rather than discovering it after the push. Empty until `modules/crm`
   * resolves against VSA (step 8).
   */
  accountCandidates: z.array(AccountRefSchema),
  /** From Graph, read-only on this screen (DEC-7). */
  interlocuteurs: z.array(AttendeeSchema),
  /** Recipients of the draft, derived from the attendees. Read-only. */
  mailTo: z.array(z.string()),
  /** `faible` when any interpretive field's quote could not be located. */
  overall: ConfidenceSchema,
  intents: z.array(ReviewIntentSchema),
})
export type ReviewPanel = z.infer<typeof ReviewPanelSchema>

/**
 * The gate, open or closed.
 *
 * Closed carries a state and a reason and nothing else. A meeting that is
 * `recording` cannot surface a field, a count or a badge from this response
 * because the response does not contain one (DEC-23).
 */
export const ReviewSnapshotSchema = z.discriminatedUnion('open', [
  z.object({ open: z.literal(true), panel: ReviewPanelSchema }),
  z.object({ open: z.literal(false), state: MeetingStateSchema, reason: z.string() }),
])
export type ReviewSnapshot = z.infer<typeof ReviewSnapshotSchema>

export const ReviewConfirmationSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    state: MeetingStateSchema,
    /** What was actually created — the checked intents, in drain order. */
    intentIds: z.array(z.string()),
  }),
  z.object({ ok: z.literal(false), state: MeetingStateSchema, reason: z.string() }),
])
export type ReviewConfirmation = z.infer<typeof ReviewConfirmationSchema>
