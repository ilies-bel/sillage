/**
 * The retryable/not-retryable split, which is the only part of `ConnectorHealth`
 * a rep can act on.
 *
 * DEC-26: a disabled control always states why, and a retry button that cannot
 * help is worse than no button. So the assertions here are about the *pair*
 * (state, retryable) rather than about the wording.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectorHealthSchema } from '../../../core/contracts/health.ts'
import { LlmError, LlmSchemaError } from '../../../core/contracts/llm.ts'
import { llmHealth } from '../index.ts'

const AT = 1_700_000_000_000

const health = (error: unknown) => llmHealth(error, AT)

test('every mapping is a valid ConnectorHealth', () => {
  const errors: unknown[] = [
    new LlmError({ kind: 'auth', message: 'x', retryable: false, status: 401 }),
    new LlmError({ kind: 'quota', message: 'x', retryable: true, status: 429 }),
    new LlmError({ kind: 'timeout', message: 'x', retryable: true }),
    new LlmError({ kind: 'server', message: 'x', retryable: true, status: 503 }),
    new LlmError({ kind: 'network', message: 'x', retryable: true }),
    new LlmError({ kind: 'unknown', message: 'modèle introuvable', retryable: false, status: 404 }),
    new LlmSchemaError({ message: 'x', issues: ['tjm: attendu un nombre'], raw: '{}' }),
    new Error('boom'),
    'pas une erreur',
  ]
  for (const error of errors) {
    const parsed = ConnectorHealthSchema.safeParse(health(error))
    assert.equal(parsed.success, true, JSON.stringify(health(error)))
  }
})

test('a refused key is down and NOT retryable — waiting fixes nothing', () => {
  const state = health(new LlmError({ kind: 'auth', message: 'x', retryable: false, status: 401 }))
  assert.equal(state.state, 'down')
  assert.equal(state.state === 'down' ? state.retryable : true, false)
  // And it says what to do, rather than restating the status code.
  assert.match(state.state === 'down' ? state.reason : '', /configuration/)
})

test('a timeout and a 5xx are retryable, and only degrade', () => {
  for (const kind of ['timeout', 'server', 'network', 'quota'] as const) {
    const state = health(new LlmError({ kind, message: 'x', retryable: true }))
    assert.equal(state.state, 'degraded', kind)
    assert.equal(state.state === 'degraded' ? state.retryable : false, true, kind)
  }
})

test('degraded, not down: the meeting is still being recorded (DEC-26)', () => {
  // Everything except a refused key leaves capture and the rep's own notes
  // untouched, so the connector is impaired rather than unusable.
  assert.equal(health(new LlmError({ kind: 'server', message: 'x', retryable: true })).state, 'degraded')
  assert.equal(health(new LlmSchemaError({ message: 'x', issues: [], raw: '' })).state, 'degraded')
})

test('a schema failure surfaces as its own reason, not as a generic outage', () => {
  const state = health(new LlmSchemaError({ message: 'x', issues: [], raw: '' }))
  assert.equal(state.state, 'degraded')
  assert.match(state.state === 'degraded' ? state.reason : '', /format/)
  // Regenerating is the remedy, so the affordance is real rather than dead.
  assert.equal(state.state === 'degraded' ? state.retryable : false, true)
})

test('a 4xx we caused carries the adapter’s own verdict rather than a guess', () => {
  const state = health(
    new LlmError({ kind: 'unknown', message: 'modèle introuvable', retryable: false, status: 404 }),
  )
  assert.equal(state.state, 'down')
  assert.equal(state.state === 'down' ? state.retryable : true, false)
  assert.equal(state.state === 'down' ? state.reason : '', 'modèle introuvable')
})

test('an unrecognised failure still states a reason', () => {
  const state = health('quelque chose')
  assert.equal(state.state, 'down')
  assert.ok(state.state === 'down' && state.reason.length > 0)
})

test('every reason is French — the rep reads it verbatim (HR-6)', () => {
  const reasons = [
    new LlmError({ kind: 'auth', message: 'x', retryable: false }),
    new LlmError({ kind: 'quota', message: 'x', retryable: true }),
    new LlmError({ kind: 'timeout', message: 'x', retryable: true }),
    new LlmError({ kind: 'server', message: 'x', retryable: true }),
    new LlmError({ kind: 'network', message: 'x', retryable: true }),
    new LlmSchemaError({ message: 'x', issues: [], raw: '' }),
  ].map((error) => {
    const state = health(error)
    return state.state === 'ok' ? '' : state.reason
  })
  for (const reason of reasons) {
    assert.doesNotMatch(reason, /\b(the|error|failed|unavailable|invalid)\b/i, reason)
  }
})
