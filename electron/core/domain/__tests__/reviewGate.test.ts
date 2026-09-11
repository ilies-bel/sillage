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
import type { ReviewEdits, ReviewFieldKey } from '../../contracts/review.ts'
import { draftIntents, prefillEdits, reviewFieldKeys } from '../reviewGate.ts'

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


/*
 * ── every correction reaches something ──────────────────────────────────────
 *
 * `draftIntents` composed five of the nine interpretive fields into the
 * opportunity and silently dropped `objections`, `prochainesEtapes` and
 * `dateDemarrage`. All three were live textareas at the gate; `objections` is
 * the field the whole screen is architected around — it carries the `⚠ faible`,
 * it turns the primary orange, it names itself on the button and again on the
 * line beneath it. A rep corrected it, pressed *Valider*, and the correction
 * went nowhere, with nothing on screen able to say so: the row was pixel-
 * identical to the five that were read.
 *
 * So it is proved rather than remembered. Every row the gate draws is given a
 * value nothing else could produce, and the drafted payloads have to contain
 * it. A tenth field that is rendered and not composed fails here.
 */

/** Which `ReviewEdits` key each drawn row edits. The two deterministic rows
 *  are covered by the tests above and are not free text the rep composes. */
const EDITS_KEY: Partial<Record<ReviewFieldKey, keyof ReviewEdits>> = {
  // The objet is the *task's*, not the opportunity's, which is what makes it
  // the control in the test below: it has to keep shipping when the opportunity
  // does not. `account` is left out — it reaches the row's summary rather than a
  // payload field, and the two tests above already hold it.
  taskName: 'taskName',
  besoin: 'besoin',
  profils: 'profils',
  modeCollaboration: 'modeCollaboration',
  tjm: 'tjm',
  dateDemarrage: 'dateDemarrage',
  dureeMission: 'dureeMission',
  contexteTechnique: 'contexteTechnique',
  objections: 'objections',
  prochainesEtapes: 'prochainesEtapes',
}

/** Every drawn row, given a value nothing else in the fixture could produce. */
const sentinelled = (over: Partial<ReviewEdits> = {}): { edits: ReviewEdits; marks: Map<string, string> } => {
  const edits: ReviewEdits = { ...prefillEdits(sampleExtraction, DOCUMENT) }
  const marks = new Map<string, string>()
  for (const row of reviewFieldKeys()) {
    const key = EDITS_KEY[row]
    if (!key) continue
    const sentinel = `SENTINELLE-${row.toUpperCase()}`
    marks.set(row, sentinel)
    Object.assign(edits, { [key]: sentinel })
  }
  return { edits: { ...edits, ...over }, marks }
}

const shippedFrom = (edits: ReviewEdits, checked: readonly string[]): string =>
  JSON.stringify(
    draftIntents({
      meetingId: MEETING,
      facts: sampleExtraction.facts,
      edits,
      mailTo: ['client@acme.fr'],
      checked,
    }).map((drafted) => drafted.intent),
  )

const ALL = ['crm.task', 'crm.opportunity', 'mail.draft'].map((k) => `${MEETING}:${k}`)

/*
 * **The nine typed rows go into the opportunity and into nothing else.**
 *
 * Which is fine while the opportunity ships and is a silent hole when it does
 * not — an account the CRM could not match, or the rep unchecking the row. The
 * first version of the test below asserted only the happy path and therefore
 * proved the wrong thing: nine live textareas whose edits reached nothing, on
 * the screen whose entire design is soliciting those edits.
 *
 * The fix is not in this file — the gate draws those rows read-only and says
 * why (`Review.tsx`, DEC-26). What this holds is the *fact* the screen depends
 * on, so it cannot change under the screen without a failure here.
 */
test('the typed fields ride on the opportunity, and on nothing else', () => {
  const { marks } = sentinelled()
  const typed = [...marks].filter(([row]) => row !== 'taskName' && row !== 'account')

  const withoutOpportunity = shippedFrom(
    sentinelled().edits,
    ALL.filter((id) => !id.endsWith('crm.opportunity')),
  )
  const stillThere = typed.filter(([, value]) => withoutOpportunity.includes(value))
  assert.deepEqual(
    stillThere.map(([row]) => row),
    [],
    'un champ typé atteint une charge utile sans opportunité — le gate les dessine en lecture seule sur cette base',
  )

  // And the two deterministic rows are the task's, so they ship regardless.
  assert.ok(withoutOpportunity.includes(marks.get('taskName') ?? '·'))
})

test('an unresolved account is the same case, and the gate has to know it', () => {
  const { edits } = sentinelled({ accountId: null, accountName: '' })
  const drafted = draftIntents({
    meetingId: MEETING,
    facts: { ...sampleExtraction.facts, account: UNRESOLVED },
    edits,
    mailTo: ['client@acme.fr'],
    checked: ALL,
  })
  const opportunity = drafted.find((d) => d.view.kind === 'crm.opportunity')
  // Refused *with the reason on the row* (DEC-26) — which is the string the
  // rail prints above the nine rows it has just made read-only.
  assert.equal(opportunity?.view.available, false)
  assert.match(opportunity?.view.reason ?? '', /Compte non résolu/)
  assert.equal(opportunity?.intent, null)
})

