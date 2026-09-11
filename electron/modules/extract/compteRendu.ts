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
import type { TranscriptSpan } from '../../core/contracts/transcript.ts'
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

/**
 * Unwrap the model's prose: a soft line break inside a paragraph becomes a space.
 *
 * Models return French prose hard-wrapped at seventy-odd columns more often than
 * not, and the string they wrap is the string that is stored, rendered and sent
 * to VerySwing (DEC-44). Nothing downstream can undo it: `whitespace-pre-wrap`
 * honours the break, so the document reads « …avant la fin de l'année et /
 * généralise dbt sur les domaines métier. » — a sentence cut after « et », at
 * every width, on every surface, and in the CRM.
 *
 * It is normalised **here**, where the document is composed, rather than in a
 * renderer, precisely so the stored string is the clean one and the rep still
 * reads exactly what VerySwing will receive.
 *
 * The rule is the closed vocabulary the recipe writes and nothing else:
 *
 *   · a blank line is a paragraph break and is kept;
 *   · a line that opens a heading (`#`) or a list item (`- `) keeps its break,
 *     and so does the line *before* one — those are structure, not prose;
 *   · anything else joined to the line above by a single newline was a wrap,
 *     and becomes one space.
 *
 * A model that returns one line per paragraph — which is what the prompt asks
 * for — passes through untouched.
 */
const STRUCTURAL = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```)/

export const unwrapProse = (prose: string): string => {
  const out: string[] = []
  for (const line of prose.split('\n')) {
    const previous = out[out.length - 1]
    const joinable =
      previous !== undefined &&
      previous.trim() !== '' &&
      line.trim() !== '' &&
      !STRUCTURAL.test(line) &&
      !STRUCTURAL.test(previous)
    if (joinable) out[out.length - 1] = `${previous.trimEnd()} ${line.trimStart()}`
    else out.push(line)
  }
  return out.join('\n')
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

  /*
   * **The four deterministic lines carry no `**`, and that is a decision about
   * two surfaces at once.**
   *
   * They used to: `**Client** : Néovia Santé`, `**Date** : …`,
   * `**Interlocuteurs** : …`, `**Commercial** : …` — four consecutive lines,
   * each with two literal asterisk pairs, at the very top of every document.
   * The block markers (`#`, `##`, `- `) hang in a gutter outside the measure,
   * which is what makes them readable; `**` cannot, because it sits inside a
   * line. So the first thing the eye landed on, on the flagship screen, was a
   * row of punctuation — and the same eight asterisks landed in the VerySwing
   * task body, where a delivery manager reads them as noise the app forgot to
   * remove.
   *
   * The emphasis was never load-bearing here. These are the *only* four lines
   * in the document composed in code, from Graph and the CRM (DEC-7): a label,
   * a colon and a fact, in a fixed order, already set apart by sitting under the
   * title and above the prose. Where `**` *does* earn its place is where the
   * model wrote it — inside « Éléments retenus », where it distinguishes a
   * field's name from its value in a list the model produced — and there it
   * stays, hangs nowhere, and is drawn muted (`CompteRenduDocument`).
   *
   * DEC-44 is untouched: nothing is *hidden*. The characters are not emitted at
   * all, so VerySwing still receives the string the rep read, byte for byte.
   */
  const head: string[] = [
    taskName === '' ? '# _Réunion sans objet_' : `# ${taskName}`,
    '',
    `Client : ${accountName === '' ? '_non résolu_' : accountName}${accountMark}`,
    `Date : ${formatWhen(facts.startsAt, facts.endsAt)}`,
    `Interlocuteurs : ${interlocuteurs}`,
    // Omitted rather than rendered empty when nobody is signed into Microsoft.
    // « Commercial :  » followed by nothing reads as a value the app failed to
    // find, and the rep reading it is the person it would have named.
    ...(facts.repEmail === null ? [] : [`Commercial : ${facts.repEmail}`]),
    '',
    unwrapProse(interpretation.compteRendu.trim()),
  ]

  // The narrative is the whole document for a free-form recipe. Nothing is
  // appended, and nothing says a section is missing — the plan the model chose
  // *is* the plan (DEC-43).
  if (isFreeForm(interpretation.recipe)) {
    return `${head.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
  }

  /*
   * The recap, and everything in it is a **sub**-section of it.
   *
   * The three list fields used to be appended at `##`, which collided head-on
   * with the model's own narrative: `COMPTE_RENDU_SECTIONS` already contains
   * « ## Objections et points de vigilance » and « ## Prochaines étapes », so
   * every ESN compte-rendu this app has ever produced carried each of those two
   * headings *twice*, several hundred words apart, once over prose and once over
   * a list — on screen, in the CRM task, and in the exported copy.
   *
   * No screenshot pass caught it because the harness fixture was four invented
   * headings rather than the document the composer writes; the fixture is now
   * the real shape, which is how this surfaced at all.
   *
   * `###` is the fix rather than a rename, because the relationship is real:
   * above « Éléments retenus » is the model's prose, below it is the extracted
   * slate with its `⚠ faible` markers, and the profils / objections / étapes
   * lists are three fields of that slate — not three more chapters. `###` is in
   * the typesetter's vocabulary (`compteRenduLines.ts`), so the gutter draws it
   * like the rest.
   */
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
      '### Profils recherchés',
      interpretation.profilsRecherches,
      'profilsRecherches',
      verification,
      formatProfil,
      '_Aucun profil précisé._',
    ),
    ...listSection(
      '### Objections et points de vigilance',
      interpretation.objections,
      'objections',
      verification,
      formatObjection,
      '_Aucune objection relevée._',
    ),
    ...listSection(
      '### Prochaines étapes',
      interpretation.prochainesEtapes,
      'prochainesEtapes',
      verification,
      formatEtape,
      '_Aucune étape convenue._',
    ),
  ]

  /*
   * **The marker explains itself, once, in the document that carries it.**
   *
   * `⚠ faible` is written into the compte-rendu on purpose — the whole of DEC-21
   * is that a rep skimming the document, rather than opening the form, still
   * sees which sentence the app could not stand behind. But this string is also
   * the body of the VerySwing task, and there it is read by a delivery manager,
   * a consultant, a recruiter — none of whom have ever seen the review gate, its
   * header banner or its orange rail. To them it was a dingbat and a lowercase
   * adjective at the end of a line.
   *
   * One line at the foot, and only when a marker is actually present, so a
   * clean compte-rendu carries no apparatus at all. It is the same rule the
   * screens follow (DEC-26): nothing on it is unexplained.
   */
  const document = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  const legend = document.includes(FAIBLE_MARKER)
    ? `\n\n${FAIBLE_MARKER} : la citation de cette valeur n’a pas été retrouvée dans la transcription. À confirmer auprès du client.`
    : ''

  return `${document}${legend}\n`
}

