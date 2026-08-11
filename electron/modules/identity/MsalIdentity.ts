/**
 * `IdentityPort` over an MSAL public client.
 *
 * The MSAL object arrives through `PublicClientLike` rather than by import. Two
 * reasons, and the second is the one that matters: the four methods below are
 * the entire surface this product uses, and stating them makes the sign-in
 * rules — the forbidden-scope guard, the silent-then-fail path, what happens on
 * restart — testable without a tenant, a browser or a network.
 *
 * The interactive flow itself is MSAL's: authorization code + PKCE, a loopback
 * redirect on a port it picks, the system browser. No client secret exists at
 * any point (see `config.ts`).
 */
import type { Account, IdentityPort } from '../../core/contracts/identity.ts'
import {
  ConsentRequiredError,
  GRAPH_SCOPES,
  InteractionRequiredError,
  isConsentFailure,
  rejectedScopes,
} from '../../core/contracts/identity.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { KeyValueStore } from '../../core/contracts/kv.ts'

export interface MsalAccount {
  homeAccountId: string
  username: string
  name?: string
  tenantId: string
}

export interface MsalResult {
  accessToken: string
  account: MsalAccount | null
}

/** The whole of MSAL, as this module uses it. */
export interface PublicClientLike {
  accounts(): Promise<MsalAccount[]>
  acquireTokenSilent(request: { account: MsalAccount; scopes: string[] }): Promise<MsalResult | null>
  acquireTokenInteractive(request: { scopes: string[] }): Promise<MsalResult | null>
  removeAccount(account: MsalAccount): Promise<void>
}

/**
 * Which account to reach for out of a cache that may hold several.
 *
 * A rep with two tenants signs into both over a laptop's life and MSAL keeps
 * them side by side. Without this, "the first one" is whatever order the cache
 * happens to serialise in, and the app silently reads the wrong calendar.
 */
export const ACCOUNT_KEY = 'identity.homeAccountId'

/**
 * `offline_access` is requested by the registration, not by a token call.
 *
 * MSAL adds the OIDC scopes itself and treats them as reserved; passing them
 * back in a resource-token request is at best redundant. The consent screen the
 * rep sees still lists it, because it is on the app registration.
 */
export const TOKEN_SCOPES: readonly string[] = GRAPH_SCOPES.filter(
  (scope) => scope !== 'offline_access',
)

const toAccount = (account: MsalAccount): Account => ({
  homeAccountId: account.homeAccountId,
  username: account.username,
  // Some tenants leave displayName unset on a guest or a service account.
  // Falling back to the UPN keeps the UI honest instead of showing "undefined".
  name: account.name?.trim() || account.username,
  tenantId: account.tenantId,
})

export interface MsalIdentityOptions {
  client: PublicClientLike
  /** Remembers which account signed in. Optional: without it, restart re-prompts. */
  state?: KeyValueStore
  diagnostics?: DiagRecorder
}

export class MsalIdentity implements IdentityPort {
  #client: PublicClientLike
  #state: KeyValueStore | null
  #diagnostics: DiagRecorder
  #account: MsalAccount | null = null

  constructor(options: MsalIdentityOptions) {
    this.#client = options.client
    this.#state = options.state ?? null
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
  }

  /**
   * Reads the cache and picks up where the last launch left off. Network-free.
   *
   * Called once at boot by `app/`. It is separate from the constructor because
   * `account()` is synchronous by contract — the renderer asks for it on every
   * render — and a constructor cannot await.
   */
  async restore(): Promise<Account | null> {
    let accounts: MsalAccount[] = []
    try {
      accounts = await this.#client.accounts()
    } catch (error) {
      this.#record('identity.cache.unreadable', error)
      return null
    }

    const remembered = this.#state?.get(ACCOUNT_KEY) ?? null
    const match = remembered
      ? (accounts.find((a) => a.homeAccountId === remembered) ?? null)
      : null

    // Exactly one account and no memory of a choice is unambiguous. Several
    // accounts and no memory is not, and guessing there is how the app reads a
    // calendar the rep never asked about — so it asks instead.
    this.#account = match ?? (accounts.length === 1 ? (accounts[0] ?? null) : null)
    if (this.#account) this.#state?.set(ACCOUNT_KEY, this.#account.homeAccountId)
    return this.#account ? toAccount(this.#account) : null
  }

  account(): Account | null {
    return this.#account ? toAccount(this.#account) : null
  }

  async signIn(): Promise<Account> {
    let result: MsalResult | null = null
    try {
      result = await this.#client.acquireTokenInteractive({ scopes: [...TOKEN_SCOPES] })
    } catch (error) {
      // The tenant refuses to let this rep consent for themselves. Retrying is
      // useless and the rep cannot fix it alone, so say what has to happen
      // instead of surfacing an entra code nobody can act on.
      if (isConsentFailure(error)) {
        this.#record('identity.consent.required', error)
        throw new ConsentRequiredError()
      }
      throw error
    }
    if (!result?.account) {
      throw new Error('connexion Microsoft annulée')
    }
    this.#account = result.account
    this.#state?.set(ACCOUNT_KEY, result.account.homeAccountId)
    this.#diagnostics.record({
      severity: 'info',
      code: 'identity.signedIn',
      module: 'identity',
      message: 'connexion Microsoft réussie',
      // The tenant is operational detail; the username is the rep's own address
      // and belongs nowhere near a bundle that leaves the machine (DEC-27).
      detail: { tenantId: result.account.tenantId },
    })
    return toAccount(result.account)
  }

  async signOut(): Promise<void> {
    const account = this.#account
    this.#account = null
    this.#state?.delete(ACCOUNT_KEY)
    if (!account) return
    try {
      await this.#client.removeAccount(account)
    } catch (error) {
      // The local state is already cleared, which is what the rep asked for.
      this.#record('identity.signOut.partial', error)
    }
  }

  async token(scopes: readonly string[] = TOKEN_SCOPES): Promise<string> {
    const forbidden = rejectedScopes(scopes)
    if (forbidden.length > 0) {
      // HR-8. Not a French string: this can only be reached by a code change,
      // and the audience is whoever made it.
      throw new Error(`forbidden scope requested: ${forbidden.join(', ')}`)
    }

    const account = this.#account
    if (!account) throw new InteractionRequiredError('aucun compte Microsoft connecté')

    let result: MsalResult | null = null
    try {
      result = await this.#client.acquireTokenSilent({ account, scopes: [...scopes] })
    } catch (error) {
      // Consent can also fail here — a scope added after the rep signed in has
      // no grant behind it. Sending them to an interactive sign-in that will
      // fail on the same screen is worse than saying so.
      if (isConsentFailure(error)) {
        this.#record('identity.consent.required', error)
        throw new ConsentRequiredError()
      }
      this.#record('identity.silent.failed', error)
      throw new InteractionRequiredError()
    }
    if (!result?.accessToken) throw new InteractionRequiredError()
    return result.accessToken
  }

  #record(code: string, error: unknown): void {
    this.#diagnostics.record({
      severity: 'warn',
      code,
      module: 'identity',
      message: error instanceof Error ? error.message : String(error),
      detail: {},
    })
  }
}
