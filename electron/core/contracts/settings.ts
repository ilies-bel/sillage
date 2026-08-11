/**
 * *Réglages* — what the settings screen renders (VISION.md §6, screen 5).
 *
 * One shape carries the whole screen: the two provider tables, the connectors
 * with their live state, the DEC-24 probe verdict, and the retention policy the
 * diagnostics panel reports.
 *
 * The invariant this file exists to enforce: **a provider that cannot be used is
 * shown with the reason, never hidden.** Every provider is listed, saying
 * whether it runs on this machine (DEC-33), and `reason` is mandatory when `selectable` is
 * false — the same trick `ConnectorHealth` plays with `reason` on `down`, for
 * the same reason. A row silently missing from the table is indistinguishable
 * from a bug, and the rep who pasted that key spends the demo wondering where it
 * went.
 *
 * Since DEC-34 the screen also *supplies* credentials rather than only reporting
 * them, so a row carries `auth` (how this provider is reached) and `credential`
 * (whether one is stored, and four characters of it). It never carries the key.
 */
import { z } from 'zod'
import { CapabilityReportSchema } from './crm.ts'
import { ConnectorHealthSchema, ConnectorIdSchema } from './health.ts'
import { RetentionPolicySchema } from './diagnostics.ts'
import {
  AuthKindSchema,
  CostSchema,
  ProviderFieldSchema,
  ProviderTierSchema,
  ResidencySchema,
} from './providers.ts'
import { ModelSectionSchema } from './models.ts'
import { AuthStateSchema } from './identity.ts'

/**
 * What the screen may know about a stored credential — never the value.
 *
 * The mirror of `CredentialState` in `secrets.ts`, as a zod schema, because it
 * crosses the IPC boundary and everything that does is validated (CLAUDE.md).
 */
export const CredentialStateSchema = z.object({
  stored: z.boolean(),
  /** Four characters, for telling two keys apart. Null when nothing is stored. */
  hint: z.string().length(4).nullable(),
})
export type CredentialStateView = z.infer<typeof CredentialStateSchema>

/**
 * A declared field with whatever is currently in it.
 *
 * The declaration travels with the value rather than the screen holding its own
 * copy of the registry: label, placeholder and `required` are facts about the
 * provider, and a renderer that hard-coded them would be the second place they
 * are written down and the first place they go stale.
 */
export const ProviderFieldValueSchema = ProviderFieldSchema.extend({
  /** Empty string when unset — never null, so the input is always controlled. */
  value: z.string(),
})
export type ProviderFieldValue = z.infer<typeof ProviderFieldValueSchema>

export const ProviderRowSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    tier: ProviderTierSchema,
    residency: ResidencySchema,
    streaming: z.boolean(),
    cost: CostSchema,
    /** How this provider is reached. The screen renders its control from this (DEC-34). */
    auth: AuthKindSchema,
    /**
     * The stored credential, or the absence of one. Always `{stored: false,
     * hint: null}` when `auth` is `none` — there is nothing to store, and a
     * screen that drew a key field there would be asking for a secret it would
     * then ignore.
     */
    credential: CredentialStateSchema,
    /**
     * The provider's non-secret settings, each with its current value (DEC-34).
     *
     * Unlike `credential` these **do** carry the value, and that is the point:
     * a base URL nobody can read back is a base URL nobody can correct. Empty
     * for the rows that need none, which is most of them.
     */
    fields: z.array(ProviderFieldValueSchema),
    /** A credential is stored, or the weights are on disk. */
    configured: z.boolean(),
    /** The one this app would use right now. */
    selected: z.boolean(),
    selectable: z.boolean(),
    /**
     * Why not, in French, rendered inline. Null only when `selectable` — see
     * the refinement below, which makes an empty reason unrepresentable.
     */
    reason: z.string().nullable(),
  })
  .refine((row) => row.selectable || (row.reason !== null && row.reason.length > 0), {
    message: 'un fournisseur non sélectionnable doit dire pourquoi (DEC-26)',
    path: ['reason'],
  })
  .refine((row) => row.auth !== 'none' || !row.credential.stored, {
    message: 'un fournisseur sans authentification n’a pas d’identifiant enregistré (DEC-34)',
    path: ['credential'],
  })
export type ProviderRow = z.infer<typeof ProviderRowSchema>

export const ProviderSectionSchema = z.object({
  rows: z.array(ProviderRowSchema),
  /** The id the app would use. Null when nothing is usable. */
  selected: z.string().nullable(),
  /** Why nothing is selected, from the registry's own refusal. French. */
  reason: z.string().nullable(),
})
export type ProviderSection = z.infer<typeof ProviderSectionSchema>

export const ConnectorRowSchema = z.object({
  id: ConnectorIdSchema,
  /** French, and the rep's vocabulary rather than the module's. */
  label: z.string(),
  health: ConnectorHealthSchema,
})
export type ConnectorRow = z.infer<typeof ConnectorRowSchema>

export const SettingsSnapshotSchema = z.object({
  stt: ProviderSectionSchema,
  llm: ProviderSectionSchema,
  /**
   * The local checkpoints (DEC-35). Belongs beside `stt` rather than inside it
   * because a model is not a provider: the whole table is the *one* provider
   * `local-whisper`, answering the second question — which weights it loads.
   */
  models: ModelSectionSchema,
  connectors: z.array(ConnectorRowSchema),
  auth: AuthStateSchema,
  /** The DEC-24 capability diff. Null when the CRM was never reachable. */
  probe: CapabilityReportSchema.nullable(),
  /** Why there is no probe. Non-null exactly when `probe` is null. */
  probeReason: z.string().nullable(),
  retention: RetentionPolicySchema,
})
export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>
