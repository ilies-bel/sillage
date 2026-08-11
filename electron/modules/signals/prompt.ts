/**
 * What the rail asks a model for, and the shape it must answer in.
 *
 * Two rules shape the request, and both are decisions rather than taste:
 *
 *   **DEC-7 — deterministic data never comes from the LLM.** The reply has no
 *   field for a name, an email, a date or an account code, and the instructions
 *   forbid them in prose as well. Those come from Graph and VSA. A model that
 *   emits one fails validation instead of being believed, which is the same
 *   trick `LlmInterpretationSchema` plays at the end of the meeting.
 *
 *   **DEC-21 — confidence is measured.** The model supplies the quote and
 *   nothing else about provenance: no channel, no timings, no self-assessed
 *   confidence. `core/domain/spanVerification.ts` finds the quote in the stored
 *   transcript and *that* is where the span comes from.
 */
import { z } from 'zod'
import { SignalKindSchema } from '../../core/contracts/signals.ts'

/**
 * A cap, not a target. Six chips from one minute is already more than a rep
 * glances at; a model that returns twenty has started narrating rather than
 * extracting, and the whole reply is better failed than rendered.
 */
export const MAX_SIGNALS_PER_CHUNK = 6

/** Longer than this is a sentence, and a sentence is not a chip. */
export const MAX_LABEL_CHARS = 48

/**
 * Strict on purpose.
 *
 * An extra key is not noise to strip — `{ "interlocuteur": "Marc Dupont" }` is
 * precisely the DEC-7 failure, and it should cost the chunk rather than be
 * quietly dropped on the floor. The cost of failing is one skipped minute of
 * rail, recorded as a diagnostic; nothing about the meeting changes.
 */
export const SignalReplySchema = z.strictObject({
  signaux: z
    .array(
      z.strictObject({
        type: SignalKindSchema,
        /** The chip text, already French and already short: `TJM 520 €`. */
        libelle: z.string().min(1).max(MAX_LABEL_CHARS),
        /** Verbatim from the excerpt. Verified before the chip exists. */
        citation: z.string().min(1),
      }),
    )
    .max(MAX_SIGNALS_PER_CHUNK),
})
export type SignalReply = z.infer<typeof SignalReplySchema>

export const SIGNAL_SCHEMA_NAME = 'SignauxReunion'

/**
 * French, because the labels are rendered verbatim (HR-6) and because the call
 * being read is in French — asking in English invites an English chip.
 *
 * The prohibition list is not defensive padding: the transcript *does* contain
 * names, dates and company names, they are the easiest things in it to spot,
 * and a model left to its own judgement will happily offer `Réunion avec Marc
 * Dupont le 12 mars`. Every one of those is already known exactly, from the
 * calendar or the CRM.
 */
export const SIGNAL_INSTRUCTIONS = [
  "Tu assistes un commercial d'une ESN française pendant un rendez-vous client.",
  "On te donne un extrait de la transcription en cours. Repère uniquement les faits commerciaux qui viennent d'être dits explicitement, et renvoie-les sous forme de très courtes étiquettes en français.",
  '',
  'Types autorisés :',
  '- tjm : un tarif journalier évoqué → « TJM 520 € »',
  '- profil : un profil recherché → « 2× Dev Java senior »',
  '- demarrage : une date de démarrage telle qu\'elle a été dite → « démarrage septembre »',
  '- duree : une durée de mission → « 6 mois renouvelables »',
  '- mode : régie, forfait ou assistance technique → « régie »',
  '- objection : une objection ou une réserve du client → « objection : délai »',
  '- etape : une prochaine étape convenue → « envoi de 2 CV »',
  '- autre : un fait commercial marquant qui n\'entre dans aucun type ci-dessus',
  '',
  'Règles impératives :',
  "- N'invente rien. Si l'extrait ne contient aucun fait de ce genre, renvoie une liste vide.",
  '- Ne renvoie jamais de nom de personne, d\'adresse e-mail, de nom de société, de date de réunion ni de référence client. Ces informations sont déjà connues et ne sont pas ton travail.',
  '- « citation » doit reprendre mot pour mot un passage de l\'extrait, sans reformulation, sans guillemets ajoutés.',
  '- « libelle » fait au plus 48 caractères, sans phrase, sans ponctuation finale.',
  '- Un fait déjà évident dans l\'extrait ne doit apparaître qu\'une seule fois.',
  '- Réponds en français, uniquement dans le format demandé.',
].join('\n')
