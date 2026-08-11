/**
 * The tenant's referentials: task types, statuses, priorities, sales stages,
 * success probabilities, prospect statuses.
 *
 * **Never hard-coded** (DEC-24, `docs/reference/vsa-api.md`). Every one of these
 * lists is tenant configuration — an ESN renames "Rendez-vous client" and
 * renumbers its priorities, and a constant compiled into this app is then a
 * silent 400 on the one click the whole product is built around. So the lists
 * are fetched, and the only thing written down here is *which endpoint answers
 * for which list* and *which key holds the code* — the table below, which is
 * generated data plus two column names per row.
 *
 * The preference lists in `PICK_HINTS` are hints, not values: they say which
 * entry to take when the tenant offers several, and when none matches, the first
 * entry the tenant returned wins and a diagnostic records that it was a
 * fallback. That keeps "we did not invent a code" true in both branches.
 */
import type { DiagRecorder } from '../../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../../core/contracts/diagnostics.ts'
import { VSA_OPERATIONS, type VsaOperationId } from './generated/operations.ts'
import type { VsaSession } from './http.ts'

export type ReferentialId =
  | 'taskTypes'
  | 'taskStatuses'
  | 'taskPriorities'
  | 'salesStages'
  | 'successProbabilities'
  | 'prospectStatuses'

/** One row of a tenant list, normalised. `raw` keeps whatever else came back. */
export interface ReferentialEntry {
  /** The value a write sends. String even for `priorityNumber` — see `numericCode`. */
  code: string
  label: string
  active: boolean
  raw: Record<string, unknown>
}

/**
 * Which endpoint answers for which list, and where the code lives in its rows.
 *
 * Six lists, six different key names — `typeCode`, `statusCode`,
 * `priorityNumber`, `salesStageCode`, `probabilityCode`, `code`. That is not a
 * pattern worth inferring; it is five words worth writing down, checked against
 * `generated/schemas.ts` by the typechecker through `VSA_OPERATIONS`.
 */
export interface ReferentialSpec {
  readonly id: ReferentialId
  readonly operation: VsaOperationId
  readonly codeKey: string
  readonly labelKey: string
  /** Absent when the endpoint has no notion of an inactive row. */
  readonly activeKey?: string
  /** Shown in Réglages and in the probe report. French, like every user string. */
  readonly label: string
}

export const REFERENTIALS: readonly ReferentialSpec[] = [
  { id: 'taskTypes', operation: 'taskTypes', codeKey: 'typeCode', labelKey: 'description', activeKey: 'active', label: 'types de tâche' },
  { id: 'taskStatuses', operation: 'taskStatuses', codeKey: 'statusCode', labelKey: 'description', activeKey: 'active', label: 'statuts de tâche' },
  { id: 'taskPriorities', operation: 'taskPriorities', codeKey: 'priorityNumber', labelKey: 'description', label: 'priorités' },
  { id: 'salesStages', operation: 'salesStages', codeKey: 'salesStageCode', labelKey: 'description', label: 'étapes commerciales' },
  { id: 'successProbabilities', operation: 'successProbabilities', codeKey: 'probabilityCode', labelKey: 'description', label: 'probabilités de succès' },
  { id: 'prospectStatuses', operation: 'prospectStatuses', codeKey: 'code', labelKey: 'description', label: 'statuts de prospect' },
]

export type ReferentialSet = Record<ReferentialId, ReferentialEntry[]>

/**
 * Six hours.
 *
 * Long enough that a rep's day costs one fetch of six small lists rather than
 * one per push; short enough that an admin who adds a task type at lunch sees it
 * without restarting the app. The lists are configuration, not data: they change
 * on the order of months, so the risk this window carries is a rename being
 * stale for an afternoon — against a per-push refresh that would put six
 * round-trips in front of the one click the product is judged on.
 */
export const REFERENTIAL_TTL_MS = 6 * 60 * 60 * 1000

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

export const normalise = (spec: ReferentialSpec, rows: unknown): ReferentialEntry[] => {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const raw = asRecord(row)
      const active = spec.activeKey === undefined ? true : raw[spec.activeKey] !== false
      return { code: asText(raw[spec.codeKey]), label: asText(raw[spec.labelKey]), active, raw }
    })
    .filter((entry) => entry.code !== '')
}

