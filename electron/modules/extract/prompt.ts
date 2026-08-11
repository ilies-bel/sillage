/**
 * What the recipe asks a model for, and the shape it must answer in (DEC-13 —
 * one fixed compte-rendu, no template picker, no options).
 *
 * Two prompts, because the recipe is map-then-reduce (see `chunking.ts`):
 *
 *   `NOTE_INSTRUCTIONS`    one call per chunk of a long meeting. Returns short
 *                          French notes, each with a verbatim citation.
 *   `EXTRACT_INSTRUCTIONS` one call at the end. Reads either the whole
 *                          transcript (short meeting) or the notes (long one)
 *                          and produces the compte-rendu plus the typed fields.
 *
 * ## Why the reply schema is not `LlmInterpretationSchema`
 *
 * `LlmInterpretation` carries a `TranscriptSpan` per field — quote, channel,
 * `startMs`, `endMs`. Three of those four are *measured*, by `locateQuote`,
 * from the stored transcript (DEC-21). Asking the model for a span would ask it
 * for a channel and a time range it has no way to know and every incentive to
 * invent plausibly. So the reply carries a bare `citation` string and nothing
 * else about provenance, and `toExtraction.ts` builds the span. The model
 * cannot supply a timing here because there is nowhere to put one.
 *
 * ## Why the prompt is told nothing about the attendees
 *
 * The agenda, the subject and the attendee list are all to hand, and none of
 * them is passed in. They are exactly the deterministic data DEC-7 keeps away
 * from the model, and a model shown `Camille Le Roy` in its instructions will
 * put `Camille Le Roy` in its answer — at which point the leak check in
 * `deterministicLeaks.ts` cannot tell an invention from an echo. Withholding
 * them costs a little context and buys a check that means something.
 */
import { z } from 'zod'
import {
  ModeCollaborationSchema,
  ObjectionSchema,
  ProfilRechercheSchema,
  ProchaineEtapeSchema,
  TjmSchema,
} from '../../core/contracts/extraction.ts'
import { COMPTE_RENDU_SECTIONS } from '../../core/contracts/recipes.ts'

export { COMPTE_RENDU_SECTIONS }

/**
 * One interpretive value and the words it was read from.
 *
 * The mirror of `cited()` in `core/contracts/extraction.ts`, with `span`
 * replaced by a bare string. Strict, so a model that adds `"confiance": 0.9`
 * fails the chunk instead of being believed.
 */
const cite = <T extends z.ZodType>(inner: T) =>
  z.strictObject({ valeur: inner, citation: z.string().min(1) })

/** A note's subject. The same vocabulary the final fields use, one level down. */
export const NoteSujetSchema = z.enum([
  'besoin',
  'profil',
  'mode',
  'tjm',
  'demarrage',
  'duree',
  'technique',
  'objection',
  'etape',
])
export type NoteSujet = z.infer<typeof NoteSujetSchema>

/** A note longer than this is a paragraph, and a paragraph is not a note. */
export const MAX_NOTE_CHARS = 240

/**
 * A cap, not a target. Thirty notes from one chunk means the model has started
 * transcribing rather than noting, and the chunk is better failed than folded
 * into the reduce stage where its noise becomes indistinguishable from signal.
 */
export const MAX_NOTES_PER_CHUNK = 30

export const NoteReplySchema = z.strictObject({
  notes: z
    .array(
      z.strictObject({
        sujet: NoteSujetSchema,
        note: z.string().min(1).max(MAX_NOTE_CHARS),
        /** Verbatim from the chunk. It is what survives to `locateQuote`. */
        citation: z.string().min(1),
      }),
    )
    .max(MAX_NOTES_PER_CHUNK),
})
export type NoteReply = z.infer<typeof NoteReplySchema>

/**
 * The final reply. Field-for-field `LlmInterpretationSchema`, spans excepted.
 *
 * Strict at every level, and that strictness is the DEC-7 enforcement that
 * costs nothing: there is no key here for an e-mail, an attendee, a meeting
 * date or an account code, so a model that produces one fails to parse. The
 * prose channel is guarded separately, by `deterministicLeaks.ts`.
 */
export const ExtractReplySchema = z.strictObject({
  /** The narrative. French markdown, sections fixed by DEC-13. */
  compteRendu: z.string().min(1),
  besoin: cite(z.string()),
  profilsRecherches: z.array(cite(ProfilRechercheSchema)),
  modeCollaboration: cite(ModeCollaborationSchema),
  tjmEvoque: cite(TjmSchema).nullable(),
  dateDemarrage: cite(z.string()).nullable(),
  dureeMission: cite(z.string()).nullable(),
  contexteTechnique: cite(z.string()),
  objections: z.array(cite(ObjectionSchema)),
  prochainesEtapes: z.array(cite(ProchaineEtapeSchema)),
})
export type ExtractReply = z.infer<typeof ExtractReplySchema>

