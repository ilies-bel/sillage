/**
 * `ExtractionESN` ⇄ VSA columns, as **data** (CLAUDE.md, the CRM boundary).
 *
 * The client will have their own developments on top of VerySwing. When they add
 * a column, the cost of following them must be **one row in a table here** — not
 * a new branch in an assignment block that only its author can read. So every
 * mapping in this file is a `FieldRow`: a domain path, a VSA column, a reader,
 * and a codec. `VsaCrm` never writes `payload.x` into `body.y` itself; it folds
 * these tables.
 *
 * The codec is the second half of the point. `docs/reference/vsa-api.md` names
 * it as a gotcha: a task's dates are ATOM (`2025-04-15T13:05:02+00:00`) and an
 * opportunity's `closingDate` is `yyyy-mm-dd`. That is not a rule anyone
 * remembers at the call site — it is a property of the column, so it lives on
 * the column's row, and `__tests__` round-trips every row to prove the two
 * halves of a codec are really inverses.
 */
import type { ExtractionESN } from '../../../core/contracts/extraction.ts'
import type { CompteRenduPayload, OpportunityPayload } from '../../../core/contracts/push.ts'

/** What a VSA column can hold. Anything richer is a bug in the row, not in VSA. */
export type VsaScalar = string | number | boolean | null

/** What a domain value can be before a codec touches it. */
export type DomainValue = string | number

/**
 * How one domain value crosses the wire, and how it comes back.
 *
 * `toDomain` is not decoration: it is what makes the table checkable. A row
 * whose two halves disagree is caught by a test rather than by a rep reading a
 * date off by a timezone in the CRM three weeks later.
 */
export interface Codec<T extends DomainValue> {
  readonly id: string
  toColumn(value: T): VsaScalar
  toDomain(value: VsaScalar): T
}

export const TEXT: Codec<string> = {
  id: 'text',
  toColumn: (value) => value,
  toDomain: (value) => (typeof value === 'string' ? value : String(value ?? '')),
}

