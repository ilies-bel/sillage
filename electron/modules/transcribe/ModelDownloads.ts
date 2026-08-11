/**
 * Fetching a Whisper checkpoint from Hugging Face, on demand (DEC-35b).
 *
 * The mechanism is the inference worker with one flag flipped:
 * `allowRemoteModels: true`. That flag is false on the meeting path and stays
 * false — DEC-26 says nothing downstream may stop a meeting being recorded, and
 * a worker that reaches the network because a cache entry is missing turns a
 * recording into a download over whatever hotel wifi the rep is on. It is true
 * here, and only here, because downloading *is* the task and a human is
 * watching a bar.
 *
 * ## The four bugs this is written against
 *
 * The previous implementation of this feature is deleted, but its failures are
 * worth keeping, because every one of them is easy to re-introduce:
 *
 *  1. **Progress was sent to one `WebContents`.** Closing the settings overlay
 *     mid-download made `sender.isDestroyed()` true, and every subsequent event
 *     was dropped while the bytes kept arriving. Here the manager emits to a
 *     listener that `app/` broadcasts from — this file knows nothing about
 *     windows, which is also what the module boundary requires.
 *  2. **The in-flight set leaked.** The destroyed-sender guard returned *before*
 *     the completion handler could remove the id, so a model could not be
 *     retried until the app was relaunched. Here removal happens in a `finally`
 *     that no early return can skip.
 *  3. **A remounted panel had nothing to ask.** There was no "what is
 *     downloading?" channel, so a reopened panel started from empty state and
 *     showed a 0 % bar forever. `state()` is that channel's answer.
 *  4. **`ready` was trusted.** The worker's `ready` set the badge to
 *     downloaded, with no re-count of the disk — so a dtype change or a torn
 *     `*.onnx_data` companion showed as installed and then aborted at load,
 *     mid-meeting. Here `ready` from the worker only moves the row to
 *     `verifying`; nothing but `isModelCached` can produce `ready`.
 *
 * Resume across restarts is **not** implemented, deliberately and as before: a
 * quit mid-download re-fetches from byte zero. The cost is bounded by total
 * bytes rather than by anything a rep waits on twice, and Range-aware fetching
 * belongs behind a real complaint rather than ahead of one.
 */
import type { ModelActivity } from '../../core/domain/modelRows.ts'
import type { ModelStatus } from '../../core/contracts/models.ts'
import { modelSizeBytes, externalDataFormatFor, isModelCached } from './whisper/catalog.ts'
import { ProgressAggregator } from './whisper/progress.ts'
import type { WorkerOut } from './whisper/protocol.ts'

/** The half of `node:worker_threads`' `Worker` this needs. Injected, never imported. */
export interface DownloadWorkerLike {
  on(event: 'message', listener: (message: WorkerOut) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  postMessage(message: unknown): void
  terminate(): Promise<number> | void
}

export interface ModelDownloadsOptions {
  /** Where checkpoints land. The writable `userData` directory, not the bundled one. */
  modelsDir: string
  /** The dtype this machine will actually ask for — the same one the meeting path uses. */
  dtype: string | Record<string, string>
  executionProviders: string[]
  /** Spawns a worker for one download. */
  spawn: (modelId: string) => DownloadWorkerLike
  /** Called on every change. `app/` turns this into the `models:progress` broadcast. */
  onChange?: (id: string, activity: ModelActivity) => void
  /** Injected so a test can decide what is on disk. */
  cached?: (modelId: string) => boolean
}

const RESTING: ModelActivity = { status: 'absent', progress: 0, reason: null }

export class ModelDownloads {
  readonly #options: ModelDownloadsOptions
  readonly #state = new Map<string, ModelActivity>()
  readonly #workers = new Map<string, DownloadWorkerLike>()
  /**
   * Ids the rep cancelled, so the worker's own error — terminating one mid-fetch
   * surfaces as a failed request — is not reported as a download that broke.
   * « échec du téléchargement » on a row the rep just cancelled is a lie that
   * sends them to a support channel.
   */
  readonly #cancelled = new Set<string>()

  constructor(options: ModelDownloadsOptions) {
    this.#options = options
  }

  /** Everything known, for `models:state` and for the settings tables. */
  state(): Readonly<Record<string, ModelActivity>> {
    return Object.fromEntries(this.#state)
  }

  /** The ids whose bytes are verified present right now. */
  ready(catalogue: readonly { id: string }[]): string[] {
    const cached = this.#options.cached ?? ((id: string) => this.#isCached(id))
    return catalogue.filter((model) => cached(model.id)).map((model) => model.id)
  }

  #isCached(modelId: string): boolean {
    return isModelCached(this.#options.modelsDir, modelId, this.#options.dtype)
  }

  #publish(id: string, activity: ModelActivity): void {
    this.#state.set(id, activity)
    this.#options.onChange?.(id, activity)
  }