export const NOTE_SCHEMA_NAME = 'NotesReunion'
export const EXTRACT_SCHEMA_NAME = 'CompteRenduESN'

// ── The free recipe (DEC-43) ────────────────────────────────────────────────

/**
 * What the free recipe's reduce stage returns: the document, and nothing else.
 *
 * Strict and one key wide, which is the enforcement that matters here. A model
 * asked for a free-form compte-rendu is a model with no schema telling it to
 * stop, and the ESN reply schema's real job was never the fields — it was
 * closing the structured channel to DEC-7 data. One key closes it completely:
 * there is nowhere to put an e-mail, a date or an account code, and
 * `deterministicLeaks.ts` still walks the prose.
 *
 * No `citation` anywhere, and that is the stated cost of this recipe: nothing
 * typed is produced, so there is nothing for `locateQuote` to verify and no
 * `⚠ faible` to draw (see `core/contracts/recipes.ts`).
 */
export const LibreReplySchema = z.strictObject({
  compteRendu: z.string().min(1),
})
export type LibreReply = z.infer<typeof LibreReplySchema>

export const LIBRE_SCHEMA_NAME = 'CompteRenduLibre'

/**
 * The free recipe's map stage.
 *
 * Separate from `NoteReplySchema` because that one carries `sujet`, an enum of
 * the ESN slate — asking a model taking notes on a steering committee to file
 * every point under `tjm` or `profil` is asking it to mislabel, and the reduce
 * stage would then read a distribution that says the call was about pricing. A
 * note here is a note: what was said, and the words it was said in.
 */
export const LibreNoteReplySchema = z.strictObject({
  notes: z
    .array(
      z.strictObject({
        note: z.string().min(1).max(MAX_NOTE_CHARS),
        citation: z.string().min(1),
      }),
    )
    .max(MAX_NOTES_PER_CHUNK),
})
export type LibreNoteReply = z.infer<typeof LibreNoteReplySchema>

export const LIBRE_NOTE_SCHEMA_NAME = 'NotesReunionLibre'

const FORBIDDEN = [
  "- N'écris jamais de nom de personne, d'adresse e-mail, de nom de société, de numéro de téléphone, de date de réunion ni de référence client. Ces informations viennent du calendrier et du CRM ; les produire est une erreur, pas un service.",
  '- Désigne les personnes par leur rôle : « le commercial », « le client », « l\'interlocuteur technique ».',
]

/**
 * French, unconditionally (HR-6, DEC-22).
 *
 * Not "answer in the language of the call". A rep at a French ESN pastes this
 * into a French CRM and mails it to a French client; a call held in English
 * with a Dublin subsidiary still produces a French compte-rendu. The language
 * is a property of the instruction, which is why it is stated here and not in
 * the adapter.
 */
export const NOTE_INSTRUCTIONS = [
  "Tu assistes un commercial d'une ESN française. On te donne un extrait de la transcription d'un rendez-vous client.",
  "Relève les faits commerciaux explicitement dits dans cet extrait, sous forme de notes courtes en français. Ces notes serviront à rédiger le compte-rendu ; elles ne sont pas le compte-rendu.",
  '',
  'Sujets :',
  '- besoin : le besoin exprimé par le client',
  '- profil : un profil recherché (intitulé, séniorité, technologies, nombre)',
  '- mode : régie, forfait ou assistance technique',
  '- tjm : un tarif journalier évoqué',
  '- demarrage : un démarrage évoqué, tel qu\'il a été dit',
  '- duree : une durée de mission',
  '- technique : un élément de contexte technique (stack, existant, contraintes)',
  '- objection : une objection ou une réserve, et la réponse apportée s\'il y en a eu une',
  '- etape : une prochaine étape convenue',
  '',
  'Règles impératives :',
  "- N'invente rien. Si l'extrait ne contient aucun fait de ce genre, renvoie une liste vide.",
  '- « citation » reprend mot pour mot un passage de l\'extrait, sans reformulation, sans guillemets ajoutés, sans les préfixes « commercial: » et « client: ».',
  ...FORBIDDEN,
  '- Réponds en français, uniquement dans le format demandé.',
].join('\n')

