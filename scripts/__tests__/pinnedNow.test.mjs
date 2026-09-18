/**
 * **The pin is a pin, and the docblock said so while it moved daily.**
 *
 * `pinnedNow` reads « so two runs of the same screen produce the same pixels ».
 * It built its instant from `new Date()`, so the property held within a day and
 * failed across one — and that is not cosmetic on a harness whose whole purpose
 * is comparing one round's numbers to the next. Same commit, consecutive days,
 * `--scan` on `agenda`: « 15 signalements, 4 types » became « 16, 5 », the extra
 * being `extreme-negative-tracking` on « Vendredi 18 septembre », three
 * characters longer than « Jeudi 17 septembre » at `--display-tracking: -1.5px`.
 * One French weekday name moved a detector count by 26 scans with nothing in
 * `src/` changed.
 *
 * Two properties, because either alone passes by accident:
 *
 *  1. **It does not move.** Asserted against a literal instant, not against a
 *     second call — two calls a millisecond apart agree even when the value
 *     comes from the wall clock. The literal is what makes this red on the old
 *     shape, on every day except one.
 *  2. **It is 14:35 in Paris**, resolved through the zone rather than a stored
 *     offset, so moving the pin across a DST boundary cannot quietly shift it by
 *     an hour.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pinnedNow, PINNED_DAY } from '../harness/pinnedNow.mjs'

test('the pinned instant does not move with the wall clock', () => {
  assert.equal(
    new Date(pinnedNow()).toISOString(),
    '2026-09-17T12:35:00.000Z',
    'l’instant épinglé a bougé — deux tours mesurés des jours différents ne comparent ' +
      'plus le même produit, et la comparaison entre tours est tout l’outil',
  )
})

test('the pin reads 14:35 in Paris, whichever side of the clock change it falls', () => {
  const shown = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(pinnedNow())
  assert.match(shown, /jeudi 17 septembre/, `le jour épinglé n’est pas celui annoncé : ${shown}`)
  assert.match(shown, /14:35/, `l’heure épinglée n’est pas 14:35 à Paris : ${shown}`)
  assert.equal(PINNED_DAY.hour, 14)
  assert.equal(PINNED_DAY.minute, 35)
})
