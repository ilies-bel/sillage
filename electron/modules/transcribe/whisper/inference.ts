/**
 * Which ONNX execution providers to ask for, and at what precision.
 *
 * The per-module dtype map is the load-bearing part. Whisper's *encoder* is
 * unusually sensitive to quantization — int8 costs several WER points — while
 * the *decoder* dominates inference time and quantizes almost for free. So the
 * encoder stays fp32 and the decoders go q8, on every platform. A uniform
 * setting in either direction is wrong: uniform fp32 is slow enough to fall
 * behind a meeting, uniform q8 transcribes proper nouns into mush, and proper
 * nouns are what the rep is reading the transcript for.
 */
import type { InitMessage } from './protocol.ts'
import { externalDataFormatFor, modelSizeBytes } from './catalog.ts'

export interface InferenceConfig {
  executionProviders: string[]
  dtype: string | Record<string, string>
}

const WHISPER_SAFE_DTYPE: Record<string, string> = {
  encoder_model: 'fp32',
  decoder_model: 'q8',
  decoder_model_merged: 'q8',
  decoder_with_past_model: 'q8',
}

/**
 * Escape hatch for a machine where the mixed map regresses. Set
 * `SILLAGE_WHISPER_DTYPE=fp32` to force uniform full precision. The previous
 * product read this from a settings key; an env var keeps it reversible
 * without shipping a build and without `modules/` reaching into app state.
 */
const dtypeOverride = (): string | null => {
  const raw = process.env.SILLAGE_WHISPER_DTYPE?.trim().toLowerCase()
  if (raw === 'fp32' || raw === 'q8' || raw === 'q4') return raw
  return null
}

/**
 * Re-measure an execution provider without shipping a build.
 *
 * `SILLAGE_ONNX_EP=coreml,cpu` restores the old Apple Silicon path; `cpu`
 * forces the floor everywhere. Same shape and same reason as `dtypeOverride`:
 * the right provider is a measurement, and a measurement taken on one machine
 * in 2026 is not a fact about every machine.
 */
const providerOverride = (): string[] | null => {
  const raw = process.env.SILLAGE_ONNX_EP?.trim().toLowerCase()
  if (!raw) return null
  const providers = raw.split(',').map((p) => p.trim()).filter(Boolean)
  return providers.length > 0 ? providers : null
}

export const resolveInferenceConfig = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): InferenceConfig => {
  const dtype = dtypeOverride() ?? WHISPER_SAFE_DTYPE

  // Ahead of every branch: an override is for re-measuring whichever platform
  // the person doing the measuring is on, and Windows is the one that matters
  // most (HR-2) and the one least likely to be re-measured from a Mac.
  const override = providerOverride()
  if (override) return { executionProviders: override, dtype }

  // Apple Silicon used to route through CoreML here, on the reasoning that it
  // "reaches the GPU and the Neural Engine". Measured on an M1 Max, it reaches
  // neither: ORT reports CoreML claiming **25 of the graph's 887 nodes**, and
  // the run comes out *slower* than plain CPU (68.7 s vs 64.9 s on the same
  // clip) because the partition boundaries cost more than the 25 nodes save.
  //
  // The node count is a property of this ONNX graph and this ORT build, not of
  // the chip, so it does not come back on a newer Mac. `SILLAGE_ONNX_EP` is
  // the way to re-measure when either of those changes, rather than a branch
  // nobody will revisit.
  if (platform === 'darwin' && arch === 'arm64') {
    return { executionProviders: ['cpu'], dtype }
  }
  // Windows: DirectML over whichever GPU is present.
  if (platform === 'win32') {
    return { executionProviders: ['dml', 'cpu'], dtype }
  }
  // Intel Mac, Linux, anything else.
  return { executionProviders: ['cpu'], dtype }
}

/**
 * The `init` message for a model.
 *
 * `expectedBytes` is a progress-bar nicety and `useExternalDataFormat` is only
 * needed by one checkpoint, so neither may ever prevent the worker starting —
 * both fail to a harmless default rather than throwing.
 */
export const buildInitMessage = (
  modelId: string,
  cacheDir: string,
  /** Opt **in**, so the meeting path gets the offline default by omission. */
  options: { allowRemoteModels?: boolean } = {},
): InitMessage => {
  const { executionProviders, dtype } = resolveInferenceConfig()
  return {
    type: 'init',
    modelId,
    cacheDir,
    executionProviders,
    dtype,
    expectedBytes: modelSizeBytes(modelId),
    useExternalDataFormat: externalDataFormatFor(modelId),
    allowRemoteModels: options.allowRemoteModels === true,
  }
}
