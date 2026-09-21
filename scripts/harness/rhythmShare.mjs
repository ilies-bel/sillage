/**
 * **What `--rhythm` is entitled to say about the spacing it measured.**
 *
 * This is one function and it exists because the sentence it builds was wrong
 * in a way no check could see. `shot.mjs` printed
 *
 *     rythme: 42 espacement(s) peint(s) sur 71 élément(s),
 *             47.6% sur les 7 pas déclarés · épargnés : 22 graphique
 *
 * on the collapsed widget pill, whose actual off-ladder count is **zero**: the
 * failing branch under that line had nothing in it. The share was
 * `onLadder / measured`, and `measured` counts the values the four sparing
 * rules have already removed from the judgement — so the denominator included
 * what the same sentence, eight words later, says it spared. A reader takes
 * 47.6 % as « half of this surface's spacing is off scale ». A blind scorer
 * took it exactly that way and filed it as a finding before checking.
 *
 * The direction matters: it read **worse** than the truth. A flattering number
 * gets audited the first time somebody doubts a green run; a pessimistic one is
 * believed, acted on, and quoted. This repo's rule is « a number that is
 * computed, printed and binds nothing is not a check »; a number that is
 * computed, printed and *misleads* is the same defect with a cost attached.
 *
 * So the share is over the population the verdict is drawn from — `judged` —
 * and every other population is printed beside it by name. `sound` is the
 * identity the two halves must satisfy: every value the pass measures is routed
 * to exactly one of on-ladder, spared, off-ladder. It is not expected to fire on
 * a working tree. It fires the day somebody adds a fourth route and leaves the
 * denominator counting it, which is exactly how the 47.6 % arrived.
 *
 * Pure, and in its own file, so `node --test` can put the widget pill's real
 * numbers through the shipped arithmetic without a browser.
 */

/** Is a painted length one of the declared steps? The pass's own tolerance. */
export const onStep = (ladder, value) =>
  ladder.some((step) => Math.abs(step - Math.abs(value)) <= 0.5)

/**
 * @param beat the object `rhythm()` returns from the page
 * @param stray the off-ladder places left after `RHYTHM_ALLOWANCES`
 */
export function rhythmShare(beat, stray) {
  const ladder = beat.ladder.map((step) => (typeof step === 'number' ? step : step.value))
  const total = beat.measured
  const onLadder = beat.values
    .filter((entry) => onStep(ladder, entry.v))
    .reduce((sum, entry) => sum + entry.n, 0)
  const spared = beat.spared.reduce((sum, item) => sum + item.n, 0)
  const off = beat.off.reduce((sum, item) => sum + item.n, 0)
  const judged = total - spared
  const byRule = new Map()
  for (const item of beat.spared) byRule.set(item.why, (byRule.get(item.why) ?? 0) + item.n)
  return {
    total,
    onLadder,
    spared,
    off,
    judged,
    byRule,
    tolerated: off - stray.reduce((sum, item) => sum + item.n, 0),
    /* One decimal, as it has always been printed. */
    percent: judged === 0 ? 0 : Math.round((1000 * onLadder) / judged) / 10,
    sound: judged === onLadder + off,
  }
}
