/**
 * The review gate, as pure rules (DEC-4, DEC-18, DEC-20, DEC-21, DEC-23).
 *
 * Everything the gate decides lives here: whether it may open at all, what the
 * form is pre-filled with, which rows wear `⚠ faible`, and what one *Valider*
 * fans out into. No Electron, no store, no network — the IPC handler in
 * `app/ipc/register.ts` reads the log, calls these, and writes the events.
 *
 * ## Why `availability` is a function and not an `if` in the handler
 *
 * DEC-23 says nothing from the gate may surface while the meeting is
 * `recording` — not the panel, not a notification, not a badge. A rule written
 * inline in a handler is a rule the next handler forgets. Written here it is
 * one exported function with one test, and the response type it feeds
 * (`ReviewSnapshot`) has no panel to leak when it says closed.
 *
 * ## Why the intents are drafted from `ReviewEdits`, not from `ExtractionESN`
 *
 * The rep's correction is the value that ships. Drafting from the extraction
 * and then patching it would leave the model's original reachable, and the one
 * thing this screen exists to guarantee is that what the rep read is what the
 * CRM receives.
 */
import type { MeetingState } from '../contracts/meeting.ts'
import type { Attendee } from '../contracts/meeting.ts'
import type {
  Confidence,
  DeterministicFacts,
  ExtractionESN,
  ModeCollaboration,
  VerificationReport,
} from '../contracts/extraction.ts'
import type {
  ReviewEdits,
  ReviewField,
  ReviewFieldKey,
  ReviewIntent,
} from '../contracts/review.ts'
import { DEFAULT_RECIPE, isFreeForm, recipeById, type RecipeId } from '../contracts/recipes.ts'
import type { PushIntent, PushIntentKind } from '../contracts/push.ts'
import type { TranscriptSpan } from '../contracts/transcript.ts'

// ── DEC-23: when the gate may open ──────────────────────────────────────────

/**
 * The only state in which the gate exists.
 *
 * Not a list. `awaiting_confirmation` is where `Enhancement` leaves a meeting
 * whose compte-rendu is ready, `pushing` and `done` are past the gate, and
 * everything before it has nothing to show. Widening this is how a panel starts
 * appearing mid-call.
 */
export const REVIEW_STATE: MeetingState = 'awaiting_confirmation'

export type ReviewAvailability = { open: true } | { open: false; reason: string }

/**
 * Why the gate is closed, in French, for every state that is not the gate.
 *
 * `recording` is the one that matters and it is deliberately bland: the rep is
 * on a call and the string exists for a screen they should not be looking at.
 */
const CLOSED_REASON: Record<MeetingState, string> = {
  idle: 'La réunion n’a pas encore démarré.',
  armed: 'La réunion n’a pas encore démarré.',
  recording: 'Réunion en cours.',
  ended: 'Compte-rendu en attente d’analyse.',
  extracting: 'Analyse en cours…',
  awaiting_confirmation: '',
  pushing: 'Envoi en cours…',
  done: 'Déjà validée.',
  aborted: 'Réunion abandonnée.',
}

export const reviewAvailability = (state: MeetingState): ReviewAvailability =>
  state === REVIEW_STATE ? { open: true } : { open: false, reason: CLOSED_REASON[state] }

// ── DEC-21: the measured markers ────────────────────────────────────────────

/**
 * The path `groundReply` writes into `VerificationReport.fields` for each row of
 * the form. Arrays are verified per item (`objections.0`), so the row's verdict
 * is the worst of its items — one unverifiable objection among four is still a
 * row the rep should check.
 */
const VERIFIED_PATHS: Record<ReviewFieldKey, string | null> = {
  taskName: null,
  account: null,
  besoin: 'besoin',
  profils: 'profilsRecherches',
  modeCollaboration: 'modeCollaboration',
  tjm: 'tjmEvoque',
  dateDemarrage: 'dateDemarrage',
  dureeMission: 'dureeMission',
  contexteTechnique: 'contexteTechnique',
  objections: 'objections',
  prochainesEtapes: 'prochainesEtapes',
}

const LABELS: Record<ReviewFieldKey, string> = {
  taskName: 'Objet',
  account: 'Client',
  besoin: 'Besoin',
  profils: 'Profils',
  modeCollaboration: 'Mode',
  tjm: 'TJM',
  dateDemarrage: 'Démarrage',
  dureeMission: 'Durée',
  contexteTechnique: 'Contexte technique',
  objections: 'Objections',
  prochainesEtapes: 'Prochaines étapes',
}

