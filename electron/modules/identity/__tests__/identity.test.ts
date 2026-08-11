import test from 'node:test'
import assert from 'node:assert/strict'
import { ACCOUNT_KEY, MsalIdentity, TOKEN_SCOPES } from '../MsalIdentity.ts'
import type { MsalAccount, MsalResult, PublicClientLike } from '../MsalIdentity.ts'
import { CACHE_KEY, createTokenCachePlugin, type CacheContextLike } from '../TokenCache.ts'
import { keychainVault, memoryVault, type KeytarLike } from '../vault.ts'
import { MULTI_TENANT_AUTHORITY, resolveIdentityConfig } from '../config.ts'
import {
  ConsentRequiredError,
  InteractionRequiredError,
  isConsentFailure,
  rejectedScopes,
} from '../../../core/contracts/identity.ts'
import { memoryKeyValueStore } from '../../../core/contracts/kv.ts'

const account = (over: Partial<MsalAccount> = {}): MsalAccount => ({
  homeAccountId: 'home-1',
  username: 'claire@shodo.fr',
  name: 'Claire Fontaine',
  tenantId: 'tenant-1',
  ...over,
})

interface ClientStub extends PublicClientLike {
  interactiveCalls: Array<{ scopes: string[] }>
  silentCalls: Array<{ account: MsalAccount; scopes: string[] }>
  removed: MsalAccount[]
}

const clientStub = (options: {
  accounts?: MsalAccount[]
  silent?: MsalResult | null | (() => never)
  interactive?: MsalResult | null | (() => never)
} = {}): ClientStub => {
  const stub: ClientStub = {
    interactiveCalls: [],
    silentCalls: [],
    removed: [],
    accounts: async () => options.accounts ?? [],
    acquireTokenSilent: async (request) => {
      stub.silentCalls.push(request)
      if (typeof options.silent === 'function') return options.silent()
      return options.silent ?? { accessToken: 'access-token', account: request.account }
    },
    acquireTokenInteractive: async (request) => {
      stub.interactiveCalls.push(request)
      if (typeof options.interactive === 'function') return options.interactive()
      return options.interactive === undefined
        ? { accessToken: 'access-token', account: account() }
        : options.interactive
    },
    removeAccount: async (a) => void stub.removed.push(a),
  }
  return stub
}

// ── Scopes ─────────────────────────────────────────────────────────────────

test('Mail.Send is not a scope this product may ask for', () => {
  // HR-8. Mail.ReadWrite drafts into the rep's own Drafts folder; Mail.Send
  // puts a message in a prospect's inbox with no human in between.
  assert.deepEqual(rejectedScopes(['Calendars.Read', 'Mail.ReadWrite']), [])
  assert.deepEqual(rejectedScopes(['Mail.Send']), ['Mail.Send'])
  // Casing and whitespace are not a way around it.
  assert.deepEqual(rejectedScopes([' mail.send ']), [' mail.send '])
})

test('a forbidden scope is refused before any network call', async () => {
  const client = clientStub({ accounts: [account()] })
  const identity = new MsalIdentity({ client })
  await identity.restore()

  await assert.rejects(() => identity.token(['Mail.Send']), /forbidden scope/)
  assert.equal(client.silentCalls.length, 0, 'the guard runs before MSAL, not after')
})

test('offline_access is on the registration, not on a token request', () => {
  assert.ok(!TOKEN_SCOPES.includes('offline_access'))
  assert.deepEqual([...TOKEN_SCOPES], ['Calendars.Read', 'Mail.ReadWrite', 'User.Read'])
})

// ── Restore ────────────────────────────────────────────────────────────────

test('a restart picks up the account it signed in with', async () => {
  const state = memoryKeyValueStore()
  state.set(ACCOUNT_KEY, 'home-2')
  const client = clientStub({ accounts: [account(), account({ homeAccountId: 'home-2', username: 'b@shodo.fr' })] })

  const restored = await new MsalIdentity({ client, state }).restore()
  assert.equal(restored?.username, 'b@shodo.fr')
})

test('two accounts and no memory of a choice asks rather than guesses', async () => {
  // Guessing here reads a calendar the rep never asked about.
  const client = clientStub({ accounts: [account(), account({ homeAccountId: 'home-2' })] })
  const identity = new MsalIdentity({ client })
  assert.equal(await identity.restore(), null)
  assert.equal(identity.account(), null)
})

test('a single cached account is unambiguous and is used', async () => {
  const state = memoryKeyValueStore()
  const identity = new MsalIdentity({ client: clientStub({ accounts: [account()] }), state })
  assert.equal((await identity.restore())?.homeAccountId, 'home-1')
  // …and remembered, so a second account appearing later cannot change it.
  assert.equal(state.get(ACCOUNT_KEY), 'home-1')
})