export const EXTRACT_INSTRUCTIONS = [
  "Tu assistes un commercial d'une ESN française. On te donne la matière d'un rendez-vous client qui vient de se terminer : soit la transcription complète, soit les notes prises sur chaque partie de l'échange.",
  'Produis le compte-rendu commercial et les champs structurés qui vont être proposés au commercial avant envoi dans son CRM.',
  '',
  '« compteRendu » est un texte en français, au format markdown, avec exactement ces sections et dans cet ordre :',
  ...COMPTE_RENDU_SECTIONS.map((heading) => `  ${heading}`),
  "Rédige-le comme le commercial l'aurait écrit : des phrases, pas une liste de champs recopiés. Ne mets pas de titre de niveau 1, il est ajouté ensuite.",
  "« ## Résumé » fait deux à quatre phrases et se lit seul : ce que le client cherche, où en est l'échange, ce qui a été convenu. C'est la section que l'on lit trois semaines plus tard sans rouvrir le reste. N'y annonce pas le document (« ce compte-rendu présente… ») et n'y mets pas de liste à puces.",
  '',
  'Les autres clés sont les champs structurés. Pour chacun :',
  '- « valeur » est la donnée, en français.',
  '- « citation » reprend mot pour mot un passage de la transcription, sans reformulation, sans guillemets ajoutés, sans les préfixes « commercial: » et « client: ».',
  "- Quand la matière est une liste de notes de réunion, recopie caractère pour caractère la ligne « citation » de la note correspondante : c'est déjà un passage de la transcription.",
  "- Dans cette liste, « (commercial) » ou « (client) » indique qui a prononcé le passage cité. C'est une mesure faite sur la transcription, pas une supposition : appuie-toi dessus pour attribuer un propos, un engagement ou une objection. Une note sans marqueur est une note dont la citation n'a pas pu être située ; n'attribue alors rien à personne.",
  '',
  'Règles impératives :',
  "- Ne cite jamais les notes saisies par le commercial. Elles te disent quoi retenir ; la citation, elle, vient toujours de ce qui a été dit à voix haute. Un fait que seules les notes mentionnent se cite avec le passage de la transcription qui s'en approche le plus, ou reste sans citation.",
  "- N'invente rien. Un champ facultatif dont rien n'a été dit vaut null ; une liste dont rien n'a été dit est vide.",
  "- « modeCollaboration » vaut « inconnu » si le mode n'a pas été dit explicitement.",
  '- « dateDemarrage » et « dureeMission » sont du texte libre, repris tel qu\'il a été dit (« septembre », « 6 mois renouvelables »). Ne les convertis pas en dates.',
  '- Un même fait ne doit apparaître qu\'une seule fois, même s\'il revient plusieurs fois dans la matière.',
  ...FORBIDDEN,
  '- Réponds en français, uniquement dans le format demandé.',
].join('\n')

/**
 * The free recipe's map stage, in words.
 *
 * The ESN version lists nine subjects and tells the model to relève only those.
 * This one deliberately lists none: the meetings this recipe exists for are the
 * ones whose important points are not on any list drawn in advance. What
 * survives is the part that is not about the ESN slate at all — no invention,
 * verbatim citations, and no deterministic data.
 */
export const LIBRE_NOTE_INSTRUCTIONS = [
  "Tu assistes un commercial d'une ESN française. On te donne un extrait de la transcription d'un rendez-vous client.",
  "Relève les points importants de cet extrait, sous forme de notes courtes en français : décisions, informations, engagements, désaccords, questions restées ouvertes. Ces notes serviront à rédiger le compte-rendu ; elles ne sont pas le compte-rendu.",
  '',
  'Règles impératives :',
  "- N'invente rien. Si l'extrait ne contient rien de notable, renvoie une liste vide.",
  "- Ne présuppose aucun plan : c'est le contenu de l'échange qui décide de ce qui compte, pas une trame connue d'avance.",
  '- « citation » reprend mot pour mot un passage de l\'extrait, sans reformulation, sans guillemets ajoutés, sans les préfixes « commercial: » et « client: ».',
  ...FORBIDDEN,
  '- Réponds en français, uniquement dans le format demandé.',
].join('\n')

/**
 * The free recipe's reduce stage — the one prompt in the product that is asked
 * to choose a document's shape.
 *
 * Two things it is still told, and both are deliberate.
 *
 * **It opens on « ## Résumé » (DEC-40).** That is not a field to fill: it is a
 * summary of whatever happened, and it is fillable for any meeting by
 * construction. It is also the section that made the ESN document skimmable
 * three weeks later, and dropping it here would mean the recipe for irregular
 * meetings is the one you cannot skim.
 *
 * **Three to six sections, `##`, named after what was said.** A cap because a
 * model given free rein writes a heading per topic and returns a table of
 * contents; a floor because one heading is not a plan. The instruction to name
 * them after the meeting's own subject matter is the whole feature — « Décisions
 * budget », « Migration Kafka », « Points ouverts » — and it is the reason the
 * ESN slate's « _non évoqué_ » lines do not appear in this document at all.
 */