/**
 * The verdict for one row, read off the report and nowhere else.
 *
 * A path with no entry is a field the model did not produce — `tjmEvoque` when
 * no TJM was mentioned, an empty `objections` list. That is `ok`: there is
 * nothing to be unsure about. A path present and `faible` is a quote the app
 * looked for in the stored transcript and did not find.
 */
export const fieldConfidence = (
  report: VerificationReport,
  path: string | null,
): Confidence => {
  if (path === null) return 'ok'
  const exact = report.fields[path]
  if (exact !== undefined) return exact
  const prefix = `${path}.`
  for (const [key, confidence] of Object.entries(report.fields)) {
    if (key.startsWith(prefix) && confidence === 'faible') return 'faible'
  }
  return 'ok'
}

/**
 * The account's marker (DEC-18, DEC-21).
 *
 * Both sources are measurements and neither is the model's: the report entry is
 * written by span verification, and `facts.account.confidence` by entity
 * resolution against the CRM. `LlmInterpretation` has no field for an account
 * at all (DEC-7), so there is no third source this could accidentally read.
 */
export const accountConfidence = (
  facts: DeterministicFacts,
  report: VerificationReport,
): Confidence =>
  report.fields.account === 'faible' || facts.account.confidence === 'faible' ? 'faible' : 'ok'

// ── The form ────────────────────────────────────────────────────────────────

const MODE_LABEL: Record<ModeCollaboration, string> = {
  régie: 'régie',
  forfait: 'forfait',
  'assistance technique': 'assistance technique',
  inconnu: 'non précisé',
}

/**
 * Rendered for a form field, not for the compte-rendu.
 *
 * `modules/extract/compteRendu.ts` formats the same values into markdown with
 * bullets, bold labels and `⚠ faible` suffixes. That is a document; this is a
 * textarea the rep edits and whose text lands in an opportunity description.
 * Sharing one formatter would mean one of the two rendering the other's
 * punctuation.
 */
const formatProfil = (profil: {
  intitule: string
  seniorite: string
  stack: readonly string[]
  nombre: number
}): string => {
  const stack = profil.stack.filter((s) => s.trim() !== '')
  const head = `${profil.nombre} × ${profil.intitule.trim()}`
  const seniorite = profil.seniorite.trim()
  const base = seniorite === '' ? head : `${head} — ${seniorite}`
  return stack.length === 0 ? base : `${base} (${stack.join(', ')})`
}

const formatTjm = (tjm: { montant: number; devise: string; fourchette: string | null }): string => {
  const devise = tjm.devise.trim().toUpperCase() === 'EUR' ? '€' : tjm.devise.trim()
  const montant = new Intl.NumberFormat('fr-FR').format(tjm.montant)
  const base = devise === '' ? montant : `${montant} ${devise}`
  const fourchette = tjm.fourchette?.trim() ?? ''
  return fourchette === '' ? base : `${base} (fourchette ${fourchette})`
}

const formatObjection = (objection: { objection: string; reponseApportee: string | null }): string => {
  const reponse = objection.reponseApportee?.trim() ?? ''
  return reponse === ''
    ? objection.objection.trim()
    : `${objection.objection.trim()} — réponse : ${reponse}`
}

const formatEtape = (etape: {
  action: string
  responsable: string
  echeance: string
}): string =>
  [etape.action.trim(), etape.responsable.trim(), etape.echeance.trim()]
    .filter((part) => part !== '')
    .join(' — ')

const lines = (values: readonly string[]): string => values.join('\n')

/** Recipients of the relance, from Graph. Never typed, never inferred (DEC-7). */
export const mailRecipients = (interlocuteurs: readonly Attendee[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const attendee of interlocuteurs) {
    const email = attendee.email.trim()
    if (email === '') continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }
  return out
}

const firstNames = (interlocuteurs: readonly Attendee[]): string => {
  const names = interlocuteurs
    .map((a) => a.name.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name !== '')
  return names.length === 0 ? 'Bonjour,' : `Bonjour ${names.join(', ')},`
}

/**
 * The relance, as a draft the rep edits before it is created in Outlook.
 *
 * Written in code rather than asked of the model on purpose: it is a fixed
 * courtesy shape around values that already exist, and a second generation pass
 * would be a second thing that can hallucinate a next step nobody agreed to.
 */
