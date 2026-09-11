/**
 * Derived tables, folded from the log. Rebuildable, never authoritative.
 *
 * Two are materialised (`meetings`, `outbox`) because they are queried across
 * meetings — the agenda lists every meeting, the outbox drains across all of
 * them. Everything scoped to a single meeting (segments, signals, the document)
 * is folded on demand instead: one meeting's log is small, and a cache that can
 * disagree with the log is a bug waiting to be believed.
 */
import type { EventLog } from './EventLog.ts'
import type { Meeting, MeetingContext, MeetingState } from '../../core/contracts/meeting.ts'
import type { OutboxEntry, PushIntent } from '../../core/contracts/push.ts'
import type { Signal } from '../../core/contracts/signals.ts'
import type { MomentMark } from '../../core/contracts/marks.ts'
import type { TranscriptSegment } from '../../core/contracts/transcript.ts'
import type { ExtractionESN, VerificationReport } from '../../core/contracts/extraction.ts'
import { DEFAULT_RECIPE, type RecipeId } from '../../core/contracts/recipes.ts'
import type { StoredEvent } from '../../core/contracts/events.ts'
import { APP_SCOPE } from '../../core/contracts/events.ts'
import { PROJECTION_TABLES } from './schema.ts'

/**
 * Inclusive bounds on the day a meeting belongs on, as instants. Either side
 * may be null, which is unbounded on that side.
 */
export interface MeetingRange {
  from: number | null
  to: number | null
}

interface MeetingRow {
  id: string
  state: string
  title: string
  event_id: string | null
  client_name: string | null
  scheduled_start: number | null
  created_at: number
  started_at: number | null
  ended_at: number | null
  confirmed_at: number | null
  updated_at: number
}

interface OutboxRow {
  intent_id: string
  meeting_id: string
  kind: string
  state: string
  depends_on: string
  attempts: number
  last_error: string | null
  remote_id: string | null
  updated_at: number
}

const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  state: r.state as MeetingState,
  title: r.title,
  eventId: r.event_id,
  clientName: r.client_name,
  scheduledStart: r.scheduled_start,
  createdAt: r.created_at,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  confirmedAt: r.confirmed_at,
  updatedAt: r.updated_at,
})

const toOutbox = (r: OutboxRow): OutboxEntry => ({
  intentId: r.intent_id,
  meetingId: r.meeting_id,
  kind: r.kind as OutboxEntry['kind'],
  state: r.state as OutboxEntry['state'],
  dependsOn: JSON.parse(r.depends_on) as string[],
  attempts: r.attempts,
  lastError: r.last_error,
  remoteId: r.remote_id,
  updatedAt: r.updated_at,
})

export class Projections {
  #log: EventLog

  constructor(log: EventLog) {
    this.#log = log
  }

