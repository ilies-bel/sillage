/**
 * Applying the lexicon to Whisper, and undoing what that does to the output.
 *
 * **`prompt_ids` does not work in transformers.js.** It is declared on
 * `WhisperGenerationConfig` and commented out of `generate()` —
 * `// prompt_ids = null,` in `models.js` — so passing it is a silent no-op:
 * identical audio comes back byte-for-byte identical with and without a
 * glossary. That is precisely the failure DEC-17 exists to name, which is why
 * this file says how it was checked rather than trusting a field name.
 *
 * What the library does honour is `decoder_input_ids`: it takes them as the
 * generation prefix *and* as the begin-index for the logits processors, so a
 * hand-built prefix stays internally consistent. This builds the sequence
 * Whisper was actually trained on and strips the consequence back off.
 */

/** Whisper truncates a prompt to `max_target_positions / 2 - 1`. */
export const PROMPT_TOKEN_CAP = 223

export interface PrefixTokens {
  startOfPrev: number
  startOfTranscript: number
  language: number
  task: number
  noTimestamps: number
}

/**
 * `<|startofprev|> …prompt… <|startoftranscript|> <|fr|> <|transcribe|> <|notimestamps|>`
 *
 * Returns null for an empty prompt, which is the caller's signal to let the
 * library build its own init tokens — an unprompted transcription is a worse
 * transcript, and a malformed prefix is not a transcript at all.
 */
export const buildDecoderPrefix = (promptIds: readonly number[], tokens: PrefixTokens): number[] | null => {
  if (promptIds.length === 0) return null
  return [
    tokens.startOfPrev,
    ...promptIds.slice(0, PROMPT_TOKEN_CAP),
    tokens.startOfTranscript,
    tokens.language,
    tokens.task,
    tokens.noTimestamps,
  ]
}

const SIGNIFICANT = /[\p{L}\p{N}]/u

/**
 * Removes the prompt Whisper echoes back.
 *
 * A prompt supplied as a decoder prefix is part of the generated sequence, so
 * the pipeline decodes it into the text and the glossary arrives at the top of
 * every segment. Python's `prompt_ids` path slices it off by token count; there
 * is no equivalent hook here, so it comes off by string.
 *
 * Letters and digits only, case-insensitively: the decode does not round-trip
 * spacing or capitalisation — the tokenizer re-spaces `licence E5` and re-cases
 * a sentence start — so anything stricter would stop matching on the first
 * comma. Text that does not begin with the prompt is returned untouched: a
 * glossary visible at the top of one segment is a bug someone reports, and a
 * transcript silently truncated at its first word is one nobody notices.
 */
export const stripEchoedPrompt = (text: string, prompt: string): string => {
  const target = [...prompt].filter((c) => SIGNIFICANT.test(c)).map((c) => c.toLowerCase())
  if (target.length === 0) return text

  let matched = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    if (!SIGNIFICANT.test(c)) continue
    if (c.toLowerCase() !== target[matched]) return text
    if (++matched === target.length) return text.slice(i + 1).replace(/^[\s.,;:—-]+/, '')
  }
  // The whole output was the prompt and nothing else — a silent segment the
  // model narrated back. Emitting the glossary as speech is worse than nothing.
  return matched === target.length ? '' : text
}
