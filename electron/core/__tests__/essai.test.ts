/**
 * The dry run's verdict.
 *
 * The trial exists because capture is the one subsystem that cannot be repaired
 * after the call, and its whole value is in *which* channel it reports. These
 * hold the three things that make the report worth trusting:
 *
 *  · the two channels are never merged into one green tick — they have opposite
 *    failures and opposite fixes;
 *  · a silent channel is reported as « rien n'a été entendu », never as a broken
 *    machine: the rep may simply not have played anything, and a false statement
 *    about their hardware is one they will act on;
 *  · nothing is graded. « Tout va bien » after twenty seconds of silence would
 *    be the same lie in the other direction.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ESSAI_SECONDS,
  essaiLines,
  essaiSummary,
  essaiWorthRepeating,
  EssaiResultSchema,
  type EssaiResult,
} from '../contracts/essai.ts'

const result = (rep: boolean, far: boolean): EssaiResult => ({
  rep: { heard: rep, peak: rep ? 0.4 : 0.001 },
  far: { heard: far, peak: far ? 0.3 : 0.001 },
  floor: 0.01,
  seconds: ESSAI_SECONDS,
})

test('the schema accepts what the main process reports', () => {
  assert.doesNotThrow(() => EssaiResultSchema.parse(result(true, true)))
})

test('both channels heard is the only case that says there is nothing left to do', () => {
  assert.match(essaiSummary(result(true, true)), /rien d’autre à régler/)
  assert.equal(essaiWorthRepeating(result(true, true)), false)
})

test('the client’s side missing is named as the half that matters', () => {
  // The rep cannot discover this on their own: their own voice is in the
  // transcript, so the recording looks like it worked, and the compte-rendu
  // comes back describing a monologue.
  assert.match(essaiSummary(result(true, false)), /le client non/)
  assert.equal(essaiWorthRepeating(result(true, false)), true)
})

test('the rep’s own side missing is the mirror image', () => {
  assert.match(essaiSummary(result(false, true)), /Le client serait capté, vous non/)
})

test('silence is reported as silence, never as a fault', () => {
  const summary = essaiSummary(result(false, false))
  assert.match(summary, /Rien n’a été entendu/)
  // Conditional, because the rep may simply have said nothing for twenty
  // seconds — which is not a broken machine and must not be called one.
  assert.match(summary, /Si vous avez parlé ou joué un son/)
  assert.doesNotMatch(summary, /panne|erreur|échec/i)
})

test('each channel gets its own sentence, in the rep’s vocabulary', () => {
  const lines = essaiLines(result(true, false))
  assert.deepEqual(
    lines.map((line) => line.channel),
    ['rep', 'far'],
  )
  // Never « rep » and never « far »: those are the code's words for the two
  // sides, and this screen is read by somebody who has not seen the code.
  assert.equal(lines[0]?.title, 'Votre voix')
  assert.equal(lines[1]?.title, 'L’audio de votre ordinateur')

  assert.equal(lines[0]?.heard, true)
  assert.match(lines[0]?.sentence ?? '', /Entendue/)
  // And the failing one says what to check, not that something is wrong.
  assert.match(lines[1]?.sentence ?? '', /autorisation d’enregistrement de l’écran/)
})
