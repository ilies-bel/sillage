/**
 * **Every compte-rendu the screenshot fixture serves is a document
 * `renderCompteRendu` could have written — including its last two lines.**
 *
 * `scripts/harness/bridge-stub.mjs` is what every design review looks at, and its
 * compte-rendu has now been caught lying **seven** times. Six of those are
 * recorded in `electron/modules/extract/__tests__/harnessFixture.test.ts`, which
 * exists to refuse exactly this. The seventh is the postamble, and neither that
 * file nor any of the nine measured checks asked about it:
 *
 *  · the fixture carries `⚠ faible` and **no legend line**, and
 *  · it does **not end with a newline**.
 *
 * `renderCompteRendu` appends both **unconditionally** — the newline always, the
 * legend whenever the marker is present anywhere in the document
 * (`compteRendu.ts`, the `const legend =` / `return` pair at the foot of the
 * function). So the string every screenshot of the gate, of the session pane and
 * of *Historique* has ever been judged against was one the composer cannot
 * produce, in two ways at once, and one of them is the sentence that explains
 * the product's one invented token (DEC-21) to the delivery manager who reads
 * the VerySwing task and has never seen the review gate.
 *
 * ## Why this is a test and not a paragraph
 *
 * The lesson « keep the fixture faithful » has been written as a comment in that
 * stub three times and ignored three times. What catches it is a check.
 *
 * ## Two things about how it is written, both of them the point
 *
 * **The rules are executed, never restated.** `renderCompteRendu` is run twice on
 * `sampleExtraction` — once with a `faible` field and once without — and the
 * legend's own sentence is read off the *output*. Writing that sentence here
 * would be a second copy of a French string two files then have to keep equal,
 * which is the failure this repo has recorded under « a comment is not a check »
 * and under « two spellings of one constant ». Reword the legend in
 * `compteRendu.ts` and this test asks for the new wording on the next run.
 *
 * **The documents are read off the running fixture, never off its source.** A
 * regex over `bridge-stub.mjs` would go quiet the day the stub composes a
 * compte-rendu instead of writing one down — which is exactly how
 * `harnessFixture.test.ts` lost an assertion it thought it was making. So the
 * stub is installed and asked, through `meeting:list` → `history:record`,
 * `review:get` and `meeting:get`, on every scenario it branches on: a document
 * the fixture gains is a document this test gains with it.
 *
 * And it guards itself against measuring nothing, which is the shape this repo
 * has shipped five times: the enumeration has to find documents, and at least one
 * of them has to actually carry the marker — otherwise the legend half is
 * trivially satisfied by a fixture that stopped exercising it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { pinnedNow } from '../harness/pinnedNow.mjs'
import { installAppBridge } from '../harness/bridge-stub.mjs'
import { FAIBLE_MARKER, renderCompteRendu } from '../../electron/modules/extract/compteRendu.ts'
import { sampleExtraction } from '../../electron/core/contracts/fixtures.ts'

/**
 * The stub installed over a minimal `window`, the way `harnessFixture.test.ts`
 * does it: `installAppBridge` is an init script for a browser page, so the one
 * global it touches is stood up and put back.
 */
const withStub = async (scenario, entra, read) => {
  const globals = globalThis
  const before = globals.window
  globals.window = { addEventListener: () => {} }
  try {
    installAppBridge({ scenario, now: pinnedNow(), entra })
    const bridge = globals.window.app
    return await read((channel, payload) => bridge.invoke(channel, payload ?? {}))
  } finally {
    globals.window = before
  }
}

/**
 * Every compte-rendu one scenario serves, labelled by where a rep would read it.
 *
 * Derived from the stub's own meeting list rather than from a hand-written set of
 * ids: *Historique* draws one of these per past call, and a fixture that gains a
 * meeting would otherwise gain an unchecked document.
 */
