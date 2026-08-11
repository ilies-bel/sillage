/**
 * What Réglages reads and writes (DEC-34, DEC-35), wired together.
 *
 * Three things the settings screen needs that no single module owns:
 *
 *  · **credentials** — the OS credential store, cached in memory so building
 *    the tables is not one keychain round trip per provider per render.
 *  · **preferences** — which provider and which checkpoint the rep chose, as
 *    opposed to what the registry would have ranked. Persisted in the KV store
 *    beside the rest of the app's small durable state.
 *  · **downloads** — the Hugging Face fetches, owned by `modules/transcribe`.
 *
 * It lives in `app/` because it composes three modules, and modules never see
 * each other (CLAUDE.md). Everything here is injectable so the whole settings
 * surface can be exercised with no keychain, no disk and no worker thread.
 *
 * ## Why the credential cache exists, and what makes it safe
 *
 * `keytar` is a native addon and every call is a synchronous hop into the OS
 * store; `resolveProviders` runs on every settings read and asks about eleven
 * providers. Reading them once at boot and keeping the map current on write is
 * the difference between a screen that opens instantly and one that stutters.
 *
 * The cache is only ever written through `set`/`clear`, which write the vault
 * first and the map second — so a keychain that refuses (a locked login
 * keychain, a Linux session with no keyring) leaves the map unchanged and the
 * screen still telling the truth about what is stored.
 */
import type { SecretVault, CredentialState } from '../core/contracts/secrets.ts'
import { credentialHint, credentialKeyFor } from '../core/contracts/secrets.ts'
import type { CredentialStateView } from '../core/contracts/settings.ts'
import type { ModelActivity } from '../core/domain/modelRows.ts'
import type { KeyValueStore } from '../core/contracts/kv.ts'

/** The provider ids whose credentials are loaded at boot. Both registries' rows. */
export interface CredentialCacheOptions {
  vault: SecretVault
  providerIds: readonly string[]
}

export class CredentialCache {
  readonly #vault: SecretVault
  readonly #ids: readonly string[]
  #values = new Map<string, string>()

  constructor(options: CredentialCacheOptions) {
    this.#vault = options.vault
    this.#ids = options.providerIds
  }

  /** One pass over the vault at boot. Failures are absences, never throws. */
  async load(): Promise<void> {
    for (const id of this.#ids) {
      try {
        const value = await this.#vault.get(credentialKeyFor(id))
        if (value) this.#values.set(id, value)
      } catch {
        // An unreadable store is indistinguishable from an empty one *for this
        // purpose*: the provider is not configured, the row says so, and the
        // rep is offered the field. Throwing here would take the boot down over
        // a locked keychain.
      }
    }
  }

  /** Provider id → key, for `configuredLlmProviders({ stored })` and its twin. */
  keys(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.#values)
  }

  /** Provider id → what the *screen* may know. Never the value. */
  states(): Readonly<Record<string, CredentialStateView>> {
    const out: Record<string, CredentialStateView> = {}
    for (const [id, value] of this.#values) {
      const state: CredentialState = { stored: true, hint: credentialHint(value) }
      out[id] = { stored: state.stored, hint: state.hint }
    }
    return out
  }

  /** Vault first, cache second — see the header. */
  async set(providerId: string, value: string): Promise<void> {
    await this.#vault.set(credentialKeyFor(providerId), value)
    this.#values.set(providerId, value)
  }

  async clear(providerId: string): Promise<void> {
    await this.#vault.delete(credentialKeyFor(providerId))
    this.#values.delete(providerId)
  }
}

const PROVIDER_KEY = { stt: 'settings.provider.stt', llm: 'settings.provider.llm' } as const
const MODEL_KEY = 'settings.model.local'
/**
 * One row per (provider, field), not one JSON blob per provider.
 *
 * A blob would need read-modify-write on every keystroke's save, and two rapid
 * saves would race to leave the second field's value on top of the first field's
 * absence. Flat keys make each field its own write.
 */
const fieldKey = (providerId: string, key: string) => `settings.provider.field.${providerId}.${key}`

/**
 * What the rep chose.
 *
 * Null everywhere by default, and null means "use the ranking" rather than
 * "nothing works" — DEC-30's ordering is a good default and this is the escape
 * from it, not a replacement for it. That is also why `selectProvider(null)`
 * is a legal request: returning to the default has to be reachable, or the
 * first choice a rep makes is permanent.
 */
export class ProviderPreferenceStore {
  readonly #store: KeyValueStore

  constructor(store: KeyValueStore) {
    this.#store = store
  }

  provider(capability: 'stt' | 'llm'): string | null {
    return this.#store.get(PROVIDER_KEY[capability])
  }

  model(): string | null {
    return this.#store.get(MODEL_KEY)
  }

  async selectProvider(capability: 'stt' | 'llm', providerId: string | null): Promise<void> {
    if (providerId === null) this.#store.delete(PROVIDER_KEY[capability])
    else this.#store.set(PROVIDER_KEY[capability], providerId)
  }

  async selectModel(modelId: string): Promise<void> {
    this.#store.set(MODEL_KEY, modelId)
  }

  /**
   * The declared fields of one provider, as `key → value` (DEC-34).
   *
   * The keys are asked for rather than discovered, because the store has no
   * prefix scan and — more to the point — because the registry is the authority
   * on what a provider needs. Reading back a key some earlier version declared
   * and this one does not would render a field nothing consults.
   */
  fields(providerId: string, keys: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const key of keys) {
      const value = this.#store.get(fieldKey(providerId, key))
      if (value !== null) out[key] = value
    }
    return out
  }

  /** An empty value clears the row: « effacer » and « enregistrer du vide » are one act. */
  async setField(providerId: string, key: string, value: string): Promise<void> {
    const trimmed = value.trim()
    if (trimmed) this.#store.set(fieldKey(providerId, key), trimmed)
    else this.#store.delete(fieldKey(providerId, key))
  }
}

/**
 * Everything `resolveProviders` needs, in one bag.
 *
 * `downloads` is structural rather than the concrete `ModelDownloads`, so a
 * test can render the settings tables against a fixed set of ready models
 * without spawning a worker thread — which is the whole reason the download
 * manager takes its `spawn` as an option in the first place.
 */
export interface SettingsContext {
  credentials: CredentialCache
  preferences: ProviderPreferenceStore
  downloads: {
    ready(catalogue: readonly { id: string }[]): string[]
    state(): Readonly<Record<string, ModelActivity>>
  }
}