  /**
   * Start a download, or do nothing if one is already running for this id.
   *
   * Idempotent rather than throwing: the button is clickable for as long as the
   * row says `absent`, and a rep who double-clicks it has not made a mistake
   * worth an error dialog. Two workers on one checkpoint would race into the
   * same cache directory, which is how a torn model gets written.
   */
  async start(modelId: string): Promise<void> {
    if (this.#workers.has(modelId)) return
    if ((this.#options.cached ?? ((id: string) => this.#isCached(id)))(modelId)) {
      this.#publish(modelId, { status: 'ready', progress: 100, reason: null })
      return
    }

    this.#cancelled.delete(modelId)
    const worker = this.#options.spawn(modelId)
    this.#workers.set(modelId, worker)
    this.#publish(modelId, { status: 'downloading', progress: 0, reason: null })

    const aggregator = new ProgressAggregator(modelSizeBytes(modelId))

    const settle = (status: ModelStatus, reason: string | null): void => {
      // Bug 2: removal happens here, and every path that ends the download goes
      // through it. A guard that returned earlier is what left the old set
      // holding an id nobody could clear without relaunching the app.
      this.#workers.delete(modelId)
      this.#publish(modelId, {
        status,
        progress: status === 'ready' ? 100 : 0,
        reason: status === 'error' ? (reason ?? 'échec du téléchargement') : null,
      })
      try {
        worker.terminate()
      } catch {
        // Terminating an already-dead worker is not a failure worth reporting;
        // the download's outcome has been published either way.
      }
    }

    worker.on('message', (message) => {
      if (message.type === 'progress' && message.modelId === modelId) {
        const pct = aggregator.update({
          file: modelId,
          status: 'progress',
          loaded: (message.progress / 100) * modelSizeBytes(modelId),
          total: modelSizeBytes(modelId),
        })
        this.#publish(modelId, {
          status: 'downloading',
          progress: pct ?? message.progress,
          reason: null,
        })
        return
      }

      if (message.type === 'ready') {
        // Bug 4. `ready` means the worker loaded a pipeline, which is not the
        // same claim as "every file this dtype opens is on disk". Only the
        // re-count below may produce `ready`.
        this.#publish(modelId, { status: 'verifying', progress: 99, reason: null })
        const verified = (this.#options.cached ?? ((id: string) => this.#isCached(id)))(modelId)
        settle(
          verified ? 'ready' : 'error',
          verified ? null : 'téléchargement incomplet — fichiers manquants sur le disque',
        )
        return
      }

      if (message.type === 'error') {
        if (this.#cancelled.has(modelId)) return
        settle('error', message.message)
      }
    })

    worker.on('error', (error) => {
      if (this.#cancelled.has(modelId)) return
      settle('error', error.message)
    })

    worker.on('exit', () => {
      // A worker that exits without `ready` and without an error left nothing
      // to report but its silence, and silence must not read as success.
      if (!this.#workers.has(modelId)) return
      settle(this.#cancelled.has(modelId) ? 'cancelled' : 'error', 'le téléchargement s’est interrompu')
    })

    worker.postMessage({
      type: 'init',
      modelId,
      cacheDir: this.#options.modelsDir,
      executionProviders: this.#options.executionProviders,
      dtype: this.#options.dtype,
      expectedBytes: modelSizeBytes(modelId),
      useExternalDataFormat: externalDataFormatFor(modelId),
      // The one place in the product where this is true, and the reason this
      // class exists rather than the meeting path growing a flag.
      allowRemoteModels: true,
    })
  }

  /**
   * Stop a download and mark it cancelled.
   *
   * The partial bytes are left where they are rather than deleted here: the
   * next `start` re-fetches from zero into the same directory and transformers
   * overwrites, and `isModelCached` treats a zero-byte stub as absent, so a
   * torn cache cannot be mistaken for a usable one. Deleting a directory the
   * worker may still have open is the more dangerous of the two options.
   */
  async cancel(modelId: string): Promise<void> {
    const worker = this.#workers.get(modelId)
    if (!worker) return
    this.#cancelled.add(modelId)
    this.#workers.delete(modelId)
    this.#publish(modelId, { status: 'cancelled', progress: 0, reason: null })
    try {
      await worker.terminate()
    } catch {
      // See `settle`: the row already says cancelled, which is what was asked.
    }
  }

  /**
   * Re-check everything after a restart.
   *
   * Anything the persisted state claims was downloading has no live worker
   * behind it, so it is `interrupted` — a distinct status from `error`, because
   * nothing went wrong and the sentence the rep reads must not say it did.
   * Bytes that made it to disk win over both.
   */
  rehydrate(persisted: Readonly<Record<string, ModelActivity>>): void {
    const cached = this.#options.cached ?? ((id: string) => this.#isCached(id))
    for (const [id, activity] of Object.entries(persisted)) {
      if (cached(id)) {
        this.#state.set(id, { status: 'ready', progress: 100, reason: null })
        continue
      }
      this.#state.set(
        id,
        activity.status === 'downloading' || activity.status === 'verifying'
          ? { status: 'interrupted', progress: 0, reason: null }
          : (activity ?? RESTING),
      )
    }
  }
}
