/**
 * Batch REST transcription, ported from `electron/audio/RestSTT.ts`.
 *
 * **Does the old file generalise past one vendor?** It was flagged twice in the
 * spec and never checked, so: yes. Everything vendor-shaped is confined to
 * `PROVIDERS` below — endpoint, auth header, upload mode, extra fields, and the
 * one function that digs the text out of the response. Buffering, the
 * VAD-driven flush, the silence gate, the resample and the WAV header are
 * vendor-neutral and were already serving five providers. It is a sound base.
 *
 * **What it does not give us, and this matters for the demo.** It uploads
 * finished WAV files. For Azure that means the *short-audio* REST endpoint,
 * which has two consequences neither the spec nor the old code stated:
 *
 *   1. **60 seconds of audio per request, hard.** The flush is normally driven
 *      by the native VAD, but a speaker who never pauses is exactly the case
 *      that overruns it — so `MAX_BUFFERED_BYTES` cuts the buffer well before
 *      the ceiling instead of discovering it as a 400 mid-meeting.
 *   2. **No phrase lists.** Azure's are a feature of the SDK's WebSocket
 *      protocol, not of this endpoint. The descriptor in `registry.ts` says
 *      `boost: 'none'` for that reason, and this file honours it: boost terms
 *      are dropped for a provider that cannot take them rather than sent and
 *      silently ignored (DEC-17 — capability-detected, never assumed).
 *
 * Both are acceptable for v1 because the live transcript is a read-only side
 * surface (DEC-5), not something the rep types against. They would not be
 * acceptable for a streaming answer assistant, which is what the original file
 * was written for.
 *
 * Two dependencies of the original are gone. `../config/languages` went with the
 * old product and is not coming back: DEC-22 fixes the locale at `fr-FR`, so the
 * language arrives as a BCP-47 string. `isValidSttRegion` from `curlUtils` was
 * deleted too, and it was load-bearing — the region is interpolated into a
 * hostname — so it is reimplemented here, next to the interpolation it guards.
 */
import { EventEmitter } from 'node:events'
import axios from 'axios'
import FormData from 'form-data'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import type { SttSession, SttSessionOptions } from './SttSession.ts'

export type RestProviderId = 'azure-fr' | 'groq-whisper' | 'openai-whisper' | 'elevenlabs'

interface RestProviderConfig {
  endpoint: string
  authHeader: Record<string, string>
  uploadType: 'multipart' | 'binary'
  /** Multipart only. */
  fields?: Record<string, string>
  extractTranscript: (data: unknown) => string
}

interface RestProviderBuild {
  defaultRegion?: string
  build: (options: {
    apiKey: string
    region: string | undefined
    language: string
    prompt: string | undefined
  }) => RestProviderConfig
}

const text = (data: unknown): string => {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'text' in data) {
    const value = (data as { text?: unknown }).text
    return typeof value === 'string' ? value : ''
  }
  return ''
}

export const PROVIDERS: Record<RestProviderId, RestProviderBuild> = {
  'azure-fr': {
    defaultRegion: 'francecentral',
    build: ({ apiKey, region, language }) => ({
      endpoint:
        `https://${region ?? 'francecentral'}.stt.speech.microsoft.com` +
        `/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}`,
      authHeader: { 'Ocp-Apim-Subscription-Key': apiKey },
      uploadType: 'binary',
      extractTranscript: (data) => {
        if (data && typeof data === 'object' && 'DisplayText' in data) {
          const value = (data as { DisplayText?: unknown }).DisplayText
          return typeof value === 'string' ? value : ''
        }
        return ''
      },
    }),
  },
  'groq-whisper': {
    build: ({ apiKey, language, prompt }) => ({
      endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
      authHeader: { Authorization: `Bearer ${apiKey}` },
      uploadType: 'multipart',
      fields: {
        model: 'whisper-large-v3-turbo',
        temperature: '0',
        response_format: 'json',
        language: iso639(language),
        ...(prompt ? { prompt } : {}),
      },
      extractTranscript: text,
    }),
  },
  'openai-whisper': {
    build: ({ apiKey, language, prompt }) => ({
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      authHeader: { Authorization: `Bearer ${apiKey}` },
      uploadType: 'multipart',
      fields: {
        model: 'whisper-1',
        language: iso639(language),
        ...(prompt ? { prompt } : {}),
      },
      extractTranscript: text,
    }),
  },
  /**
   * ElevenLabs Scribe, reachable since DEC-33 withdrew HR-11.
   *
   * `xi-api-key`, not a bearer token — the one provider here that authenticates
   * on its own header, which is why `authHeader` is a record rather than a
   * string in this table.
   *
   * **No `prompt` field, and its absence is deliberate.** Scribe's
   * `/v1/speech-to-text` takes no prompt, no phrase list and no keyterms; the
   * vocabulary controls belong to ElevenLabs' TTS side. The descriptor says
   * `boost: 'none'` for exactly that reason, so the lexicon is never assembled
   * for this provider rather than being assembled and silently dropped (DEC-17:
   * capability-detected, never assumed). It is worth stating twice because
   * dropping the ESN's own terms on the engine a rep chose *for* accuracy is a
   * worse outcome than not offering the engine.
   *
   * `language_code` takes the bare ISO-639-1 code, as Whisper's does. Passing
   * it rather than letting Scribe detect is DEC-22: v1 asks for one locale and
   * never detects, so a French call cannot be transcribed as something else on
   * the strength of one English sentence in the first ten seconds.
   */
  elevenlabs: {
    build: ({ apiKey, language }) => ({
      endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
      authHeader: { 'xi-api-key': apiKey },
      uploadType: 'multipart',
      fields: {
        model_id: 'scribe_v1',
        language_code: iso639(language),
      },
      extractTranscript: text,
    }),
  },
}

