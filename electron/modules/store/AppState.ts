/**
 * `KeyValueStore` over the `app_state` table.
 *
 * Small on purpose. The moment this grows a typed accessor per key it becomes a
 * second place where the app's shapes are declared, and the modules that own
 * those shapes stop owning them. Callers serialise, callers validate.
 */
import type { KeyValueStore } from '../../core/contracts/kv.ts'
import type { EventLog } from './EventLog.ts'

export class AppState implements KeyValueStore {
  #log: EventLog

  constructor(log: EventLog) {
    this.#log = log
  }

  get(key: string): string | null {
    const row = this.#log.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', key)
    return row ? row.value : null
  }

  set(key: string, value: string): void {
    this.#log.run(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      Date.now(),
    )
  }

  delete(key: string): void {
    this.#log.run('DELETE FROM app_state WHERE key = ?', key)
  }
}
