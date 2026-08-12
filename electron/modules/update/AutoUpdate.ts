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

export interface AutoUpdateOptions {
  /** `app.getVersion()`. Injected so the module never imports Electron. */
  currentVersion: string
  diagnostics?: DiagRecorder
  clock?: () => number
  /** Defaults to `require('electron-updater').autoUpdater`. */
  load?: AutoUpdaterLoader
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'erreur inconnue'

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

  constructor(options: AutoUpdateOptions) {
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
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

  #fail(code: string, error: unknown): UpdateState {
    const reason = updateFailureReason(error)
    this.#diagnostics.record({
      severity: 'warn',
      code,
      module: 'update',
      message: reason,
      detail: { raw: messageOf(error) },
    })
    this.#emit({ phase: 'error', reason, percent: null, checkedAt: this.#clock() })
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
       * Every release this project cuts is marked `--prerelease`, because none
       * of them is signed. With the default `allowPrerelease = false`,
       * electron-updater resolves the newest version through GitHub's
       * `/releases/latest` — an endpoint that **excludes prereleases**. The
       * whole feature would then do nothing at all, on a repository whose
       * releases page visibly has a newer version on it, and report « à jour »
       * while doing it.
       *
       * With it true and a `currentVersion` carrying no prerelease tag (`0.1.1`
       * does not), the provider takes the newest entry in the releases feed
       * whatever its flag — which is the intended behaviour here. Revisit only
       * when signed stable releases exist alongside prereleases.
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
      updater.on('error', (error) => void this.#fail('update.failed', error))

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

  async download(): Promise<UpdateState> {
    if (this.#state.phase !== 'available') return this.#state
    const updater = this.#lib()
    if (!updater) return this.#state
    try {
      this.#emit({ phase: 'downloading', percent: 0 })
      await updater.downloadUpdate()
      return this.#state
    } catch (error) {
      return this.#fail('update.download.failed', error)
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
