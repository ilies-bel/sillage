/**
 * Energy-based voice activity detection at 16 kHz — the segmenter, not a gate.
 *
 * Whisper is a batch model: it needs a bounded utterance, not a stream. This
 * carves the incoming frames into utterances so each one becomes exactly one
 * inference. It is a second VAD — `modules/capture/` has the Rust one, whose
 * verdict arrives as `notifySpeechEnded()` — and both exist for different
 * reasons: the native one says *when* an utterance ended, this one holds the
 * samples that were in it.
 *
 * 30 ms windows (480 samples), RMS threshold 0.008, ~300 ms hangover, 120 ms of
 * real speech minimum so a chair scrape is not transcribed.
 *
 * The hangover ends a *run* of speech, not an utterance: runs are packed
 * together up to `TARGET_SEGMENT_MS` before anything is emitted, and the pauses
 * between them are dropped rather than transcribed. See that constant — it is
 * the difference between this keeping up with a meeting and not.
 */

export interface SpeechSegment {
  samples: Float32Array
  durationMs: number
}

const WINDOW_SIZE = 480
const WINDOW_MS = 30
/**
 * Exported for `modules/transcribe/__tests__/inputLevelDrift.test.ts`, which
 * holds it equal to `core/domain/inputLevel.ts`'s `SPEECH_FLOOR`. That file
 * cannot import this one — `core/` may import nothing but `core/` — so the
 * number is duplicated there and pinned here, rather than left to drift into a
 * warning that is quietly wrong about its own threshold.
 */
export const RMS_THRESHOLD = 0.008
const HANGOVER_FRAMES = 10

/**
 * Speech is **packed** up to this length before an utterance is emitted, across
 * the short pauses inside it.
 *
 * This is the single biggest throughput decision in the offline floor, and it
 * comes from how Whisper is shaped rather than from anything about meetings:
 * every input is padded to a fixed 30-second mel window, so **a 1-second
 * utterance costs the same inference as a 25-second one**. Segmenting on every
 * natural pause — which is what the version this is ported from did, because it
 * was serving a live assistant that had to answer fast — turns five minutes of
 * conversation into ninety full-price inferences. Measured on an M1 Max, that is
 * roughly twenty times more compute than the same audio packed, and it is why a
 * five-minute call left eighty-five utterances still queued when it ended.
 *
 * A notetaker can afford the latency this costs — *except for the first
 * utterance of a meeting*, which is why `FIRST_SEGMENT_MS` exists below.
 * Nothing downstream reads a segment until the meeting ends (DEC-5), so the
 * packing is free to everything except the one reader that is not downstream:
 * the rep, watching the pane.
 *
 * **Why 8 s and not the 20 s this started at.** 20 s was chosen from the shape
 * of the model alone, and it made the pane update three times a minute — which
 * a rep reported, correctly, as the tool not working. The number that decides
 * how low this can go is the *fixed* cost of one inference, and it was measured
 * rather than reasoned about. Real French speech, whisper-small q8, CPU:
 *
 *      1 s audio → 3232 ms   (3.23× realtime)
 *      2 s audio → 2869 ms   (1.43×)
 *      5 s audio → 4015 ms   (0.80×)
 *     10 s audio → 3687 ms   (0.37×)
 *     20 s audio → 5922 ms   (0.30×)
 *
 * About 2.9 s of that is fixed — the encoder runs Whisper's full 30-second
 * window whatever it is given. So the ratio is set almost entirely by how much
 * speech rides along with it, and the floor is not a preference: at 2 s a single
 * channel is already at 1.43× realtime and its queue grows without bound.
 *
 * 8 s sits at roughly 0.45× per channel. Two channels through one worker is
 * ~0.9× in the worst case — both sides talking continuously, which is not a
 * meeting — and about half that in a real one, where people take turns. It
 * halves again the moment the model is `whisper-base`.
 */
const TARGET_SEGMENT_MS = 8_000

/**
 * What the *first* utterance of a meeting costs instead.
 *
 * The packing above is correct and stays. What it got wrong is who is waiting.
 * `Orchestrator` calls the transcript pane "the cheap, deterministic proof the
 * tool is working" (DEC-14) — and with a flat 20 s target plus a few seconds of
 * model load, that pane stays empty for around 25 seconds at the top of every
 * meeting. Observed, not theorised: an 8-second test recording produced one
 * correct segment that arrived 6 seconds *after* the meeting ended, and the
 * reasonable conclusion drawn from a blank pane was that transcription was
 * broken.
 *
 * A rep who concludes that mid-call stops trusting the tool, and no amount of
 * throughput further in buys that back. So the first utterance is emitted as
 * soon as there is a real one, and every utterance after it packs as before.
 *
 * The cost is exactly one extra full-price inference per meeting — about a
 * second on an M1 Max — which is the cheapest proof of life available.
 */
const FIRST_SEGMENT_MS = 2_000
/**
 * Frames that were *actually above the threshold*, not frames spent inside the
 * segment. The version this is ported from counted the latter, which quietly
 * disabled the guard: a 60 ms door slam opens a segment, the ten hangover
 * frames are counted as speech too, and the resulting 360 ms of near-silence
 * clears a four-frame minimum every time. Whisper then answers that with
 * subtitle boilerplate — the exact input the hallucination filter exists to
 * catch, generated by the code meant to prevent it.
 */
const MIN_VOICED_FRAMES = 4
/**
 * The hard cap, and it is 25 s rather than 30 for a reason: at 30 the input
 * exactly fills Whisper's window, and anything over it makes transformers chunk
 * internally with its own overlap logic — a second code path deciding where
 * words begin, on top of this one. Staying under the window keeps segmentation
 * in one place.
 */
