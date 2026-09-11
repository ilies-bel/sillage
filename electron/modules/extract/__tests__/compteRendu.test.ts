/**
 * The document, and the two things about it that are not taste.
 *
 * It is French unconditionally (HR-6, DEC-22) — including the parts no model
 * wrote, which is precisely why they are rendered here and not asked for in a
 * prompt. And it says `⚠ faible` on exactly the rows whose citation could not
 * be found (DEC-21), because the compte-rendu is what a rep skims when they do
 * not open the form.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ExtractionESN, VerificationReport } from '../../../core/contracts/extraction.ts'
import {
  sampleExtraction,
  sampleLibreExtraction,
  sampleVerification,
} from '../../../core/contracts/fixtures.ts'
import type { MeetingContext } from '../../../core/contracts/meeting.ts'
import { COMPTE_RENDU_SECTIONS } from '../../../core/contracts/recipes.ts'
import {
  FAIBLE_MARKER,
  compteRenduSources,
  renderCompteRendu,
  unwrapProse,
} from '../compteRendu.ts'
import { UNRESOLVED_ACCOUNT, buildFacts, interlocuteursOf } from '../facts.ts'

const allOk: VerificationReport = {
  fields: {
    besoin: 'ok',
    modeCollaboration: 'ok',
    tjmEvoque: 'ok',
    dateDemarrage: 'ok',
    dureeMission: 'ok',
    contexteTechnique: 'ok',
    'profilsRecherches.0': 'ok',
    'objections.0': 'ok',
    'prochainesEtapes.0': 'ok',
  },
  overall: 'ok',
}

const bare = (over: Partial<ExtractionESN['interpretation']> = {}): ExtractionESN => ({
  facts: { ...sampleExtraction.facts },
  interpretation: {
    ...sampleExtraction.interpretation,
    profilsRecherches: [],
    objections: [],
    prochainesEtapes: [],
    tjmEvoque: null,
    dateDemarrage: null,
    dureeMission: null,
    ...over,
  },
})

/*
 * The composer appends its own headings after the model's narrative, and the
 * model's headings are declared in the same repo — so the two lists can collide
 * silently. They did: « ## Objections et points de vigilance » and
 * « ## Prochaines étapes » were each written twice into every ESN compte-rendu,
 * once over prose and once over a list, and the CRM received both.
 *
 * The assertion is on the *level*, not on the spelling, because sharing a name
 * between a chapter and a field of the recap is fine and is what the recap is
 * for. What is not fine is two headings of the same rank claiming to open the
 * same section.
 */
test('no appended heading collides with one the model was told to write', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)

  const topLevel = document
    .split('\n')
    .filter((line) => /^## /.test(line))
    .map((line) => line.trim())

  assert.equal(
    new Set(topLevel).size,
    topLevel.length,
    `a « ## » heading is written twice: ${topLevel.join(' / ')}`,
  )

  // And the recap's sub-sections are exactly that — below the recap, not beside
  // the chapters the recipe declares.
  for (const section of COMPTE_RENDU_SECTIONS) {
    assert.ok(
      !document.includes(`\n${section} `) || topLevel.filter((h) => h === section).length <= 1,
      `« ${section} » appears more than once`,
    )
  }
})

test('the document is French, top to bottom', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)

  for (const expected of [
    // No `**`: these four lines are composed in code from Graph and the CRM,
    // and `**` cannot hang in the gutter the way `#` and `- ` do — so eight
    // literal asterisks opened every document and landed in the VerySwing task
    // body. The emphasis stays where the *model* wrote it, in « Éléments
    // retenus ».
    'Client :',
    'Date :',
    'Interlocuteurs :',
    'Commercial :',
    '## Éléments retenus',
    '- **Besoin** :',
    '- **Mode de collaboration** :',
    '- **TJM évoqué** :',
    '- **Démarrage** :',
    '- **Durée de mission** :',
    '- **Contexte technique** :',
    // Sub-sections of the recap, not chapters of their own — and at `##` the
    // last two collided with the model's narrative headings of the same name.
    '### Profils recherchés',
    '### Objections et points de vigilance',
    '### Prochaines étapes',
  ]) {
    assert.ok(document.includes(expected), `missing « ${expected} »`)
  }

  // The English a half-ported renderer leaks. None of it belongs here.
  for (const english of [
    'Client:',
    'Summary',
    'Next steps',
    'Objections and',
    'Rate',
    'Attendees',
    'Duration',
  ]) {
    assert.ok(!document.includes(english), `English leaked: « ${english} »`)
  }
})

