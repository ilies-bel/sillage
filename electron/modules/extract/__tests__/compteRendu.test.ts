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
import { sampleExtraction } from '../../../core/contracts/fixtures.ts'
import type { MeetingContext } from '../../../core/contracts/meeting.ts'
import { FAIBLE_MARKER, renderCompteRendu } from '../compteRendu.ts'
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

test('the document is French, top to bottom', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)

  for (const expected of [
    '**Client** :',
    '**Date** :',
    '**Interlocuteurs** :',
    '**Commercial** :',
    '## Éléments retenus',
    '- **Besoin** :',
    '- **Mode de collaboration** :',
    '- **TJM évoqué** :',
    '- **Démarrage** :',
    '- **Durée de mission** :',
    '- **Contexte technique** :',
    '## Profils recherchés',
    '## Objections et points de vigilance',
    '## Prochaines étapes',
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

  assert.match(document, /\*\*Date\*\* : jeudi 12 mars 2026, 09:00 – 10:30/)
})

test('the header is the deterministic half, rendered by code', () => {
  const document = renderCompteRendu(sampleExtraction, allOk)
  const { facts } = sampleExtraction

  assert.ok(document.startsWith(`# ${facts.taskName}\n`))
  assert.ok(document.includes(`**Client** : ${facts.account.name}`))
  assert.ok(document.includes(`**Commercial** : ${facts.repEmail}`))
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
  assert.equal(document.split(FAIBLE_MARKER).length - 1, 2)
})

// The marker is the half of DEC-18 that was doing the work. The other half —
// « Client à confirmer » pre-filled into the name — is gone: it read as an
// answer, and `Projections` stored it as the meeting's client on
// `extraction.completed`, from where it reached the header, the search chips and
// the lexicon's per-client scope. Absence is stated in italics and never filled.
test('an unresolved account is marked on the client row and names nobody (DEC-18)', () => {
  const facts = { ...sampleExtraction.facts, account: UNRESOLVED_ACCOUNT }
  const document = renderCompteRendu({ ...sampleExtraction, facts })

  assert.ok(document.includes(`**Client** : _non résolu_ ${FAIBLE_MARKER}`))
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
