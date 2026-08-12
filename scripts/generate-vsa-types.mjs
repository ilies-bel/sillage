#!/usr/bin/env node
/**
 * Generates `electron/modules/crm/vsa/generated/` from the vendored sandbox spec.
 *
 * Two files come out of here and neither is ever hand-edited (CLAUDE.md, the CRM
 * boundary): `schemas.ts` holds the request/response shapes, `operations.ts`
 * holds one descriptor per endpoint — method, path, query parameters, required
 * body fields. That second file is what `probe.ts` diffs a tenant against, which
 * is the reason the descriptors are generated rather than written by hand: "what
 * the adapter expects" has to come from the spec, or the diff is comparing the
 * tenant against somebody's memory.
 *
 * **Only the endpoints in `docs/reference/vsa-api.md` are generated**, not all
 * 261 paths. Emitting the full surface would produce ~200 kB of interfaces for
 * the payroll, invoicing and recruitment modules that this product never calls,
 * and every one of them would be typechecked on every `npm run check`. The
 * OPERATIONS table below is the list, and adding an endpoint means adding a row
 * and re-running this script.
 *
 *   node scripts/generate-vsa-types.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SPEC_PATH = join(ROOT, 'docs/reference/vsa-sandbox-openapi.json')
const OUT_DIR = join(ROOT, 'electron/modules/crm/vsa/generated')

/**
 * The endpoints the adapter uses, in the order `docs/reference/vsa-api.md`
 * introduces them. `id` is ours — the spec's `operationId` is a hash and would
 * make every call site unreadable.
 */
const OPERATIONS = [
  { id: 'login', method: 'post', path: '/login' },
  { id: 'expiration', method: 'get', path: '/expiration' },

  // writes
  { id: 'createTask', method: 'post', path: '/v1/crm/tasks' },
  { id: 'attachToTask', method: 'post', path: '/v1/crm/tasks/{id}/attach' },
  { id: 'uploadMedia', method: 'post', path: '/v1/media/upload' },
  { id: 'createOpportunity', method: 'post', path: '/v1/opportunity' },
  { id: 'createProspectContact', method: 'post', path: '/v1/prospect/{code}/contact' },

  // referentials — fetched per tenant, never hard-coded (DEC-24)
  { id: 'taskTypes', method: 'get', path: '/v1/crm/task/types' },
  { id: 'taskStatuses', method: 'get', path: '/v1/crm/task/status' },
  { id: 'taskPriorities', method: 'get', path: '/v1/crm/task/priorities' },
  { id: 'salesStages', method: 'get', path: '/v1/opportunity/sales/stages' },
  { id: 'successProbabilities', method: 'get', path: '/v1/opportunity/success/probabilities' },
  { id: 'prospectStatuses', method: 'get', path: '/v1/prospect/status' },

  // entity resolution
  { id: 'findProspectContacts', method: 'get', path: '/v1/prospect-contacts' },
  { id: 'listCustomers', method: 'get', path: '/v1/crm/customers' },
  { id: 'listProspects', method: 'get', path: '/v1/prospects' },
  { id: 'listCustomerContacts', method: 'get', path: '/v1/crm/customer/{code}/contacts' },
]

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))

const refName = (ref) => ref.replace('#/components/schemas/', '')

/** Component schemas reached from the operations above, transitively. */
const wanted = new Set()
const walkRefs = (node) => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkRefs(item)
    return
  }
  if (typeof node.$ref === 'string') {
    const name = refName(node.$ref)
    if (!wanted.has(name)) {
      wanted.add(name)
      walkRefs(spec.components.schemas[name])
    }
    return
  }
  for (const value of Object.values(node)) walkRefs(value)
}

const bodySchemaOf = (op) => {
  const content = op.requestBody?.content ?? {}
  const json = content['application/json']?.schema
  if (json?.$ref) return refName(json.$ref)
  return null
}

const responseSchemaOf = (op) => {
  const ok = op.responses?.['200'] ?? op.responses?.['201'] ?? op.responses?.['202']
  const schema = ok?.content?.['application/json']?.schema
  if (!schema) return null
  if (schema.$ref) return refName(schema.$ref)
  if (schema.type === 'array' && schema.items?.$ref) return `${refName(schema.items.$ref)}[]`
  return null
}

const requiredBodyOf = (op) => {
  const name = bodySchemaOf(op)
  if (!name) return []
  return spec.components.schemas[name]?.required ?? []
}

const descriptors = OPERATIONS.map((entry) => {
  const op = spec.paths[entry.path]?.[entry.method]
  if (!op) throw new Error(`spec has no ${entry.method.toUpperCase()} ${entry.path}`)
  walkRefs(op)
  const params = op.parameters ?? []
  return {
    id: entry.id,
    method: entry.method.toUpperCase(),
    path: entry.path,
    summary: (op.summary ?? '').split('|')[0].trim(),
    query: params.filter((p) => p.in === 'query').map((p) => p.name),
    pathParams: params.filter((p) => p.in === 'path').map((p) => p.name),
    requiredBody: requiredBodyOf(op),
    bodySchema: bodySchemaOf(op),
    responseSchema: responseSchemaOf(op),
  }
})