const MAX_SPEECH_MS = 25_000
/**
 * How much audio is carried across a forced cut. Without it, Whisper's first
 * words after the boundary are routinely dropped — it has no acoustic context
 * and no decoder conditioning at a hard edge. 300 ms is enough to re-attack a
 * word, and it is the case that actually happens in a sales call: someone
 * explaining an offer for forty seconds without pausing.
 */
const TAIL_FRAMES = 10

const rms = (samples: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0
    sum += s * s
  }
  return Math.sqrt(sum / samples.length)
}

export class Vad {
  #carry: Float32Array[] = []
  #speech: Float32Array[] = []
  #hangover = 0
  #inSpeech = false
  #voiced = 0
  #durationMs = 0
  /**
   * Utterances emitted by this Vad, which is one per channel per meeting.
   * Only ever compared against zero — it exists to answer "is this the first
   * one", and `#reset()` deliberately does not clear it.
   */
  #emitted = 0

  /** Returns every utterance that closed inside this chunk. Usually none. */
  push(samples: Float32Array): SpeechSegment[] {
    const segments: SpeechSegment[] = []

    let input = samples
    if (this.#carry.length > 0) {
      input = concat([...this.#carry, samples])
      this.#carry = []
    }

    let offset = 0
    while (offset + WINDOW_SIZE <= input.length) {
      const window = input.subarray(offset, offset + WINDOW_SIZE)
      offset += WINDOW_SIZE

      const isSpeech = rms(window) >= RMS_THRESHOLD

      if (isSpeech) {
        this.#hangover = HANGOVER_FRAMES
        // Resuming into a partial utterance must not wipe it. The counters are
        // cleared only when the buffer is genuinely empty — which is to say,
        // only after `#reset()` has emitted whatever was there.
        if (!this.#inSpeech) {
          this.#inSpeech = true
          if (this.#speech.length === 0) {
            this.#voiced = 0
            this.#durationMs = 0
          }
        }
      }

      if (!this.#inSpeech) continue

      this.#speech.push(window.slice())
      this.#durationMs += WINDOW_MS
      if (isSpeech) this.#voiced++
      else this.#hangover--

      if (this.#durationMs >= MAX_SPEECH_MS) {
        const forced = this.#cutWithTail()
        // Counts too: someone who talks for 25 s without a pause has had their
        // proof of life, and the next utterance should pack normally.
        if (forced) {
          segments.push(forced)
          this.#emitted++
        }
      } else if (this.#hangover <= 0) {
        // The pause ends this *run*, not necessarily this utterance. Below the
        // target, the buffer is kept and the next run appends to it — the pause
        // itself is dropped, so what Whisper receives is contiguous speech
        // rather than speech with a gap in it. Only `#inSpeech` flips; the
        // accumulated audio survives until it is worth an inference.
        // `MIN_VOICED_FRAMES` still applies to the first one. Proof of life has
        // to be the rep's own words — a door slam transcribed into subtitle
        // boilerplate is worse than a pane that is still empty.
        const target = this.#emitted === 0 ? FIRST_SEGMENT_MS : TARGET_SEGMENT_MS
        if (this.#durationMs >= target && this.#voiced >= MIN_VOICED_FRAMES) {
          const closed = this.#build()
          if (closed) {
            segments.push(closed)
            this.#emitted++
          }
          this.#reset()
        } else {
          this.#inSpeech = false
          this.#hangover = 0
        }
      }
    }

    if (offset < input.length) this.#carry.push(input.subarray(offset).slice())

    return segments
  }

  /**
   * Closes the open utterance and returns it. Called when the native VAD says
   * speech ended, and again at meeting end.
   */
  flush(): SpeechSegment[] {
    const segments: SpeechSegment[] = []
    // Not `#inSpeech`: between two runs of a packed utterance the flag is false
    // while the audio is still held. Gating on the flag here would discard
    // everything said before the last pause — including, at meeting end, the
    // part where the next steps get agreed.
    if (this.#speech.length > 0 && this.#voiced >= MIN_VOICED_FRAMES) {
      const seg = this.#build()
      if (seg) segments.push(seg)
    }
    this.#reset()
    this.#carry = []
    return segments
  }

  /** Whether anything is held — mid-run or between the runs of one utterance. */
  get inSpeech(): boolean {
    return this.#inSpeech || this.#speech.length > 0
  }

  /**
   * The forced cut at `MAX_SPEECH_MS`, with the last 300 ms carried into a
   * freshly-opened segment so the two inferences overlap.
   */
  #cutWithTail(): SpeechSegment | null {
    const seg = this.#build()
    const tail = this.#speech.slice(-Math.min(TAIL_FRAMES, this.#speech.length))
    this.#reset()

    if (tail.length > 0) {
      this.#inSpeech = true
      this.#speech = tail
      this.#voiced = tail.length
      this.#durationMs = tail.length * WINDOW_MS
      this.#hangover = HANGOVER_FRAMES
    }
    return seg
  }

  #build(): SpeechSegment | null {
    if (this.#speech.length === 0) return null
    return { samples: concat(this.#speech), durationMs: this.#durationMs }
  }

  #reset(): void {
    this.#inSpeech = false
    this.#hangover = 0
    this.#voiced = 0
    this.#durationMs = 0
    this.#speech = []
  }
}

const concat = (frames: Float32Array[]): Float32Array => {
  let total = 0
  for (const f of frames) total += f.length
  const out = new Float32Array(total)
  let pos = 0
  for (const f of frames) {
    out.set(f, pos)
    pos += f.length
  }
  return out
}
