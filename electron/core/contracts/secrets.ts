/**
 * Where credentials live, as a port (DEC-34).
 *
 * This interface used to sit in `modules/identity/vault.ts`, next to the keytar
 * implementation, because the refresh token was the only secret in the product.
 * DEC-34 makes provider keys secrets too, and `modules/transcribe` may not
 * import `modules/identity` — so the *shape* moves here, to `core/contracts/`,
 * and `app/` injects one implementation into everything that needs it. Exactly
 * the pattern `DiagRecorder` already uses.
 *
 * The implementations stay where the I/O is: `modules/identity/vault.ts` keeps
 * `keychainVault` (keytar → macOS Keychain, Windows Credential Manager backed by
 * DPAPI, Linux libsecret) and `memoryVault`.
 *
 * **A key is written here and never anywhere else.** Not the event log, not
 * `Projections`, not a JSON file in `userData`, and above all not a diagnostics
 * bundle — DEC-27 ships those to a support mailbox, and a bundle carrying a live
 * OpenAI key is an incident that outlives the meeting it was collected for.
 */

/** Three verbs. Anything larger is a settings store, which this is not. */
export interface SecretVault {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * The account name a provider's credential is filed under.
 *
 * One function rather than a constant per provider: the id is already unique
 * across both registries, and deriving the key means a provider added to a
 * table cannot forget to add its storage key. The prefix keeps provider keys
 * from colliding with `identity`'s token cache entries in the same service.
 */
export const credentialKeyFor = (providerId: string): string => `provider:${providerId}`

/**
 * What the settings screen is allowed to know about a stored credential.
 *
 * Deliberately not the value. Once a key is in the vault it is never read back
 * to the renderer — there is no reason to, the rep does not need to re-read what
 * they typed, and an IPC channel that can return a secret is one XSS away from
 * exfiltrating it. The screen shows that a key is present and offers to replace
 * or forget it; that is the whole vocabulary.
 */
export interface CredentialState {
  /** A credential is in the vault for this provider. */
  stored: boolean
  /**
   * The last four characters, for recognising *which* key is stored when
   * someone holds several. Null when nothing is stored, and null for `oauth`
   * providers, whose identity is shown as the signed-in account instead.
   */
  hint: string | null
}

/**
 * The hint, from the value, without ever letting the rest of it out.
 *
 * Four characters is what a vendor console shows in its own key list, so it is
 * the amount a person can actually match against. Short values yield no hint at
 * all rather than most of themselves.
 */
export const credentialHint = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed.length >= 8 ? trimmed.slice(-4) : null
}
