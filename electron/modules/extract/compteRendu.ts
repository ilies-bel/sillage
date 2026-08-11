/**
 * `ExtractionESN` → the compte-rendu, in French markdown.
 *
 * The same string lands in two places and that is deliberate: it enters the
 * rep's editor as grey text once, at meeting end (DEC-5), and it is what goes
 * into the CRM task's description on *Valider*. A rep who edits the document is
 * editing what the client's account will show.
 *
 * ## Two recipes, one header (DEC-43)
 *
 * The header and the narrative are rendered for every recipe. The « Éléments
 * retenus » recap and the three list sections below it are the *typed slate*,
 * and a recipe that extracts no typed field prints none of them — not an empty
 * one, not one full of « _non évoqué_ ». That is the whole difference in this
 * file, and it is driven off `interpretation.recipe` rather than off "are the
 * fields empty": an ESN meeting where genuinely nothing was said still owes the
 * rep « _non évoqué_ » lines, because there the absence *is* the finding.
 *
 * ## Who writes which part
 *
 * The header is written here, from `facts` — the title, the account, the date,
 * the attendees. Those come from Graph and the CRM and are never the model's
 * (DEC-7), so they are rendered by code that cannot get them wrong rather than
 * asked for in a prompt. The narrative in the middle is the model's prose. The
 * recap at the foot is the typed fields, each carrying `⚠ faible` when its
 * quote did not verify (DEC-21) — the document says out loud what the review
 * screen shows next to the field, so a rep who skims only the document still
 * sees which lines to check.
 */
import type {
  ExtractionESN,
  ModeCollaboration,
  VerificationReport,
} from '../../core/contracts/extraction.ts'
import type { Cited } from '../../core/contracts/extraction.ts'
import type { Attendee } from '../../core/contracts/meeting.ts'
import { isFreeForm } from '../../core/contracts/recipes.ts'
import type { z } from 'zod'
import type {
  ObjectionSchema,
  ProchaineEtapeSchema,
  ProfilRechercheSchema,
  TjmSchema,
} from '../../core/contracts/extraction.ts'

/** The one thing a rep must notice without reading (DEC-21). */
export const FAIBLE_MARKER = '⚠ faible'

/** Always `Europe/Paris` in v1 — `MeetingContext.timeZone` says so. */
const ZONE = 'Europe/Paris'

const NOT_MENTIONED = '_non évoqué_'

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
})

const formatWhen = (startsAt: number, endsAt: number): string =>
  `${dateFormat.format(startsAt)}, ${timeFormat.format(startsAt)} – ${timeFormat.format(endsAt)}`

const formatAttendee = (attendee: Attendee): string => {
  const name = attendee.name.trim()
  const email = attendee.email.trim()
  if (name === '') return email
  return email === '' ? name : `${name} (${email})`
}

/** The suffix a line wears when its citation could not be found. */
const mark = (report: VerificationReport | undefined, path: string): string =>
  report?.fields[path] === 'faible' ? ` ${FAIBLE_MARKER}` : ''

const line = (
  report: VerificationReport | undefined,
  path: string,
  label: string,
  body: string | null,
): string =>
  body === null ? `- **${label}** : ${NOT_MENTIONED}` : `- **${label}** : ${body}${mark(report, path)}`

const formatProfil = (profil: z.infer<typeof ProfilRechercheSchema>): string => {
  const stack = profil.stack.filter((s) => s.trim() !== '')
  const seniorite = profil.seniorite.trim()
  const head = `${profil.nombre} × ${profil.intitule.trim()}`
  const parts = [head]
  if (seniorite !== '') parts.push(seniorite)
  const base = parts.join(' — ')
  return stack.length === 0 ? base : `${base} (${stack.join(', ')})`
}

/**
 * `EUR` is written `€` and everything else is written as it came. The devise is
 * free text in the schema because a Swiss client quotes CHF, and a currency
 * table is not what this file is for.
 */
const formatTjm = (tjm: z.infer<typeof TjmSchema>): string => {
  const devise = tjm.devise.trim().toUpperCase() === 'EUR' ? '€' : tjm.devise.trim()
  const montant = new Intl.NumberFormat('fr-FR').format(tjm.montant)
  const base = devise === '' ? montant : `${montant} ${devise}`
  const fourchette = tjm.fourchette?.trim() ?? ''
  return fourchette === '' ? base : `${base} (fourchette ${fourchette})`
}

const formatObjection = (objection: z.infer<typeof ObjectionSchema>): string => {
  const reponse = objection.reponseApportee?.trim() ?? ''
  return reponse === ''
    ? `${objection.objection.trim()} — _sans réponse apportée_`
    : `${objection.objection.trim()} — réponse : ${reponse}`
}

const formatEtape = (etape: z.infer<typeof ProchaineEtapeSchema>): string =>
  [etape.action.trim(), etape.responsable.trim(), etape.echeance.trim()]
    .filter((part) => part !== '')
    .join(' — ')