  /** Called once per append, inside the writer's transaction. */
  apply(stored: StoredEvent): void {
    if (stored.meetingId === APP_SCOPE) return
    const { meetingId, ts, event } = stored
    const log = this.#log

    switch (event.type) {
      case 'meeting.created':
        log.run(
          `INSERT OR REPLACE INTO meetings
             (id, state, title, event_id, client_name, scheduled_start, created_at, started_at, ended_at, confirmed_at, updated_at)
           VALUES (?, 'idle', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
          meetingId,
          event.title,
          event.context?.eventId ?? null,
          event.clientName ?? null,
          // The calendar's own start wins; the rep's chosen day is what a
          // meeting with no calendar entry has instead (DEC-31). Null is the
          // third case and it means "now" — `created_at` is then the day.
          event.context?.scheduledStart ?? event.scheduledStart ?? null,
          ts,
          ts,
        )
        return

      case 'meeting.renamed':
        log.run(
          `UPDATE meetings SET
             title = ?,
             client_name = COALESCE(?, client_name),
             updated_at = ?
           WHERE id = ?`,
          event.title,
          // Null is "unchanged", so a rep editing only the objet does not wipe
          // the client. Empty string is a real value and clears it — that is the
          // rep deleting what they typed, which is not the same gesture.
          event.clientName,
          ts,
          meetingId,
        )
        return

      case 'meeting.context.updated':
        log.run(
          'UPDATE meetings SET event_id = ?, title = ?, scheduled_start = ?, updated_at = ? WHERE id = ?',
          event.context.eventId,
          event.context.subject,
          // A meeting moved in Outlook moves in the grid. Without this the row
          // would keep the day it was first read on, which is the one thing a
          // calendar may not get wrong.
          event.context.scheduledStart,
          ts,
          meetingId,
        )
        return

      case 'session.transition': {
        // `started_at` and `ended_at` are set on the edge, not on the state, so
        // a re-entry into `extracting` after a failed attempt cannot move them.
        const started = event.to === 'recording' ? ts : null
        const ended = event.from === 'recording' ? ts : null
        log.run(
          `UPDATE meetings SET
             state = ?,
             started_at = COALESCE(started_at, ?),
             ended_at = COALESCE(?, ended_at),
             updated_at = ?
           WHERE id = ?`,
          event.to,
          started,
          ended,
          ts,
          meetingId,
        )
        return
      }

      case 'extraction.completed': {
        /*
         * Only a resolved account renames the meeting, and it never blanks one
         * the rep typed.
         *
         * This used to write `account.name` unconditionally, which was how the
         * unresolved placeholder « Client à confirmer » became a *stored client
         * name* — on the session header, in the search chips, and as the scope
         * the lexicon learns terms under, where every unresolved meeting shared
         * one bucket. `COALESCE` is the second half: an extraction that resolves
         * nothing must not erase the name the rep gave the meeting when they
         * started it.
         */
        const resolved = event.extraction.facts.account.name.trim()
        if (resolved !== '') {
          log.run(
            'UPDATE meetings SET client_name = ?, updated_at = ? WHERE id = ?',
            resolved,
            ts,
            meetingId,
          )
        }
        return
      }

      case 'confirmation.recorded':
        log.run(
          'UPDATE meetings SET confirmed_at = ?, updated_at = ? WHERE id = ?',
          event.at,
          ts,
          meetingId,
        )
        return

      case 'push.intent.created':
        log.run(
          `INSERT OR REPLACE INTO outbox
             (intent_id, meeting_id, kind, state, depends_on, attempts, last_error, remote_id, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?)`,
          event.intent.id,
          meetingId,
          event.intent.kind,
          event.intent.dependsOn.length ? 'blocked' : 'pending',
          JSON.stringify(event.intent.dependsOn),
          ts,
        )
        this.#recomputeBlocked(meetingId, ts)
        return

      case 'push.attempted':
        log.run(
          `UPDATE outbox SET state = 'draining', attempts = ?, updated_at = ? WHERE intent_id = ?`,
          event.attempt,
          ts,
          event.intentId,
        )
        return

      case 'push.settled':
        if (event.result.ok) {
          // The remote id and the drained state land in one statement. There is
          // no idempotency key on the CRM side, so a window where the intent
          // reads as drained without an id — or as undrained with one — is a
          // double-create waiting to happen.
          log.run(
            `UPDATE outbox SET state = 'drained', remote_id = ?, last_error = NULL, updated_at = ?
             WHERE intent_id = ?`,
            event.result.remoteId,
            ts,
            event.result.intentId,
          )
        } else {
          log.run(
            `UPDATE outbox SET state = ?, last_error = ?, updated_at = ? WHERE intent_id = ?`,
            event.result.retryable ? 'pending' : 'failed',
            event.result.reason,
            ts,
            event.result.intentId,
          )
        }
        this.#recomputeBlocked(meetingId, ts)
        return

      default:
        return
    }
  }

  /**
   * Re-evaluates the DAG (DEC-20). `blocked` means **a dependency has not
   * settled yet** — and it used to mean « or has failed », which was a terminal
   * state with no exit and no sentence.
   *
   * One VSA 500 on the opportunity left the compte-rendu task `blocked` for the
   * life of the database. Driven end to end:
   *
   *     OUTBOX: [['i-task','blocked',null], ['i-opp','failed','VSA: 500']]
   *     MEETING STATE: pushing
   *     updateReadiness: { safe: false, reason: 'un envoi vers VerySwing est en cours' }
   *     --- next launch ---
   *     drainable(): []   interrupted(): []   -> nothing ever names it again
   *
   * `drainable()` is `state = 'pending'`, so no boot re-drain reached it; there
   * was no path from `blocked` at all. The compte-rendu — the product's primary
   * deliverable into the client's CRM — was **never attempted, ever**, while
   * *Historique* drew « en attente d'un autre envoi », which was false and
   * quieter than the `failed` row beside it. `allIntentsSettled` counts only
   * `drained`/`failed`, so the meeting never reached `done`; and because
   * `Orchestrator.session()` caches the rehydrated session, `liveStates()`
   * carried `pushing` from boot onwards and **the app could never install an
   * update again**, on the primary platform.
   *
   * So a dependency that has settled — either way — releases its dependants.
   * The ordering exists to carry the opportunity's remote id into the task
   * (`#withDependencyRef`), and that function already handles a dependency that
   * did not drain: the reference stays null, and `VsaCrm.link()` falls through
   * to the company. A compte-rendu linked to the account is worth incomparably
   * more than no compte-rendu at all, and DEC-26 says in as many words that
   * nothing downstream may cost the thing upstream. What blocking was written
   * to protect is untouched: a dependant is never sent *before* its dependency
   * is decided, and an intent whose dependency is still in flight still waits.
   */
  #recomputeBlocked(meetingId: string, ts: number): void {
    const log = this.#log
    const rows = log.all<OutboxRow>('SELECT * FROM outbox WHERE meeting_id = ?', meetingId)
    const byId = new Map(rows.map((r) => [r.intent_id, r]))

    for (const row of rows) {
      if (row.state === 'drained' || row.state === 'failed' || row.state === 'draining') continue
      const deps = JSON.parse(row.depends_on) as string[]
      const ready = deps.every((d) => {
        const state = byId.get(d)?.state
        return state === 'drained' || state === 'failed'
      })
      const next = ready ? 'pending' : 'blocked'
      if (next !== row.state) {
        log.run(
          'UPDATE outbox SET state = ?, updated_at = ? WHERE intent_id = ?',
          next,
          ts,
          row.intent_id,
        )
      }
    }
  }

  /**
   * Drops both projections and folds the entire log back into them. Safe to run
   * at any time — that is the point of a projection — and the recovery path
   * when a fold is found to have been wrong.
   */
  rebuild(): void {
    this.#log.transaction(() => {
      for (const table of PROJECTION_TABLES) this.#log.db.exec(`DELETE FROM ${table}`)
      for (const stored of this.#log.readAll()) this.apply(stored)
    })
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The meetings, newest first, optionally bounded by the day they belong on
   * (DEC-31).
   *
   * `COALESCE(scheduled_start, started_at, created_at)` is the anchor —
   * `meetingAnchor` in `core/contracts/meeting.ts`, the same order the calendar
   * grid and *Période* place a row by — and it now orders the list as well as
   * bounding it. It used to `ORDER BY updated_at DESC`, which is the last time
   * the event log touched the row and not a date: a call validated late sorted
   * above a call held two days after it, and Historique, whose only organising
   * principle is recency, printed its rows out of order. `id DESC` breaks the
   * tie so a page boundary is stable. It is computed in SQL rather than filtered in
   * JavaScript for the reason the range exists at all: a month grid paged back
   * a year must not have to read — and ship — every meeting since, only to throw
   * away all but six weeks of them.
   *
   * A null bound is unbounded on that side, so `listMeetings(500)` still means
   * what it always meant.
   *
   * **A null `limit` is unbounded too**, and it is what `history:search` asks
   * for. DEC-25's promise is every call ever captured, and a search that reads
   * the five hundred most recent meetings cannot keep it: the five hundred and
   * first was unfindable and the screen said « Aucun appel ne correspond. »
   * Unbounded here is one `SELECT` over a projection table — the cost of a
   * search is the *per-meeting* fold the caller does next, which is why that
   * caller runs the cheap axes first.
   */
  listMeetings(limit: number | null = 50, range?: MeetingRange | null): Meeting[] {
    const from = range?.from ?? null
    const to = range?.to ?? null
    const rows = this.#log.all<MeetingRow>(
      `SELECT * FROM meetings
         WHERE (? IS NULL OR COALESCE(scheduled_start, started_at, created_at) >= ?)
           AND (? IS NULL OR COALESCE(scheduled_start, started_at, created_at) <= ?)
         ORDER BY COALESCE(scheduled_start, started_at, created_at) DESC, id DESC
         LIMIT ?`,
      from,
      from,
      to,
      to,
      // SQLite reads a negative `LIMIT` as no limit at all, which is the one
      // spelling of « everything » that needs no second query.
      limit ?? -1,
    )
    return rows.map(toMeeting)
  }

  getMeeting(meetingId: string): Meeting | null {
    const row = this.#log.get<MeetingRow>('SELECT * FROM meetings WHERE id = ?', meetingId)
    return row ? toMeeting(row) : null
  }

  outboxFor(meetingId: string): OutboxEntry[] {
    const rows = this.#log.all<OutboxRow>(
      'SELECT * FROM outbox WHERE meeting_id = ? ORDER BY updated_at ASC',
      meetingId,
    )
    return rows.map(toOutbox)
  }

