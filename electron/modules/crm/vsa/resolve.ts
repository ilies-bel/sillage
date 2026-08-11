/**
 * Entity resolution — the ranking, with no I/O in it.
 *
 * The order is fixed by `docs/reference/vsa-api.md` §"Reads — entity
 * resolution", and it is not the obvious one:
 *
 *   1. **exact contact email** — `GET /v1/prospect-contacts?email=` is an exact
 *      filter, so a prospect on `@gmail.com` still resolves if VSA knows them.
 *      This outranks the domain and it is what defuses INPUT-1.
 *   2. **email domain** — the bulk case, and ambiguous inside a holding.
 *   3. **the other attendees on the invite** — one colleague on the company
 *      domain resolves the whole meeting, which is the case the personal
 *      address above cannot cover on its own.
 *   4. **siblings under a shared parent** — both customers and prospects carry a
 *      parent link, so DEC-18's "list the siblings" is a group-by rather than a
 *      heuristic. Listed, never guessed between.
 *
 * Every candidate carries the signals that produced it and a measured 0..1
 * score. `VsaCrm` writes both into the diagnostic log, which is the whole of
 * DEC-18's mitigation: a mis-attribution has to be diagnosable afterwards, and
 * "the app picked Aura" is not diagnosable — "the app picked Aura at 0.62 on
 * email-domain alone, with two siblings within 0.05" is.
 *
 * Pure: no session, no fetch, no clock. Which is why the ordering is testable
 * without a network at all.
 */
import type { AccountCandidate, ResolutionSignal } from '../../../core/contracts/crm.ts'
import type { DirectoryAccount, DirectoryContact, DirectorySnapshot } from './directory.ts'

/**
 * Addresses whose domain says nothing about the company.
 *
 * Not a completeness exercise — a domain missing from this list costs a weak
 * name match, not a wrong one, because a personal domain matches no account
 * name either. The French consumer ISPs are here because half a French
 * prospect's addresses are on them.
 */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.fr',
  'hotmail.com',
  'hotmail.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.fr',
  'yandex.com',
  'mail.com',
  'free.fr',
  'orange.fr',
  'wanadoo.fr',
  'sfr.fr',
  'neuf.fr',
  'laposte.net',
  'bbox.fr',
  'numericable.fr',
])

/** Score floor for `ok`. Below it the row wears `⚠ faible` (DEC-21). */
export const OK_SCORE = 0.7
/**
 * How far the winner must be clear of the runner-up to count as unambiguous.
 *
 * This is the number that makes a holding behave. Two subsidiaries matched by
 * the same domain score identically, the margin is 0, and both come back
 * `faible` with their siblings listed — which is what DEC-18 asks for, phrased
 * as arithmetic instead of as a special case for holdings.
 */
export const AMBIGUITY_MARGIN = 0.1

const SCORE = {
  /** An exact address match on a contact VSA already holds. */
  contactEmail: 0.95,
  /** Another contact of that account shares the address's domain. */
  domainViaContact: 0.78,
  /** The domain's label matches the account's name or display code. */
  domainViaName: 0.62,
  /** A second attendee address points at the same account. */
  corroboration: 0.05,
  /** The invite's subject mentions the account. Tie-break only. */
  hint: 0.06,
  /** A sibling is listed so the rep sees the choice, never so it can win. */
  siblingFactor: 0.35,
} as const

export const domainOf = (email: string): string => {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase()

/** `aura-technologies.fr` → `aura-technologies`, which is what a name holds. */
export const domainLabel = (domain: string): string => domain.split('.')[0] ?? ''

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export interface ResolutionInput {
  /** Every attendee address on the invite, the rep's own included. */
  attendeeEmails: string[]
  /** The subject line, for the fuzzy tie-break. */
  hint: string
  snapshot: DirectorySnapshot
  /**
   * What `GET /v1/prospect-contacts?email=` returned per address, keyed by the
   * lowercased address. Passed in rather than fetched here so this file stays
   * pure — `VsaCrm` owns the round-trips, this owns the ordering.
   */
  exact: Map<string, DirectoryContact[]>
  /** The ESN's own domains. Its own people are on the invite and are not the client. */
  ownEmailDomains: string[]
}

interface Hit {
  score: number
  signals: Set<ResolutionSignal>
  /** Which attendee addresses contributed. Two or more is corroboration. */
  sources: Set<string>
}

const bump = (hits: Map<string, Hit>, accountId: string, score: number, signal: ResolutionSignal, source: string): void => {
  const held = hits.get(accountId)
  if (!held) {
    hits.set(accountId, { score, signals: new Set([signal]), sources: new Set([source]) })
    return
  }
  held.score = Math.max(held.score, score)
  held.signals.add(signal)
  held.sources.add(source)
}

const contactsByDomain = (contacts: DirectoryContact[]): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>()
  for (const contact of contacts) {
    if (!contact.email || !contact.accountId) continue
    const domain = domainOf(contact.email)
    if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) continue
    const held = index.get(domain) ?? new Set<string>()
    held.add(contact.accountId)
    index.set(domain, held)
  }
  return index
}

const byEmail = (contacts: DirectoryContact[]): Map<string, DirectoryContact[]> => {
  const index = new Map<string, DirectoryContact[]>()
  for (const contact of contacts) {
    if (!contact.email) continue
    const key = normaliseEmail(contact.email)
    index.set(key, [...(index.get(key) ?? []), contact])
  }
  return index
}

/**
 * The family of an account: everything under the same parent, plus the parent
 * itself, plus its children when the account *is* the parent.
 */