const listSection = <T>(
  heading: string,
  items: readonly Cited<T>[],
  path: string,
  report: VerificationReport | undefined,
  format: (value: T) => string,
  empty: string,
): string[] => {
  if (items.length === 0) return [heading, '', empty, '']
  return [
    heading,
    '',
    ...items.map((item, i) => `- ${format(item.value)}${mark(report, `${path}.${i}`)}`),
    '',
  ]
}

const MODE_LABEL: Record<ModeCollaboration, string> = {
  régie: 'régie',
  forfait: 'forfait',
  'assistance technique': 'assistance technique',
  inconnu: 'non précisé',
}

/**
 * The whole document. `verification` is optional so a caller holding only a
 * stored `ExtractionESN` — the Historique screen, replaying an old meeting —
 * can render it without re-verifying; the markers are simply absent, which is
 * honest, rather than wrong.
 */
export const renderCompteRendu = (
  extraction: ExtractionESN,
  verification?: VerificationReport,
): string => {
  const { facts, interpretation } = extraction
  const accountMark = facts.account.confidence === 'faible' ? ` ${FAIBLE_MARKER}` : ''
  const interlocuteurs =
    facts.interlocuteurs.length === 0
      ? '_aucun interlocuteur au calendrier_'
      : facts.interlocuteurs.map(formatAttendee).join(', ')

  /*
   * Absence is stated in italics, never filled with a phrase.
   *
   * The same convention `interlocuteurs` above already uses, and it is the whole
   * of what replaced « Client à confirmer » / « Rendez-vous client ». Italic
   * prose cannot be mistaken for a client's name the way a capitalised noun
   * phrase can — and this document is pasted into the CRM task description,
   * where a fabricated account name outlives every screen that showed it.
   */
  const taskName = facts.taskName.trim()
  const accountName = facts.account.name.trim()

  const head: string[] = [
    taskName === '' ? '# _Réunion sans objet_' : `# ${taskName}`,
    '',
    `**Client** : ${accountName === '' ? '_non résolu_' : accountName}${accountMark}`,
    `**Date** : ${formatWhen(facts.startsAt, facts.endsAt)}`,
    `**Interlocuteurs** : ${interlocuteurs}`,
    // Omitted rather than rendered empty when nobody is signed into Microsoft.
    // « **Commercial** :  » followed by nothing reads as a value the app failed
    // to find, and the rep reading it is the person it would have named.
    ...(facts.repEmail === null ? [] : [`**Commercial** : ${facts.repEmail}`]),
    '',
    interpretation.compteRendu.trim(),
  ]

  // The narrative is the whole document for a free-form recipe. Nothing is
  // appended, and nothing says a section is missing — the plan the model chose
  // *is* the plan (DEC-43).
  if (isFreeForm(interpretation.recipe)) {
    return `${head.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
  }

  const lines: string[] = [
    ...head,
    '',
    '## Éléments retenus',
    '',
    // `null` prints « _non évoqué_ », which is the same thing it has always
    // printed for an absent TJM. These three used to be non-nullable; the ESN
    // recipe still asks for all three, so a null here means the model found
    // nothing to say — not that the recipe never asked (DEC-43).
    line(
      verification,
      'besoin',
      'Besoin',
      interpretation.besoin === null ? null : interpretation.besoin.value.trim(),
    ),
    line(
      verification,
      'modeCollaboration',
      'Mode de collaboration',
      interpretation.modeCollaboration === null
        ? null
        : MODE_LABEL[interpretation.modeCollaboration.value],
    ),
    line(
      verification,
      'tjmEvoque',
      'TJM évoqué',
      interpretation.tjmEvoque === null ? null : formatTjm(interpretation.tjmEvoque.value),
    ),
    line(
      verification,
      'dateDemarrage',
      'Démarrage',
      interpretation.dateDemarrage === null ? null : interpretation.dateDemarrage.value.trim(),
    ),
    line(
      verification,
      'dureeMission',
      'Durée de mission',
      interpretation.dureeMission === null ? null : interpretation.dureeMission.value.trim(),
    ),
    line(
      verification,
      'contexteTechnique',
      'Contexte technique',
      interpretation.contexteTechnique === null
        ? null
        : interpretation.contexteTechnique.value.trim(),
    ),
    '',
    ...listSection(
      '## Profils recherchés',
      interpretation.profilsRecherches,
      'profilsRecherches',
      verification,
      formatProfil,
      '_Aucun profil précisé._',
    ),
    ...listSection(
      '## Objections et points de vigilance',
      interpretation.objections,
      'objections',
      verification,
      formatObjection,
      '_Aucune objection relevée._',
    ),
    ...listSection(
      '## Prochaines étapes',
      interpretation.prochainesEtapes,
      'prochainesEtapes',
      verification,
      formatEtape,
      '_Aucune étape convenue._',
    ),
  ]

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
