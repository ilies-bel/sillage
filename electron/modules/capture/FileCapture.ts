/**
 * A capture source backed by WAV files instead of devices.
 *
 * Two jobs, and they are the same job. It is the **replay fixture** the demo
 * needs (ARCHITECTURE.md build order): a rehearsal that depends on a live
 * prospect, a working Teams call and a CoreAudio tap behaving on the day is not
 * a rehearsal. And it is how transcription quality gets measured at all —
 * comparing two providers, or two Whisper checkpoints, requires feeding both the
 * *same* audio, which a microphone cannot do twice.
 *
 * It sits in `modules/capture/` rather than in a test folder because it is a
 * capture implementation, subject to the same contract: frames carry their
 * channel and their sample rate, and nothing here reaches the network (DEC-26).
 *
 * **It does not emit `speechEnded`.** That verdict comes from the Rust VAD in
 * the device path, and synthesising one here would mean the fixture testing the
 * fixture. Batch providers segment on their own — `LocalWhisperSession` has its
 * own VAD, and `RestSttSession` has its safety-net timer — so the pipeline runs
 * unchanged; it just runs without a hint it would have had in a real meeting.
 */
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import type { Channel } from '../../core/contracts/transcript.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'

/** 20 ms at 16 kHz — the same cadence the Rust monitors deliver. */
const FRAME_MS = 20

export interface WavAudio {
  pcm: Buffer
  sampleRate: number
  channels: number
  bitsPerSample: number
}

/**
 * Reads a RIFF/WAVE file, walking the chunk table rather than assuming the
 * canonical 44-byte header. Files that have been through ffmpeg routinely carry
 * a `LIST`/`INFO` chunk before `data`, and reading from a fixed offset turns
 * that metadata into the first quarter-second of audio — a burst of noise that
 * Whisper answers with an invented sentence.
 */
export const readWav = (filePath: string): WavAudio => {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`${filePath}: pas un fichier RIFF`)
  }
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath}: RIFF mais pas WAVE`)
  }

  let format: { channels: number; sampleRate: number; bitsPerSample: number; audioFormat: number } | null =
    null
  let pcm: Buffer | null = null

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8

    if (id === 'fmt ' && body + 16 <= buffer.length) {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      // A truncated file declares more than it holds; take what is there.
      pcm = buffer.subarray(body, Math.min(body + size, buffer.length))
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2)
  }

  if (!format) throw new Error(`${filePath}: chunk "fmt " absent`)
  if (!pcm) throw new Error(`${filePath}: chunk "data" absent`)
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error(
      `${filePath}: seul le PCM 16 bits est accepté (format ${format.audioFormat}, ${format.bitsPerSample} bits)`,
    )
  }

  return {
    pcm,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
  }
}

/** Averages interleaved channels down to one, in place of a resampler. */
export const toMono = (pcm: Buffer, channels: number): Buffer => {
  if (channels <= 1) return pcm
  const frames = Math.floor(pcm.length / (2 * channels))
  const out = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((i * channels + c) * 2)
    out.writeInt16LE(Math.round(sum / channels), i * 2)
  }
  return out
}

export interface FileCaptureSource {
  channel: Channel
  path: string
}

export interface FileCaptureOptions {
  sources: FileCaptureSource[]
  /**
   * Playback rate. `1` is wall-clock, which is what the demo rehearsal wants.
   * Higher is faster than the transcriber can keep up with, and a batch engine
   * will start dropping queued utterances — useful for a smoke test, useless for
   * judging a transcript.
   */
  speed?: number
  diagnostics?: DiagRecorder
  clock?: () => number
  /** Fires once every source has been played to the end. */
  onEnded?: () => void
}

export class FileCapture extends EventEmitter {
  #options: FileCaptureOptions
  #diagnostics: DiagRecorder
  #timers = new Set<NodeJS.Timeout>()
  #running = false
  #pending = 0

  constructor(options: FileCaptureOptions) {
    super()
    this.#options = options
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
  }

  get running(): boolean {
    return this.#running
  }

  async start(): Promise<void> {
    if (this.#running) return
    this.#running = true

    const speed = this.#options.speed && this.#options.speed > 0 ? this.#options.speed : 1

    for (const source of this.#options.sources) {
      const wav = readWav(source.path)
      const pcm = toMono(wav.pcm, wav.channels)
      const bytesPerFrame = Math.round((wav.sampleRate * FRAME_MS) / 1000) * 2
      const total = Math.ceil(pcm.length / bytesPerFrame)

      this.#diagnostics.record({
        severity: 'info',
        code: 'capture.file.opened',
        module: 'capture',
        message: `${source.path} — ${(pcm.length / 2 / wav.sampleRate).toFixed(1)} s à ${wav.sampleRate} Hz`,
        detail: { channel: source.channel, frames: total },
      })

      this.#pending++
      this.#play(source.channel, pcm, bytesPerFrame, wav.sampleRate, speed)
    }

    this.emit('health', { state: 'ok' })
  }

  async stop(): Promise<void> {
    this.#running = false
    for (const timer of this.#timers) clearTimeout(timer)
    this.#timers.clear()
  }

  /**
   * Paces frames against the clock rather than against a fixed interval.
   *
   * `setInterval` at 20 ms drifts under load — and it drifts *ahead* of the
   * audio it is pretending to be, so a slow machine replays a five-minute call
   * in four. Every deadline here is computed from the start, so a late frame is
   * late once instead of compounding.
   */
  #play(
    channel: Channel,
    pcm: Buffer,
    bytesPerFrame: number,
    sampleRate: number,
    speed: number,
  ): void {
    const startedAt = Date.now()
    let index = 0
    let timer: NodeJS.Timeout | null = null

    const step = (): void => {
      // Retired as soon as it fires: a five-minute call is fifteen thousand
      // frames, and a set that only ever grows is a leak wearing a schedule.
      if (timer) this.#timers.delete(timer)
      if (!this.#running) return

      const offset = index * bytesPerFrame
      if (offset >= pcm.length) {
        this.#pending--
        if (this.#pending === 0) this.#options.onEnded?.()
        return
      }

      const chunk = pcm.subarray(offset, Math.min(offset + bytesPerFrame, pcm.length))
      this.emit('frame', { channel, chunk, sampleRate })
      index++

      const dueAt = startedAt + (index * FRAME_MS) / speed
      timer = setTimeout(step, Math.max(0, dueAt - Date.now()))
      this.#timers.add(timer)
    }

    step()
  }
}
