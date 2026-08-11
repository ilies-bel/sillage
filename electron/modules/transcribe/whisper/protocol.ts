/**
 * The message alphabet between the host and the inference worker.
 *
 * Both sides of a `worker_threads` channel are separate JS realms with no
 * shared types at runtime, so this file is the only thing keeping them in
 * agreement. It is deliberately tiny: `init`, `setPrompt`, `transcribe` in;
 * `ready`, `result`, `error`, `progress` out.
 *
 * There is no `partial`. The previous product ran a second inference loop over
 * the still-open segment every 1.5 s and reconciled the two passes with
 * LocalAgreement-2, because it had to answer a question before the speaker
 * finished asking it. A notetaker does not: the transcript pane is a read-only
 * side surface (DEC-5) and interim text is never persisted (DEC-21). Dropping
 * the loop halves the inference budget of the offline floor, which is the one
 * provider that pays for itself in the rep's own CPU.
 */

export interface InitMessage {
  type: 'init'
  modelId: string
  cacheDir: string
  executionProviders: string[]
  /**
   * String → one dtype for every ONNX file. Record → per-file, keyed by ONNX
   * basename without the suffix (`encoder_model`, `decoder_model_merged`, …).
   */
  dtype: string | Record<string, string>
  /**
   * Catalog download size in bytes — the progress denominator from byte zero.
   * 0 when unknown, in which case the aggregator falls back to observed totals.
   */
  expectedBytes: number
  /**
   * Forwarded to transformers as `use_external_data_format` for checkpoints
   * whose weights live in a sibling `*.onnx_data` file but whose own
   * `config.json` omits the declaration. `undefined` for every other model.
   */
  useExternalDataFormat: boolean | Record<string, boolean> | undefined
  /**
   * Whether the worker may fetch a missing checkpoint from the network.
   *
   * **False on the meeting path, and that is not a preference.** DEC-26 says
   * the capture path has zero network dependencies: everything downstream may
   * fail, but nothing downstream may stop a meeting being recorded. A worker
   * that reaches HuggingFace because a cache entry is missing turns a recording
   * into a download — over whatever network the rep's client happens to be on,
   * at the moment a call is starting.
   *
   * True only where downloading *is* the task (`scripts/fetch-whisper-model.mjs`),
   * where a human asked for it and is watching a progress bar.
   */
  allowRemoteModels: boolean
}

/**
 * Out-of-band prompt update, sent only when the value actually changes.
 *
 * The worker tokenizes once and reuses the ids, which is what makes
 * `initial_prompt` boosting free per segment rather than an 8 KB string copied
 * across the channel on every utterance (DEC-17).
 */
export interface SetPromptMessage {
  type: 'setPrompt'
  prompt: string
}

export interface TranscribeMessage {
  type: 'transcribe'
  taskId: string
  audio: Float32Array
  /** BCP-47. The worker maps it to Whisper's own language names. */
  language: string
}

/**
 * "Finish what you are doing, then exit."
 *
 * `Worker.terminate()` kills the thread wherever it happens to be, and where it
 * usually is is inside ONNX Runtime — which unwinds through native state it was
 * not asked to abandon and aborts the *process*. At the end of a meeting that
 * would take the app down with the rep's document still unsaved.
 *
 * This message costs nothing and fixes it by arithmetic: the worker's message
 * loop is single-threaded, so a `shutdown` posted mid-inference is not read
 * until that inference has returned. The host still terminates as a last resort,
 * but only after the polite path has had its grace period.
 */
export interface ShutdownMessage {
  type: 'shutdown'
}

export type WorkerIn = InitMessage | SetPromptMessage | TranscribeMessage | ShutdownMessage

export interface ReadyMessage {
  type: 'ready'
}
export interface ResultMessage {
  type: 'result'
  taskId: string
  text: string
}
/** `taskId` is absent when the failure is the model load rather than a segment. */
export interface ErrorMessage {
  type: 'error'
  taskId?: string
  message: string
}
export interface ProgressMessage {
  type: 'progress'
  modelId: string
  progress: number
}

export type WorkerOut = ReadyMessage | ResultMessage | ErrorMessage | ProgressMessage
