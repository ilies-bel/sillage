/**
 * DEC-27's guarantee, as a test rather than a claim.
 *
 * "This export contains no client conversation content" is exactly the sort of
 * promise that is true when it is written and false eighteen modules later. A
 * bundle full of prospect transcripts sitting in a support mailbox is a GDPR
 * incident, and the redacted export is the one the button reaches first.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDiagBundle,
  redactDetail,
  redactDiagEvent,
  redactMessage,
} from '../redactDiagnostics.ts'
import type { DiagEnvironment, DiagEvent } from '../../contracts/diagnostics.ts'

const environment: DiagEnvironment = {
  appVersion: '3.0.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  electron: '43.1.0',
  node: '24.18.0',
  nativeArch: 'x64',
}

const CONTENT = [
  'On est plutôt sur un TJM de 520 euros',
  'camille.leroy@acme-industries.fr',
  'Acme Industries',
]

const leaky: DiagEvent = {
  id: 'd1',
  ts: 1000,
  severity: 'error',
  code: 'extract.schema.rejected',
  module: 'extract',
  message:
    'validation failed for camille.leroy@acme-industries.fr on "On est plutôt sur un TJM de 520 euros" see https://api.example.fr/x?token=abc',
  detail: {
    transcript: 'On est plutôt sur un TJM de 520 euros',
    attendees: ['camille.leroy@acme-industries.fr'],
    client: { name: 'Acme Industries' },
    durationMs: 4200,
    attempt: 2,
    provider: 'azure-speech-fc',
    ok: false,
    nothing: null,
  },
  meetingId: 'm-42',
}

const serialised = (value: unknown) => JSON.stringify(value)

test('a redacted event carries none of the conversation content', () => {
  const out = serialised(redactDiagEvent(leaky))
  for (const secret of CONTENT) {
    assert.ok(!out.includes(secret), `leaked: ${secret}`)
  }
  assert.ok(!out.includes('token=abc'))
})

test('detail keeps only what cannot carry prose', () => {
  const out = redactDetail(leaky.detail)
  assert.equal(out.durationMs, 4200)
  assert.equal(out.attempt, 2)
  assert.equal(out.ok, false)
  assert.equal(out.nothing, null)
  assert.equal(out.provider, 'azure-speech-fc')

  // Dropped, but described — "a 37-character string was here" is usually as
  // diagnostic as the string and always safe.
  assert.equal(out.transcript, '[string:37]')
  assert.equal(out.attendees, '[array:1]')
  assert.equal(out.client, '[object:1]')
})

test('an address is content even when it is identifier-shaped', () => {
  assert.equal(redactDetail({ who: 'a.b@c.fr' }).who, '[string:8]')
  assert.equal(redactDetail({ who: 'azure-speech' }).who, 'azure-speech')
})

test('an unknown key added by a future module is dropped, not kept', () => {
  // The rule is an allowlist on purpose: a denylist would have to anticipate
  // every field a module invents, and it would be wrong by omission.
  const out = redactDetail({ someFieldNobodyHasWrittenYet: 'un client a dit quelque chose' })
  assert.equal(out.someFieldNobodyHasWrittenYet, '[string:29]')
})

test('messages lose addresses, URLs and quoted runs, and are capped', () => {
  assert.equal(redactMessage('contact bob@example.fr now'), 'contact [email] now')
  assert.equal(redactMessage('see https://x.fr/a?b=c please'), 'see [url] please')
  assert.equal(redactMessage('rejected "un extrait de conversation"'), 'rejected [quoted]')
  assert.equal(redactMessage('x'.repeat(500)).length, 240)
})

test('the meeting id survives — it says which call, not who was on it', () => {
  assert.equal(redactDiagEvent(leaky).meetingId, 'm-42')
})

test('the full bundle keeps everything, and says which mode it is', () => {
  const redacted = buildDiagBundle('redacted', [leaky], environment, 2000)
  const full = buildDiagBundle('full', [leaky], environment, 2000)

  assert.equal(redacted.mode, 'redacted')
  assert.deepEqual(full.events, [leaky])
  assert.notDeepEqual(redacted.events, full.events)
  assert.deepEqual(redacted.environment, environment)
})

test('redaction is pure — the input event is not mutated', () => {
  const before = serialised(leaky)
  redactDiagEvent(leaky)
  buildDiagBundle('redacted', [leaky], environment, 2000)
  assert.equal(serialised(leaky), before)
})
