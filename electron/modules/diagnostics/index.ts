/**
 * The diagnostics sink (DEC-27, ARCHITECTURE.md §5.I).
 *
 * **Ships in step 1, not last.** Every step after this one is debugged through
 * it, and a diagnostics surface added at the end is a diagnostics surface that
 * was never used while it mattered.
 *
 * Errors go into the same append-only log as everything else — one store, one
 * query path, one retention mechanism — with two independent retentions:
 * diagnostics roll off at 90 days, meeting content never auto-expires.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_RETENTION,
  type DiagBundle,
  type DiagEnvironment,
  type DiagEvent,
  type DiagInput,
  type DiagRecorder,
  type ExportMode,
  type RetentionPolicy,
} from '../../core/contracts/diagnostics.ts'
import { APP_SCOPE, type MeetingEvent, type StoredEvent } from '../../core/contracts/events.ts'
import { buildDiagBundle } from '../../core/domain/redactDiagnostics.ts'

/**
 * What `Diagnostics` needs from the store, as a port.
 *
 * `modules/diagnostics` may not import `modules/store` (the boundary rule), and
 * that constraint is doing real work here: it is what stops the diagnostics
 * sink from growing a second opinion about how events are stored.
 * `modules/store`'s `Store` satisfies this structurally; the orchestrator hands
 * one over.
 */
export interface DiagLog {
  append(meetingId: string, event: MeetingEvent, ts?: number): StoredEvent
  readDiagnostics(options?: { limit?: number; sinceTs?: number }): DiagEvent[]
  purgeDiagnosticsBefore(ts: number): number
}

export interface DiagnosticsOptions {
  environment: DiagEnvironment
  retention?: RetentionPolicy
  clock?: () => number
  /** Injected so a test can assert on ids without matching a UUID. */
  mintId?: () => string
}

const DAY_MS = 86_400_000

export class Diagnostics implements DiagRecorder {
  #log: DiagLog
  #environment: DiagEnvironment
  #retention: RetentionPolicy
  #clock: () => number
  #mintId: () => string

  constructor(log: DiagLog, options: DiagnosticsOptions) {
    this.#log = log
    this.#environment = options.environment
    this.#retention = options.retention ?? DEFAULT_RETENTION
    this.#clock = options.clock ?? Date.now
    this.#mintId = options.mintId ?? (() => crypto.randomUUID())
  }

  record(input: DiagInput): DiagEvent {
    const event: DiagEvent = {
      id: this.#mintId(),
      ts: this.#clock(),
      severity: input.severity,
      code: input.code,
      module: input.module,
      message: input.message,
      detail: input.detail ?? {},
      meetingId: input.meetingId ?? null,
    }
    // Scoped to the meeting when there is one, so Historique can show a call's
    // failures beside its transcript; otherwise to the app.
    this.#log.append(event.meetingId ?? APP_SCOPE, { type: 'diag', event }, event.ts)
    return event
  }

  recent(limit = 200): DiagEvent[] {
    return this.#log.readDiagnostics({ limit })
  }

  /** Rolling, run on boot. Returns how many events went. */
  purge(now = this.#clock()): number {
    return this.#log.purgeDiagnosticsBefore(now - this.#retention.diagnosticsDays * DAY_MS)
  }

  bundle(mode: ExportMode, limit = 5000): DiagBundle {
    const events = this.#log.readDiagnostics({ limit })
    return buildDiagBundle(mode, events, this.#environment, this.#clock())
  }

  /**
   * NDJSON: one header line, then one event per line. Streams, greps, and
   * survives being truncated by a mail client — which a single JSON array
   * does not.
   */
  writeBundle(mode: ExportMode, directory: string): { path: string; events: number } {
    const bundle = this.bundle(mode)
    const name = `diagnostics-${mode}-${bundle.generatedAt}.ndjson`
    const path = join(directory, name)
    const lines = [
      JSON.stringify({
        mode: bundle.mode,
        generatedAt: bundle.generatedAt,
        environment: bundle.environment,
      }),
      ...bundle.events.map((e) => JSON.stringify(e)),
    ]
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
    return { path, events: bundle.events.length }
  }
}
