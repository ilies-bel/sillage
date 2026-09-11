/**
 * `selectProvider` is pure, so every rule it carries is provable with no
 * network, no key and no provider account.
 *
 * Where a provider runs is *declared* by each row and shown in Réglages, and it
 * refuses nothing. It does not break ties either, since DEC-37 left only one
 * distinction — on this machine or not. The rule that still refuses is
 * `offlineOnly` — the rep asking, in the product, for this meeting's audio to
 * stay on the machine.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { STT_PROVIDERS, descriptorFor, providerRank, selectProvider } from '../registry.ts'
import { ADAPTED_PROVIDERS } from '../index.ts'

const FR = 'fr-FR'

test('a hosted provider is selected when it is what was configured', () => {
  const chosen = selectProvider({ configured: ['groq-whisper', 'openai-whisper'], language: FR })
  assert.equal(chosen.ok, true)
  assert.equal(chosen.ok === true ? chosen.id : '', 'groq-whisper')
})

test('the refusal names the constraint that bit, and location is not one', () => {
  // Nothing configured at all is a real refusal. Residency is not: it is a
  // fact on the row, and the screen states it rather than acting on it.
  const chosen = selectProvider({ configured: [], language: FR })
  assert.equal(chosen.ok, false)
  assert.match(chosen.ok === false ? chosen.reason : '', /fr-FR/)
  assert.doesNotMatch(chosen.ok === false ? chosen.reason : '', /résidence/)
})

/*
 * DEC-30. `configured` containing `local-whisper` means the weights are on
 * disk — that is what `usableSttProviders` reconciles — so these three are the
 * decision itself: present local engine wins, a configured cloud one is an
 * upgrade the rep opts into, and an absent local engine is the only reason the
 * cloud is reached without being asked for.
 */
test('the local engine wins over a configured cloud provider (DEC-30)', () => {
  const chosen = selectProvider({ configured: ['local-whisper', 'azure-fr'], language: FR })
  assert.deepEqual(chosen, { ok: true, id: 'local-whisper' })
})

test('preferCloud is what promotes the cloud engine, and nothing else is', () => {
  const chosen = selectProvider({
    configured: ['local-whisper', 'azure-fr'],
    language: FR,
    preferCloud: true,
  })
  assert.deepEqual(chosen, { ok: true, id: 'azure-fr' })
})

test('with the weights not on disk the cloud provider is selected unasked', () => {
  const chosen = selectProvider({ configured: ['azure-fr'], language: FR })
  assert.deepEqual(chosen, { ok: true, id: 'azure-fr' })
})

test('the local engine wins when nothing else is usable (HR-4)', () => {
  const chosen = selectProvider({ configured: ['local-whisper'], language: FR })
  assert.deepEqual(chosen, { ok: true, id: 'local-whisper' })
})

test('opting into the cloud reaches a hosted provider when that is the one configured', () => {
  const chosen = selectProvider({
    configured: ['local-whisper', 'groq-whisper'],
    language: FR,
    preferCloud: true,
  })
  assert.deepEqual(chosen, { ok: true, id: 'groq-whisper' })
})

test('not opting in leaves the local engine selected, whatever the cloud row says', () => {
  // DEC-30 is untouched by any of this: a configured cloud key is an upgrade
  // the rep takes, never one that takes itself.
  const chosen = selectProvider({ configured: ['local-whisper', 'groq-whisper'], language: FR })
  assert.deepEqual(chosen, { ok: true, id: 'local-whisper' })
})

test('offlineOnly refuses a cloud provider even when it is configured', () => {
  const chosen = selectProvider({
    configured: ['local-whisper', 'azure-fr'],
    language: FR,
    offlineOnly: true,
  })
  assert.deepEqual(chosen, { ok: true, id: 'local-whisper' })
})

test('offlineOnly outranks the cloud opt-in — HR-4 is a constraint, not a preference', () => {
  const chosen = selectProvider({
    configured: ['local-whisper', 'azure-fr'],
    language: FR,
    offlineOnly: true,
    preferCloud: true,
  })
  assert.deepEqual(chosen, { ok: true, id: 'local-whisper' })
})

