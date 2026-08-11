/**
 * A named string, persisted. The smallest port in the codebase, and deliberately
 * so.
 *
 * `modules/calendar` has to remember its `@odata.deltaLink` across restarts and
 * `modules/identity` has to remember which account signed in. Neither may import
 * `modules/store` (ARCHITECTURE.md §4), so the orchestrator injects this and the
 * store satisfies it structurally.
 *
 * Values are strings. A caller with structure to store serialises it and owns
 * the schema of what it wrote — this port stays free of a value type so it never
 * becomes a second, informal place where the app's shapes are declared.
 */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

/** Forgets everything, immediately. For tests and for a boot with no store yet. */
export const memoryKeyValueStore = (): KeyValueStore => {
  const map = new Map<string, string>()
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    delete: (key) => void map.delete(key),
  }
}
