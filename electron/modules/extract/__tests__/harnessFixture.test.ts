/**
 * **The screenshot fixture has to be a document the product could actually
 * write.**
 *
 * `scripts/harness/bridge-stub.mjs` is what every design review looks at. It has
 * now been caught lying three times, each time about something that made the app
 * look better than it is:
 *
 *  · it was four invented headings, roughly half the real length, for five
 *    review rounds — and making it faithful surfaced two shipped bugs in one
 *    afternoon (duplicated `##` sections, literal `**` in the typesetter);
 *  · it claimed a health row the app cannot emit — a `degraded` Outlook for a
 *    token failure that is always `down`, and a Whisper download in `--warn`
 *    when the weights ship inside the installer;
 *  · and this: its compte-rendu attributed quotes to **named attendees** —
 *    « Élodie Vasseur annonce… », « Marc Pontier signale… ». `deterministicLeaks`
 *    refuses exactly that (DEC-7): the model is never shown the attendee list,
 *    so a name in the prose is a name read off a speech-to-text transcript, and
 *    the whole reply is thrown away rather than published. The fixture was
 *    showing a document the composer would have refused, on the flagship screen,
 *    and it made the app look like it knew who was speaking — which it does not.
 *    The transcript has two channels, `rep` and `far`, and DEC-21 verifies the
 *    *quote*, never the *speaker*.
 *
 * A comment saying « keep the fixture faithful » has been written twice and
 * ignored twice. This is the check.
 *
 * It asserts the one property that can be asserted without a model: the prose
 * sections of the fixture's compte-rendu pass the same leak check the real reply
 * must pass. The deterministic header is exempt for the reason the real one is —
 * `renderCompteRendu` writes those four lines itself, from Graph.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDeterministicLeaks } from '../deterministicLeaks.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.resolve(HERE, '../../../../scripts/harness/bridge-stub.mjs')

/**
 * Everyone the fixture's own meeting has on it — read from the stub rather than
 * restated, so a fixture that gains an attendee gains the check with it.
 */
const attendeesIn = (source: string): string[] => {
  const names = new Set<string>()
  // « Prénom Nom » before an address, which is how the stub writes an
  // interlocutor everywhere it writes one.
  for (const match of source.matchAll(
    /([A-ZÉÈÀÂÎÔÙ][\p{L}'’-]+ [A-ZÉÈÀÂÎÔÙ][\p{L}'’-]+)\s*\(?[\p{L}\p{N}._%+-]+@/gu,
  )) {
    const name = match[1]
    if (name) names.add(name)
  }
  return [...names]
}

test('the fixture’s compte-rendu is a document the composer could have produced', () => {
  const source = readFileSync(STUB, 'utf8')

  // The prose, without the deterministic header — which legitimately names
  // people, because `renderCompteRendu` writes it from Graph and not from the
  // model.
  const prose = /'## Résumé',([\s\S]*?)'## Éléments retenus'/.exec(source)?.[1]
  assert.ok(prose, 'le compte-rendu du harnais a changé de forme — mets ce test à jour')

  const names = attendeesIn(source)
  // A guard on the guard: if the extraction stops finding anyone, this test
  // would pass by looking at nothing.
  assert.ok(names.length >= 2, `attendus au moins deux participants, trouvés : ${names.join(', ')}`)

  const leaks = findDeterministicLeaks({ compteRendu: prose }, { names, emails: [] })

  assert.deepEqual(
    leaks,
    [],
    'la prose du compte-rendu de démonstration nomme un participant, une adresse ou une date ' +
      'calendaire — le vrai composeur refuserait cette extraction (DEC-7), donc les captures ' +
      'montrent un document que le produit n’écrit pas. Attribue au côté (« le client », ' +
      '« la DSI ») : le canal est mesuré, la personne ne l’est pas.',
  )
})