/** `fr-FR` → `fr`. Whisper's `language` field takes the bare ISO-639-1 code. */
const iso639 = (bcp47: string): string => bcp47.split('-')[0] ?? bcp47

/**
 * The region is interpolated into the endpoint hostname, so anything that is
 * not an Azure region label is an SSRF vector. Allow the shape Azure actually
 * uses and nothing else; a rejected value falls back to the provider default
 * rather than poisoning the host.
 */
export const isValidRegion = (region: string | undefined): region is string =>
  typeof region === 'string' && /^[a-z]{2,20}[0-9]?$/.test(region)

/** 16 kHz × 2 bytes × 0.125 s. Short enough that "oui" flushes on its own. */
const MIN_BUFFER_BYTES = 4_000
/**
 * 40 s at 16 kHz mono, against Azure's 60 s ceiling. The margin is not
 * decoration: the buffer arrives at whatever rate the device runs at and is
 * resampled *after* this check, so the cap has to hold for 48 kHz input too.
 */
const MAX_BUFFERED_BYTES = 16_000 * 2 * 40
/** Backstop only. The real trigger is `notifySpeechEnded()` from the native VAD. */
const SAFETY_NET_MS = 8_000
const SILENCE_RMS = 50
const TARGET_RATE = 16_000
const REQUEST_TIMEOUT_MS = 30_000

export interface RestSttOptions extends SttSessionOptions {
  /** DEC-17. False for a provider whose descriptor says it cannot boost. */
  boostAllowed?: boolean
  /**
   * Test seam. The upload is the only impure step in this class, and the
   * invariant worth pinning — that a stopped session uploads the tail exactly
   * once and nothing afterwards — is a behaviour, not a shape. The version this
   * was ported from could only be checked by grepping its own source for a
   * guard, which is how it kept a guard that discarded the tail.
   */
  upload?: (wav: Buffer) => Promise<string>
}

export class RestSttSession extends EventEmitter implements SttSession {
  readonly providerId: RestProviderId

  #config: RestProviderConfig
  #diagnostics: DiagRecorder
  #uploadOverride: ((wav: Buffer) => Promise<string>) | null = null
  #chunks: Buffer[] = []
  #bufferedBytes = 0
  #sampleRate = TARGET_RATE
  #timer: NodeJS.Timeout | null = null
  #active = false
  #uploading = false
  #flushPending = false
  /** Resolves when the last in-flight upload settles, so `stop()` can await it. */
  #inFlight: Promise<void> | null = null

  constructor(providerId: RestProviderId, options: RestSttOptions) {
    super()
    this.providerId = providerId
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    if (options.upload) this.#uploadOverride = options.upload

    const provider = PROVIDERS[providerId]
    const region = isValidRegion(options.region) ? options.region : provider.defaultRegion
    // Boost terms are dropped, not sent, when the provider cannot take them.
    const prompt =
      options.boostAllowed && options.boostTerms?.length ? options.boostTerms.join(', ') : undefined

    this.#config = provider.build({ apiKey: options.apiKey, region, language: options.language, prompt })
  }

