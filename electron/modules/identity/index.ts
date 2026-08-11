/**
 * The module's outside edge: this is the only file that names MSAL.
 *
 * Everything with a rule in it — which scopes may be asked for, which account to
 * restore, what a silent failure means — is in `MsalIdentity.ts` behind a
 * four-method interface. What is left here is construction, and construction is
 * the part that cannot be unit-tested without a tenant.
 */
import { PublicClientApplication } from '@azure/msal-node'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { KeyValueStore } from '../../core/contracts/kv.ts'
import type { IdentityConfig } from './config.ts'
import { MsalIdentity, type MsalAccount, type PublicClientLike } from './MsalIdentity.ts'
import { createTokenCachePlugin } from './TokenCache.ts'
import { keychainVault, type SecretVault } from './vault.ts'

export { MULTI_TENANT_AUTHORITY, resolveIdentityConfig } from './config.ts'
export type { IdentityConfig } from './config.ts'
export { MsalIdentity, ACCOUNT_KEY, TOKEN_SCOPES } from './MsalIdentity.ts'
export type { MsalAccount, MsalResult, PublicClientLike } from './MsalIdentity.ts'
export { createTokenCachePlugin, CACHE_KEY } from './TokenCache.ts'
export type { CacheContextLike, CachePluginLike } from './TokenCache.ts'
export { keychainVault, memoryVault, VAULT_SERVICE } from './vault.ts'
export type { SecretVault, KeytarLike, KeytarLoader } from './vault.ts'

/**
 * What the browser tab says once the redirect lands. The rep's attention is
 * already back on the meeting they were about to join, so it says the one thing
 * that matters and nothing else.
 */
const SUCCESS_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Connexion réussie</title></head>
<body style="font-family:system-ui;padding:3rem;text-align:center">
<h1>Connexion réussie</h1><p>Vous pouvez fermer cet onglet et revenir à Sillage.</p>
</body></html>`

const ERROR_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Connexion échouée</title></head>
<body style="font-family:system-ui;padding:3rem;text-align:center">
<h1>Connexion échouée</h1><p>Fermez cet onglet et réessayez depuis Sillage.</p>
</body></html>`

export interface CreateIdentityOptions {
  config: IdentityConfig
  /**
   * Opens a URL in the *system* browser. Injected rather than imported so this
   * module never reaches for Electron — and so a rep signs in in the browser
   * they already trust, where their session and any conditional-access
   * enrolment already live, instead of an embedded window.
   */
  openBrowser: (url: string) => Promise<void>
  vault?: SecretVault
  state?: KeyValueStore
  diagnostics?: DiagRecorder
}

export const createIdentity = (options: CreateIdentityOptions): MsalIdentity => {
  const diagnostics = options.diagnostics ?? NULL_RECORDER
  const vault = options.vault ?? keychainVault()

  const app = new PublicClientApplication({
    auth: {
      clientId: options.config.clientId,
      authority: options.config.authority,
      // No clientSecret, no clientCertificate, no clientAssertion. A public
      // client has nothing to prove but possession of the PKCE verifier.
    },
    cache: {
      cachePlugin: createTokenCachePlugin({
        vault,
        onError: (stage, error) =>
          diagnostics.record({
            severity: 'warn',
            code: `identity.vault.${stage}Failed`,
            module: 'identity',
            message: error instanceof Error ? error.message : String(error),
            detail: {},
          }),
      }),
    },
  })

  const cache = app.getTokenCache()

  /**
   * MSAL keys both silent renewal and removal off the full `AccountInfo` it
   * handed out — `environment` and `localAccountId` included — so the trimmed
   * `MsalAccount` the rules work with is exchanged back for the real one here.
   * Reading it out of the cache rather than holding a reference also means a
   * cache rewritten by another window is picked up.
   */
  const resolve = async (account: MsalAccount) => {
    const found = await cache.getAccountByHomeId(account.homeAccountId)
    if (!found) throw new Error('compte Microsoft absent du cache')
    return found
  }

  const client: PublicClientLike = {
    accounts: () => cache.getAllAccounts(),
    acquireTokenSilent: async (request) =>
      app.acquireTokenSilent({ account: await resolve(request.account), scopes: request.scopes }),
    acquireTokenInteractive: (request) =>
      app.acquireTokenInteractive({
        scopes: request.scopes,
        openBrowser: options.openBrowser,
        successTemplate: SUCCESS_PAGE,
        errorTemplate: ERROR_PAGE,
        ...(options.config.redirectPort ? { preferredPort: options.config.redirectPort } : {}),
      }),
    removeAccount: async (account: MsalAccount) => {
      const found = await cache.getAccountByHomeId(account.homeAccountId)
      if (found) await cache.removeAccount(found)
    },
  }

  return new MsalIdentity({ client, diagnostics, ...(options.state ? { state: options.state } : {}) })
}
