/**
 * The extraction module's surface.
 *
 * One recipe (DEC-13), one renderer, and the pure pieces both are built from.
 * Nothing exported here reaches another module: the `LlmPort` and the
 * `DiagRecorder` are injected by `app/`. Nothing exported here writes to the
 * rep's document either — `renderCompteRendu` returns a string and the session
 * decides when it becomes grey text (DEC-5).
 */
export {
  CompteRenduRecipe,
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_TIMEOUT_MS,
  NOTE_MAX_OUTPUT_TOKENS,
  NOTE_TIMEOUT_MS,
} from './CompteRenduRecipe.ts'
export type {
  CompteRenduRecipeDeps,
  ExtractionInput,
  ExtractionResult,
} from './CompteRenduRecipe.ts'
export { ExtractionError, extractionErrorMessage } from './errors.ts'
export type { ExtractionErrorKind } from './errors.ts'
export { FAIBLE_MARKER, renderCompteRendu } from './compteRendu.ts'
export {
  CHARS_PER_TOKEN,
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  SINGLE_PASS_TOKENS,
  chunkTranscript,
  estimateTokens,
  isCitable,
  renderSegment,
  renderSegments,
} from './chunking.ts'
export type { ChunkOptions, TranscriptChunk } from './chunking.ts'
export { UNRESOLVED_ACCOUNT, buildFacts, interlocuteursOf } from './facts.ts'
export type { BuildFactsInput } from './facts.ts'
export { findDeterministicLeaks, forbiddenIdentitiesOf } from './deterministicLeaks.ts'
export type { ForbiddenIdentities } from './deterministicLeaks.ts'
export {
  COMPTE_RENDU_SECTIONS,
  EXTRACT_INSTRUCTIONS,
  EXTRACT_SCHEMA_NAME,
  ExtractReplySchema,
  LIBRE_INSTRUCTIONS,
  LIBRE_NOTE_INSTRUCTIONS,
  LIBRE_NOTE_SCHEMA_NAME,
  LIBRE_SCHEMA_NAME,
  LibreNoteReplySchema,
  LibreReplySchema,
  MAX_NOTES_PER_CHUNK,
  MAX_NOTE_CHARS,
  NOTE_INSTRUCTIONS,
  NOTE_SCHEMA_NAME,
  NoteReplySchema,
  NoteSujetSchema,
  renderNotes,
} from './prompt.ts'
export type {
  ExtractReply,
  LibreNoteReply,
  LibreReply,
  NoteReply,
  NoteSujet,
} from './prompt.ts'
export { groundReply } from './toExtraction.ts'
export type { GroundedExtraction } from './toExtraction.ts'