export const draftRelance = (
  extraction: ExtractionESN,
): { subject: string; body: string } => {
  const { facts, interpretation } = extraction
  const etapes = interpretation.prochainesEtapes.map((e) => `— ${formatEtape(e.value)}`)

  /*
   * The synthesis is the typed slate, so a recipe without one has no synthesis
   * to write (DEC-43).
   *
   * The alternative was to paste the compte-rendu into the mail. It is refused
   * for two reasons: the document carries the account, the date and the
   * attendees in its header, which is a mail to a client restating their own
   * details back at them; and it is what the *CRM task* is for, which the rep
   * has not yet reviewed at the moment this draft is composed. So a free-form
   * meeting produces the courtesy shell and nothing invented — the rep writes
   * the middle, in the textarea, on the screen where they are already reading
   * the compte-rendu.
   */
  const synthese = isFreeForm(interpretation.recipe)
    ? ['Merci pour cet échange.']
    : [
        'Merci pour cet échange. Je vous fais un point de synthèse :',
        '',
        interpretation.besoin === null
          ? null
          : `— Besoin : ${interpretation.besoin.value.trim()}`,
        interpretation.profilsRecherches.length > 0
          ? `— Profils : ${interpretation.profilsRecherches.map((p) => formatProfil(p.value)).join(' ; ')}`
          : null,
        interpretation.dateDemarrage === null
          ? null
          : `— Démarrage envisagé : ${interpretation.dateDemarrage.value.trim()}`,
      ]

  const body = [
    firstNames(facts.interlocuteurs),
    '',
    ...synthese,
    etapes.length > 0 ? '' : null,
    etapes.length > 0 ? 'Prochaines étapes :' : null,
    ...(etapes.length > 0 ? etapes : []),
    '',
    'Je reste à votre disposition.',
    '',
    'Bien à vous,',
  ].filter((line): line is string => line !== null)

  // The objet is appended only when there is one. « Suite à notre échange — »
  // with nothing after the dash is a subject line the rep would have to notice
  // and delete, on a draft they are about to send to a client.
  const objet = facts.taskName.trim()
  const subject = objet === '' ? 'Suite à notre échange' : `Suite à notre échange — ${objet}`
  return { subject, body: lines(body) }
}

/**
 * The pre-filled form (DEC-21: every field is always filled).
 *
 * `compteRendu` is passed in rather than re-rendered here because rendering it
 * belongs to `modules/extract` — this file would otherwise own a second copy of
 * the one fixed recipe (DEC-13).
 */
export const prefillEdits = (extraction: ExtractionESN, compteRendu: string): ReviewEdits => {
  const { facts, interpretation } = extraction
  const relance = draftRelance(extraction)

  return {
    taskName: facts.taskName,
    accountId: facts.account.accountId,
    // Whatever entity resolution found, including nothing. `UNRESOLVED_ACCOUNT`
    // is `''` + `faible` (DEC-18 as amended), and it stays `''` all the way to
    // the field: no substitution here, and none on the way back out. `⚠ faible`
    // on the row is what tells the rep it is unresolved; a sentence sitting in
    // the input would say it while looking like an answer.
    accountName: facts.account.name,
    compteRendu,
    /*
     * Empty for every field the recipe did not ask for.
     *
     * `ReviewEdits` keeps all nine keys whatever the recipe, and that is
     * deliberate: it is the shape `review:confirm` takes back and the shape the
     * VSA payload is folded from, and a partial one would put an `undefined`
     * where a column expects a string. What decides whether the rep ever *sees*
     * one is `reviewFields` above — the free recipe draws no row for them, so
     * these blanks are never rendered and never editable.
     */
    besoin: interpretation.besoin?.value.trim() ?? '',
    profils: lines(interpretation.profilsRecherches.map((p) => formatProfil(p.value))),
    modeCollaboration:
      interpretation.modeCollaboration === null
        ? ''
        : MODE_LABEL[interpretation.modeCollaboration.value],
    tjm: interpretation.tjmEvoque === null ? '' : formatTjm(interpretation.tjmEvoque.value),
    dateDemarrage: interpretation.dateDemarrage?.value.trim() ?? '',
    dureeMission: interpretation.dureeMission?.value.trim() ?? '',
    contexteTechnique: interpretation.contexteTechnique?.value.trim() ?? '',
    objections: lines(interpretation.objections.map((o) => formatObjection(o.value))),
    prochainesEtapes: lines(interpretation.prochainesEtapes.map((e) => formatEtape(e.value))),
    montant: interpretation.tjmEvoque?.value.montant ?? null,
    devise: interpretation.tjmEvoque?.value.devise ?? 'EUR',
    mailSubject: relance.subject,
    mailBody: relance.body,
  }
}

