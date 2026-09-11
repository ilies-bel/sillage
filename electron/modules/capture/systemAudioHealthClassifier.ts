/**
 * **Has a capture channel produced any audio at all?**
 *
 * This was a 137-line `.mjs` module constructed **only in its own test file** —
 * nothing in the product ever asked it anything. That is not one missing import:
 * a `.mjs` inside `electron/` is outside `tsc` entirely (the rule here is that
 * relative imports carry `.ts`), so it was never type-checked against the code
 * it serves and nothing could notice it had no caller. Ported unchanged in
 * behaviour — `handleEvent` and every threshold are what they were — and
 * `capture/index.ts` now drives it.
 *
 * What it catches is the failure this product is built around. On Windows — the
 * primary platform (HR-2) — the loopback taps the *multimedia* default while
 * Teams routes to the communications default, which the rep configures
 * separately and which `speaker/windows.rs` documents as a known hole; a route
 * change mid-call leaves the tap on an endpoint no longer playing; a microphone
 * is muted in hardware. In every case the channel yields nothing,
 * `CaptureSession.#onFrame` returned early on keepalives so `#measure` was never
 * reached, no `InputLevelWatch` was ever created, and `capture.level.tooQuiet`
 * could not fire. The header said « Tout fonctionne » for the length of the call
 * and the compte-rendu described a monologue.
 *
 * Pure and synchronous: events in, a verdict out. It owns no timer, no device
 * and no emitter, which is why it is testable with no audio hardware.
 */

export type HealthEvent =
  | { kind: 'capture-started'; nowMs: number }
  | { kind: 'capture-stopped'; nowMs?: number }
  | { kind: 'chunk'; chunk: Buffer; nowMs: number }
  | { kind: 'watchdog-tick'; nowMs: number }
  | { kind: 'same-device-route-detected'; device?: string; nowMs?: number }

export type HealthOutcome =
  | { type: 'none' }
  | { type: 'log'; level: 'warn' | 'error'; reason: string; message: string; gapMs?: number }
  | { type: 'warn-user'; reason: string; device?: string; terminal: boolean; stuck: boolean }

export interface HealthClassifierOptions {
  watchdogMs?: number
  zeroObservationMs?: number
  meaningfulPeakToPeak?: number
  interChunkGapLogMs?: number
}

const DEFAULT_WATCHDOG_MS = 12_000
const DEFAULT_ZERO_OBSERVATION_MS = 12_000
const DEFAULT_MEANINGFUL_PEAK_TO_PEAK = 100
const DEFAULT_INTER_CHUNK_GAP_LOG_MS = 2_000

function peakToPeakInt16LE(chunk: Buffer): number {
  if (!Buffer.isBuffer(chunk) || chunk.length < 2) return 0

  let min = 32767
  let max = -32768
  const stride = Math.max(2, (chunk.length >> 5) & ~1)
  for (let i = 0; i + 1 < chunk.length; i += stride) {
    const sample = chunk.readInt16LE(i)
    if (sample < min) min = sample
    if (sample > max) max = sample
  }
  return max - min
}

export class SystemAudioHealthClassifier {
  readonly watchdogMs: number
  readonly zeroObservationMs: number
  readonly meaningfulPeakToPeak: number
  readonly interChunkGapLogMs: number
  startedAtMs: number | null = null
  stopped = false
  chunkCount = 0
  firstChunkAtMs: number | null = null
  lastChunkAtMs: number | null = null
  hasMeaningfulSignal = false
  sameDeviceWarningEmitted = false
  noChunkLogEmitted = false
  zeroValuedLogEmitted = false

  static supportedEventKinds = Object.freeze([
    'capture-started',
    'capture-stopped',
    'chunk',
    'watchdog-tick',
    'same-device-route-detected',
  ])

  constructor(options: HealthClassifierOptions = {}) {
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS
    this.zeroObservationMs = options.zeroObservationMs ?? DEFAULT_ZERO_OBSERVATION_MS
    this.meaningfulPeakToPeak = options.meaningfulPeakToPeak ?? DEFAULT_MEANINGFUL_PEAK_TO_PEAK
    this.interChunkGapLogMs = options.interChunkGapLogMs ?? DEFAULT_INTER_CHUNK_GAP_LOG_MS
    this.reset()
  }

