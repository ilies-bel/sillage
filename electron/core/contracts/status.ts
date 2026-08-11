/**
 * The app's one general status (DEC-32), and the line that decides what may
 * move it.
 *
 * DEC-26 says every connector is optional at runtime. DEC-32 refines that into
 * something the header can render: **only the subsystems without which a
 * meeting cannot be recorded are allowed to report a problem at app level.**
 * VerySwing being unreachable is a line in *Réglages → Facultatifs* with its
 * reason and its retry — it is not a degradation of the product and must never
 * be drawn as one during a client call.
 *
 * ## Why this lives in `core/contracts/` and not in `core/domain/`
 *
 * The partition is a product rule, so CLAUDE.md would put it in `core/domain/`.
 * But `src/*` may import `core/contracts/` and nothing else, and both readers of
 * this rule are on the renderer side — the header control here, and *Réglages*'
 * *Requis* / *Facultatifs* split. Putting it in `core/domain/` would mean the
 * aggregate travels over a new IPC channel: a second source of truth for a
 * three-key derivation over a snapshot the renderer already holds, free to
 * disagree with it. `core/contracts/` already carries pure derivations over the
 * shapes it declares (`rejectedScopes`, `isConsentFailure`, `isDiagnostic`), and
 * this is one more.
 *
 * ## Why it is a separate file from `health.ts`
 *
 * Every import the renderer makes from `electron/` today is `import type`, so
 * not one byte of `core/` is in the renderer bundle. `health.ts` builds Zod
 * schemas at module scope; importing a *value* from it would pull Zod across the
 * boundary for the sake of three string literals. This file imports types only
 * and has no runtime dependency at all.
 */
import type { ConnectorHealth, ConnectorId, HealthSnapshot } from './health.ts'

/**
 * The load-bearing three. Without audio there is no meeting; without
 * transcription there is no record of it; without analysis there is no
 * compte-rendu. Ordered by how early they fail the rep — `capture` first,
 * because it is the one that cannot be repaired after the call.
 */
export const REQUIRED_CONNECTORS = ['capture', 'transcribe', 'llm'] as const satisfies
  readonly ConnectorId[]
export type RequiredConnectorId = (typeof REQUIRED_CONNECTORS)[number]

/**
 * Optional at runtime by DEC-26. These keep publishing `ConnectorHealth` exactly
 * as they did — they simply stop feeding the aggregate.
 */
export const OPTIONAL_CONNECTORS = ['calendar', 'crm', 'mail'] as const satisfies
  readonly Exclude<ConnectorId, RequiredConnectorId>[]
export type OptionalConnectorId = (typeof OPTIONAL_CONNECTORS)[number]

export const isRequiredConnector = (id: ConnectorId): id is RequiredConnectorId =>
  (REQUIRED_CONNECTORS as readonly ConnectorId[]).includes(id)

/** The three states a `ConnectorHealth` can be in, aggregated. */
export type AppStatusState = ConnectorHealth['state']

export interface AppStatus {
  state: AppStatusState
  /**
   * The required connector that decided the state, and `null` when nothing did.
   * One name, not a list: the aggregate is what DEC-32 collapsed the
   * six-connector strip *into*, so a second failure is read in Réglages rather
   * than crammed into the header. `worst` is what the header names.
   */
  worst: RequiredConnectorId | null
  /** Verbatim from the connector — never composed here. `null` when `ok`. */
  reason: string | null
}

/** `down` outranks `degraded`: the thing that stopped entirely is read first. */
const RANK: Record<AppStatusState, number> = { ok: 0, degraded: 1, down: 2 }

/**
 * The aggregate, from a health snapshot.
 *
 * `Partial` on purpose: a snapshot that has not been seeded for every connector
 * yet reads as *nothing wrong* rather than crashing the header. An unknown
 * subsystem is not a failing one.
 */
export const aggregateStatus = (snapshot: Partial<HealthSnapshot>): AppStatus => {
  let worst: RequiredConnectorId | null = null
  let health: ConnectorHealth | null = null

  for (const id of REQUIRED_CONNECTORS) {
    const current = snapshot[id]
    if (current === undefined || current.state === 'ok') continue
    // Strictly greater, so ties go to the first in REQUIRED_CONNECTORS order.
    if (health === null || RANK[current.state] > RANK[health.state]) {
      worst = id
      health = current
    }
  }

  // `health` is narrowed to `degraded | down` by the loop's own guard, which is
  // why `reason` is reachable below without a second check for it.
  if (worst === null || health === null) {
    return { state: 'ok', worst: null, reason: null }
  }
  return { state: health.state, worst, reason: health.reason }
}