test('the date is written in French, in Europe/Paris', () => {
  const facts = { ...sampleExtraction.facts }
  // 12 March 2026, 08:00 UTC — 09:00 in Paris.
  facts.startsAt = Date.UTC(2026, 2, 12, 8, 0)
  facts.endsAt = Date.UTC(2026, 2, 12, 9, 30)
  const document = renderCompteRendu({ ...sampleExtraction, facts })

  assert.match(document, /^Date : jeudi 12 mars 2026, 09:00 – 10:30$/m)
})

test('the header is the deterministic half, rendered by code', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)
  const { facts } = sampleExtraction

  assert.ok(document.startsWith(`# ${facts.taskName}\n`))
  assert.ok(document.includes(`Client : ${facts.account.name}`))
  assert.ok(document.includes(`Commercial : ${facts.repEmail}`))
  for (const attendee of facts.interlocuteurs) {
    assert.ok(document.includes(`${attendee.name} (${attendee.email})`))
  }
})

test('a field whose citation did not verify wears ⚠ faible, and only that field', () => {
  const report: VerificationReport = {
    fields: { ...allOk.fields, tjmEvoque: 'faible', 'prochainesEtapes.0': 'faible' },
    overall: 'faible',
  }
  const document = renderCompteRendu(sampleExtraction, report)

  assert.match(document, new RegExp(`- \\*\\*TJM évoqué\\*\\* : .*${FAIBLE_MARKER}`))
  assert.doesNotMatch(document, new RegExp(`- \\*\\*Besoin\\*\\* : .*${FAIBLE_MARKER}`))
  // Two marked fields, plus the one line at the foot that says what the marker
  // means. The marker is not only read at the gate: this string is the body of
  // the VerySwing task, where a delivery manager who has never seen the review
  // screen gets a dingbat and a lowercase adjective at the end of a line.
  assert.equal(document.split(FAIBLE_MARKER).length - 1, 3)
  assert.match(document, /n’a pas été retrouvée dans la transcription/)
})

test('a compte-rendu with nothing to flag carries no apparatus at all', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)

  assert.ok(!document.includes(FAIBLE_MARKER))
  assert.doesNotMatch(document, /retrouvée dans la transcription/)
})

// The marker is the half of DEC-18 that was doing the work. The other half —
// « Client à confirmer » pre-filled into the name — is gone: it read as an
// answer, and `Projections` stored it as the meeting's client on
// `extraction.completed`, from where it reached the header, the search chips and
// the lexicon's per-client scope. Absence is stated in italics and never filled.
test('an unresolved account is marked on the client row and names nobody (DEC-18)', () => {
  const facts = { ...sampleExtraction.facts, account: UNRESOLVED_ACCOUNT }
  const document = renderCompteRendu({ ...sampleExtraction, facts })

  assert.ok(document.includes(`Client : _non résolu_ ${FAIBLE_MARKER}`))
  assert.ok(!document.includes('Client à confirmer'))
})

test('a meeting with no subject gets no invented heading', () => {
  const facts = { ...sampleExtraction.facts, taskName: '' }
  const document = renderCompteRendu({ ...sampleExtraction, facts })

  assert.ok(document.startsWith('# _Réunion sans objet_'))
  assert.ok(!document.includes('Rendez-vous client'))
})

test('rendering without a report is honest rather than wrong — no markers', () => {
  assert.ok(!renderCompteRendu(sampleExtraction).includes(FAIBLE_MARKER))
})