  reset(): void {
    this.startedAtMs = null
    this.stopped = false
    this.chunkCount = 0
    this.firstChunkAtMs = null
    this.lastChunkAtMs = null
    this.hasMeaningfulSignal = false
    this.sameDeviceWarningEmitted = false
    this.noChunkLogEmitted = false
    this.zeroValuedLogEmitted = false
  }

  handle(event: HealthEvent): HealthOutcome {
    switch (event.kind) {
      case 'capture-started':
        this.reset()
        this.startedAtMs = event.nowMs
        return { type: 'none' }
      case 'capture-stopped':
        this.stopped = true
        return { type: 'none' }
      case 'same-device-route-detected':
        return this.handleSameDeviceRoute(event)
      case 'watchdog-tick':
        return this.handleWatchdogTick(event)
      case 'chunk':
        return this.handleChunk(event)
      default:
        return { type: 'none' }
    }
  }

  handleSameDeviceRoute(event: Extract<HealthEvent, { kind: 'same-device-route-detected' }>): HealthOutcome {
    if (this.sameDeviceWarningEmitted) return { type: 'none' }
    this.sameDeviceWarningEmitted = true
    return {
      type: 'warn-user',
      reason: 'same-device-input-output',
      ...(event.device === undefined ? {} : { device: event.device }),
      terminal: false,
      stuck: true,
    }
  }

  handleWatchdogTick(event: Extract<HealthEvent, { kind: 'watchdog-tick' }>): HealthOutcome {
    if (this.stopped || this.chunkCount > 0 || this.noChunkLogEmitted) return { type: 'none' }
    const startedAtMs = this.startedAtMs ?? event.nowMs
    if (event.nowMs - startedAtMs < this.watchdogMs) return { type: 'none' }

    this.noChunkLogEmitted = true
    return {
      type: 'log',
      level: 'warn',
      reason: 'initial-silence-no-chunks',
      message: `SystemAudioCapture produced 0 chunks in ${Math.round(this.watchdogMs / 1000)}s — treating as initial silence unless another capture health signal fails.`,
    }
  }

  handleChunk(event: Extract<HealthEvent, { kind: 'chunk' }>): HealthOutcome {
    if (this.stopped) return { type: 'none' }

    const previousChunkAtMs = this.lastChunkAtMs
    this.chunkCount++
    if (this.firstChunkAtMs == null) this.firstChunkAtMs = event.nowMs
    this.lastChunkAtMs = event.nowMs

    const peakToPeak = peakToPeakInt16LE(event.chunk)
    if (peakToPeak > this.meaningfulPeakToPeak) {
      this.hasMeaningfulSignal = true
      return this.maybeInterChunkGapLog(previousChunkAtMs, event.nowMs)
    }

    const zeroObservationStartMs = this.firstChunkAtMs ?? event.nowMs
    if (!this.hasMeaningfulSignal && !this.zeroValuedLogEmitted && event.nowMs - zeroObservationStartMs >= this.zeroObservationMs) {
      this.zeroValuedLogEmitted = true
      return {
        type: 'log',
        level: 'warn',
        reason: 'sustained-zero-valued-silence',
        message: `SystemAudio chunks stayed zero-valued (peak-to-peak <= ${this.meaningfulPeakToPeak}) for ${Math.round(this.zeroObservationMs / 1000)}s — treating as silence unless another capture health signal fails.`,
      }
    }

    return this.maybeInterChunkGapLog(previousChunkAtMs, event.nowMs)
  }

  maybeInterChunkGapLog(previousChunkAtMs: number | null, nowMs: number): HealthOutcome {
    if (previousChunkAtMs == null) return { type: 'none' }
    const gapMs = nowMs - previousChunkAtMs
    if (gapMs <= this.interChunkGapLogMs) return { type: 'none' }
    return {
      type: 'log',
      level: 'warn',
      reason: 'inter-chunk-gap',
      gapMs,
      message: `SystemAudio chunk gap ${gapMs}ms — likely transient route change. Resuming.`,
    }
  }
}

export { peakToPeakInt16LE }
