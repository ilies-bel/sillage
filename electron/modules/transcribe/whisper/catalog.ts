/**
 * The checkpoints the offline floor is allowed to load, and how to tell whether
 * one is actually on disk.
 *
 * **Every English-only checkpoint is gone from this list**, which removes about
 * two thirds of what the previous product offered: Moonshine (English by
 * design), all of Distil-Whisper, and every `.en` variant. The locale is fixed
 * to `fr-FR` with no detection anywhere (DEC-22), so an English-only decoder
 * does not degrade — it transcribes French phonetically into English and
 * produces confident nonsense. Listing one would be offering a setting whose
 * only outcome is a broken meeting.
 *
 * The presence check is not a formality. `selectProvider` treats
 * `local-whisper` as configured only when the model is really there, and a
 * partially-downloaded checkpoint is the failure this is written against: the
 * `.onnx` graph stub arrives, the weights do not, and ONNX Runtime aborts at
 * load with a `file_size` error — mid-meeting, on the provider that exists to
 * be the thing that cannot fail.
 *
 * **Every row here is held to one real inference** by `npm run check:models`,
 * against `scripts/whisper-models.verified.json`. Adding a row without an entry
 * in that ledger fails the check. That guard did not exist while turbo shipped
 * broken, which is why turbo shipped broken; it is not in `npm run check`
 * because its subject is gigabytes of weights rather than source.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface WhisperModel {
  id: string
  label: string
  sizeMb: number
  speed: 'fast' | 'medium' | 'slow'
  accuracy: 'correcte' | 'bonne' | 'très bonne'
}

/**
 * **What a rep may select. Four rows, and one was taken out of it.**
 *
 * `onnx-community/whisper-large-v3-turbo-ONNX` was here until round 26. Every
 * one of its inferences throws `Missing the following inputs: cache_position`
 * — the merged decoder is exported against a newer graph signature than the
 * pinned `transformers` (3.8.1) builds a feed for — and the throw is caught
 * per segment, so a rep who selected it downloaded **2 848 MB** and then read
 * « transcription de l’audio système dégradée » beside an empty transcript for
 * a whole client meeting, on the engine DEC-30 makes the *default*. That is a
 * control that is present and does nothing, which DEC-26 forbids, on the one
 * failure `essai.ts` says cannot be repaired afterwards.
 *
 * `npm run check:models` has reported it since 2026-09-21 and named the two
 * ways out — « réexporter le modèle, ou retirer la ligne ». Re-exporting is not
 * ours to do, so the line is out of the offer. **The check was in no gate**,
 * which is why it could be red for a week; it runs in CI now, where a runner
 * has no weights and answers from the ledger in about a tenth of a second.
 *
 * The comment that used to sit on the row argued for keeping it because it was
 * the only user of `externalDataFormat` and two tests reach that loader through
 * its id. That is shipping a broken offer to keep a fixture alive, which is the
 * trade backwards. The loader knowledge moved to `EXTERNAL_DATA` below, where
 * it is a property of a checkpoint rather than of an offer, and both tests pass
 * unchanged.
 */
export const MODELS: WhisperModel[] = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper Tiny', sizeMb: 61, speed: 'fast', accuracy: 'correcte' },
  { id: 'Xenova/whisper-base', label: 'Whisper Base', sizeMb: 130, speed: 'fast', accuracy: 'bonne' },
  { id: 'Xenova/whisper-small', label: 'Whisper Small', sizeMb: 486, speed: 'medium', accuracy: 'très bonne' },
  { id: 'Xenova/whisper-medium', label: 'Whisper Medium', sizeMb: 1614, speed: 'slow', accuracy: 'très bonne' },
]

/**
 * The default. Small is the smallest multilingual checkpoint whose French is
 * good enough to read back — base mangles proper nouns badly enough that the
 * lexicon boost cannot recover them — and it is still one inference per
 * utterance on a laptop that is also running Teams.
 */
export const DEFAULT_MODEL_ID = 'Xenova/whisper-small'

export const modelById = (id: string): WhisperModel | undefined => MODELS.find((m) => m.id === id)

export const modelSizeBytes = (id: string): number => {
  const model = modelById(id)
  return model ? Math.round(model.sizeMb * 1024 * 1024) : 0
}

