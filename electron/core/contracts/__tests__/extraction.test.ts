/**
 * DEC-7, as a test.
 *
 * "Deterministic data never comes from the LLM" is a guideline until the two
 * types are separate and the interpretive one is strict. These assertions are
 * the enforcement: a model that emits an attendee email, an account code or a
 * calendar date fails schema validation instead of being believed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ExtractionESNSchema,
  LlmInterpretationSchema,
} from '../extraction.ts'
import { sampleExtraction, sampleSpan } from '../fixtures.ts'

test('the sample extraction validates', () => {
  assert.doesNotThrow(() => ExtractionESNSchema.parse(sampleExtraction))
})

test('the interpretation schema rejects every deterministic field', () => {
  // Exactly the fields VISION.md §5.2 says are read from an API. Each is added
  // to an otherwise valid interpretation, one at a time.
  //
  // The schema is strict, so the *names* are illustrative — any unknown key
  // fails. That is why the CRM's own account-code identifier is not spelled out
  // here: `accountCode` proves the same thing, and the containment check
  // (ARCHITECTURE.md §5.J) is worth more without an exemption in it.
  const smuggled = {
    email: 'camille.leroy@acme-industries.fr',
    interlocuteurs: [{ nom: 'Camille Le Roy' }],
    accountCode: 'ACC-1042',
    deadlineDate: '2026-09-01T09:00:00+00:00',
    endDate: '2026-09-01T10:00:00+00:00',
    actionUserId: 42,
    contactsIds: [77],
    confianceGlobale: 0.9,
  }

  for (const [key, value] of Object.entries(smuggled)) {
    const attempt = { ...sampleExtraction.interpretation, [key]: value }
    assert.throws(
      () => LlmInterpretationSchema.parse(attempt),
      `the model should not be able to emit "${key}"`,
    )
  }
})

test('an interpretive field cannot be produced without a cited span', () => {
  const { besoin: _dropped, ...rest } = sampleExtraction.interpretation
  assert.throws(() => LlmInterpretationSchema.parse(rest))

  assert.throws(() =>
    LlmInterpretationSchema.parse({
      ...sampleExtraction.interpretation,
      besoin: { value: "Renfort de l'équipe plateforme" },
    }),
  )

  // An empty quote is not a citation. spanVerification would reject it too, but
  // the schema should never let it that far.
  assert.throws(() =>
    LlmInterpretationSchema.parse({
      ...sampleExtraction.interpretation,
      besoin: {
        value: 'x',
        span: { quote: '', channel: null, startMs: null, endMs: null },
      },
    }),
  )
})

test('the model cannot self-report confidence', () => {
  assert.throws(() =>
    LlmInterpretationSchema.parse({
      ...sampleExtraction.interpretation,
      besoin: { ...sampleExtraction.interpretation.besoin, confidence: 'ok' },
    }),
  )
})

test('modeCollaboration is closed to the four ESN values', () => {
  assert.throws(() =>
    LlmInterpretationSchema.parse({
      ...sampleExtraction.interpretation,
      modeCollaboration: {
        value: 'staff augmentation',
        // The fixture's `besoin` is nullable since DEC-43 — a recipe may not ask
        // for it. This one does, so the span is there; `??` keeps the test about
        // the enum rather than about the optionality.
        span: sampleExtraction.interpretation.besoin?.span ?? sampleSpan,
      },
    }),
  )
})
