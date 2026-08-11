/**
 * Int16LE PCM at any rate → Float32 at 16 kHz, which is the only rate Whisper
 * accepts.
 *
 * Linear interpolation, no dependency. The Rust resampler upstream
 * (`modules/capture/`) already delivers 16 kHz on both channels in the normal
 * case, so this is usually the identity path — but `sampleRate` travels with
 * the bytes precisely because a device can refuse to be resampled, and the
 * fallback has to exist for the offline floor to be a floor.
 */
export function resampleToF32(chunk: Buffer, inputSampleRate: number): Float32Array {
  const TARGET_RATE = 16_000

  const inputSamples = Math.floor(chunk.byteLength / 2)
  const input = new Float32Array(inputSamples)
  for (let i = 0; i < inputSamples; i++) {
    input[i] = chunk.readInt16LE(i * 2) / 32768
  }

  if (inputSampleRate === TARGET_RATE || inputSampleRate <= 0) return input

  const ratio = inputSampleRate / TARGET_RATE
  const outputLength = Math.round(inputSamples / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio
    const srcIdx = Math.floor(srcPos)
    const frac = srcPos - srcIdx

    const s0 = input[srcIdx] ?? 0
    const s1 = input[srcIdx + 1] ?? s0
    output[i] = s0 + frac * (s1 - s0)
  }

  return output
}
