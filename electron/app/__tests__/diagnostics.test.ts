/**
 * The diagnostics sink, composed with the real store.
 *
 * It lives under `app/` rather than beside the module, and that is the boundary
 * rule doing its job rather than an inconvenience: `modules/diagnostics` may not
 * import `modules/store`, so a test that wires the two together is testing
 * composition — which is `app/`'s responsibility. The module itself depends only
 * on the `DiagLog` port; this is the test that the port is satisfied by the
 * thing the orchestrator actually passes.
 *
 * Ships in step 1 because every later step is debugged through it
 * (ARCHITECTURE.md §6).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Diagnostics } from '../../modules/diagnostics/index.ts'
import { Store } from '../../modules/store/index.ts'
import { APP_SCOPE } from '../../core/contracts/events.ts'
import type { DiagEnvironment } from '../../core/contracts/diagnostics.ts'

const environment: DiagEnvironment = {
  appVersion: '3.0.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  electron: '43.1.0',
  node: '24.18.0',
  nativeArch: 'x64',
}

const DAY = 86_400_000

const open = (startAt = 1_000_000) => {
  let now = startAt
  const clock = () => now
  const store = new Store(':memory:', clock)
  let n = 0
  const diagnostics = new Diagnostics(store, {
    environment,
    clock,
    mintId: () => `d${++n}`,
  })
  return { store, diagnostics, advance: (ms: number) => (now += ms), at: () => now }
}

test('an event lands in the same log as everything else', () => {
  const { store, diagnostics } = open()
  const event = diagnostics.record({
    severity: 'warn',
    code: 'capture.device.lost',
    module: 'capture',
    message: 'périphérique retiré',
    detail: { deviceIndex: 3 },
  })

  assert.equal(event.id, 'd1')
  const stored = store.log.read(APP_SCOPE)
  assert.equal(stored.length, 1)
  assert.equal(stored[0]?.event.type, 'diag')
  store.close()
})

test('an event with a meeting is scoped to it, so Historique can show it', () => {
  const { store, diagnostics } = open()
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
  diagnostics.record({
    severity: 'error',
    code: 'crm.push.failed',
    module: 'crm',
    message: 'VSA 503',
    meetingId: 'm1',
  })

  assert.equal(store.log.read(APP_SCOPE).length, 0)
  assert.equal(store.log.read('m1').length, 2)
  assert.equal(diagnostics.recent()[0]?.meetingId, 'm1')
  store.close()
})

test('the rolling purge takes diagnostics past the window and nothing else', () => {
  const { store, diagnostics, advance } = open()
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
  diagnostics.record({ severity: 'info', code: 'a.b', module: 'x', message: 'vieux' })

  advance(91 * DAY)
  diagnostics.record({ severity: 'info', code: 'a.b', module: 'x', message: 'récent' })

  assert.equal(diagnostics.purge(), 1)
  assert.deepEqual(
    diagnostics.recent().map((e) => e.message),
    ['récent'],
  )
  assert.equal(store.projections.getMeeting('m1')?.title, 'Acme')
  store.close()
})

test('the redacted bundle is the one the default button writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'diag-'))
  try {
    const { store, diagnostics } = open()
    diagnostics.record({
      severity: 'error',
      code: 'extract.failed',
      module: 'extract',
      message: 'échec sur camille.leroy@acme-industries.fr',
      detail: { transcript: 'TJM de 520 euros', attempt: 1 },
    })

    const { path, events } = diagnostics.writeBundle('redacted', directory)
    assert.equal(events, 1)

    const lines = readFileSync(path, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2, 'a header line, then one event per line')
    assert.deepEqual(JSON.parse(lines[0] ?? '{}').environment, environment)

    const body = lines[1] ?? ''
    assert.ok(!body.includes('camille.leroy@acme-industries.fr'))
    assert.ok(!body.includes('TJM de 520 euros'))
    assert.ok(body.includes('extract.failed'))
    assert.ok(body.includes('"attempt":1'))

    const full = diagnostics.writeBundle('full', directory)
    assert.ok(readFileSync(full.path, 'utf8').includes('TJM de 520 euros'))
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
