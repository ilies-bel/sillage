/**
 * The recipe, against a stub `LlmPort`. No network, no Electron, no key.
 *
 * The stub is the point of the exercise: every rule this module exists to
 * enforce is a rule about what happens when a model answers *badly*, and the
 * only way to test that is to be the model. Each case below is a specific bad
 * answer — an invented attendee, a paraphrased citation, an extra field, a
 * provider that is down — and asserts the recipe's refusal rather than its
 * happy path.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiagInput, DiagRecorder } from '../../../core/contracts/diagnostics.ts'
import { LlmError, type LlmPort, type LlmStructuredRequest } from '../../../core/contracts/llm.ts'
import type { MeetingContext } from '../../../core/contracts/meeting.ts'
import type { TranscriptSegment } from '../../../core/contracts/transcript.ts'
import { CompteRenduRecipe } from '../CompteRenduRecipe.ts'
import { ExtractionError } from '../errors.ts'
import { EXTRACT_SCHEMA_NAME, NOTE_SCHEMA_NAME, type ExtractReply } from '../prompt.ts'

const REP_EMAIL = 'julien.marchand@esn-exemple.fr'

const context: MeetingContext = {
  eventId: 'AAMkAGI2-test',
  subject: 'Acme Industries — renfort plateforme',
  agenda: "Point sur le besoin de renfort de l'équipe plateforme.",
  organizer: {
    name: 'Julien Marchand',
    email: REP_EMAIL,
    type: 'required',
    response: 'organizer',
  },
  attendees: [
    {
      name: 'Camille Le Roy',
      email: 'camille.leroy@acme-industries.fr',
      type: 'required',
      response: 'accepted',
    },
    { name: 'Salle Bleue', email: 'salle.bleue@esn-exemple.fr', type: 'resource', response: 'none' },
  ],
  onlineMeetingJoinUrl: null,
  categories: [],
  sensitivity: 'normal',
  scheduledStart: Date.UTC(2026, 2, 12, 8, 0),
  scheduledEnd: Date.UTC(2026, 2, 12, 9, 0),
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
}

const said = (i: number, channel: 'rep' | 'far', text: string): TranscriptSegment => ({
  id: `seg-${i}`,
  channel,
  text,
  startMs: i * 10_000,
  endMs: i * 10_000 + 8_000,
  isFinal: true,
  provider: 'test',
  receivedAt: 1_770_000_000_000 + i,
})

const transcript: TranscriptSegment[] = [
  said(0, 'rep', 'bonjour, merci de nous recevoir'),
  said(1, 'far', 'on cherche deux développeurs Java seniors pour la plateforme'),
  said(2, 'far', 'on travaillerait en régie sur ce sujet'),
  said(3, 'far', 'on est plutôt sur un TJM de 520 euros'),
  said(4, 'far', 'le démarrage serait en septembre'),
  said(5, 'far', 'la mission durerait six mois renouvelables'),
  said(6, 'far', 'notre stack est Spring Boot et Postgres'),
  said(7, 'far', "notre inquiétude c'est le délai de démarrage"),
  said(8, 'rep', 'on vous envoie deux CV avant vendredi'),
]

const validReply = (over: Partial<ExtractReply> = {}): ExtractReply => ({
  compteRendu:
    '## Contexte\n\nLe client renforce son équipe plateforme.\n\n## Besoin exprimé\n\nDeux développeurs Java seniors.\n',
  besoin: {
    valeur: "Renfort de l'équipe plateforme",
    citation: 'on cherche deux développeurs Java seniors pour la plateforme',
  },
  profilsRecherches: [
    {
      valeur: { intitule: 'Développeur Java', seniorite: 'senior', stack: ['Java'], nombre: 2 },
      citation: 'on cherche deux développeurs Java seniors pour la plateforme',
    },
  ],
  modeCollaboration: { valeur: 'régie', citation: 'on travaillerait en régie sur ce sujet' },
  tjmEvoque: {
    valeur: { montant: 520, devise: 'EUR', fourchette: null },
    citation: 'on est plutôt sur un TJM de 520 euros',
  },
  dateDemarrage: { valeur: 'septembre', citation: 'le démarrage serait en septembre' },
  dureeMission: {
    valeur: '6 mois renouvelables',
    citation: 'la mission durerait six mois renouvelables',
  },
  contexteTechnique: {
    valeur: 'Spring Boot et Postgres',
    citation: 'notre stack est Spring Boot et Postgres',
  },
  objections: [
    {
      valeur: { objection: 'délai de démarrage', reponseApportee: null },
      citation: "notre inquiétude c'est le délai de démarrage",
    },
  ],
  prochainesEtapes: [
    {
      valeur: { action: 'Envoi de 2 CV', responsable: 'le commercial', echeance: 'vendredi' },
      citation: 'on vous envoie deux CV avant vendredi',
    },
  ],
  ...over,
})

interface Seen {
  requests: LlmStructuredRequest<unknown>[]
  diagnostics: DiagInput[]
}

/**
 * A model that answers however the test tells it to. `complete` throws because
 * the recipe must never reach for the cheap verb — the reply is held to a
 * schema or it is not trusted.
 */