/**
 * Which entry to prefer when the tenant offers several, per referential.
 *
 * Substrings, matched case- and accent-insensitively against code *and* label,
 * in order. A hint that matches nothing costs nothing — the first row wins and
 * the choice is recorded as a fallback, which is exactly what should happen on a
 * tenant that named its statuses in Dutch.
 */
export const PICK_HINTS: Record<ReferentialId, readonly string[]> = {
  // A meeting report is a "compte-rendu de rendez-vous" in most VSA setups.
  taskTypes: ['compte', 'rendez', 'rdv', 'reunion', 'meeting', 'visite'],
  // The task lands already done — it reports a meeting that happened.
  taskStatuses: ['termine', 'realise', 'fait', 'done', 'closed'],
  taskPriorities: ['normale', 'normal', 'moyenne', 'medium'],
  // First stage: a qualification call is the start of a cycle, not the middle.
  salesStages: ['qualification', 'decouverte', 'identification', 'prospect'],
  successProbabilities: ['25', '20', 'faible', 'low'],
  prospectStatuses: ['actif', 'active', 'en cours'],
}

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export interface ReferentialChoice {
  code: string
  label: string
  /** `preferred` when a hint matched, `fallback` when the tenant's first row won. */
  why: 'preferred' | 'fallback'
}

/**
 * Picks one entry. Returns `null` only when the tenant's list is empty — which
 * is a capability gap `probe.ts` reports, not something to paper over with a
 * literal.
 */
export const pick = (entries: readonly ReferentialEntry[], hints: readonly string[]): ReferentialChoice | null => {
  const usable = entries.filter((entry) => entry.active)
  const pool = usable.length > 0 ? usable : entries
  const first = pool[0]
  if (!first) return null

  for (const hint of hints) {
    const folded = fold(hint)
    const match = pool.find((entry) => fold(entry.code).includes(folded) || fold(entry.label).includes(folded))
    if (match) return { code: match.code, label: match.label, why: 'preferred' }
  }
  return { code: first.code, label: first.label, why: 'fallback' }
}

/** `priorityNumber` is an integer column; every other code is a string. */
export const numericCode = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface ReferentialCacheOptions {
  session: VsaSession
  now?: () => number
  ttlMs?: number
  diagnostics?: DiagRecorder
}

/**
 * Fetches the six lists once and holds them for `REFERENTIAL_TTL_MS`.
 *
 * A failed list is an empty list rather than a thrown error: five referentials
 * arriving and one 404ing is a capability gap the probe should report, not a
 * reason for the CRM connector to go `down` and take the compte-rendu with it.
 */
export class ReferentialCache {
  #session: VsaSession
  #now: () => number
  #ttlMs: number
  #diagnostics: DiagRecorder
  #cached: ReferentialSet | null = null
  #fetchedAt = 0
  #inFlight: Promise<ReferentialSet> | null = null

  constructor(options: ReferentialCacheOptions) {
    this.#session = options.session
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs ?? REFERENTIAL_TTL_MS
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
  }

  /** True when the next `all()` will hit the network. Read by Réglages. */
  get stale(): boolean {
    return this.#cached === null || this.#now() - this.#fetchedAt >= this.#ttlMs
  }

  get fetchedAt(): number {
    return this.#fetchedAt
  }

  invalidate(): void {
    this.#cached = null
    this.#fetchedAt = 0
  }

  async all(): Promise<ReferentialSet> {
    const cached = this.#cached
    if (cached && !this.stale) return cached
    // Six lists behind one flight: `pushCompteRendu` and `pushOpportunity` drain
    // concurrently from the outbox, and two cold starts would fetch twelve.
    this.#inFlight ??= this.#load().finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  async #load(): Promise<ReferentialSet> {
    const loaded = {} as ReferentialSet
    for (const spec of REFERENTIALS) {
      loaded[spec.id] = await this.#one(spec)
    }
    this.#cached = loaded
    this.#fetchedAt = this.#now()
    return loaded
  }

  async #one(spec: ReferentialSpec): Promise<ReferentialEntry[]> {
    const operation = VSA_OPERATIONS[spec.operation]
    try {
      const rows = await this.#session.request({ operationPath: operation.path, method: operation.method })
      return normalise(spec, rows)
    } catch (error) {
      this.#diagnostics.record({
        severity: 'warn',
        code: 'crm.referential.unavailable',
        module: 'crm',
        message: `référentiel « ${spec.label} » indisponible`,
        detail: { referential: spec.id, reason: error instanceof Error ? error.message : String(error) },
      })
      return []
    }
  }
}
