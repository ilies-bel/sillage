/**
 * The inference worker. One per channel, one model each.
 *
 * It runs in a `worker_threads` thread because ONNX Runtime blocks the thread
 * it runs on for the whole of an inference — hundreds of milliseconds to
 * several seconds. On the main thread that is a frozen window and, worse, a
 * capture path that stops draining its queue. DEC-26 says nothing downstream
 * may stop a meeting being recorded; a synchronous local model would be the
 * most direct violation of it available.
 *
 * There is one inference mode. The previous version had two — a `streaming`
 * pass with different decoder parameters, run over the still-open segment every
 * 1.5 s — and it is gone with the loop that drove it (see `protocol.ts`).
 */
import { parentPort } from 'node:worker_threads'
import type { WorkerIn } from './protocol.ts'
import { ProgressAggregator } from './progress.ts'
import { boundedSessionOptions } from './onnx.ts'
import { PROMPT_TOKEN_CAP, buildDecoderPrefix, stripEchoedPrompt } from './prompt.ts'
import type { PrefixTokens } from './prompt.ts'

/** BCP-47 → the names Whisper's decoder was trained on, and its language token. */
const LANGUAGES: Record<string, { name: string; token: string }> = {
  'fr-FR': { name: 'french', token: '<|fr|>' },
  'en-US': { name: 'english', token: '<|en|>' },
  'en-GB': { name: 'english', token: '<|en|>' },
  'de-DE': { name: 'german', token: '<|de|>' },
  'es-ES': { name: 'spanish', token: '<|es|>' },
  'it-IT': { name: 'italian', token: '<|it|>' },
  'nl-NL': { name: 'dutch', token: '<|nl|>' },
  'pt-PT': { name: 'portuguese', token: '<|pt|>' },
}


const port = parentPort
if (!port) throw new Error('worker.ts must be run as a worker thread')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null
let promptText = ''
let promptIds: number[] | null = null

/**
 * `@huggingface/transformers` is ESM-only and this file is bundled to CommonJS,
 * where TypeScript and esbuild both rewrite `import()` into `require()` — which
 * fails on an ESM-only package. Building the import expression at runtime means
 * neither compiler ever sees it, and Node performs a real dynamic ESM import.
 */
const loadTransformers = (): Promise<{ pipeline: unknown; env: Record<string, unknown> }> =>
  new Function('return import("@huggingface/transformers")')() as Promise<{
    pipeline: unknown
    env: Record<string, unknown>
  }>

/**
 * Looks a special token up in the tokenizer vocabulary, or returns null.
 *
 * Whisper's special tokens are ordinary vocabulary entries, so this is a map
 * lookup — but which map depends on the tokenizer class, and a missing id has
 * to be survivable rather than thrown. Everything that builds on this fails
 * back to an unprompted transcription, which is a worse transcript and still a
 * transcript.
 */
const specialTokenId = (token: string): number | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = pipe?.tokenizer as any
  const candidates = [t?.model?.tokens_to_ids, t?.added_tokens_map, t?.tokens_to_ids]
  for (const map of candidates) {
    const id = map?.get?.(token) ?? map?.[token]
    if (typeof id === 'number' && Number.isSafeInteger(id)) return id
  }
  return null
}

/**
 * Tokenizes the boost prompt once and caches the ids (DEC-17).
 *
 * Truncation keeps the *front* of the list. `modules/transcribe/` is handed the
 * attendee surnames from the calendar event first and the static ESN vocabulary
 * after, so the front of the string is the part that cannot be reconstructed
 * from anywhere else.
 */
const updatePromptCache = async (next: string): Promise<void> => {
  const trimmed = (next ?? '').trim()
  if (!trimmed) {
    promptText = ''
    promptIds = null
    return
  }
  if (trimmed === promptText && promptIds !== null) return
  if (!pipe?.tokenizer) return // not loaded yet; re-applied after `ready`

  try {
    // add_special_tokens=false: the <|startofprev|> marker is prepended below,
    // as part of the decoder prefix, rather than by the tokenizer.
    const encoded = await pipe.tokenizer(trimmed, { add_special_tokens: false })
    const raw: Array<number | bigint> = encoded?.input_ids?.tolist?.()?.[0] ?? []
    promptIds = raw.slice(0, PROMPT_TOKEN_CAP).map((n) => {
      const v = Number(n)
      if (!Number.isSafeInteger(v)) throw new Error(`token id ${n} is not a safe integer`)
      return v
    })
    promptText = trimmed
  } catch (e) {
    // A prompt that will not tokenize costs accuracy, never the meeting.
    console.warn('[whisper] prompt tokenization failed:', e instanceof Error ? e.message : e)
    promptText = ''
    promptIds = null
  }
}