const stub = (
  answer: (request: LlmStructuredRequest<unknown>) => unknown,
): { llm: LlmPort; diagnostics: DiagRecorder; seen: Seen } => {
  const seen: Seen = { requests: [], diagnostics: [] }
  return {
    seen,
    diagnostics: { record: (input) => void seen.diagnostics.push(input) },
    llm: {
      complete: () => Promise.reject(new Error('the recipe must not use complete()')),
      structured: <T>(request: LlmStructuredRequest<T>) => {
        seen.requests.push(request as LlmStructuredRequest<unknown>)
        const value = answer(request as LlmStructuredRequest<unknown>)
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as T)
      },
    },
  }
}

const run = (answer: (request: LlmStructuredRequest<unknown>) => unknown, over = {}) => {
  const { llm, diagnostics, seen } = stub(answer)
  const recipe = new CompteRenduRecipe({ llm, diagnostics })
  return {
    seen,
    result: recipe.run({ context, transcript, repEmail: REP_EMAIL, ...over }),
  }
}

const rejects = async (promise: Promise<unknown>): Promise<ExtractionError> => {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof ExtractionError, `expected ExtractionError, got ${String(error)}`)
    return error
  }
  throw new Error('expected the extraction to fail')
}

test('a short meeting is one reduce call and produces a whole extraction', async () => {
  const { result, seen } = run(() => validReply())
  const { extraction, verification, compteRendu } = await result

  assert.equal(seen.requests.length, 1)
  assert.equal(seen.requests[0]?.schemaName, EXTRACT_SCHEMA_NAME)
  assert.equal(verification.overall, 'ok')
  assert.equal(extraction.interpretation.besoin?.value, "Renfort de l'équipe plateforme")
  assert.ok(compteRendu.startsWith('# Acme Industries — renfort plateforme'))
})

test('deterministic facts come from MeetingContext and never from the reply', async () => {
  const { result } = run(() => validReply())
  const { extraction } = await result
  const { facts } = extraction

  assert.equal(facts.taskName, context.subject)
  assert.equal(facts.startsAt, context.scheduledStart)
  assert.equal(facts.endsAt, context.scheduledEnd)
  assert.equal(facts.repEmail, REP_EMAIL)
  // The rep is not their own interlocutor and a meeting room is not a contact.
  assert.deepEqual(
    facts.interlocuteurs.map((a) => a.email),
    ['camille.leroy@acme-industries.fr'],
  )
  // Nothing in the interpretation names anyone: there is no field that could.
  assert.equal('interlocuteurs' in extraction.interpretation, false)
})

