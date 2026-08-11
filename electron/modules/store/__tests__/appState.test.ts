import test from 'node:test'
import assert from 'node:assert/strict'
import { openMemoryStore } from '../index.ts'
import type { KeyValueStore } from '../../../core/contracts/kv.ts'

test('a value survives being written twice', () => {
  const store = openMemoryStore()
  store.appState.set('calendar.window', '{"cursor":null}')
  store.appState.set('calendar.window', '{"cursor":"https://graph/delta"}')
  assert.equal(store.appState.get('calendar.window'), '{"cursor":"https://graph/delta"}')
  store.close()
})

test('a key nobody wrote reads as null, not undefined', () => {
  // The port's contract, and the difference between `??` working and not.
  const store = openMemoryStore()
  assert.equal(store.appState.get('nothing'), null)
  store.close()
})

test('deleting is idempotent', () => {
  const store = openMemoryStore()
  store.appState.set('k', 'v')
  store.appState.delete('k')
  store.appState.delete('k')
  assert.equal(store.appState.get('k'), null)
  store.close()
})

test('the store satisfies KeyValueStore without being adapted', () => {
  // What lets `app/` hand `store.appState` to modules that may not import the
  // store (ARCHITECTURE.md §4).
  const store = openMemoryStore()
  const port: KeyValueStore = store.appState
  port.set('k', 'v')
  assert.equal(port.get('k'), 'v')
  store.close()
})

test('rebuilding the projections leaves app state alone', () => {
  // A delta cursor cannot be recomputed by folding events — only re-earned from
  // Graph. Dropping it with the projections would cost a full resync, silently.
  const store = openMemoryStore()
  store.appState.set('calendar.window', '{"cursor":"https://graph/delta"}')
  store.projections.rebuild()
  assert.equal(store.appState.get('calendar.window'), '{"cursor":"https://graph/delta"}')
  store.close()
})
