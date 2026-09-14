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

export type HealthOutcome =
  | { type: 'none' }
  | { type: 'log'; level: 'warn' | 'error'; reason: string; message: string; gapMs?: number }

/*
 * **`warn-user` and `same-device-route-detected` were removed, not renamed.**
 *
 * The event declared a condition worth knowing — a headset used as both input
 * and output, where the loopback tap picks up the microphone — and **nothing
 * could produce it**: the native surface offers `getInputDevices`,
 * `getOutputDevices` and `getDefaultOutputDeviceId`, none of which says which
 * input device is the default, so there is nothing to compare. It had a type, a
 * handler, a test and a French sentence in `index.ts` that no run of this
 * product could reach.
 *
 * Bringing it back means adding `getDefaultInputDeviceId` to the native module
 * first. Until that exists this is a condition the app cannot measure, and
 * `core/domain/capturePermission.ts` already states the rule for those: « we did
 * not measure it » is never reported as a finding (DEC-45).
 */

export interface HealthClassifierOptions {
  watchdogMs?: number
  stallMs?: number
  zeroObservationMs?: number
  meaningfulPeakToPeak?: number
  interChunkGapLogMs?: number
}

const DEFAULT_WATCHDOG_MS = 12_000
const DEFAULT_ZERO_OBSERVATION_MS = 12_000
const DEFAULT_MEANINGFUL_PEAK_TO_PEAK = 100
const DEFAULT_INTER_CHUNK_GAP_LOG_MS = 2_000
/**
 * How long a channel that **was** producing may produce nothing before it is
 * reported. Longer than `interChunkGapLogMs`, which is a stutter; this is a
 * channel that stopped.
 */
const DEFAULT_STALL_MS = 8_000

function peakToPeakInt16LE(chunk: Buffer): number {
  if (!Buffer.isBuffer(chunk) || chunk.length < 2) return 0

  let min = 32767
  let max = -32768
  /*
   * **An odd stride, in samples, and that is not a detail.**
   *
   * This strode by `(length >> 5) & ~1` *bytes* — twenty on a 640-byte frame,
   * which is ten samples, which is **even**. So it read sample 0, 10, 20, 40…
   * and every one of those has the same parity: a signal that alternates sign
   * every sample came back with `min === max` and a peak-to-peak of **zero**,
   * from a waveform at full scale. A detector whose one job is to tell zero from
   * not-zero could be made to report silence by a periodic signal whose period
   * divides its own step.
   *
   * Odd, so no period that is a power of two can stay in phase with it, and
   * counted in samples so the arithmetic says what it means. The `| 1` is the
   * whole fix and the `Math.max` keeps it a step.
   */
  const samples = chunk.length >> 1
  const stride = Math.max(1, samples >> 5) | 1
  for (let i = 0; i < samples; i += stride) {
    const sample = chunk.readInt16LE(i * 2)
    if (sample < min) min = sample
    if (sample > max) max = sample
  }
  return max - min
}

export class SystemAudioHealthClassifier {
  readonly watchdogMs: number
  readonly stallMs: number
  readonly zeroObservationMs: number
  readonly meaningfulPeakToPeak: number
  readonly interChunkGapLogMs: number
  startedAtMs: number | null = null
  stopped = false
  chunkCount = 0
  firstChunkAtMs: number | null = null
  lastChunkAtMs: number | null = null
  hasMeaningfulSignal = false
  noChunkLogEmitted = false
  zeroValuedLogEmitted = false
  stalledLogEmitted = false

  static supportedEventKinds = Object.freeze([
    'capture-started',
    'capture-stopped',
    'chunk',
    'watchdog-tick',
  ])

  constructor(options: HealthClassifierOptions = {}) {
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS
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
    this.noChunkLogEmitted = false
    this.zeroValuedLogEmitted = false
    this.stalledLogEmitted = false
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
      case 'watchdog-tick':
        return this.handleWatchdogTick(event)
      case 'chunk':
        return this.handleChunk(event)
      default:
        return { type: 'none' }
    }
  }

  handleWatchdogTick(event: Extract<HealthEvent, { kind: 'watchdog-tick' }>): HealthOutcome {
    if (this.stopped) return { type: 'none' }

    /*
     * **A channel that was producing and stopped, which nothing could notice.**
     *
     * The header of this file claims it catches « a route change mid-call [that]
     * leaves the tap on an endpoint no longer playing ». It did not: the guard
     * below returns early on `chunkCount > 0`, so the **first** chunk disarmed
     * the watchdog for the rest of the meeting, and `maybeInterChunkGapLog` —
     * the only other thing that looks at the interval — fires from `handleChunk`,
     * which is exactly what never comes again. Executed over a fifty-minute call
     * whose far half died at 1:00, this classifier said **nothing**, 3000 chunks
     * and forty-nine silent minutes later.
     *
     * On Windows there is no backstop at all: `SystemAudioCapture` has no
     * runtime error channel to JS — `tsfn.call(Err(..))` appears only in the
     * three init branches — so `AUDCLNT_E_DEVICE_INVALIDATED` from an unplugged
     * headset is a `continue` in a loop with no way to say so. The rep finishes
     * the call, the header says « Tout fonctionne », and the compte-rendu is
     * folded from half a transcript.
     *
     * Once per meeting, like the other two: a channel that comes back says
     * nothing new, and one that does not has already been said.
     */
    if (this.chunkCount > 0) {
      if (this.stalledLogEmitted || this.lastChunkAtMs === null) return { type: 'none' }
      const silentFor = event.nowMs - this.lastChunkAtMs
      if (silentFor < this.stallMs) return { type: 'none' }
      this.stalledLogEmitted = true
      return {
        type: 'log',
        level: 'warn',
        reason: 'stalled-mid-capture',
        gapMs: silentFor,
        message: `ce canal ne produit plus rien depuis ${Math.round(silentFor / 1000)}\u00a0s — la capture continue mais rien n’arrive`,
      }
    }

    if (this.noChunkLogEmitted) return { type: 'none' }
    const startedAtMs = this.startedAtMs ?? event.nowMs
    if (event.nowMs - startedAtMs < this.watchdogMs) return { type: 'none' }

    this.noChunkLogEmitted = true
    return {
      type: 'log',
      level: 'warn',
      reason: 'initial-silence-no-chunks',
      message: `aucune donnée reçue sur ce canal en ${Math.round(this.watchdogMs / 1000)}\u00a0s — traité comme un silence initial tant qu’aucun autre signal de capture n’échoue`,
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
        message: `signal à zéro sur ce canal (crête à crête <= ${this.meaningfulPeakToPeak}) pendant ${Math.round(this.zeroObservationMs / 1000)}\u00a0s — traité comme un silence tant qu’aucun autre signal de capture n’échoue`,
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
      message: `interruption de ${gapMs}\u00a0ms sur ce canal — probablement un changement de périphérique passager, la capture reprend`,
    }
  }
}

export { peakToPeakInt16LE }
