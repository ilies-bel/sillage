/**
 * The local copy of the tenant's accounts and prospect contacts.
 *
 * `docs/reference/vsa-api.md` argues for this directly: pull accounts and
 * contacts once at connect and hold them, so resolution runs offline and
 * instantly. That is not an optimisation, it is what makes the `⚠ faible` row
 * appear with the rest of the review screen instead of a second later — and a
 * sibling group-by over a local array is a different thing entirely from N
 * round-trips.
 *
 * Two shapes come out of VSA and one goes in here. Customers key on `tiersCode`
 * with a `parentTiersCode`; prospects key on `code` with a `parentCode`. Both
 * are an account with a parent, so both land in `DirectoryAccount` and the
 * difference survives only as `kind` — which the opportunity write needs, since
 * `accountType` distinguishes them.
 */
import type { DiagRecorder } from '../../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../../core/contracts/diagnostics.ts'
import { VSA_OPERATIONS } from './generated/operations.ts'
import type { Customer, ProspectAccountList, ProspectContactList, CustomerContact } from './generated/schemas.ts'
import type { VsaSession } from './http.ts'

export type AccountKind = 'customer' | 'prospect'

export interface DirectoryAccount {
  accountId: string
  name: string
  parentAccountId: string | null
  kind: AccountKind
  /** `codeDisplay` — what a rep recognises. Used by the fuzzy tie-break. */
  displayCode: string
}

export interface DirectoryContact {
  contactId: string
  name: string
  email: string | null
  accountId: string | null
  kind: AccountKind
}

export interface DirectorySnapshot {
  accounts: DirectoryAccount[]
  contacts: DirectoryContact[]
  fetchedAt: number
}

export const EMPTY_SNAPSHOT: DirectorySnapshot = { accounts: [], contacts: [], fetchedAt: 0 }

/**
 * Thirty minutes.
 *
 * Shorter than the referentials' six hours, and for the opposite reason:
 * referentials are configuration that changes monthly, whereas a rep creates a
 * prospect in VSA in the morning and expects the afternoon's call to find it.
 * Thirty minutes bounds "I created it and the app cannot see it" to something a
 * person tolerates, without re-pulling the whole account list per meeting. The
 * *Reconnecter* button in Réglages invalidates it outright, which is the escape
 * hatch for the case where waiting is not acceptable.
 */
export const DIRECTORY_TTL_MS = 30 * 60 * 1000

/** VSA pages by `limit` + `offset`, where offset is a **page number** from 1. */
export const PAGE_SIZE = 1000
/** Ten pages of each list. A tenant past 10 000 accounts needs a server-side search, not a bigger cache. */
export const MAX_PAGES = 10

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
const orNull = (value: unknown): string | null => {
  const t = text(value)
  return t === '' ? null : t
}

export const nameOf = (firstname: unknown, lastname: unknown): string =>
  `${text(firstname)} ${text(lastname)}`.replace(/\s+/g, ' ').trim()

export interface DirectoryOptions {
  session: VsaSession
  now?: () => number
  ttlMs?: number
  diagnostics?: DiagRecorder
}

export class Directory {
  #session: VsaSession
  #now: () => number
  #ttlMs: number
  #diagnostics: DiagRecorder
  #snapshot: DirectorySnapshot | null = null
  #inFlight: Promise<DirectorySnapshot> | null = null

  constructor(options: DirectoryOptions) {
    this.#session = options.session
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs ?? DIRECTORY_TTL_MS
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
  }

  get stale(): boolean {
    return this.#snapshot === null || this.#now() - this.#snapshot.fetchedAt >= this.#ttlMs
  }

  invalidate(): void {
    this.#snapshot = null
  }

