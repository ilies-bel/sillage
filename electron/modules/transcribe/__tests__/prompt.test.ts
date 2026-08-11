import test from 'node:test'
import assert from 'node:assert/strict'
import { PROMPT_TOKEN_CAP, buildDecoderPrefix, stripEchoedPrompt } from '../whisper/prompt.ts'
import type { PrefixTokens } from '../whisper/prompt.ts'

const TOKENS: PrefixTokens = {
  startOfPrev: 50361,
  startOfTranscript: 50258,
  language: 50265,
  task: 50359,
  noTimestamps: 50363,
}

test('the prefix is the sequence Whisper was trained on', () => {
  assert.deepEqual(buildDecoderPrefix([1, 2, 3], TOKENS), [50361, 1, 2, 3, 50258, 50265, 50359, 50363])
})

test('an empty prompt means no prefix, not an empty one', () => {
  // The caller reads null as "let the library build its own init tokens".
  assert.equal(buildDecoderPrefix([], TOKENS), null)
})

test('a prompt longer than the window is truncated, keeping the front', () => {
  const long = Array.from({ length: 400 }, (_, i) => i)
  const prefix = buildDecoderPrefix(long, TOKENS)
  assert.equal(prefix?.length, PROMPT_TOKEN_CAP + 5)
  // The front is the per-meeting half — surnames the calendar gave us.
  assert.equal(prefix?.[1], 0)
  assert.equal(prefix?.[PROMPT_TOKEN_CAP], PROMPT_TOKEN_CAP - 1)
})

test('the echoed prompt comes off the front of the transcript', () => {
  const text = 'SharePoint, pré-production, RAG Pour moi, j’ai créé un dossier.'
  assert.equal(stripEchoedPrompt(text, 'SharePoint, pré-production, RAG'), 'Pour moi, j’ai créé un dossier.')
})

test('re-spacing and re-casing by the decoder do not defeat the strip', () => {
  // The tokenizer does not round-trip spacing or capitalisation.
  const text = 'sharepoint,   pre... RAG  Le dossier est vide.'
  assert.equal(stripEchoedPrompt(text, 'SharePoint, pre, RAG'), 'Le dossier est vide.')
})

test('a transcript that does not begin with the prompt is returned untouched', () => {
  // The failure to avoid: silently truncating real speech. A visible glossary
  // gets reported; a transcript missing its first sentence does not.
  const text = 'Pour moi, SharePoint ne marche plus.'
  assert.equal(stripEchoedPrompt(text, 'SharePoint, RAG'), text)
})

test('a partial match at the front is not a match', () => {
  const text = 'SharePoint ne marche plus.'
  assert.equal(stripEchoedPrompt(text, 'SharePoint, RAG, TJM'), text)
})

test('an output that is nothing but the prompt is dropped', () => {
  // A silent window the model narrated back with its own conditioning.
  assert.equal(stripEchoedPrompt('SharePoint, RAG', 'SharePoint, RAG'), '')
})

test('an empty prompt never eats text', () => {
  assert.equal(stripEchoedPrompt('Bonjour.', ''), 'Bonjour.')
  assert.equal(stripEchoedPrompt('Bonjour.', '   ,  '), 'Bonjour.')
})
