/**
 * The pure halves of the offline floor: segmentation, resampling, the filter
 * that decides what is speech, the cache check that decides whether the engine
 * is available at all, and the crash-loop sentinel.
 *
 * None of it needs a model, a worker or a network — which is the point. HR-4
 * says there is a floor, and a floor that can only be verified by downloading
 * a gigabyte and holding a meeting is not one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vad } from '../whisper/vad.ts'
import { resampleToF32 } from '../whisper/resample.ts'
import { filterHallucination } from '../whisper/hallucinations.ts'
import { MODELS, DEFAULT_MODEL_ID, expectedOnnxFiles, isModelCached, modelById } from '../whisper/catalog.ts'
import { resolveInferenceConfig, buildInitMessage } from '../whisper/inference.ts'
import { ProgressAggregator } from '../whisper/progress.ts'
import { claimLoad, clearSentinel, readSentinel, writeSentinel } from '../whisper/sentinel.ts'
import { workerCandidates, resolveWorkerPath } from '../whisper/paths.ts'

// ── VAD ───────────────────────────────────────────────────────────────────

const FRAME = 480
/** One 30 ms frame of audible tone, as Float32 at 16 kHz. */
const loud = (frames: number): Float32Array => {
  const out = new Float32Array(FRAME * frames)
  for (let i = 0; i < out.length; i++) out[i] = i % 2 === 0 ? 0.25 : -0.25
  return out
}
const quiet = (frames: number): Float32Array => new Float32Array(FRAME * frames)

test('a pause ends a run of speech, not the utterance', () => {
  // The packing rule, which is where the offline floor's throughput lives.
  // Whisper pads every input to a 30-second window, so a one-second utterance
  // costs exactly what a twenty-second one costs. Emitting on every natural
  // pause is how five minutes of conversation becomes ninety full-price
  // inferences and the transcript falls a meeting behind.
  const vad = new Vad()
  assert.deepEqual(vad.push(loud(6)), [], 'still speaking')
  assert.deepEqual(vad.push(quiet(12)), [], 'a pause, not an ending')
  assert.equal(vad.inSpeech, true, 'the audio is still held')

  // …and the next run appends to the same buffer rather than starting over.
  assert.deepEqual(vad.push(loud(6)), [])
  const closed = vad.flush()
  assert.equal(closed.length, 1)
  assert.ok((closed[0]?.durationMs ?? 0) >= 12 * 30, 'both runs are in it')
})

test('speech is packed until it is worth an inference', () => {
  const vad = new Vad()
  let emitted = 0
  // Twenty-five rounds of talk-pause-talk, ~1 s of counted audio each. The rule
  // being tested is that a *pause* is not a segment boundary: segmenting on
  // every one of them — which is what the assistant this was ported from did —
  // would be 25 inferences at a fixed ~2.9 s each, five times the audio's own
  // duration and permanently behind the meeting.
  for (let i = 0; i < 25; i++) {
    emitted += vad.push(loud(24)).length // 720 ms of speech
    emitted += vad.push(quiet(12)).length // 360 ms of pause
  }
  // Bounded by the packing target rather than pinned to it: one early segment
  // for proof of life, then roughly one per 8 s. The assertion that matters is
  // the order of magnitude — a change that made this 25 again would pass any
  // exact-count test written around the new constant.
  assert.ok(emitted >= 2, `expected segments to be emitted, got ${emitted}`)
  assert.ok(emitted <= 6, `expected packing, got ${emitted} segments for 25 pauses`)
})

/**
 * Observed on the first real recording this product ever made: an 8-second test
 * produced one correct segment — `"Allô"` — that arrived 6 seconds *after* the
 * meeting had ended, because a flat 20 s target plus model load leaves the pane
 * blank for around 25 seconds. The conclusion drawn from that blank pane was
 * that transcription did not work.
 *
 * `Orchestrator` calls the transcript pane "the cheap, deterministic proof the
 * tool is working" (DEC-14). Proof that arrives after the meeting is not proof.
 */
test('the first utterance does not wait for the packing target', () => {
  const vad = new Vad()
  // ~2.2 s of speech: far under TARGET_SEGMENT_MS, over FIRST_SEGMENT_MS.
  const emitted = vad.push(loud(74))
  const closed = [...emitted, ...vad.push(quiet(12))]
  assert.equal(closed.length, 1, 'the rep sees words while still talking')
})

