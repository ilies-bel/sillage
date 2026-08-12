/**
 * One loaded Whisper model, shared by every channel that wants it.
 *
 * ## Why this exists
 *
 * A meeting opens two `SttSession`s — mic and system loopback — and until this
 * file existed each one spawned its own worker and loaded its own copy of the
 * *same weights*. Measured on an M1 Max, whisper-small q8:
 *
 *     channel 1 (far): ready in 8.6 s   rss 1458 MB
 *     channel 2 (rep): ready in 6.6 s   rss 2125 MB
 *     BOTH READY in   15.2 s            2.1 GB
 *
 * Fifteen seconds of dead air at the top of every meeting, and a gigabyte
 * spent, for two byte-identical tensors. The rep's report was "this is
 * unusable", and they were right: an 8-second test recording produced nothing
 * at all, because the model was still loading when the meeting ended.
 *
 * Sharing is safe by construction rather than by luck. `TranscribeSession`
 * builds both channels from one `TranscribeOptions` (see `index.ts`), so the
 * model id, the language and the boost prompt are necessarily identical — there
 * is no configuration in which the two channels would want different engines.
 *
 * ## Why it is reference-counted rather than a plain singleton
 *
 * The worker must outlive whichever channel finishes first and must not outlive
 * both, and "both" is not a fixed number: `prewarm()` takes a reference too, so
 * that an app which warmed the model at startup keeps it across meetings while
 * an app which did not still releases it at the end of one. A count is the only
 * thing that expresses both without a mode flag.
 *
 * ## What did *not* move here
 *
 * The VAD, the gap timer and the hallucination filter stay per-session: they
 * are about one channel's audio, not about the model. What moved is exactly
 * what is expensive and identical — the worker, the ONNX session behind it, and
 * the load mutex and crash sentinel that guard it.
 */
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { buildInitMessage } from './inference.ts'
import { DEFAULT_MODEL_ID, modelById } from './catalog.ts'
import { acquireLoadSlot, memoryVerdict } from './onnx.ts'
import { claimLoad, clearSentinel } from './sentinel.ts'
import { electronPaths, resolveModelsDir, resolveWorkerPath } from './paths.ts'
import type { PathEnvironment } from './paths.ts'
import type { WorkerOut } from './protocol.ts'

/** The surface of `worker_threads.Worker` this uses. Faked in tests. */
export interface WorkerLike extends EventEmitter {
  postMessage(value: unknown, transfer?: readonly unknown[]): void
  terminate(): Promise<number> | number
}

export interface EngineOptions {
  model?: string
  modelsDir?: string
  stateDir?: string
  workerPath?: string
  spawn?: (workerPath: string) => WorkerLike
}

/**
 * How long a busy worker is given to finish and exit on its own before it is
 * terminated. One utterance is at most twenty-five seconds of audio, so an
 * inference already running has nearly always returned well inside this.
 */
const SHUTDOWN_GRACE_MS = 10_000

const defaultSpawn = (workerPath: string): WorkerLike => new Worker(workerPath)

/** What one caller of `transcribe()` is waiting for. */
interface Task {
  resolve: (text: string) => void
  reject: (error: Error) => void
}

/**
 * Events: `progress` ({ modelId, progress }), `loadFailed` (Error).
 *
 * A load failure is broadcast rather than returned, because it arrives after
 * every client has already been handed its handle — and it is fatal to all of
 * them at once, which is precisely the property that made it worth sharing.
 */
export class WhisperEngine extends EventEmitter {
  readonly modelId: string

  #options: EngineOptions
  #worker: WorkerLike | null = null
  #ready = false
  #refs = 0
  #taskCounter = 0
  #tasks = new Map<string, Task>()
  #prompt = ''
  #stateDir = ''
  #releaseLoadSlot: (() => void) | null = null
  #loading: Promise<void> | null = null
  #closing: Promise<void> | null = null

  constructor(options: EngineOptions = {}) {
    super()
    this.#options = options
    this.modelId = options.model ?? DEFAULT_MODEL_ID
    // Load failures are broadcast to every client; with no client attached yet
    // (prewarm, before any meeting) Node would turn that into an uncaught
    // 'error' throw. This is a status channel, not an error channel.
    this.setMaxListeners(0)
  }

  get ready(): boolean {
    return this.#ready
  }