  async snapshot(): Promise<DirectorySnapshot> {
    const held = this.#snapshot
    if (held && !this.stale) return held
    this.#inFlight ??= this.#load().finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  /**
   * The exact-email lookup, live rather than from the snapshot.
   *
   * This is the finding that reordered the whole resolution (`vsa-api.md` §1):
   * `?email=` is an exact filter, so a prospect on `@gmail.com` still resolves
   * if VSA knows them at all. It runs live because a contact created five
   * minutes ago by the rep is exactly the contact this call is for, and the
   * snapshot would be up to thirty minutes behind.
   */
  async contactsByEmail(email: string): Promise<DirectoryContact[]> {
    const operation = VSA_OPERATIONS.findProspectContacts
    const rows = await this.#session.request({
      operationPath: operation.path,
      method: operation.method,
      query: { email },
    })
    return asArray(rows).map((row) => this.#prospectContact(row as ProspectContactList))
  }

  async #load(): Promise<DirectorySnapshot> {
    const accounts: DirectoryAccount[] = []
    const contacts: DirectoryContact[] = []

    for (const row of await this.#pages<Customer>('listCustomers')) {
      const accountId = text(row.tiersCode)
      if (!accountId) continue
      accounts.push({
        accountId,
        name: text(row.name) || text(row.mainName),
        parentAccountId: orNull(row.parentTiersCode),
        kind: 'customer',
        displayCode: text(row.codeDisplay),
      })
    }

    for (const row of await this.#pages<ProspectAccountList>('listProspects')) {
      const accountId = text(row.code)
      if (!accountId) continue
      accounts.push({
        accountId,
        name: text(row.name),
        parentAccountId: orNull(row.parentCode),
        kind: 'prospect',
        displayCode: text(row.codeDisplay),
      })
    }

    for (const row of await this.#pages<ProspectContactList>('findProspectContacts')) {
      contacts.push(this.#prospectContact(row))
    }

    const snapshot: DirectorySnapshot = { accounts, contacts, fetchedAt: this.#now() }
    this.#snapshot = snapshot
    this.#diagnostics.record({
      severity: 'info',
      code: 'crm.directory.loaded',
      module: 'crm',
      message: 'annuaire VerySwing chargé',
      detail: { accounts: accounts.length, contacts: contacts.length },
    })
    return snapshot
  }

  /**
   * The customer side of the contact list, fetched per account rather than in
   * bulk: VSA has no "all customer contacts" endpoint, only
   * `/v1/crm/customer/{code}/contacts`. Called for the handful of accounts a
   * meeting actually resolves to, never for the whole tenant.
   */
  async customerContacts(accountId: string): Promise<DirectoryContact[]> {
    const operation = VSA_OPERATIONS.listCustomerContacts
    const rows = await this.#session.request({
      operationPath: operation.path,
      method: operation.method,
      params: { code: accountId },
    })
    return asArray(rows).map((value) => {
      const row = value as CustomerContact
      return {
        contactId: text(row.id),
        name: nameOf(row.firstname, row.lastname),
        email: orNull(row.email),
        accountId,
        kind: 'customer' as const,
      }
    })
  }

  #prospectContact(row: ProspectContactList): DirectoryContact {
    return {
      contactId: text(row.prospectId),
      name: nameOf(row.firstname, row.lastname),
      email: orNull(row.email),
      accountId: orNull(row.parentTiersCode),
      kind: 'prospect',
    }
  }

  async #pages<T>(id: 'listCustomers' | 'listProspects' | 'findProspectContacts'): Promise<T[]> {
    const operation = VSA_OPERATIONS[id]
    const all: T[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      let rows: unknown[]
      try {
        rows = asArray(
          await this.#session.request({
            operationPath: operation.path,
            method: operation.method,
            query: { limit: PAGE_SIZE, offset: page },
          }),
        )
      } catch (error) {
        // A half-loaded directory still resolves most meetings, and refusing to
        // resolve any of them because page 4 timed out is worse than the gap.
        this.#diagnostics.record({
          severity: 'warn',
          code: 'crm.directory.partial',
          module: 'crm',
          message: 'annuaire VerySwing partiellement chargé',
          detail: { list: id, page, reason: error instanceof Error ? error.message : String(error) },
        })
        break
      }
      all.push(...(rows as T[]))
      if (rows.length < PAGE_SIZE) break
    }
    return all
  }
}