const documentsIn = async (scenario, entra) =>
  withStub(scenario, entra, async (invoke) => {
    const meetings = await invoke('meeting:list')
    /*
     * Asked in parallel, which is not tidiness. The stub answers these three
     * channels after 150 ms on purpose — a fixture faster than the product paints
     * no loading state, which is its own recorded defect — and serialising ten
     * meetings across every scenario put this one test at **116 s**, longer than
     * the entire electron suite. The latency is a `setTimeout`, so asking at once
     * costs one of them.
     */
    const asked = await Promise.all(
      meetings.flatMap((meeting) => [
        invoke('history:record', { meetingId: meeting.id }).then((r) => [
          `history:record ${meeting.id}`,
          r?.compteRendu,
        ]),
        invoke('meeting:get', { meetingId: meeting.id }).then((r) => [
          `meeting:get ${meeting.id}`,
          r?.compteRendu,
        ]),
        invoke('review:get', { meetingId: meeting.id }).then((r) => [
          `review:get ${meeting.id}`,
          r?.panel?.edits?.compteRendu,
        ]),
      ]),
    )
    return asked
      .filter(([, text]) => typeof text === 'string' && text.trim().length > 0)
      .map(([where, text]) => ({ where, text }))
  })

/**
 * **The composer's postamble, measured by running it.**
 *
 * Two documents off the shipped function: one whose citation could not be
 * verified and one whose could. The difference between their feet *is* the rule.
 */
const POSTAMBLE = (() => {
  const marked = renderCompteRendu(sampleExtraction, { fields: { besoin: 'faible' }, overall: 'degraded' })
  const clean = renderCompteRendu(sampleExtraction, { fields: { besoin: 'ok' }, overall: 'ok' })
  return { marked, clean, legend: marked.trimEnd().split('\n').at(-1) ?? '' }
})()

test('the composer really does append a legend and a final newline', () => {
  /*
   * The guard on the guard. Everything below asks the fixture for a property
   * derived from these two strings, so a change that stopped `renderCompteRendu`
   * appending either would turn every assertion below into a tautology rather
   * than into a failure — which is the « check that measures nothing while
   * reporting green » this repo has shipped five times.
   */
  assert.ok(
    POSTAMBLE.marked.includes(FAIBLE_MARKER),
    'le document de référence ne porte plus le marqueur — la moitié « légende » de ce ' +
      'test ne mesurerait plus rien',
  )
  assert.ok(
    POSTAMBLE.legend.startsWith(FAIBLE_MARKER),
    `la dernière ligne du document composé n’est plus la légende (« ${POSTAMBLE.legend} ») : ` +
      'la dérivation est cassée, pas le fixture',
  )
  assert.ok(
    POSTAMBLE.marked.endsWith('\n') && POSTAMBLE.clean.endsWith('\n'),
    'renderCompteRendu ne termine plus par un retour à la ligne — ce test demanderait ' +
      'au fixture quelque chose que le produit ne fait pas',
  )
  assert.ok(
    !POSTAMBLE.clean.includes(POSTAMBLE.legend),
    'un document sans marqueur porte quand même la légende : le biconditionnel ci-dessous ' +
      'ne distinguerait plus rien',
  )
})

