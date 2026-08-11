/**
 * Who the rep is, to Microsoft (HR-3, DEC-1).
 *
 * There is no API key anywhere in this file and there will not be one. A desktop
 * application cannot hold a secret — anything shipped in the bundle is one
 * `unzip` away from being read — so the app is registered as a **public client**
 * and carries only a client id, which is public by design. Every user signs in
 * with their own work account and the app acts as that user, seeing exactly the
 * calendar and mailbox they can already see.
 */
import { z } from 'zod'

/**
 * All four are **delegated**: the app acts as the signed-in rep and can reach
 * nothing that rep cannot already reach. None is an application permission, and
 * none carries Microsoft's *"Admin consent required: Yes"* flag.
 *
 * That is not the same as "no admin is ever involved", and the difference bites
 * on the first sign-in at a real client. Since ~2020 a tenant's default user
 * consent setting is *"Allow user consent for apps from verified publishers,
 * for selected permissions"*, and the selected set is Microsoft's low-impact
 * classification — `User.Read`, `offline_access`, `openid`, `profile`, `email`.
 * `Calendars.Read` and `Mail.ReadWrite` are above that line. So under the
 * default policy the first rep is told *"Approbation de l'administrateur
 * requise"* (AADSTS90094) and an admin grants consent **once, for the tenant**,
 * from the same screen. What the admin does not do: register anything, issue a
 * secret, install anything, or give the app org-wide mailbox access.
 *
 * A tenant with the older permissive setting needs no admin at all; a locked
 * down one ("do not allow user consent") always does. We cannot tell which from
 * here, which is why `ConsentRequiredError` exists — see below.
 *
 * `offline_access` is the refresh token, which is what makes this a one-time
 * sign-in rather than an hourly interruption.
 */
export const GRAPH_SCOPES = [
  'Calendars.Read',
  'Mail.ReadWrite',
  'User.Read',
  'offline_access',
] as const

/**
 * HR-8: **we create drafts, never send mail.** `Mail.ReadWrite` creates a draft
 * in the rep's own Drafts folder and stops there; `Mail.Send` puts a message in
 * a prospect's inbox with no human in between.
 *
 * The distinction is one word in a config file, which is precisely why it is
 * checked in code as well: `rejectedScopes()` runs on every token request, so a
 * scope that should never be asked for cannot arrive by way of a copied snippet.
 */
export const FORBIDDEN_SCOPES: readonly string[] = ['Mail.Send', 'Mail.ReadWrite.Shared']

/** Which of `requested` must never be asked for. Empty is the only good answer. */
export const rejectedScopes = (requested: readonly string[]): string[] => {
  const forbidden = new Set(FORBIDDEN_SCOPES.map((s) => s.toLowerCase()))
  return requested.filter((scope) => forbidden.has(scope.trim().toLowerCase()))
}

export const AccountSchema = z.object({
  /** MSAL's stable key for the cached account. Opaque; never shown to a human. */
  homeAccountId: z.string().min(1),
  /** The UPN — normally the work email, and the entity-resolution key (DEC-18). */
  username: z.string(),
  /** Display name as the tenant spells it. What the UI shows. */
  name: z.string(),
  tenantId: z.string(),
})
export type Account = z.infer<typeof AccountSchema>

/**
 * What the renderer is told. Never a token: `src/*` may import
 * `core/contracts/` and nothing else, and a bearer token that crosses IPC is a
 * bearer token in a devtools console.
 *
 * ## Why `signedOut` carries a reason
 *
 * *Signed out* covers two situations a rep experiences as nothing alike:
 *
 *   · a rep who has an app to sign into and has not — *Se connecter* works;
 *   · **no Entra app registration at all** — `resolveIdentityConfig()` returned
 *     null, `IpcDeps.identity` is null, and `auth:signIn` can only reject
 *     (`app/ipc/register.ts`). That is the configuration the first demo ships
 *     in (DEC-28): the registration lives in a tenant we do not control.
 *
 * Without this field the renderer cannot tell them apart, so it draws a live
 * *Se connecter* in the second case — a control that throws and changes
 * nothing, which is precisely the dead control DEC-26 forbids. Present ⇒
 * signing in cannot be attempted and this sentence says why, beside the control
 * it disables. Absent ⇒ the button works.
 *
 * Optional rather than nullable so that `{ status: 'signedOut' }` stays the
 * ordinary spelling of the ordinary case.
 */
export const AuthStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signedOut'), reason: z.string().min(1).optional() }),
  z.object({ status: z.literal('signedIn'), account: AccountSchema }),
])
export type AuthState = z.infer<typeof AuthStateSchema>

/**
 * The port. `modules/identity` implements it; `modules/calendar` and
 * `modules/mail` are handed one and never learn that MSAL exists.
 */
export interface IdentityPort {
  /** The cached account, without touching the network. Null when signed out. */
  account(): Account | null
  /** Opens the system browser. The only call in the product that may do so. */
  signIn(): Promise<Account>
  signOut(): Promise<void>
  /**
   * A bearer token, silently from cache whenever the cache can serve it.
   *
   * Throws `InteractionRequiredError` when it cannot — the caller's job is then
   * to surface a *Se reconnecter* affordance, never to open a browser window
   * behind the rep's back in the middle of a call.
   */
  token(scopes?: readonly string[]): Promise<string>
}

/** Silent renewal failed; a human has to sign in again. */
export class InteractionRequiredError extends Error {
  constructor(message = 'reconnexion à Microsoft nécessaire') {
    super(message)
    this.name = 'InteractionRequiredError'
  }
}

/**
 * The tenant's consent policy will not let this rep approve the calendar and
 * mail scopes for themselves. An administrator has to grant them once.
 *
 * This is a distinct error rather than a generic sign-in failure because the
 * remedy is distinct: retrying, signing out, or picking another account all
 * fail identically, and the rep needs to be told to go and ask someone. Raised
 * from the entra codes that mean exactly this and nothing else:
 *
 *   AADSTS65001  no consent recorded for this app + user + resource
 *   AADSTS90094  the grant requires an administrator
 *   AADSTS900xxx / `consent_required`  the OAuth error name for the same
 */
export class ConsentRequiredError extends Error {
  constructor(message = 'votre administrateur Microsoft doit autoriser l’application') {
    super(message)
    this.name = 'ConsentRequiredError'
  }
}

const CONSENT_CODES = /\bAADSTS(?:65001|90094|900941)\b|\bconsent_required\b/i

/**
 * Whether an MSAL failure is the consent case. Deliberately narrow — it reads
 * the entra code, never the prose, because the prose is localised by the
 * tenant's own language setting and matching on it would be a coin toss.
 */
export const isConsentFailure = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const parts = [
    (error as { errorCode?: unknown }).errorCode,
    (error as { errorMessage?: unknown }).errorMessage,
    (error as { message?: unknown }).message,
  ].filter((p): p is string => typeof p === 'string')
  return parts.some((part) => CONSENT_CODES.test(part))
}