test('the model is never shown the attendees, so a name in its reply is its own', async () => {
  const { result, seen } = run(() => validReply())
  await result

  const sent = seen.requests.map((r) => `${r.instructions}\n${r.input}`).join('\n')
  assert.ok(!sent.includes('Camille'))
  assert.ok(!sent.includes('camille.leroy@acme-industries.fr'))
  assert.ok(!sent.includes('Julien Marchand'))
})

test("a reply naming an attendee is refused, not cleaned up", async () => {
  const { result, seen } = run(() =>
    validReply({
      compteRendu: '## Contexte\n\nÉchange avec Camille Le Roy sur le renfort plateforme.\n',
    }),
  )
  const error = await rejects(result)

  assert.equal(error.kind, 'deterministic-leak')
  assert.ok(error.details.some((d) => d.includes("nom d'un participant")))
  assert.ok(seen.diagnostics.some((d) => d.code === 'extract.reply.deterministicLeak'))
})

test('a reply carrying an e-mail address is refused', async () => {
  const { result } = run(() =>
    validReply({
      besoin: {
        valeur: 'Renfort plateforme, contact camille.leroy@acme-industries.fr',
        citation: 'on cherche deux développeurs Java seniors pour la plateforme',
      },
    }),
  )
  const error = await rejects(result)

  assert.equal(error.kind, 'deterministic-leak')
  assert.ok(error.details.some((d) => d.includes('adresse e-mail')))
})

test('a citation may contain a name — it is transcript, not invention', async () => {
  const withIntroduction = [
    ...transcript,
    said(9, 'far', 'Camille Le Roy à l’appareil, je suis la DSI'),
  ]
  const { result } = run(() =>
    validReply({
      contexteTechnique: {
        valeur: 'La DSI pilote le sujet',
        citation: 'Camille Le Roy à l’appareil, je suis la DSI',
      },
    }),
    { transcript: withIntroduction },
  )
  const { verification } = await result
  assert.equal(verification.fields['contexteTechnique'], 'ok')
})

test('an extra key in the reply fails validation instead of being dropped', async () => {
  const { result } = run(() => ({ ...validReply(), interlocuteur: 'Camille Le Roy' }))
  const error = await rejects(result)
  assert.equal(error.kind, 'reply-invalid')
  assert.equal(error.retryable, true)
})

test('an unverifiable quote is downgraded to faible, never dropped', async () => {
  const { result } = run(() =>
    validReply({
      tjmEvoque: {
        valeur: { montant: 520, devise: 'EUR', fourchette: null },
        // Plausible, French, and never said. This is the whole failure mode.
        citation: 'notre budget maximum est de 520 euros par jour',
      },
    }),
  )
  const { extraction, verification, compteRendu } = await result

  assert.equal(verification.fields['tjmEvoque'], 'faible')
  assert.equal(verification.overall, 'faible')
  // Kept, with the field intact — the rep decides at the gate (DEC-4).
  assert.equal(extraction.interpretation.tjmEvoque?.value.montant, 520)
  // And nothing pretends to know where it was said.
  assert.equal(extraction.interpretation.tjmEvoque?.span.channel, null)
  assert.equal(extraction.interpretation.tjmEvoque?.span.startMs, null)
  assert.match(compteRendu, /TJM évoqué.*⚠ faible/)
})

test('a verified span is measured from the transcript, not taken from the reply', async () => {
  const { result } = run(() => validReply())
  const { extraction } = await result
  const span = extraction.interpretation.dateDemarrage?.span

  assert.equal(span?.channel, 'far')
  assert.equal(span?.startMs, transcript[4]?.startMs)
  assert.equal(span?.endMs, transcript[4]?.endMs)
})

test('a provider failure is a typed error and yields no extraction at all', async () => {
  const { result } = run(
    () => new LlmError({ kind: 'quota', message: 'quota dépassé', retryable: false, status: 429 }),
  )
  const error = await rejects(result)

  assert.equal(error.kind, 'llm')
  assert.equal(error.retryable, false)
  assert.match(error.message, /modèle/)
})

