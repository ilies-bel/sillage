import test from 'node:test'
import assert from 'node:assert/strict'
import { AutoUpdate, updateFailureReason } from '../AutoUpdate.ts'
import type { AutoUpdaterLike } from '../AutoUpdate.ts'
import { UpdateStateSchema } from '../../../core/contracts/update.ts'

const T0 = 1_800_000_000_000

/**
 * A stand-in for electron-updater's autoUpdater, with the events under the
 * test's control. The real one fires them from network activity, which is
 * exactly the part that must not be in a unit test.
 */
class FakeUpdater implements AutoUpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowPrerelease = false
  checkCalls = 0
  downloadCalls = 0
  quitCalls: Array<{ silent: boolean | undefined; forceRunAfter: boolean | undefined }> = []
  checkRejects: Error | null = null
  downloadRejects: Error | null = null
  #handlers = new Map<string, Array<(payload: never) => void>>()

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    if (this.checkRejects) throw this.checkRejects
    return null
  }

  async downloadUpdate(): Promise<unknown> {
    this.downloadCalls += 1
    if (this.downloadRejects) throw this.downloadRejects
    return null
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitCalls.push({ silent: isSilent, forceRunAfter: isForceRunAfter })
  }

  on(event: string, listener: (payload: never) => void): unknown {
    const existing = this.#handlers.get(event) ?? []
    existing.push(listener)
    this.#handlers.set(event, existing)
    return this
  }

  fire(event: string, payload?: unknown): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      ;(handler as (value: unknown) => void)(payload)
    }
  }
}

const build = (over: { load?: () => AutoUpdaterLike } = {}) => {
  const fake = new FakeUpdater()
  const updater = new AutoUpdate({
    currentVersion: '0.1.1',
    clock: () => T0,
    load: over.load ?? (() => fake),
  })
  return { fake, updater }
}

test('a fresh updater knows its version and claims nothing else', () => {
  const { updater } = build()
  const state = updater.state()
  assert.equal(state.currentVersion, '0.1.1')
  assert.equal(state.phase, 'idle')
  assert.equal(state.availableVersion, null)
  assert.equal(state.checkedAt, null)
  // The state crosses IPC, so it has to satisfy the contract at every step.
  UpdateStateSchema.parse(state)
})

test('the product overrides all three of electron-updater’s defaults', async () => {
  const { fake, updater } = build()
  await updater.check()
  // Downloading is gated on the session, so the library must not do it itself.
  assert.equal(fake.autoDownload, false)
  // The rep's own quit is the one restart that is always safe.
  assert.equal(fake.autoInstallOnAppQuit, true)
  /*
   * The one whose absence fails silently: every release here is a prerelease,
   * and the default resolves versions through an endpoint that excludes them.
   * Left false, the updater reports « à jour » forever against a releases page
   * that visibly has a newer build on it.
   */
  assert.equal(fake.allowPrerelease, true)
})

test('no newer version leaves the app idle with a check time', async () => {
  const { fake, updater } = build()
  const pending = updater.check()
  fake.fire('update-not-available', { version: '0.1.1' })
  await pending
  const state = updater.state()
  assert.equal(state.phase, 'idle')
  assert.equal(state.checkedAt, T0)
})

test('a newer version is available but is not downloaded on its own', async () => {
  const { fake, updater } = build()
  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending
  assert.equal(updater.state().phase, 'available')
  assert.equal(updater.state().availableVersion, '0.2.0')
  // The whole point of autoDownload = false.
  assert.equal(fake.downloadCalls, 0)
})

test('download runs only from available, and reports progress', async () => {
  const { fake, updater } = build()

  // Nothing staged: a no-op rather than an error.
  await updater.download()
  assert.equal(fake.downloadCalls, 0)

  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending

  const downloading = updater.download()
  fake.fire('download-progress', { percent: 42.7 })
  assert.equal(updater.state().phase, 'downloading')
  assert.equal(updater.state().percent, 43)
  await downloading
  assert.equal(fake.downloadCalls, 1)
})

test('a server that lies about content-length cannot produce an invalid percent', async () => {
  const { fake, updater } = build()
  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending
  void updater.download()

  for (const reported of [-5, 0, 133.3, Number.NaN]) {
    fake.fire('download-progress', { percent: reported })
    const { percent } = updater.state()
    if (Number.isNaN(reported)) {
      // Math.round(NaN) is NaN, which the schema would reject at the boundary.
      assert.ok(percent === null || Number.isFinite(percent), 'percent must stay finite')
    } else {
      assert.ok(percent !== null && percent >= 0 && percent <= 100, `clamped ${reported}`)
    }
  }
})

test('a finished download is ready, and only then can it install', async () => {
  const { fake, updater } = build()

  assert.equal(await updater.install(), false, 'nothing staged')
  assert.equal(fake.quitCalls.length, 0)

  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending
  void updater.download()
  fake.fire('update-downloaded', { version: '0.2.0' })

  assert.equal(updater.state().phase, 'ready')
  assert.equal(updater.state().percent, 100)

  assert.equal(await updater.install(), true)
  assert.deepEqual(fake.quitCalls, [{ silent: false, forceRunAfter: true }])
})

test('a failed check never throws and says so in French', async () => {
  const { fake, updater } = build()
  fake.checkRejects = new Error('getaddrinfo ENOTFOUND github.com')
  const state = await updater.check()
  assert.equal(state.phase, 'error')
  assert.equal(state.reason, 'serveur de mise à jour injoignable')
  assert.equal(state.checkedAt, T0)
})

test('a failed download never throws', async () => {
  const { fake, updater } = build()
  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending
  fake.downloadRejects = new Error('sha512 checksum mismatch')
  const state = await updater.download()
  assert.equal(state.phase, 'error')
  assert.match(state.reason ?? '', /corrompu/)
})

test('an error event from the library lands as state, not as a crash', async () => {
  const { fake, updater } = build()
  await updater.check()
  fake.fire('error', new Error('Cannot find latest.yml in the latest release artifacts'))
  assert.equal(updater.state().phase, 'error')
  assert.equal(updater.state().reason, 'aucune mise à jour publiée pour cette version')
})

/*
 * The dev run, and the case this repo is in until a release carries update
 * metadata. `disabled` is a statement — a build that cannot update itself must
 * not report « à jour ».
 */
test('a library that will not load disables updates instead of failing', async () => {
  const { updater } = build({
    load: () => {
      throw new Error('Cannot find module electron-updater')
    },
  })
  const state = await updater.check()
  assert.equal(state.phase, 'disabled')
  assert.ok(state.reason)
  assert.equal(await updater.install(), false)
  UpdateStateSchema.parse(state)
})

test('a listener that throws does not stop the others or the updater', async () => {
  const { fake, updater } = build()
  const seen: string[] = []
  updater.onChanged(() => {
    throw new Error('renderer went away')
  })
  updater.onChanged((state) => seen.push(state.phase))
  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending
  assert.ok(seen.includes('available'))
})

test('unsubscribing stops delivery', async () => {
  const { fake, updater } = build()
  let calls = 0
  const off = updater.onChanged(() => void (calls += 1))
  const pending = updater.check()
  fake.fire('update-available', { version: '0.2.0' })
  await pending
  const before = calls
  off()
  fake.fire('update-downloaded', { version: '0.2.0' })
  assert.equal(calls, before)
})

test('an unrecognised failure keeps its own message rather than a generic one', () => {
  assert.equal(updateFailureReason(new Error('EPERM: operation not permitted')), 'EPERM: operation not permitted')
  assert.equal(updateFailureReason('not an error'), 'erreur inconnue')
})
