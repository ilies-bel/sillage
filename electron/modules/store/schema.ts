/**
 * The whole storage schema. One authoritative table, two derived ones.
 *
 * `events` is the source of truth (DEC-12, ARCHITECTURE.md §5.C). `meetings`
 * and `outbox` are projections: rebuildable by folding the log, never
 * authoritative, safe to drop. If a question can only be answered by reading a
 * projection, the projection is missing an event, not the other way round.
 */

export const SCHEMA_VERSION = 4

/**
 * Versions this one can open, and the two ways it gets there.
 *
 *   2 ← 1  the `lexicon` table       — additive
 *   3 ← 2  the `app_state` table     — additive
 *   4 ← 3  `meetings.scheduled_start` — a **column**, so not additive
 *
 * An additive change is free: `CREATE TABLE IF NOT EXISTS` completes it and the
 * file ends up indistinguishable from a fresh one. A **column** change is the
 * opposite — that same no-op is what makes it silent, and the app would boot
 * and then fail on the first query with "no such column". That is precisely
 * what the version stamp exists to catch.
 *
 * The column added at 4 is on a *projection*, which is the one case where the
 * real migration is trivial: projections are folds of the log and nothing else
 * (ARCHITECTURE.md §5.C), so they are dropped, recreated by the DDL and folded
 * back in. `EventLog` does the drop, `Store` does the refold. Nothing is lost,
 * including the outbox's remote ids — those are in the log, which is why the
 * outbox writes them there before it writes them anywhere else.
 *
 * A column added to `events` would still have to refuse the old file. That
 * table is the record; there is nothing to refold it from.
 */
export const UPGRADABLE_FROM: ReadonlySet<number> = new Set([1, 2, 3])

/**
 * Of those, the ones whose projections no longer match this DDL and must be
 * dropped before it runs. Currently all of them — a 1, 2 or 3 file has a
 * `meetings` table without `scheduled_start`.
 */
export const REFOLD_FROM: ReadonlySet<number> = new Set([1, 2, 3])

/**
 * Deliberately not `natively.db`.
 *
 * The old product left one of those in `userData` with its own `meetings`
 * table, and `CREATE TABLE IF NOT EXISTS` is a silent no-op against it — the
 * app boots, then fails on the first query with "no such column". An upgrade
 * over an existing install must not be able to open the wrong file at all, so
 * the new store gets its own name and its own version stamp.
 */
export const DB_FILENAME = 'sillage.db'

export const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ── The log ────────────────────────────────────────────────────────────────
-- Append-only. The ONLY statement in the codebase that deletes from it is the
-- diagnostics purge, and it is filtered on type = 'diag' (DEC-27).
CREATE TABLE IF NOT EXISTS events (
  meeting_id TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  PRIMARY KEY (meeting_id, seq)
);

-- Retention sweeps scan by (type, ts); Historique scans by meeting.
CREATE INDEX IF NOT EXISTS events_type_ts ON events (type, ts);

-- ── Projections ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id           TEXT PRIMARY KEY,
  state        TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  event_id     TEXT,
  client_name  TEXT,
  -- The day the meeting belongs on (DEC-31): the calendar event's start, or
  -- the day the rep placed it on by hand. NULL means "now", i.e. created_at.
  scheduled_start INTEGER,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  ended_at     INTEGER,
  confirmed_at INTEGER,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS meetings_updated ON meetings (updated_at DESC);

-- remote_id is the reason this table exists rather than being folded on
-- demand: POST /v1/crm/tasks has no idempotency key, so "has this already been
-- posted?" must be answerable by a single indexed read before every attempt.
CREATE TABLE IF NOT EXISTS outbox (
  intent_id  TEXT PRIMARY KEY,
  meeting_id TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  state      TEXT    NOT NULL,
  depends_on TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  remote_id  TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS outbox_drainable ON outbox (state, updated_at);

-- ── Reference data ─────────────────────────────────────────────────────────
-- Neither a log nor a projection: curated vocabulary (DEC-17), authoritative,
-- and NOT rebuildable by folding events — which is why it is absent from
-- PROJECTION_TABLES and why rebuild() must never touch it. Dropping this table
-- loses everything the app has learned about how a client's people and projects
-- are spelled.
--
-- scope_key is '' for account-wide terms and the client name for client-scoped
-- ones, so one index serves both lookups.
CREATE TABLE IF NOT EXISTS lexicon (
  term       TEXT    NOT NULL,
  scope      TEXT    NOT NULL,
  scope_key  TEXT    NOT NULL,
  category   TEXT    NOT NULL,
  variants   TEXT    NOT NULL DEFAULT '[]',
  hits       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, scope_key, term)
);

CREATE INDEX IF NOT EXISTS lexicon_scope ON lexicon (scope, scope_key);

-- ── App state ──────────────────────────────────────────────────────────────
-- Named strings a module has to remember across restarts: the calendar's
-- @odata.deltaLink and the fold it was earned over, which account signed in.
-- Also not a projection — a delta cursor cannot be recomputed from anything
-- this app holds, only re-earned from Graph.
--
-- Deliberately separate from schema_meta, which is the version stamp's home:
-- mixing app state into the table that decides whether the file can be opened
-- at all is how a bad write becomes a database that will not boot.
CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Dropped and refilled by `Projections.rebuild()`. Never the four tables above it. */
export const PROJECTION_TABLES = ['meetings', 'outbox'] as const