/**
 * **Which checkpoints keep their encoder weights outside the graph file.**
 *
 * A property of a *checkpoint*, not of an offer — which is why it is a table of
 * its own and no longer a field on `MODELS`. `onnx-community/whisper-large-v3-turbo-ONNX`
 * was a catalogue row until it was taken out of the offer (see `MODELS` above),
 * and it is the only id this loader path has ever had. Two things follow, and
 * both are deliberate:
 *
 *  · `externalDataFormatFor` returns `undefined` for every model a rep can
 *    select today, so `useExternalDataFormat` is never set in production and
 *    `isModelCached` never looks for an `_data` sibling. **That branch is
 *    unreached, and it is kept rather than deleted** because the checkpoint is
 *    re-exportable: the defect is a graph signature against a pinned
 *    `transformers`, not the external-data layout, and deleting the loader
 *    would mean rediscovering it the next time a large checkpoint ships that
 *    way. `scripts/whisper-models.verified.json` records the measurement.
 *  · It is stated here rather than left to be inferred, because « a declared
 *    port that nothing calls is not a feature » is this repo's rule and an
 *    unreached branch with no reason beside it is exactly what that rule is
 *    about.
 */
const EXTERNAL_DATA: Record<string, Record<string, boolean>> = {
  'onnx-community/whisper-large-v3-turbo-ONNX': { 'encoder_model.onnx': true },
}

export const externalDataFormatFor = (id: string): Record<string, boolean> | undefined =>
  EXTERNAL_DATA[id]

// ── Cache layout ──────────────────────────────────────────────────────────
//
// transformers v3 uses a flat layout under an explicit `env.cacheDir`:
// `<cacheDir>/<org>/<name>/onnx/…`, not the Hub's
// `models--{org}--{name}/snapshots/{rev}/…`. Assuming the Hub convention makes
// every presence check return false, which is invisible because the loader
// reads through `cacheDir` regardless — it just downloads mid-meeting instead.

/** Maps a `dtype` keyword to the ONNX filename suffix the loader looks for. */
const DTYPE_SUFFIX: Record<string, string> = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
}

const dtypeForFile = (file: string, dtype: string | Record<string, string>): string =>
  typeof dtype === 'string' ? dtype : (dtype[file] ?? 'fp32')

const onnxFilename = (basename: string, dt: string): string =>
  `${basename}${DTYPE_SUFFIX[dt] ?? ''}.onnx`

const externalDataFilesFor = (
  moduleName: string,
  dt: string,
  format: Record<string, boolean> | undefined,
): string[] => {
  if (!format) return []
  const baseName = onnxFilename(moduleName, dt)
  const declared = format[baseName] ?? format[moduleName] ?? false
  return declared ? [`${baseName}_data`] : []
}

/**
 * The ONNX files the active dtype will actually open.
 *
 * Whisper pipelines accept *either* a merged decoder *or* the
 * decoder + decoder-with-past pair, so either layout counts as complete.
 */
export const expectedOnnxFiles = (
  dtype: string | Record<string, string>,
  format?: Record<string, boolean>,
): { encoder: string[]; decoderOptions: string[][] } => {
  const encDt = dtypeForFile('encoder_model', dtype)
  const mergedDt = dtypeForFile('decoder_model_merged', dtype)
  const decDt = dtypeForFile('decoder_model', dtype)
  const pastDt = dtypeForFile('decoder_with_past_model', dtype)

  return {
    encoder: [onnxFilename('encoder_model', encDt), ...externalDataFilesFor('encoder_model', encDt, format)],
    decoderOptions: [
      [
        onnxFilename('decoder_model_merged', mergedDt),
        ...externalDataFilesFor('decoder_model_merged', mergedDt, format),
      ],
      [
        onnxFilename('decoder_model', decDt),
        onnxFilename('decoder_with_past_model', pastDt),
        ...externalDataFilesFor('decoder_model', decDt, format),
        ...externalDataFilesFor('decoder_with_past_model', pastDt, format),
      ],
    ],
  }
}

/**
 * True when the cache holds every file this platform's dtype will open.
 *
 * A zero-byte file counts as absent: an aborted download leaves stubs behind,
 * and reporting those as available is how a model "downloads mid-recording".
 */
export const isModelCached = (
  modelsDir: string,
  modelId: string,
  dtype: string | Record<string, string>,
): boolean => {
  const onnxDir = path.join(modelsDir, modelId, 'onnx')
  const present = (file: string): boolean => {
    try {
      return fs.statSync(path.join(onnxDir, file)).size > 0
    } catch {
      return false
    }
  }

  const { encoder, decoderOptions } = expectedOnnxFiles(dtype, externalDataFormatFor(modelId))
  if (!encoder.every(present)) return false
  return decoderOptions.some((option) => option.every(present))
}
