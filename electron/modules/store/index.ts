/**
 * The store's public surface. One write path, one read path.
 *
 * `append()` writes the event and folds it into the projections inside a single
 * transaction. That is not a convenience — it is what makes "the projection can
 * never disagree with the log" a property of the code rather than a discipline,
 * and it is what lets the outbox persist a remote id in the same transaction
 * that marks its intent drained (ARCHITECTURE.md §5.F).
 */
import { EventLog, type Clock } from './EventLog.ts'
import { Projections } from './Projections.ts'
import { Lexicon } from './Lexicon.ts'
import { AppState } from './AppState.ts'
import type { MeetingEvent, StoredEvent } from '../../core/contracts/events.ts'

export { EventLog } from './EventLog.ts'
export { Projections } from './Projections.ts'
export { Lexicon } from './Lexicon.ts'
export { AppState } from './AppState.ts'
export type { AddTermInput, StorableScope } from './Lexicon.ts'
export { SCHEMA_VERSION } from './schema.ts'

export class Store {
  readonly log: EventLog
  readonly projections: Projections
  /** Reference data, not a projection — `rebuild()` never touches it. */
  readonly lexicon: Lexicon
  /** What modules remember across restarts. Satisfies `KeyValueStore`. */
  readonly appState: AppState

  constructor(path: string, clock: Clock = Date.now) {
    this.log = new EventLog(path, clock)
    this.projections = new Projections(this.log)
    this.lexicon = new Lexicon(this.log)
    this.appState = new AppState(this.log)

    // The other half of a projection-shape upgrade: `EventLog` dropped the
    // tables so the DDL could recreate them, and they are empty until the log
    // is folded back in. Doing it here rather than in `EventLog` keeps the fold
    // in the one class that owns it.
    if (this.log.refolded) this.projections.rebuild()
  }

  append(meetingId: string, event: MeetingEvent, ts?: number): StoredEvent {
    return this.log.transaction(() => {
      const stored = this.log.append(meetingId, event, ts)
      this.projections.apply(stored)
      return stored
    })
  }

  appendAll(meetingId: string, events: MeetingEvent[], ts?: number): StoredEvent[] {
    return this.log.transaction(() =>
      events.map((event) => {
        const stored = this.log.append(meetingId, event, ts)
        this.projections.apply(stored)
        return stored
      }),
    )
  }

  /** Passthroughs, so `Store` structurally satisfies the diagnostics port. */
  readDiagnostics(options: { limit?: number; sinceTs?: number } = {}) {
    return this.log.readDiagnostics(options)
  }

  purgeDiagnosticsBefore(ts: number): number {
    return this.log.purgeDiagnosticsBefore(ts)
  }

  close(): void {
    this.log.close()
  }
}

/** In-memory store, for tests and for a first boot with no data directory yet. */
export const openMemoryStore = (clock?: Clock): Store => new Store(':memory:', clock)
