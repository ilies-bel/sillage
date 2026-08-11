/**
 * Where the VerySwing credentials and tenant constants come from, and nothing
 * else — the shape `modules/llm/config.ts` and `modules/identity/config.ts`
 * established.
 *
 * This is the **only** file in the adapter that reads `process.env`. Everything
 * else takes a `VsaConfig` argument, which is what lets `VsaCrm`, the resolver,
 * the referential cache and the probe all be tested with no environment and no
 * credentials at all.
 *
 * No credential is ever written down here. Absent, `vsaConfig()` returns `null`
 * and `app/` reports "CRM non configuré" rather than failing at the first push.
 */

export interface VsaConfig {
  /** e.g. `https://automation.playwithvsa.com/api` — no trailing slash. */
  baseUrl: string
  login: string
  password: string
  /**
   * `api` for a technical account, `real` for a named user. The sandbox takes
   * both; a client tenant usually issues an API account, which is why `api` is
   * the default rather than a value someone has to know to set.
   */
  authType: 'api' | 'real'
  /** The VSA user id every write is attributed to (`actionUserId`). */
  actionUserId: number
  /** Consultants in charge of the task. Defaults to `[actionUserId]`. */
  salesUserIds: number[]
  /**
   * The VSA entity, twice, because VSA wants it two ways.
   *
   * `/v1/opportunity` takes an entity **code** (`entity`, a string) while
   * `/v1/prospect/{code}/contact` takes entity **ids** (`entities`, integers).
   * Deriving one from the other would need a referential we do not otherwise
   * read, so both are configured and neither is guessed.
   */
  entityId: number
  entityCode: string
  /**
   * The VSA sales **login** an opportunity is booked to — `sales` is a login,
   * where a task's `salesUsers` are numeric ids. Defaults to the API login,
   * which is right whenever the app authenticates as the rep.
   */
  salesLogin: string
  /**
   * The ESN's own mail domains.
   *
   * The rep is on their own invite, so without this every internal attendee
   * would resolve the ESN's own account — if it exists in VSA — and the meeting
   * would be attributed to the company holding it. Listed rather than inferred:
   * an ESN with three brands has three domains and no way for us to guess them.
   */
  ownEmailDomains: string[]
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim()
  return text ? text : undefined
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

const intOf = (value: string | undefined): number | undefined => {
  const text = trimmed(value)
  if (!text) return undefined
  const parsed = Number(text)
  return Number.isInteger(parsed) ? parsed : undefined
}

const intListOf = (value: string | undefined): number[] =>
  (trimmed(value) ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n))

const domainListOf = (value: string | undefined): string[] =>
  (trimmed(value) ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)

/**
 * The configuration, or `null` when the tenant is not set up.
 *
 * Every field is required because every one of them is needed by the *first*
 * write: a task without `actionUserId` is a 400, and an opportunity without an
 * entity is a 400. Defaulting any of them would move the failure from
 * "Réglages says the CRM is not configured" to "the demo's one confirmation
 * returns a validation error nobody can read".
 */
export const vsaConfig = (env: NodeJS.ProcessEnv = process.env): VsaConfig | null => {
  const baseUrl = trimmed(env.SILLAGE_VSA_BASE_URL)
  const login = trimmed(env.SILLAGE_VSA_LOGIN)
  const password = trimmed(env.SILLAGE_VSA_PASSWORD)
  const actionUserId = intOf(env.SILLAGE_VSA_ACTION_USER_ID)
  const entityId = intOf(env.SILLAGE_VSA_ENTITY_ID)
  const entityCode = trimmed(env.SILLAGE_VSA_ENTITY_CODE)
  if (!baseUrl || !login || !password || actionUserId === undefined || entityId === undefined || !entityCode) {
    return null
  }

  const salesUserIds = intListOf(env.SILLAGE_VSA_SALES_USER_IDS)
  return {
    baseUrl: stripTrailingSlash(baseUrl),
    login,
    password,
    authType: trimmed(env.SILLAGE_VSA_AUTH_TYPE) === 'real' ? 'real' : 'api',
    actionUserId,
    salesUserIds: salesUserIds.length > 0 ? salesUserIds : [actionUserId],
    entityId,
    entityCode,
    salesLogin: trimmed(env.SILLAGE_VSA_SALES_LOGIN) ?? login,
    ownEmailDomains: domainListOf(env.SILLAGE_VSA_OWN_DOMAINS),
  }
}

/** What Réglages shows when `vsaConfig()` came back `null`. */
export const missingVsaSettings = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const missing: string[] = []
  if (!trimmed(env.SILLAGE_VSA_BASE_URL)) missing.push('adresse du serveur VerySwing')
  if (!trimmed(env.SILLAGE_VSA_LOGIN)) missing.push('identifiant')
  if (!trimmed(env.SILLAGE_VSA_PASSWORD)) missing.push('mot de passe')
  if (intOf(env.SILLAGE_VSA_ACTION_USER_ID) === undefined) missing.push('identifiant utilisateur VSA')
  if (intOf(env.SILLAGE_VSA_ENTITY_ID) === undefined) missing.push('identifiant d’entité')
  if (!trimmed(env.SILLAGE_VSA_ENTITY_CODE)) missing.push('code d’entité')
  return missing
}
