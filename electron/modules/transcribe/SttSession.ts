/**
 * The port every speech-to-text provider implements.
 *
 * Deliberately smaller than any provider SDK. What the rest of the app is
 * allowed to know about transcription is: push bytes, get text, be told when it
 * breaks. Everything vendor-shaped — endpoints, auth headers, upload modes,
 * response shapes — lives behind this interface, which is what makes swapping
 * Azure for Gladia a file in this folder rather than a change anywhere else
 * (ARCHITECTURE.md §5.D).
 *
 * There is one session per channel, not one per meeting. The microphone and the
 * system loopback are transcribed independently so that speaker attribution
 * stays a property of the hardware rather than a diarization guess (VISION.md
 * §5).
 */
import type { EventEmitter } from 'node:events'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'

/**
 * One result from a provider. Not a `TranscriptSegment` yet: the provider knows
 * nothing about the meeting clock or the channel it was fed from, so stamping
 * those is `TranscribeSession`'s job.
 */
export interface SttTranscript {
  text: string
  /**
   * Interim results are displayed and replaced in place; only final ones are
   * persisted and only they can be cited (DEC-21). A batch provider only ever
   * produces finals.
   */
  isFinal: boolean
}

export interface SttSessionOptions {
  apiKey: string
  /**
   * Interpolated into the endpoint hostname by some providers, so it is
   * validated, never trusted. See `RestSttSession`.
   */
  region?: string
  /** BCP-47. v1 only ever asks for `fr-FR` (DEC-22). */
  language: string
  /**
   * Which checkpoint a local engine should load. Ignored by the cloud
   * providers, which have exactly one model behind the endpoint.
   */
  model?: string
  /**
   * DEC-17. Applied only when the provider's descriptor says it can take them —
   * a provider that cannot boost must not silently pretend to. Static ESN terms
   * plus the per-meeting terms lifted from the calendar event.
   */
  boostTerms?: string[]
  diagnostics?: DiagRecorder
  clock?: () => number
}

/**
 * Events: `transcript` (SttTranscript), `error` (unknown).
 *
 * `stop()` resolves once the provider has flushed whatever it was holding — the
 * last few seconds of a meeting are usually the ones with the next steps in
 * them, so a stop that races the final upload loses the most valuable audio in
 * the recording.
 */
export interface SttSession extends EventEmitter {
  readonly providerId: string
  start(): void
  /** `sampleRate` travels with the bytes: the two channels can differ. */
  write(chunk: Buffer, sampleRate: number): void
  /**
   * The native VAD saw the end of an utterance. A batch provider uses this as
   * its primary flush trigger — waiting for a fixed timer instead cuts words in
   * half and costs a whole cycle of latency.
   */
  notifySpeechEnded(): void
  stop(): Promise<void>
}

export type SttSessionFactory = (options: SttSessionOptions) => SttSession
