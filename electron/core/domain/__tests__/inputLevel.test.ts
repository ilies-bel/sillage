import test from 'node:test'
import assert from 'node:assert/strict'
import {
  InputLevelWatch,
  MIN_OBSERVED_MS,
  SPEECH_FLOOR,
  SUPPRESSOR_FLOOR,
  rmsOfInt16,
} from '../inputLevel.ts'

/** A 20 ms frame at 16 kHz whose windows all sit at `amplitude`. */
const frameAt = (amplitude: number): Buffer => {
  const buf = Buffer.alloc(320 * 2)
  const value = Math.round(amplitude * 32_768)
  for (let i = 0; i < 320; i++) buf.writeInt16LE(value, i * 2)
  return buf
}

const feed = (watch: InputLevelWatch, rms: number, ms: number): void => {
  for (let spent = 0; spent < ms; spent += 20) watch.push(rms, 20)
}

test('no verdict before enough speech has been observed', () => {
  const watch = new InputLevelWatch()
  feed(watch, SPEECH_FLOOR / 2, MIN_OBSERVED_MS - 100)
  // The honest answer at the top of a call. A warning drawn here would appear
  // before the rep has finished saying bonjour.
  assert.equal(watch.verdict, 'unknown')
})

test('speech the transcriber will never see is called too quiet', () => {
  const watch = new InputLevelWatch()
  // Above the suppressor, so capture forwarded it as speech; below the VAD, so
  // `whisper/vad.ts` drops every window of it. This is the 37 %-input-volume
  // meeting, which produced exactly one line in two minutes.
  feed(watch, (SUPPRESSOR_FLOOR + SPEECH_FLOOR) / 2, MIN_OBSERVED_MS + 200)
  assert.equal(watch.verdict, 'tooQuiet')
})

test('a healthy microphone is not called quiet by its own hangover tails', () => {
  const watch = new InputLevelWatch()
  // Real speech: loud runs with decaying edges. The suppressor's 500 ms
  // hangover means a working meeting always carries some audio under the
  // floor — the ratio is high precisely so that this is not evidence.
  for (let i = 0; i < 40; i++) {
    feed(watch, 0.05, 400)
    feed(watch, (SUPPRESSOR_FLOOR + SPEECH_FLOOR) / 2, 100)
  }
  assert.equal(watch.verdict, 'ok')
})

test('silence is not evidence — a quiet room never trips the warning', () => {
  const watch = new InputLevelWatch()
  // Keepalives are zeroes and suppressed frames never arrive at all, so an
  // empty room contributes nothing to the denominator however long it lasts.
  feed(watch, 0, 60_000)
  feed(watch, SUPPRESSOR_FLOOR / 2, 60_000)
  assert.equal(watch.verdict, 'unknown')
  assert.equal(watch.observedMs, 0)
})

test('a meeting that starts quiet and is fixed mid-call recovers', () => {
  const watch = new InputLevelWatch()
  feed(watch, (SUPPRESSOR_FLOOR + SPEECH_FLOOR) / 2, MIN_OBSERVED_MS + 200)
  assert.equal(watch.verdict, 'tooQuiet')
  // The rep raised the input volume. The verdict is rolling, not sticky: a
  // warning that outlived its cause would teach them to ignore the next one.
  feed(watch, 0.05, 60_000)
  assert.equal(watch.verdict, 'ok')
})

test('the peak is the measurement the diagnostic quotes', () => {
  const watch = new InputLevelWatch()
  feed(watch, 0.002, 100)
  feed(watch, 0.0485, 20)
  assert.equal(watch.peak, 0.0485)
})

test('the meter reads a peak once, then falls back to silence', () => {
  const watch = new InputLevelWatch()
  feed(watch, 0.05, 100)

  assert.equal(watch.takeRecentPeak(), 0.05)
  // Nothing has been pushed since. A meter that kept reporting 0.05 would show
  // a room as loud for as long as it stayed quiet.
  assert.equal(watch.takeRecentPeak(), 0)

  feed(watch, 0.02, 20)
  assert.equal(watch.takeRecentPeak(), 0.02)
})

test('the meter shows audio too quiet to transcribe — the verdict does not', () => {
  const watch = new InputLevelWatch()
  // Under SPEECH_FLOOR, so no segment will ever come of it. That is precisely
  // when a rep most needs to see the needle move: a meter that went flat here
  // would look identical to a dead microphone, and the fix — raise the input
  // volume until the bars cross the line — depends on seeing them at all.
  const quiet = (SUPPRESSOR_FLOOR + SPEECH_FLOOR) / 2
  feed(watch, quiet, 100)

  assert.equal(watch.takeRecentPeak(), quiet)
})

test('rms of an Int16 buffer matches the amplitude that went in', () => {
  for (const amplitude of [0.008, 0.05, 0.5]) {
    assert.ok(Math.abs(rmsOfInt16(frameAt(amplitude)) - amplitude) < 1e-4, `${amplitude}`)
  }
  assert.equal(rmsOfInt16(Buffer.alloc(0)), 0)
  assert.equal(rmsOfInt16(frameAt(0)), 0)
})
