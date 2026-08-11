/**
 * `CrmPort` — domain verbs only (DEC-29, ARCHITECTURE.md §5.J).
 *
 * **Nothing in this file may name a VerySwing concept** — not the account-code
 * column, not the opportunity id, not the sales-stage referential, not the link
 * type. `scripts/check-crm-containment.mjs` fails the build when one of those
 * identifiers appears outside `modules/crm/vsa/`, and this file is the first
 * place the abstraction would leak.
 *
 * The client will have their own developments on top of VSA. A client-specific
 * field must cost a line in `fieldMap.ts`; a client-specific endpoint, a method
 * on a subclass in `ext/`. Neither may touch this file.
 */
import { z } from 'zod'
import { ConfidenceSchema } from './extraction.ts'
import type { CompteRenduPayload, OpportunityPayload, PushResult } from './push.ts'
import { CompteRenduPayloadSchema, OpportunityPayloadSchema } from './push.ts'

export type { CompteRenduPayload, OpportunityPayload }
export { CompteRenduPayloadSchema, OpportunityPayloadSchema }

/**
 * Why a candidate ranked where it did (VISION.md §5.1). Recorded in the event
 * log so a mis-attribution is diagnosable after the fact rather than invisible
 * (DEC-18).
 */
export const ResolutionSignalSchema = z.enum([
  /** Attendee address matched a contact exactly. Highest confidence. */
  'contact-email',
  /** Address domain matched an account. The bulk case; ambiguous inside holdings. */
  'email-domain',
  /** A colleague on the invite resolved the account for everyone on it. */
  'co-attendee',
  /** Grouped with its siblings under a shared parent. */
  'sibling',
  /** Touched by this rep recently, plus a fuzzy title match. Tie-break only. */
  'recency',
])
export type ResolutionSignal = z.infer<typeof ResolutionSignalSchema>

export const AccountCandidateSchema = z.object({
  accountId: z.string().min(1),
  name: z.string(),
  /**
   * The holding parent, when there is one. Both customers and prospects carry a
   * parent link, so listing siblings is a group-by rather than a heuristic —
   * which is the whole of the DEC-18 mitigation.
   */
  parentAccountId: z.string().nullable(),
  /** 0..1, from the signals below. Rendered as `⚠ faible` when weak. */
  score: z.number().min(0).max(1),
  confidence: ConfidenceSchema,
  signals: z.array(ResolutionSignalSchema),
})
export type AccountCandidate = z.infer<typeof AccountCandidateSchema>

export const AccountQuerySchema = z.object({
  /** Every attendee address on the invite, the rep's own included. */
  attendeeEmails: z.array(z.string()),
  /** The subject line, for the fuzzy tie-break. */
  hint: z.string(),
})
export type AccountQuery = z.infer<typeof AccountQuerySchema>

export const ContactRefSchema = z.object({
  contactId: z.string().min(1),
  name: z.string(),
  email: z.string().nullable(),
  accountId: z.string().nullable(),
})
export type ContactRef = z.infer<typeof ContactRefSchema>

export const ContactDraftSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  job: z.string().nullable(),
  /** Contacts are only ever created **under an existing account** (DEC-18). */
  accountId: z.string().min(1),
})
export type ContactDraft = z.infer<typeof ContactDraftSchema>

// ── The connect-time capability diff (DEC-24) ───────────────────────────────
//
// The adapter's probe produces this and Réglages renders it row by row. It is
// declared here rather than in `modules/crm/` for one reason: `src/*` may
// import `core/contracts/` and nothing else, so a report that only existed
// inside the adapter could never reach the screen it was written for.
//
// Nothing below names a CRM concept. `table`, `column` and `schema` are the
// vocabulary of *any* record store, which is what lets a second adapter report
// the same shape without this file learning a second vendor.

export const CapabilityStateSchema = z.enum([
  /** Present and answering. */
  'ok',
  /** The tenant does not have it — 404, or an empty list. */
  'missing',
  /** It exists and this account may not use it — 403. */
  'denied',
  /** Not checkable without writing. Reported, never silently assumed. */
  'unverified',
])
export type CapabilityState = z.infer<typeof CapabilityStateSchema>

export const CapabilityFindingSchema = z.object({
  id: z.string().min(1),
  /** French. Rendered verbatim (HR-6). */
  label: z.string(),
  /** What stops working when this is absent. French. */
  matters: z.string(),
  required: z.boolean(),
  state: CapabilityStateSchema,
  /** The HTTP status, when there was one. */
  status: z.number().nullable(),
  detail: z.string(),
})
export type CapabilityFinding = z.infer<typeof CapabilityFindingSchema>

/** A field the adapter writes that the remote schema does not declare. */
export const FieldGapSchema = z.object({
  table: z.string(),
  column: z.string(),
  schema: z.string(),
})
export type FieldGap = z.infer<typeof FieldGapSchema>

export const CapabilityReportSchema = z.object({
  at: z.number(),
  /** False when even the sign-in was refused; every other finding is then moot. */
  authenticated: z.boolean(),
  findings: z.array(CapabilityFindingSchema),
  columnGaps: z.array(FieldGapSchema),
  /** True when every `required` capability is `ok`. */
  ok: z.boolean(),
  /** One line for the Réglages banner. French. */
  summary: z.string(),
})
export type CapabilityReport = z.infer<typeof CapabilityReportSchema>

/**
 * The port. `modules/crm/vsa/VsaAdapter.ts` is the only implementation and the
 * only file in the tree that knows VerySwing exists.
 *
 * Note what is absent: no `createAccount`. v1 does not auto-create prospect
 * accounts — the real endpoint needs address, activity and billing-tax fields a
 * meeting cannot produce, and the only way to satisfy it is placeholder data
 * that permanently pollutes the CRM of record (DEC-18, `docs/reference/vsa-api.md`).
 */
export interface CrmPort {
  /** Suggests. Never decides, never writes (VISION.md §5.1). */
  resolveAccount(query: AccountQuery): Promise<AccountCandidate[]>
  /** All siblings under a shared parent, so the rep sees a choice exists. */
  listSiblings(parentAccountId: string): Promise<AccountCandidate[]>
  pushCompteRendu(payload: CompteRenduPayload): Promise<PushResult>
  pushOpportunity(payload: OpportunityPayload): Promise<PushResult>
  createContact(draft: ContactDraft): Promise<ContactRef>
  /** Attaches the raw transcript to a pushed compte-rendu. */
  attachTranscript(remoteId: string, filename: string, content: string): Promise<PushResult>
}