test('an empty transcript is reported as such, and costs no model call', async () => {
  const { result, seen } = run(() => validReply(), { transcript: [] })
  const error = await rejects(result)

  assert.equal(error.kind, 'empty-transcript')
  assert.equal(error.retryable, false)
  assert.equal(seen.requests.length, 0)
})

test('interim-only transcript is empty, not extractable', async () => {
  const { result } = run(() => validReply(), {
    transcript: [{ ...said(0, 'far', 'on cherche des profils'), isFinal: false }],
  })
  assert.equal((await rejects(result)).kind, 'empty-transcript')
})

test("the rep's notes reach the reduce prompt", async () => {
  const { result, seen } = run(() => validReply(), { notes: 'budget serré, relancer lundi' })
  await result
  assert.match(String(seen.requests[0]?.input), /budget serré, relancer lundi/)
})

/**
 * The notes arrive labelled as un-citable, and the label travels with them.
 *
 * Measured against a real model before this existed: every field the rep had
 * also written down came back citing the note rather than the transcript, and
 * `groundReply` — which searches the transcript and nothing else — marked all
 * of them `faible`. The values were right. Only the evidence was unfindable.
 *
 * Asserting on the sentence rather than on a model's behaviour is deliberate:
 * no stub can reproduce the failure, because a stub returns whatever citation
 * the test hands it. What a test *can* hold is that the instruction is still
 * next to the notes when they enter the prompt.
 */
test("the rep's notes are labelled as material to use, not to cite", async () => {
  const { result, seen } = run(() => validReply(), { notes: 'budget serré, relancer lundi' })
  await result
  const input = String(seen.requests[0]?.input)
  assert.match(input, /ne se citent pas/)
  // The claim it must not lose: notes outrank the transcript on *content*.
  assert.match(input, /priment sur la transcription/)
})

test('a meeting with no notes carries no note preamble', async () => {
  const { result, seen } = run(() => validReply(), { notes: '   ' })
  await result
  assert.doesNotMatch(String(seen.requests[0]?.input), /ne se citent pas/)
})

const tiny = { singlePassTokens: 500, targetTokens: 600, overlapTokens: 100 }

const longTranscript = (): TranscriptSegment[] => [
  ...Array.from({ length: 40 }, (_, i) =>
    said(100 + i, i % 2 === 0 ? 'rep' : 'far', `point ${i} ${'on parle du contexte projet '.repeat(6)}`),
  ),
  ...transcript,
]

test('a long meeting maps to notes, then reduces — and the citations survive', async () => {
  const { llm, diagnostics, seen } = stub((request) =>
    request.schemaName === NOTE_SCHEMA_NAME
      ? {
          notes: [
            {
              sujet: 'tjm',
              note: 'TJM de 520 € évoqué',
              citation: 'on est plutôt sur un TJM de 520 euros',
            },
          ],
        }
      : validReply(),
  )
  const recipe = new CompteRenduRecipe({ llm, diagnostics, chunking: tiny })
  const { verification } = await recipe.run({
    context,
    transcript: longTranscript(),
    repEmail: REP_EMAIL,
  })

  const notes = seen.requests.filter((r) => r.schemaName === NOTE_SCHEMA_NAME)
  const reduce = seen.requests.filter((r) => r.schemaName === EXTRACT_SCHEMA_NAME)
  assert.ok(notes.length > 1, `expected a map stage, got ${notes.length} note calls`)
  assert.equal(reduce.length, 1)
  // The reduce stage reads cited notes, not a paraphrase — which is why every
  // field still verifies against the transcript.
  assert.match(String(reduce[0]?.input), /citation: « on est plutôt sur un TJM de 520 euros »/)
  assert.equal(verification.overall, 'ok')
})