/**
 * The span behind each row — what `[source ▸]` reveals (DEC-21).
 *
 * An array field cites its first item: the affordance answers "where did this
 * come from", and the first citation is the one the rep can check fastest. The
 * full per-item spans stay in the log for Historique (DEC-25).
 */
const spanOf = (extraction: ExtractionESN, key: ReviewFieldKey): TranscriptSpan | null => {
  const i = extraction.interpretation
  switch (key) {
    case 'besoin':
      return i.besoin?.span ?? null
    case 'profils':
      return i.profilsRecherches[0]?.span ?? null
    case 'modeCollaboration':
      return i.modeCollaboration?.span ?? null
    case 'tjm':
      return i.tjmEvoque?.span ?? null
    case 'dateDemarrage':
      return i.dateDemarrage?.span ?? null
    case 'dureeMission':
      return i.dureeMission?.span ?? null
    case 'contexteTechnique':
      return i.contexteTechnique?.span ?? null
    case 'objections':
      return i.objections[0]?.span ?? null
    case 'prochainesEtapes':
      return i.prochainesEtapes[0]?.span ?? null
    default:
      // `taskName` and `account` come from Graph and the CRM. There is no
      // transcript span because nobody read them off the call (DEC-7).
      return null
  }
}

/**
 * The two rows every recipe draws, and they are the two that are not the
 * model's: the objet and the account both come from Graph and the CRM (DEC-7).
 * VerySwing needs a name for the task whatever shape the document took, and the
 * account is what the task is filed against.
 */
const DETERMINISTIC_ROWS: readonly ReviewFieldKey[] = ['taskName', 'account']

/**
 * Which interpretive row shows each of the recipe's declared fields.
 *
 * The inverse of `VERIFIED_PATHS`, written out rather than derived from it,
 * because a `find` over that record would silently return the first row whose
 * path matches and there is no compiler check that the mapping is total either
 * way. Two short lists that a reader can hold side by side beat one clever one.
 */
const ROW_FOR_FIELD: Record<string, ReviewFieldKey> = {
  besoin: 'besoin',
  profilsRecherches: 'profils',
  modeCollaboration: 'modeCollaboration',
  tjmEvoque: 'tjm',
  dateDemarrage: 'dateDemarrage',
  dureeMission: 'dureeMission',
  contexteTechnique: 'contexteTechnique',
  objections: 'objections',
  prochainesEtapes: 'prochainesEtapes',
}

/**
 * The form's rows, for a recipe (DEC-43).
 *
 * A free recipe returns the two deterministic rows and stops. That is the gate
 * keeping the recipe's promise: « pas de champ à remplir » has to mean the gate
 * does not show nine empty boxes with a *Valider* under them, or the rep learns
 * that the app asks for things it does not have — and an empty box on this
 * screen is an invitation to type an answer nobody said out loud, which is the
 * failure DEC-21 exists to prevent.
 */
export const reviewFieldKeys = (recipe: RecipeId = DEFAULT_RECIPE): readonly ReviewFieldKey[] => [
  ...DETERMINISTIC_ROWS,
  ...recipeById(recipe)
    .fields.map((field) => ROW_FOR_FIELD[field])
    .filter((key): key is ReviewFieldKey => key !== undefined),
]

/** Every row the ESN recipe draws. Kept for the callers that mean « all of them ». */
export const REVIEW_FIELD_KEYS: readonly ReviewFieldKey[] = reviewFieldKeys('besoin-commercial')

export const reviewFields = (
  extraction: ExtractionESN,
  report: VerificationReport,
): ReviewField[] =>
  // The recipe that *produced* this extraction, not the one the meeting is set
  // to produce next. A rep who switched templates after generating still sees
  // the rows belonging to the document in front of them.
  reviewFieldKeys(extraction.interpretation.recipe).map((key) => ({
    key,
    label: LABELS[key],
    confidence:
      key === 'account'
        ? accountConfidence(extraction.facts, report)
        : fieldConfidence(report, VERIFIED_PATHS[key]),
    span: spanOf(extraction, key),
  }))