test('only the first utterance is early — the rest still pack', () => {
  const vad = new Vad()
  let first = 0
  first += vad.push(loud(74)).length
  first += vad.push(quiet(12)).length
  assert.equal(first, 1, 'proof of life')

  // The same audio again, now that the pane has something in it.
  let second = 0
  for (let i = 0; i < 3; i++) {
    second += vad.push(loud(74)).length
    second += vad.push(quiet(12)).length
  }
  assert.equal(second, 0, '6.6 s is still packed — the throughput rule survives')
})

test('proof of life must be speech, not a door slam', () => {
  const vad = new Vad()
  // Over FIRST_SEGMENT_MS in wall time but under MIN_VOICED_FRAMES in voiced
  // frames. Whisper answers near-silence with subtitle boilerplate, and the
  // first thing the rep reads must not be an invention.
  vad.push(loud(2))
  assert.deepEqual(vad.push(quiet(80)), [], 'a chair, not a sentence')
})

test('a noise burst shorter than the minimum is not transcribed', () => {
  const vad = new Vad()
  vad.push(loud(2))
  assert.deepEqual(vad.push(quiet(12)), [], 'two frames is a chair, not a sentence')
})

test('a speaker who never pauses is cut, and the cut overlaps', () => {
  // 25 s at 30 ms per frame = 834 frames, with no silence anywhere.
  const vad = new Vad()
  const segments = vad.push(loud(860))
  assert.equal(segments.length, 1, 'forced at MAX_SPEECH_MS')
  // The tail is carried into a freshly-opened segment, so Whisper has acoustic
  // context across the boundary instead of restarting mid-word.
  assert.equal(vad.inSpeech, true, 'a new segment was opened with the tail')
  const rest = vad.flush()
  assert.equal(rest.length, 1)
  assert.ok(rest[0] && rest[0].samples.length > 0)
})

test('flush closes whatever is open and forgets the remainder', () => {
  const vad = new Vad()
  vad.push(loud(6))
  assert.equal(vad.flush().length, 1)
  assert.equal(vad.flush().length, 0, 'nothing left to flush')
})

// ── Resampling ────────────────────────────────────────────────────────────

test('48 kHz becomes 16 kHz and 16 kHz is left alone', () => {
  const input = Buffer.alloc(48 * 2)
  for (let i = 0; i < 48; i++) input.writeInt16LE(i * 100, i * 2)

  const down = resampleToF32(input, 48_000)
  assert.equal(down.length, 16)

  const same = resampleToF32(input, 16_000)
  assert.equal(same.length, 48)
  assert.ok(Math.abs((same[1] ?? 0) - 100 / 32768) < 1e-6)
})

// ── Hallucinations ────────────────────────────────────────────────────────

test('the French subtitle credits Whisper invents on silence are dropped', () => {
  // These are what a `fr-FR`-locked pipeline actually produces on a quiet
  // window — not the English list the previous product shipped.
  assert.equal(filterHallucination("Sous-titres réalisés par la communauté d'Amara.org"), '')
  assert.equal(filterHallucination('Sous-titrage Société Radio-Canada'), '')
  assert.equal(filterHallucination('❤️ par SousTitreur.com'), '')
  assert.equal(filterHallucination('[BLANK_AUDIO]'), '')
})

test('a whole-segment "merci" is boilerplate; a sentence containing it is not', () => {
  assert.equal(filterHallucination('  Merci.  '), '')
  assert.equal(
    filterHallucination('Merci, on vous envoie la proposition avec le TJM révisé.'),
    'Merci, on vous envoie la proposition avec le TJM révisé.',
  )
})

test('ordinary French survives the filter', () => {
  for (const text of ['On part sur du régie.', "D'accord.", 'Oui, sur trois mois.']) {
    assert.equal(filterHallucination(text), text)
  }
})

// ── Catalog ───────────────────────────────────────────────────────────────

test('no English-only checkpoint is offerable (DEC-22)', () => {
  // The locale is fixed to fr-FR with no detection anywhere, so an English-only
  // decoder does not degrade — it transcribes French phonetically into English.
  for (const model of MODELS) {
    assert.doesNotMatch(model.id, /\.en$|moonshine|distil/i, `${model.id} cannot transcribe French`)
  }
  assert.ok(modelById(DEFAULT_MODEL_ID), 'the default is in the catalog')
})

