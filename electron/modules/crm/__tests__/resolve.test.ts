/**
 * Entity resolution — the order, the signals, and the two cases that made the
 * design what it is: a prospect on a personal address, and a holding.
 *
 * Pure input, pure output. `rankCandidates` takes a snapshot and a map of exact
 * matches and returns candidates, so every assertion here runs with no network,
 * no clock and no session.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rankCandidates, siblingCandidates, familyOf, OK_SCORE } from '../vsa/resolve.ts'
import type { DirectoryContact, DirectorySnapshot } from '../vsa/directory.ts'

const account = (id: string, name: string, parent: string | null = null, kind: 'customer' | 'prospect' = 'prospect') => ({
  accountId: id,
  name,
  parentAccountId: parent,
  kind,
  displayCode: id,
})

const contact = (id: string, name: string, email: string | null, accountId: string | null): DirectoryContact => ({
  contactId: id,
  name,
  email,
  accountId,
  kind: 'prospect',
})

const snapshot = (input: Partial<DirectorySnapshot>): DirectorySnapshot => ({
  accounts: [],
  contacts: [],
  fetchedAt: 0,
  ...input,
})

const AURA = account('AURA', 'Aura Technologies')
const NOVA = account('NOVA', 'Nova Services')

const ESN_DOMAINS = ['shodo.fr']

// ── 1. exact contact e-mail ────────────────────────────────────────────────

test('a personal address resolves by exact contact match, not by domain', () => {
  // INPUT-1, defused: `marc.durand@gmail.com` says nothing about a company, and
  // VSA still knows exactly who he is.
  const candidates = rankCandidates({
    attendeeEmails: ['claire@shodo.fr', 'marc.durand@gmail.com'],
    hint: 'Point projet',
    snapshot: snapshot({ accounts: [AURA, NOVA] }),
    exact: new Map([['marc.durand@gmail.com', [contact('11', 'Marc Durand', 'marc.durand@gmail.com', 'AURA')]]]),
    ownEmailDomains: ESN_DOMAINS,
  })

  assert.equal(candidates[0]?.accountId, 'AURA')
  assert.deepEqual(candidates[0]?.signals, ['contact-email'])
  assert.equal(candidates[0]?.confidence, 'ok')
  assert.ok((candidates[0]?.score ?? 0) >= OK_SCORE)
})

test('the exact match outranks a domain match on the same invite', () => {
  const candidates = rankCandidates({
    attendeeEmails: ['marc@aura-technologies.fr', 'sophie@nova-services.fr'],
    hint: '',
    snapshot: snapshot({
      accounts: [account('AURA', 'Aura Technologies'), account('NOVA', 'Nova Services')],
      // A *different* person on Nova's domain: Sophie herself is unknown to
      // VSA, so her account can only be reached through the domain.
      contacts: [contact('22', 'Luc Martin', 'luc@nova-services.fr', 'NOVA')],
    }),
    exact: new Map([['marc@aura-technologies.fr', [contact('11', 'Marc Durand', 'marc@aura-technologies.fr', 'AURA')]]]),
    ownEmailDomains: ESN_DOMAINS,
  })

  assert.equal(candidates[0]?.accountId, 'AURA')
  assert.ok(candidates[0]?.signals.includes('contact-email'))
  const nova = candidates.find((c) => c.accountId === 'NOVA')
  assert.ok(nova, 'the domain match is still offered')
  assert.ok(nova.signals.includes('contact-email') === false)
  assert.ok((candidates[0]?.score ?? 0) > (nova.score ?? 0), 'exact e-mail outranks the domain')
})

// ── 2 & 3. domain, then the other attendees ────────────────────────────────

test('a colleague on the company domain resolves the whole meeting', () => {
  // The case the exact lookup cannot cover: nobody in VSA has the personal
  // address, and a second attendee carries the company domain.
  const candidates = rankCandidates({
    attendeeEmails: ['claire@shodo.fr', 'marc.durand@gmail.com', 'sophie@aura-technologies.fr'],
    hint: 'Besoin 2 devs Java',
    snapshot: snapshot({
      accounts: [AURA, NOVA],
      // Sophie is not in VSA; a colleague of hers is, on the same domain.
      contacts: [contact('22', 'Luc Martin', 'luc@aura-technologies.fr', 'AURA')],
    }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })

  assert.equal(candidates[0]?.accountId, 'AURA')
  assert.ok(candidates[0]?.signals.includes('email-domain'), 'the domain is what matched')
  assert.ok(
    candidates[0]?.signals.includes('co-attendee'),
    'and it came from somebody other than the first external attendee',
  )
})

test('each candidate carries the signal that produced it', () => {
  const candidates = rankCandidates({
    attendeeEmails: ['marc@aura-technologies.fr'],
    hint: 'Aura — cadrage',
    snapshot: snapshot({
      accounts: [AURA, account('AURA-SUD', 'Aura Sud', 'HOLD')],
      contacts: [contact('22', 'Sophie', 'sophie.autre@aura-technologies.fr', 'AURA')],
    }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })

  for (const candidate of candidates) {
    assert.ok(candidate.signals.length > 0, `${candidate.accountId} has no signal`)
  }
  const aura = candidates.find((c) => c.accountId === 'AURA')
  // The subject names the account, which is the tie-break slot — never a
  // resolution on its own.
  assert.ok(aura?.signals.includes('recency'))
  assert.ok(aura?.signals.includes('email-domain'))
})

test('the ESN’s own attendees never resolve the ESN’s own account', () => {
  const candidates = rankCandidates({
    attendeeEmails: ['claire@shodo.fr'],
    hint: 'Point interne',
    snapshot: snapshot({ accounts: [account('SHODO', 'Shodo'), AURA] }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })
  assert.deepEqual(candidates, [])
})

test('a public domain is never matched against an account name', () => {
  const candidates = rankCandidates({
    attendeeEmails: ['contact@orange.fr'],
    hint: '',
    snapshot: snapshot({ accounts: [account('ORANGE', 'Orange Business Services')] }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })
  assert.deepEqual(candidates, [], 'an ISP address says nothing about the company')
})

// ── 4. siblings under a shared parent ──────────────────────────────────────

test('ambiguity inside a holding lists the siblings rather than guessing', () => {
  const accounts = [
    account('GRP', 'Groupe Aura'),
    account('AURA-N', 'Aura Nord', 'GRP'),
    account('AURA-S', 'Aura Sud', 'GRP'),
  ]
  const candidates = rankCandidates({
    attendeeEmails: ['marc@aura.fr', 'sophie@aura.fr'],
    hint: 'Aura — point mensuel',
    snapshot: snapshot({
      accounts,
      // Both subsidiaries share the group's mail domain. Nothing distinguishes
      // them, which is exactly INPUT-2.
      contacts: [
        contact('1', 'Marc', 'marc.autre@aura.fr', 'AURA-N'),
        contact('2', 'Luc', 'luc@aura.fr', 'AURA-S'),
      ],
    }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })

  const ids = candidates.map((c) => c.accountId)
  assert.ok(ids.includes('AURA-N') && ids.includes('AURA-S'), 'both subsidiaries are offered')
  assert.ok(ids.includes('GRP'), 'the parent is listed too')
  for (const candidate of candidates) {
    assert.equal(candidate.confidence, 'faible', `${candidate.accountId} must not claim confidence`)
  }
  assert.ok(
    candidates.some((c) => c.signals.includes('sibling')),
    'at least one row is there because it is a sibling',
  )
})

test('a sibling is listed but never wins', () => {
  const accounts = [
    account('GRP', 'Groupe Aura'),
    account('AURA-N', 'Aura Nord', 'GRP'),
    account('AURA-S', 'Aura Sud', 'GRP'),
  ]
  const candidates = rankCandidates({
    attendeeEmails: ['marc@aura-nord.fr'],
    hint: '',
    snapshot: snapshot({ accounts, contacts: [contact('1', 'Luc', 'luc@aura-nord.fr', 'AURA-N')] }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })

  assert.equal(candidates[0]?.accountId, 'AURA-N')
  const sibling = candidates.find((c) => c.accountId === 'AURA-S')
  assert.ok(sibling)
  assert.deepEqual(sibling.signals, ['sibling'])
  assert.ok(sibling.score < (candidates[0]?.score ?? 0))
  assert.equal(sibling.confidence, 'faible')
})

test('familyOf groups by the parent link in both directions', () => {
  const accounts = [
    account('GRP', 'Groupe'),
    account('A', 'A', 'GRP'),
    account('B', 'B', 'GRP'),
    account('OTHER', 'Autre'),
  ]
  assert.deepEqual(
    familyOf(accounts, 'A').map((a) => a.accountId).sort(),
    ['B', 'GRP'],
  )
  assert.deepEqual(
    familyOf(accounts, 'GRP').map((a) => a.accountId).sort(),
    ['A', 'B'],
  )
  assert.deepEqual(familyOf(accounts, 'OTHER'), [])
})

test('listSiblings is a group-by, and claims no confidence', () => {
  const siblings = siblingCandidates(
    snapshot({ accounts: [account('A', 'Aura Nord', 'GRP'), account('B', 'Aura Sud', 'GRP'), account('C', 'Autre')] }),
    'GRP',
  )
  assert.deepEqual(
    siblings.map((s) => s.accountId),
    ['A', 'B'],
  )
  for (const sibling of siblings) {
    assert.equal(sibling.confidence, 'faible')
    assert.deepEqual(sibling.signals, ['sibling'])
  }
})

// ── the measured part of "measured, not self-reported" ─────────────────────

test('scores are ordered by signal strength, exact e-mail first', () => {
  const exactRun = rankCandidates({
    attendeeEmails: ['marc@aura-technologies.fr'],
    hint: '',
    snapshot: snapshot({ accounts: [AURA] }),
    exact: new Map([['marc@aura-technologies.fr', [contact('1', 'Marc', 'marc@aura-technologies.fr', 'AURA')]]]),
    ownEmailDomains: ESN_DOMAINS,
  })
  const viaContactDomain = rankCandidates({
    attendeeEmails: ['marc@aura-technologies.fr'],
    hint: '',
    snapshot: snapshot({ accounts: [AURA], contacts: [contact('2', 'Luc', 'luc@aura-technologies.fr', 'AURA')] }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })
  const viaName = rankCandidates({
    attendeeEmails: ['marc@aura.fr'],
    hint: '',
    snapshot: snapshot({ accounts: [AURA] }),
    exact: new Map(),
    ownEmailDomains: ESN_DOMAINS,
  })

  const score = (list: { score: number }[]) => list[0]?.score ?? 0
  assert.ok(score(exactRun) > score(viaContactDomain))
  assert.ok(score(viaContactDomain) > score(viaName))
  assert.ok(score(viaName) < OK_SCORE, 'a name match alone never reaches confident')
  assert.equal(viaName[0]?.confidence, 'faible')
})
