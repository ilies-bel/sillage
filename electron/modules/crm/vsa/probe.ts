/**
 * The connect-time capability diff (DEC-24).
 *
 * A client's VerySwing is not the sandbox. Endpoints get disabled, rights get
 * scoped to a role, a referential comes back empty, and the client's own
 * developments add columns this adapter has never heard of. The failure mode
 * that DEC-24 exists to prevent is finding that out **during the demo**, one 400
 * at a time, from a message nobody can read.
 *
 * So the probe runs once at connect and reports what it found **as data**: it
 * never throws, and its verdict is a list Réglages can render row by row. That
 * is the difference between "CRM indisponible" and "les statuts de tâche sont
 * vides sur ce tenant — le compte-rendu ne pourra pas être poussé".
 *
 * Three kinds of check, and the second is why this file is not just six GETs:
 *
 *   - **call** — a read endpoint, actually called. 404 means the tenant does not
 *     have it, 403 means the account is not allowed it.
 *   - **referential** — a write cannot be *formed* without a status code and a
 *     task type, so an empty referential is a missing capability even though
 *     every endpoint answered. Checked instead of the write itself, because a
 *     probe that POSTs leaves a task in the client's CRM every time the app
 *     starts.
 *   - **columns** — every column `fieldMap.ts` writes, checked against the
 *     schema the spec declares. This is the one that catches a client-specific
 *     field the adapter was pointed at but the server does not have.
 */
import type {
  CapabilityFinding,
  CapabilityReport,
  FieldGap,
} from '../../../core/contracts/crm.ts'
import { ALL_FIELD_TABLES } from './fieldMap.ts'
import { VSA_OPERATIONS, VSA_SCHEMA_COLUMNS, type VsaOperationId } from './generated/operations.ts'
import { VsaError, type VsaSession } from './http.ts'
import { REFERENTIALS, type ReferentialId, type ReferentialSet } from './referentials.ts'

/**
 * The report's shape is a **contract**, not an adapter type.
 *
 * Réglages renders it and `src/*` may import `core/contracts/` only, so the
 * declarations live there and this file only produces them. Keeping the local
 * names is deliberate — `ProbeReport` is what the adapter's own vocabulary
 * calls the thing, and the alias is what stops the two drifting.
 */
export type { CapabilityFinding, CapabilityState } from '../../../core/contracts/crm.ts'
export type ColumnGap = FieldGap
export type ProbeReport = CapabilityReport

interface Expectation {
  id: VsaOperationId | ReferentialId
  label: string
  matters: string
  required: boolean
  /** A read to call, or a referential to look at, or a write we will not perform. */
  kind: 'call' | 'referential' | 'write'
  operation?: VsaOperationId
  referential?: ReferentialId
  /** Referential rows this write needs before it can even be formed. */
  needs?: ReferentialId[]
}

/**
 * What the adapter expects a tenant to offer, as a table.
 *
 * Same idea as `modules/llm/registry.ts`: capabilities are data, not branches.
 * Adding an endpoint to the adapter means adding a row here, and the probe then
 * reports it on every tenant with nothing else to change.
 */