/**
 * The channel split has to survive the map stage.
 *
 * A single-pass meeting keeps it in the `commercial:` / `client:` prefixes
 * `renderSegment` writes. A long one goes through notes, whose schema has no
 * speaker — so without `#attribute` the reduce stage writes the compte-rendu
 * for a two-hour call with no idea which side of the table anything came from.
 */
test('a long meeting keeps who said what, measured off the transcript', async () => {
  const { llm, diagnostics, seen } = stub((request) =>
    request.schemaName === NOTE_SCHEMA_NAME
      ? {
          notes: [
            {
              sujet: 'tjm',
              note: 'TJM de 520 € évoqué',
              citation: 'on est plutôt sur un TJM de 520 euros',
            },
            {
              sujet: 'etape',
              note: 'envoi de deux CV avant vendredi',
              citation: 'on vous envoie deux CV avant vendredi',
            },
          ],
        }
      : validReply(),
  )
  const recipe = new CompteRenduRecipe({ llm, diagnostics, chunking: tiny })
  await recipe.run({ context, transcript: longTranscript(), repEmail: REP_EMAIL })

  const reduce = String(seen.requests.find((r) => r.schemaName === EXTRACT_SCHEMA_NAME)?.input)
  // The prospect said the rate; the rep committed to the CVs. Neither was asked
  // of the model — both come from which channel `locateQuote` found them in.
  assert.match(reduce, /- \[tjm\] \(client\) TJM de 520 € évoqué/)
  assert.match(reduce, /- \[etape\] \(commercial\) envoi de deux CV avant vendredi/)
})

test('a note whose citation will not locate is attributed to nobody', async () => {
  const { llm, diagnostics, seen } = stub((request) =>
    request.schemaName === NOTE_SCHEMA_NAME
      ? {
          notes: [
            {
              sujet: 'besoin',
              note: 'un besoin que personne n’a formulé',
              citation: 'cette phrase ne figure dans aucun canal',
            },
          ],
        }
      : validReply(),
  )
  const recipe = new CompteRenduRecipe({ llm, diagnostics, chunking: tiny })
  await recipe.run({ context, transcript: longTranscript(), repEmail: REP_EMAIL })

  const reduce = String(seen.requests.find((r) => r.schemaName === EXTRACT_SCHEMA_NAME)?.input)
  // Guessing here would be the one failure the measured path exists to avoid:
  // an unlocatable quote has no speaker, and the marker is simply absent.
  assert.match(reduce, /- \[besoin\] un besoin/)
  assert.doesNotMatch(reduce, /\(commercial\)|\(client\)/)
})

test('one failed chunk fails the whole extraction rather than half of it', async () => {
  let calls = 0
  const { llm, diagnostics, seen } = stub((request) => {
    if (request.schemaName !== NOTE_SCHEMA_NAME) return validReply()
    calls++
    return calls === 2
      ? new LlmError({ kind: 'server', message: '502', retryable: true, status: 502 })
      : { notes: [] }
  })
  const recipe = new CompteRenduRecipe({ llm, diagnostics, chunking: tiny })
  const error = await rejects(
    recipe.run({ context, transcript: longTranscript(), repEmail: REP_EMAIL }),
  )

  assert.equal(error.kind, 'llm')
  assert.ok(seen.diagnostics.some((d) => d.code === 'extract.chunk.failed'))
  // It stopped there: no reduce call, so no compte-rendu built on a hole.
  assert.equal(seen.requests.filter((r) => r.schemaName === EXTRACT_SCHEMA_NAME).length, 0)
})

test('a completed extraction is recorded with its measured confidence', async () => {
  const { result, seen } = run(() => validReply())
  await result
  const done = seen.diagnostics.find((d) => d.code === 'extract.completed')
  assert.equal(done?.severity, 'info')
  assert.equal(done?.detail?.['faible'], 0)
})