test('every compte-rendu the harness fixture serves ends the way the composer ends one', async () => {
  /*
   * The scenarios come out of the stub's own branches, the way
   * `harnessFixture.test.ts` reads them — `__inconnu__` stands for every stage
   * whose name the stub has no branch for and which therefore lands on the
   * default day.
   */
  const source = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../harness/bridge-stub.mjs', import.meta.url), 'utf8'),
  )
  const scenarios = [
    ...new Set([...source.matchAll(/scenario === '([a-z0-9-]+)'/g)].map((m) => m[1])),
    '__inconnu__',
  ]
  assert.ok(
    scenarios.length >= 8,
    `l’énumération des scénarios n’en a trouvé que ${scenarios.length} — le stub a changé de ` +
      'forme et ce test ne couvre plus les écrans',
  )

  /*
   * Keyed by the document itself, and it has to be. The stub serves the same
   * `## Contexte` record for every meeting it has no entry for, on every scenario
   * and on both halves of the Entra axis, so the flat list is a hundred and
   * eighty rows of three strings — and `deepEqual` truncates its own output, which
   * is how a real finding hides behind the repetition of another. One row per
   * distinct document, carrying the first place a rep meets it and how many
   * surfaces serve it.
   */
  const byText = new Map()
  for (const scenario of scenarios) {
    for (const entra of [true, false]) {
      for (const found of await documentsIn(scenario, entra)) {
        const where = `${scenario}${entra ? '' : ' --sans-entra'} · ${found.where}`
        const seen = byText.get(found.text)
        if (seen) seen.served += 1
        else byText.set(found.text, { where, text: found.text, served: 1 })
      }
    }
  }
  const documents = [...byText.values()]

  assert.ok(
    documents.length >= 3,
    `le fixture ne sert que ${documents.length} compte-rendu(s) distinct(s) — l’énumération ` +
      'est cassée',
  )
  /*
   * **The marker is looked for in the *body*, and that is not pedantry — the
   * first version of this check could not fail.**
   *
   * `renderCompteRendu` asks `document.includes(FAIBLE_MARKER)` *before* it
   * concatenates the legend, and the legend's own first two words **are the
   * marker**. So « no marker anywhere, yet a legend » is unreachable by
   * construction: staging exactly that attack — the legend pasted onto the clean
   * `## Contexte` record — left this test **green**, measured. Shape #3 on the
   * list, inside the check written to close shape #5.
   *
   * Cut at the legend and ask the part above it, which is the string the composer
   * asks. Both directions of the biconditional then bite, and both are driven.
   */
  const bodyOf = (text) => {
    const at = text.indexOf(POSTAMBLE.legend)
    return at === -1 ? text : text.slice(0, at)
  }
  const marked = (d) => bodyOf(d.text).includes(FAIBLE_MARKER)
  const explained = (d) => d.text.includes(POSTAMBLE.legend)

  assert.ok(
    documents.some(marked),
    'aucun compte-rendu du fixture ne porte « ' +
      FAIBLE_MARKER +
      ' » hors de sa propre légende : la moitié « légende » de ce test ne mesure plus rien, ' +
      'et l’écran phare ne montre plus le seul jeton que ce produit a inventé (DEC-21)',
  )
  assert.ok(
    documents.some((d) => !marked(d)),
    'tous les compte-rendus du fixture portent le marqueur : la moitié « légende en trop » ' +
      'de ce test ne mesure plus rien, et aucune capture ne montre plus un document propre',
  )

  const unterminated = documents
    .filter((d) => !d.text.endsWith('\n'))
    .map((d) => `${d.where} ×${d.served} (finit par ${JSON.stringify(d.text.slice(-24))})`)
  assert.deepEqual(
    unterminated,
    [],
    'renderCompteRendu termine tout document par un retour à la ligne : un fixture qui ne ' +
      'le fait pas photographie un document que le composeur ne peut pas produire.',
  )

  const missingLegend = documents
    .filter((d) => marked(d) && !explained(d))
    .map((d) => `${d.where} ×${d.served}`)
  assert.deepEqual(
    missingLegend,
    [],
    'un compte-rendu du fixture porte « ' +
      FAIBLE_MARKER +
      ' » sans la ligne qui l’explique. renderCompteRendu l’ajoute dès que le marqueur est ' +
      'présent — et cette ligne est la seule chose qui rende le jeton lisible pour le ' +
      'delivery manager qui lit la tâche VerySwing sans avoir jamais vu la porte de revue.',
  )

  const strayLegend = documents
    .filter((d) => !marked(d) && explained(d))
    .map((d) => `${d.where} ×${d.served}`)
  assert.deepEqual(
    strayLegend,
    [],
    'un compte-rendu du fixture explique un marqueur qu’il ne porte pas : renderCompteRendu ' +
      'n’écrit la légende que quand le marqueur est là, « so a clean compte-rendu carries no ' +
      'apparatus at all ».',
  )
})