test('nothing said about a field is said so, in French', () => {
  const document = renderCompteRendu(bare())

  assert.ok(document.includes('- **TJM évoqué** : _non évoqué_'))
  assert.ok(document.includes('- **Démarrage** : _non évoqué_'))
  assert.ok(document.includes('_Aucun profil précisé._'))
  assert.ok(document.includes('_Aucune objection relevée._'))
  assert.ok(document.includes('_Aucune étape convenue._'))
})

test('a mode nobody stated reads « non précisé », not « inconnu »', () => {
  const document = renderCompteRendu(
    bare({
      modeCollaboration: {
        value: 'inconnu',
        span: { quote: 'on verra', channel: null, startMs: null, endMs: null },
      },
    }),
  )
  assert.ok(document.includes('- **Mode de collaboration** : non précisé'))
})

test('the document ends with exactly one newline and never a triple blank', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)
  assert.ok(document.endsWith('\n'))
  assert.ok(!document.endsWith('\n\n'))
  assert.doesNotMatch(document, /\n{3}/)
})

const context: MeetingContext = {
  eventId: null,
  subject: '   ',
  agenda: '',
  organizer: { name: 'Rep', email: 'rep@esn.fr', type: 'required', response: 'organizer' },
  attendees: [
    { name: 'Rep', email: 'REP@esn.fr', type: 'required', response: 'accepted' },
    { name: 'Client', email: 'client@acme.fr', type: 'required', response: 'accepted' },
    { name: 'Client', email: 'client@acme.fr', type: 'optional', response: 'none' },
    { name: 'Salle', email: 'salle@esn.fr', type: 'resource', response: 'none' },
  ],
  onlineMeetingJoinUrl: null,
  categories: [],
  sensitivity: 'normal',
  scheduledStart: 0,
  scheduledEnd: 3_600_000,
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
}

test('interlocuteurs drop the rep, the rooms and the duplicates', () => {
  assert.deepEqual(
    interlocuteursOf(context, 'rep@esn.fr').map((a) => a.email),
    ['client@acme.fr'],
  )
})

// The « Rendez-vous client » fallback went with « Client à confirmer », and for
// the same reason: a placeholder that gets stored is indistinguishable from
// data. A meeting with no subject has no task name, the field is blank, and the
// review gate is where a human types one (DEC-4).
test('a meeting with no subject gets no task name rather than a placeholder', () => {
  const facts = buildFacts({ context, repEmail: 'rep@esn.fr' })
  assert.equal(facts.taskName, '')
  assert.equal(facts.account, UNRESOLVED_ACCOUNT)
  assert.deepEqual(facts.knownContactIds, [])
})

/*
 * ── The model's soft wraps (DEC-44) ─────────────────────────────────────────
 *
 * The string composed here is the string stored, rendered and sent to
 * VerySwing. A model that hard-wraps its prose at seventy-odd columns — which
 * they do — puts a line break in the middle of a sentence, and no renderer
 * downstream can undo it without lying about what the CRM will receive. So it
 * is undone here, once, on the way in.
 */
test('a paragraph the model hard-wrapped is joined back into a paragraph', () => {
  assert.equal(
    unwrapProse(
      'Le budget a été voté ce matin.\nNéovia doit sortir ses pipelines Talend avant la\nfin de l’année.',
    ),
    'Le budget a été voté ce matin. Néovia doit sortir ses pipelines Talend avant la fin de l’année.',
  )
})

test('a blank line is a paragraph and stays one', () => {
  const prose = 'Premier paragraphe.\n\nSecond paragraphe.'
  assert.equal(unwrapProse(prose), prose)
})

test('structure keeps its own line breaks', () => {
  const prose = ['## Contexte', 'Une phrase.', '- Mode : régie', '- TJM : 550 €'].join('\n')
  // The heading does not absorb the sentence under it, and the two list items
  // do not become one.
  assert.equal(unwrapProse(prose), prose)
})

