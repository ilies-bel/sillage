/**
 * `CaptureSession` — both channels, one lifecycle.
 *
 * Speaker attribution is free from the hardware (VISION.md §5): the microphone
 * is the rep, the system loopback is everyone on the far end. There is no
 * diarization in v1 and there does not need to be.
 *
 * **This module has zero network dependencies** (DEC-26). It imports nothing
 * that can fail because a server is down, and nothing downstream may prevent a
 * meeting from being recorded. A rep on a train with no connection loses
 * nothing but timing.
 *
 * The ordering rules below are not stylistic. Each is in
 * `docs/reference/capture-invariants.md` because it was a bug first.
 */
import { EventEmitter } from 'node:events'
import type { Channel } from '../../core/contracts/transcript.ts'
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import { InputLevelWatch, rmsOfInt16, type InputLevel } from '../../core/domain/inputLevel.ts'
import { MicrophoneCapture } from './MicrophoneCapture.ts'
import { SystemAudioCapture } from './SystemAudioCapture.ts'
import { loadNativeModule } from './nativeModule.ts'

export { MicrophoneCapture } from './MicrophoneCapture.ts'
export { SystemAudioCapture } from './SystemAudioCapture.ts'
export { FileCapture, readWav, toMono } from './FileCapture.ts'
export type { FileCaptureOptions, FileCaptureSource, WavAudio } from './FileCapture.ts'
export * from './AudioDevices.ts'
export * from './nativeModule.ts'

export interface AudioFrame {
  channel: Channel
  chunk: Buffer
  /** The rate these bytes are at — canonical 16 kHz after the Rust resampler. */
  sampleRate: number
}

export interface CaptureOptions {
  micDeviceId?: string | null
  systemDeviceId?: string | null
  diagnostics?: DiagRecorder
  clock?: () => number
}

export interface CaptureSessionEvents {
  frame: (frame: AudioFrame) => void
  speechEnded: (channel: Channel) => void
  /**
   * Speech resumed on a channel that had gone quiet — the other half of
   * `speechEnded`, and the half DEC-16 cannot work without.
   *
   * The Rust suppressor only signals the speech→silence edge, so on its own
   * "no `speechEnded` for 75 seconds" is ambiguous: it is equally true of an
   * empty room and of somebody talking without pause. This edge disambiguates
   * it, and it is free — the suppressor already replaces a suppressed frame
   * with a zero-filled keepalive, so a frame that is not all zeros *is* speech.
   */
  speechStarted: (channel: Channel) => void
  /**
   * The channel's input level crossed into or out of the band where capture
   * forwards audio the transcriber will never see. Edges only, never per
   * frame — see `core/domain/inputLevel.ts` for what the band is and why it
   * cannot be entered by a quiet room.
   */
  level: (channel: Channel, level: InputLevel, peak: number) => void
  health: (health: ConnectorHealth) => void
  error: (channel: Channel, error: unknown) => void
}

/**
 * A keepalive frame, emitted by the Rust suppressor to keep a streaming API's
 * clock running through silence. Zero-filled by construction, so this is an
 * exact test rather than a threshold — the level decision was already made in
 * Rust and second-guessing it here would give two VADs that disagree.
 */
const isKeepalive = (chunk: Buffer): boolean => {
  for (let i = 0; i < chunk.length; i += 1) if (chunk[i] !== 0) return false
  return true
}

/**
 * What `app/` is allowed to depend on: a thing that produces frames.
 *
 * The devices are one implementation and `FileCapture` is another. Declaring the
 * port is what makes the second one a capture source rather than a cast — the
 * concrete class carries `#private` fields, so a structurally identical replay
 * would not be assignable to it and every call site would need `as never`. That
 * cast was already in the tests; a fixture is a poor reason to spread it.
 */
export interface CapturePort extends EventEmitter {
  readonly running: boolean
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * Peak amplitude per channel since the last call, for the in-call level
   * meter. Optional because it is a cosmetic read: `FileCapture` replays a wav
   * and has no meter to feed, and a replay fixture should not have to grow a
   * method to stay assignable to this port.
   */
  takeLevels?(): Record<Channel, number>
}

/**
 * Owns one meeting's audio. Constructed per meeting and never reused: the Rust
 * monitors tear down their platform handles on stop, and starting the same
 * instance again leaves the CoreAudio Tap half-initialised — the "second
 * meeting produces 0 chunks in 8s" failure.
 */
