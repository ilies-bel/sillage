/**
 * `ExtractionESN` — the deterministic/interpretive split, enforced by types
 * (DEC-7, ARCHITECTURE.md §5.E).
 *
 * The model's hallucination surface is exactly the set of fields we let it
 * invent, so `LlmInterpretation` is a **strict** schema with no field for an
 * email, a date, an account code or an attendee name. A model that emits one
 * fails validation instead of being believed.
 */
import { z } from 'zod'
import { AttendeeSchema, TimestampSchema } from './meeting.ts'
import { RecipeIdSchema } from './recipes.ts'
import { TranscriptSpanSchema } from './transcript.ts'

/**
 * Measured, never self-reported (DEC-21). Produced by
 * `core/domain/spanVerification.ts` after checking the cited quote really
 * occurs in the stored transcript — the model never writes this.
 */
export const ConfidenceSchema = z.enum(['ok', 'faible'])
export type Confidence = z.infer<typeof ConfidenceSchema>

/**
 * One interpretive value and the transcript span it was read from.
 *
 * There is no `confidence` here on purpose. The model supplies `value` and
 * `span`; the app derives the confidence. A confident hallucination reports
 * high confidence by definition, so the model's own opinion is worthless.
 */
export const cited = <T extends z.ZodType>(inner: T) =>
  z.strictObject({ value: inner, span: TranscriptSpanSchema })

export type Cited<T> = { value: T; span: z.infer<typeof TranscriptSpanSchema> }

export const ModeCollaborationSchema = z.enum([
  'régie',
  'forfait',
  'assistance technique',
  'inconnu',
])
export type ModeCollaboration = z.infer<typeof ModeCollaborationSchema>

export const ProfilRechercheSchema = z.strictObject({
  intitule: z.string(),
  seniorite: z.string(),
  stack: z.array(z.string()),
  nombre: z.number().int().positive(),
})

export const TjmSchema = z.strictObject({
  montant: z.number(),
  devise: z.string(),
  fourchette: z.string().nullable(),
})

export const ObjectionSchema = z.strictObject({
  objection: z.string(),
  reponseApportee: z.string().nullable(),
})

export const ProchaineEtapeSchema = z.strictObject({
  action: z.string(),
  responsable: z.string(),
  echeance: z.string(),
})

/**
 * The only thing the model produces.
 *
 * Every field is strict and every field is cited. `dateDemarrage` and
 * `dureeMission` are free text (`"septembre"`, `"6 mois renouvelables"`) rather
 * than dates — a spoken approximation is interpretation, and typing it as a
 * date would invite the model to invent a precision nobody said out loud.
 * Real dates come from the calendar (see `DeterministicFacts`).
 *
 * ## Why every typed field is nullable now (DEC-43)
 *
 * A recipe declares which of these it extracts, and the free recipe declares
 * none: it produces `compteRendu` and nothing else. Three fields — `besoin`,
 * `modeCollaboration`, `contexteTechnique` — used to be required, which encoded
 * « every meeting is a prise de besoin » into the type itself.
 *
 * Nullable is **absence**, not weakness. A field whose quote could not be
 * verified is still present and marked `faible` in the `VerificationReport`
 * (DEC-21, see `toExtraction.ts`); null means this recipe never asked for it, or
 * the ESN recipe asked and nothing was said. `recipe` is what tells the two
 * apart, which is why it is stored on the interpretation and not only on the
 * meeting: the gate and Historique render *what produced this document*, which
 * may not be what the meeting is set to produce next.
 */
export const LlmInterpretationSchema = z.strictObject({
  /**
   * Which recipe produced this. Defaulted rather than required because the log
   * is permanent (`events.ts`): every `extraction.completed` written before
   * recipes existed came out of the ESN recipe, and must still replay.
   */
  recipe: RecipeIdSchema.default('besoin-commercial'),
  /** The rendered compte-rendu, French, markdown (HR-6, DEC-13). */
  compteRendu: z.string(),
  besoin: cited(z.string()).nullable(),
  profilsRecherches: z.array(cited(ProfilRechercheSchema)),
  modeCollaboration: cited(ModeCollaborationSchema).nullable(),
  tjmEvoque: cited(TjmSchema).nullable(),
  dateDemarrage: cited(z.string()).nullable(),
  dureeMission: cited(z.string()).nullable(),
  contexteTechnique: cited(z.string()).nullable(),
  objections: z.array(cited(ObjectionSchema)),
  prochainesEtapes: z.array(cited(ProchaineEtapeSchema)),
})
export type LlmInterpretation = z.infer<typeof LlmInterpretationSchema>

