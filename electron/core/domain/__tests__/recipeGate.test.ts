/**
 * The review gate under two recipes (DEC-43).
 *
 * The free recipe's promise is « aucun champ à remplir », and the gate is where
 * that promise is either kept or quietly broken — a form that still draws nine
 * empty boxes has taught the rep that the app asks for things it does not have,
 * and an empty box on the one irreversible screen in the product is an
 * invitation to type an answer nobody said out loud (DEC-21).
 *
 * The second half is the opportunity. Every descriptive column of an
 * `OpportunityPayload` is fed by a typed field the free recipe does not extract,
 * so drafting one would create a row in the client's pipeline worth 0 € with
 * four empty columns — because a checkbox was checked by default. It is refused
 * *with its reason on the row*, which is the DEC-26 shape, not silently dropped.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleExtraction, sampleLibreExtraction } from '../../contracts/fixtures.ts'
import type { ExtractionESN } from '../../contracts/extraction.ts'
import { draftIntents, prefillEdits, reviewFieldKeys, reviewFields } from '../reviewGate.ts'

const MEETING = 'm-recipe'
const DOCUMENT = '# Compte-rendu\n\nDu texte.\n'
const REPORT = { fields: {}, overall: 'ok' as const }

const gate = (extraction: ExtractionESN) => {
  const edits = prefillEdits(extraction, DOCUMENT)
  const all = ['crm.task', 'crm.opportunity', 'mail.draft'].map((k) => `${MEETING}:${k}`)
  return draftIntents({
    meetingId: MEETING,
    facts: extraction.facts,
    edits,
    mailTo: ['client@acme.fr'],
    recipe: extraction.interpretation.recipe,
    checked: all,
  })
}

const rowFor = (extraction: ExtractionESN, kind: string) =>
  gate(extraction).find((d) => d.view.kind === kind)

test('the ESN recipe draws every interpretive row, as it always has', () => {
  const keys = reviewFieldKeys('besoin-commercial')
  assert.deepEqual(keys, [
    'taskName',
    'account',
    'besoin',
    'profils',
    'modeCollaboration',
    'tjm',
    'dateDemarrage',
    'dureeMission',
    'contexteTechnique',
    'objections',
    'prochainesEtapes',
  ])
})

test('the free recipe draws the two deterministic rows and nothing else', () => {
  // Not « the interpretive rows, empty ». There is no row to leave empty,
  // because the recipe never asked for the value.
  assert.deepEqual(reviewFieldKeys('libre'), ['taskName', 'account'])
})

test('the rows follow the recipe that produced the document, not a global list', () => {
  const fields = reviewFields(sampleLibreExtraction, REPORT)
  assert.deepEqual(
    fields.map((f) => f.key),
    ['taskName', 'account'],
  )
  // And the ESN extraction is untouched by the existence of the other recipe.
  assert.equal(reviewFields(sampleExtraction, REPORT).length, 11)
})

test('a free-form compte-rendu still ships the CRM task and the Outlook draft', () => {
  const task = rowFor(sampleLibreExtraction, 'crm.task')
  const mail = rowFor(sampleLibreExtraction, 'mail.draft')

  assert.equal(task?.view.available, true)
  assert.notEqual(task?.intent, null)
  // The document is what lands in the task description, whatever shape it took.
  assert.equal(task?.intent?.kind === 'crm.task' ? task.intent.payload.body : null, DOCUMENT)

  assert.equal(mail?.view.available, true)
  assert.notEqual(mail?.intent, null)
})

test('a free-form compte-rendu drafts no opportunity, and the row says why', () => {
  const oppy = rowFor(sampleLibreExtraction, 'crm.opportunity')

  assert.equal(oppy?.view.available, false)
  // Nothing is created even though the id was checked — `available: false` is
  // not the same as unchecked, and only the first of the two can be overridden
  // by a renderer sending an id back.
  assert.equal(oppy?.intent, null)
  assert.match(oppy?.view.reason ?? '', /libre/)
  assert.match(oppy?.view.reason ?? '', /champ typé/)
})

test('the recipe outranks the other two reasons — a resolved account does not unlock it', () => {
  // The fixture resolves an account and has a task name, so both of the older
  // blockers are clear. The row must still refuse, and must not send the rep
  // looking for an account they already have.
  const oppy = rowFor(sampleLibreExtraction, 'crm.opportunity')
  assert.equal(sampleLibreExtraction.facts.account.accountId !== null, true)
  assert.doesNotMatch(oppy?.view.reason ?? '', /Compte non résolu/)
})

test('the ESN recipe still drafts its opportunity', () => {
  const oppy = rowFor(sampleExtraction, 'crm.opportunity')
  assert.equal(oppy?.view.available, true)
  assert.notEqual(oppy?.intent, null)
})

test('the free recipe prefills no interpretive value, rather than a plausible blank', () => {
  const edits = prefillEdits(sampleLibreExtraction, DOCUMENT)

  // The keys survive — `ReviewEdits` is the shape `review:confirm` takes back
  // and a partial one would put `undefined` where a VSA column wants a string —
  // but every one of them is empty, and none of them is ever rendered.
  for (const key of [
    'besoin',
    'profils',
    'modeCollaboration',
    'tjm',
    'dateDemarrage',
    'dureeMission',
    'contexteTechnique',
    'objections',
    'prochainesEtapes',
  ] as const) {
    assert.equal(edits[key], '', `${key} should carry nothing`)
  }
  assert.equal(edits.montant, null)
  // The two that are not the model's are still there. They come from Graph and
  // the CRM, and a free-form meeting has a client and an objet like any other.
  assert.equal(edits.taskName, sampleLibreExtraction.facts.taskName)
  assert.equal(edits.accountName, sampleLibreExtraction.facts.account.name)
})

test('the relance for a free meeting is a courtesy shell, never an invented synthesis', () => {
  const edits = prefillEdits(sampleLibreExtraction, DOCUMENT)

  assert.match(edits.mailBody, /Merci pour cet échange\./)
  // No « — Besoin : », no « — Profils : », no « Prochaines étapes ». Those lines
  // are the typed slate, and this recipe extracted none of it; writing one would
  // be the model's invention with the rep's signature under it.
  assert.doesNotMatch(edits.mailBody, /— Besoin/)
  assert.doesNotMatch(edits.mailBody, /— Profils/)
  assert.doesNotMatch(edits.mailBody, /Prochaines étapes/)
  // It is still a mail: a greeting, a sign-off, and a subject naming the objet.
  assert.match(edits.mailBody, /Bien à vous,/)
  assert.match(edits.mailSubject, /Suite à notre échange/)
})

test('the ESN relance still carries its synthesis', () => {
  const edits = prefillEdits(sampleExtraction, DOCUMENT)
  assert.match(edits.mailBody, /— Besoin :/)
  assert.match(edits.mailBody, /Prochaines étapes/)
})