export class CaptureSession extends EventEmitter {
  #mic: MicrophoneCapture | null = null
  #system: SystemAudioCapture | null = null
  #options: CaptureOptions
  #diagnostics: DiagRecorder
  #running = false
  /**
   * A stop in flight. Every entry point awaits it before starting, so a restart
   * that races a teardown cannot open a second handle on the same device.
   */
  #teardown: Promise<void> | null = null
  /**
   * Invalidates work that resumes after an await. Every step that yields
   * re-checks it — a start that was superseded while awaiting the previous
   * teardown must not go on to open devices for a meeting that already ended.
   */
  #generation = 0

  constructor(options: CaptureOptions = {}) {
    super()
    this.#options = options
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
  }

  /**
   * Per channel: is speech in progress? Absent until the first frame, which is
   * what makes the very first word emit an edge rather than being swallowed as
   * "already speaking".
   */
  #speaking = new Map<Channel, boolean>()

  /** Per channel: is the level high enough to be transcribed? */
  #levels = new Map<Channel, InputLevelWatch>()
  #reported = new Map<Channel, InputLevel>()

  /**
   * The silence→speech edge, emitted once per stretch rather than per frame,
   * and the input-level measurement that rides along with it.
   *
   * Deliberately does no work beyond arithmetic on a buffer already in hand:
   * this sits on the capture path, which may not acquire a dependency, an
   * allocation per frame, or a reason to fail (DEC-26). The amplitude is none
   * of those three — it is eighty multiply-adds over bytes that are already
   * here, which is the same argument that admits the zero test above it.
   */
  #onFrame(channel: Channel, chunk: Buffer, sampleRate: number): void {
    if (isKeepalive(chunk)) return

    this.#measure(channel, chunk, sampleRate)

    if (this.#speaking.get(channel) === true) return
    this.#speaking.set(channel, true)
    this.emit('speechStarted', channel)
  }

  /**
   * Reports the *edges* of the verdict and nothing else.
   *
   * A meeting is thousands of frames and the answer changes at most twice, so
   * emitting per frame would put a rule about noticing something on the path
   * DEC-26 protects. The diagnostic quotes the measurement rather than a
   * grade: « niveau d'entrée très faible » with a number beside it is
   * actionable; « micro faible » sends someone to read this file.
   */
  #measure(channel: Channel, chunk: Buffer, sampleRate: number): void {
    let watch = this.#levels.get(channel)
    if (!watch) {
      watch = new InputLevelWatch()
      this.#levels.set(channel, watch)
    }

    const rate = sampleRate > 0 ? sampleRate : 16_000
    watch.push(rmsOfInt16(chunk), ((chunk.byteLength >> 1) / rate) * 1_000)