/**
 * The interpretation a free-form recipe produces: the narrative, and nothing
 * claimed about the meeting's commercial shape.
 *
 * A helper rather than nine literals at each call site, because the failure it
 * prevents is silent — a caller that forgets one field gets an empty array where
 * the honest answer is « this recipe never asked », and the two are
 * indistinguishable once stored.
 */
export const freeFormInterpretation = (
  recipe: LlmInterpretation['recipe'],
  compteRendu: string,
): LlmInterpretation => ({
  recipe,
  compteRendu,
  besoin: null,
  profilsRecherches: [],
  modeCollaboration: null,
  tjmEvoque: null,
  dateDemarrage: null,
  dureeMission: null,
  contexteTechnique: null,
  objections: [],
  prochainesEtapes: [],
})

/** A resolved account, in domain language. No CRM vocabulary here (DEC-29). */
export const AccountRefSchema = z.object({
  accountId: z.string().nullable(),
  name: z.string(),
  confidence: ConfidenceSchema,
})
export type AccountRef = z.infer<typeof AccountRefSchema>

/**
 * Read from Graph and the CRM. The model never sees these as its job (DEC-7,
 * VISION.md §5.2).
 */
export const DeterministicFactsSchema = z.object({
  /** Graph `event.subject`, editable at the gate. */
  taskName: z.string(),
  /** Graph `event.start` / `event.end`. */
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  /** Graph `attendees[]` + `organizer` — never read off the transcript. */
  interlocuteurs: z.array(AttendeeSchema),
  /**
   * The authenticated rep (MSAL account), and **null when nobody is signed in**.
   *
   * Nullable because a compte-rendu does not depend on it. It names the rep on
   * the document's header line and it removes the rep from `interlocuteurs`;
   * neither is worth the whole extraction. Requiring it made Microsoft a
   * prerequisite of the one feature the product is for, on a machine where
   * Microsoft is optional by decision (DEC-26) — a meeting recorded,
   * transcribed and then silently left un-analysed because nobody had signed
   * into Outlook.
   */
  repEmail: z.string().nullable(),
  account: AccountRefSchema,
  /** Contacts already known to the CRM, matched by attendee email. */
  knownContactIds: z.array(z.string()),
})
export type DeterministicFacts = z.infer<typeof DeterministicFactsSchema>

export const ExtractionESNSchema = z.object({
  facts: DeterministicFactsSchema,
  interpretation: LlmInterpretationSchema,
})
export type ExtractionESN = z.infer<typeof ExtractionESNSchema>

/**
 * Where a meeting's compte-rendu has got to, for the one screen that has to say
 * so out loud.
 *
 * This exists because the honest answer used to be nowhere. A meeting whose
 * enhancement could not run stayed in `ended` — a state the session screen
 * draws no control for and the review gate refuses — so the rep watched a
 * recording finish and then nothing at all happen, with the reason sitting in a
 * diagnostic log they have no cause to open. « Rien ne s'est passé » is the one
 * outcome a tool like this may never produce silently.
 *
 * **Computed, never stored.** Every field is derivable at read time from the
 * meeting's state, whether a provider is configured *now*, and whether a run is
 * in flight — so there is no projection column to migrate and no persisted
 * value that can outlive the truth. A rep who configures a model has a status
 * that changed because the world changed, not because something remembered to
 * write a row.
 */
export const EnhancementStatusSchema = z.discriminatedUnion('status', [
  /** Not waiting on anything: still recording, already extracted, or aborted. */
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('running') }),
  /**
   * Ended, and no model to analyse it with. The transcript and the rep's notes
   * are safe; this is a promise the app has to keep, not a failure.
   */
  z.object({ status: z.literal('waitingForModel') }),
  /**
   * Ended, a model exists, and either an attempt failed or none has run.
   * `reason` is null in the second case — the honest answer to "why not" when
   * the app has simply not tried yet, after a restart.
   */
  z.object({ status: z.literal('failed'), reason: z.string().nullable() }),
])
export type EnhancementStatus = z.infer<typeof EnhancementStatusSchema>

/**
 * The result of running `spanVerification` over an extraction: one entry per
 * interpretive field, keyed by a dotted path (`profilsRecherches.0`). The
 * review screen reads this to decide which fields wear `⚠ faible` (DEC-21).
 */
export const VerificationReportSchema = z.object({
  fields: z.record(z.string(), ConfidenceSchema),
  /** `faible` if any field is. Drives the `⚠` on the account row. */
  overall: ConfidenceSchema,
})
export type VerificationReport = z.infer<typeof VerificationReportSchema>
