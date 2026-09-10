/**
 * *Demander*, and the one thing that makes it worth having (DEC-21).
 *
 * A general notetaker's chat answers from a document the model itself wrote, so
 * a mistake in the summary becomes a mistake in the answer with nothing left to
 * check it against. This one is answered over the stored transcript and every
 * quote is looked up in it before the answer reaches the screen.
 *
 * The tests that matter here are the negative ones. Verifying a quote that is
 * really there is easy and would pass against an implementation that verified
 * nothing; what has to hold is that an invented quote is **kept and marked**,
 * because dropping it would leave a confident paragraph with one fewer footnote
 * and no sign that anything had gone wrong.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { TranscriptSegment } from '../../contracts/transcript.ts'
import type { AskDraft } from '../../contracts/ask.ts'
import { verifyAnswer } from '../askAnswer.ts'

const segment = (
  id: string,
  channel: 'rep' | 'far',
  startMs: number,
  text: string,
): TranscriptSegment => ({
  id,
  channel,
  startMs,
  endMs: startMs + 4_000,
  text,
  isFinal: true,
  provider: 'stub',
  receivedAt: startMs,
})

const RECORD: TranscriptSegment[] = [
  segment('s1', 'far', 60_000, 'Il nous manque deux data engineers sur la migration.'),
  segment('s2', 'rep', 120_000, 'On est plutôt sur du 550 euros pour un profil confirmé.'),
  segment('s3', 'far', 180_000, 'La grille achats plafonne à 550 sur un confirmé.'),
]

const draft = (over: Partial<AskDraft> = {}): AskDraft => ({
  answered: true,
  answer: 'Le client indique qu’il manque deux data engineers.',
  quotes: [{ quote: 'il nous manque deux data engineers', channel: 'far' }],
  ...over,
})

test('a quote that is in the record is verified, and carries the record’s own time', () => {
  const answer = verifyAnswer('Combien de profils ?', draft(), RECORD)

  assert.equal(answer.answered, true)
  assert.equal(answer.citations.length, 1)
  const [citation] = answer.citations
  assert.equal(citation?.verified, true)
  // The timestamps are the located segment's. The model is never asked for one
  // and would invent it if it were — a batch transcriber reports no acoustic
  // time at all (DEC-41).
  assert.equal(citation?.span.startMs, 60_000)
  assert.equal(citation?.span.endMs, 64_000)
})

/*
 * The whole point. An answer that leans on something nobody said keeps its
 * footnote and the footnote says it failed — the rep can then distrust that
 * sentence specifically. Dropping it would produce a paragraph that looks
 * exactly like a well-sourced one.
 */
test('a quote that is nowhere in the record is kept and marked, never dropped', () => {
  const answer = verifyAnswer(
    'Et le budget ?',
    draft({
      answer: 'Le client annonce un budget de 400 000 euros.',
      quotes: [{ quote: 'notre budget est de 400 000 euros', channel: 'far' }],
    }),
    RECORD,
  )

  assert.equal(answer.citations.length, 1)
  assert.equal(answer.citations[0]?.verified, false)
  // Nowhere to point, so it points nowhere. A timestamp on an unverified quote
  // would send the rep to a moment that does not contain it.
  assert.equal(answer.citations[0]?.span.startMs, null)
  assert.equal(answer.citations[0]?.span.endMs, null)
  // And the prose is still shown: the rep judges it, with the failure beside it.
  assert.match(answer.answer, /400 000/)
})

test('the channel is the one the quote was found on, not the one claimed', () => {
  // The model attributes a client sentence to the rep. The record settles it.
  const answer = verifyAnswer(
    'Qui a parlé de la grille ?',
    draft({
      quotes: [{ quote: 'la grille achats plafonne à 550', channel: 'rep' }],
    }),
    RECORD,
  )

  assert.equal(answer.citations[0]?.verified, true)
  assert.equal(answer.citations[0]?.span.channel, 'far')
})

test('the same sentence twice is one citation', () => {
  const answer = verifyAnswer(
    'Combien ?',
    draft({
      quotes: [
        { quote: 'il nous manque deux data engineers', channel: 'far' },
        { quote: 'Il nous manque deux data engineers', channel: null },
      ],
    }),
    RECORD,
  )

  assert.equal(answer.citations.length, 1)
})

test('a fragment too short to verify is not offered as a citation', () => {
  // `locateQuote` refuses anything under `MIN_QUOTE_CHARS`, so a three-character
  // needle would arrive permanently unverifiable and read as an app failure
  // rather than as a model one.
  const answer = verifyAnswer('?', draft({ quotes: [{ quote: 'du', channel: null }] }), RECORD)

  assert.equal(answer.citations.length, 0)
  assert.equal(answer.answered, true)
})

test('« the record does not say » is an answer, and draws no prose', () => {
  const answer = verifyAnswer(
    'Ont-ils parlé de RGPD ?',
    draft({ answered: false, answer: '', quotes: [] }),
    RECORD,
  )

  assert.deepEqual(answer, {
    question: 'Ont-ils parlé de RGPD ?',
    answered: false,
    answer: '',
    citations: [],
  })
})

/*
 * `answered` is the field a model is most likely to get wrong, because it is the
 * one that asks it to admit failure. An empty string with `answered: true` is
 * the same outcome and has to render the same way — not as an answer pane
 * holding nothing.
 */
test('an empty answer is a non-answer however the model labelled it', () => {
  const answer = verifyAnswer('?', draft({ answered: true, answer: '   ' }), RECORD)

  assert.equal(answer.answered, false)
  assert.equal(answer.answer, '')
  assert.deepEqual(answer.citations, [])
})

test('the question carried back is the rep’s own string', () => {
  // Never the model's restatement of it: the panel prints this above the answer,
  // and a question that came back subtly reworded is a screen quietly changing
  // what was asked.
  const answer = verifyAnswer('Quel TJM ?', draft(), RECORD)
  assert.equal(answer.question, 'Quel TJM ?')
})