export const AMOUNT: Codec<number> = {
  id: 'amount',
  toColumn: (value) => value,
  toDomain: (value) => (typeof value === 'number' ? value : Number(value ?? 0)),
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * ATOM, which is what `/v1/crm/tasks` wants for `deadlineDate` and `endDate`.
 *
 * Written out rather than delegated to `toISOString()` because ATOM ends in
 * `+00:00` and `toISOString()` ends in `Z`. VSA accepts both today; the spec's
 * examples say `+00:00`, and matching the spec costs four lines and removes a
 * question from a future debugging session.
 */
export const ATOM: Codec<number> = {
  id: 'atom',
  toColumn: (epochMs) => {
    const d = new Date(epochMs)
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
      `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
    )
  },
  toDomain: (value) => (typeof value === 'string' ? Date.parse(value) : Number(value ?? 0)),
}

/**
 * `yyyy-mm-dd`, which is what `/v1/opportunity` wants for `closingDate`,
 * `startingDate` and `endingDate` — the same instant, a different format, on the
 * next endpoint over. Lossy on purpose: a closing *day* has no time of day, so
 * `toDomain` returns midnight UTC and the round-trip check holds in column
 * space rather than pretending the hour survived.
 */
export const DAY: Codec<number> = {
  id: 'day',
  toColumn: (epochMs) => {
    const d = new Date(epochMs)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  },
  toDomain: (value) => (typeof value === 'string' ? Date.parse(`${value}T00:00:00+00:00`) : Number(value ?? 0)),
}

/** A row. One per column, and following a client column means adding one. */
export interface FieldRow<S> {
  /** Dotted path in the domain object. Quoted in diagnostics, never sent. */
  readonly domain: string
  /** The VSA column. This identifier exists nowhere outside `modules/crm/vsa/`. */
  readonly column: string
  /** `null` means "the source has nothing here" — the column is then omitted. */
  readonly read: (source: S) => DomainValue | null
  readonly codec: Codec<DomainValue>
  /**
   * When true, a `null` from `read` still writes the column, as `""`.
   *
   * `taskDescription` is the one that needs it: IMPLEMENTATION.md step 8 warns
   * that a silently empty description is the failure nobody notices, so the
   * column is always present and an empty compte-rendu is visible in VSA rather
   * than absent from it.
   */
  readonly always?: boolean
}

/**
 * Declares a row with its real types, stores it erased.
 *
 * The cast is the whole reason this helper exists: a table is heterogeneous —
 * `deadlineDate` carries a number through `ATOM`, `taskName` a string through
 * `TEXT` — and TypeScript has no way to hold both in one array without either a
 * union at every call site or this. Checking happens here, at the declaration,
 * which is where a wrong codec is a typo somebody can see.
 */
export const field = <S, T extends DomainValue>(row: {
  domain: string
  column: string
  read: (source: S) => T | null
  codec: Codec<T>
  always?: boolean
}): FieldRow<S> => row as unknown as FieldRow<S>

/**
 * The compte-rendu → `POST /v1/crm/tasks`.
 *
 * `taskDescription` is the payload: it is VSA's "Description / Reporting" field
 * and the rendered compte-rendu is what lands in it.
 */
export const TASK_FIELDS: FieldRow<CompteRenduPayload>[] = [
  field({ domain: 'title', column: 'taskName', read: (p: CompteRenduPayload) => p.title, codec: TEXT }),
  field({
    domain: 'body',
    column: 'taskDescription',
    read: (p: CompteRenduPayload) => p.body,
    codec: TEXT,
    always: true,
  }),
  field({ domain: 'dueAt', column: 'deadlineDate', read: (p: CompteRenduPayload) => p.dueAt, codec: ATOM }),
  field({ domain: 'endsAt', column: 'endDate', read: (p: CompteRenduPayload) => p.endsAt, codec: ATOM }),
]

/**
 * The opportunity → `POST /v1/opportunity`.
 *
 * The three description columns are why the ESN recipe maps as cleanly as it
 * does: VSA already has a field for the client's situation, one for the stack
 * discussed, and one for the profiles wanted. They are not notes squeezed into a
 * comment box, so the compte-rendu's structure survives the push.
 */
export const OPPORTUNITY_FIELDS: FieldRow<OpportunityPayload>[] = [
  field({ domain: 'title', column: 'title', read: (p: OpportunityPayload) => p.title, codec: TEXT }),
  field({ domain: 'description', column: 'description', read: (p: OpportunityPayload) => p.description, codec: TEXT }),
  field({
    domain: 'contextDescription',
    column: 'contextDescription',
    read: (p: OpportunityPayload) => p.contextDescription,
    codec: TEXT,
  }),
  field({
    domain: 'technicalEnvDescription',
    column: 'technicalEnvDescription',
    read: (p: OpportunityPayload) => p.technicalEnvDescription,
    codec: TEXT,
  }),
  field({
    domain: 'profileDescription',
    column: 'profileDescription',
    read: (p: OpportunityPayload) => p.profileDescription,
    codec: TEXT,
  }),
  field({ domain: 'currency', column: 'currency', read: (p: OpportunityPayload) => p.currency, codec: TEXT }),
  field({ domain: 'amount', column: 'amount', read: (p: OpportunityPayload) => p.amount, codec: AMOUNT }),
  field({ domain: 'closingDate', column: 'closingDate', read: (p: OpportunityPayload) => p.closingDate, codec: DAY }),
  field({
    domain: 'startingDate',
    column: 'startingDate',
    read: (p: OpportunityPayload) => p.startingDate,
    codec: DAY,
  }),
]

/**
 * `ExtractionESN` → the opportunity's descriptive columns.
 *
 * A separate table because the source differs, not the destination: `app/`
 * builds an `OpportunityPayload` out of the reviewed extraction, and this is how
 * the ESN recipe's interpretive fields become that payload's text. Every value
 * is read through `.value` — the cited wrapper stays behind, the span never
 * travels to VSA.
 *
 * Nothing deterministic passes through here (DEC-7): attendee names, addresses
 * and account codes come from Graph and from VSA itself, never from the model.
 */
export const EXTRACTION_FIELDS: FieldRow<ExtractionESN>[] = [
  field({
    domain: 'facts.taskName',
    column: 'title',
    read: (e: ExtractionESN) => e.facts.taskName,
    codec: TEXT,
  }),
  /*
   * Null-tolerant since DEC-43, and it costs nothing here: every interpretive
   * field is nullable now because a recipe may not ask for it, and this table
   * already had `dateDemarrage` returning null for a meeting where no start was
   * mentioned. `TEXT` writes an absent column rather than an empty one.
   *
   * A free-form extraction never reaches this table at all — `reviewGate.ts`
   * refuses to draft the opportunity — so what these null branches cover is the
   * ESN meeting where nothing was said, which they covered before.
   */
  field({
    domain: 'interpretation.besoin',
    column: 'description',
    read: (e: ExtractionESN) => e.interpretation.besoin?.value ?? null,
    codec: TEXT,
  }),
  field({
    domain: 'interpretation.contexteTechnique',
    column: 'technicalEnvDescription',
    read: (e: ExtractionESN) => e.interpretation.contexteTechnique?.value ?? null,
    codec: TEXT,
  }),
  field({
    domain: 'interpretation.profilsRecherches',
    column: 'profileDescription',
    // `2× Dev Java senior (Java, Spring)` — the shape the column is named for.
    read: (e: ExtractionESN) =>
      e.interpretation.profilsRecherches
        .map((p) => {
          const stack = p.value.stack.length > 0 ? ` (${p.value.stack.join(', ')})` : ''
          return `${p.value.nombre}× ${p.value.intitule} ${p.value.seniorite}${stack}`.replace(/\s+/g, ' ').trim()
        })
        .join('\n'),
    codec: TEXT,
  }),
  field({
    domain: 'interpretation.dateDemarrage',
    column: 'originDescription',
    // Free text on purpose (`"septembre"`). A spoken approximation is
    // interpretation, and `startingDate` is a date column — writing "septembre"
    // into it would invent a precision nobody said out loud (DEC-7).
    read: (e: ExtractionESN) => e.interpretation.dateDemarrage?.value ?? null,
    codec: TEXT,
  }),
]

/**
 * Folds a table into a VSA body.
 *
 * One function for every table, which is what makes a client column a data
 * change: there is no second code path waiting for the fifth field.
 */
export const columnsFor = <S>(rows: readonly FieldRow<S>[], source: S): Record<string, VsaScalar> => {
  const body: Record<string, VsaScalar> = {}
  for (const row of rows) {
    const value = row.read(source)
    if (value === null) {
      if (row.always) body[row.column] = ''
      continue
    }
    body[row.column] = row.codec.toColumn(value)
  }
  return body
}

/** The inverse fold. Used by the round-trip check and by any read-back. */
export const domainFor = <S>(
  rows: readonly FieldRow<S>[],
  body: Record<string, VsaScalar>,
): Record<string, DomainValue> => {
  const out: Record<string, DomainValue> = {}
  for (const row of rows) {
    if (!(row.column in body)) continue
    out[row.domain] = row.codec.toDomain(body[row.column] ?? null)
  }
  return out
}

/** Just the column names, so `probe.ts` can check them without knowing them. */
export const ALL_FIELD_TABLES: Record<string, readonly { domain: string; column: string }[]> = {
  createTask: TASK_FIELDS,
  createOpportunity: OPPORTUNITY_FIELDS,
  extraction: EXTRACTION_FIELDS,
}
