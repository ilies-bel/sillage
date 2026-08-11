/**
 * Where the refresh token sleeps.
 *
 * The OS credential store, not a file. On macOS that is the Keychain, on Windows
 * the Credential Manager (DPAPI-encrypted at rest), on Linux libsecret. A
 * refresh token is a long-lived credential to a rep's mailbox and calendar; a
 * JSON file in `userData` would put it a `cat` away for every process running as
 * that user.
 *
 * `@azure/msal-node-extensions` is the vendor's answer to the same problem and
 * is what VISION.md §295 names. It is deferred: it carries a native addon that
 * has to be rebuilt per Electron ABI, and `keytar` — already a dependency, and
 * backed by the same OS stores — closes the gap without adding a second native
 * build to the release. Revisit when the Windows broker (WAM) is wanted, which
 * is the part keytar genuinely cannot do.
 *
 * Since DEC-34 this store holds provider API keys as well as the refresh token,
 * so the **interface** lives in `core/contracts/secrets.ts` — `modules/llm` and
 * `modules/transcribe` need one and may not import this module. Only the two
 * implementations stay here, where the I/O is.
 */
import type { SecretVault } from '../../core/contracts/secrets.ts'

export type { SecretVault }

/** Namespaced so an uninstall-reinstall of a *different* app cannot collide. */
export const VAULT_SERVICE = 'fr.esn.sillage'

/** The three keytar calls this file uses. Declared so `any` stops at the edge. */
export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

/**
 * Resolved on first use and injectable, following `modules/capture/nativeModule`.
 *
 * keytar is a native addon: requiring it at import time would make every test
 * that touches this module depend on a binding built for the running ABI, and
 * `require` is not even defined when this tree runs as ESM under `node --test`.
 * The default is the packaged app's path; a test passes its own.
 */
export type KeytarLoader = () => KeytarLike

export const keychainVault = (
  service: string = VAULT_SERVICE,
  load: KeytarLoader = () => require('keytar') as KeytarLike,
): SecretVault => {
  let keytar: KeytarLike | null = null
  const lib = (): KeytarLike => (keytar ??= load())
  return {
    get: (key) => lib().getPassword(service, key),
    set: (key, value) => lib().setPassword(service, key, value),
    delete: async (key) => void (await lib().deletePassword(service, key)),
  }
}

/**
 * Forgets on exit. The documented degradation when the OS store is unavailable
 * — a headless CI box, a Linux session with no keyring — and the only sane one:
 * the alternative is writing the token somewhere less safe. The cost is one
 * sign-in per launch, which is visible, and that is the point.
 */
export const memoryVault = (): SecretVault => {
  const map = new Map<string, string>()
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
  }
}