export const EXPECTATIONS: readonly Expectation[] = [
  {
    id: 'findProspectContacts',
    kind: 'call',
    operation: 'findProspectContacts',
    label: 'recherche de contacts par e-mail',
    matters: 'sans elle, un interlocuteur en adresse personnelle n’est jamais rattaché',
    required: true,
  },
  {
    id: 'listCustomers',
    kind: 'call',
    operation: 'listCustomers',
    label: 'liste des clients',
    matters: 'sans elle, aucun compte client n’est proposé',
    required: true,
  },
  {
    id: 'listProspects',
    kind: 'call',
    operation: 'listProspects',
    label: 'liste des prospects',
    matters: 'sans elle, les prospects ne sont pas proposés',
    required: true,
  },
  {
    id: 'listCustomerContacts',
    kind: 'call',
    operation: 'listCustomerContacts',
    label: 'contacts d’un client',
    matters: 'sans eux, les contacts connus ne sont pas rattachés au compte rendu',
    required: false,
  },
  ...REFERENTIALS.map(
    (spec): Expectation => ({
      id: spec.id,
      kind: 'referential',
      referential: spec.id,
      label: `référentiel : ${spec.label}`,
      matters:
        spec.id === 'taskTypes' || spec.id === 'taskStatuses' || spec.id === 'taskPriorities'
          ? 'obligatoire pour créer le compte rendu'
          : 'obligatoire pour créer l’opportunité',
      required: spec.id !== 'prospectStatuses',
    }),
  ),
  {
    id: 'createTask',
    kind: 'write',
    operation: 'createTask',
    label: 'création du compte rendu',
    matters: 'c’est l’écriture principale',
    required: true,
    needs: ['taskTypes', 'taskStatuses', 'taskPriorities'],
  },
  {
    id: 'createOpportunity',
    kind: 'write',
    operation: 'createOpportunity',
    label: 'création de l’opportunité',
    matters: 'sans elle, seul le compte rendu est poussé',
    required: false,
    needs: ['salesStages', 'successProbabilities'],
  },
  {
    id: 'createProspectContact',
    kind: 'write',
    operation: 'createProspectContact',
    label: 'création d’un contact',
    matters: 'sans elle, un nouvel interlocuteur n’est pas créé et le compte rendu part sans lui',
    required: false,
    // `createContact` refuses outright without one — it will not invent a status.
    needs: ['prospectStatuses'],
  },
  // Attaching the transcript is two calls, not one: the media is uploaded, then
  // linked. Probing only the second reports « pièce jointe : ok » on a tenant
  // where the upload is disabled, and the discovery lands mid-demo — the exact
  // failure DEC-24 exists to move forward in time.
  {
    id: 'uploadMedia',
    kind: 'write',
    operation: 'uploadMedia',
    label: 'dépôt de la transcription',
    matters: 'sans lui, la transcription brute n’est pas jointe',
    required: false,
  },
  {
    id: 'attachToTask',
    kind: 'write',
    operation: 'attachToTask',
    label: 'pièce jointe au compte rendu',
    matters: 'sans elle, la transcription brute n’est pas jointe',
    required: false,
  },
]

/** Which generated schema each field table writes into. */
const TABLE_SCHEMA: Record<string, string> = {
  createTask: 'CrmTasks',
  createOpportunity: 'OpportunityIn',
  extraction: 'OpportunityIn',
}

export const columnGaps = (): ColumnGap[] => {
  const gaps: ColumnGap[] = []
  for (const [table, rows] of Object.entries(ALL_FIELD_TABLES)) {
    const schema = TABLE_SCHEMA[table]
    if (!schema) continue
    const known = new Set(VSA_SCHEMA_COLUMNS[schema] ?? [])
    for (const row of rows) {
      if (!known.has(row.column)) gaps.push({ table, column: row.column, schema })
    }
  }
  return gaps
}

export interface ProbeOptions {
  session: VsaSession
  /** Already-fetched referentials, so the probe costs six calls rather than twelve. */
  referentials: ReferentialSet | null
  now?: () => number
}

/**
 * Runs the diff. **Never throws** — a probe that throws is a probe whose report
 * nobody can read, and the report is the entire point.
 */
export const probeVsa = async (options: ProbeOptions): Promise<ProbeReport> => {
  const at = (options.now ?? Date.now)()
  const findings: CapabilityFinding[] = []

  let authenticated = false
  try {
    await options.session.token()
    authenticated = true
  } catch (error) {
    findings.push({
      id: 'login',
      label: 'connexion à VerySwing',
      matters: 'rien ne peut être poussé sans elle',
      required: true,
      state: error instanceof VsaError && error.badCredentials ? 'denied' : 'missing',
      status: error instanceof VsaError ? error.status : null,
      detail: error instanceof Error ? error.message : 'connexion impossible',
    })
  }

  if (authenticated) {
    for (const expectation of EXPECTATIONS) {
      findings.push(await one(options, expectation))
    }
  }

  const gaps = columnGaps()
  const missing = findings.filter((f) => f.required && f.state !== 'ok' && f.state !== 'unverified')
  const ok = authenticated && missing.length === 0 && gaps.length === 0

  return {
    at,
    authenticated,
    findings,
    columnGaps: gaps,
    ok,
    summary: summarise({ authenticated, missing, gaps }),
  }
}

