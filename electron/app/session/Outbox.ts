/**
 * The drain. One confirmation fans out into up to three intents (DEC-4) and
 * this is what ships them (ARCHITECTURE.md §5.F).
 *
 * ## The hazard this file exists to contain
 *
 * **`POST /v1/crm/tasks` has no idempotency key.** A retry after a request that
 * actually succeeded creates a second compte-rendu in the CRM of record, and
 * nothing on the remote side will merge them back. So the rule is absolute: an
 * intent that has drained is never posted again, and the id the remote returned
 * is written in the same transaction that marks it drained.
 *
 * That second half is not implemented here — it is implemented by there being
 * only one write. `Store.append()` folds the event into the projection inside
 * its transaction, and `push.settled` carries the remote id, so "drained" and
 * "remoteId" come out of a single `UPDATE`. There is no window in which a row
 * reads drained without an id, or carries an id without being drained.
 *
 * The first half is three guards, in order of how much they cost to be wrong:
 *
 *   1. only `pending` rows are selected — the projection has already excluded
 *      everything drained;
 *   2. the row is re-read immediately before the call, and a `drained` one is
 *      dropped on the floor;
 *   3. an attempt that throws is treated as **terminal, not retryable**. A
 *      thrown error is exactly the case where we do not know whether the remote
 *      created the record. A port that does know says so by returning
 *      `{ ok: false, retryable: true }` instead of throwing.
 *
 * The same reasoning covers a crash between the call and the settle: the row
 * stays `draining`, and the next drain does not resurrect it — it settles it as
 * failed, with a reason telling the rep to look before relaunching. Losing an
 * automatic retry is cheap. A duplicate in the client's CRM is not.
 *
 * ## The DAG (DEC-20)
 *
 * The opportunity lands before the task that carries its reference; the Outlook
 * draft depends on neither and must ship even when the CRM is unreachable
 * (DEC-26). Which intents are drainable is **not decided here** —
 * `Projections.#recomputeBlocked` folds that rule on `push.intent.created` and
 * `push.settled`, and this file only ever asks for the `pending` ones. One
 * graph rule, in one place: a failed dependency blocks its dependants and
 * nothing else, whichever way you arrive at the question.
 */
import type { CrmPort } from '../../core/contracts/crm.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { MeetingEvent } from '../../core/contracts/events.ts'
import type { MeetingId } from '../../core/contracts/meeting.ts'
import type {
  CompteRenduPayload,
  MailDraftPayload,
  OutboxEntry,
  PushIntent,
  PushResult,
} from '../../core/contracts/push.ts'

/**
 * The half of `modules/mail` this file uses. Structural, so `app/session/`
 * still names no module — the real one is injected in `main.ts` — and narrow
 * enough that it has no second verb to grow into a way of sending (HR-8).
 */
export interface MailDrafter {
  createDraft(payload: MailDraftPayload): Promise<PushResult>
}

/** The half of `modules/store` this file uses. `Store` satisfies it as it stands. */
export interface OutboxJournal {
  append(meetingId: string, event: MeetingEvent, ts?: number): unknown
  readonly projections: {
    outboxFor(meetingId: string): OutboxEntry[]
    intents(meetingId: string): PushIntent[]
  }
}

export interface OutboxDeps {
  journal: OutboxJournal
  /** Null when the CRM is not configured. The Outlook draft still ships (DEC-26). */
  crm: CrmPort | null
  /** Null when Microsoft is not connected. The CRM intents still ship. */
  mail: MailDrafter | null
  /** Attempts per intent, per drain call. Bounded — a queue that retries forever jams. */
  maxAttempts?: number
  /** First wait between rounds. Doubles per round. */
  backoffMs?: number
  sleep?: (ms: number) => Promise<void>
  diagnostics?: DiagRecorder
}

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_BACKOFF_MS = 1_000

/** A crash between the remote call and the settle. See the file header. */
export const INTERRUPTED_REASON =
  'envoi interrompu — vérifiez dans l’outil distant avant de relancer'

const errorReason = (error: unknown): string =>
  error instanceof Error ? error.message : 'envoi impossible'

export class Outbox {
  #journal: OutboxJournal
  #crm: CrmPort | null
  #mail: MailDrafter | null
  #maxAttempts: number
  #backoffMs: number
  #sleep: (ms: number) => Promise<void>
  #diagnostics: DiagRecorder
  /** One drain per meeting. Two concurrent passes would both read the same `pending` row. */
  #inFlight = new Map<MeetingId, Promise<OutboxEntry[]>>()