/**
 * The decoder prefix that actually applies the lexicon — see `prompt.ts` for
 * why `prompt_ids` is not what does it.
 *
 * Returns null whenever any token id cannot be resolved, which drops back to an
 * unprompted transcription rather than sending the model a malformed prefix.
 */
const decoderPrefix = (languageToken: string): number[] | null => {
  if (!promptIds || promptIds.length === 0) return null

  const tokens = {
    startOfPrev: specialTokenId('<|startofprev|>'),
    startOfTranscript: specialTokenId('<|startoftranscript|>'),
    language: specialTokenId(languageToken),
    task: specialTokenId('<|transcribe|>'),
    noTimestamps: specialTokenId('<|notimestamps|>'),
  }
  if (Object.values(tokens).some((id) => id === null)) return null
  return buildDecoderPrefix(promptIds, tokens as PrefixTokens)
}

port.on('message', async (msg: WorkerIn) => {
  if (msg.type === 'init') {
    try {
      const { pipeline, env } = await loadTransformers()
      env.cacheDir = msg.cacheDir
      // The caller decides, and the meeting path says no (DEC-26). A missing
      // checkpoint then fails to load here rather than becoming a download
      // inside a client's network while a call is starting.
      env.allowRemoteModels = msg.allowRemoteModels === true
      env.allowLocalModels = true
      const backends = env.backends as { onnx?: Record<string, unknown> } | undefined
      if (backends?.onnx) backends.onnx.executionProviders = msg.executionProviders

      const aggregator = new ProgressAggregator(msg.expectedBytes)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipe = await (pipeline as any)('automatic-speech-recognition', msg.modelId, {
        dtype: msg.dtype,
        session_options: boundedSessionOptions(),
        ...(msg.useExternalDataFormat !== undefined
          ? { use_external_data_format: msg.useExternalDataFormat }
          : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (data: any) => {
          const pct = aggregator.update(data)
          if (pct !== null) port.postMessage({ type: 'progress', modelId: msg.modelId, progress: pct })
        },
      })

      // A new model means a different vocabulary, so the cached ids are wrong.
      promptText = ''
      promptIds = null
      port.postMessage({ type: 'ready' })
    } catch (e) {
      port.postMessage({
        type: 'error',
        message: `Failed to load model: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
    return
  }

  if (msg.type === 'setPrompt') {
    await updatePromptCache(msg.prompt)
    return
  }

  if (msg.type === 'shutdown') {
    // Reached only once any in-flight inference has returned — the message loop
    // is single-threaded. Dropping the pipeline first lets ORT release its
    // session while the thread is still ours to run on.
    pipe = null
    port.close()
    process.exit(0)
  }

  if (msg.type === 'transcribe') {
    if (!pipe) {
      port.postMessage({ type: 'error', taskId: msg.taskId, message: 'model not loaded' })
      return
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: Record<string, any> = {
        sampling_rate: 16_000,
        task: 'transcribe',
        // Off, deliberately. Conditioning on the previous text is what makes
        // Whisper spiral into repetition loops on long meetings — one bad
        // segment poisons every segment after it, and there is no recovery
        // inside a single recording.
        condition_on_previous_text: false,
        // The anti-loop guard, and the only one of them that this runtime has.
        //
        // `compression_ratio_threshold`, `logprob_threshold` and
        // `no_speech_threshold` used to sit here, commented as "Whisper's own
        // anti-loop guards". They are **openai-whisper (Python) options**, part
        // of its temperature-fallback loop, and `@huggingface/transformers`
        // implements none of them — it accepted all three and ignored all three.
        // Three lines that read as protection and were inert.
        //
        // What transformers.js does implement is `no_repeat_ngram_size`, and it
        // is not a small win. Measured here, whisper-small q8 on 18 s of French,
        // CPU: **43.8 s with the Python options, 9.4 s with this one** — 2.42×
        // realtime to 0.52×. The cost was never inference speed; it was a
        // degenerate decode running to the token cap instead of stopping.
        //
        // 3 rather than 2: French says "de la" and "et de" often enough that
        // banning repeated bigrams truncates honest speech.
        no_repeat_ngram_size: 3,
      }
      const language = LANGUAGES[msg.language]
      if (language) options.language = language.name

      // Only prompt when the language token is known: a prefix has to name a
      // language explicitly, and guessing one is worse than not prompting.
      const prefix = language ? decoderPrefix(language.token) : null
      if (prefix) options.decoder_input_ids = prefix

      const result = await pipe(msg.audio, options)
      const raw = result?.text ?? ''
      port.postMessage({
        type: 'result',
        taskId: msg.taskId,
        text: prefix ? stripEchoedPrompt(raw, promptText) : raw,
      })
    } catch (e) {
      port.postMessage({
        type: 'error',
        taskId: msg.taskId,
        message: `Transcription failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
})