  /** How many holders. Exposed for the pool and for tests, not for callers. */
  get refs(): number {
    return this.#refs
  }

  /**
   * Take a reference, and resolve when the model is **loaded** — not when the
   * worker has been handed its init message.
   *
   * The difference is the whole value of the promise. Spawning is instant and
   * loading is seconds; a version of this that resolved on the former reported
   * a prewarm "ready in 0.0 s" while the process had not grown by a byte, which
   * is a status line that would have been believed.
   *
   * Idempotent in the sense that matters: the *load* happens once however many
   * holders arrive, and they all await the same promise.
   */
  retain(): Promise<void> {
    this.#refs++
    this.#loading ??= this.#load()
    return this.#loading.catch((error: unknown) => {
      // A failed load poisons this instance: its worker is gone or never
      // arrived, and every later holder would inherit the failure. Drop the
      // reference and the pool entry so the next caller builds a fresh one
      // rather than being handed a corpse.
      this.#refs = Math.max(0, this.#refs - 1)
      this.#loading = null
      if (pool.get(this.modelId) === this) pool.delete(this.modelId)
      throw error
    })
  }

  /**
   * Give up a reference. The worker is torn down when the last one goes.
   *
   * Never partially: a release that is not the last one resolves immediately,
   * because the other holder is still mid-meeting and its worker must not be
   * asked to leave.
   */
  async release(): Promise<void> {
    this.#refs = Math.max(0, this.#refs - 1)
    if (this.#refs > 0) return
    this.#closing ??= this.#teardown()
    await this.#closing
  }

  /**
   * The boost prompt (DEC-17), tokenized once by the worker and reused.
   *
   * Last writer wins, and both channels write the same value — see the header.
   * A no-op when unchanged, so two channels starting together cost one message.
   */
  setPrompt(prompt: string): void {
    if (prompt === this.#prompt) return
    this.#prompt = prompt
    if (this.#ready) this.#worker?.postMessage({ type: 'setPrompt', prompt })
  }

  /**
   * One utterance in, its text out.
   *
   * Rejects rather than throwing for a failed segment, so a caller can keep the
   * meeting going: one bad inference is not a reason to stop transcribing.
   */
  transcribe(audio: Float32Array, language: string): Promise<string> {
    if (!this.#worker || !this.#ready) {
      return Promise.reject(new Error('le moteur local n’est pas prêt'))
    }
    const taskId = `t${++this.#taskCounter}`
    return new Promise<string>((resolve, reject) => {
      this.#tasks.set(taskId, { resolve, reject })
      // Transferred, not copied: an utterance is up to twenty-five seconds of
      // Float32 at 16 kHz, and it is used nowhere after this line.
      this.#worker?.postMessage({ type: 'transcribe', taskId, audio, language }, [audio.buffer])
    })
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async #load(): Promise<void> {
    // Resolved lazily: asking for `userData` is the only impure step in the
    // whole start sequence, and `electronPaths()` throws outside Electron —
    // which is exactly where `scripts/replay.mjs` calls this from.
    let paths: PathEnvironment | null = null
    const env = (): PathEnvironment => (paths ??= electronPaths())
    const modelsDir = this.#options.modelsDir ?? resolveModelsDir(env)
    const workerPath = this.#options.workerPath ?? resolveWorkerPath(env)
    this.#stateDir = this.#options.stateDir ?? modelsDir

    /*
     * Refuse before spawning rather than after aborting. An ONNX session that
     * cannot allocate does not fail politely — it takes the process with it.
     *
     * « mémoire vive », and both numbers. The old wording was « mémoire
     * insuffisante … (moins de 2 Go disponibles) », which named neither the
     * model nor what was measured: a rep read it as disk space and went to
     * check a drive with 400 GB free. It also named no way out, and there are
     * two — close something, or pick a smaller checkpoint, which now genuinely
     * helps because the requirement scales with the model.
     */
    const memory = memoryVerdict(this.modelId)
    if (!memory.ok) {
      const label = modelById(this.modelId)?.label ?? this.modelId
      const gb = (n: number): string => n.toFixed(1).replace('.', ',')
      /*
       * Two different refusals, because they have two different remedies. With
       * a probe the machine is *busy* and closing something fixes it. Without
       * one the only claim being made is about total RAM, so telling the rep to
       * close applications would be advice that cannot work.
       */
      const message =
        memory.reading.source === 'probe'
          ? `mémoire vive insuffisante pour ${label} : ${gb(memory.requiredGB)} Go nécessaires, ` +
            `${gb(memory.reading.gb)} Go disponibles — fermez des applications ou choisissez un modèle plus petit`
          : `${label} demande ${gb(memory.requiredGB)} Go de mémoire vive et cette machine ` +
            `en a ${gb(memory.totalGB)} au total — choisissez un modèle plus petit`
      // The numbers behind the refusal, so the next report of one is not
      // another round of guessing at which measurement was taken.
      throw new Error(message, { cause: { model: this.modelId, ...memory } })
    }

    // The mutex still matters even though there is now one load per model: a
    // second *engine* (a different model, or a prewarm racing a meeting) would
    // otherwise build its ONNX session alongside this one, and two concurrent
    // loads is the case that exhausts memory on a laptop. The sentinel is
    // claimed behind it so a sibling never reads its own family's record and
    // concludes the previous process died loading.
    this.#releaseLoadSlot = await acquireLoadSlot()
    if (this.#refs === 0) {
      // Every holder left while the mutex was held by someone else.
      this.#releaseLoad()
      return
    }

    const claim = claimLoad(this.#stateDir, this.modelId)
    if (!claim.ok) {
      this.#releaseLoad()
      throw new Error(claim.reason)
    }

    const spawn = this.#options.spawn ?? defaultSpawn
    const worker = spawn(workerPath)
    this.#worker = worker
    this.#attach(worker)
    worker.postMessage(buildInitMessage(this.modelId, modelsDir))

    await this.#whenReady()
  }

  /** Settles on the worker's own `ready`, or on the failure that replaced it. */
  #whenReady(): Promise<void> {
    if (this.#ready) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        this.off('loadFailed', onFailed)
        resolve()
      }
      const onFailed = (error: Error): void => {
        this.off('ready', onReady)
        reject(error)
      }
      this.once('ready', onReady)
      this.once('loadFailed', onFailed)
    })
  }

  #attach(worker: WorkerLike): void {
    worker.on('message', (message: WorkerOut) => this.#onMessage(message))

    worker.on('error', (error: unknown) => {
      this.#releaseLoad()
      this.#ready = false
      this.#failAll(error instanceof Error ? error : new Error(String(error)))
    })

    worker.on('exit', (code: number) => {
      this.#releaseLoad()
      this.#ready = false
      if (code === 0) {
        clearSentinel(this.#stateDir, this.modelId)
        return
      }
      this.#failAll(new Error(`le moteur local s’est arrêté (code ${code})`))
    })
  }

  #onMessage(message: WorkerOut): void {
    if (message.type === 'ready') {
      clearSentinel(this.#stateDir, this.modelId)
      this.#releaseLoad()
      this.#ready = true
      if (this.#prompt) this.#worker?.postMessage({ type: 'setPrompt', prompt: this.#prompt })
      this.emit('ready')
      return
    }

    if (message.type === 'progress') {
      this.emit('progress', { modelId: message.modelId, progress: message.progress })
      return
    }

    if (message.type === 'result') {
      const task = this.#tasks.get(message.taskId)
      this.#tasks.delete(message.taskId)
      task?.resolve(message.text)
      return
    }

    // An error carrying a taskId failed one utterance; one without failed the
    // model load, which is fatal for every client at once.
    if (message.taskId) {
      const task = this.#tasks.get(message.taskId)
      this.#tasks.delete(message.taskId)
      task?.reject(new Error(message.message))
      return
    }
    this.#ready = false
    this.#releaseLoad()
    this.#failAll(new Error(explainLoadFailure(message.message, this.modelId)))
  }

  /** Every outstanding segment, plus the clients themselves. */
  #failAll(error: Error): void {
    const tasks = [...this.#tasks.values()]
    this.#tasks.clear()
    for (const task of tasks) task.reject(error)
    this.emit('loadFailed', error)
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  #releaseLoad(): void {
    this.#releaseLoadSlot?.()
    this.#releaseLoadSlot = null
  }

  /**
   * Asks the worker to leave before making it.
   *
   * `terminate()` stops the thread wherever it is, and if that is inside an ONNX
   * inference the unwind aborts the whole process — `libc++abi: terminating due
   * to uncaught exception`, with no stack and nothing catchable. In Electron
   * that is the app disappearing at the end of a meeting, which is the one
   * moment the rep's document has not been written yet.
   *
   * So: post `shutdown`, which the worker cannot read until its current
   * inference has returned, and keep `terminate()` as the deadline behind it.
   */
  #teardown(): Promise<void> {
    this.#releaseLoad()
    const worker = this.#worker
    // "Busy" is *any* native work in progress, not just an inference. Building
    // the ONNX session is the other one, it is the longest, and interrupting it
    // aborts exactly the same way — which is what a meeting that ends before a
    // cold model has finished loading does.
    const busy = this.#tasks.size > 0 || !this.#ready
    this.#worker = null
    this.#ready = false
    this.#loading = null
    this.#tasks.clear()
    if (!worker) return Promise.resolve()

    worker.removeAllListeners('message')
    worker.removeAllListeners('error')
    worker.removeAllListeners('exit')

    const kill = (): Promise<void> =>
      Promise.resolve(worker.terminate()).then(
        () => {},
        () => {},
      )
    if (!busy) return kill()

    return new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      // Deliberately not unref'd: the process must stay alive long enough for
      // the worker to actually be gone, or Node tears it down by the same route
      // `terminate()` takes and re-creates the abort this avoids.
      const timer = setTimeout(() => void kill().then(done), SHUTDOWN_GRACE_MS)
      worker.once('exit', done)
      worker.postMessage({ type: 'shutdown' })
    })
  }
}