test('an unreadable cache is signed out, not a crash', async () => {
  const client = clientStub()
  client.accounts = async () => {
    throw new Error('keyring locked')
  }
  assert.equal(await new MsalIdentity({ client }).restore(), null)
})

test('an account with no display name falls back to its address', async () => {
  const client = clientStub({ accounts: [account({ name: '  ' })] })
  const identity = new MsalIdentity({ client })
  assert.equal((await identity.restore())?.name, 'claire@shodo.fr')
})

// ── Tokens ─────────────────────────────────────────────────────────────────

test('a token is served silently once an account is restored', async () => {
  const client = clientStub({ accounts: [account()] })
  const identity = new MsalIdentity({ client })
  await identity.restore()

  assert.equal(await identity.token(), 'access-token')
  assert.deepEqual(client.silentCalls[0]?.scopes, [...TOKEN_SCOPES])
  assert.equal(client.interactiveCalls.length, 0, 'a silent path never opens a browser')
})

test('signed out, a token request asks for interaction instead of opening a browser', async () => {
  // Mid-call, the right answer is a *Se reconnecter* affordance — not a browser
  // window stealing focus while the rep is talking.
  const identity = new MsalIdentity({ client: clientStub() })
  await assert.rejects(() => identity.token(), InteractionRequiredError)
})

test('a failed silent renewal becomes InteractionRequired, not the raw MSAL error', async () => {
  const client = clientStub({
    accounts: [account()],
    silent: () => {
      throw new Error('AADSTS50078: refresh token expired')
    },
  })
  const identity = new MsalIdentity({ client })
  await identity.restore()
  await assert.rejects(() => identity.token(), InteractionRequiredError)
})

// ── Consent ────────────────────────────────────────────────────────────────

test('a tenant that refuses user consent is named as such, not as a sign-in failure', async () => {
  // AADSTS90094 is the one the first rep at a client hits: the tenant's default
  // consent policy will not let them approve Calendars.Read for themselves.
  const client = clientStub({
    interactive: () => {
      throw Object.assign(new Error('AADSTS90094: The grant requires admin permission.'), {
        errorCode: 'invalid_grant',
      })
    },
  })
  await assert.rejects(() => new MsalIdentity({ client }).signIn(), ConsentRequiredError)
})

test('a consent failure on renewal does not send the rep to a sign-in that cannot succeed', async () => {
  const client = clientStub({
    accounts: [account()],
    silent: () => {
      throw Object.assign(new Error('failed'), { errorCode: 'AADSTS65001' })
    },
  })
  const identity = new MsalIdentity({ client })
  await identity.restore()
  await assert.rejects(() => identity.token(), ConsentRequiredError)
})

test('an ordinary sign-in failure stays an ordinary sign-in failure', async () => {
  const client = clientStub({
    interactive: () => {
      throw new Error('AADSTS50126: mot de passe invalide')
    },
  })
  await assert.rejects(() => new MsalIdentity({ client }).signIn(), /AADSTS50126/)
})

test('isConsentFailure reads the entra code, never the prose', () => {
  // The message is localised by the tenant's own language setting, so matching
  // on words would pass in English and fail in French.
  assert.equal(isConsentFailure({ errorCode: 'consent_required' }), true)
  assert.equal(isConsentFailure(new Error('AADSTS65001: no consent')), true)
  assert.equal(isConsentFailure(new Error('admin consent needed')), false)
  assert.equal(isConsentFailure(new Error('AADSTS50078')), false)
  assert.equal(isConsentFailure(null), false)
  assert.equal(isConsentFailure('AADSTS90094'), false)
})

// ── Sign in and out ────────────────────────────────────────────────────────

test('signing in remembers the account for the next launch', async () => {
  const state = memoryKeyValueStore()
  const client = clientStub()
  const identity = new MsalIdentity({ client, state })

  const signedIn = await identity.signIn()
  assert.equal(signedIn.username, 'claire@shodo.fr')
  assert.equal(state.get(ACCOUNT_KEY), 'home-1')
  assert.deepEqual(client.interactiveCalls[0]?.scopes, [...TOKEN_SCOPES])
})

test('a cancelled sign-in leaves the app signed out', async () => {
  const identity = new MsalIdentity({ client: clientStub({ interactive: null }) })
  await assert.rejects(() => identity.signIn(), /annulée/)
  assert.equal(identity.account(), null)
})

