/**
 * MSAL's `ICachePlugin`, backed by the OS credential store.
 *
 * MSAL keeps its token cache in memory and calls out to a plugin around every
 * access: `beforeCacheAccess` to load, `afterCacheAccess` to save when something
 * changed. Wiring those two to the vault is the whole of "the rep signs in once"
 * — without it the cache dies with the process and every launch opens a browser.
 *
 * The structural types below are deliberate. MSAL's `TokenCacheContext` is a
 * class in a package this module happens to depend on; naming it here would put
 * a vendor type in a signature and make this file untestable without
 * instantiating MSAL. What the plugin actually needs is two methods and a flag.
 */
import type { SecretVault } from './vault.ts'

/** The slice of `TokenCacheContext` a cache plugin uses. */
export interface CacheContextLike {
  cacheHasChanged: boolean
  tokenCache: {
    deserialize(serialized: string): void
    serialize(): string
  }
}

export interface CachePluginLike {
  beforeCacheAccess: (context: CacheContextLike) => Promise<void>
  afterCacheAccess: (context: CacheContextLike) => Promise<void>
}

/** One entry per app, not per account: MSAL's blob already holds every account. */
export const CACHE_KEY = 'msal-token-cache'

export interface TokenCacheOptions {
  vault: SecretVault
  key?: string
  /** Reported, never thrown — see below. */
  onError?: (stage: 'read' | 'write', error: unknown) => void
}

/**
 * A vault failure degrades to "signed out", never to a crash.
 *
 * `beforeCacheAccess` runs inside every token acquisition, including the silent
 * one on the arming path. A keyring that is locked, missing or refusing must
 * cost a sign-in prompt, not a meeting: the throw would surface as an
 * unrecoverable error several frames away from its cause, at the moment the rep
 * is joining a call.
 */
export const createTokenCachePlugin = (options: TokenCacheOptions): CachePluginLike => {
  const key = options.key ?? CACHE_KEY

  return {
    beforeCacheAccess: async (context) => {
      try {
        const stored = await options.vault.get(key)
        if (stored) context.tokenCache.deserialize(stored)
      } catch (error) {
        options.onError?.('read', error)
      }
    },

    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return
      try {
        await options.vault.set(key, context.tokenCache.serialize())
      } catch (error) {
        options.onError?.('write', error)
      }
    },
  }
}