test('the expected files follow the dtype, and either decoder layout counts', () => {
  const { encoder, decoderOptions } = expectedOnnxFiles({
    encoder_model: 'fp32',
    decoder_model_merged: 'q8',
  })
  assert.deepEqual(encoder, ['encoder_model.onnx'], 'fp32 has no suffix')
  assert.ok(decoderOptions.some((o) => o.includes('decoder_model_merged_quantized.onnx')))
  assert.equal(decoderOptions.length, 2, 'merged, or the split pair')
})

test('an external-data checkpoint is not cached without its weight file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-cache-'))
  const turbo = 'onnx-community/whisper-large-v3-turbo-ONNX'
  const onnx = path.join(dir, turbo, 'onnx')
  fs.mkdirSync(onnx, { recursive: true })
  const dtype = { encoder_model: 'fp32', decoder_model_merged: 'q8' }

  fs.writeFileSync(path.join(onnx, 'encoder_model.onnx'), 'graph stub')
  fs.writeFileSync(path.join(onnx, 'decoder_model_merged_quantized.onnx'), 'decoder')
  // The graph is there and the ~820MB of weights are not. This is the state an
  // aborted download leaves behind, and reporting it as available is how the
  // engine aborts mid-meeting.
  assert.equal(isModelCached(dir, turbo, dtype), false)

  fs.writeFileSync(path.join(onnx, 'encoder_model.onnx_data'), 'weights')
  assert.equal(isModelCached(dir, turbo, dtype), true)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('a zero-byte file is an aborted download, not a cache hit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-cache-'))
  const onnx = path.join(dir, 'Xenova/whisper-small', 'onnx')
  fs.mkdirSync(onnx, { recursive: true })
  fs.writeFileSync(path.join(onnx, 'encoder_model.onnx'), '')
  fs.writeFileSync(path.join(onnx, 'decoder_model_merged_quantized.onnx'), 'decoder')

  assert.equal(
    isModelCached(dir, 'Xenova/whisper-small', { encoder_model: 'fp32', decoder_model_merged: 'q8' }),
    false,
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── Inference config ──────────────────────────────────────────────────────

test('the encoder stays fp32 on every platform', () => {
  // Quantizing Whisper's encoder costs several WER points, and proper nouns are
  // the first thing to go — which are exactly what the rep reads the transcript
  // for. The decoder dominates the time and quantizes almost for free.
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['win32', 'x64'],
    ['linux', 'x64'],
  ] as const) {
    const { dtype, executionProviders } = resolveInferenceConfig(platform, arch)
    assert.equal(typeof dtype === 'object' && dtype.encoder_model, 'fp32', platform)
    assert.equal(typeof dtype === 'object' && dtype.decoder_model_merged, 'q8', platform)
    assert.ok(executionProviders.includes('cpu'), `${platform} always keeps a CPU fallback`)
  }
})

/**
 * Measured on an M1 Max, whisper-small, 18 s of French: CoreML claimed 25 of
 * the graph's 887 nodes and finished *slower* than plain CPU (68.7 s vs
 * 64.9 s). The partition boundaries cost more than the 25 nodes saved. The node
 * count belongs to the ONNX graph, not to the chip, so a newer Mac does not
 * bring it back on its own — a new measurement does, through the override.
 */
test('Apple Silicon runs on CPU, because CoreML measured slower', () => {
  const { executionProviders } = resolveInferenceConfig('darwin', 'arm64')
  assert.deepEqual(executionProviders, ['cpu'])
})

test('the execution provider can be re-measured without a build', (t) => {
  t.after(() => {
    delete process.env.SILLAGE_ONNX_EP
  })

  process.env.SILLAGE_ONNX_EP = 'coreml,cpu'
  assert.deepEqual(resolveInferenceConfig('darwin', 'arm64').executionProviders, ['coreml', 'cpu'])
  // Ahead of every branch, not just the Mac one — Windows is the platform that
  // matters most and the one least likely to be measured from this machine.
  assert.deepEqual(resolveInferenceConfig('win32', 'x64').executionProviders, ['coreml', 'cpu'])

  process.env.SILLAGE_ONNX_EP = '   '
  assert.deepEqual(
    resolveInferenceConfig('win32', 'x64').executionProviders,
    ['dml', 'cpu'],
    'a blank override is not an override',
  )
})

test('the init message carries the external-data flag only where it is needed', () => {
  const turbo = buildInitMessage('onnx-community/whisper-large-v3-turbo-ONNX', '/models')
  assert.deepEqual(turbo.useExternalDataFormat, { 'encoder_model.onnx': true })

  const small = buildInitMessage('Xenova/whisper-small', '/models')
  assert.equal(small.useExternalDataFormat, undefined, 'self-declaring models read their own config')
  assert.ok(small.expectedBytes > 0, 'the progress denominator comes from the catalog')
})

