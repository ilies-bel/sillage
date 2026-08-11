/**
 * Canonical sample values for the contracts.
 *
 * Lives in `core/contracts/` rather than beside a test because every layer may
 * import `core/` and no layer may import another's tests — so this is the only
 * place a fixture can sit without a boundary violation. It is also the reason
 * these are worth having: one `ExtractionESN` that every test agrees on beats
 * six hand-rolled ones that quietly drift apart.
 *
 * French values throughout, because the product is (HR-6) and a fixture in
 * English would hide encoding bugs.
 */
import type { Attendee, MeetingContext } from './meeting.ts'
import type { ExtractionESN, VerificationReport } from './extraction.ts'
import { freeFormInterpretation } from './extraction.ts'
import type { TranscriptSegment, TranscriptSpan } from './transcript.ts'

export const sampleAttendee: Attendee = {
  name: 'Camille Le Roy',
  email: 'camille.leroy@acme-industries.fr',
  type: 'required',
  response: 'accepted',
}

export const sampleContext: MeetingContext = {
  eventId: 'AAMkAGI2-sample',
  subject: 'Acme Industries — besoin Dev Java',
  agenda: "Point sur le besoin de renfort de l'équipe plateforme.",
  organizer: {
    name: 'Julien Marchand',
    email: 'julien.marchand@esn-exemple.fr',
    type: 'required',
    response: 'organizer',
  },
  attendees: [sampleAttendee],
  onlineMeetingJoinUrl: 'https://teams.microsoft.com/l/meetup-join/sample',
  categories: [],
  sensitivity: 'normal',
  scheduledStart: 1_760_000_000_000,
  scheduledEnd: 1_760_003_600_000,
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
}

export const sampleSpan: TranscriptSpan = {
  quote: 'on est plutôt sur un TJM de 520 euros',
  channel: 'far',
  startMs: 812_000,
  endMs: 815_400,
}

export const sampleSegment: TranscriptSegment = {
  id: 'seg-1',
  channel: 'far',
  text: sampleSpan.quote,
  startMs: 812_000,
  endMs: 815_400,
  isFinal: true,
  provider: 'local-whisper',
  receivedAt: 1_760_001_000_000,
}

export const sampleExtraction: ExtractionESN = {
  facts: {
    taskName: sampleContext.subject,
    startsAt: sampleContext.scheduledStart,
    endsAt: sampleContext.scheduledEnd,
    interlocuteurs: [sampleAttendee],
    repEmail: sampleContext.organizer.email,
    account: { accountId: 'ACC-1042', name: 'Acme Industries', confidence: 'ok' },
    knownContactIds: ['CT-77'],
  },
  interpretation: {
    recipe: 'besoin-commercial',
    compteRendu: '## Contexte\n\nRenfort de deux profils Java sur la plateforme.\n',
    besoin: { value: "Renfort de l'équipe plateforme", span: sampleSpan },
    profilsRecherches: [
      {
        value: { intitule: 'Dev Java', seniorite: 'senior', stack: ['Java', 'Spring'], nombre: 2 },
        span: sampleSpan,
      },
    ],
    modeCollaboration: { value: 'régie', span: sampleSpan },
    tjmEvoque: { value: { montant: 520, devise: 'EUR', fourchette: null }, span: sampleSpan },
    dateDemarrage: { value: 'septembre', span: sampleSpan },
    dureeMission: { value: '6 mois renouvelables', span: sampleSpan },
    contexteTechnique: { value: 'Migration Spring Boot 3', span: sampleSpan },
    objections: [{ value: { objection: 'délai de démarrage', reponseApportee: null }, span: sampleSpan }],
    prochainesEtapes: [
      { value: { action: 'envoyer 2 CV', responsable: 'Julien', echeance: 'vendredi' }, span: sampleSpan },
    ],
  },
}

export const sampleVerification: VerificationReport = {
  fields: { besoin: 'ok', 'profilsRecherches.0': 'ok', tjmEvoque: 'ok' },
  overall: 'ok',
}

/**
 * The same meeting, written with the free recipe (DEC-43).
 *
 * Same deterministic facts — the account, the date and the attendees come from
 * Graph and VerySwing whatever shape the document takes — and no interpretive
 * field at all. That is the difference the fixture exists to carry: null here
 * means « this recipe never asked », which is not the same as an ESN meeting
 * where nothing was said, and every consumer has to tell the two apart.
 *
 * Its headings are the model's own, and deliberately not the ESN ones: a fixture
 * that quietly reused « ## Besoin exprimé » would let a renderer keyed on those
 * headings pass a test it should fail.
 */
export const sampleLibreExtraction: ExtractionESN = {
  facts: sampleExtraction.facts,
  interpretation: freeFormInterpretation(
    'libre',
    [
      '## Résumé',
      '',
      "Point d'avancement sur la migration de la plateforme. Le lot de reprise est terminé, le bascule est repoussée d'une semaine.",
      '',
      '## Décisions',
      '',
      '- Bascule reportée à la fin du mois.',
      '',
      '## Points ouverts',
      '',
      '- Volumétrie de la reprise à confirmer.',
      '',
    ].join('\n'),
  ),
}

/** Nothing typed was produced, so there is nothing to have verified (DEC-21). */
export const sampleLibreVerification: VerificationReport = { fields: {}, overall: 'ok' }