test('every field the gate lets a rep correct reaches a payload', () => {
  const rows = reviewFieldKeys()
  const edited: ReviewEdits = { ...prefillEdits(sampleExtraction, DOCUMENT) }
  const sentinels = new Map<string, string>()

  for (const row of rows) {
    const key = EDITS_KEY[row]
    if (!key) continue
    // A string nothing in the fixture, the composer or the courtesy shell could
    // produce, so a hit is the rep's own correction and never a coincidence.
    const sentinel = `SENTINELLE-${row.toUpperCase()}`
    sentinels.set(row, sentinel)
    Object.assign(edited, { [key]: sentinel })
  }

  const all = ['crm.task', 'crm.opportunity', 'mail.draft'].map((k) => `${MEETING}:${k}`)
  const drafted = draftIntents({
    meetingId: MEETING,
    facts: sampleExtraction.facts,
    edits: edited,
    mailTo: ['client@acme.fr'],
    checked: all,
  })

  const shipped = JSON.stringify(drafted.map((d) => d.intent))
  const dropped = [...sentinels].filter(([, value]) => !shipped.includes(value)).map(([row]) => row)

  assert.deepEqual(
    dropped,
    [],
    `ces champs sont modifiables au gate et n’atteignent aucune charge utile : ${dropped.join(', ')}`,
  )
})

test('the three that were dropped are in the opportunity, named', () => {
  const edits = {
    ...prefillEdits(sampleExtraction, DOCUMENT),
    dateDemarrage: 'début septembre',
    objections: '— le TJM 2025 est jugé trop haut',
    prochainesEtapes: '— envoyer trois CV avant vendredi',
  }
  const drafted = draftIntents({
    meetingId: MEETING,
    facts: sampleExtraction.facts,
    edits,
    mailTo: ['client@acme.fr'],
    checked: [`${MEETING}:crm.opportunity`],
  })
  const opportunity = drafted.find((d) => d.view.kind === 'crm.opportunity')?.intent
  assert.ok(opportunity && opportunity.kind === 'crm.opportunity')

  // Labelled, because a bench manager reading the pipeline row has not seen the
  // gate and cannot tell an objection from a next step by its shape.
  assert.match(opportunity.payload.description, /Démarrage : début septembre/)
  assert.match(opportunity.payload.description, /Objections :\n— le TJM 2025 est jugé trop haut/)
  assert.match(opportunity.payload.description, /Prochaines étapes :\n— envoyer trois CV/)

  // And never turned into a date column: « début septembre » is what the client
  // said, and DEC-7 forbids the app inventing a day from it.
  assert.equal(opportunity.payload.startingDate, null)
})

/*
 * ── a cleared field is a stated reason, never a schema error ────────────────
 *
 * `ReviewEditsSchema` carried `min(1)` on `mailSubject`, `mailBody` and
 * `compteRendu`. There is no guard on the objet field and no reason for one, so
 * a rep who cleared it armed *Valider* normally — « Valider malgré 1 champ non
 * vérifié » — and pressing it put a raw English Zod blob across the top of the
 * gate: `[{"origin":"string","code":"too_small",…}]`. **Nothing shipped**: not
 * the task, not the opportunity, not the draft.
 *
 * The requirement is real and the instrument was wrong. The argument was already
 * written down forty lines above those fields, on `taskName`: a requirement is
 * enforced where it can be *stated*, because `min(1)` can only throw, and this
 * is the one screen in the product that must never lose what the rep is holding.
 */
test('an empty mail subject costs the draft and nothing else', () => {
  const edits = prefillEdits(sampleExtraction, DOCUMENT)
  const all = ['crm.task', 'crm.opportunity', 'mail.draft'].map((k) => `${MEETING}:${k}`)
  const drafted = draftIntents({
    meetingId: MEETING,
    facts: sampleExtraction.facts,
    edits: { ...edits, mailSubject: '   ' },
    mailTo: ['client@acme.fr'],
    checked: all,
  })
  const mail = drafted.find((d) => d.view.kind === 'mail.draft')
  assert.equal(mail?.view.available, false)
  assert.match(mail?.view.reason ?? '', /objet au brouillon/)

  // And the two VerySwing pushes beside it are untouched, which is the whole
  // point of stating it here instead of rejecting the confirmation (DEC-26).
  assert.equal(drafted.find((d) => d.view.kind === 'crm.task')?.view.available, true)
})

test('a subject that is present is not refused for its own sake', () => {
  assert.equal(gate(sampleExtraction).view('mail.draft').available, true)
})

/**
 * **An empty compte-rendu is not a task.**
 *
 * `ReviewEdits.compteRendu` deliberately carries no `min(1)` — a rep who selects
 * the whole document in « Modifier » and deletes it has done something they can
 * undo, and rejecting the whole confirmation would discard every other
 * correction alongside it. That comment then says « and `draftIntents` already
 * refuses a task with no description, on the row, in French », and it did not:
 * `taskPossible` read the *name* and nothing else, so an empty body went into
 * `taskDescription` and landed in the client's system of record — where
 * `POST /v1/crm/tasks` has no idempotency key and `CrmPort` has no delete verb.
 */
test('a task with no body is refused on the row, with the reason', () => {
  const extraction = sampleExtraction
  const all = ['crm.task', 'crm.opportunity', 'mail.draft'].map((k) => `${MEETING}:${k}`)
  const drafted = (compteRendu: string) =>
    draftIntents({
      meetingId: MEETING,
      facts: extraction.facts,
      edits: { ...prefillEdits(extraction, DOCUMENT), compteRendu },
      mailTo: ['client@acme.fr'],
      checked: all,
    }).find((d) => d.view.kind === 'crm.task')!

  const empty = drafted('')
  assert.equal(empty.view.available, false)
  assert.equal(empty.intent, null)
  assert.match(empty.view.reason ?? '', /compte-rendu est vide/)

  // Whitespace is empty: three spaces and a newline is not a description, and
  // it is exactly what « tout sélectionner, supprimer » leaves behind.
  assert.equal(drafted('   \n  ').intent, null)

  // And the ordinary case is untouched.
  assert.ok(drafted(DOCUMENT).intent)
})
