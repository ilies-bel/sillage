/**
 * HR-11's visible half (VISION.md §6, screen 5).
 *
 * The registries decide *which* provider gets used; this decides what the
 * settings table says about the ones that do not. The rule it exists to keep
 * true: **an unusable provider is listed with the reason, never dropped.** A
 * silent omission is indistinguishable from a bug, and the rep who pasted that
 * key spends the demo wondering where it went.
 *
 * The descriptors below are fixtures rather than the shipped registries, and
 * that is the boundary rule doing its job: `core/` may not import `modules/`.
 * The check that the *real* tables obey this lives in
 * `app/ipc/__tests__/register.test.ts`, which may see both.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { providerRows, providerSection, type ProviderDescriptorLike } from '../providerRows.ts'

const local: ProviderDescriptorLike = {
  id: 'local-engine',
  label: 'Moteur local',
  tier: 'local',
  auth: 'none',
  capabilities: { residency: 'local', streaming: false, languages: ['fr-FR'], cost: 'free' },
}

const served: ProviderDescriptorLike = {
  id: 'served',
  label: 'Serveur maison',
  tier: 'self-hosted',
  auth: 'apiKey',
  capabilities: { residency: 'local', streaming: true, languages: ['fr-FR'], cost: 'free' },
}

const vendorA: ProviderDescriptorLike = {
  id: 'vendor-a',
  label: 'Fournisseur A',
  tier: 'cloud',
  auth: 'apiKey',
  capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
}

const vendorB: ProviderDescriptorLike = {
  id: 'vendor-b',
  label: 'Fournisseur B',
  tier: 'cloud',
  auth: 'apiKey',
  capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
}

const ALL = [local, served, vendorA, vendorB]

test('every provider gets a row, refused ones included', () => {
  const rows = providerRows(ALL, { configured: [], selected: null, reason: null })
  assert.equal(rows.length, ALL.length)
  assert.ok(rows.some((row) => row.id === 'vendor-b'), 'the excluded provider is in the table')
})

test('an unselectable row always carries a non-empty reason (DEC-26)', () => {
  for (const configured of [[], ALL.map((d) => d.id)]) {
    for (const row of providerRows(ALL, { configured, selected: null, reason: null })) {
      if (!row.selectable) {
        assert.ok(
          row.reason !== null && row.reason.length > 0,
          `${row.id} is unselectable with no reason`,
        )
      }
    }
  }
})

test('a configured hosted provider is usable, and the row still says where it runs', () => {
  const rows = providerRows(ALL, {
    configured: ['vendor-b'],
    selected: 'vendor-b',
    reason: null,
  })
  const row = rows.find((candidate) => candidate.id === 'vendor-b')

  assert.equal(row?.configured, true, 'the key really was entered')
  assert.equal(row?.selectable, true, 'the row states a fact; it does not refuse')
  assert.equal(row?.reason, null)
  // The visible half survives: the screen can still say whether the audio
  // leaves the machine, because the row carries it. It no longer decides.
  assert.equal(row?.residency, 'remote')
})

test('the reason names the constraint that bit, and it is tier-specific', () => {
  const rows = providerRows(ALL, { configured: [], selected: null, reason: null })
  assert.match(rows.find((r) => r.id === 'local-engine')?.reason ?? '', /installé/)
  assert.match(rows.find((r) => r.id === 'served')?.reason ?? '', /URL/)
  assert.match(rows.find((r) => r.id === 'vendor-a')?.reason ?? '', /clé/)
})

test('offline mode blocks everything that is not local, and says so', () => {
  const rows = providerRows(ALL, {
    configured: ALL.map((d) => d.id),
    selected: 'local-engine',
    reason: null,
    offlineOnly: true,
  })

  assert.equal(rows.find((r) => r.id === 'local-engine')?.selectable, true)
  // `local` on a served model too — nothing leaves the perimeter.
  assert.equal(rows.find((r) => r.id === 'served')?.selectable, true)
  const cloud = rows.find((r) => r.id === 'vendor-a')
  assert.equal(cloud?.selectable, false)
  assert.match(cloud?.reason ?? '', /hors ligne/)
})

test('a section carries the registry’s refusal only when nothing is selected', () => {
  const refused = providerSection(ALL, {
    configured: [],
    selected: null,
    reason: 'aucun modèle de langage n’est configuré',
  })
  assert.equal(refused.reason, 'aucun modèle de langage n’est configuré')

  const chosen = providerSection(ALL, {
    configured: ['vendor-a'],
    selected: 'vendor-a',
    reason: 'stale',
  })
  // Something is selected, so there is nothing to explain — carrying a stale
  // refusal beside a working provider would be the screen contradicting itself.
  assert.equal(chosen.reason, null)
  assert.equal(chosen.selected, 'vendor-a')
})

// ── DEC-34: the fields, and DEC-36: the row whose credential is a session ────

test('a declared field reaches the row carrying whatever is in it', () => {
  const rows = providerRows(
    [
      {
        id: 'local-openai',
        label: 'Modèle local',
        tier: 'self-hosted',
        auth: 'apiKey',
        capabilities: { residency: 'local', streaming: true, languages: ['fr-FR'], cost: 'free' },
        fields: [
          { key: 'url', label: 'URL du serveur', placeholder: 'http://…', required: true },
          { key: 'model', label: 'Modèle', placeholder: 'llama3.1:8b', required: true },
        ],
      },
    ],
    {
      configured: [],
      selected: null,
      reason: null,
      values: { 'local-openai': { url: 'http://localhost:11434/v1' } },
    },
  )
  const fields = rows[0]!.fields
  assert.equal(fields[0]?.value, 'http://localhost:11434/v1')
  // Empty string, never null or undefined: the input on the other side is
  // controlled, and React logs a warning and switches modes on undefined.
  assert.equal(fields[1]?.value, '')
})

test('a provider that declares no fields gets an empty list, not undefined', () => {
  const rows = providerRows(
    [
      {
        id: 'groq',
        label: 'Groq',
        tier: 'cloud',
        auth: 'apiKey',
        capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
      },
    ],
    { configured: ['groq'], selected: 'groq', reason: null },
  )
  assert.deepEqual(rows[0]?.fields, [])
})

test('an oauth row is not told it is missing a key', () => {
  // It has no key field, so « aucune clé enregistrée » points at a control that
  // is deliberately not there.
  const rows = providerRows(
    [
      {
        id: 'chatgpt',
        label: 'ChatGPT',
        tier: 'cloud',
        auth: 'oauth',
        capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'included' },
      },
    ],
    { configured: [], selected: null, reason: null },
  )
  assert.equal(rows[0]?.reason, 'aucune session ouverte')
})

test('a module’s own diagnosis replaces the generic one', () => {
  const rows = providerRows(
    [
      {
        id: 'chatgpt',
        label: 'ChatGPT',
        tier: 'cloud',
        auth: 'oauth',
        capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'included' },
      },
    ],
    {
      configured: [],
      selected: null,
      reason: null,
      reasons: { chatgpt: 'session ChatGPT expirée le 12/08/2026 — exécutez `codex login`' },
    },
  )
  assert.match(rows[0]?.reason ?? '', /expirée/)
})

test('a supplied reason cannot talk the app out of offline mode', () => {
  // `offlineOnly` is the rep asking, in the product, for nothing to leave the
  // machine. A module explaining that away would be a module overruling them.
  const rows = providerRows(
    [
      {
        id: 'chatgpt',
        label: 'ChatGPT',
        tier: 'cloud',
        auth: 'oauth',
        capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'included' },
      },
    ],
    {
      configured: ['chatgpt'],
      selected: null,
      reason: null,
      offlineOnly: true,
      reasons: { chatgpt: 'tout va bien' },
    },
  )
  assert.match(rows[0]?.reason ?? '', /hors ligne/)
  assert.equal(rows[0]?.selectable, false)
})
