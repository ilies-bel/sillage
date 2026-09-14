/**
 * **What the model is actually given, and what the rep is told about it.**
 *
 * `askTranscript` had no test of its own: `ASK_MAX_INPUT_CHARS` had no reader
 * outside its own file, the slice was by character, and the docblock saying
 * « when it truncates, the answer says so » described a thing nothing did.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { askTranscript } from '../ask.ts'
import type { LlmPort } from '../../../core/contracts/llm.ts'
import type { TranscriptSegment } from '../../../core/contracts/transcript.ts'

const turn = (i: number, text: string): TranscriptSegment => ({
  id: `s${i}`,
  channel: i % 2 === 0 ? 'rep' : 'far',
  text,
  startMs: i * 20_000,
  endMs: i * 20_000,
  isFinal: true,
  provider: 'test',
  receivedAt: i * 20_000,
})

/** Answers nothing and records what it was asked. */
const spy = (): { port: LlmPort; seen: string[] } => {
  const seen: string[] = []
  const port = {
    id: 'test',
    structured: async ({ input }: { input: string }) => {
      seen.push(input)
      return { answered: false, answer: '', quotes: [] }
    },
  } as unknown as LlmPort
  return { port, seen }
}

test('a call that fits is read whole, and nothing is claimed about it', async () => {
  const { port, seen } = spy()
  const segments = [turn(0, 'Bonjour.'), turn(1, 'Bonjour à vous.')]

  const result = await askTranscript(port, { question: 'Qui parle ?', segments })

  assert.equal(result.readFrom, null)
  assert.ok(seen[0]?.includes('Bonjour à vous.'))
  assert.doesNotMatch(seen[0] ?? '', /seule la fin/i, 'rien à signaler quand tout a été lu')
})

test('a call that does not fit is cut on a turn, and both the model and the rep are told', async () => {
  /*
   * Two defects in one expression. It was `joined.slice(joined.length - MAX)`,
   * so the model's first line was a fragment — measured, the first ninety
   * characters began `l : On reprend le point suivant…`, half a speaker label —
   * and nothing anywhere said the transcript was partial, so a question about
   * the first twenty minutes of a ninety-minute call came back « la
   * transcription de cet appel ne permet pas de répondre », which is false.
   */
  const { port, seen } = spy()
  // ~120 000 characters over 200 turns: twice the budget, as a real long call is.
  const segments = Array.from({ length: 200 }, (_, i) =>
    turn(i, `${'phrase de remplissage '.repeat(26)}fin ${i}.`),
  )

  const result = await askTranscript(port, { question: 'Quel TJM ?', segments })

  assert.notEqual(result.readFrom, null)
  assert.ok((result.readFrom ?? 0) > 0, 'le début de l’appel n’a pas été lu')

  const sent = seen[0] ?? ''
  const transcript = sent.slice(sent.indexOf('Transcription :\n') + 'Transcription :\n'.length)
  // Whole turns only: every line opens on a speaker label, the first included.
  for (const line of transcript.split('\n')) {
    assert.match(line, /^(Commercial|Client) : /, `ligne coupée : « ${line.slice(0, 40)}… »`)
  }
  // The last turn of the call is always in — the tail is what is kept.
  assert.ok(transcript.includes('fin 199.'))
  // And the model is told, or it answers « ce n’est pas dans la réunion » about
  // a part of the réunion it was never given.
  assert.match(sent, /seule la fin de la réunion/i)
})

test('one turn longer than the whole budget is still sent, rather than nothing', async () => {
  // An empty transcript would be reported as « nothing was said », which is a
  // different answer and a wrong one.
  const { port, seen } = spy()
  const segments = [turn(0, 'x'.repeat(70_000))]

  const result = await askTranscript(port, { question: 'Quoi ?', segments })

  assert.notEqual(result.readFrom, null)
  assert.ok((seen[0] ?? '').includes('Commercial : '))
})