test('the meeting path may not fetch a model from the network (DEC-26)', () => {
  // The capture path has zero network dependencies. A worker that reaches
  // HuggingFace because a cache entry is missing turns a recording into a
  // download — over whatever network the rep's client happens to be on, at the
  // moment a call is starting. The weights ship inside the installer, so there
  // is nothing this would legitimately fetch.
  assert.equal(buildInitMessage('Xenova/whisper-small', '/models').allowRemoteModels, false)

  // Opt **in**, so the offline default is what you get by omission rather than
  // by remembering. Only a path where downloading *is* the task may ask.
  assert.equal(
    buildInitMessage('Xenova/whisper-small', '/models', { allowRemoteModels: true })
      .allowRemoteModels,
    true,
  )
})

// ── Progress ──────────────────────────────────────────────────────────────

test('progress is weighted by bytes, not by file count', () => {
  const agg = new ProgressAggregator(0)
  // Five tiny metadata files complete instantly; the weights have not started.
  for (const file of ['config.json', 'tokenizer.json', 'preprocessor.json', 'vocab.json', 'merges.txt']) {
    agg.update({ file, status: 'progress', loaded: 2_000, total: 2_000 })
  }
  const withWeights = agg.update({
    file: 'encoder_model.onnx',
    status: 'progress',
    loaded: 0,
    total: 400_000_000,
  })
  // A count-average would be reporting ~83% here. That is the bug.
  assert.ok(withWeights === null || withWeights < 5, `expected near zero, got ${withWeights}`)
})

test('progress never goes backwards and never reaches 100', () => {
  const agg = new ProgressAggregator(1_000)
  assert.equal(agg.update({ file: 'a', status: 'progress', loaded: 500, total: 1_000 }), 50)
  assert.equal(agg.update({ file: 'a', status: 'progress', loaded: 200, total: 1_000 }), null, 'no regression')
  assert.equal(agg.update({ file: 'a', status: 'done' }), 99, 'only `ready` means 100')
})

// ── Sentinel ──────────────────────────────────────────────────────────────

test('a model that killed the last process is refused exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-state-'))
  const model = 'Xenova/whisper-small'

  // The previous process wrote this and then died natively — no exit event, no
  // catchable error, nothing in memory survived to remember it.
  writeSentinel(dir, model)

  const first = claimLoad(dir, model)
  assert.equal(first.ok, false)
  assert.match(first.ok === false ? first.reason : '', /processus précédent/)

  // Crashes forever becomes crashes at most once: the record is consumed, so
  // the next attempt is allowed through.
  assert.deepEqual(claimLoad(dir, model), { ok: true })

  fs.rmSync(dir, { recursive: true, force: true })
})

test('a stale sentinel does not block a different model', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-state-'))
  writeSentinel(dir, 'Xenova/whisper-medium')
  assert.deepEqual(claimLoad(dir, 'Xenova/whisper-small'), { ok: true })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('clearing on ready is scoped to the model that became ready', () => {
  // Both channels load at once. The rep's worker reporting ready must not erase
  // the record of the far channel's still-in-progress load.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-state-'))
  writeSentinel(dir, 'Xenova/whisper-small')
  clearSentinel(dir, 'Xenova/whisper-medium')
  assert.equal(readSentinel(dir)?.modelId, 'Xenova/whisper-small')
  clearSentinel(dir, 'Xenova/whisper-small')
  assert.equal(readSentinel(dir), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── Paths ─────────────────────────────────────────────────────────────────

test('a packaged build prefers the unpacked worker over the one in the archive', () => {
  const candidates = workerCandidates({
    appPath: '/Apps/Sillage.app/Contents/Resources/app.asar',
    userData: '/Users/x/Library/Application Support/Sillage',
    resourcesPath: '/Apps/Sillage.app/Contents/Resources',
  })
  assert.match(candidates[0] ?? '', /app\.asar\.unpacked/)
  assert.equal(candidates.length, 2, 'the archive copy is still a fallback')
})

test('the resolver returns a path even when nothing exists, so the error names it', () => {
  const resolved = resolveWorkerPath({
    appPath: '/repo',
    userData: '/state',
    resourcesPath: null,
    exists: () => false,
  })
  assert.match(resolved, /dist-electron.*worker\.js$/)
})