  constructor(deps: OutboxDeps) {
    this.#journal = deps.journal
    this.#crm = deps.crm
    this.#mail = deps.mail
    this.#maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.#backoffMs = deps.backoffMs ?? DEFAULT_BACKOFF_MS
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#diagnostics = deps.diagnostics ?? NULL_RECORDER
  }

  isDraining(meetingId: MeetingId): boolean {
    return this.#inFlight.has(meetingId)
  }

  /**
   * Drains everything drainable for one meeting and returns the outbox as it
   * stands afterwards. Never throws: the caller is a confirmation handler and a
   * push that fails is a row to retry, not an exception to surface.
   *
   * Safe to call on boot with nothing pending, and safe to call again after a
   * failure — which is what makes "a restart resumes an undrained outbox" a
   * property of the projection rather than of a queue held in memory.
   */
  drain(meetingId: MeetingId): Promise<OutboxEntry[]> {
    const existing = this.#inFlight.get(meetingId)
    if (existing) return existing

    const pass = this.#drain(meetingId).finally(() => this.#inFlight.delete(meetingId))
    this.#inFlight.set(meetingId, pass)
    return pass
  }

  async #drain(meetingId: MeetingId): Promise<OutboxEntry[]> {
    this.#reclaim(meetingId)

    /** Intents this pass will not touch again: terminally failed, or unroutable. */
    const abandoned = new Set<string>()

    for (let round = 0; round < this.#maxAttempts; round++) {
      const tried = new Set<string>()

      // Re-read after every attempt rather than iterating a snapshot: a
      // succeeded opportunity unblocks its task *inside* this loop, and the
      // task then ships in the same round instead of waiting out a backoff.
      let next = this.#ready(meetingId, abandoned, tried)
      while (next) {
        tried.add(next.intentId)
        await this.#attempt(meetingId, next, abandoned)
        next = this.#ready(meetingId, abandoned, tried)
      }

      if (this.#ready(meetingId, abandoned, new Set()) === null) break
      if (round + 1 < this.#maxAttempts) await this.#sleep(this.#backoffMs * 2 ** round)
    }

    return this.#journal.projections.outboxFor(meetingId)
  }

  /**
   * The next intent worth attempting, or null.
   *
   * `pending` is the projection's word, not ours — an intent whose dependencies
   * have all drained. Everything blocked, drained, failed or in flight is
   * already excluded by the state it is in.
   */
  #ready(meetingId: MeetingId, abandoned: Set<string>, tried: Set<string>): OutboxEntry | null {
    const intents = this.#intents(meetingId)
    for (const entry of this.#journal.projections.outboxFor(meetingId)) {
      if (entry.state !== 'pending') continue
      if (abandoned.has(entry.intentId) || tried.has(entry.intentId)) continue
      // Deliberately not gated on `entry.attempts`: the bound is per drain
      // call, not per lifetime. A row that exhausted its retries yesterday is
      // still pending, and the next boot is entitled to try it again — that is
      // what "a restart resumes an undrained outbox" means.
      if (!intents.has(entry.intentId)) continue
      return entry
    }
    return null
  }

  async #attempt(meetingId: MeetingId, entry: OutboxEntry, abandoned: Set<string>): Promise<void> {
    const entries = this.#entries(meetingId)
    const fresh = entries.get(entry.intentId)
    const intent = this.#intents(meetingId).get(entry.intentId)

    // Guard 2 (see the file header). Reached only if something changed the row
    // between selection and here; cheap enough to keep for the day it does.
    if (!fresh || !intent || fresh.state === 'drained') return

