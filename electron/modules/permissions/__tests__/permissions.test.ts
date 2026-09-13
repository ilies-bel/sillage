/**
 * The Windows half of this module is written on a Mac, which is the whole
 * reason these exist (HR-2). The platform is a parameter everywhere in
 * `deepLinks.ts`, so both tables are checked from either host — the tests are
 * the only place a Windows deep link is ever read before a rep reads it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CapturePermissionsSchema } from '../../../core/contracts/permissions.ts'
import type { CapturePermissions, PermissionScope } from '../../../core/contracts/permissions.ts'
import { captureVerdict, scopeToOpen, refusalReasons } from '../../../core/contracts/permissionRows.ts'
import { CapturePermissionsReader, UNREAD_PERMISSIONS } from '../index.ts'
import { isGoverned, settingsUrlFor } from '../deepLinks.ts'

const reader = (
  platform: NodeJS.Platform,
  statuses: Partial<Record<'microphone' | 'screen', string>>,
  opened: string[] = [],
) =>
  new CapturePermissionsReader({
    platform,
    media: { getMediaAccessStatus: (kind) => statuses[kind] ?? 'not-determined' },
    openExternal: async (url) => {
      opened.push(url)
    },
  })

const rowFor = (permissions: CapturePermissions, scope: PermissionScope) =>
  permissions.rows.find((row) => row.scope === scope)

test('macOS sends each scope to its own pane, and they are not the same pane', () => {
  assert.equal(
    settingsUrlFor('darwin', 'microphone'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  )
  assert.equal(
    settingsUrlFor('darwin', 'systemAudio'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  )
})

test('Windows has a microphone pane and no screen-recording one at all', () => {
  assert.equal(settingsUrlFor('win32', 'microphone'), 'ms-settings:privacy-microphone')
  assert.equal(settingsUrlFor('win32', 'systemAudio'), null)
  assert.equal(isGoverned('win32', 'systemAudio'), false)
  assert.equal(isGoverned('win32', 'microphone'), true)
})

test('the answer always parses, on both platforms', async () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const permissions = await reader(platform, {}).read()
    CapturePermissionsSchema.parse(permissions)
  }
})

test('Windows system audio is notRequired — never granted', async () => {
  const permissions = await reader('win32', { microphone: 'granted' }).read()
  const row = rowFor(permissions, 'systemAudio')
  assert.equal(row?.status, 'notRequired')
  assert.equal(row?.canOpenSettings, false)
  // And that is still « prêt »: nothing is unsettled.
  assert.equal(captureVerdict(permissions), 'ready')
})

test('Windows « micro bloqué »: danger, a sentence, and the privacy pane behind it', async () => {
  const permissions = await reader('win32', { microphone: 'denied' }).read()
  assert.equal(captureVerdict(permissions), 'denied')
  assert.equal(scopeToOpen(permissions), 'microphone')
  const [reason] = refusalReasons(permissions)
  assert.match(reason ?? '', /Windows/)
  // One refusal, not two: the ungoverned scope cannot contribute one.
  assert.equal(refusalReasons(permissions).length, 1)
})

test('macOS « à autoriser » is a first run, not a refusal', async () => {
  const permissions = await reader('darwin', {}).read()
  assert.equal(captureVerdict(permissions), 'toGrant')
  assert.equal(refusalReasons(permissions).length, 0)
  assert.equal(scopeToOpen(permissions), 'microphone')
})

test('macOS « refusé » names the pane it was refused in, per scope', async () => {
  const permissions = await reader('darwin', { microphone: 'granted', screen: 'denied' }).read()
  assert.equal(captureVerdict(permissions), 'denied')
  // The refused scope, not the first one in the list.
  assert.equal(scopeToOpen(permissions), 'systemAudio')
  assert.match(refusalReasons(permissions)[0] ?? '', /Enregistrement de l’écran/)
})

test('a refusal outranks an unasked scope — the refusal is what stands in the way', async () => {
  const permissions = await reader('darwin', { microphone: 'denied' }).read()
  assert.equal(captureVerdict(permissions), 'denied')
  assert.equal(scopeToOpen(permissions), 'microphone')
})

test('macOS « prêt » is both scopes granted, and offers nothing to open', async () => {
  const permissions = await reader('darwin', { microphone: 'granted', screen: 'granted' }).read()
  assert.equal(captureVerdict(permissions), 'ready')
  assert.equal(scopeToOpen(permissions), null)
})

test('restricted is a refusal — an MDM policy the rep cannot lift is still a no', async () => {
  const permissions = await reader('darwin', { microphone: 'restricted', screen: 'granted' }).read()
  assert.equal(captureVerdict(permissions), 'denied')
})

test('a machine whose status cannot be read is toGrant, never granted', async () => {
  // An Electron without `getMediaAccessStatus`, or a kind it no longer accepts.
  // « we could not find out » draws a dot and a way to the pane; it never
  // claims a grant the app does not have.
  const permissions = await new CapturePermissionsReader({
    platform: 'darwin',
    media: {},
    openExternal: async () => {},
  }).read()
  CapturePermissionsSchema.parse(permissions)
  assert.equal(captureVerdict(permissions), 'toGrant')
})

test('a platform that governs neither scope is ready with nothing to open', async () => {
  // Linux is not a target (HR-2) and is not a lie either: no pane, so no
  // control, and nothing unsettled to hold a rep on the first screen.
  const permissions = await new CapturePermissionsReader({
    platform: 'linux',
    media: {},
    openExternal: async () => {},
  }).read()
  CapturePermissionsSchema.parse(permissions)
  assert.equal(captureVerdict(permissions), 'ready')
  assert.equal(scopeToOpen(permissions), null)
})

test('openSettings opens the scope’s own URL', async () => {
  const opened: string[] = []
  const result = await reader('darwin', {}, opened).openSettings('systemAudio')
  assert.equal(result.opened, true)
  assert.deepEqual(opened, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ])
})

test('openSettings with no pane answers a French sentence, never a rejection', async () => {
  const result = await reader('win32', {}).openSettings('systemAudio')
  assert.equal(result.opened, false)
  assert.match(result.reason ?? '', /réglage/)
})

test('a throwing shell is an answer, not a crash across IPC', async () => {
  const result = await new CapturePermissionsReader({
    platform: 'darwin',
    media: {},
    openExternal: async () => {
      throw new Error('rien pour ouvrir cette URL')
    },
  }).openSettings('microphone')
  assert.equal(result.opened, false)
  assert.equal(result.reason, 'rien pour ouvrir cette URL')
})

test('the unwired fallback claims nothing', () => {
  CapturePermissionsSchema.parse(UNREAD_PERMISSIONS)
  assert.equal(captureVerdict(UNREAD_PERMISSIONS), 'toGrant')
  assert.equal(scopeToOpen(UNREAD_PERMISSIONS), null)
})

test('the reader caches nothing — a rep who flips a switch gets the new answer', async () => {
  let status = 'denied'
  const live = new CapturePermissionsReader({
    platform: 'darwin',
    media: { getMediaAccessStatus: () => status },
    openExternal: async () => {},
  })
  assert.equal(captureVerdict(await live.read()), 'denied')
  status = 'granted'
  assert.equal(captureVerdict(await live.read()), 'ready')
})
