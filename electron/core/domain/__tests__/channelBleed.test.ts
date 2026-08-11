/**
 * The rule that stops the client's words being attributed to the rep.
 *
 * The fixtures in the first test are shaped from a real call — a MacBook with
 * its speakers on and its built-in microphone open — where three of five
 * far-end utterances came back duplicated on the rep channel. The words are
 * paraphrased; the *shape* is not, because the shape is the whole point: two
 * independent transcriptions of one utterance, overlapping in time, differing
 * in punctuation and in a word or two.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BLEED_MIN_WORDS,
  bleedReport,
  containmentRatio,
  contentWords,
  isBleed,
  wordCount,
  withoutChannelBleed,
} from '../channelBleed.ts'
import type { Channel, TranscriptSegment } from '../../contracts/transcript.ts'

let seq = 0
const seg = (
  channel: Channel,
  text: string,
  startMs: number,
  endMs = startMs + 6000,
): TranscriptSegment => ({
  id: `s${(seq += 1)}`,
  channel,
  text,
  startMs,
  endMs,
  isFinal: true,
  provider: 'test',
  receivedAt: startMs,
})

test('the microphone hearing the speakers is dropped, and the tap is kept', () => {
  const segments = [
    seg('far', 'Est-ce que vous voyez bien mon écran ? Ok, on va commencer.', 104_000),
    seg('rep', 'Est-ce que vous voyez le bien mon écran ? OK, on va commencer.', 104_400),
  ]

  const kept = withoutChannelBleed(segments)

  assert.equal(kept.length, 1)
  assert.equal(kept[0]?.channel, 'far')
})

test('the whole call: three bleeds out of five far utterances, and nothing else lost', () => {
  const segments = [
    seg('rep', 'Bonjour, merci de nous recevoir aujourd’hui pour ce point.', 8_000),
    seg('far', 'Non, moi c’est deux semaines, je pars travailler dans le sud.', 51_000),
    seg('rep', 'Non moi c’est deux semaines, je pars travailler dans le sud.', 51_400),
    seg('rep', 'Profite bien.', 57_000),
    seg('far', 'Ahmed est en congé pendant ces deux semaines, donc on décale.', 75_000),
    seg('rep', 'Ahmed est en congé pendant ces deux semaines donc on décale.', 75_900),
    seg('far', 'Ce point concerne le besoin exprimé par la direction technique.', 104_000),
    seg('rep', 'Ce point concerne le besoin exprimé par la direction technique.', 104_400),
    seg('rep', 'D’accord, on part sur trois profils confirmés alors.', 118_000),
  ]

  assert.deepEqual(bleedReport(segments), { dropped: 3, repSegments: 6 })

  const kept = withoutChannelBleed(segments)
  // The three far utterances survive, and so does everything the rep genuinely
  // said — including the short « Profite bien. » that no threshold may eat.
  assert.equal(kept.filter((s) => s.channel === 'far').length, 3)
  assert.deepEqual(
    kept.filter((s) => s.channel === 'rep').map((s) => s.startMs),
    [8_000, 57_000, 118_000],
  )
})

test('a rep segment straddling two far batches is still one utterance', () => {
  /*
   * The two channels are batched independently — different suppressor
   * thresholds, different hangovers — so one utterance is routinely cut in one
   * place on `far` and another on `rep`. Compared against each far segment
   * separately this scores about half its true containment and survives, which
   * lets the longest, most fact-carrying bleed through. The union is the fix.
   */
  const segments = [
    seg('far', 'Ils veulent développer librement leur agent RAG.', 249_000),
    seg('far', 'Donc ils veulent piloter eux-mêmes l’indexation.', 250_200),
    seg('rep', 'Ils veulent développer librement leur agent RAG, donc piloter eux-mêmes l’indexation.', 249_400),
  ]

  const kept = withoutChannelBleed(segments)

  assert.equal(kept.length, 2)
  assert.ok(kept.every((s) => s.channel === 'far'))
})

test('the window is proximity of arrival, not an interval overlap', () => {
  /*
   * `modules/transcribe` sets `startMs === endMs`, both to the instant the
   * batch arrived — a batch provider cannot report the acoustic time of the
   * words inside it (`transcribe/index.ts`). The first version of this rule
   * asked whether the intervals intersected, which for zero-length intervals
   * means the two instants coincide exactly. It never fired: on a real
   * 56-segment call it dropped nothing, while the true pairs sat 27–730 ms
   * apart.
   */
  const far = seg('far', 'Ils veulent piloter eux-mêmes toute l’indexation documentaire.', 200_444, 200_444)
  const rep = seg('rep', 'Ils veulent piloter eux-mêmes toute l’indexation documentaire.', 200_471, 200_471)

  assert.notEqual(rep.startMs, far.startMs)
  assert.equal(rep.startMs, rep.endMs)
  assert.equal(isBleed(rep, [far]), true)
})