/**
 * ONNX Runtime's load failures are unreadable and two of them are actionable.
 * A rep reading "Symbol not found: __ZNSt3__18to_charsEPcS0_d" learns nothing;
 * a rep reading that their macOS is too old can act.
 */
export const explainLoadFailure = (message: string, modelId: string): string => {
  if (
    message.includes('Symbol not found') ||
    message.includes('to_chars') ||
    message.includes('libonnxruntime')
  ) {
    return 'la transcription locale demande macOS 13 (Ventura) ou plus récent'
  }
  if (message.includes('no such file') || message.includes('file_size') || message.includes('ENOENT')) {
    return `le modèle local ${modelId} est absent ou incomplet — retéléchargez-le`
  }
  return message
}

// ── The pool ────────────────────────────────────────────────────────────────

/**
 * One engine per model id.
 *
 * Keyed by model rather than global because a prewarmed default and a meeting
 * that Réglages pointed at a different checkpoint are two different models, and
 * silently handing the second the first's weights would transcribe the meeting
 * with an engine the rep did not choose.
 *
 * An engine with a `spawn` override never enters the pool: that seam exists so
 * a test can supply a fake worker, and a shared fake is a test leaking into the
 * next one.
 */
const pool = new Map<string, WhisperEngine>()

export const acquireEngine = (options: EngineOptions = {}): WhisperEngine => {
  if (options.spawn) return new WhisperEngine(options)

  const key = options.model ?? DEFAULT_MODEL_ID
  let engine = pool.get(key)
  if (!engine) {
    engine = new WhisperEngine(options)
    pool.set(key, engine)
  }
  return engine
}

