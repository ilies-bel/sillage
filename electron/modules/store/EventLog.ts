/**
 * The append-only event log (DEC-12).
 *
 * Built on `node:sqlite` rather than `better-sqlite3`. Two reasons, and the
 * second is the one that mattered: it is stdlib, so the log has no native
 * module to rebuild per Electron ABI and no `asarUnpack` entry; and it loads in
 * plain `node`, so `core/domain` and the store are unit-testable without an
 * Electron binary — which ARCHITECTURE.md §5.G requires of the domain and which
 * a native module built against Electron's ABI silently prevents.
 */
import { DatabaseSync } from 'node:sqlite'
import {
  MeetingEventSchema,
  type MeetingEvent,
  type StoredEvent,
} from '../../core/contracts/events.ts'
import type { DiagEvent } from '../../core/contracts/diagnostics.ts'
import { DDL, PROJECTION_TABLES, REFOLD_FROM, SCHEMA_VERSION, UPGRADABLE_FROM } from './schema.ts'

export type Clock = () => number

/** What `node:sqlite` accepts as a bound parameter. */
export type SqlParam = string | number | bigint | null | Uint8Array

interface EventRow {
  meeting_id: string
  seq: number
  ts: number
  payload: string
}

export interface ReadOptions {
  /** Exclusive. Pass the last seq you have seen to tail a live meeting. */
  afterSeq?: number
  limit?: number
}

export class EventLog {
  readonly db: DatabaseSync
  /**
   * True when this open dropped the projections to complete an upgrade, and
   * they are therefore empty until somebody folds the log back into them.
   * `Store` is that somebody — reading it is not optional.
   */
  readonly refolded: boolean
  #clock: Clock
  #depth = 0

  constructor(path: string, clock: Clock = Date.now) {
    this.#clock = clock
    this.db = new DatabaseSync(path)

    // Read the stamp before running the DDL. `CREATE TABLE IF NOT EXISTS` is a
    // no-op against a table that already exists with different columns, so a
    // foreign or future database opens cleanly and then fails on the first
    // query — a long way from the cause. Fail here instead, with the version in
    // the message.
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const stamped = this.get<{ value: string }>(
      'SELECT value FROM schema_meta WHERE key = ?',
      'version',
    )
    // An older stamp is accepted only when every change since was additive, in
    // which case the DDL below completes the upgrade by itself. Anything else —
    // a newer file, or an older one needing a real migration — fails here.
    const found = stamped ? Number(stamped.value) : SCHEMA_VERSION
    if (found !== SCHEMA_VERSION && !UPGRADABLE_FROM.has(found)) {
      throw new Error(
        `base de données en version ${stamped?.value}, cette version de l'application attend ${SCHEMA_VERSION} (${path})`,
      )
    }

    // A projection whose columns have changed cannot be upgraded by the DDL —
    // `CREATE TABLE IF NOT EXISTS` would leave the old shape in place. It can
    // be *dropped*, because a projection is a fold and never a record
    // (ARCHITECTURE.md §5.C); `Store` refolds the log into the new one.
    this.refolded = found !== SCHEMA_VERSION && REFOLD_FROM.has(found)
    if (this.refolded) {
      for (const table of PROJECTION_TABLES) this.db.exec(`DROP TABLE IF EXISTS ${table}`)
    }

    this.db.exec(DDL)
    this.run('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)', 'version', String(SCHEMA_VERSION))
  }

