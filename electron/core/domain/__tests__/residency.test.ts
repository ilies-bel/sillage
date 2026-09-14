/**
 * The one switch DEC-37 left standing, and the sequence that walked around it.
 *
 * Both registries honoured `offlineOnly` in their ranking. The ranking is not
 * where the decision ends: `main.ts` asks the ranking *and* the rep's explicit
 * choice, and takes the choice whenever it is configured. So « paste an OpenAI
 * key, press *Utiliser*, then ask for this machine only » left the audio going
 * to OpenAI — the ranking refused it and the choice put it back.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedByResidency } from '../residency.ts'

const REGISTRY = [
  { id: 'local-whisper', capabilities: { residency: 'local' as const } },
  { id: 'openai-whisper', capabilities: { residency: 'remote' as const } },
  { id: 'azure-fr', capabilities: { residency: 'remote' as const } },
]

test('off, it changes nothing at all', () => {
  const configured = ['openai-whisper', 'local-whisper']
  assert.deepEqual(allowedByResidency(configured, REGISTRY, false), configured)
})

test('on, every remote provider leaves the candidate set', () => {
  assert.deepEqual(
    allowedByResidency(['openai-whisper', 'local-whisper', 'azure-fr'], REGISTRY, true),
    ['local-whisper'],
  )
})

test('on with nothing local configured, the answer is empty rather than a fallback', () => {
  // Empty is the honest answer and the caller says so on screen: « aucun moteur
  // sur cette machine ». Quietly returning the remote one would be the product
  // overriding a rep's explicit refusal because the alternative was
  // inconvenient.
  assert.deepEqual(allowedByResidency(['openai-whisper'], REGISTRY, true), [])
})

test('an id the registry does not know is kept', () => {
  // This decides what is *allowed*, never what is configured. Dropping an
  // unknown id would make a provider vanish from a settings screen for a reason
  // nothing on it explains.
  assert.deepEqual(allowedByResidency(['mystere'], REGISTRY, true), ['mystere'])
})

test('the order the caller assembled is preserved', () => {
  assert.deepEqual(
    allowedByResidency(
      ['local-whisper', 'openai-whisper', 'autre-local'],
      [...REGISTRY, { id: 'autre-local', capabilities: { residency: 'local' as const } }],
      true,
    ),
    ['local-whisper', 'autre-local'],
  )
})
