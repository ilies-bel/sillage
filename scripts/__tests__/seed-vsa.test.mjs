/**
 * The seed table, checked without a sandbox.
 *
 * `scripts/seed-vsa.mjs` only ever runs against a live tenant, which means its
 * table is the part nobody looks at twice — and the table is where the value
 * is. Three things have to stay true and none of them is visible by reading:
 *
 *   · **Order.** A child cannot be created before the parent it names in
 *     `parentTiersCode`, and a contact cannot be created before its account.
 *     The plan is topological; a table edit that breaks it fails here rather
 *     than half way through a run against a shared public sandbox.
 *   · **The fixture link.** `fixtures/transcript-acme.json` names a company and
 *     an attendee address. If the seed set drifts off them, the replay path
 *     pushes into nothing and the failure looks like a bad prompt.
 *   · **The two shapes the resolver is judged on.** One holding whose
 *     subsidiaries share a domain (INPUT-2, the `⚠ faible` case) and one contact
 *     on a consumer domain (INPUT-1, the exact-`?email=` case). Both are easy to
 *     delete by accident while tidying the table.
 *
 * Imports the script rather than running it: the seeder only calls `main()`
 * when it is the process entry point.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ACCOUNTS, CONTACTS, planSeed, siren } from '../seed-vsa.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/transcript-acme.json'), 'utf8'))

const domainOf = (email) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

test('the plan creates every parent before its children', () => {
  const steps = planSeed()
  const created = new Set()
  for (const step of steps) {
    if (step.type !== 'account') continue
    if (step.account.parent) assert.ok(created.has(step.account.parent), `${step.account.key} before ${step.account.parent}`)
    created.add(step.account.key)
  }
})

test('the plan creates every account before its contacts', () => {
  const created = new Set()
  for (const step of planSeed()) {
    if (step.type === 'account') created.add(step.account.key)
    else assert.ok(created.has(step.account.key), `contact ${step.contact.email} before ${step.account.key}`)
  }
})

test('--only pulls the ancestors of what it selects', () => {
  const keys = planSeed({ only: 'acme-industries' })
    .filter((s) => s.type === 'account')
    .map((s) => s.account.key)
  assert.deepEqual(keys, ['acme', 'acme-industries'])
})

test('a cycle in the table is refused, not looped', () => {
  const accounts = [
    { key: 'a', parent: 'b', kind: 'prospect', code: 'A', name: 'A' },
    { key: 'b', parent: 'a', kind: 'prospect', code: 'B', name: 'B' },
  ]
  assert.throws(() => planSeed({ accounts, contacts: [] }), /cycle/)
})

test('every SIREN carries a valid Luhn check digit', () => {
  for (const account of ACCOUNTS) {
    assert.match(account.siren, /^\d{9}$/, account.name)
    let sum = 0
    let double = false
    for (let i = account.siren.length - 1; i >= 0; i--) {
      let digit = Number(account.siren[i])
      if (double) {
        digit *= 2
        if (digit > 9) digit -= 9
      }
      sum += digit
      double = !double
    }
    assert.equal(sum % 10, 0, `${account.name} — ${account.siren} fails Luhn`)
  }
})

test('siren() appends the check digit rather than a random one', () => {
  // 552100554 is a real, published, Luhn-valid SIREN shape used here only as a
  // known-good vector for the arithmetic.
  assert.equal(siren('55210055'), '552100554')
})

test('account codes, names and contact emails are unique', () => {
  const codes = ACCOUNTS.map((a) => `${a.kind}:${a.code.toLowerCase()}`)
  const names = ACCOUNTS.map((a) => `${a.kind}:${a.name.toLowerCase()}`)
  const emails = CONTACTS.map((c) => c.email.toLowerCase())
  assert.equal(new Set(codes).size, codes.length)
  assert.equal(new Set(names).size, names.length)
  assert.equal(new Set(emails).size, emails.length)
})

test('every contact points at an account in the table', () => {
  const keys = new Set(ACCOUNTS.map((a) => a.key))
  for (const contact of CONTACTS) assert.ok(keys.has(contact.account), contact.email)
})

test('the fixture’s client and attendee are in the seed set', () => {
  const attendee = fixture.context.attendees[0].email.toLowerCase()
  const contact = CONTACTS.find((c) => c.email.toLowerCase() === attendee)
  assert.ok(contact, `no seeded contact for ${attendee}`)

  const account = ACCOUNTS.find((a) => a.key === contact.account)
  assert.equal(account.name, 'Acme Industries')
  assert.equal(account.domain, domainOf(attendee))
  assert.ok(fixture.context.subject.includes(account.name))
})

test('the fixture resolves unambiguously — no sibling shares its domain', () => {
  const acme = ACCOUNTS.find((a) => a.key === 'acme-industries')
  const family = ACCOUNTS.filter((a) => a.key !== acme.key && (a.parent === acme.parent || a.key === acme.parent))
  assert.ok(family.length > 0, 'the fixture account has no siblings — DEC-18 has nothing to show')
  for (const sibling of family) assert.notEqual(sibling.domain, acme.domain)
})

test('INPUT-2 survives: one holding has ≥ 2 subsidiaries on a shared domain', () => {
  const byParent = new Map()
  for (const account of ACCOUNTS.filter((a) => a.parent)) {
    byParent.set(account.parent, [...(byParent.get(account.parent) ?? []), account])
  }
  const ambiguous = [...byParent.values()].filter(
    (children) => children.length >= 2 && new Set(children.map((c) => c.domain)).size === 1,
  )
  assert.ok(ambiguous.length > 0, 'no shared-domain holding — the ⚠ faible path has no input')
  // And the holding itself must hold no contact, or the domain resolves to it.
  for (const children of ambiguous) {
    const parent = children[0].parent
    assert.equal(
      CONTACTS.filter((c) => c.account === parent && domainOf(c.email) === children[0].domain).length,
      0,
    )
  }
})

test('both account kinds are seeded', () => {
  const kinds = new Set(ACCOUNTS.map((a) => a.kind))
  // `VsaCrm.link` branches on it — `contactsIds` for a customer,
  // `contactsProspectsIds` for a prospect — and so does an opportunity's
  // `accountType`. One kind leaves half of that unexercised.
  assert.deepEqual([...kinds].sort(), ['customer', 'prospect'])
})

test('the fixture’s account is a prospect, because customer contacts do not resolve', () => {
  // Measured, not assumed: `Directory.snapshot()` bulk-loads prospect contacts
  // only, so a customer contact never reaches `rankCandidates` and the account
  // falls back to name matching at `⚠ faible`. Flip this the day
  // `Directory.customerContacts()` is wired into resolution — until then it
  // would put demo beat #4 on a low-confidence row.
  assert.equal(ACCOUNTS.find((a) => a.key === 'acme-industries').kind, 'prospect')
})

test('INPUT-1 survives: one contact sits on a consumer domain', () => {
  const consumer = new Set(['gmail.com', 'orange.fr', 'free.fr', 'wanadoo.fr', 'hotmail.fr', 'yahoo.fr'])
  const personal = CONTACTS.filter((c) => consumer.has(domainOf(c.email)))
  assert.ok(personal.length > 0, 'no personal-address contact — the exact ?email= path has no input')
})

test('no contact is on the ESN’s own domain — the rep is not the client', () => {
  const own = domainOf(fixture.repEmail)
  for (const contact of CONTACTS) assert.notEqual(domainOf(contact.email), own)
})
