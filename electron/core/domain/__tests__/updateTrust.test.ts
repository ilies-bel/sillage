/**
 * An update this machine cannot verify is not an update it should install.
 *
 * `electron-updater` runs the installer it downloaded; on Windows it checks the
 * Authenticode signature *if* it has an expected publisher to check against, and
 * this build declares none — so the check is skipped rather than failed, and the
 * rep gets a one-click « Installer et redémarrer » that executes whatever the
 * feed served.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { updateTrust } from '../updateTrust.ts'

test('an unsigned Windows build cannot verify an update, and says so', () => {
  const verdict = updateTrust('win32', {})
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason ?? '', /n’est pas signée/)
  // The sentence names the remedy, because a degradation with no way forward is
  // the dead end DEC-26 forbids.
  assert.match(verdict.reason ?? '', /à la main/)
})

test('a declared publisher is what lifts it', () => {
  assert.deepEqual(updateTrust('win32', { publisherName: 'Iliès Beldjilali' }), {
    ok: true,
    reason: null,
  })
  // electron-builder takes a list too.
  assert.equal(updateTrust('win32', { publisherName: ['A', 'B'] }).ok, true)
  assert.equal(updateTrust('win32', { certificateFile: 'build/cert.pfx' }).ok, true)
})

test('an empty string is not a publisher', () => {
  // The failure this defends against is a config that *looks* configured — a
  // key present and blank is exactly what a half-finished signing setup leaves.
  assert.equal(updateTrust('win32', { publisherName: '   ' }).ok, false)
  assert.equal(updateTrust('win32', { certificateFile: '' }).ok, false)
  assert.equal(updateTrust('win32', { publisherName: [] }).ok, false)
  assert.equal(updateTrust('win32', { publisherName: null }).ok, false)
})

test('macOS is verified by the OS and needs no rule here', () => {
  assert.deepEqual(updateTrust('darwin', {}), { ok: true, reason: null })
  assert.deepEqual(updateTrust('linux', null), { ok: true, reason: null })
})
