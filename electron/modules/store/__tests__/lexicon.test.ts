import test from 'node:test'
import assert from 'node:assert/strict'
import { openMemoryStore } from '../index.ts'
import { buildBoostSet, termsLearnedFrom } from '../../../core/domain/lexicon/boost.ts'
import { sampleContext } from '../../../core/contracts/fixtures.ts'
import type { MeetingContext } from '../../../core/contracts/meeting.ts'

test('a term is stored under its scope and read back with the client', () => {
  const store = openMemoryStore()
  store.lexicon.add({ term: 'Chalendard', category: 'person', scope: 'client', scopeKey: 'Aura' })
  store.lexicon.add({ term: 'Shodo', category: 'company', scope: 'account' })

  assert.deepEqual(
    store.lexicon.forClient('Aura').map((t) => t.term),
    ['Chalendard', 'Shodo'],
  )
  // Another client sees the account vocabulary and none of Aura's people.
  assert.deepEqual(
    store.lexicon.forClient('Autre').map((t) => t.term),
    ['Shodo'],
  )
  store.close()
})

test('the client scope is returned ahead of the account scope', () => {
  // The order the boost budget truncates against, so it is the store's job.
  const store = openMemoryStore()
  store.lexicon.add({ term: 'Shodo', category: 'company', scope: 'account' })
  store.lexicon.add({ term: 'DIMOS', category: 'project', scope: 'client', scopeKey: 'Aura' })

  assert.deepEqual(
    store.lexicon.forClient('Aura').map((t) => t.scope),
    ['client', 'account'],
  )
  store.close()
})

test('adding the same term twice merges its variants instead of replacing them', () => {
  // Enrichment runs after every meeting with the same client, so this happens
  // constantly and must not lose what an earlier meeting observed.
  const store = openMemoryStore()
  store.lexicon.add({ term: 'SharePoint', category: 'tech-en', scope: 'account', variants: ['shirkpoint'] })
  store.lexicon.add({ term: 'SharePoint', category: 'tech-en', scope: 'account', variants: ['Sherpoit'] })

  const [entry] = store.lexicon.forClient(null)
  assert.deepEqual(entry?.variants.sort(), ['Sherpoit', 'shirkpoint'])
  assert.equal(store.lexicon.all().length, 1)
  store.close()
})

test('a term heard again is ranked ahead of one that never was', () => {
  const store = openMemoryStore()
  store.lexicon.add({ term: 'Ancien', category: 'project', scope: 'account' })
  store.lexicon.add({ term: 'Courant', category: 'project', scope: 'account' })
  store.lexicon.observe('account', '', 'Courant')

  assert.deepEqual(
    store.lexicon.forClient(null).map((t) => t.term),
    ['Courant', 'Ancien'],
  )
  store.close()
})

test('an empty term is not storable', () => {
  const store = openMemoryStore()
  store.lexicon.add({ term: '   ', category: 'person', scope: 'account' })
  assert.deepEqual(store.lexicon.all(), [])
  store.close()
})

test('a term can be removed', () => {
  const store = openMemoryStore()
  store.lexicon.add({ term: 'Erreur', category: 'project', scope: 'client', scopeKey: 'Aura' })
  store.lexicon.remove('client', 'Aura', 'Erreur')
  assert.deepEqual(store.lexicon.all(), [])
  store.close()
})

test('rebuilding the projections does not erase the lexicon', () => {
  // It is not a projection: folding the event log cannot reconstruct it, so
  // dropping it would lose everything the app has learned about a client.
  const store = openMemoryStore()
  store.lexicon.add({ term: 'Chalendard', category: 'person', scope: 'client', scopeKey: 'Aura' })
  store.projections.rebuild()
  assert.equal(store.lexicon.all().length, 1)
  store.close()
})

test('a meeting teaches the client scope, so the next one starts already boosted', () => {
  // The compounding claim of DEC-17, end to end across the two halves that
  // step 4 built and that nothing connected until the session wiring landed:
  // `termsLearnedFrom` derives the terms, the store scopes them to the client,
  // and `buildBoostSet` picks them up for the *next* meeting — before anyone
  // has opened the calendar for it.
  const store = openMemoryStore()

  const first: MeetingContext = {
    ...sampleContext,
    subject: 'Acme Industries — migration Artemis',
    attendees: [
      { name: 'Camille Le Roy', email: 'c@acme.fr', type: 'required', response: 'accepted' },
    ],
  }

  store.lexicon.addAll(termsLearnedFrom(first, 'Acme Industries'))

  // A second meeting with the same client, whose own invite says none of it.
  const second: MeetingContext = {
    ...sampleContext,
    subject: 'Point hebdomadaire',
    agenda: '',
    organizer: { name: '', email: 'moi@esn.fr', type: 'required', response: 'organizer' },
    attendees: [],
  }

  const boost = buildBoostSet(second, {
    capability: 'initialPrompt',
    stored: store.lexicon.forClient('Acme Industries'),
  })

  assert.ok(boost.terms.includes('Le Roy'), 'the surname carried over')
  assert.ok(boost.terms.includes('Artemis'), 'so did the project name')

  // And it is scoped: another client learns nothing from this one.
  const other = buildBoostSet(second, {
    capability: 'initialPrompt',
    stored: store.lexicon.forClient('Nordis'),
  })
  assert.equal(other.terms.includes('Le Roy'), false)

  store.close()
})
