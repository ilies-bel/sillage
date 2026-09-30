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
  /*
   * Also no `min(1)`: same screen, same argument. A rep who selects the whole
   * compte-rendu in « Modifier » and deletes it has done something they can undo
   * — and `draftIntents` already refuses a task with no description, on the row,
   * in French. Rejecting the confirmation instead would discard every other
   * correction they had made alongside it.
   */
  compteRendu: z.string(),

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

  /**
   * The relance draft. A draft, never a send (HR-8).
   *
   * **No `min(1)`, for the reason spelled out on `taskName` forty lines up** —
   * and these three carried one anyway. Clear the objet of the draft (there is
   * no guard on the field and no reason for one), read both columns, and
   * *Valider* arms normally, « Valider malgré 1 champ non vérifié ». Pressing it
   * put a raw English Zod blob across the top of the gate —
   * `[{"origin":"string","code":"too_small",…,"message":"Too small: expected
   * string to have >=1 characters"}]` — and **nothing shipped**: not the task,
   * not the opportunity, not the draft.
   *
   * That is the failure DEC-26 exists to prevent, on the one screen in the
   * product that must never lose what the rep is holding, and the fix is the one
   * already written down: a requirement is enforced where it can be *stated*.
   * `draftIntents` marks `mail.draft` unavailable with the reason on the row,
   * the rep types a subject, and the two VerySwing pushes beside it still ship.
   * A schema error can only throw, and Electron's IPC hands the rep whatever it
   * threw.
   */
  mailSubject: z.string().trim().max(400),
  mailBody: z.string().max(20000),
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
  /**
   * **Whether a Microsoft account is connected at all.**
   *
   * `mailTo` is empty in two different situations and the renderer could not
   * tell them apart: no attendees on the invite, or no Entra registration — the
   * build the first demo ships in (DEC-28), where there is no calendar to have
   * attendees in and no mailbox to draft from either. `draftIntents` has taken
   * the distinction since round 25 and gives the row the deeper cause first;
   * the panel did not carry it, so `MailDraft`, on the line the rep reads
   * first, could only say « aucun destinataire ». See `mailBlocker` below.
   */
  mailAccount: z.boolean(),
  /** `faible` when any interpretive field's quote could not be located. */
  overall: ConfidenceSchema,
  intents: z.array(ReviewIntentSchema),
  /**
   * **Where each generated line of the compte-rendu came from** (DEC-21).
   *
   * The eleven rows in the rail each offer a `[source ▸]`; the document beside
   * them offered provenance on quotations only — five followable fragments
   * across twenty-eight substantive lines, and none at all on the twelve
   * bullets. The bullets are the operative half: « Envoyer 3 CV avec TJM avant
   * vendredi » is the commitment that becomes the VerySwing task, and it was the
   * least checkable thing on a screen whose argument is that nothing ships
   * unchecked.
   *
   * Nothing new is claimed. Each entry pairs a line the composer wrote with the
   * span it was written from — the same span `spanVerification` already looked
   * up — so the renderer matches on string equality, never on a heuristic.
   *
   * **Beside the document and never inside it** (DEC-44): VerySwing receives the
   * string the rep read, so a marker written into the text would land in the CRM
   * as literal punctuation.
   */
  sources: z.array(z.object({ text: z.string(), span: TranscriptSpanSchema })),
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

/**
 * **Why no follow-up draft will be created, in the order the causes actually
 * block each other.**
 *
 * Two surfaces on the gate say this about one act, and they said two different
 * things. `draftIntents` gives the row in *Ce qui sera créé* the deeper cause
 * first — `reviewGate.ts` spends nine lines arguing it: on the build the first
 * demo ships in (DEC-28) there is no Entra registration, so « Aucun destinataire
 * au calendrier. » is *a true sentence about the wrong thing*, and a rep reading
 * it goes looking for people to add to a meeting, which is a search that cannot
 * succeed. `MailDraft` in the renderer branched on `to.length` alone and named
 * the shallow one — and its own docblock says it exists precisely because it is
 * « the line the rep reads first », 1 700 px above the row that disagreed with
 * it. Driven on `review-sans-entra`, one frame, both smoke sizes:
 *
 *     « aucun destinataire — aucun brouillon ne sera créé, … »   y 2316
 *     « Aucun compte Microsoft connecté. »                       y  635
 *
 * So the cause lives here, where both may read it. `core/domain/` is not
 * importable from `src/` and never will be; a string duplicated across that
 * boundary is two sentences waiting to drift, which is what this is.
 *
 * `--echo` could not see it: it exempts repetition along a list, and these are
 * two different strings a screen apart. No check compares two sentences about
 * one act.
 */
export type MailBlocker = 'no-account' | 'no-recipients'

/**
 * The blocking cause, or `null` when nothing structural is in the way.
 *
 * The order is the whole point and it is not alphabetical: no account means no
 * calendar to have attendees in *and* no mailbox to draft from, so it outranks
 * an empty recipient list rather than sitting beside it.
 */
export const mailBlocker = (
  mailAccount: boolean,
  recipients: readonly string[],
): MailBlocker | null => {
  if (!mailAccount) return 'no-account'
  if (recipients.length === 0) return 'no-recipients'
  return null
}

/**
 * The same cause as a sentence, for the row in *Ce qui sera créé*.
 *
 * Full stops, because that column is a list of sentences. `MAIL_BLOCKER_CLAUSE`
 * below is the same fact without one, for a line that continues into a
 * consequence.
 */
export const MAIL_BLOCKER_SENTENCE: Record<MailBlocker, string> = {
  'no-account': 'Aucun compte Microsoft connecté.',
  'no-recipients': 'Aucun destinataire au calendrier.',
}

/** The same cause mid-sentence, for the line above the draft. */
export const MAIL_BLOCKER_CLAUSE: Record<MailBlocker, string> = {
  'no-account': 'aucun compte Microsoft connecté',
  'no-recipients': 'aucun destinataire au calendrier',
}