    const port = this.#portFor(intent)
    if (!port) {
      // No attempt event: nothing was attempted. The row stays `pending`, so
      // the intent ships once the connector is configured, on the next drain.
      abandoned.add(intent.id)
      this.#record('warn', 'outbox.skipped', 'connecteur non configuré', meetingId, {
        intentId: intent.id,
        kind: intent.kind,
      })
      return
    }

    const attempt = fresh.attempts + 1
    this.#journal.append(meetingId, { type: 'push.attempted', intentId: intent.id, attempt })

    let result: PushResult
    try {
      result = await this.#send(intent, entries)
    } catch (error) {
      // Terminal on purpose. A throw is the case where we cannot know whether
      // the remote created the record, and there is no idempotency key to make
      // a second try safe.
      result = { ok: false, intentId: intent.id, reason: errorReason(error), retryable: false }
    }

    // The intent id is stamped here, not by the adapter: an adapter is handed a
    // payload and has no idea which row it belongs to.
    const settled: PushResult = result.ok
      ? { ok: true, intentId: intent.id, remoteId: result.remoteId }
      : { ok: false, intentId: intent.id, reason: result.reason, retryable: result.retryable }

    this.#journal.append(meetingId, { type: 'push.settled', result: settled })

    if (settled.ok) {
      this.#record('info', 'outbox.drained', 'intention envoyée', meetingId, {
        intentId: intent.id,
        kind: intent.kind,
        attempt,
      })
      return
    }

    if (settled.retryable) {
      this.#record('warn', 'outbox.retry', settled.reason, meetingId, {
        intentId: intent.id,
        kind: intent.kind,
        attempt,
      })
      return
    }

    // Terminal. The projection leaves the dependants blocked and touches
    // nothing else, so the independent intents in the same fan-out still ship.
    abandoned.add(intent.id)
    this.#record('error', 'outbox.failed', settled.reason, meetingId, {
      intentId: intent.id,
      kind: intent.kind,
      attempt,
    })
  }

  /**
   * Settles any row left `draining` by a previous run.
   *
   * Only reachable when the process died between the call and the settle, and
   * deliberately settled as **failed rather than pending**: the remote may hold
   * the record already. `failed` is the state a human retries from — the app
   * will not do it on their behalf.
   */
  #reclaim(meetingId: MeetingId): void {
    for (const entry of this.#journal.projections.outboxFor(meetingId)) {
      if (entry.state !== 'draining') continue
      this.#journal.append(meetingId, {
        type: 'push.settled',
        result: { ok: false, intentId: entry.intentId, reason: INTERRUPTED_REASON, retryable: false },
      })
      this.#record('error', 'outbox.interrupted', INTERRUPTED_REASON, meetingId, {
        intentId: entry.intentId,
        kind: entry.kind,
      })
    }
  }

  #portFor(intent: PushIntent): 'crm' | 'mail' | null {
    if (intent.kind === 'mail.draft') return this.#mail ? 'mail' : null
    return this.#crm ? 'crm' : null
  }

  #send(intent: PushIntent, entries: Map<string, OutboxEntry>): Promise<PushResult> {
    switch (intent.kind) {
      case 'crm.opportunity':
        return this.#crm!.pushOpportunity(intent.payload)
      case 'crm.task':
        return this.#crm!.pushCompteRendu(this.#withDependencyRef(intent.payload, intent, entries))
      case 'mail.draft':
        return this.#mail!.createDraft(intent.payload)
    }
  }

  /**
   * Carries the drained opportunity's remote id into the compte-rendu.
   *
   * This is the entire reason the two are ordered rather than fired together:
   * the reference does not exist until the opportunity has landed, and it is
   * the remote system that names it. The extraction never supplies it — a
   * deterministic identifier never comes from the LLM (DEC-7).
   */
  #withDependencyRef(
    payload: CompteRenduPayload,
    intent: PushIntent,
    entries: Map<string, OutboxEntry>,
  ): CompteRenduPayload {
    for (const dependency of intent.dependsOn) {
      const row = entries.get(dependency)
      if (row?.kind === 'crm.opportunity' && row.state === 'drained' && row.remoteId) {
        return { ...payload, opportunityRef: row.remoteId }
      }
    }
    return payload
  }

  #entries(meetingId: MeetingId): Map<string, OutboxEntry> {
    return new Map(this.#journal.projections.outboxFor(meetingId).map((e) => [e.intentId, e]))
  }

  #intents(meetingId: MeetingId): Map<string, PushIntent> {
    return new Map(this.#journal.projections.intents(meetingId).map((i) => [i.id, i]))
  }

  #record(
    severity: 'info' | 'warn' | 'error',
    code: string,
    message: string,
    meetingId: MeetingId,
    detail: Record<string, unknown> = {},
  ): void {
    this.#diagnostics.record({
      severity,
      code,
      module: 'app',
      message,
      detail: { meetingId, ...detail },
    })
  }
}