// ── DEC-20: one button, up to three intents ─────────────────────────────────

/**
 * Deterministic and readable. The renderer sends back the ids it was given, so
 * they have to survive a round trip; a `randomUUID` would make "which intent
 * did the rep uncheck" answerable only by position.
 */
export const intentIdFor = (meetingId: string, kind: PushIntentKind): string =>
  `${meetingId}:${kind}`

/** Display and creation order. Drain order is the DAG's job, not this list's. */
export const INTENT_ORDER: readonly PushIntentKind[] = [
  'crm.task',
  'crm.opportunity',
  'mail.draft',
]

/**
 * Exported because Historique labels the same three things (DEC-25), and the
 * gate's wording is what the rep agreed to — a second table would eventually
 * call the same push something else in the record of it.
 */
export const INTENT_LABEL: Record<PushIntentKind, string> = {
  'crm.task': 'Tâche compte-rendu (VerySwing)',
  'crm.opportunity': 'Opportunité (VerySwing)',
  'mail.draft': 'Brouillon de relance (Outlook)',
}

/**
 * VSA needs a `closingDate` on every opportunity and a meeting produces none.
 * A horizon is a business default the rep adjusts in VSA; a date read off
 * « démarrage septembre » would be a precision nobody said out loud (DEC-7).
 */
export const OPPORTUNITY_HORIZON_DAYS = 30
const DAY_MS = 86_400_000

export interface DraftedIntent {
  view: ReviewIntent
  /** Null when the intent cannot be drafted, or when the rep unchecked it. */
  intent: PushIntent | null
}

export interface DraftIntentsInput {
  meetingId: string
  facts: DeterministicFacts
  edits: ReviewEdits
  mailTo: readonly string[]
  /**
   * Which recipe produced the document being confirmed. Defaults to the ESN one,
   * so a caller written before DEC-43 drafts exactly what it always drafted.
   */
  recipe?: RecipeId
  /**
   * The intent ids the rep left checked. Everything not in here is drafted,
   * shown, and **not created** — unchecking is recorded, never inferred from an
   * absent row.
   */
  checked: readonly string[]
}

const truncate = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/**
 * Every intent the gate can ship, with what the rep is agreeing to.
 *
 * The opportunity is skipped — not silently, but as a row saying why — when the
 * account is unresolved (DEC-20: never create an opportunity against an
 * unresolved account). Unchecking it moves the task off `dependsOn`, which is
 * the "falls back to `linkType: COMPANY`" case; the adapter reads it from the
 * absent `opportunityRef`, so no CRM vocabulary reaches this file (DEC-29).
 */
