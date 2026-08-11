/**
 * The provider tables Réglages renders, as a pure function (DEC-26, DEC-33).
 *
 * The registries in `modules/transcribe/` and `modules/llm/` already decide
 * *which* provider gets used and already say why one was refused. What they do
 * not produce is a **row per provider**, and that is exactly what the screen
 * needs: every provider is listed, saying whether it runs on this machine, so
 * the choice is made with the answer on screen rather than by a filter nobody
 * can see.
 *
 * So this takes the descriptors — either registry's, they agree on the fields
 * that matter here — and turns them into rows. It lives in `core/domain/`
 * because `core/` may not import `modules/`, which is fine: the descriptor
 * *type* is a contract, and passing the table in keeps one implementation
 * serving both registries instead of two that will disagree by the third
 * provider someone adds.
 *
 * The refusal order mirrors `selectProvider` / `selectLlm` deliberately. If
 * this file said a provider was selectable and the registry then refused it,
 * the screen would be lying about the thing it exists to explain.
 */
import type {
  AuthKind,
  ProviderCapabilities,
  ProviderField,
  ProviderTier,
} from '../contracts/providers.ts'
import type {
  CredentialStateView,
  ProviderFieldValue,
  ProviderRow,
  ProviderSection,
} from '../contracts/settings.ts'

/** The half of a descriptor this needs. Both registries' rows satisfy it. */
export interface ProviderDescriptorLike {
  id: string
  label: string
  tier: ProviderTier
  auth: AuthKind
  capabilities: ProviderCapabilities
  // `| undefined` explicitly, under `exactOptionalPropertyTypes`: a descriptor
  // that simply omits the key must satisfy this, and most of them do.
  fields?: readonly ProviderField[] | undefined
}

/** Nothing stored. The shape a row gets when it has nothing to store, too. */
const NO_CREDENTIAL: CredentialStateView = { stored: false, hint: null }

export interface ProviderRowsInput {
  /** Ids that are usable right now: a stored credential, or weights on disk. */
  configured: readonly string[]
  /** What the registry picked, or null when it refused everything. */
  selected: string | null
  /** Why it refused. French, from the registry itself. */
  reason: string | null
  /**
   * What the vault holds, keyed by provider id (DEC-34). Absent ids are read as
   * "nothing stored" so a caller that has not wired the vault yet still renders
   * a truthful table rather than crashing — which is what `boot()` does before
   * the vault is reachable.
   */
  credentials?: Readonly<Record<string, CredentialStateView>>
  /**
   * A better sentence than this file could write, for the rows where the module
   * knows one — keyed by provider id, and used only in place of the
   * *not-configured* refusal.
   *
   * It exists because the refusal below is derived from the tier, and a tier is
   * a good enough proxy for "what is missing" right up to the first row whose
   * credential is neither a key nor a URL. `chatgpt` is that row: it is missing
   * a session, the remedy is a command, and « aucune clé enregistrée » would
   * send a rep looking for a field that is deliberately not there.
   *
   * Deliberately cannot override a refusal this file makes for another reason.
   * `offlineOnly` is the app honouring something the rep asked for *in the
   * product*, and a module explaining it away would be a module overruling them.
   */
  reasons?: Readonly<Record<string, string>>
  /**
   * What is currently in each provider's declared fields, keyed by provider id
   * then field key (DEC-34). Absent ids and absent keys read as empty, so a
   * caller that has not wired the store yet renders a truthful table of empty
   * fields rather than crashing.
   */
  values?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** HR-4/HR-5. The rep chose to keep everything on the machine. */
  offlineOnly?: boolean
}

/** The declared fields, each carrying whatever is in it. */
const fieldsOf = (
  descriptor: ProviderDescriptorLike,
  input: ProviderRowsInput,
): ProviderFieldValue[] =>
  (descriptor.fields ?? []).map((field) => ({
    ...field,
    value: input.values?.[descriptor.id]?.[field.key] ?? '',
  }))

/**
 * The sentence a rep reads next to a greyed row.
 *
 * Every branch names the constraint that bit rather than the outcome. « non
 * disponible » sends someone to read this file; « aucune clé enregistrée »
 * sends them to the field they have to fill, which is where the fix is.
 */
const refusal = (
  descriptor: ProviderDescriptorLike,
  input: ProviderRowsInput,
): string | null => {
  const { residency } = descriptor.capabilities

  if (!input.configured.includes(descriptor.id)) {
    const supplied = input.reasons?.[descriptor.id]
    if (supplied) return supplied
    return descriptor.tier === 'local'
      ? 'non installé sur cette machine'
      : descriptor.tier === 'self-hosted'
        ? 'aucune URL de serveur enregistrée'
        : descriptor.auth === 'oauth'
          ? 'aucune session ouverte'
          : 'aucune clé enregistrée'
  }
  if (input.offlineOnly === true && residency !== 'local') {
    return 'mode hors ligne : seuls les moteurs locaux sont autorisés'
  }
  // Where a provider runs is not a refusal. The row still carries it and the
  // screen still shows whether the audio leaves the machine — but a provider
  // someone deliberately configured is one they may use.
  return null
}

export const providerRows = (
  descriptors: readonly ProviderDescriptorLike[],
  input: ProviderRowsInput,
): ProviderRow[] =>
  descriptors.map((descriptor) => {
    const reason = refusal(descriptor, input)
    return {
      id: descriptor.id,
      label: descriptor.label,
      tier: descriptor.tier,
      auth: descriptor.auth,
      // A provider with nothing to authenticate never reports a credential,
      // whatever the vault happens to hold under its id. The contract refuses
      // that combination outright; honouring it here means a stale vault entry
      // from a provider that changed its auth kind cannot make the row
      // unrepresentable.
      credential:
        descriptor.auth === 'none' ? NO_CREDENTIAL : (input.credentials?.[descriptor.id] ?? NO_CREDENTIAL),
      fields: fieldsOf(descriptor, input),
      residency: descriptor.capabilities.residency,
      streaming: descriptor.capabilities.streaming,
      cost: descriptor.capabilities.cost,
      configured: input.configured.includes(descriptor.id),
      selected: input.selected === descriptor.id,
      selectable: reason === null,
      reason,
    }
  })

export const providerSection = (
  descriptors: readonly ProviderDescriptorLike[],
  input: ProviderRowsInput,
): ProviderSection => ({
  rows: providerRows(descriptors, input),
  selected: input.selected,
  reason: input.selected === null ? input.reason : null,
})

/** Display order for the three tiers (VISION.md §6): the floor first. */
export const TIER_ORDER: readonly ProviderTier[] = ['local', 'self-hosted', 'cloud']