test('offlineOnly with no local model says so rather than reaching for the cloud', () => {
  const chosen = selectProvider({ configured: ['azure-fr'], language: FR, offlineOnly: true })
  assert.equal(chosen.ok, false)
  assert.match(chosen.ok === false ? chosen.reason : '', /hors ligne/)
})

test('a hosted provider is reachable on its key alone — location does not gate', () => {
  const chosen = selectProvider({ configured: ['groq-whisper'], language: FR, preferCloud: true })
  assert.deepEqual(chosen, { ok: true, id: 'groq-whisper' })
})

test('a streaming provider outranks a batch one', () => {
  /*
   * **Proved on `rank`, not on a shipped row, and that is the point.**
   *
   * This asserted the selector picks `deepgram` — a row that declared
   * `streaming: true` and had **no adapter**. `createSttSession` threw for it,
   * the throw escaped `Recording.start`, and `Orchestrator`'s single catch set
   * *capture* down and aborted the meeting: a rep who pasted a Deepgram key into
   * Réglages stopped being able to record while being told their microphone was
   * unavailable. This test asserted the selector reaches it. Nobody asked whether
   * it could run, and the test's own subject made the defect look intentional.
   *
   * The *preference* is real and worth holding. Held against the ranking
   * function directly, so it cannot be satisfied again by declaring a provider
   * the product cannot start.
   */
  const cloud = (streaming: boolean): Parameters<typeof providerRank>[0] => ({
    id: 'x',
    label: 'x',
    tier: 'cloud',
    auth: 'apiKey',
    capabilities: { residency: 'remote', streaming, languages: [FR], cost: 'metered' },
    boost: 'none',
  })
  assert.ok(
    providerRank(cloud(true), true) < providerRank(cloud(false), true),
    'un fournisseur streaming doit passer devant un fournisseur batch',
  )
})

test('every provider the table offers can actually be started', () => {
  /*
   * The check that was missing. A row here is an offer — `Reglages` renders it
   * `selectable` and `selectProvider` may pick it — so a row without an adapter
   * is not an unimplemented feature, it is a recording that does not happen.
   */
  for (const descriptor of STT_PROVIDERS) {
    assert.ok(
      ADAPTED_PROVIDERS.has(descriptor.id),
      `${descriptor.id} est proposé dans STT_PROVIDERS et n’a pas de session — ` +
        'createSttSession lèverait, et la réunion serait abandonnée.',
    )
  }
})

test('table order breaks a tie between two upgrades that behave the same', () => {
  // Both batch, both cloud, so nothing in `rank` separates them and the stable
  // sort falls through to the order written in STT_PROVIDERS. That tie used to
  // be settled by a residency claim the rows no longer make (DEC-37). A
  // preference, not a rule: the test above proves either is still reachable
  // when it is the only one configured.
  const chosen = selectProvider({
    configured: ['openai-whisper', 'azure-fr'],
    language: FR,
    preferCloud: true,
  })
  assert.deepEqual(chosen, { ok: true, id: 'azure-fr' })
})

test('an unsupported language is refused rather than transcribed in French', () => {
  const chosen = selectProvider({ configured: ['azure-fr', 'local-whisper'], language: 'de-DE' })
  assert.equal(chosen.ok, false)
  assert.match(chosen.ok === false ? chosen.reason : '', /de-DE/)
})

test('no provider claims a boost capability it cannot deliver', () => {
  // Azure has phrase lists, but not on the short-audio REST endpoint this
  // adapter uses. Claiming `phraseList` here would silently drop every hotword
  // (DEC-17: capability-detected, never assumed).
  assert.equal(descriptorFor('azure-fr')?.boost, 'none')
  assert.equal(descriptorFor('local-whisper')?.boost, 'initialPrompt')
})

test('every descriptor is well formed and unique', () => {
  const ids = STT_PROVIDERS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate provider id')
  for (const provider of STT_PROVIDERS) {
    assert.ok(provider.label.length > 0, `${provider.id} has no label`)
    assert.ok(provider.capabilities.languages.length > 0, `${provider.id} declares no language`)
  }
})
