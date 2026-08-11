/**
 * Is the microphone loud enough to be transcribed at all?
 *
 * This exists because of a meeting that produced one line in two minutes and
 * looked, from the outside, exactly like a broken transcriber. Nothing was
 * broken. The machine's input volume was at 37 %, the loudest 30 ms window in
 * any five-second stretch measured 0.008, and 0.008 is precisely where
 * `whisper/vad.ts` draws the line between speech and silence. The audio was
 * captured, gated, resampled and delivered exactly as designed, and every
 * single frame of it fell under the bar. The pipeline was fed near-silence and
 * said nothing about it for the whole call.
 *
 * DEC-26 says nothing downstream may *stop* a meeting being recorded. It does
 * not say record silence and keep quiet — a recording nobody can read is not
 * the outcome that invariant is protecting. So the level is measured, and when
 * it is too low to work with, the app says so while the rep can still do
 * something about it.
 *
 * **The detector is not a guess about rooms.** Telling "a quiet office" from "a
 * quiet microphone" by absolute level alone is not possible, and a threshold
 * picked by feel would fire through every pause in every meeting. What is used
 * instead is a disagreement between two gates that already exist:
 *
 *   - the Rust suppressor forwards a frame only when it believes it is speech
 *     (`SUPPRESSOR_FLOOR` here, `speech_threshold_rms` there);
 *   - the JS VAD counts a window as speech only above `SPEECH_FLOOR`.
 *
 * A frame that clears the first and fails the second is one the capture layer
 * called speech and the transcriber will silently drop. That band *is* the bug,
 * it cannot be entered by a silent room — silence is suppressed upstream and
 * arrives as zeroes — and it needs no new threshold of its own.
 */

/**
 * `whisper/vad.ts`'s `RMS_THRESHOLD`, as a float amplitude. Below this a window
 * is not speech as far as transcription is concerned, so audio that never gets
 * above it produces no segments however long the meeting runs.
 *
 * Duplicated rather than imported: `core/` may not import `modules/`, and this
 * is the one number both sides have to agree on. `inputLevel.test.ts` asserts
 * they still do, so the copy cannot drift in silence.
 */
export const SPEECH_FLOOR = 0.008

/**
 * `silence_suppression.rs`'s `speech_threshold_rms` (100 on the i16 scale), as
 * a float amplitude. A frame arriving above this was forwarded *because the
 * capture layer decided it was speech*.
 */
export const SUPPRESSOR_FLOOR = 100 / 32_768

/**
 * How much audio the capture layer must have called speech before a verdict is
 * offered at all.
 *
 * Two seconds, and it is spent on frames in the band rather than on wall-clock
 * time, so a meeting that has not started yet never trips it. Below this the
 * verdict is `unknown` — which is the honest answer at the top of a call and,
 * more importantly, is what stops a throat-clear in the first second from
 * putting a warning on screen before anyone has spoken.
 */
export const MIN_OBSERVED_MS = 2_000

/**
 * The share of capture-layer speech that must be under `SPEECH_FLOOR` before
 * the microphone is called too quiet.
 *
 * High on purpose. Every utterance has quiet edges — the suppressor's 500 ms
 * hangover appends a decaying tail to each run — so a healthy microphone still
 * spends a real fraction of its speech under the bar. What it does not do is
 * spend *nearly all* of it there. At 37 % input volume the observed share was
 * total: not one window in five seconds cleared the floor.
 */
export const TOO_QUIET_RATIO = 0.9

export type InputLevel = 'unknown' | 'ok' | 'tooQuiet'

/**
 * Rolling verdict over one channel's frames.
 *
 * Deliberately holds four numbers and allocates nothing: it is fed from the
 * capture path, which may not acquire a dependency, an allocation per frame or
 * a reason to fail (DEC-26). Arithmetic on a buffer already in hand is none of
 * those three, which is the same argument that lets the keepalive zero-test sit
 * there.
 */
export class InputLevelWatch {
  #observedMs = 0
  #quietMs = 0
  #peak = 0
  #recentPeak = 0
  #verdict: InputLevel = 'unknown'

  /**
   * One window of audio the capture layer forwarded.
   *
   * `rms` is the amplitude of that window and `durationMs` its length. Windows
   * below `SUPPRESSOR_FLOOR` are ignored rather than counted as quiet: they are
   * keepalives and hangover tails, which is to say silence the capture layer
   * already judged, and counting them would make every pause evidence.
   */
  push(rms: number, durationMs: number): void {
    if (rms > this.#peak) this.#peak = rms
    if (rms > this.#recentPeak) this.#recentPeak = rms
    if (rms < SUPPRESSOR_FLOOR) return

    this.#observedMs += durationMs
    if (rms < SPEECH_FLOOR) this.#quietMs += durationMs

    if (this.#observedMs < MIN_OBSERVED_MS) return
    this.#verdict = this.#quietMs / this.#observedMs >= TOO_QUIET_RATIO ? 'tooQuiet' : 'ok'
  }

  get verdict(): InputLevel {
    return this.#verdict
  }

  /** The loudest window seen, for the diagnostic that names the measurement. */
  get peak(): number {
    return this.#peak
  }

  /**
   * The loudest window since this was last called, and resets on read — the
   * peak-meter idiom, and the number the in-call level meter draws.
   *
   * Read on a timer rather than pushed per frame, which is what keeps a
   * cosmetic surface off the capture path. Frames arrive every 20 ms and the
   * meter redraws ten times a second; emitting an event per frame so the
   * renderer could throw 80 % of them away would put five times the work on the
   * one path DEC-26 says nothing may be allowed to slow down.
   *
   * Resetting is what makes a *dropped* reader safe: a meter that stops being
   * polled leaves a stale maximum behind, and the next poll after a pause would
   * otherwise report a peak from a minute ago as if it were now.
   */
  takeRecentPeak(): number {
    const peak = this.#recentPeak
    this.#recentPeak = 0
    return peak
  }

  /** Speech the capture layer forwarded, in ms — the denominator of the ratio. */
  get observedMs(): number {
    return this.#observedMs
  }
}

/**
 * Amplitude of an Int16LE buffer, without materialising a Float32 copy.
 *
 * Every fourth sample, which is the same shortcut `calculate_rms` takes in
 * Rust: eighty samples of a twenty-millisecond frame settle an amplitude
 * question well past the precision any threshold here deserves.
 */
export const rmsOfInt16 = (chunk: Buffer): number => {
  const samples = chunk.byteLength >> 1
  if (samples === 0) return 0
  let sum = 0
  let counted = 0
  for (let i = 0; i < samples; i += 4) {
    const s = chunk.readInt16LE(i * 2)
    sum += s * s
    counted++
  }
  return Math.sqrt(sum / counted) / 32_768
}
