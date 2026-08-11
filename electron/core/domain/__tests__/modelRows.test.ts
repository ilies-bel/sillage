/**
 * DEC-35, and one rule above all the others: **`ready` comes from the disk.**
 *
 * The failure these are written against is the one the deleted download service
 * documented and did not fix — a model reported installed on the strength of a
 * worker event, selected because it was reported installed, and then aborting at
 * load in the middle of a client call. Every test here that looks pedantic is
 * pinning one step of that chain.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelRowSchema } from '../../contracts/models.ts'
import { modelRows, modelSection, resolveSelectedModel } from '../modelRows.ts'
import type { ModelDescriptorLike } from '../modelRows.ts'

const CATALOGUE: ModelDescriptorLike[] = [
  { id: 'small', label: 'Whisper Small', sizeMb: 466, speed: 'medium', accuracy: 'très bonne' },
  { id: 'medium', label: 'Whisper Medium', sizeMb: 1530, speed: 'slow', accuracy: 'très bonne' },
  { id: 'tiny', label: 'Whisper Tiny', sizeMb: 74, speed: 'fast', accuracy: 'correcte' },
]

const rowFor = (id: string, rows: ReturnType<typeof modelRows>) => rows.find((row) => row.id === id)

test('every catalogue entry gets a row, installed or not', () => {
  const rows = modelRows(CATALOGUE, { bundledId: 'small', ready: ['small'] })
  assert.deepEqual(
    rows.map((row) => row.id),
    ['small', 'medium', 'tiny'],
  )
})

test('the bundled row is marked, and it is the only one', () => {
  const rows = modelRows(CATALOGUE, { bundledId: 'small', ready: ['small'] })
  assert.equal(rows.filter((row) => row.bundled).length, 1)
  assert.equal(rowFor('small', rows)?.bundled, true)
})

test('ready comes from the disk list and from nothing else', () => {
  const rows = modelRows(CATALOGUE, { bundledId: 'small', ready: ['small', 'tiny'] })
  assert.equal(rowFor('small', rows)?.status, 'ready')
  assert.equal(rowFor('tiny', rows)?.status, 'ready')
  assert.equal(rowFor('medium', rows)?.status, 'absent')
})

test('a finished download whose bytes are not on disk is not ready', () => {
  // The exact shape of the shipped bug: the worker said it was done, the
  // activity map recorded it, and the disk disagrees. The disk wins.
  const rows = modelRows(CATALOGUE, {
    bundledId: 'small',
    ready: ['small'],
    activity: { medium: { status: 'ready', progress: 100, reason: null } },
  })
  assert.equal(rowFor('medium', rows)?.status, 'absent')
})

test('a live download outranks the resting status, and carries its percentage', () => {
  const rows = modelRows(CATALOGUE, {
    bundledId: 'small',
    ready: ['small'],
    activity: { medium: { status: 'downloading', progress: 42, reason: null } },
  })
  assert.equal(rowFor('medium', rows)?.status, 'downloading')
  assert.equal(rowFor('medium', rows)?.progress, 42)
})

test('a stale percentage cannot sit under a row that has since failed', () => {
  const rows = modelRows(CATALOGUE, {
    bundledId: 'small',
    ready: ['small'],
    activity: { medium: { status: 'error', progress: 87, reason: 'réseau injoignable' } },
  })
  assert.equal(rowFor('medium', rows)?.progress, 0)
  assert.equal(rowFor('medium', rows)?.reason, 'réseau injoignable')
})

test('an error whose bytes arrived anyway reads as installed', () => {
  // A failure is worth keeping on screen, but not once the thing it is about
  // has succeeded by some other route — a second attempt, or a manual copy.
  const rows = modelRows(CATALOGUE, {
    bundledId: 'small',
    ready: ['small', 'medium'],
    activity: { medium: { status: 'error', progress: 0, reason: 'réseau injoignable' } },
  })
  assert.equal(rowFor('medium', rows)?.status, 'ready')
  assert.equal(rowFor('medium', rows)?.reason, null)
})

test('an error always carries a reason, and only an error does', () => {
  const rows = modelRows(CATALOGUE, {
    bundledId: 'small',
    ready: ['small'],
    activity: {
      medium: { status: 'error', progress: 0, reason: null },
      tiny: { status: 'cancelled', progress: 0, reason: null },
    },
  })
  // The contract makes the pairing unrepresentable; this checks the producer
  // satisfies it rather than leaving zod to reject its own app's payload.
  for (const row of rows) ModelRowSchema.parse(row)
  assert.ok((rowFor('medium', rows)?.reason ?? '').length > 0)
  assert.equal(rowFor('tiny', rows)?.reason, null)
})

// ── which checkpoint the engine loads ───────────────────────────────────────

test('the rep’s choice wins while it is loadable', () => {
  assert.equal(
    resolveSelectedModel({ bundledId: 'small', ready: ['small', 'medium'], preferred: 'medium' }),
    'medium',
  )
})

test('a chosen model that was deleted falls back to the bundled one', () => {
  // Not to nothing. A dangling preference must not leave the engine pointing at
  // a checkpoint that is no longer there — the symptom would be a meeting that
  // starts and transcribes nothing.
  assert.equal(
    resolveSelectedModel({ bundledId: 'small', ready: ['small'], preferred: 'medium' }),
    'small',
  )
})

test('with no bundled bytes either, the first installed model is selected', () => {
  // The developer checkout that never ran `fetch-whisper-model`.
  assert.equal(resolveSelectedModel({ bundledId: 'small', ready: ['tiny'] }), 'tiny')
})

test('nothing installed selects nothing, and says so rather than guessing', () => {
  assert.equal(resolveSelectedModel({ bundledId: 'small', ready: [] }), null)
  assert.equal(modelSection(CATALOGUE, { bundledId: 'small', ready: [] }).selected, null)
})

test('exactly one row is marked selected', () => {
  const section = modelSection(CATALOGUE, {
    bundledId: 'small',
    ready: ['small', 'medium'],
    preferred: 'medium',
  })
  assert.equal(section.rows.filter((row) => row.selected).length, 1)
  assert.equal(section.selected, 'medium')
})

test('a developer checkout with no bundled bytes still renders (DEC-35a)', () => {
  // The bundled row is a fact about the installer, not about the disk. A
  // contract that made this unrepresentable would crash Réglages on a fresh
  // clone instead of explaining it.
  const rows = modelRows(CATALOGUE, { bundledId: 'small', ready: [] })
  assert.equal(rowFor('small', rows)?.status, 'absent')
  for (const row of rows) ModelRowSchema.parse(row)
})
