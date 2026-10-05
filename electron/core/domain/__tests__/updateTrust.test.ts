/**
 * An update this machine cannot verify is not an update it should install.
 *
 * `electron-updater` runs the installer it downloaded; on Windows it checks the
 * Authenticode signature *if* it has an expected publisher to check against, and
 * this build declares none — so the check is skipped rather than failed, and the
 * rep gets a one-click « Installer et redémarrer » that executes whatever the
 * feed served.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isWrittenSentence } from '../../contracts/health.ts'
import { MANUAL_INSTALL, NO_UPDATER, updateTrust } from '../updateTrust.ts'

test('an unsigned Windows build cannot verify an update, and says so', () => {
  const verdict = updateTrust('win32', {})
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason ?? '', /n’est pas signée/)
  // The sentence names the remedy, because a degradation with no way forward is
  // the dead end DEC-26 forbids.
  assert.match(verdict.reason ?? '', /à la main/)
})

test('a declared publisher is what lifts it', () => {
  assert.deepEqual(updateTrust('win32', { publisherName: 'Iliès Beldjilali' }), {
    ok: true,
    reason: null,
  })
  // electron-builder takes a list too.
  assert.equal(updateTrust('win32', { publisherName: ['A', 'B'] }).ok, true)
  assert.equal(updateTrust('win32', { certificateFile: 'build/cert.pfx' }).ok, true)
})

test('an empty string is not a publisher', () => {
  // The failure this defends against is a config that *looks* configured — a
  // key present and blank is exactly what a half-finished signing setup leaves.
  assert.equal(updateTrust('win32', { publisherName: '   ' }).ok, false)
  assert.equal(updateTrust('win32', { certificateFile: '' }).ok, false)
  assert.equal(updateTrust('win32', { publisherName: [] }).ok, false)
  assert.equal(updateTrust('win32', { publisherName: null }).ok, false)
})

test('macOS is verified by the OS and needs no rule here', () => {
  assert.deepEqual(updateTrust('darwin', {}), { ok: true, reason: null })
  assert.deepEqual(updateTrust('linux', null), { ok: true, reason: null })
})

/**
 * **The paragraph a rep reads, read as a paragraph.**
 *
 * Driving the shipped `UpdatePanel` with the shipped producers printed this, at
 * both smoke sizes, on the branch every Windows build shipping today takes:
 *
 *   « mise à jour automatique désactivée : cette version n’est pas signée, rien
 *     ne pourrait vérifier que la mise à jour vient bien de l’éditeur. Les
 *     nouvelles versions sont à installer à la main. Les nouvelles versions sont
 *     publiées sur GitHub. »
 *
 * and, on the build with no updater, « mise à jour automatique indisponible dans
 * cette build Les nouvelles versions sont publiées sur GitHub. » — no
 * punctuation at the join.
 *
 * Nothing could have caught it: the panel appended its own sentence, and the
 * reason it appended to is composed here, in a layer the renderer may not
 * import. Three separate fixtures hand-wrote a `disabled` reason and every one
 * of them was green. So the paragraph is composed here, whole, and these are
 * the two properties it has to keep — `isWrittenSentence` from
 * `core/contracts/health.ts` rather than a second predicate, because it is the
 * same question the widget's sentences answer.
 */
const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')

const opening = (sentence: string): string =>
  sentence.split(/\s+/u).slice(0, 3).join(' ').toLocaleLowerCase('fr')

test('every paragraph this file composes is a written sentence, and says the remedy once', () => {
  const paragraphs: Array<[string, string]> = [
    ['updateTrust (unsigned Windows)', updateTrust('win32', {}).reason ?? ''],
    ['NO_UPDATER (no updater at all)', NO_UPDATER],
  ]
  for (const [name, text] of paragraphs) {
    assert.ok(isWrittenSentence(text), `${name} n’est pas une phrase écrite : « ${text} »`)

    const sentences = sentencesOf(text)
    assert.ok(sentences.length >= 2, `${name} ne dit pas la cause puis le remède`)
    for (const sentence of sentences) {
      assert.ok(
        isWrittenSentence(sentence),
        `${name} : « ${sentence} » n’ouvre pas sur une capitale ou ne se ferme pas`,
      )
    }

    // The repetition itself: no two sentences of one paragraph may open on the
    // same three words. « Les nouvelles versions … » twice is what shipped.
    const openings = sentences.map(opening)
    assert.equal(
      new Set(openings).size,
      openings.length,
      `${name} répète une ouverture de phrase : ${openings.join(' / ')}`,
    )

    // One remedy, named once, and it is the last thing said.
    assert.equal(
      text.split(MANUAL_INSTALL).length - 1,
      1,
      `${name} dit le remède ${text.split(MANUAL_INSTALL).length - 1} fois`,
    )
    assert.ok(text.endsWith(MANUAL_INSTALL), `${name} ne finit pas sur le remède`)
  }
})