const summarise = (input: {
  authenticated: boolean
  missing: CapabilityFinding[]
  gaps: ColumnGap[]
}): string => {
  if (!input.authenticated) return 'connexion à VerySwing impossible — vérifiez les identifiants'
  if (input.missing.length > 0) {
    const names = input.missing.map((f) => f.label).join(', ')
    return input.missing.length === 1
      ? `une capacité manque sur ce tenant : ${names}`
      : `${input.missing.length} capacités manquent sur ce tenant : ${names}`
  }
  if (input.gaps.length > 0) {
    const names = input.gaps.map((g) => g.column).join(', ')
    return `ce tenant ne déclare pas ${input.gaps.length === 1 ? 'la colonne' : 'les colonnes'} ${names}`
  }
  return 'VerySwing répond, toutes les capacités attendues sont présentes'
}

const one = async (options: ProbeOptions, expectation: Expectation): Promise<CapabilityFinding> => {
  const base = {
    id: expectation.id,
    label: expectation.label,
    matters: expectation.matters,
    required: expectation.required,
  }

  if (expectation.kind === 'referential') {
    const rows = expectation.referential ? options.referentials?.[expectation.referential] : undefined
    if (rows === undefined) {
      return { ...base, state: 'unverified', status: null, detail: 'référentiels non chargés' }
    }
    return rows.length === 0
      ? { ...base, state: 'missing', status: null, detail: 'la liste est vide sur ce tenant' }
      : { ...base, state: 'ok', status: null, detail: `${rows.length} valeur(s)` }
  }

  if (expectation.kind === 'write') {
    // A probe never writes. Duplicating a compte-rendu in the client's CRM once
    // per app start is a far worse outcome than an unverified row that says so.
    const needs = expectation.needs ?? []
    const empty = needs.filter((id) => (options.referentials?.[id] ?? []).length === 0)
    if (options.referentials === null) {
      return { ...base, state: 'unverified', status: null, detail: 'référentiels non chargés' }
    }
    if (empty.length > 0) {
      const labels = empty.map((id) => REFERENTIALS.find((r) => r.id === id)?.label ?? id).join(', ')
      return { ...base, state: 'missing', status: null, detail: `référentiel(s) vide(s) : ${labels}` }
    }
    return { ...base, state: 'unverified', status: null, detail: 'non vérifiée : la sonde n’écrit jamais' }
  }

  const operation = VSA_OPERATIONS[expectation.operation ?? 'listCustomers']
  try {
    await options.session.request({
      operationPath: operation.path,
      method: operation.method,
      // Every path parameter gets a value that cannot exist, so the call is a
      // permission and routing check and never touches a real record.
      params: Object.fromEntries(operation.pathParams.map((name) => [name, '__sonde__'])),
      query: (operation.query as readonly string[]).includes('limit') ? { limit: 1, offset: 1 } : {},
    })
    return { ...base, state: 'ok', status: 200, detail: 'disponible' }
  } catch (error) {
    if (!(error instanceof VsaError)) {
      return { ...base, state: 'missing', status: null, detail: 'appel impossible' }
    }
    if (error.status === 403) {
      return { ...base, state: 'denied', status: 403, detail: 'droit refusé pour ce compte VerySwing' }
    }
    if (error.notFound) {
      // A 404 on a path with a placeholder means "no such record", which is the
      // expected answer to a probe: the route exists and the account may use it.
      const usedPlaceholder = operation.pathParams.length > 0
      return usedPlaceholder
        ? { ...base, state: 'ok', status: 404, detail: 'disponible (enregistrement de test absent, attendu)' }
        : { ...base, state: 'missing', status: 404, detail: 'absente de ce tenant' }
    }
    return { ...base, state: 'missing', status: error.status, detail: error.message }
  }
}
