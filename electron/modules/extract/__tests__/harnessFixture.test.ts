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
 * It holds a second property now, for the same reason and found the same way.
 * `REGISTRE` licenses guillemets for words the client *actually said*, so a
 * quotation in the compte-rendu is the one part of that prose which claims to be
 * verbatim — and the fixture's document quoted two phrases the call did not
 * contain. Nothing could show it until the prose's quotations became followable
 * (DEC-21); the first one pressed opened the reader on « Cet extrait est
 * introuvable dans la transcription ».
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


test('every quotation in the fixture’s compte-rendu is in the fixture’s call', () => {
  const source = readFileSync(STUB, 'utf8')

  const prose = /'## Résumé',([\s\S]*?)'## Éléments retenus'/.exec(source)?.[1]
  const lines = /const LINES = \[([\s\S]*?)\n  \]/.exec(source)?.[1]
  assert.ok(prose && lines, 'le harnais a changé de forme — mets ce test à jour')

  /*
   * The same fold `locateQuote` applies: accents dropped, case folded,
   * punctuation collapsed. The model's transcription of what it read and the
   * transcriber's own disagree on a comma often enough that an exact match would
   * fail a citation that is perfectly real.
   */
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  const call = fold(lines)
  const quotes = [...prose.matchAll(/«[\s\u00a0\u202f]?(\S(?:[^«»]*\S)?)[\s\u00a0\u202f]?»/gu)].map(
    (match) => match[1] ?? '',
  )
  assert.ok(quotes.length >= 3, `attendues au moins trois citations, trouvées ${quotes.length}`)

  const invented = quotes.filter((quote) => !call.includes(fold(quote)))
  assert.deepEqual(
    invented,
    [],
    'le compte-rendu de démonstration cite des mots que l’appel ne contient pas — ' +
      'le vrai composeur ne peut pas : le modèle ne voit que la transcription, et ' +
      'REGISTRE n’autorise les guillemets que pour ce que le client a dit.',
  )
})

test('every source the fixture offers leads to a turn the fixture’s call contains', () => {
  /*
   * The document's provenance (DEC-21), held to the same standard as its
   * quotations — and for the same reason, which is that the failure is silent.
   *
   * Twelve bullets became followable. A `span.quote` the transcript does not
   * contain opens the reader on « Cet extrait est introuvable dans la
   * transcription », so a fixture with one invented quote would photograph the
   * feature's *failure* state on the flagship screen and pass every other check
   * in the repo. The stub has already been caught lying three times, each time
   * about something that made the app look better than it is.
   */
  const source = readFileSync(STUB, 'utf8')
  const block = /sources: \[([\s\S]*?)\n    \],/.exec(source)?.[1]
  const lines = /const LINES = \[([\s\S]*?)\n  \]/.exec(source)?.[1]
  assert.ok(block && lines, 'le harnais a changé de forme — mets ce test à jour')

  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  const call = fold(lines)
  const quotes = [...block.matchAll(/quote: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? '')
  assert.ok(quotes.length >= 10, `attendues au moins dix sources, trouvées ${quotes.length}`)

  const missing = quotes.filter((quote) => !call.includes(fold(quote)))
  assert.deepEqual(
    missing,
    [],
    'une source du compte-rendu de démonstration pointe vers des mots que l’appel ' +
      'ne contient pas — la capture montrerait « introuvable » sur la fonctionnalité ' +
      'qu’elle est censée prouver.',
  )

  /*
   * And the other half: a source whose `text` is not a line of the fixture's own
   * compte-rendu matches nothing, so the bullet is drawn plain and the entry is
   * dead weight that no screenshot would reveal.
   */
  const doc = /compteRendu: \[([\s\S]*?)\n    \]\.join/.exec(source)?.[1] ?? ''
  const written = new Set(
    [...doc.matchAll(/'- ((?:[^'\\]|\\.)*)'/g)].map((m) =>
      (m[1] ?? '').replace(/[\s ]*⚠[\s ]*faible[\s ]*$/u, '').trim(),
    ),
  )
  const texts = [...block.matchAll(/text:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? '')
  const orphans = texts.filter((text) => !written.has(text))
  assert.deepEqual(
    orphans,
    [],
    'une source ne correspond à aucune ligne du compte-rendu de démonstration — ' +
      'le rendu compare par égalité, donc cette puce resterait sans provenance.',
  )
})