  start(): void {
    if (this.#active) return
    this.#active = true
    this.#chunks = []
    this.#bufferedBytes = 0
    this.#timer = setInterval(() => void this.#flush(), SAFETY_NET_MS)
  }

  write(chunk: Buffer, sampleRate: number): void {
    if (!this.#active) return
    this.#sampleRate = sampleRate
    this.#chunks.push(chunk)
    this.#bufferedBytes += chunk.length
    if (this.#bufferedBytes >= MAX_BUFFERED_BYTES) void this.#flush()
  }

  notifySpeechEnded(): void {
    if (!this.#active) return
    void this.#flush()
  }

  /**
   * Stops, flushes what is left, and resolves only once that upload has
   * settled. The last thirty seconds of a meeting are where the next steps get
   * agreed; dropping them because `stop()` returned early is the expensive
   * version of this bug.
   */
  async stop(): Promise<void> {
    if (!this.#active && !this.#inFlight) return
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
    // Close the door to new audio first, then drain. The final flush has to
    // carry `force`, because by then `#active` is false and the ordinary guard
    // — the one that stops a queued re-entrant flush from uploading after the
    // meeting ended — would throw the tail away.
    this.#active = false
    await this.#inFlight
    await this.#flush({ final: true, force: true })
  }

  async #flush(options: { final?: boolean; force?: boolean } = {}): Promise<void> {
    if (!this.#active && !options.force) return
    if (this.#chunks.length === 0) return
    // A final flush takes whatever is there; a routine one waits for enough
    // audio to be worth a round trip.
    if (!options.final && this.#bufferedBytes < MIN_BUFFER_BYTES) return

    if (this.#uploading) {
      this.#flushPending = true
      return
    }

    const pcm = Buffer.concat(this.#chunks)
    this.#chunks = []
    this.#bufferedBytes = 0

    if (isSilent(pcm)) return

    const mono16k = this.#sampleRate === TARGET_RATE ? pcm : downsampleToMono16k(pcm, this.#sampleRate)
    const wav = Buffer.concat([wavHeader(mono16k.length), mono16k])

    this.#uploading = true
    const upload = this.#upload(wav)
      .then((transcript) => {
        const trimmed = transcript.trim()
        if (trimmed.length > 0) this.emit('transcript', { text: trimmed, isFinal: true })
      })
      .catch((error: unknown) => {
        this.#diagnostics.record({
          severity: 'error',
          code: 'transcribe.upload.failed',
          module: 'transcribe',
          message: error instanceof Error ? error.message : String(error),
          detail: { provider: this.providerId, bytes: wav.length },
        })
        this.emit('error', error)
      })
      .finally(() => {
        this.#uploading = false
        this.#inFlight = null
        if (this.#flushPending) {
          this.#flushPending = false
          void this.#flush()
        }
      })

    this.#inFlight = upload
    await upload
  }

  async #upload(wav: Buffer): Promise<string> {
    if (this.#uploadOverride) return this.#uploadOverride(wav)
    if (this.#config.uploadType === 'binary') {
      const response = await axios.post(this.#config.endpoint, wav, {
        headers: { ...this.#config.authHeader, 'Content-Type': 'audio/wav' },
        timeout: REQUEST_TIMEOUT_MS,
      })
      return this.#config.extractTranscript(response.data)
    }

    const form = new FormData()
    form.append('file', wav, { filename: 'audio.wav', contentType: 'audio/wav' })
    for (const [key, value] of Object.entries(this.#config.fields ?? {})) form.append(key, value)

    const response = await axios.post(this.#config.endpoint, form, {
      headers: { ...this.#config.authHeader, ...form.getHeaders() },
      timeout: REQUEST_TIMEOUT_MS,
    })
    return this.#config.extractTranscript(response.data)
  }
}

/** Sampled every 20th frame — enough to tell a room tone from a sentence. */
export const isSilent = (pcm: Buffer): boolean => {
  let sum = 0
  let count = 0
  for (let i = 0; i + 1 < pcm.length; i += 2 * 20) {
    const sample = pcm.readInt16LE(i)
    sum += sample * sample
    count++
  }
  if (count === 0) return true
  return Math.sqrt(sum / count) < SILENCE_RMS
}

/**
 * Integer decimation to 16 kHz mono, matching what the Rust DSP does — the two
 * halves of the pipeline resampling differently is a subtle way to make one
 * channel transcribe worse than the other.
 */
export const downsampleToMono16k = (pcm: Buffer, sampleRate: number, channels = 1): Buffer => {
  const samples = Math.floor(pcm.length / 2)
  const input = new Int16Array(samples)
  for (let i = 0; i < samples; i++) input[i] = pcm.readInt16LE(i * 2)

  let mono = input
  if (channels > 1) {
    const length = Math.floor(input.length / channels)
    mono = new Int16Array(length)
    for (let i = 0; i < length; i++) {
      let sum = 0
      for (let c = 0; c < channels; c++) sum += input[i * channels + c] ?? 0
      mono[i] = Math.round(sum / channels)
    }
  }

  if (sampleRate === TARGET_RATE) return Buffer.from(mono.buffer, mono.byteOffset, mono.length * 2)

  const factor = sampleRate / TARGET_RATE
  const length = Math.floor(mono.length / factor)
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) out[i] = mono[Math.floor(i * factor)] ?? 0
  return Buffer.from(out.buffer, out.byteOffset, out.length * 2)
}

/**
 * A 44-byte RIFF header for 16 kHz mono 16-bit PCM. Most REST endpoints reject
 * raw PCM outright, and Azure's returns an empty `DisplayText` rather than an
 * error when the header is wrong — a silent failure worth not having.
 */
export const wavHeader = (dataLength: number, sampleRate = TARGET_RATE, channels = 1): Buffer => {
  const bitsPerSample = 16
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)
  return header
}
