/**
 * **The share `--rhythm` prints, held to the population it is drawn from.**
 *
 * `shot.mjs` printed this over the collapsed widget pill, at 1280×800:
 *
 *     rythme: 42 espacement(s) peint(s) sur 71 élément(s),
 *             47.6% sur les 7 pas déclarés · épargnés : 22 graphique
 *
 * The pill's off-ladder count is **zero**. The share was `onLadder / measured`,
 * and `measured` still counts the values the four sparing rules removed from
 * the judgement eight words later — so the line said « 47.6 % » about a surface
 * whose every judged value is on the scale. A blind scorer read it as « half
 * this surface's spacing is off scale » and filed it before checking.
 *
 * `BEAT` below is **not written by hand**: it is what `rhythm()` returned from
 * the shipped page on that stage, dumped from the running pass. The guard test
 * refuses it if it ever stops carrying both populations — a beat with nothing
 * spared, or nothing on the ladder, cannot tell the two denominators apart and
 * would leave this file green over the defect it exists to pin.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rhythmShare, onStep } from '../harness/rhythmShare.mjs'

/**
 * Recorded from `node scripts/harness/shot.mjs widget --rhythm --viewport
 * 1280x800`. The twenty 1 px gaps and the two 2 px ones are the level meter's
 * bars — a drawing, which is the `graphique` rule — and the rest is the pill's
 * own layout.
 */
const BEAT = {
  ladder: [
    { name: 'hair', value: 4 },
    { name: 'tight', value: 6 },
    { name: 'snug', value: 8 },
    { name: 'inline', value: 12 },
    { name: 'row', value: 16 },
    { name: 'block', value: 20 },
    { name: 'gutter', value: 32 },
  ],
  measured: 42,
  elements: 71,
  values: [
    { v: 1, n: 20 },
    { v: 6, n: 6 },
    { v: 4, n: 6 },
    { v: 20, n: 4 },
    { v: 12, n: 2 },
    { v: 8, n: 2 },
    { v: 2, n: 2 },
  ],
  off: [],
  spared: [
    {
      value: 1,
      kind: 'gap',
      sides: [],
      at: 'div.flex.flex-1.flex-col.gap-px',
      near: 'DIV',
      why: 'graphique',
      n: 20,
    },
    {
      value: 2,
      kind: 'gap',
      sides: [],
      at: 'span.flex.h-6.shrink-0.items-stretch',
      near: 'SPAN',
      why: 'graphique',
      n: 2,
    },
  ],
}

test('the recorded beat can tell the two denominators apart', () => {
  const ladder = BEAT.ladder.map((step) => step.value)
  const spared = BEAT.spared.reduce((sum, item) => sum + item.n, 0)
  const onLadder = BEAT.values
    .filter((entry) => onStep(ladder, entry.v))
    .reduce((sum, entry) => sum + entry.n, 0)
  assert.ok(spared > 0, 'un beat sans valeur épargnée ne distingue pas les deux dénominateurs')
  assert.ok(onLadder > 0, 'un beat sans valeur sur l’échelle ne mesure aucune part')
  assert.equal(BEAT.measured, onLadder + spared + BEAT.off.length)
})

test('the share is taken over what was judged, not over what was spared', () => {
  const part = rhythmShare(BEAT, [])
  assert.equal(part.total, 42)
  assert.equal(part.spared, 22)
  assert.equal(part.onLadder, 20)
  assert.equal(part.off, 0)
  assert.equal(part.judged, 20)
  assert.equal(part.percent, 100)

  /*
   * The number that shipped, named so this cannot be re-introduced quietly:
   * over `measured` the same pill reads 47.6 %, which is the sentence a scorer
   * took for a finding. If `percent` is ever computed over `total` again, the
   * assertion above turns red on exactly this line.
   */
  assert.equal(Math.round((1000 * part.onLadder) / part.total) / 10, 47.6)
})

test('a pill with nothing off the ladder does not print a number that reads as a finding', () => {
  const part = rhythmShare(BEAT, [])
  assert.equal(part.off, 0)
  assert.ok(
    part.percent === 100,
    `une part de ${part.percent}% annoncée à côté de 0 hors échelle se lit comme un défaut`,
  )
})

test('the identity binds the denominator to the failing branch', () => {
  assert.equal(rhythmShare(BEAT, []).sound, true)

  /*
   * A fourth route — a value counted as measured and filed nowhere — is the
   * shape that produced the defect, and it is what `sound` refuses.
   */
  const leaky = { ...BEAT, measured: BEAT.measured + 3 }
  assert.equal(rhythmShare(leaky, []).sound, false)
})

test('an allowance is subtracted from what the line calls off the ladder', () => {
  const beat = {
    ...BEAT,
    measured: 45,
    values: [...BEAT.values, { v: 3, n: 3 }],
    off: [{ value: 3, kind: 'pad', sides: ['Top'], at: 'div.x', near: 'X', why: null, n: 3 }],
  }
  const all = rhythmShare(beat, beat.off)
  assert.equal(all.off, 3)
  assert.equal(all.tolerated, 0)
  assert.equal(all.judged, 23)
  assert.equal(all.sound, true)

  const excused = rhythmShare(beat, [])
  assert.equal(excused.tolerated, 3)
})

test('the spared are named by their rule, and counted', () => {
  const { byRule } = rhythmShare(BEAT, [])
  assert.deepEqual([...byRule], [['graphique', 22]])
})