    const verdict = watch.verdict
    if (verdict === 'unknown' || this.#reported.get(channel) === verdict) return
    this.#reported.set(channel, verdict)

    this.emit('level', channel, verdict, watch.peak)
    this.#diagnostics.record({
      severity: verdict === 'tooQuiet' ? 'warn' : 'info',
      code: verdict === 'tooQuiet' ? 'capture.level.tooQuiet' : 'capture.level.ok',
      module: 'capture',
      message:
        verdict === 'tooQuiet'
          ? `niveau d’entrée trop faible pour être transcrit (crête ${watch.peak.toFixed(4)})`
          : `niveau d’entrée suffisant (crête ${watch.peak.toFixed(4)})`,
      detail: { channel, peak: Number(watch.peak.toFixed(4)) },
    })
  }

  /**
   * Peak amplitude per channel since the last call — the level meter's whole
   * data source, and deliberately a *pull*.
   *
   * A channel that has produced nothing since the last read returns 0, which is
   * the honest answer for both a silent room and a dead device. Telling those
   * two apart is what `verdict` is for; this is the sub-second needle.
   */
  takeLevels(): Record<Channel, number> {
    return {
      rep: this.#levels.get('rep')?.takeRecentPeak() ?? 0,
      far: this.#levels.get('far')?.takeRecentPeak() ?? 0,
    }
  }

  #onSpeechEnded(channel: Channel): void {
    this.#speaking.set(channel, false)
    this.emit('speechEnded', channel)
  }

  get running(): boolean {
    return this.#running
  }

  /** Whether the binary is loadable at all, with the reason when it is not. */
  static probe(): ConnectorHealth {
    const result = loadNativeModule()
    if (result.ok) return { state: 'ok' }
    return {
      state: 'down',
      reason: `module audio natif indisponible — ${result.reason}`,
      since: Date.now(),
      retryable: false,
    }
  }

  /**
   * Starts both channels, **microphone first, on every path**.
   *
   * The order is the invariant, not an accident. Opening the system loopback
   * first and the microphone second lets a Bluetooth headset negotiate HFP
   * "call mode" after the output tap is already bound, which collapses the
   * *output* to 8 kHz narrowband for the whole meeting. Mic first means the
   * profile is settled before the tap attaches.
   */
  async start(): Promise<void> {
    const generation = ++this.#generation

    if (this.#teardown) await this.#teardown
    // Re-checked after the await: the caller may have ended the meeting while
    // the previous teardown was draining.
    if (generation !== this.#generation) return
    if (this.#running) return

    this.#running = true

    const mic = new MicrophoneCapture(this.#options.micDeviceId ?? null)
    this.#mic = mic
    mic.on('data', (chunk: Buffer) => {
      const sampleRate = mic.getSampleRate()
      this.#onFrame('rep', chunk, sampleRate)
      this.emit('frame', { channel: 'rep', chunk, sampleRate })
    })
    mic.on('speech_ended', () => this.#onSpeechEnded('rep'))
    mic.on('error', (error: unknown) => this.#onError('rep', error))
    mic.on('pre_warm_failed', (error: unknown) =>
      this.#record('warn', 'capture.mic.preWarmFailed', error),
    )

    try {
      mic.start()
    } catch (error) {
      // A microphone that will not open is fatal to the meeting — the rep's own
      // half of the conversation is the half the compte-rendu is written from.
      this.#running = false
      this.#mic = null
      this.#onError('rep', error)
      throw error
    }

    if (generation !== this.#generation) {
      await this.stop()
      return
    }

    const system = new SystemAudioCapture(this.#options.systemDeviceId ?? null)
    this.#system = system
    system.on('data', (chunk: Buffer) => {
      const sampleRate = system.getSampleRate()
      this.#onFrame('far', chunk, sampleRate)
      this.emit('frame', { channel: 'far', chunk, sampleRate })
    })
    system.on('speech_ended', () => this.#onSpeechEnded('far'))
    // The system channel degrades rather than throws: losing the far end costs
    // the prospect's words, and recording the rep alone is still worth having.
    system.on('error', (error: unknown) => this.#onError('far', error))
    system.start()

    this.emit('health', { state: 'ok' })
  }

  /**
   * Stops both channels and resolves once the platform handles are genuinely
   * released — not when the JS objects say they are stopped.
   *
   * The fields are nulled synchronously and the awaiting is threaded through
   * `#teardown`, so a `start()` arriving mid-stop joins the same teardown
   * instead of racing it for the device.
   */
  async stop(): Promise<void> {
    this.#generation++
    if (!this.#running && !this.#teardown) return this.#teardown ?? undefined
    this.#running = false

    const mic = this.#mic
    const system = this.#system
    this.#mic = null
    this.#system = null

    const teardown = (async () => {
      // The rep's channel goes last, mirroring the start order: the system tap
      // must not outlive the mic and re-trigger the HFP negotiation on the way
      // out.
      await system?.destroy()
      mic?.disablePreWarm()
      await mic?.destroy()
    })()

    this.#teardown = teardown
    try {
      await teardown
    } finally {
      if (this.#teardown === teardown) this.#teardown = null
    }
    return undefined
  }

  #onError(channel: Channel, error: unknown): void {
    this.#record('error', `capture.${channel}.error`, error)
    this.emit('error', channel, error)
    this.emit('health', {
      state: 'degraded',
      reason:
        channel === 'rep'
          ? `micro indisponible — ${message(error)}`
          : `audio système indisponible — ${message(error)}`,
      since: (this.#options.clock ?? Date.now)(),
      retryable: true,
    })
  }

  #record(severity: 'warn' | 'error', code: string, error: unknown): void {
    this.#diagnostics.record({
      severity,
      code,
      module: 'capture',
      message: message(error),
      detail: {},
    })
  }
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
