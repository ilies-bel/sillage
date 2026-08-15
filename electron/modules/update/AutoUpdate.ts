/**
 * The only place `electron-updater` exists.
 *
 * One external boundary: the GitHub release feed. Everything this module knows
 * is what that feed said and what the download did. It knows nothing about
 * meetings, and `app/` never lets it — the policy lives in
 * `core/domain/updateGate.ts` and the orchestration in `main.ts`.
 *
 * ## Fails open, in the strongest sense (DEC-26)
 *
 * Nothing here throws. Not a missing `latest.yml`, not a 404, not a DNS
 * failure, not a corrupt download, not `electron-updater` refusing to load at
 * all. Every one of those resolves to `phase: 'error'` with a French reason and
 * the app carries on recording meetings on the version it already has. An
 * updater that can break the product it updates is worse than no updater, and
 * this one is downstream of everything.
 *
 * ## Why the library is injected
 *
 * `electron-updater` reaches for `app` at import time, so a plain top-level
 * import makes this file unloadable under `node --test`. Same reasoning as
 * `modules/identity/vault.ts` and `modules/capture/nativeModule.ts`: declare
 * the narrow shape, resolve it lazily, let a test pass its own.
 */
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { UpdatePort, UpdateState } from '../../core/contracts/update.ts'
import { updatesUnavailable } from '../../core/contracts/update.ts'

/** What electron-updater publishes on `update-available` / `update-downloaded`. */
export interface UpdateInfoLike {
  version: string
}

export interface ProgressLike {
  percent: number
}

/**
 * The slice of `electron-updater`'s autoUpdater this file uses. Declared so
 * `any` stops at the edge of the module rather than spreading through it.
 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: ProgressLike) => void): unknown
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type AutoUpdaterLoader = () => AutoUpdaterLike

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'erreur inconnue'

export interface AutoUpdateOptions {
  /** `app.getVersion()`. Injected so the module never imports Electron. */
  currentVersion: string
  diagnostics?: DiagRecorder
  clock?: () => number
  /** Defaults to `require('electron-updater').autoUpdater`. */
  load?: AutoUpdaterLoader
  /** The backoff wait. Injected so a test does not spend it. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * How many times a download is attempted before the rep is told it failed.
 *
 * Not a taste decision — a reading of what is underneath. `builder-util-runtime`'s
 * `HttpExecutor.doDownload` has **no retry at all**: the first socket error,
 * timeout or aborted response calls back with the error, and
 * `AppUpdater.executeDownload` answers that by deleting the temp file. There is
 * no resume, so a hiccup at 90 % costs the whole transfer.
 *
 * That transfer is ~110 MB differential (measured 0.1.2 → 0.1.3: 453 MB copied
 * from the previously installed setup exe, 107 MB fetched over ~28 range
 * requests) and 560 MB when the differential path is unavailable. Any one of
 * those requests failing rejects all of it. On a laptop on hotel wifi, one
 * attempt is not a policy.
 *
 * Three attempts, because the failure this covers is transient by definition:
 * a fourth is a different problem and the rep should be told rather than made
 * to watch.
 */
export const DOWNLOAD_ATTEMPTS = 3

/** Waited before attempt 2 and attempt 3. Long enough for wifi to come back. */
export const DOWNLOAD_BACKOFF_MS = [5_000, 30_000]

/**
 * Whether trying the identical download again could plausibly work.
 *
 * The default is yes, deliberately: an unrecognised failure during a transfer
 * is far more often a network one than a permanent one, and the cost of a
 * pointless retry is thirty seconds nobody is watching. Only the failures that
 * are *statements about the release* are excluded — a missing asset and a
 * rejected signature are answers, not accidents, and retrying them turns a
 * clear message into a slow one.
 */
export const isRetryableDownloadFailure = (error: unknown): boolean => {
  const raw = messageOf(error)
  if (/status 404|ERR_UPDATER_INVALID_SIGNATURE|is not signed|Web Installers are disabled/i.test(raw)) {
    return false
  }
  return true
}

/**
 * Turns whatever electron-updater threw into something a rep can act on.
 *
 * The library's own messages are English stack-adjacent strings ("Cannot find
 * latest.yml in the latest release artifacts"), which is precisely the class of
 * text that must not reach a French UI. Three cases are worth naming; the rest
 * keeps the original, because an unrecognised failure with its real message is
 * more useful to a support conversation than a generic one.
 */
export const updateFailureReason = (error: unknown): string => {
  const raw = messageOf(error)
  // No release has been published yet, or the release carries no `latest.yml`.
  // The likeliest state of this repo, and not an error the rep caused.
  if (/latest\.yml|no published versions|404/i.test(raw)) {
    return 'aucune mise à jour publiée pour cette version'
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|network/i.test(raw)) {
    return 'serveur de mise à jour injoignable'
  }
  if (/sha512|checksum|integrity/i.test(raw)) {
    return 'téléchargement corrompu — nouvelle tentative au prochain démarrage'
  }
  return raw
}

