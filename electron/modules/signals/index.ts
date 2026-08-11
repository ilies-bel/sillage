/**
 * The signals module's surface.
 *
 * Everything exported here either produces a `Signal` or decides whether one is
 * allowed to exist. Nothing exported here can write to the rep's document
 * (DEC-5, DEC-14), and nothing exported here reaches another module: the
 * `LlmPort` and the `DiagRecorder` are injected by `app/`.
 */
export { SignalExtractor, SIGNAL_TIMEOUT_MS, SIGNAL_MAX_OUTPUT_TOKENS } from './SignalExtractor.ts'
export type { SignalExtractorDeps } from './SignalExtractor.ts'
export {
  CHUNK_WINDOW_MS,
  CHUNK_MIN_WORDS,
  CHUNK_MAX_WORDS,
  countWords,
  isCitable,
  renderChunk,
  shouldFlush,
  spanMs,
} from './chunking.ts'
export {
  MAX_LABEL_CHARS,
  MAX_SIGNALS_PER_CHUNK,
  SIGNAL_INSTRUCTIONS,
  SIGNAL_SCHEMA_NAME,
  SignalReplySchema,
} from './prompt.ts'
export type { SignalReply } from './prompt.ts'
export { dedupKey, toSignals } from './toSignals.ts'
export type { ToSignalsInput, ToSignalsResult } from './toSignals.ts'
