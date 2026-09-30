/**
 * **The models pane is reviewed against numbers the product can produce.**
 *
 * `scripts/harness/bridge-stub.mjs` is what every design review looks at, and
 * its models table was hand-written. Not one of its three rows matched
 * `whisper/catalog.ts`: Whisper Small was `466 Mo` against 486; Medium `1530`
 * against 1614; and the third row was Whisper Large v3 Turbo at **`1031`** —
 * which is the exact figure the catalogue records as the defect it removed,
 * « the rep was promised 1 GB and charged 2.8 ». That checkpoint is no longer
 * in `MODELS` at all: every one of its inferences throws, so round 26 took it
 * out of the offer. The fixture was staging a download of a model a rep cannot
 * select, at a size the product never reported, on the **one screen that tells
 * a rep what a download will cost** and the one where they choose where a
 * client’s audio is processed (DEC-37).
 *
 * The fixture cannot import the catalogue: `installAppBridge` is serialised
 * into the page by `addInitScript`, so it closes over nothing and every value
 * in it is a copy. A copy is not a defect; a copy nothing checks is.
 *
 * **And this file is in `scripts/` for a reason that is itself the finding.**
 * It was written first inside `modules/extract/__tests__/harnessFixture.test.ts`,
 * where every other assertion about this fixture lives — and
 * `check:boundaries` refused it: `modules/extract` may not import
 * `modules/transcribe`. That rule is exactly why no test compared these two
 * tables for the life of the fixture. `scripts/` sits outside the module graph
 * and may read both.
 *
 * `status`, `progress`, `bundled` and `selected` are the fixture’s own and are
 * deliberately not asserted — they are what the *stage* is for: one row
 * mid-download so the progress row is photographed rather than a table where
 * everything happens to be installed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODELS } from '../../electron/modules/transcribe/whisper/catalog.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.resolve(HERE, '../harness/bridge-stub.mjs')

/** The instant `shot.mjs` pins every stage to. */
const PINNED_NOW = (await import('../harness/pinnedNow.mjs')).pinnedNow()

/**
 * A bare `window`, so `installAppBridge` is **run** rather than parsed. A regex
 * over the source would be a second implementation of the fixture, which is the
 * shape `harnessFixture.test.ts` records breaking the first time the fixture
 * expressed the same fact differently.
 */
const withStub = async (scenario, read) => {
  const before = globalThis.window
  globalThis.window = { addEventListener: () => {} }
  try {
    const { installAppBridge } = await import(STUB)
    installAppBridge({ scenario, now: PINNED_NOW, entra: true })
    return await read((channel, payload) => globalThis.window.app.invoke(channel, payload ?? {}))
  } finally {
    globalThis.window = before
  }
}

test('les modèles de la vitrine sont ceux du catalogue, au chiffre près', async () => {
  const rows = await withStub('reglages', async (invoke) => {
    const settings = await invoke('settings:snapshot')
    return settings.models.rows
  })

  const offered = MODELS.map(({ id, label, sizeMb, speed, accuracy }) => ({
    id,
    label,
    sizeMb,
    speed,
    accuracy,
  }))

  assert.deepEqual(
    rows.map(({ id, label, sizeMb, speed, accuracy }) => ({ id, label, sizeMb, speed, accuracy })),
    offered,
    'la vitrine des modèles ne correspond plus à whisper/catalog.ts',
  )

  // And the row the fixture marks selected is one the product offers — a
  // fixture selecting an id the catalogue does not carry is how the turbo row
  // survived here after it stopped being selectable in the product.
  const selected = rows.find((row) => row.selected)
  assert.ok(
    selected && MODELS.some((model) => model.id === selected.id),
    'la ligne sélectionnée par la vitrine n’est pas au catalogue',
  )
})
