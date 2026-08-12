import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AutoUpdate,
  DOWNLOAD_ATTEMPTS,
  DOWNLOAD_BACKOFF_MS,
  isRetryableDownloadFailure,
  updateFailureReason,
} from '../AutoUpdate.ts'
import type { AutoUpdaterLike } from '../AutoUpdate.ts'
import { UpdateStateSchema } from '../../../core/contracts/update.ts'
import type { DiagInput } from '../../../core/contracts/diagnostics.ts'

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

  /** Reject the first N calls and then succeed. `0` means never fail. */
  downloadFailsTimes = 0

  async downloadUpdate(): Promise<unknown> {
    this.downloadCalls += 1
    const transient = this.downloadCalls <= this.downloadFailsTimes
    const error = transient ? new Error('socket hang up') : this.downloadRejects
    if (error) {
      /*
       * Both, and in this order — which is the whole reason the retry needs a
       * suppression flag. `AppUpdater.downloadUpdate` wraps the task in a
       * `.catch` that calls `dispatchError` (emitting `error`) before it
       * rethrows, so every failed transfer reports itself twice.
       */
      this.fire('error', error)
      throw error
    }
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
  /** Every backoff the module asked for, in order. Never actually waited. */
  const waits: number[] = []
  const logged: DiagInput[] = []
  const updater = new AutoUpdate({
    currentVersion: '0.1.1',
    clock: () => T0,
    load: over.load ?? (() => fake),
    sleep: async (ms) => void waits.push(ms),
    diagnostics: { record: (input) => void logged.push(input) },
  })
  return { fake, updater, waits, logged }
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

/*
 * ── The retry ─────────────────────────────────────────────────────────────
 *
 * Reported from a real install: the update « had to be done three times » and
 * one attempt died mid-download. Nothing underneath helps — `doDownload` in
 * builder-util-runtime has no retry, and `executeDownload` deletes the partial
 * file — so one dropped socket in a 110 MB differential transfer (or a 560 MB
 * full one) threw the whole thing away and put a French error in front of a rep
 * whose wifi had blinked.
 */

const arrive = async (fake: FakeUpdater, updater: AutoUpdate, version = '0.2.0'): Promise<void> => {
  const pending = updater.check()
  fake.fire('update-available', { version })
  await pending
}

test('a transfer that drops is retried, and the rep is never shown the blip', async () => {
  const { fake, updater, waits } = build()
  await arrive(fake, updater)

  const seen: string[] = []
  updater.onChanged((state) => seen.push(state.phase))

  fake.downloadFailsTimes = 2
  const state = await updater.download()

  assert.equal(fake.downloadCalls, 3, 'gave up before the last attempt')
  assert.equal(state.phase, 'downloading', 'a recovered download is not an error')
  // The failure is dispatched as an event *and* as a rejection; neither may
  // reach the panel while an attempt is still to come.
  assert.ok(!seen.includes('error'), `error surfaced during a recovery: ${seen.join(' → ')}`)
  assert.deepEqual(waits, DOWNLOAD_BACKOFF_MS)
})

test('the attempts a recovered download took are still in the diagnostics', async () => {
  const { fake, updater, logged } = build()
  await arrive(fake, updater)
  fake.downloadFailsTimes = 2
  await updater.download()

  const retries = logged.filter((event) => event.code === 'update.download.retry')
  assert.equal(retries.length, 2, 'a silent recovery must not be an invisible one')
  assert.equal(logged.filter((event) => event.code === 'update.download.failed').length, 0)
})

test('after the last attempt the rep is told, once', async () => {
  const { fake, updater, logged } = build()
  await arrive(fake, updater)

  const errors: string[] = []
  updater.onChanged((state) => {
    if (state.phase === 'error') errors.push(state.reason ?? '')
  })

  fake.downloadFailsTimes = DOWNLOAD_ATTEMPTS
  const state = await updater.download()

  assert.equal(fake.downloadCalls, DOWNLOAD_ATTEMPTS)
  assert.equal(state.phase, 'error')
  // Twice would be the library's event plus our own rejection handler.
  assert.equal(errors.length, 1, `duplicated verdict: ${errors.join(' | ')}`)
  assert.equal(logged.filter((event) => event.code === 'update.download.failed').length, 1)
})

test('a missing asset is an answer, not a hiccup, and is not retried', async () => {
  const { fake, updater, waits } = build()
  await arrive(fake, updater)
  fake.downloadRejects = new Error('Cannot download "https://…/Sillage-Setup-0.2.0.exe", status 404: Not Found')

  const state = await updater.download()

  assert.equal(fake.downloadCalls, 1, 'retried a 404')
  assert.deepEqual(waits, [], 'waited on a permanent failure')
  assert.equal(state.phase, 'error')
})

test('the retry note says why the bar went back to zero', async () => {
  const { fake, updater } = build()
  await arrive(fake, updater)

  const notes: Array<string | null> = []
  updater.onChanged((state) => {
    if (state.phase === 'downloading') notes.push(state.reason)
  })

  fake.downloadFailsTimes = 1
  await updater.download()

  assert.equal(notes[0], null, 'the first attempt is not a retry')
  // Nothing resumes underneath, so percent restarts. Unexplained, that reads as
  // the app being broken.
  assert.match(notes[1] ?? '', /reprise/)
  assert.ok(notes.every((note) => note === null || /essai 2 sur 3/.test(note)))
  UpdateStateSchema.parse(updater.state())
})

test('a broken transfer can be resumed without a second check', async () => {
  const { fake, updater } = build()
  await arrive(fake, updater)
  fake.downloadRejects = new Error('net::ERR_CONNECTION_RESET')
  await updater.download()
  assert.equal(updater.state().phase, 'error')
  // The check that found it was fine; only the transfer was not, and
  // electron-updater keeps its `updateInfoAndProvider` across the failure.
  assert.equal(updater.state().availableVersion, '0.2.0')

  const checksBefore = fake.checkCalls
  fake.downloadRejects = null
  const state = await updater.download()

  assert.equal(fake.checkCalls, checksBefore, 'made the rep pay for a check it did not need')
  assert.equal(state.phase, 'downloading')
})

test('an error with nothing found stays a check, not a download', async () => {
  const { fake, updater } = build()
  fake.checkRejects = new Error('getaddrinfo ENOTFOUND github.com')
  await updater.check()
  assert.equal(updater.state().availableVersion, null)
  // Nothing to resume: `download` must not invent a transfer out of an error.
  await updater.download()
  assert.equal(fake.downloadCalls, 0)
})

test('what counts as worth another try', () => {
  // The default is yes: an unrecognised mid-transfer failure is far more often
  // a network one than a permanent one.
  assert.equal(isRetryableDownloadFailure(new Error('socket hang up')), true)
  assert.equal(isRetryableDownloadFailure(new Error('sha512 checksum mismatch')), true)
  assert.equal(isRetryableDownloadFailure(new Error('response has been aborted by the server')), true)
  // These are statements about the release. Retrying turns a clear message slow.
  assert.equal(isRetryableDownloadFailure(new Error('status 404: Not Found')), false)
  assert.equal(
    isRetryableDownloadFailure(new Error('New version 0.2.0 is not signed by the application owner: …')),
    false,
  )
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
