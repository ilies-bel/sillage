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
import { SettingsSnapshotSchema } from '../../../core/contracts/settings.ts'
/*
 * The harness stub is plain JS with no declaration — it runs in a browser page,
 * not under `tsc`. Imported dynamically and typed at the call site, so this test
 * can drive the real fixture without dragging the whole harness into the
 * electron type-check.
 */
const loadStub = async (): Promise<(o: { scenario: string; now: number; entra: boolean }) => void> => {
  const url = new URL('../../../../scripts/harness/bridge-stub.mjs', import.meta.url).href
  const mod = (await import(url)) as {
    installAppBridge: (o: { scenario: string; now: number; entra: boolean }) => void
  }
  return mod.installAppBridge
}

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

test('the fixture’s settings snapshot is one the product could actually send', async () => {
  /*
   * **The fifth time this stub has flattered the app, and the first that made a
   * screen impossible to look at.**
   *
   * Its eight provider rows were missing `fields`, which `ProviderRowSchema`
   * requires and `ProviderLine` reads as `row.fields.length`. So *Transcription*
   * and *Modèle de langage* both threw, the whole app went blank, and every
   * later pane click timed out — and no stage in `shot.mjs` opened either pane,
   * so « 74 mises en scène jouées » and its six measured checks had never
   * touched the surfaces where HR-4, DEC-30, DEC-34 and DEC-35 live. The shipped
   * app was fine; what was lost was the measurement.
   *
   * It also carried « Mistral AI (UE) » where the shipped registry says plain
   * « Mistral AI » — a jurisdiction claim CLAUDE.md explicitly forbids
   * reintroducing (DEC-37), living in the file the product is *looked at*
   * through.
   *
   * `harnessFixture.test.ts` checked the compte-rendu and nothing checked this.
   * Parsed with the product's own schema, which is the only standard that
   * matters: the renderer is typed against it on the other side of the bridge.
   */
  const source = readFileSync(STUB, 'utf8')

  /*
   * The stub is **run**, not parsed. `SETTINGS` closes over other locals, and a
   * regex that lifted the literal out would be a second implementation of the
   * fixture — which is the drift this whole file exists to prevent. A bare
   * `window` is all `installAppBridge` needs: it assigns `window.app` and
   * answers synchronously.
   */
  const globals = globalThis as { window?: unknown }
  const before = globals.window
  globals.window = { addEventListener: () => {} }
  let value: unknown
  try {
    const installAppBridge = await loadStub()
    installAppBridge({ scenario: 'reglages', now: Date.now(), entra: true })
    const bridge = (globals.window as { app: { invoke: (c: string, p: unknown) => unknown } }).app
    value = await bridge.invoke('settings:snapshot', {})
  } finally {
    globals.window = before
  }

  const parsed = SettingsSnapshotSchema.safeParse(value)
  assert.ok(
    parsed.success,
    `le SETTINGS du harnais ne passe pas son propre schéma : ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))
    }`,
  )

  // And no jurisdiction claim, on any row, in any label (DEC-37).
  assert.doesNotMatch(
    source,
    /\((UE|EU)\)/,
    'une revendication de juridiction est revenue dans le fixture — voir DEC-37',
  )
})

/**
 * **The stub's health sentences are the ones `main.ts` emits — the fourth time
 * this fixture has been caught saying something the product does not.**
 *
 * `main.ts` gained a second clause on the no-Entra `calendar` row: a rep on that
 * build loses the calendar *and* every arming offer, because `Agenda` and
 * `MeetingApps` are both constructed inside the branch that needs a Graph
 * registration — and DEC-26 says a degradation is stated, never silent. The
 * fixture kept the old one-clause sentence, so every `--sans-entra` stage
 * photographed a string the product no longer emits.
 *
 * It flattered the app in the direction the previous three did: shorter and
 * calmer than the truth, and — because it is half the length — unable to show a
 * reviewer whether the real sentence still fits the card it is drawn in at 960
 * pixels, which is the width `main.ts` declares as the minimum.
 *
 * Source as evidence, the `preloadUnwrap.test.ts` shape. A string comparison
 * rather than an import, because `bridge-stub.mjs` is deliberately one
 * self-contained function with no imports — Playwright serialises it to source
 * and evaluates it in the page — so the two cannot share a constant and a test
 * is the only thing that can hold them equal.
 *
 * It guards itself against finding nobody: both sides must be non-empty, or a
 * rename turns this into a test that passes by comparing two absences.
 */
test('the harness stub states the no-Entra degradation the product states', () => {
  const stub = readFileSync(STUB, 'utf8')
  const main = readFileSync(path.resolve(HERE, '../../../app/main.ts'), 'utf8')

  /*
   * Both files write the sentence as two adjacent literals — it is too long for
   * one line under the formatter — so the comparison is over the *joined*
   * text rather than over source lines.
   */
  const joined = (source: string): string[] => {
    const out: string[] = []
    const re = /'(aucune application Microsoft configurée[^']*)'(\s*\+\s*'([^']*)')?/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) out.push(match[1]! + (match[3] ?? ''))
    return out.sort()
  }

  const fromMain = joined(main)
  const fromStub = joined(stub)

  assert.ok(fromMain.length >= 2, `main.ts should state two no-Entra rows, found ${fromMain.length}`)
  assert.ok(fromStub.length >= 2, `the stub should state two no-Entra rows, found ${fromStub.length}`)
  assert.deepEqual(
    fromStub,
    fromMain,
    'the harness fixture states a different degradation from the one the product emits',
  )
})