export const familyOf = (accounts: readonly DirectoryAccount[], accountId: string): DirectoryAccount[] => {
  const self = accounts.find((account) => account.accountId === accountId)
  if (!self) return []
  const parentId = self.parentAccountId
  const family = accounts.filter((account) => {
    if (account.accountId === accountId) return false
    if (parentId !== null && (account.parentAccountId === parentId || account.accountId === parentId)) return true
    return account.parentAccountId === accountId
  })
  return family
}

export const rankCandidates = (input: ResolutionInput): AccountCandidate[] => {
  const accounts = input.snapshot.accounts
  const accountById = new Map(accounts.map((account) => [account.accountId, account]))
  const own = new Set(input.ownEmailDomains.map((domain) => domain.toLowerCase().replace(/^@/, '')))

  const external = input.attendeeEmails
    .map(normaliseEmail)
    .filter((email) => email.includes('@'))
    .filter((email) => !own.has(domainOf(email)))
  const primary = external[0] ?? null

  const domainIndex = contactsByDomain(input.snapshot.contacts)
  const emailIndex = byEmail(input.snapshot.contacts)
  const hits = new Map<string, Hit>()

  // 1 & 2 — per address, exact match first, domain only when it found nothing.
  for (const email of external) {
    const exact = [...(input.exact.get(email) ?? []), ...(emailIndex.get(email) ?? [])]
    const exactAccounts = new Set(exact.map((contact) => contact.accountId).filter((id): id is string => id !== null))
    for (const accountId of exactAccounts) {
      if (accountById.has(accountId)) bump(hits, accountId, SCORE.contactEmail, 'contact-email', email)
    }
    if (exactAccounts.size > 0) continue

    const domain = domainOf(email)
    if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) continue

    const viaContacts = domainIndex.get(domain)
    if (viaContacts && viaContacts.size > 0) {
      for (const accountId of viaContacts) {
        if (accountById.has(accountId)) bump(hits, accountId, SCORE.domainViaContact, 'email-domain', email)
      }
      continue
    }

    // VSA accounts carry no website column, so "the domain matched an account"
    // is, in practice, the domain's label matching the account's name or
    // display code. Weaker than a contact of that account sharing the domain,
    // and scored as such.
    const label = fold(domainLabel(domain))
    if (label.length < 3) continue
    for (const account of accounts) {
      if (fold(account.name).includes(label) || fold(account.displayCode) === label) {
        bump(hits, account.accountId, SCORE.domainViaName, 'email-domain', email)
      }
    }
  }

  // 3 — the invite's other attendees. An account nobody but a colleague
  // produced is a `co-attendee` resolution, and one that several attendees
  // produced is corroborated.
  for (const hit of hits.values()) {
    if (primary === null || !hit.sources.has(primary)) hit.signals.add('co-attendee')
    if (hit.sources.size > 1) {
      hit.signals.add('co-attendee')
      hit.score = Math.min(1, hit.score + SCORE.corroboration * (hit.sources.size - 1))
    }
  }

  // The fuzzy tie-break. `recency` in `ResolutionSignal` is the tie-break slot;
  // v1 supplies only its title half — the "touched recently" half needs the
  // rep's own task history, which this version does not pull.
  const hintTokens = fold(input.hint)
    .split(' ')
    .filter((token) => token.length >= 4)
  for (const [accountId, hit] of hits) {
    const account = accountById.get(accountId)
    if (!account) continue
    const name = fold(account.name)
    if (hintTokens.some((token) => name.includes(token))) {
      hit.signals.add('recency')
      hit.score = Math.min(1, hit.score + SCORE.hint)
    }
  }

  // 4 — siblings. Added at a fraction of the score they hang off: they exist so
  // the rep sees a choice was available, never so the app can make it.
  const resolved = [...hits.entries()]
  for (const [accountId, hit] of resolved) {
    for (const sibling of familyOf(accounts, accountId)) {
      if (hits.has(sibling.accountId)) continue
      hits.set(sibling.accountId, {
        score: Number((hit.score * SCORE.siblingFactor).toFixed(4)),
        signals: new Set<ResolutionSignal>(['sibling']),
        sources: new Set(hit.sources),
      })
    }
  }

  const ranked = [...hits.entries()]
    .map(([accountId, hit]) => {
      const account = accountById.get(accountId)
      return account ? { account, hit } : null
    })
    .filter((entry): entry is { account: DirectoryAccount; hit: Hit } => entry !== null)
    .sort((a, b) => b.hit.score - a.hit.score || a.account.name.localeCompare(b.account.name))

  const best = ranked[0]?.hit.score ?? 0
  const runnerUp = ranked[1]?.hit.score ?? 0
  const clear = best - runnerUp >= AMBIGUITY_MARGIN

  return ranked.map((entry, index) => ({
    accountId: entry.account.accountId,
    name: entry.account.name,
    parentAccountId: entry.account.parentAccountId,
    score: Number(entry.hit.score.toFixed(4)),
    // Only the leader can ever be `ok`, and only when it is clear of the field.
    // A tie inside a holding therefore reads `faible` for every member, which
    // is the honest answer: the app does not know which subsidiary it was.
    confidence: index === 0 && entry.hit.score >= OK_SCORE && clear ? 'ok' : 'faible',
    signals: [...entry.hit.signals],
  }))
}

/** The sibling list on its own, for `CrmPort.listSiblings`. */
export const siblingCandidates = (
  snapshot: DirectorySnapshot,
  parentAccountId: string,
): AccountCandidate[] =>
  snapshot.accounts
    .filter((account) => account.parentAccountId === parentAccountId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((account) => ({
      accountId: account.accountId,
      name: account.name,
      parentAccountId: account.parentAccountId,
      score: 0,
      confidence: 'faible' as const,
      signals: ['sibling' as const],
    }))
