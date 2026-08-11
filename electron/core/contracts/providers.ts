/**
 * Provider registries, not switch statements (ARCHITECTURE.md §5.D).
 *
 * HR-4, HR-5 and HR-11 become data here. Residency is a **property the row
 * declares and the screen shows**, not a filter: adding Gladia is one file in
 * `modules/transcribe/providers/`, and whether its residency is acceptable is
 * the operator's call, made with the answer in front of them.
 */
import { z } from 'zod'
import { BoostCapabilitySchema } from './lexicon.ts'

/**
 * Where this provider processes the audio: on the machine, or not.
 *
 * Two values, and it used to be three — `local | eu | other`, where `eu` meant
 * a contractual residency term. That distinction is gone (DEC-37). A vendor's
 * jurisdiction is a contract question with a different answer per client, per
 * deal and per year; a row asserting it in the binary was a claim the software
 * could not keep true, and the moment one row is stale the whole column is
 * worthless. What the app can state from what it actually knows is whether the
 * audio leaves this machine — which is also the only half `offlineOnly` ever
 * acted on.
 *
 * It does not gate selection. A provider only becomes usable when someone
 * deliberately configures a credential for it, and refusing to honour that
 * credential taught the operator nothing they had not already decided —
 * it only hid *which* provider was being declined behind a screen that looked
 * identical to a missing key. So the row states where it runs and stays
 * choosable; the deployment decision belongs to whoever signs the contract.
 */
export const ResidencySchema = z.enum(['local', 'remote'])
export type Residency = z.infer<typeof ResidencySchema>

/**
 * What using this row costs, in the only three shapes that exist here.
 *
 * `included` is not a synonym for `free`, and the distinction is the rep's, not
 * an accountant's: a subscription they already pay for has no marginal cost and
 * no bill to be surprised by, but it also has a quota that runs out — which is
 * the opposite of the local engine's guarantee. One word for both would put « ·
 * gratuit » next to a row that can stop working at 3 p.m.
 */
export const CostSchema = z.enum(['free', 'metered', 'included'])
export type Cost = z.infer<typeof CostSchema>

/**
 * The three tiers Réglages groups by (VISION.md §6, screen 5).
 *
 * Not derivable from `residency`, which is why it is its own field: a model
 * served by the client's own vLLM is `residency: 'local'` — nothing leaves the
 * perimeter — but it is an operated service with a URL and an outage, not an
 * engine running inside this process. Grouping the two together would put
 * "installez le modèle" and "vérifiez l'URL du serveur" under one heading, and
 * they are different problems for different people.
 */
/**
 * How a provider is reached, as data rather than as a branch per vendor (DEC-34).
 *
 * Réglages renders the credential control straight off this field: `oauth` gets
 * *Se connecter*, `apiKey` gets a key field, `none` gets neither. A screen that
 * decided this with `if (id === 'openai')` would grow one arm per provider and
 * would be wrong about the seventh one someone adds in a hurry.
 *
 * **`oauth` means a credential obtained by an authorization flow, not typed.**
 * Two rows are `oauth` and they get there differently. Microsoft Entra runs the
 * flow itself — MSAL public client, PKCE, loopback redirect. The ChatGPT row
 * *borrows* the grant `codex login` already obtained on this machine and reads
 * it from disk (`modules/llm/chatgptGrant.ts`).
 *
 * What the two have in common, and what this field actually promises, is that
 * **Réglages must not draw a key field for them** — there is no key to type, and
 * a rep who pasted a Platform key into the ChatGPT row would have configured
 * nothing. What each one draws instead is its own affair.
 *
 * The OpenAI *Platform* API stays `apiKey`: authentication there is the bearer
 * key and there is no third-party flow to obtain one. Declaring it `oauth` would
 * put a *Se connecter* button on screen that cannot succeed, which is precisely
 * the dead control DEC-26 forbids.
 */
export const AuthKindSchema = z.enum([
  /** Nothing to supply. The bundled local engine, and anything self-hosted with auth off. */
  'none',
  /** A bearer key or vendor header, entered in Réglages and kept in the OS credential store. */
  'apiKey',
  /** An authorization flow the app can actually complete. Entra today. */
  'oauth',
])
export type AuthKind = z.infer<typeof AuthKindSchema>

export const ProviderTierSchema = z.enum([
  /** Runs in this process, on this machine. The floor (HR-4, HR-5). */
  'local',
  /** An OpenAI-compatible server the operator runs. Residency is theirs. */
  'self-hosted',
  /** A vendor's API. Residency is contractual, and the row says what it is. */
  'cloud',
])
export type ProviderTier = z.infer<typeof ProviderTierSchema>

/**
 * A setting a provider needs that is **not** a secret (DEC-34).
 *
 * The gap this closes: a credential store is the right home for a key and the
 * wrong home for a URL. The self-hosted row needs a base URL and a model name;
 * Azure needs an endpoint host and a deployment. None of those is a secret —
 * they belong on screen, readable, editable and shown back — and all of them
 * came from environment variables, which meant the two rows that most needed
 * configuring were the two a rep could not configure at all.
 *
 * Declared on the descriptor rather than branched on in Réglages, for the same
 * reason `auth` is: a screen that decided this with `if (id === 'azure…')` grows
 * one arm per provider and is wrong about the seventh.
 *
 * `required` is what the reader enforces, not a hint. A row whose required field
 * is empty is not configured, and says so — which is the honest version of a
 * default that would have been wrong. `secret` is deliberately absent: anything
 * that would want it belongs in the vault, behind `auth: 'apiKey'`.
 */
export const ProviderFieldSchema = z.object({
  key: z.string().min(1),
  /** French, and the vendor's own word for it — « Déploiement », not « Modèle ». */
  label: z.string().min(1),
  placeholder: z.string(),
  required: z.boolean(),
})
export type ProviderField = z.infer<typeof ProviderFieldSchema>

export const ProviderCapabilitiesSchema = z.object({
  residency: ResidencySchema,
  streaming: z.boolean(),
  /** BCP-47. v1 only ever asks for `fr-FR` (DEC-22). */
  languages: z.array(z.string()),
  cost: CostSchema,
})
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>

export const SttProviderDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tier: ProviderTierSchema,
  auth: AuthKindSchema,
  capabilities: ProviderCapabilitiesSchema,
  /** Non-secret settings this provider needs. Absent means it needs none. */
  fields: z.array(ProviderFieldSchema).optional(),
  boost: BoostCapabilitySchema,
})
export type SttProviderDescriptor = z.infer<typeof SttProviderDescriptorSchema>

export const LlmProviderDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tier: ProviderTierSchema,
  auth: AuthKindSchema,
  capabilities: ProviderCapabilitiesSchema,
  /** Non-secret settings this provider needs. Absent means it needs none. */
  fields: z.array(ProviderFieldSchema).optional(),
  /**
   * Whether the provider can be held to a schema natively. When false,
   * `modules/extract/` falls back to parse-and-revalidate — the extraction is
   * schema-validated either way (DEC-7).
   */
  structuredOutput: z.boolean(),
})
export type LlmProviderDescriptor = z.infer<typeof LlmProviderDescriptorSchema>