test('signing out clears the local state even when MSAL fails to', async () => {
  const state = memoryKeyValueStore()
  const client = clientStub({ accounts: [account()] })
  client.removeAccount = async () => {
    throw new Error('cache write failed')
  }
  const identity = new MsalIdentity({ client, state })
  await identity.restore()

  await identity.signOut()
  assert.equal(identity.account(), null)
  assert.equal(state.get(ACCOUNT_KEY), null)
})

// ── Token cache ────────────────────────────────────────────────────────────

const cacheContext = (hasChanged: boolean) => {
  let serialized = 'in-memory-cache'
  const context: CacheContextLike & { loaded: string | null } = {
    loaded: null,
    cacheHasChanged: hasChanged,
    tokenCache: {
      deserialize: (value: string) => void (context.loaded = value),
      serialize: () => serialized,
    },
  }
  return { context, set: (value: string) => void (serialized = value) }
}

test('the cache is loaded before access and written only when it changed', async () => {
  const vault = memoryVault()
  await vault.set(CACHE_KEY, 'stored-blob')
  const plugin = createTokenCachePlugin({ vault })

  const read = cacheContext(false)
  await plugin.beforeCacheAccess(read.context)
  assert.equal(read.context.loaded, 'stored-blob')

  // Unchanged: no write, so an ordinary silent token does not touch the keyring.
  await plugin.afterCacheAccess(read.context)
  assert.equal(await vault.get(CACHE_KEY), 'stored-blob')

  const write = cacheContext(true)
  write.set('new-blob')
  await plugin.afterCacheAccess(write.context)
  assert.equal(await vault.get(CACHE_KEY), 'new-blob')
})

test('a locked keyring costs a sign-in, never a crash mid-meeting', async () => {
  const failures: string[] = []
  const vault = memoryVault()
  vault.get = async () => {
    throw new Error('keyring locked')
  }
  vault.set = async () => {
    throw new Error('keyring locked')
  }
  const plugin = createTokenCachePlugin({ vault, onError: (stage) => failures.push(stage) })

  const context = cacheContext(true)
  await plugin.beforeCacheAccess(context.context)
  await plugin.afterCacheAccess(context.context)
  assert.deepEqual(failures, ['read', 'write'])
})

test('an empty vault deserializes nothing rather than an empty string', async () => {
  const plugin = createTokenCachePlugin({ vault: memoryVault() })
  const context = cacheContext(false)
  await plugin.beforeCacheAccess(context.context)
  assert.equal(context.context.loaded, null)
})

// ── Vault ──────────────────────────────────────────────────────────────────

test('the keychain vault namespaces by service and is loaded lazily', async () => {
  let loads = 0
  const stored = new Map<string, string>()
  const keytar: KeytarLike = {
    getPassword: async (_service, key) => stored.get(key) ?? null,
    setPassword: async (_service, key, value) => void stored.set(key, value),
    deletePassword: async (_service, key) => stored.delete(key),
  }

  const vault = keychainVault('test-service', () => {
    loads++
    return keytar
  })
  assert.equal(loads, 0, 'constructing the vault must not load the native addon')

  await vault.set('k', 'v')
  assert.equal(await vault.get('k'), 'v')
  await vault.delete('k')
  assert.equal(await vault.get('k'), null)
  assert.equal(loads, 1, 'loaded once, then cached')
})

// ── Config ─────────────────────────────────────────────────────────────────

test('no client id means no identity, stated rather than crashed', () => {
  assert.equal(resolveIdentityConfig({}), null)
  assert.equal(resolveIdentityConfig({ SILLAGE_ENTRA_CLIENT_ID: '   ' }), null)
})

test('the default registration is multi-tenant, with no secret anywhere', () => {
  const config = resolveIdentityConfig({ SILLAGE_ENTRA_CLIENT_ID: 'abc-123' })
  assert.deepEqual(config, { clientId: 'abc-123', authority: MULTI_TENANT_AUTHORITY })
  assert.ok(!Object.keys(config ?? {}).some((key) => /secret|password|certificate/i.test(key)))
})

test('a fixed redirect port is honoured, a nonsense one ignored', () => {
  const pinned = resolveIdentityConfig({ SILLAGE_ENTRA_CLIENT_ID: 'a', SILLAGE_ENTRA_REDIRECT_PORT: '8400' })
  assert.equal(pinned?.redirectPort, 8400)
  const junk = resolveIdentityConfig({ SILLAGE_ENTRA_CLIENT_ID: 'a', SILLAGE_ENTRA_REDIRECT_PORT: 'oui' })
  assert.equal(junk?.redirectPort, undefined)
})