export const LIBRE_INSTRUCTIONS = [
  "Tu assistes un commercial d'une ESN française. On te donne la matière d'un rendez-vous client qui vient de se terminer : soit la transcription complète, soit les notes prises sur chaque partie de l'échange.",
  'Rédige le compte-rendu de cet échange, en français, au format markdown.',
  '',
  "Il n'y a pas de trame imposée. C'est à toi de dégager le plan à partir de ce dont il a été question :",
  '- Commence par une section « ## Résumé » de deux à quatre phrases qui se lit seule : de quoi a parlé la réunion, où en est le sujet, ce qui a été décidé. N\'y annonce pas le document (« ce compte-rendu présente… ») et n\'y mets pas de liste à puces.',
  "- Ensuite, trois à six sections de niveau « ## », titrées d'après le contenu réel de l'échange (« Décisions », « Migration de la plateforme », « Points ouverts »…). Choisis-les pour ce qui a été dit, pas pour ce qu'un rendez-vous commercial contient d'habitude.",
  "- Ne crée pas de section pour un sujet qui n'a pas été abordé, et n'écris jamais qu'un sujet n'a pas été évoqué : ce qui n'a pas été dit n'a pas sa place dans le document.",
  "- À l'intérieur d'une section, des phrases ou des puces courtes, selon ce qui se lit le mieux.",
  'Ne mets pas de titre de niveau 1, il est ajouté ensuite.',
  '',
  'Règles impératives :',
  "- N'invente rien. Tout ce que tu écris doit avoir été dit dans la matière fournie.",
  "- Ne cite pas les notes saisies par le commercial comme si elles avaient été prononcées. Elles te disent quoi retenir.",
  '- Un même fait ne doit apparaître qu\'une seule fois, même s\'il revient plusieurs fois dans la matière.',
  ...FORBIDDEN,
  '- Réponds en français, uniquement dans le format demandé.',
].join('\n')

/**
 * What the rep's own typed notes are for, said at the point they appear.
 *
 * Two claims, and the second one exists because the first used to imply its
 * opposite. The notes *are* more reliable than the transcript — the rep wrote
 * them deliberately, the STT guessed. But `groundReply` verifies citations
 * against the transcript and nothing else, so telling a model that the notes
 * outrank the transcript and then asking it to quote "the material" gets
 * exactly what it asks for: correct values citing the notes, every one of them
 * unverifiable, every one of them landing on the review screen as `⚠ faible`.
 *
 * Measured, not theorised: against a real model this fixture returned 8 of 13
 * fields weak, and every failing citation was a verbatim line of these notes.
 * A review gate that flags two thirds of its own fields teaches the rep to
 * click past the flag, which costs more than the flag ever earned.
 */
export const NOTES_PREAMBLE = [
  'Notes saisies par le commercial pendant la réunion.',
  'Elles sont fiables et priment sur la transcription en cas de contradiction : utilise-les pour savoir ce qui compte.',
  "Elles ne se citent pas — elles n'ont pas été prononcées, et une citation qui en vient est introuvable dans la transcription.",
].join(' ')

/** The two roles the hardware gives us, in the words the prompt uses for them. */
export type Locuteur = 'commercial' | 'client'

/**
 * A map-stage note once the recipe has measured who said it.
 *
 * `locuteur` is not part of `NoteReplySchema` and deliberately never will be.
 * The model is not asked who spoke for the same reason it is not asked for a
 * timing (DEC-21): it would answer, plausibly, from a chunk in which both roles
 * appear. It is derived instead — `locateQuote` finds the citation in the
 * stored transcript and the channel falls out of *where* it was found. Absent
 * when the citation did not verify, which is the honest outcome: a quote nobody
 * can locate has no speaker either.
 */
export interface RenderableNote {
  /**
   * Absent for the free recipe, whose map stage has no subject enum (DEC-43).
   * The bracket is then simply not drawn — a `[autre]` on every line would be a
   * column of noise the reduce stage has to read past.
   */
  sujet?: NoteSujet
  note: string
  citation: string
  locuteur?: Locuteur
}

/**
 * How the map stage's notes reach the reduce stage.
 *
 * The citation is on its own line, quoted, and labelled — the reduce prompt
 * tells the model to copy it character-for-character, and a format that makes
 * the boundaries of the quote obvious is what makes that instruction followable.
 *
 * The `(commercial)` / `(client)` marker is what survives of the channel split
 * on a long meeting. The single-pass path keeps the `commercial:` / `client:`
 * prefixes from `chunking.ts` all the way into the prompt; the map-reduce path
 * would otherwise hand the reduce stage a flat list of facts with no idea which
 * side of the table each came from — on precisely the two-hour calls where
 * "who committed to this" is hardest to reconstruct.
 */
export const renderNotes = (notes: readonly RenderableNote[]): string =>
  notes
    .map((n) => {
      const head = [
        n.sujet === undefined ? null : `[${n.sujet}]`,
        n.locuteur === undefined ? null : `(${n.locuteur})`,
        n.note,
      ].filter((part): part is string => part !== null)
      return `- ${head.join(' ')}\n  citation: « ${n.citation} »`
    })
    .join('\n')
