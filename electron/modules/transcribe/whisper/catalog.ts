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
 */
import fs from 'node:fs'
import path from 'node:path'

export interface WhisperModel {
  id: string
  label: string
  sizeMb: number
  speed: 'fast' | 'medium' | 'slow'
  accuracy: 'correcte' | 'bonne' | 'très bonne'
  /**
   * Checkpoints whose weights live in a sibling `*.onnx_data` file. Declared
   * here when the model's own `config.json` does not declare it — without the
   * flag transformers never fetches the companion. Keyed exactly as the loader
   * resolves it: full ONNX basename first, then module name.
   */
  externalDataFormat?: Record<string, boolean>
}

export const MODELS: WhisperModel[] = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper Tiny', sizeMb: 74, speed: 'fast', accuracy: 'correcte' },
  { id: 'Xenova/whisper-base', label: 'Whisper Base', sizeMb: 145, speed: 'fast', accuracy: 'bonne' },
  { id: 'Xenova/whisper-small', label: 'Whisper Small', sizeMb: 466, speed: 'medium', accuracy: 'très bonne' },
  {
    // The fp32 encoder weights (~820 MB) sit in `encoder_model.onnx_data` and
    // this repo's config.json does not say so. Hence the explicit declaration.
    id: 'onnx-community/whisper-large-v3-turbo-ONNX',
    label: 'Whisper Large v3 Turbo',
    sizeMb: 1031,
    speed: 'medium',
    accuracy: 'très bonne',
    externalDataFormat: { 'encoder_model.onnx': true },
  },
  { id: 'Xenova/whisper-medium', label: 'Whisper Medium', sizeMb: 1530, speed: 'slow', accuracy: 'très bonne' },
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

export const externalDataFormatFor = (id: string): Record<string, boolean> | undefined =>
  modelById(id)?.externalDataFormat

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