/**
 * **Where each line of the document came from, so the bullets can be checked
 * the way the fields already are** (DEC-21).
 *
 * The eleven typed rows in the gate's rail each carry a `[source ▸]`, and the
 * twenty-four hundred pixels of compte-rendu beside them carried provenance on
 * quotations only — five followable fragments across twenty-eight substantive
 * lines, and **none at all on the twelve bullets**. The bullets are the
 * operative half: « 2 × Data Engineer confirmé », « Envoyer 3 CV avec TJM avant
 * vendredi ». Those are the commitments that become the VerySwing task, and they
 * were the least checkable thing on a screen whose whole argument is that
 * nothing ships unchecked.
 *
 * Nothing new is claimed and nothing is re-verified. Every one of these lines is
 * already composed *from* a `Cited<T>` whose span `spanVerification` looked up in
 * the stored transcript; the span simply never left the extraction. This pairs
 * each rendered line with the span it was rendered from — deterministically,
 * because both sides call the same `format`, so the renderer matches on string
 * equality and never on a heuristic.
 *
 * What is *followed* is the span's own quote, never the composed line: the line
 * is how the document says it and the quote is what was actually said, and only
 * the second is findable in a transcript. So the pairing is « this line, that
 * fragment » — which is the same pairing `[source ▸]` already makes for a field.
 *
 * It is a **side channel on purpose.** DEC-44: the document is never rendered as
 * markdown anywhere and VerySwing receives the string the rep read, so a marker
 * written into the text would land in the CRM as literal punctuation. The
 * provenance travels beside the document, not inside it.
 */
export interface CompteRenduSource {
  /** The line as `renderCompteRendu` wrote it, without the `- ` and any marker. */
  text: string
  span: TranscriptSpan
}

export const compteRenduSources = (extraction: ExtractionESN): CompteRenduSource[] => {
  const { interpretation } = extraction
  const out: CompteRenduSource[] = []

  /*
   * The line **as written**, which is the whole of the match. `text` is compared
   * for equality by the renderer, so it has to be assembled by exactly the code
   * paths that assembled the document — `\`**${label}** : ${body}\`` for an
   * « Éléments retenus » row, `format(item.value)` for a list item — or the
   * provenance silently disappears the day one of them is reworded, with nothing
   * failing anywhere. `compteRendu.test.ts` holds the two halves together.
   */
  const row = (label: string, body: string | null, span: TranscriptSpan | null | undefined) => {
    const trimmed = body?.trim()
    if (!trimmed || !span) return
    out.push({ text: `**${label}** : ${trimmed}`, span })
  }
  const item = (text: string, span: TranscriptSpan | null | undefined) => {
    if (!span) return
    out.push({ text: text.trim(), span })
  }

  row('Besoin', interpretation.besoin?.value ?? null, interpretation.besoin?.span)
  row(
    'Mode de collaboration',
    interpretation.modeCollaboration === null
      ? null
      : MODE_LABEL[interpretation.modeCollaboration.value],
    interpretation.modeCollaboration?.span,
  )
  row(
    'TJM évoqué',
    interpretation.tjmEvoque === null ? null : formatTjm(interpretation.tjmEvoque.value),
    interpretation.tjmEvoque?.span,
  )
  row('Démarrage', interpretation.dateDemarrage?.value ?? null, interpretation.dateDemarrage?.span)
  row(
    'Durée de mission',
    interpretation.dureeMission?.value ?? null,
    interpretation.dureeMission?.span,
  )
  row(
    'Contexte technique',
    interpretation.contexteTechnique?.value ?? null,
    interpretation.contexteTechnique?.span,
  )

  for (const p of interpretation.profilsRecherches) item(formatProfil(p.value), p.span)
  for (const o of interpretation.objections) item(formatObjection(o.value), o.span)
  for (const e of interpretation.prochainesEtapes) item(formatEtape(e.value), e.span)

  return out
}
