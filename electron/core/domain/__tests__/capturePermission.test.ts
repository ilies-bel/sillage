/**
 * The permission the product cannot record without.
 *
 * What these hold is the distinction the old code did not make at all: one
 * missing channel is not the same failure as the other, and neither is the same
 * as both. On macOS the screen-recording prompt is the one people refuse, and
 * refusing it costs the far end of every call while the recording looks
 * perfectly healthy — so the sentence has to name *which* side goes missing,
 * and the remedy has to match what the OS will actually do next.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actionFor,
  capturePermissionHealth,
  canPrompt,
  type CaptureAccess,
} from '../capturePermission.ts'

const NOW = 1_700_000_000_000
const access = (over: Partial<CaptureAccess> = {}): CaptureAccess => ({
  microphone: 'granted',
  screen: 'granted',
  ...over,
})

test('a machine with both permissions has nothing to say', () => {
  // `null`, not `{ state: 'ok' }` — the native module failing to load is a
  // different and worse fact about capture, and a permission probe that
  // returned `ok` would paint over it.
  assert.equal(capturePermissionHealth(access(), NOW), null)
})

test('a host that cannot answer is not a host that refused', () => {
  // Windows has nothing to grant and Linux answers nothing at all. Treating
  // that as a refusal would put a permission warning in front of every rep on
  // the primary platform (HR-2).
  assert.equal(capturePermissionHealth(access({ microphone: 'unknown', screen: 'unknown' }), NOW), null)
})

test('losing the system audio is degraded, and the sentence names what is lost', () => {
  const health = capturePermissionHealth(access({ screen: 'not-determined' }), NOW)
  assert.ok(health)
  // Not `down`: the meeting is still recorded and a transcript still exists.
  // The rep is on it and the client is not, which is the thing to say.
  assert.equal(health.state, 'degraded')
  assert.match(health.reason ?? '', /le client ne sera pas enregistré, vous seul le serez/)
  assert.equal(health.retryable, true)
})

test('losing the microphone is the mirror image, and says so', () => {
  const health = capturePermissionHealth(access({ microphone: 'not-determined' }), NOW)
  assert.ok(health && health.state !== 'ok')
  assert.equal(health.state, 'degraded')
  assert.match(health.reason, /vous ne serez pas enregistré, seul le client le sera/)
})

test('losing both is the only case that is down', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'denied', screen: 'denied' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  assert.equal(health.state, 'down')
  assert.match(health.reason, /une réunion ne serait pas enregistrée/)
})

test('a permission already refused sends the rep to the system settings', () => {
  // The OS will not prompt twice. A screen that keeps offering « Autoriser »
  // here is offering a button that silently does nothing (DEC-26).
  const health = capturePermissionHealth(access({ screen: 'denied' }), NOW)
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /réautorisez Sillage dans les réglages de confidentialité/)
  assert.equal(actionFor('denied'), 'open')
  assert.equal(canPrompt('denied'), false)
})

test('a permission never asked for is asked for', () => {
  const health = capturePermissionHealth(access({ screen: 'not-determined' }), NOW)
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /Autorisez-le pour que Sillage puisse l’enregistrer/)
  assert.equal(actionFor('not-determined'), 'ask')
})

test('a managed device says so, and offers nothing', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'restricted', screen: 'restricted' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /géré et l’autorisation est bloquée par votre service informatique/)
  // No retry: neither the prompt nor the settings pane can change a profile
  // the rep does not control, and a button that cannot work is worse than the
  // sentence alone.
  assert.equal(health.retryable, false)
  assert.equal(actionFor('restricted'), 'nothing')
})

test('one restricted channel beside one askable channel still offers the retry', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'restricted', screen: 'not-determined' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  // Half of it is fixable, so the control is worth having — and the sentence
  // is the askable one's, because that is the half a press can change.
  assert.equal(health.retryable, true)
  assert.equal(health.state, 'down')
})
