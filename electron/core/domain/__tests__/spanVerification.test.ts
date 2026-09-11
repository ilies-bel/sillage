/**
 * DEC-21 without a model: the check that decides whether a citation is evidence
 * or a sentence someone invented.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { locateSegments, type Channel, type TranscriptSegment } from '../../contracts/transcript.ts'
import {
  MIN_QUOTE_CHARS,
  confidenceOf,
  locateQuote,
  normalizeForVerification,
  spanOccursIn,
} from '../spanVerification.ts'

let counter = 0
const seg = (
  channel: Channel,
  text: string,
  startMs: number,
  endMs: number,
  isFinal = true,
): TranscriptSegment => ({
  id: `s${++counter}`,
  channel,
  text,
  startMs,
  endMs,
  isFinal,
  provider: 'stub',
  receivedAt: 0,
})

const CALL: TranscriptSegment[] = [
  seg('far', 'Notre budget tourne autour de 520 euros par jour.', 1_000, 6_000),
  seg('rep', 'Très bien, je note un TJM de 520 euros.', 6_500, 9_000),
  seg('far', 'Le démarrage serait plutôt', 10_000, 12_000),
  seg('far', 'en septembre, après les congés.', 12_100, 14_000),
]

test('a quote that was said is located, with the channel and timings measured', () => {
  const found = locateQuote('520 euros par jour', CALL)
  assert.deepEqual(found, { channel: 'far', startMs: 1_000, endMs: 6_000 })
})

test('a quote that was never said is not located', () => {
  assert.equal(locateQuote('nous partons sur du forfait', CALL), null)
})

test('the rep is searched before the far end, so a shared phrase resolves to the rep', () => {
  assert.equal(locateQuote('520 euros', CALL)?.channel, 'rep')
  // Naming the channel pins it to the other speaker.
  assert.equal(locateQuote('520 euros', CALL, 'far')?.channel, 'far')
})

test('a quote straddling two segments verifies — providers cut on silence, not sentences', () => {
  const found = locateQuote('serait plutôt en septembre', CALL)
  assert.deepEqual(found, { channel: 'far', startMs: 10_000, endMs: 14_000 })
})

test('case, punctuation, currency signs and accents are folded', () => {
  assert.notEqual(locateQuote('TJM DE 520 EUROS !', CALL), null)
  assert.notEqual(locateQuote('demarrage', CALL), null)
  assert.equal(normalizeForVerification('TJM 520 €'), 'tjm 520')
})

test('an interim segment cannot be cited — the provider may still revise it', () => {
  const interim = [seg('far', 'nous cherchons deux développeurs Java', 0, 3_000, false)]
  assert.equal(locateQuote('deux développeurs Java', interim), null)
})

test('a quote too short to be evidence is refused rather than trivially matched', () => {
  assert.ok(MIN_QUOTE_CHARS >= 4)
  assert.equal(locateQuote('€', CALL), null)
  assert.equal(locateQuote('de', CALL), null)
})

test('the span form answers the predicate, and the review gate reads a confidence', () => {
  const good = { quote: 'TJM de 520 euros', channel: null, startMs: null, endMs: null }
  const bad = { quote: 'engagement de trois ans', channel: null, startMs: null, endMs: null }
  assert.equal(spanOccursIn(good, CALL), true)
  assert.equal(spanOccursIn(bad, CALL), false)
  assert.equal(confidenceOf(good, CALL), 'ok')
  assert.equal(confidenceOf(bad, CALL), 'faible')
})

test('a span claiming the wrong speaker does not verify', () => {
  const misattributed = {
    quote: 'Notre budget tourne autour',
    channel: 'rep' as Channel,
    startMs: null,
    endMs: null,
  }
  assert.equal(spanOccursIn(misattributed, CALL), false)
})

// ── the gate and the reader agree, because there is one search ──────────────

test('anything the gate certifies, the reader can open — the four routine cases', () => {
  /*
   * `TranscriptReader` wrote its own lookup — `segments.find((s) =>
   * s.text.includes(quote))`, raw, inside one segment — under a comment saying
   * it was « deliberately the same test `spanVerification.ts` uses ». It was not
   * the same test in four ways, and each of them happens on an ordinary French
   * call, so a rep pressed `[source ▸]` on a row the app had just certified and
   * read « Cet extrait est introuvable dans la transcription. »
   *
   * The property is the one that matters and it is stated directly: whatever
   * `confidenceOf` calls `ok`, `locateSegments` finds.
   */
  const turn = (id: string, channel: 'rep' | 'far', text: string, at: number): TranscriptSegment => ({
    id,
    channel,
    text,
    startMs: at,
    endMs: at,
    isFinal: true,
    provider: 'test',
    receivedAt: at,
  })

  const cases: { why: string; segments: TranscriptSegment[]; quote: string }[] = [
    {
      why: 'accent perdu par la transcription',
      segments: [turn('s1', 'far', 'le demarrage est prevu en janvier', 1000)],
      quote: 'le démarrage est prévu en janvier',
    },
    {
      why: 'apostrophe typographique',
      segments: [turn('s1', 'far', "c'est l'equipe achats qui tranche", 1000)],
      quote: 'c’est l’équipe achats qui tranche',
    },
    {
      why: 'point final ajouté par le modèle',
      segments: [turn('s1', 'far', 'la grille plafonne à 550 euros', 1000)],
      quote: 'La grille plafonne à 550 euros.',
    },
    {
      why: 'citation à cheval sur deux tours',
      segments: [
        turn('s1', 'far', 'on doit sortir les pipelines Talend', 1000),
        turn('s2', 'far', 'historiques avant la fin de l’année', 2000),
      ],
      quote: 'les pipelines Talend historiques avant la fin',
    },
  ]

  for (const { why, segments, quote } of cases) {
    const span = { quote, channel: 'far' as const, startMs: null, endMs: null }
    assert.equal(confidenceOf(span, segments), 'ok', `${why} : le gate ne vérifie plus`)
    assert.ok(
      locateSegments(quote, segments, 'far').length > 0,
      `${why} : le gate certifie et le lecteur dit « introuvable »`,
    )
  }
})

test('a quote that is genuinely absent stays absent on both', () => {
  const segments: TranscriptSegment[] = [
    {
      id: 's1',
      channel: 'far',
      text: 'on parlait du planning',
      startMs: 0,
      endMs: 0,
      isFinal: true,
      provider: 'test',
      receivedAt: 0,
    },
  ]
  const span = { quote: 'le budget est de deux cent mille euros', channel: 'far' as const, startMs: null, endMs: null }
  assert.equal(confidenceOf(span, segments), 'faible')
  assert.deepEqual(locateSegments(span.quote, segments, 'far'), [])
})