  /**
   * The three query helpers. `node:sqlite` returns
   * `Record<string, SQLOutputValue>`, so a row shape is always an assertion —
   * these keep that assertion in one place instead of at every call site.
   */
  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[]
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined
  }

  run(sql: string, ...params: SqlParam[]): void {
    this.db.prepare(sql).run(...params)
  }

  /**
   * Appends one event and returns it with the seq it was given.
   *
   * The seq is allocated inside the INSERT rather than read first, so two
   * writers cannot both compute the same next value. Validation happens here,
   * on the way in: an event that fails its schema never reaches the log, which
   * is what lets readers trust what they fold.
   */
  append(meetingId: string, event: MeetingEvent, ts?: number): StoredEvent {
    const parsed = MeetingEventSchema.parse(event)
    const at = ts ?? this.#clock()
    this.run(
      `INSERT INTO events (meeting_id, seq, ts, type, payload)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE meeting_id = ?), ?, ?, ?)`,
      meetingId,
      meetingId,
      at,
      parsed.type,
      JSON.stringify(parsed),
    )

    const seq = this.lastSeq(meetingId)
    return { meetingId, seq, ts: at, event: parsed }
  }

  /** One transaction, so a partially written batch cannot be observed. */
  appendAll(meetingId: string, events: MeetingEvent[], ts?: number): StoredEvent[] {
    return this.transaction(() => events.map((e) => this.append(meetingId, e, ts)))
  }

  read(meetingId: string, options: ReadOptions = {}): StoredEvent[] {
    const after = options.afterSeq ?? -1
    const limit = options.limit ?? -1
    const rows = this.all<EventRow>(
      `SELECT meeting_id, seq, ts, payload FROM events
       WHERE meeting_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
      meetingId,
      after,
      limit,
    )
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      seq: r.seq,
      ts: r.ts,
      event: MeetingEventSchema.parse(JSON.parse(r.payload)),
    }))
  }

  /** Whole-log scan, oldest first. Used by the projection rebuild and by export. */
  readAll(options: { types?: string[]; sinceTs?: number; limit?: number } = {}): StoredEvent[] {
    const types = options.types ?? []
    const clause = types.length ? `AND type IN (${types.map(() => '?').join(',')})` : ''
    const rows = this.all<EventRow>(
      `SELECT meeting_id, seq, ts, payload FROM events
       WHERE ts >= ? ${clause} ORDER BY ts ASC, meeting_id ASC, seq ASC LIMIT ?`,
      options.sinceTs ?? 0,
      ...types,
      options.limit ?? -1,
    )
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      seq: r.seq,
      ts: r.ts,
      event: MeetingEventSchema.parse(JSON.parse(r.payload)),
    }))
  }

  /**
   * Diagnostics, newest first, unwrapped from their event envelope. A separate
   * query rather than a filter over `readAll` because the retention window is
   * 90 days and the *Réglages → Diagnostics* panel wants the last 200 — reading
   * the whole class to show the tail of it is how a settings screen gets slow.
   */
  readDiagnostics(options: { limit?: number; sinceTs?: number } = {}): DiagEvent[] {
    const rows = this.all<EventRow>(
      `SELECT meeting_id, seq, ts, payload FROM events
       WHERE type = 'diag' AND ts >= ? ORDER BY ts DESC, seq DESC LIMIT ?`,
      options.sinceTs ?? 0,
      options.limit ?? -1,
    )
    return rows.map((r) => {
      const event = MeetingEventSchema.parse(JSON.parse(r.payload))
      if (event.type !== 'diag') throw new Error(`expected diag, got ${event.type}`)
      return event.event
    })
  }

  lastSeq(meetingId: string): number {
    const row = this.get<{ seq: number }>(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE meeting_id = ?',
      meetingId,
    )
    return row?.seq ?? 0
  }

  meetingIds(): string[] {
    return this.all<{ meeting_id: string }>(
      'SELECT DISTINCT meeting_id FROM events ORDER BY meeting_id',
    ).map((r) => r.meeting_id)
  }

  /**
   * The only delete in the codebase (DEC-27). Filtered on `type = 'diag'`, so
   * meeting content cannot be reached by it however the argument is computed —
   * "diagnostics expire at 90 days, meeting content never auto-expires" is
   * enforced by the WHERE clause rather than by the caller.
   */
  purgeDiagnosticsBefore(ts: number): number {
    const before = this.#countDiag()
    this.run(`DELETE FROM events WHERE type = 'diag' AND ts < ?`, ts)
    return before - this.#countDiag()
  }

  #countDiag(): number {
    return this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE type = 'diag'`)?.n ?? 0
  }

  /**
   * Re-entrant. `Store.append()` transacts, and callers legitimately want to
   * wrap several appends in one unit — draining an outbox intent writes the
   * attempt and the result together. Nested calls use savepoints so an inner
   * failure does not silently roll the outer work back.
   */
  transaction<T>(fn: () => T): T {
    const depth = this.#depth++
    const enter = depth === 0 ? 'BEGIN' : `SAVEPOINT sp${depth}`
    const commit = depth === 0 ? 'COMMIT' : `RELEASE sp${depth}`
    const rollback = depth === 0 ? 'ROLLBACK' : `ROLLBACK TO sp${depth}`

    this.db.exec(enter)
    try {
      const result = fn()
      this.db.exec(commit)
      return result
    } catch (err) {
      this.db.exec(rollback)
      if (depth > 0) this.db.exec(`RELEASE sp${depth}`)
      throw err
    } finally {
      this.#depth = depth
    }
  }

  close(): void {
    this.db.close()
  }
}