export class AutoUpdate implements UpdatePort {
  #state: UpdateState
  #diagnostics: DiagRecorder
  #clock: () => number
  #load: AutoUpdaterLoader
  #updater: AutoUpdaterLike | null = null
  #listeners = new Set<(state: UpdateState) => void>()
  /** Set once the load has failed, so a check per hour is not a require per hour. */
  #broken: string | null = null
  /**
   * True for the whole of `download()`, including the waits between attempts.
   *
   * `AppUpdater.downloadUpdate` reports a failure *twice* — it emits `error`
   * and then rejects the promise. Without this the panel would flip to « échec »
   * for a moment between two attempts that are still going to succeed, and the
   * diagnostics would carry two entries for one transfer.
   */
  #downloading = false
  #sleep: (ms: number) => Promise<void>

  constructor(options: AutoUpdateOptions) {
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => void setTimeout(resolve, ms)))
    this.#load = options.load ?? (() => require('electron-updater').autoUpdater as AutoUpdaterLike)
    this.#state = {
      phase: 'idle',
      currentVersion: options.currentVersion,
      availableVersion: null,
      percent: null,
      reason: null,
      checkedAt: null,
    }
  }

  state(): UpdateState {
    return this.#state
  }

  onChanged(listener: (state: UpdateState) => void): () => void {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  #emit(patch: Partial<UpdateState>): void {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) {
      // A renderer that has gone away must not take the updater with it.
      try {
        listener(this.#state)
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Record a failure, and — unless it is one an in-flight retry owns — show it.
   *
   * `show: false` is not "swallow": the diagnostic is written either way, so a
   * download that succeeded on the third try still leaves the two attempts it
   * took behind it in the log. It only withholds the *state*, which is the
   * thing a rep reads as a verdict.
   */
  #fail(code: string, error: unknown, options: { show?: boolean } = {}): UpdateState {
    const reason = updateFailureReason(error)
    this.#diagnostics.record({
      severity: 'warn',
      code,
      module: 'update',
      message: reason,
      detail: { raw: messageOf(error) },
    })
    if (options.show !== false) {
      this.#emit({ phase: 'error', reason, percent: null, checkedAt: this.#clock() })
    }
    return this.#state
  }

  /**
   * Resolve the library and subscribe, once.
   *
   * Returns null when it cannot be had — an unpacked dev run, a build with no
   * `app-update.yml`, a platform electron-updater declines. The caller turns
   * that into `disabled`, which is a statement, not a failure.
   */
  #lib(): AutoUpdaterLike | null {
    if (this.#updater) return this.#updater
    if (this.#broken) return null
    try {
      const updater = this.#load()
      /*
       * Both of these are the product's decision rather than the library's
       * default, and both are load-bearing.
       *
       * `autoDownload = false`: see `UpdatePort`. The gate decides when half a
       * gigabyte may cross the wire, because the default moment is during a
       * call.
       *
       * `autoInstallOnAppQuit = true`: the one restart that is always safe is
       * the one the rep chose. If they quit for the day with an update staged,
       * it applies then and there is nothing to click tomorrow.
       */
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = true
      /*
       * Load-bearing, and silently so.
       *
       * With the default `allowPrerelease = false`, electron-updater resolves
       * the newest version through GitHub's `/releases/latest` — an endpoint
       * that **excludes prereleases**. v0.1.0…v0.1.3 were all cut with
       * `--prerelease`, so an installed one of those would have found nothing
       * at all, on a repository whose releases page visibly has a newer version
       * on it, and reported « à jour » while doing it.
       *
       * `release.yml` no longer sets that flag — a prerelease has no
       * `/releases/latest`, and that URL is now the app's public download link.
       * This stays `true` anyway, for two reasons: the four prereleases already
       * published are the versions in testers' hands right now, and this is what
       * lets a deliberate prerelease reach them later without a code change.
       *
       * With it true and a `currentVersion` carrying no prerelease tag (`0.1.1`
       * does not), the provider takes the newest entry in the releases feed
       * whatever its flag — which is the intended behaviour here. Revisit only
       * when a prerelease must NOT reach everyone, which needs a channel, not
       * this switch.
       */
      updater.allowPrerelease = true

      updater.on('checking-for-update', () => this.#emit({ phase: 'checking', reason: null }))
      updater.on('update-available', (info) => {
        this.#diagnostics.record({
          severity: 'info',
          code: 'update.available',
          module: 'update',
          message: `version ${info.version} disponible`,
          detail: { version: info.version, current: this.#state.currentVersion },
        })
        this.#emit({
          phase: 'available',
          availableVersion: info.version,
          percent: null,
          reason: null,
          checkedAt: this.#clock(),
        })
      })
      updater.on('update-not-available', () => {
        this.#emit({
          phase: 'idle',
          availableVersion: null,
          percent: null,
          reason: null,
          checkedAt: this.#clock(),
        })
      })
      updater.on('download-progress', (progress) => {
        /*
         * Clamped *and* checked for finiteness, rather than trusted.
         *
         * The library divides by a content-length the server reported. A
         * missing or zero one yields NaN, and NaN survives `Math.max`/`Math.min`
         * unchanged — so a naive clamp passes it straight through to a schema
         * that rejects it, and the broadcast throws on a progress tick instead
         * of on anything a reader would suspect. Hold the last good value.
         */
        const rounded = Math.round(progress.percent)
        const percent = Number.isFinite(rounded)
          ? Math.max(0, Math.min(100, rounded))
          : (this.#state.percent ?? 0)
        this.#emit({ phase: 'downloading', percent })
      })
      updater.on('update-downloaded', (info) => {
        this.#diagnostics.record({
          severity: 'info',
          code: 'update.downloaded',
          module: 'update',
          message: `version ${info.version} prête à installer`,
          detail: { version: info.version },
        })
        this.#emit({
          phase: 'ready',
          availableVersion: info.version,
          percent: 100,
          reason: null,
        })
      })
      updater.on('error', (error) => void this.#fail('update.failed', error, { show: !this.#downloading }))

      this.#updater = updater
      return updater
    } catch (error) {
      this.#broken = messageOf(error)
      this.#diagnostics.record({
        severity: 'info',
        code: 'update.unavailable',
        module: 'update',
        message: 'mise à jour automatique indisponible dans cette build',
        detail: { raw: this.#broken },
      })
      return null
    }
  }

  async check(): Promise<UpdateState> {
    const updater = this.#lib()
    if (!updater) {
      this.#state = updatesUnavailable(
        this.#state.currentVersion,
        'mise à jour automatique indisponible dans cette build',
      )
      return this.#state
    }
    try {
      await updater.checkForUpdates()
      /*
       * Deliberately no state write here. `checkForUpdates` resolves *before*
       * `update-available` fires in some paths and after it in others, so
       * writing the outcome from the return value races the events that
       * already write it correctly. The events are the source of truth; this
       * only surfaces the throw.
       */
      return this.#state
    } catch (error) {
      return this.#fail('update.check.failed', error)
    }
  }

  /**
   * Fetch the staged version, retrying a transfer that broke.
   *
   * ## Why `error` is a legal starting point
   *
   * A download that failed leaves `availableVersion` set — the check that found
   * it was fine, only the transfer was not. `AppUpdater` keeps its
   * `updateInfoAndProvider` across a failure too, so `downloadUpdate()` can be
   * called again without a second check. Refusing to start from `error` is what
   * made the recovery path *Réessayer* → *Télécharger*: two clicks, one of them
   * a network round trip that already knew the answer.
   */
  async download(): Promise<UpdateState> {
    const startable =
      this.#state.phase === 'available' ||
      (this.#state.phase === 'error' && this.#state.availableVersion !== null)
    if (!startable) return this.#state
    const updater = this.#lib()
    if (!updater) return this.#state

    this.#downloading = true
    try {
      for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        /*
         * Percent back to zero on every attempt, and said out loud. There is no
         * resume underneath — the temp file is deleted on failure — so a bar
         * that carried on from 90 % would be describing a transfer that is not
         * happening. A rep watching this deserves to know the difference
         * between slow and starting over.
         */
        this.#emit({
          phase: 'downloading',
          percent: 0,
          reason:
            attempt === 1
              ? null
              : `connexion interrompue, reprise du téléchargement (essai ${attempt} sur ${DOWNLOAD_ATTEMPTS})`,
        })
        try {
          await updater.downloadUpdate()
          return this.#state
        } catch (error) {
          const again = attempt < DOWNLOAD_ATTEMPTS && isRetryableDownloadFailure(error)
          if (!again) return this.#fail('update.download.failed', error)
          this.#fail('update.download.retry', error, { show: false })
          await this.#sleep(DOWNLOAD_BACKOFF_MS[attempt - 1] ?? DOWNLOAD_BACKOFF_MS.at(-1) ?? 0)
        }
      }
      return this.#state
    } finally {
      this.#downloading = false
    }
  }

  async install(): Promise<boolean> {
    if (this.#state.phase !== 'ready') return false
    const updater = this.#lib()
    if (!updater) return false
    this.#diagnostics.record({
      severity: 'info',
      code: 'update.install.requested',
      module: 'update',
      message: `installation de la version ${this.#state.availableVersion ?? 'inconnue'}`,
      detail: { version: this.#state.availableVersion },
    })
    try {
      /*
       * `isSilent: false` so Windows shows the NSIS progress rather than
       * appearing to do nothing for thirty seconds, and `isForceRunAfter: true`
       * so the app comes back up. A rep who pressed *Installer et redémarrer*
       * and got neither a window nor an app would reasonably conclude it
       * crashed.
       *
       * This does not return: the app quits inside it.
       */
      updater.quitAndInstall(false, true)
      return true
    } catch (error) {
      this.#fail('update.install.failed', error)
      return false
    }
  }
}
