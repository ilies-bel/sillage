/**
 * The two recipes, at the level the model sees them (DEC-43).
 *
 * The interesting failures here are all quiet ones. A free recipe that reaches
 * the ESN prompt still produces a document — a perfectly good one, with the
 * seven fixed headings and « _non évoqué_ » under four of them — so nothing
 * throws, nothing is logged, and the only symptom is a rep wondering why the
 * picker does nothing. Likewise a free extraction that came back with the ESN
 * reply schema attached would ground nine fields that were never asked for.
 *
 * So these tests assert on what was *sent* and on what was *stored*, which are
 * the two places the branch can go wrong without anybody noticing.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CompteRenduRecipe } from '../CompteRenduRecipe.ts'
import { renderCompteRendu } from '../compteRendu.ts'
import { COMPTE_RENDU_SECTIONS } from '../../../core/contracts/recipes.ts'
import { LlmInterpretationSchema } from '../../../core/contracts/extraction.ts'
import { sampleContext } from '../../../core/contracts/fixtures.ts'
import type { LlmPort, LlmStructuredRequest } from '../../../core/contracts/llm.ts'
import type { TranscriptSegment } from '../../../core/contracts/transcript.ts'

const segment = (over: Partial<TranscriptSegment> & { text: string }): TranscriptSegment => ({
  id: 'seg',
  channel: 'far',
  startMs: 0,
  endMs: 0,
  isFinal: true,
  provider: 'local-whisper',
  receivedAt: 0,
  ...over,
})

const TRANSCRIPT: TranscriptSegment[] = [
  segment({ id: 's1', channel: 'rep', text: 'on repousse la bascule à la fin du mois' }),
  segment({ id: 's2', text: 'très bien, on confirme la volumétrie avant' }),
]

const LIBRE_DOCUMENT = [
  '## Résumé',
  '',
  'La bascule est repoussée.',
  '',
  '## Décisions',
  '',
  '- Bascule à la fin du mois.',
].join('\n')

/**
 * Records every call, and answers whatever the test told it to.
 *
 * `complete` throws rather than returning something: the recipe must never
 * reach for the streaming half of the port — that one belongs to the signal
 * rail — and a stub that quietly answered would hide it if it did.
 */
const spyLlm = (reply: unknown) => {
  const calls: LlmStructuredRequest<unknown>[] = []
  const llm: LlmPort = {
    structured: async (request: LlmStructuredRequest<unknown>) => {
      calls.push(request)
      return reply
    },
    complete: () => {
      throw new Error('the recipe does not stream')
    },
  } as unknown as LlmPort
  return { llm, calls }
}

const ESN_REPLY = {
  compteRendu: '## Résumé\n\nRien.\n',
  besoin: { valeur: 'un renfort', citation: 'on repousse la bascule à la fin du mois' },
  profilsRecherches: [],
  modeCollaboration: { valeur: 'inconnu', citation: 'on repousse la bascule à la fin du mois' },
  tjmEvoque: null,
  dateDemarrage: null,
  dureeMission: null,
  contexteTechnique: { valeur: 'une bascule', citation: 'on repousse la bascule à la fin du mois' },
  objections: [],
  prochainesEtapes: [],
}

