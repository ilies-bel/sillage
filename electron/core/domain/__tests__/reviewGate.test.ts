/**
 * The review gate's half of "no default placeholders".
 *
 * Two values used to be invented upstream so that the gate's fields were never
 * blank: « Client à confirmer » for an unresolved account and « Rendez-vous
 * client » for a meeting with no subject. Both looked like answers, both were
 * pre-filled into editable boxes a rep skims past, and the first was *stored* —
 * `Projections` wrote it into `meetings.client_name` the moment the extraction
 * landed, from where it reached the session header, the search chips and the
 * lexicon's per-client scope.
 *
 * They are gone. What replaces them is not a blank form that fails at the end:
 * the requirement is stated on the row it blocks (DEC-26), which is the shape
 * every other unavailable intent on this screen already has. These tests hold
 * the line in both directions — nothing is invented, and nothing ships without
 * the one word VerySwing needs.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleExtraction } from '../../contracts/fixtures.ts'
import type { AccountRef, ExtractionESN } from '../../contracts/extraction.ts'
import { draftIntents, prefillEdits } from '../reviewGate.ts'

const MEETING = 'm-test'

/**
 * What `modules/extract` hands over for an account the CRM did not match.
 *
 * Spelled out rather than imported: `core/` may import nothing but `core/`
 * (ARCHITECTURE.md §4), and that holds for its tests — a test that reaches into
 * a module is the first step of the domain depending on one. The shape is the
 * contract's, and `UNRESOLVED` is asserted to equal it in
 * `modules/extract/__tests__/compteRendu.test.ts`, which is where it lives.
 */
const UNRESOLVED: AccountRef = { accountId: null, name: '', confidence: 'faible' }

/** Stands in for the rendered document, which `modules/extract` produces. */
const DOCUMENT = '# Compte-rendu\n\nDu texte.\n'

/** The gate as it stands for an extraction, with every intent checked. */
const gate = (extraction: ExtractionESN, mailTo: readonly string[] = ['client@acme.fr']) => {
  const edits = prefillEdits(extraction, DOCUMENT)
  const all = ['crm.task', 'crm.opportunity', 'mail.draft'].map((k) => `${MEETING}:${k}`)
  const intents = draftIntents({
    meetingId: MEETING,
    facts: extraction.facts,
    edits,
    mailTo,
    checked: all,
  })
  return {
    edits,
    view: (kind: string) => intents.find((d) => d.view.kind === kind)!.view,
    intent: (kind: string) => intents.find((d) => d.view.kind === kind)!.intent,
  }
}

/** An extraction whose account the CRM could not match. */
const unresolved = (): ExtractionESN => ({
  ...sampleExtraction,
  facts: { ...sampleExtraction.facts, account: UNRESOLVED },
})

/** A meeting started on one click and never named. */
const unnamed = (): ExtractionESN => ({
  ...sampleExtraction,
  facts: { ...sampleExtraction.facts, taskName: '' },
})

test('an unresolved account pre-fills nothing at all', () => {
  const { edits } = gate(unresolved())

  assert.equal(edits.accountName, '')
  assert.equal(edits.accountId, null)
  // The whole form, not just the one field: a phrase that reaches the CRM task's
  // description is a phrase nobody can tell from something the client said.
  assert.ok(!JSON.stringify(edits).includes('Client à confirmer'))
})

test('an unresolved account still blocks the opportunity, and says which is missing', () => {
  const { view } = gate(unresolved())

  assert.equal(view('crm.opportunity').available, false)
  assert.match(view('crm.opportunity').reason ?? '', /Compte non résolu/)
  // The task is unaffected — it does not need a resolved account, only a name,
  // and this meeting has one.
  assert.equal(view('crm.task').available, true)
})

test('a meeting with no objet refuses the task rather than naming it for the rep', () => {
  const { view, intent } = gate(unnamed())

  assert.equal(view('crm.task').available, false)
  assert.match(view('crm.task').reason ?? '', /Donnez un objet/)
  // Refused, not silently drafted with a blank title: a checked row whose intent
  // is still built is how an empty task name reaches VerySwing.
  assert.equal(intent('crm.task'), null)
  assert.equal(intent('crm.opportunity'), null)
})

test('typing the objet is all it takes — nothing else was blocking', () => {
  const named = gate({
    ...sampleExtraction,
    facts: { ...sampleExtraction.facts, taskName: 'Point Acme' },
  })

  assert.equal(named.view('crm.task').available, true)

  // Narrowed on `kind` rather than cast: `payload` is a union across the three
  // intent kinds, and a cast here would keep compiling if the task's payload
  // ever stopped carrying a title.
  const drafted = named.intent('crm.task')
  assert.equal(drafted?.kind, 'crm.task')
  if (drafted?.kind !== 'crm.task') throw new Error('unreachable')
  assert.equal(drafted.payload.title, 'Point Acme')
})

test('the relance subject does not trail a dash when there is no objet', () => {
  assert.equal(gate(unnamed()).edits.mailSubject, 'Suite à notre échange')
  assert.match(gate(sampleExtraction).edits.mailSubject, /^Suite à notre échange — .+/)
})

test('the task summary never renders a dangling separator', () => {
  // Both missing is the state a meeting is in for its whole first minute.
  const bare = gate({
    ...sampleExtraction,
    facts: { ...sampleExtraction.facts, taskName: '', account: UNRESOLVED },
  })

  assert.equal(bare.view('crm.task').summary, 'Sans objet')
  assert.equal(gate(unresolved()).view('crm.task').summary, sampleExtraction.facts.taskName)
})