test('prose the prompt already asked for passes through untouched', () => {
  const prose = '## Résumé\n\nUne seule ligne par paragraphe, comme demandé.\n\n## Besoin\n\nIdem.'
  assert.equal(unwrapProse(prose), prose)
})

test('it never joins across a structural line, in either direction', () => {
  assert.equal(unwrapProse('Une phrase.\n## Titre\nSuite.'), 'Une phrase.\n## Titre\nSuite.')
})

/*
 * ── the document's own provenance (DEC-21) ──────────────────────────────────
 *
 * `compteRenduSources` is only worth anything if every entry it returns is a
 * line the document actually contains, character for character: the renderer
 * matches on string equality, and a formatter changed on one side and not the
 * other would silently drop the provenance from every bullet with nothing
 * failing. This is the check that the two halves are the same half.
 */
test('compteRenduSources — every source is a line the document wrote, with its span', () => {
  const text = renderCompteRendu(sampleExtraction, sampleVerification)
  const sources = compteRenduSources(sampleExtraction)
  assert.ok(sources.length > 0, 'une extraction typée doit produire des sources')

  /*
   * The rendered line minus the `- ` and minus a trailing `⚠ faible` — the exact
   * operation the renderer performs, for the same reason: the marker is appended
   * to the line and is not part of what was said, so a field the extraction
   * could not verify would otherwise lose the provenance it most needs.
   */
  const bare = text
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) =>
      line
        .slice(2)
        .replace(/[\s\u00a0]*⚠[\s\u00a0]*faible[\s\u00a0]*$/u, '')
        .trim(),
    )
  for (const source of sources) {
    // Equality, exactly as the renderer compares: the source is the whole line
    // as written, `**Label** : value` included.
    const found = bare.includes(source.text)
    assert.ok(found, `source absente du document : « ${source.text} »`)
    assert.ok(source.span.quote.length > 0, 'une source sans citation ne prouve rien')
  }
})

test('compteRenduSources — a newline inside a value loses neither the row nor its source', () => {
  /*
   * **The failure was silent in both directions.** `unwrapProse` is applied to
   * the narrative and to nothing else, so a model that wrapped « Besoin » across
   * two lines broke the row in half — the second half drawn as ordinary prose
   * with no gutter and no marker — and `compteRenduSources` matches the line as
   * written by string equality, so the `[source ▸]` on the most operative line in
   * the document went with it. A line that matches nothing is drawn plain, which
   * is what keeps the free recipe working and is exactly what made this
   * invisible: nothing on screen says the provenance was lost.
   */
  const wrapped = {
    ...sampleExtraction,
    interpretation: {
      ...sampleExtraction.interpretation,
      besoin:
        sampleExtraction.interpretation.besoin === null
          ? null
          : {
              ...sampleExtraction.interpretation.besoin,
              value: sampleExtraction.interpretation.besoin.value.replace(' ', '\n  '),
            },
    },
  }

  const text = renderCompteRendu(wrapped, sampleVerification)
  const sources = compteRenduSources(wrapped)
  const bare = text
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) =>
      line
        .slice(2)
        .replace(/[\s\u00a0]*⚠[\s\u00a0]*faible[\s\u00a0]*$/u, '')
        .trim(),
    )

  assert.equal(
    sources.length,
    compteRenduSources(sampleExtraction).length,
    'aucune source ne disparaît',
  )
  for (const source of sources) {
    assert.ok(bare.includes(source.text), `source absente du document : « ${source.text} »`)
  }
  // And the row is still one row: nothing spilled into the prose below it.
  assert.equal(
    text.split('\n').filter((l) => l.startsWith('- **Besoin** : ')).length,
    1,
  )
  assert.ok(!text.includes('\n  '), 'la valeur est repliée sur une ligne')
})

test('compteRenduSources — the free recipe produces none, because it types nothing', () => {
  // DEC-43: no typed field means no cited item means nothing to point at. An
  // empty list is the honest answer and the renderer draws plain bullets.
  assert.deepEqual(compteRenduSources(sampleLibreExtraction), [])
})