export const draftIntents = (input: DraftIntentsInput): DraftedIntent[] => {
  const { meetingId, facts, edits, mailTo } = input
  const checked = new Set(input.checked)

  /*
   * VSA has no task and no opportunity without a name, and nothing upstream
   * invents one any more: a meeting started by hand has no subject until the rep
   * gives it one, and `buildFacts` now leaves `taskName` empty rather than
   * writing « Rendez-vous client » into it. So the requirement is stated on the
   * row instead of being papered over — which is the DEC-26 shape every other
   * unavailable intent on this screen already has, and it costs the rep one word
   * in a field that is on screen, next to the reason.
   */
  const taskName = edits.taskName.trim()
  const taskPossible = taskName !== ''
  const NO_TASK_NAME = 'Donnez un objet à la réunion — VerySwing n’accepte pas une tâche sans nom.'

  /*
   * A free-form compte-rendu drafts no opportunity (DEC-43).
   *
   * Every descriptive column of `OpportunityPayload` — description, contexte,
   * environnement technique, profils — is fed by a typed field this recipe does
   * not extract, and `amount` comes from the TJM. What would ship is an
   * opportunity named after the meeting, worth 0 €, with four empty columns and
   * a closing date thirty days out: a row in the client's pipeline that says
   * something false about a deal, created because a checkbox was checked by
   * default. The row is drawn and disabled with the reason on it (DEC-26), so
   * the rep sees the trade rather than discovering it in VSA — and the way to
   * get one is to switch the meeting to the ESN recipe and regenerate.
   */
  const recipe = input.recipe ?? DEFAULT_RECIPE
  const typedFields = !isFreeForm(recipe)
  const NO_TYPED_FIELDS =
    'Un compte-rendu libre n’extrait aucun champ typé — pas de besoin, pas de TJM, pas de profils à mettre dans une opportunité.'

  const opportunityId = intentIdFor(meetingId, 'crm.opportunity')
  const opportunityPossible = typedFields && edits.accountId !== null && taskPossible
  const opportunityChecked = opportunityPossible && checked.has(opportunityId)
  const mailPossible = mailTo.length > 0

  const description = [
    edits.besoin,
    edits.profils,
    edits.modeCollaboration === '' ? '' : `Mode : ${edits.modeCollaboration}`,
    edits.tjm === '' ? '' : `TJM : ${edits.tjm}`,
    edits.dureeMission === '' ? '' : `Durée : ${edits.dureeMission}`,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n')

  const drafted: DraftedIntent[] = []

  for (const kind of INTENT_ORDER) {
    const id = intentIdFor(meetingId, kind)

    if (kind === 'crm.task') {
      const dependsOn = opportunityChecked ? [opportunityId] : []
      drafted.push({
        view: {
          id,
          kind,
          label: INTENT_LABEL[kind],
          // Joined only on the parts that exist. « — » alone, or a dash with
          // nothing after it, is the placeholder problem one layer down.
          summary:
            [taskName, edits.accountName.trim()].filter((part) => part !== '').join(' — ') ||
            'Sans objet',
          available: taskPossible,
          reason: taskPossible ? null : NO_TASK_NAME,
        },
        intent: checked.has(id) && taskPossible
          ? {
              id,
              meetingId,
              kind: 'crm.task',
              dependsOn,
              payload: {
                title: edits.taskName,
                body: edits.compteRendu,
                accountId: edits.accountId,
                // The intent id, not a remote id — the opportunity has not been
                // created yet. `app/session/Outbox.ts` substitutes the id the
                // CRM returns when the dependency drains (step 8).
                opportunityRef: opportunityChecked ? opportunityId : null,
                contactIds: [...facts.knownContactIds],
                dueAt: facts.endsAt,
                endsAt: facts.endsAt,
              },
            }
          : null,
      })
      continue
    }

    if (kind === 'crm.opportunity') {
      drafted.push({
        view: {
          id,
          kind,
          label: INTENT_LABEL[kind],
          summary: opportunityPossible
            ? truncate(`${taskName} — ${edits.besoin}`, 120)
            : 'Indisponible',
          available: opportunityPossible,
          // The recipe is named first because it is the only one of the three
          // that is a *choice* rather than a missing value — a rep told to
          // resolve an account will go looking for one that was never going to
          // make this row available.
          reason: !typedFields
            ? NO_TYPED_FIELDS
            : edits.accountId === null
              ? 'Compte non résolu — une opportunité ne peut pas être créée sans client identifié.'
              : taskPossible
                ? null
                : NO_TASK_NAME,
        },
        intent:
          opportunityChecked && edits.accountId !== null
            ? {
                id,
                meetingId,
                kind: 'crm.opportunity',
                dependsOn: [],
                payload: {
                  title: edits.taskName,
                  description,
                  accountId: edits.accountId,
                  amount: edits.montant ?? 0,
                  currency: edits.devise === '' ? 'EUR' : edits.devise,
                  closingDate: facts.endsAt + OPPORTUNITY_HORIZON_DAYS * DAY_MS,
                  contextDescription: edits.besoin,
                  technicalEnvDescription: edits.contexteTechnique,
                  profileDescription: edits.profils,
                  startingDate: null,
                },
              }
            : null,
      })
      continue
    }

    drafted.push({
      view: {
        id,
        kind,
        label: INTENT_LABEL[kind],
        summary: mailPossible ? `${edits.mailSubject} → ${mailTo.join(', ')}` : 'Indisponible',
        available: mailPossible,
        reason: mailPossible ? null : 'Aucun destinataire au calendrier.',
      },
      // A draft, never a send (HR-8). `modules/mail` posts to
      // `/me/messages`, which creates a draft in the rep's mailbox.
      intent:
        mailPossible && checked.has(id)
          ? {
              id,
              meetingId,
              kind: 'mail.draft',
              dependsOn: [],
              payload: { subject: edits.mailSubject, body: edits.mailBody, to: [...mailTo] },
            }
          : null,
    })
  }

  return drafted
}

/** Everything that can be drafted right now — the default checked set. */
export const defaultChecked = (drafted: readonly DraftedIntent[]): string[] =>
  drafted.filter((d) => d.view.available).map((d) => d.view.id)