test('an echo far outside the window is a coincidence and is kept', () => {
  const far = seg('far', 'Ils veulent piloter eux-mêmes toute l’indexation documentaire.', 200_000)
  const rep = seg('rep', 'Ils veulent piloter eux-mêmes toute l’indexation documentaire.', 240_000)

  assert.equal(isBleed(rep, [far]), false)
})

test('a rep repeating the client’s figure back at them survives', () => {
  // The most ordinary move in a sales call, and the one words-alone would eat.
  // Same words, a minute later — no time overlap, so not an echo.
  const segments = [
    seg('far', 'Nos achats bloquent au-dessus de cinq cent cinquante euros.', 35_000),
    seg('rep', 'Donc vos achats bloquent au-dessus de cinq cent cinquante euros.', 95_000),
  ]

  assert.deepEqual(withoutChannelBleed(segments), segments)
})

test('a rep interrupting over the client survives', () => {
  // Overlapping in time and genuinely different speech — what time-alone would
  // eat. Simultaneous talk is a conversation, not an echo.
  const segments = [
    seg('far', 'On aimerait démarrer début septembre sur douze mois fermes.', 40_000),
    seg('rep', 'Sur douze mois je peux vous proposer une clause de sortie.', 42_000),
  ]

  assert.deepEqual(withoutChannelBleed(segments), segments)
})

test('a short backchannel is never dropped, whatever it matches', () => {
  // « ouais » under a far segment containing « ouais » scores 1.0. Below
  // `BLEED_MIN_WORDS` the ratio is not consulted at all, because the cost of
  // eating something the rep really said outweighs a stray echoed « ouais ».
  const far = seg('far', 'Ouais, tout à fait, c’est bien ça.', 20_000)
  const rep = seg('rep', 'Ouais.', 20_500)

  assert.equal(isBleed(rep, [far]), false)
  assert.ok(wordCount(rep.text) < BLEED_MIN_WORDS)
})

test('a sentence carrying one distinctive word is a coincidence, not an echo', () => {
  // Long enough to pass the sentence guard, thin enough that its single shared
  // content word would otherwise score a perfect 1.0.
  const far = seg('far', 'Je pense qu’on tient le budget sur ce périmètre.', 30_000)
  const rep = seg('rep', 'Oui je pense que c’est bien ça pour nous.', 30_500)

  assert.ok(wordCount(rep.text) >= BLEED_MIN_WORDS)
  assert.ok(contentWords(rep.text).length < 3)
  assert.equal(isBleed(rep, [far]), false)
})

test('with no far channel nothing is dropped — there is nothing to duplicate', () => {
  // A meeting recorded on the microphone alone: no loopback, no tap, and every
  // rep segment is the only record of what was said.
  const segments = [
    seg('rep', 'Ils cherchent deux data engineers confirmés sur Databricks.', 0),
    seg('rep', 'Ils cherchent deux data engineers confirmés sur Databricks.', 6_000),
  ]

  assert.deepEqual(withoutChannelBleed(segments), segments)
  assert.deepEqual(bleedReport(segments), { dropped: 0, repSegments: 2 })
})

test('the far channel is never filtered against itself', () => {
  // Two genuine far utterances that happen to repeat: the tap has no acoustic
  // path, so a duplicate there is the client actually saying it twice.
  const segments = [
    seg('far', 'On reste sur douze mois avec une clause de sortie à six.', 10_000),
    seg('far', 'On reste sur douze mois avec une clause de sortie à six.', 10_500),
  ]

  assert.deepEqual(withoutChannelBleed(segments), segments)
})

test('punctuation and case never decide it — the two channels transcribe separately', () => {
  const a = contentWords('Est-ce que vous voyez BIEN mon écran ?')
  const b = contentWords('est ce que vous voyez le bien mon écran')

  assert.ok(containmentRatio(a, b) >= 0.6)
})

test('an empty segment scores zero rather than dividing by zero', () => {
  assert.equal(containmentRatio([], ['écran']), 0)
  assert.equal(isBleed(seg('rep', '', 0), [seg('far', 'écran partagé maintenant', 0)]), false)
})

test('the filter preserves order and rewrites nothing', () => {
  const segments = [
    seg('rep', 'Je récapitule les trois profils que vous cherchez.', 0),
    seg('far', 'Exactement, deux confirmés et un lead pour cadrer.', 8_000),
    seg('rep', 'Exactement, deux confirmés et un lead pour cadrer.', 8_400),
    seg('rep', 'Je vous envoie les CV avant vendredi prochain.', 20_000),
  ]

  const kept = withoutChannelBleed(segments)

  assert.deepEqual(
    kept.map((s) => s.id),
    [segments[0]?.id, segments[1]?.id, segments[3]?.id],
  )
  // Identity, not a copy with the same fields — nothing here may rewrite a
  // segment that a citation will later be verified against.
  assert.equal(kept[0], segments[0])
})