test('the free recipe asks for a document and nothing else', async () => {
  const { llm, calls } = spyLlm({ compteRendu: LIBRE_DOCUMENT })
  const recipe = new CompteRenduRecipe({ llm })

  const result = await recipe.run({
    context: sampleContext,
    recipe: 'libre',
    transcript: TRANSCRIPT,
    repEmail: null,
  })

  assert.equal(calls.length, 1)
  const sent = calls[0]
  // The instruction that makes it free-form, and the one that keeps it
  // skimmable — both have to reach the model or the recipe is decorative.
  assert.match(sent?.instructions ?? '', /pas de trame imposée/i)
  assert.match(sent?.instructions ?? '', /## Résumé/)
  // And not the ESN one, which is the quiet failure: it would have produced a
  // perfectly valid document under the wrong recipe.
  assert.doesNotMatch(sent?.instructions ?? '', /« modeCollaboration »/)

  // Nothing typed was produced, so nothing was verified — and `overall` is `ok`
  // because there was nothing to be unsure about, not because anything passed.
  assert.equal(result.extraction.interpretation.recipe, 'libre')
  assert.equal(result.extraction.interpretation.besoin, null)
  assert.equal(result.extraction.interpretation.modeCollaboration, null)
  assert.deepEqual(result.verification.fields, {})
  assert.equal(result.verification.overall, 'ok')
})

test('a free document keeps the model’s own headings and grows no field list', async () => {
  const { llm } = spyLlm({ compteRendu: LIBRE_DOCUMENT })
  const recipe = new CompteRenduRecipe({ llm })

  const { compteRendu } = await recipe.run({
    context: sampleContext,
    recipe: 'libre',
    transcript: TRANSCRIPT,
    repEmail: null,
  })

  assert.match(compteRendu, /## Décisions/)
  // The deterministic header is still rendered — the client, the date and the
  // attendees are facts about the meeting, not about the recipe (DEC-7).
  assert.match(compteRendu, /\*\*Client\*\*/)
  // What is absent is the typed slate. « Éléments retenus » followed by six
  // « _non évoqué_ » lines is exactly the document this recipe exists to avoid.
  assert.doesNotMatch(compteRendu, /Éléments retenus/)
  assert.doesNotMatch(compteRendu, /_non évoqué_/)
  assert.doesNotMatch(compteRendu, /Profils recherchés/)
})

test('the default recipe is unchanged — same prompt, same fields, same document', async () => {
  const { llm, calls } = spyLlm(ESN_REPLY)
  const recipe = new CompteRenduRecipe({ llm })

  const result = await recipe.run({
    context: sampleContext,
    transcript: TRANSCRIPT,
    repEmail: null,
  })

  // No `recipe` passed at all: a caller that predates DEC-43 gets what it always
  // got, which is the whole reason the field is optional.
  assert.equal(result.extraction.interpretation.recipe, 'besoin-commercial')
  assert.match(calls[0]?.instructions ?? '', /« modeCollaboration »/)
  for (const heading of COMPTE_RENDU_SECTIONS) {
    assert.ok(calls[0]?.instructions.includes(heading), `${heading} should be in the prompt`)
  }
  assert.match(result.compteRendu, /Éléments retenus/)
})

test('a free reply carrying a deterministic leak is refused like any other', async () => {
  // The free recipe has one prose key and no schema constraining what goes in
  // it, which makes this check the *only* thing standing between a model that
  // read a name off the transcript and a CRM task carrying it (DEC-7).
  const { llm } = spyLlm({
    compteRendu: '## Résumé\n\nÉchange avec Camille Le Roy sur la bascule.\n',
  })
  const recipe = new CompteRenduRecipe({ llm })

  await assert.rejects(
    recipe.run({
      context: sampleContext,
      recipe: 'libre',
      transcript: TRANSCRIPT,
      repEmail: null,
    }),
    /donnée|déterministe|refus/i,
  )
})

test('an extraction stored before recipes existed replays as the ESN one', () => {
  // The log is permanent (`events.ts`): every `extraction.completed` written
  // before DEC-43 has no `recipe` key, and each one of them came out of the ESN
  // recipe. A default is what keeps Historique readable across the change.
  const legacy = {
    compteRendu: '## Résumé\n\nRien.\n',
    besoin: {
      value: 'un renfort',
      span: { quote: 'q', channel: null, startMs: null, endMs: null },
    },
    profilsRecherches: [],
    modeCollaboration: {
      value: 'régie',
      span: { quote: 'q', channel: null, startMs: null, endMs: null },
    },
    tjmEvoque: null,
    dateDemarrage: null,
    dureeMission: null,
    contexteTechnique: {
      value: 'une bascule',
      span: { quote: 'q', channel: null, startMs: null, endMs: null },
    },
    objections: [],
    prochainesEtapes: [],
  }

  assert.equal(LlmInterpretationSchema.parse(legacy).recipe, 'besoin-commercial')
})

test('a legacy extraction still renders its « Éléments retenus »', () => {
  const parsed = LlmInterpretationSchema.parse({
    compteRendu: '## Résumé\n\nRien.\n',
    besoin: { value: 'un renfort', span: { quote: 'q', channel: null, startMs: null, endMs: null } },
    profilsRecherches: [],
    modeCollaboration: {
      value: 'régie',
      span: { quote: 'q', channel: null, startMs: null, endMs: null },
    },
    tjmEvoque: null,
    dateDemarrage: null,
    dureeMission: null,
    contexteTechnique: {
      value: 'x',
      span: { quote: 'q', channel: null, startMs: null, endMs: null },
    },
    objections: [],
    prochainesEtapes: [],
  })

  const document = renderCompteRendu({
    facts: {
      taskName: 'Point',
      startsAt: sampleContext.scheduledStart,
      endsAt: sampleContext.scheduledEnd,
      interlocuteurs: [],
      repEmail: null,
      account: { accountId: null, name: '', confidence: 'faible' },
      knownContactIds: [],
    },
    interpretation: parsed,
  })

  assert.match(document, /Éléments retenus/)
})