  /** Everything the drainer may touch, across every meeting. */
  drainable(): OutboxEntry[] {
    const rows = this.#log.all<OutboxRow>(
      `SELECT * FROM outbox WHERE state = 'pending' ORDER BY updated_at ASC`,
    )
    return rows.map(toOutbox)
  }

  /**
   * **Every row a previous process was still POSTing, across every meeting.**
   *
   * `draining` means `push.started` was appended and no `push.settled` followed:
   * the request is on the wire, or the process that sent it is gone. Live, the
   * first is the only possibility and this answers nothing useful. **At boot the
   * second is the only possibility**, and it is the one state in the outbox with
   * no recovery of its own — `Outbox.#reclaim` settles exactly these rows, and
   * it runs as the first line of `#drain`, which `main.ts` calls once per
   * meeting named by `drainable()`. `drainable()` is `state = 'pending'`. So a
   * meeting whose *only* non-terminal row is `draining` was never passed to
   * `drain()`, `#reclaim` never ran, and the row stayed `draining` for the life
   * of the database: « envoi en cours » on the Historique row for ever, no
   * reason, no `pushSettled`, and — because `updateGate.ts` refuses an installer
   * while a push is in flight — no updates either. `POST /v1/crm/tasks` has no
   * idempotency key, so the rep could not safely check by sending it again.
   *
   * The trigger is not a crash. The confirmation handler fires the drain without
   * awaiting it, deliberately, so a rep is never made to wait — and closing the
   * window on Windows quits the app.
   */
  interrupted(): OutboxEntry[] {
    const rows = this.#log.all<OutboxRow>(
      `SELECT * FROM outbox WHERE state = 'draining' ORDER BY updated_at ASC`,
    )
    return rows.map(toOutbox)
  }

  // ── Folded on demand ─────────────────────────────────────────────────────

  /**
   * The intents as they were created, in creation order.
   *
   * Folded rather than materialised: a payload is a whole compte-rendu, and the
   * `outbox` table is the thing queried across meetings — the payloads are read
   * exactly once each, by the drainer, for one meeting at a time. This is what
   * lets a restart resume an undrained outbox: the row says what is left to do,
   * this says what to send.
   */
  intents(meetingId: string): PushIntent[] {
    const out: PushIntent[] = []
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'push.intent.created') out.push(event.intent)
    }
    return out
  }

  segments(meetingId: string): TranscriptSegment[] {
    const out: TranscriptSegment[] = []
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'transcript.segment') out.push(event.segment)
    }
    return out
  }

  /**
   * The rep's own bookmarks (`core/contracts/marks.ts`), oldest first.
   *
   * A fold over the log and not a table, for the reason `intents` and
   * `signals` are: a handful per meeting, read only when a screen that draws
   * this call is open, and `at` is the whole of the ordering — there is no
   * query here that SQL would answer better, and a projection table would be a
   * schema version and a refold bought for nothing.
   */
  marks(meetingId: string): MomentMark[] {
    const out: MomentMark[] = []
    const forgotten = new Set<string>()
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'moment.marked') out.push(event.mark)
      // A mark taken back (`moment.forgotten`). Collected in the same pass and
      // applied after it, so the order of the two events in the log cannot
      // matter — a re-marked id would otherwise come back from the dead.
      if (event.type === 'moment.forgotten') forgotten.add(event.markId)
    }
    return out.filter((mark) => !forgotten.has(mark.id)).sort((a, b) => a.at - b.at)
  }

  signals(meetingId: string): Signal[] {
    const out: Signal[] = []
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'signal.appended') out.push(event.signal)
    }
    return out.sort((a, b) => a.seq - b.seq)
  }

  /** The last persisted ProseMirror doc, or null before the rep types. */
  /**
   * The calendar context, folded from the log rather than kept in a column.
   *
   * A `MeetingContext` is a nested object with an attendee list — a shape SQL
   * would have to shred into three tables to store honestly, for something only
   * ever read whole. `meeting.context.updated` wins over the creation event, so
   * an invite edited after the meeting was armed is reflected.
   *
   * Null for a manually started meeting, which never had one (DEC-15).
   */
  context(meetingId: string): MeetingContext | null {
    let latest: MeetingContext | null = null
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'meeting.created') latest = event.context ?? null
      else if (event.type === 'meeting.context.updated') latest = event.context
    }
    return latest
  }

  /**
   * Which compte-rendu this meeting is set to produce *next* (DEC-43).
   *
   * Folded on demand and not a column, for the reason `context()` is not one:
   * it is read one meeting at a time, by the screen showing that meeting and by
   * the extraction about to run for it. The last `meeting.recipe.chosen` wins,
   * so a rep who switches and switches back leaves both in the log and gets what
   * they last asked for.
   *
   * This is **not** the recipe a stored compte-rendu was written with — that is
   * `interpretation.recipe`, and the two differ exactly while a rep has switched
   * the picker but not yet regenerated. The gate reads the extraction's; the
   * picker and the next run read this.
   */
  recipe(meetingId: string): RecipeId {
    let chosen: RecipeId = DEFAULT_RECIPE
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'meeting.recipe.chosen') chosen = event.recipe
    }
    return chosen
  }

  document(meetingId: string): { revision: number; doc: unknown } | null {
    let latest: { revision: number; doc: unknown } | null = null
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'document.snapshot') latest = { revision: event.revision, doc: event.doc }
    }
    return latest
  }

  extraction(
    meetingId: string,
  ): { extraction: ExtractionESN; verification: VerificationReport } | null {
    let latest: { extraction: ExtractionESN; verification: VerificationReport } | null = null
    for (const { event } of this.#log.read(meetingId)) {
      if (event.type === 'extraction.completed') {
        latest = { extraction: event.extraction, verification: event.verification }
      }
    }
    return latest
  }
}