// ── TypeScript emission ────────────────────────────────────────────────────

const HEADER = (source) => `/**
 * GENERATED FILE — DO NOT HAND-EDIT.
 *
 * Produced by \`node scripts/generate-vsa-types.mjs\` from
 * \`docs/reference/vsa-sandbox-openapi.json\`. ${source}
 *
 * Only the endpoints listed in \`docs/reference/vsa-api.md\` are generated; the
 * other ~245 paths of the sandbox spec are not part of this product's surface.
 * To add one, add a row to OPERATIONS in the script and re-run it.
 */
`

const RESERVED = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const key = (name) => (RESERVED.test(name) ? name : JSON.stringify(name))

/** First sentence of a bilingual, sometimes HTML-bearing description. */
const comment = (text, indent) => {
  if (!text) return ''
  const clean = String(text)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .split('|')[0]
    .trim()
  if (!clean) return ''
  return `${indent}/** ${clean.replace(/\*\//g, '* /')} */\n`
}

const typeOf = (schema, indent) => {
  if (!schema) return 'unknown'
  if (schema.$ref) return refName(schema.$ref)
  switch (schema.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return `${typeOf(schema.items, indent)}[]`
    case 'object':
      return schema.properties ? objectBody(schema, indent) : 'Record<string, unknown>'
    default:
      return schema.properties ? objectBody(schema, indent) : 'unknown'
  }
}

const objectBody = (schema, indent) => {
  const inner = `${indent}  `
  const required = new Set(schema.required ?? [])
  const lines = Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const optional = required.has(name) ? '' : '?'
    return `${comment(prop.description, inner)}${inner}${key(name)}${optional}: ${typeOf(prop, inner)}`
  })
  return `{\n${lines.join('\n')}\n${indent}}`
}

const schemaNames = [...wanted].sort()
const schemaFile = [
  HEADER('Request and response shapes for those endpoints.'),
  ...schemaNames.map((name) => {
    const schema = spec.components.schemas[name]
    return `${comment(schema.description, '')}export interface ${name} ${objectBody(schema, '')}\n`
  }),
].join('\n')

const literal = (value) => JSON.stringify(value)
const operationsFile = `${HEADER('One descriptor per endpoint the adapter calls.')}
/**
 * What the adapter expects a tenant to offer. \`probe.ts\` diffs a live VSA
 * against this table and reports the difference as data (DEC-24).
 */
export interface VsaOperation {
  readonly id: string
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly summary: string
  /** Query parameter names the spec declares. */
  readonly query: readonly string[]
  /** Placeholders in \`path\`, in order. */
  readonly pathParams: readonly string[]
  /** Body fields the spec marks required. A missing one is a 400, not a warning. */
  readonly requiredBody: readonly string[]
  /** Component schema name, for cross-referencing \`schemas.ts\`. */
  readonly bodySchema: string | null
  readonly responseSchema: string | null
}

export const VSA_OPERATIONS = {
${descriptors
  .map(
    (d) => `  ${d.id}: {
    id: ${literal(d.id)},
    method: ${literal(d.method)},
    path: ${literal(d.path)},
    summary: ${literal(d.summary)},
    query: ${literal(d.query)},
    pathParams: ${literal(d.pathParams)},
    requiredBody: ${literal(d.requiredBody)},
    bodySchema: ${literal(d.bodySchema)},
    responseSchema: ${literal(d.responseSchema)},
  },`,
  )
  .join('\n')}
} as const satisfies Record<string, VsaOperation>

export type VsaOperationId = keyof typeof VSA_OPERATIONS

/**
 * The property names of each schema, at **runtime**.
 *
 * \`schemas.ts\` is types, and types are erased — so \`probe.ts\` could not
 * otherwise ask "does this tenant's task really have the column \`fieldMap.ts\`
 * writes to?". This is that question's data. A client column that the spec does
 * not know about shows up in the probe report as a gap rather than as a 400 on
 * the one click the product is judged on.
 */
export const VSA_SCHEMA_COLUMNS: Record<string, readonly string[]> = {
${schemaNames
  .map(
    (name) =>
      `  ${name}: ${literal(Object.keys(spec.components.schemas[name].properties ?? {}))},`,
  )
  .join('\n')}
}
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'schemas.ts'), schemaFile)
writeFileSync(join(OUT_DIR, 'operations.ts'), operationsFile)

console.log(
  `vsa types generated — ${descriptors.length} operations, ${schemaNames.length} schemas → electron/modules/crm/vsa/generated/`,
)