/** Drops an engine from the pool once nothing holds it. */
export const forgetEngine = (engine: WhisperEngine): void => {
  if (engine.refs === 0 && pool.get(engine.modelId) === engine) pool.delete(engine.modelId)
}

/**
 * Load the model before anyone needs it, and keep it loaded.
 *
 * The reference this takes is never released, which is the whole point: the
 * cost of a meeting's first words is otherwise the cost of a cold model, and no
 * amount of tuning further down the pipeline buys that back. Roughly 1.1 GB
 * resident for as long as the app is open — the price of *Démarrer* being
 * instant, paid once instead of at the top of every meeting.
 *
 * The returned promise resolves when the model is loaded and **rejects when it
 * is not**. It does not swallow its own failure: DEC-26 says nothing downstream
 * may stop a meeting being recorded, which makes this non-blocking, not
 * invisible. The first version caught the error here and the first real launch
 * failed with no evidence but a process that never grew. The caller decides
 * what to do with the rejection; `app/main.ts` records a diagnostic and carries
 * on, which is both halves of the rule.
 */
export const prewarmEngine = (options: EngineOptions = {}): Promise<void> => {
  const engine = acquireEngine(options)
  return engine.retain()
}

/** Test seam. Drops every pooled engine without tearing its worker down. */
export const __resetEnginePoolForTests = (): void => {
  pool.clear()
}
