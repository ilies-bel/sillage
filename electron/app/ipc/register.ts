/**
 * Every IPC handler, derived from `core/contracts/ipc.ts`.
 *
 * The loop at the bottom is the whole registration mechanism: each channel's
 * request is parsed and each response is parsed on the way out, so a payload
 * that does not match the contract fails at the boundary instead of three
 * layers in. Adding a channel is one entry in the contract and one handler
 * here.
 *
 * `ipcMain` is injected rather than imported. That keeps this file free of
 * Electron, which is what makes the routing testable without a browser.
 */
import { randomUUID } from 'node:crypto'
import { invokeChannels, type InvokeChannel } from '../../core/contracts/ipc.ts'
import type { InvokeRequest, InvokeResponse } from '../../core/contracts/ipc.ts'
import type { DiagRecorder, RetentionPolicy } from '../../core/contracts/diagnostics.ts'
import { DEFAULT_RETENTION } from '../../core/contracts/diagnostics.ts'
import type { AuthState, IdentityPort } from '../../core/contracts/identity.ts'
import type { PushIntent } from '../../core/contracts/push.ts'
import type { CapabilityReport } from '../../core/contracts/crm.ts'
import type { ConnectorId } from '../../core/contracts/health.ts'
import type { Meeting } from '../../core/contracts/meeting.ts'
import type { HistoryIntent, HistoryRow } from '../../core/contracts/history.ts'
import type { ProviderSection } from '../../core/contracts/settings.ts'
import type { ModelSection } from '../../core/contracts/models.ts'
import type { BootState } from '../../core/contracts/boot.ts'
import type { EnhancementStatus } from '../../core/contracts/extraction.ts'
import {
  INTENT_LABEL,
  defaultChecked,
  draftIntents,
  mailRecipients,
  prefillEdits,
  reviewAvailability,
  reviewFields,
} from '../../core/domain/reviewGate.ts'
import { documentToText } from '../../core/domain/documentText.ts'
import {
  isSearching,
  matchesFor,
  passesFilter,
  withFilterDefaults,
} from '../../core/domain/historySearch.ts'
import { renderCompteRendu } from '../../modules/extract/index.ts'
import type { Store } from '../../modules/store/index.ts'
import type { Diagnostics } from '../../modules/diagnostics/index.ts'
import type { Orchestrator } from '../session/Orchestrator.ts'
import type { Agenda } from '../session/Agenda.ts'

/** The three tables Réglages draws, recomputed on every read (DEC-34). */
export interface ProviderTables {
  stt: ProviderSection
  llm: ProviderSection
  models: ModelSection
}

/**
 * Writing a credential, and nothing else.
 *
 * There is deliberately no `get`. Once a key reaches the vault the only thing
 * that reads it is the module about to make a request with it; an IPC-reachable
 * getter would be a channel whose entire purpose is to hand a secret to a
 * renderer, and the renderer has no use for one.
 */
export interface CredentialStore {
  set(providerId: string, value: string): Promise<void>
  clear(providerId: string): Promise<void>
}

/** What the rep chose, as opposed to what the registry would have ranked. */
export interface ProviderPreferences {
  selectProvider(capability: 'stt' | 'llm', providerId: string | null): Promise<void>
  selectModel(modelId: string): Promise<void>
  /** A provider's declared non-secret setting. Empty clears it (DEC-34). */
  setField(providerId: string, key: string, value: string): Promise<void>
}

/** Hugging Face downloads (DEC-35b), owned by `app/` and broadcast from there. */
export interface ModelDownloads {
  start(modelId: string): Promise<void>
  cancel(modelId: string): Promise<void>
  section(): ModelSection
}

export interface IpcDeps {
  store: Store
  orchestrator: Orchestrator
  diagnostics: Diagnostics
  recorder: DiagRecorder
  /** Where `diagnostics:export` writes its bundle. */
  exportDirectory: string
  /**
   * Both null until an Entra app registration exists (`modules/identity/config.ts`).
   * The channels still answer — signed out, empty agenda — because a renderer
   * that throws on a missing connector is the dead button DEC-26 forbids.
   */
  identity?: IdentityPort | null
  agenda?: Agenda | null
  /** Injected so `confirmation.recorded.at` is reproducible in a test. */
  clock?: () => number
  /**
   * Starts draining a meeting's outbox. Injected as a function rather than as
   * the `Outbox` itself, because the caller in `main.ts` also maps the drain's
   * failures onto `ConnectorHealth` — and that mapping is wiring, not routing.
   *
   * Never awaited by the confirm handler: the rep pressed one button and is
   * owed an answer immediately (DEC-4). Failures go to the outbox and retry
   * silently; the health strip is where they surface.
   */
  drain?: (meetingId: string) => void
  /**
   * The two provider tables Réglages renders, and the model table beside them.
   *
   * A **function**, not a value, and that changed with DEC-34. It used to be a
   * snapshot taken once at boot, on the reasoning that a key cannot appear
   * without a restart — which stopped being true the moment Réglages could
   * store one. A value here would mean the screen that just saved a key still
   * rendered the table from before it, and the rep would conclude the save had
   * failed.
   *
   * Still resolved outside this file: *which* provider is usable is a question
   * about a credential store and bytes on disk, and answering it inside a
   * handler would put that I/O in the routing layer.
   */
  providers?: (() => ProviderTables) | null
  /** Where a meeting's compte-rendu has got to. Composed in `main.ts`. */
  enhancementStatus?: (meetingId: string) => EnhancementStatus
  /** Run the recipe for a meeting that has ended without one. */
  runEnhancement?: (meetingId: string) => Promise<void>
  /**
   * Something in Réglages changed — a model may have just become available.
   *
   * Called by every settings write rather than by the one that "looks like" it
   * configures a model, because there is no such single write: a key, a
   * provider selection, a model selection and a base-URL field can each be the
   * last piece that makes a provider usable, and picking a subset here means a
   * rep completing their setup through the other one gets a promise the app
   * silently does not keep.
   */
  onSettingsChanged?: () => void
  /**
   * Storing and forgetting provider credentials (DEC-34).
   *
   * Absent in a test that does not exercise the settings screen, and absent
   * before the vault is reachable — the channels then refuse with a stated
   * reason rather than throwing, because a dead *Enregistrer* button that
   * explains itself is recoverable and one that rejects is not.
   */
  credentials?: CredentialStore | null
  /**
   * The rep's explicit provider and model choices (DEC-34, DEC-35).
   *
   * Separate from `providers` because reading and writing are different
   * lifetimes: the tables are recomputed on every read, the choice is persisted
   * and outlives the process.
   */
  preferences?: ProviderPreferences | null
  /** Starting, cancelling and reporting Hugging Face downloads (DEC-35b). */
  models?: ModelDownloads | null
  /**
   * The DEC-24 capability diff, or why there is none. Read lazily so a probe
   * that is still in flight at boot shows as "en cours" rather than as absent.
   */
  capabilities?: () => { report: CapabilityReport | null; reason: string | null }
  retention?: RetentionPolicy
  /**
   * What screen 0 reports (DEC-30). Read lazily rather than passed by value:
   * `boot()` publishes it once at startup and again if a step ever moves, and
   * a snapshot captured at registration time would freeze the first of those.
   */
  bootState?: () => BootState
}

const SIGNED_OUT: AuthState = { status: 'signedOut' }

/**
 * There is no Entra app registration, so there is nothing to sign in to.
 *
 * Written for a rep and not for whoever configures the app: it names no
 * environment variable, and it says what the rep loses rather than what an
 * administrator has failed to do. It travels to the renderer as
 * `AuthState.reason` and disables *Se connecter* with itself beside it, because
 * a live button here can only throw (see the `auth:signIn` handler below).
 */
const NO_REGISTRATION =
  'Aucune application Microsoft n’est configurée — le calendrier et les brouillons Outlook restent indisponibles.'

const authState = (identity: IdentityPort | null | undefined): AuthState => {
  if (!identity) return { status: 'signedOut', reason: NO_REGISTRATION }
  const account = identity.account()
  return account ? { status: 'signedIn', account } : SIGNED_OUT
}

const EMPTY_AGENDA = { events: [], syncedAt: 0, armed: null, reason: 'Aucun calendrier connecté' }

type Handler<C extends InvokeChannel> = (
  request: InvokeRequest<C>,
  deps: IpcDeps,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>

type Handlers = { [C in InvokeChannel]: Handler<C> }

/**
 * A meeting the rep started by hand has no Graph id to be derived from, so the
 * id is minted here. Prefixed `man-` to sit beside `Agenda.ts`'s `evt-` ones,
 * which makes "where did this session come from" answerable from the id alone
 * in a diagnostics bundle, months later, with no calendar to check against.
 */
const manualMeetingId = (now: number): string =>
  `man-${now.toString(36)}-${randomUUID().slice(0, 8)}`

// ── Historique (DEC-25) ─────────────────────────────────────────────────────

/**
 * How many meetings a search reads before it stops.
 *
 * Every call ever captured is the promise (DEC-25) and a laptop's worth of them
 * is a few hundred, so this is a guard against a pathological log rather than a
 * page size. It is separate from the request's `limit`, which caps *rows
 * returned*: scanning fifty and returning fifty would mean a match on the
 * fifty-first call was unfindable, which is the one thing search may not do.
 */
const SEARCH_SCAN_LIMIT = 500

/** French, and never the machine's own vocabulary. */
const STATE_LABEL: Record<Meeting['state'], string> = {
  idle: 'En attente',
  armed: 'Prêt',
  recording: 'En cours',
  ended: 'Terminée',
  extracting: 'Analyse…',
  awaiting_confirmation: 'À valider',
  pushing: 'Envoi…',
  done: 'Validée',
  aborted: 'Abandonnée',
}

/**
 * What became of each intent, from the outbox projection.
 *
 * Read off the projection rather than the intent payloads: the payload says
 * what was *meant* to be sent, the row says what happened — including the
 * remote id, which is the only proof it landed, and the last error, which is
 * the sentence a rep needs when it did not.
 */
const historyIntents = (store: Store, meetingId: string): HistoryIntent[] =>
  store.projections.outboxFor(meetingId).map((entry) => ({
    intentId: entry.intentId,
    kind: entry.kind,
    label: INTENT_LABEL[entry.kind],
    state: entry.state,
    attempts: entry.attempts,
    lastError: entry.lastError,
    remoteId: entry.remoteId,
  }))

/** The compte-rendu as the review gate rendered it, or null before the gate. */
const compteRenduOf = (store: Store, meetingId: string): string | null => {
  const stored = store.projections.extraction(meetingId)
  return stored ? renderCompteRendu(stored.extraction, stored.verification) : null
}

/**
 * The three searchable surfaces of one call, folded from its log.
 *
 * The transcript is joined with newlines rather than spaces so an excerpt never
 * silently welds the end of one speaker's sentence to the start of another's.
 */
const searchableRecord = (store: Store, meetingId: string) => ({
  transcript: store.projections
    .segments(meetingId)
    .map((segment) => segment.text)
    .join('\n'),
  notes: documentToText(store.projections.document(meetingId)?.doc ?? null),
  compteRendu: compteRenduOf(store, meetingId) ?? '',
})

/**
 * How many client names the chips offer.
 *
 * The scanned meetings arrive newest-updated first, so this is « the clients
 * this rep has been working with », which is what a chip row is for. A rep
 * looking for a client further back than that types the name — the box beside
 * the chips searches the same corpus and is not capped by anything but `limit`.
 */
const CLIENT_FACET_LIMIT = 12

/** Distinct client names, in the order they were scanned. Never sorted by name. */
const clientFacet = (meetings: readonly Meeting[]): string[] => {
  const seen: string[] = []
  for (const meeting of meetings) {
    const name = meeting.clientName
    if (name && !seen.includes(name)) seen.push(name)
    if (seen.length >= CLIENT_FACET_LIMIT) break
  }
  return seen
}

// ── Réglages ────────────────────────────────────────────────────────────────

/** French, and the rep's vocabulary rather than the module's. Same as the strip. */
const CONNECTOR_LABEL: Record<ConnectorId, string> = {
  capture: 'Audio',
  transcribe: 'Transcription',
  calendar: 'Calendrier',
  llm: 'Analyse',
  crm: 'VerySwing',
  mail: 'Outlook',
}

/**
 * What the screen shows when `main.ts` never resolved a registry — which
 * happens in a test harness and on a boot that failed before the providers were
 * asked. An empty table with a reason, never an empty table.
 */
const EMPTY_SECTION: ProviderSection = {
  rows: [],
  selected: null,
  reason: 'aucun fournisseur n’a encore été interrogé',
}

/** The same, for the model table (DEC-35). */
const EMPTY_MODELS: ModelSection = { rows: [], selected: null }

const EMPTY_TABLES: ProviderTables = {
  stt: EMPTY_SECTION,
  llm: EMPTY_SECTION,
  models: EMPTY_MODELS,
}

const tablesOf = (deps: IpcDeps): ProviderTables => deps.providers?.() ?? EMPTY_TABLES

/**
 * What screen 0 shows when `main.ts` never published a boot state — a test
 * harness, or a boot that registered IPC without wiring one.
 *
 * `failed`, not `pending`, and the difference is the whole point: `pending`
 * holds the window shut, so an absent publisher would trap the rep behind a
 * splash that can never finish. This says "nobody told us" and lets the app
 * open, which is the same trade DEC-26 makes everywhere else.
 */
const UNPUBLISHED = 'état de démarrage non publié'
const NO_BOOT_STATE: BootState = {
  store: { state: 'failed', value: UNPUBLISHED },
  devices: { state: 'failed', value: UNPUBLISHED },
  transcription: { state: 'failed', value: UNPUBLISHED },
  version: 'inconnue',
}

export const handlers: Handlers = {
  'meeting:create': ({ title, clientName, scheduledStart }, { store, orchestrator }) => {
    const id = manualMeetingId(Date.now())
    orchestrator.create({
      id,
      // `?? ''` for the same reason the two lines below carry one: the request
      // type is the schema's *input*, where a defaulted field is optional. An
      // untitled meeting is the normal case now, not a fallback.
      title: title ?? '',
      context: null,
      clientName: clientName ?? null,
      // Null means now, which is what the calendar sends for today's cell. Any
      // other day is the rep placing a meeting there deliberately (DEC-31), and
      // it is drawn in that cell rather than in today's.
      scheduledStart: scheduledStart ?? null,
    })
    const meeting = store.projections.getMeeting(id)
    if (!meeting) throw new Error('la réunion n’a pas pu être créée')
    return meeting
  },

  'meeting:list': ({ limit, from, to }, { store }) =>
    store.projections.listMeetings(limit ?? 50, { from: from ?? null, to: to ?? null }),

  /**
   * Through the session, so the rename is an event in the meeting's log like
   * everything else — `Projections` folds it, and a rebuild keeps it.
   */
  'meeting:rename': ({ meetingId, title, clientName }, { store, orchestrator }) => {
    const session = orchestrator.session(meetingId)
    if (!session) throw new Error(`réunion inconnue: ${meetingId}`)
    session.emit({ type: 'meeting.renamed', title, clientName: clientName ?? null })
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw new Error(`réunion inconnue: ${meetingId}`)
    return meeting
  },

  'meeting:get': ({ meetingId }, { store }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw new Error(`réunion inconnue: ${meetingId}`)
    return {
      meeting,
      segments: store.projections.segments(meetingId),
      signals: store.projections.signals(meetingId),
      outbox: store.projections.outboxFor(meetingId),
      document: store.projections.document(meetingId)?.doc ?? null,
      // Null until the extraction has stored one, which is what the session
      // screen keys the compte-rendu pane on — no separate "is it ready" flag to
      // disagree with the thing it describes.
      compteRendu: compteRenduOf(store, meetingId),
      recipe: store.projections.recipe(meetingId),
    }
  },

  /**
   * The header picker (DEC-43). Two things happen and only the first is certain.
   *
   * The choice is recorded as an event whatever the meeting's state — that is
   * what the next run reads, and it is what survives a restart. Then, if this
   * meeting already has a compte-rendu, a regeneration is *started*: fired and
   * not awaited, because it is an LLM call and the rep is holding a click. The
   * new document arrives over `session:changed` like every other extraction, and
   * the notice strip says « Rédaction du compte-rendu… » in the meantime.
   *
   * `regenerating` is what the renderer needs to not lie: the picker has to be
   * able to say « le compte-rendu est en cours de réécriture » rather than
   * leaving the old document on screen with no explanation of why it did not
   * change.
   */
  'meeting:recipe': ({ meetingId, recipe }, { store, orchestrator, runEnhancement }) => {
    const session = orchestrator.session(meetingId)
    if (!session) throw new Error(`réunion inconnue: ${meetingId}`)

    session.emit({ type: 'meeting.recipe.chosen', recipe })

    // The stored extraction, not the state: a meeting in `awaiting_confirmation`
    // has one and a meeting in `ended` may too, and what decides whether there
    // is anything to replace is whether a document exists.
    const existing = store.projections.extraction(meetingId)
    const changed = existing !== null && existing.extraction.interpretation.recipe !== recipe
    if (changed) void runEnhancement?.(meetingId)

    return { recipe, regenerating: changed, state: orchestrator.stateOf(meetingId) }
  },

  'session:command': ({ meetingId, command, reason }, { orchestrator }) => {
    const outcome = orchestrator.dispatch(meetingId, command, reason ?? null)
    return outcome.ok
      ? { ok: true as const, state: outcome.to }
      : { ok: false as const, state: outcome.state, reason: outcome.reason }
  },

  'enhancement:status': ({ meetingId }, { enhancementStatus }) =>
    enhancementStatus?.(meetingId) ?? { status: 'idle' as const },

  /**
   * Awaited, unlike `drain` — the rep pressed *Générer* and the button has to
   * stop saying *Générer*. The answer is the status *after* the attempt, which
   * is the review gate opening, a fresh failure with its reason, or the same
   * notice as before if a provider disappeared between the render and the press.
   */
  'enhancement:retry': async ({ meetingId }, { runEnhancement, enhancementStatus }) => {
    await runEnhancement?.(meetingId)
    return enhancementStatus?.(meetingId) ?? { status: 'idle' as const }
  },

  'document:save': ({ meetingId, revision, doc }, { orchestrator }) => ({
    revision: orchestrator.saveDocument(meetingId, revision, doc),
  }),

  'health:snapshot': (_request, { orchestrator }) => orchestrator.health(),

  'health:retry': ({ connector }, { orchestrator }) => orchestrator.retry(connector),

  'diagnostics:recent': ({ limit }, { diagnostics }) => diagnostics.recent(limit ?? 200),

  'diagnostics:export': ({ mode }, { diagnostics, exportDirectory }) =>
    diagnostics.writeBundle(mode, exportDirectory),

  'auth:state': (_request, { identity }) => authState(identity),

  'auth:signIn': async (_request, { identity, agenda }) => {
    // Unreachable from the product — Réglages disables the control and states
    // `AuthState.reason` beside it. Kept because the channel is public and a
    // rejection is better than a sign-in that silently does nothing.
    if (!identity) throw new Error(NO_REGISTRATION)
    await identity.signIn()
    // A calendar that only appears on the next five-minute tick reads as a
    // sign-in that did not work.
    await agenda?.tick({ force: true })
    return authState(identity)
  },

  'auth:signOut': async (_request, { identity }) => {
    await identity?.signOut()
    // Through `authState`, so a build with no registration keeps saying so
    // rather than answering with the plain signed-out state and re-arming a
    // *Se connecter* that cannot work.
    return authState(identity)
  },

  'agenda:snapshot': (_request, { agenda }) => agenda?.snapshot() ?? EMPTY_AGENDA,

  'agenda:refresh': async (_request, { agenda }) => {
    if (!agenda) return EMPTY_AGENDA
    await agenda.tick({ force: true })
    return agenda.snapshot()
  },

  /**
   * DEC-23 lives in the first four lines of this handler.
   *
   * The state is read from the machine, not from the projection, and a state
   * that is not the gate returns the closed arm of the union — which has no
   * `panel` field to fill in. There is no code path from here to a partially
   * rendered gate during a call.
   */
  'review:get': ({ meetingId }, { store, orchestrator }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw new Error(`réunion inconnue: ${meetingId}`)

    const state = orchestrator.stateOf(meetingId)
    const availability = reviewAvailability(state)
    if (!availability.open) {
      return { open: false as const, state, reason: availability.reason }
    }

    const stored = store.projections.extraction(meetingId)
    if (!stored) {
      // Reachable only if a meeting were moved into the gate without an
      // extraction. Closed rather than thrown: the renderer has to render it.
      return { open: false as const, state, reason: 'Aucun compte-rendu disponible.' }
    }

    const { extraction, verification } = stored
    const compteRendu = renderCompteRendu(extraction, verification)
    const edits = prefillEdits(extraction, compteRendu)
    const mailTo = mailRecipients(extraction.facts.interlocuteurs)

    // Two passes, both pure: the first says which intents can be drafted at
    // all, the second drafts them with everything drafted checked. Nothing is
    // pre-unchecked — DEC-20 drafts all three and lets the rep remove one.
    // The recipe that produced the stored document, on both passes. Reading the
    // meeting's *current* choice here would draft against a recipe whose
    // extraction has not run yet — offering an opportunity built from fields
    // that are not in the document on screen.
    const recipe = extraction.interpretation.recipe
    const probe = draftIntents({
      meetingId,
      facts: extraction.facts,
      edits,
      mailTo,
      recipe,
      checked: [],
    })
    const drafted = draftIntents({
      meetingId,
      facts: extraction.facts,
      edits,
      mailTo,
      recipe,
      checked: defaultChecked(probe),
    })

    return {
      open: true as const,
      panel: {
        meeting,
        edits,
        fields: reviewFields(extraction, verification),
        // Populated by `modules/crm` in step 8 (DEC-18, mitigation *a*).
        accountCandidates: [],
        interlocuteurs: extraction.facts.interlocuteurs,
        mailTo,
        overall: verification.overall,
        intents: drafted.map((d) => d.view),
      },
    }
  },

  /**
   * The one gesture (DEC-4). Order matters here and it is not arbitrary:
   *
   *  1. draft from `edits` — the rep's correction is what ships, never the
   *     model's original;
   *  2. `confirm` through the machine, which accepts it from
   *     `awaiting_confirmation` and nowhere else. Refused → nothing is written;
   *  3. `confirmation.recorded` with the ids, then one `push.intent.created`
   *     per checked intent. The outbox projection is folded from those events,
   *     so an unchecked intent has no row to drain rather than a row somebody
   *     has to remember to skip.
   */
  /**
   * The same draft `review:confirm` will make, without making it.
   *
   * Pure by construction: it reads the stored extraction for `facts` and
   * `mailTo` — both deterministic (DEC-7), neither editable — and returns the
   * views. No event, no dispatch, no drain. That is what lets the renderer call
   * it on every edit without a state machine anywhere near it.
   *
   * An unknown meeting or a missing extraction returns no intents rather than
   * throwing: this runs while the rep is typing, and a rejected promise there
   * would surface as an error banner over a screen that is working fine.
   */
  'review:preview': ({ meetingId, edits, intentIds }, { store }) => {
    const stored = store.projections.extraction(meetingId)
    if (!stored) return { intents: [] }

    const facts = stored.extraction.facts
    return {
      intents: draftIntents({
        meetingId,
        facts,
        edits,
        mailTo: mailRecipients(facts.interlocuteurs),
        recipe: stored.extraction.interpretation.recipe,
        checked: intentIds,
      }).map((d) => d.view),
    }
  },

  'review:confirm': ({ meetingId, edits, intentIds }, { store, orchestrator, clock, drain }) => {
    const session = orchestrator.session(meetingId)
    if (!session) throw new Error(`réunion inconnue: ${meetingId}`)

    const stored = store.projections.extraction(meetingId)
    if (!stored) {
      return {
        ok: false as const,
        state: orchestrator.stateOf(meetingId),
        reason: 'Aucun compte-rendu à valider.',
      }
    }

    const facts = stored.extraction.facts
    const mailTo = mailRecipients(facts.interlocuteurs)
    const intents = draftIntents({
      meetingId,
      facts,
      edits,
      mailTo,
      recipe: stored.extraction.interpretation.recipe,
      checked: intentIds,
    })
      .map((d) => d.intent)
      .filter((intent): intent is PushIntent => intent !== null)

    const outcome = orchestrator.dispatch(meetingId, 'confirm', null)
    if (!outcome.ok) return { ok: false as const, state: outcome.state, reason: outcome.reason }

    // What was created, which is what the rep confirmed. An id the renderer
    // checked but that could not be drafted — an opportunity on an unresolved
    // account — is not recorded as confirmed, because nothing was created for
    // it and the log must not claim otherwise.
    const created = intents.map((intent) => intent.id)
    session.emit({ type: 'confirmation.recorded', intentIds: created, at: (clock ?? Date.now)() })
    for (const intent of intents) session.emit({ type: 'push.intent.created', intent })

    // Fired, not awaited. The rep is never asked a second time and never made
    // to watch a spinner: whatever fails from here retries in the background
    // and shows up in the health strip (DEC-4, DEC-26).
    drain?.(meetingId)

    return { ok: true as const, state: orchestrator.stateOf(meetingId), intentIds: created }
  },

  /**
   * Search and the four filter chips, in the main process (DEC-25, DEC-31).
   *
   * The loop below is the whole reason this is a channel rather than a filter
   * in the renderer: it reads each meeting's transcript, notes and compte-rendu
   * *here*, and what leaves is a row plus at most three forty-character
   * excerpts. A renderer-side filter would have had to be handed every
   * transcript first, which is a corpus of client conversations sitting in a
   * devtools console for the sake of a text box.
   *
   * Order inside the loop is deliberate. `passesFilter` is a client name, a
   * state and a date — no transcript is folded to answer it — so the chips run
   * first and the expensive text match only ever runs on what survived them.
   *
   * An empty query with no chip on is the default listing rather than an error
   * — that is what both screens render before anybody types, and it is the same
   * code path.
   */
  'history:search': (request, { store, clock }) => {
    const query = request.query ?? ''
    const limit = request.limit ?? 50
    const filter = withFilterDefaults(request.filter)
    const now = (clock ?? Date.now)()
    const searching = isSearching(query)
    const meetings = store.projections.listMeetings(SEARCH_SCAN_LIMIT)
    const rows: HistoryRow[] = []

    for (const meeting of meetings) {
      const intents = historyIntents(store, meeting.id)
      if (!passesFilter({ meeting, intents, filter, now })) continue

      const matches = searching ? matchesFor(searchableRecord(store, meeting.id), query) : []
      if (searching && matches.length === 0) continue

      rows.push({ meeting, status: STATE_LABEL[meeting.state], intents, matches })
      if (rows.length >= limit) break
    }

    // Over everything scanned, not over `rows`: a facet computed after its own
    // filter offers one chip — the one already pressed — and no way back.
    return { query, filter, scanned: meetings.length, clients: clientFacet(meetings), rows }
  },

  /**
   * One expanded row (DEC-25): the four sections plus the push status.
   *
   * `fields` comes from the same `reviewFields` the gate used, so a span shown
   * here is the span the rep saw when they validated — a second derivation
   * would eventually disagree with the record it claims to be.
   */
  'history:record': ({ meetingId }, { store }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw new Error(`réunion inconnue: ${meetingId}`)

    const stored = store.projections.extraction(meetingId)

    return {
      meeting,
      segments: store.projections.segments(meetingId),
      notes: documentToText(store.projections.document(meetingId)?.doc ?? null),
      compteRendu: stored ? renderCompteRendu(stored.extraction, stored.verification) : null,
      fields: stored ? reviewFields(stored.extraction, stored.verification) : [],
      overall: stored?.verification.overall ?? 'ok',
      intents: historyIntents(store, meetingId),
    }
  },

  'settings:snapshot': (_request, deps) => snapshot(deps),

  /**
   * Store a key (DEC-34).
   *
   * Three things happen in order and the order matters. The value is trimmed —
   * a key pasted out of a vendor console arrives with a newline more often than
   * not, and a trailing `\n` in an `Authorization` header is a 401 that reads
   * like a wrong key. It is written to the vault. Then the tables are recomputed
   * and returned, so the screen learns from the same read that produced them
   * whether the key made this provider the selected one.
   *
   * The value is never logged, never recorded as a diagnostic event and never
   * echoed back — the response is a settings snapshot, and `CredentialState`
   * carries four characters at most.
   */
  'settings:setCredential': async ({ providerId, value }, deps) => {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      // Reached when a field held only whitespace, which the schema's `min(1)`
      // cannot catch. Refused rather than stored, because a stored blank is a
      // provider that reports itself configured and then 401s on the call.
      throw new Error('la clé est vide')
    }
    if (!deps.credentials) throw new Error('le coffre-fort n’est pas disponible sur cette machine')
    await deps.credentials.set(providerId, trimmed)
    return saved(deps)
  },

  'settings:clearCredential': async ({ providerId }, deps) => {
    if (!deps.credentials) throw new Error('le coffre-fort n’est pas disponible sur cette machine')
    await deps.credentials.clear(providerId)
    return saved(deps)
  },

  'settings:selectProvider': async ({ capability, providerId }, deps) => {
    if (!deps.preferences) throw new Error('les préférences ne sont pas disponibles')
    await deps.preferences.selectProvider(capability, providerId)
    return saved(deps)
  },

  /**
   * Set a provider's non-secret setting (DEC-34).
   *
   * The key is checked against what the provider *declares* rather than written
   * on trust. Nothing reads an undeclared key, so accepting one would persist a
   * value that never takes effect — a save that appears to work and does not,
   * which is the whole failure DEC-34 exists to end.
   */
  'settings:setProviderField': async ({ providerId, key, value }, deps) => {
    if (!deps.preferences) throw new Error('les préférences ne sont pas disponibles')
    const tables = tablesOf(deps)
    const row = [...tables.stt.rows, ...tables.llm.rows].find(
      (candidate) => candidate.id === providerId,
    )
    if (!row) throw new Error('fournisseur inconnu')
    if (!row.fields.some((field) => field.key === key)) {
      throw new Error(`${row.label} n’a pas de réglage « ${key} »`)
    }
    await deps.preferences.setField(providerId, key, value)
    return saved(deps)
  },

  /**
   * Choose the checkpoint the local engine loads (DEC-35).
   *
   * Refused unless the model is `ready`, and `ready` means the bytes were
   * counted on disk. Selecting a half-downloaded checkpoint is precisely how an
   * engine "downloads mid-meeting", and the one place to stop it is before the
   * preference is written rather than after the recording has started.
   */
  'settings:selectModel': async ({ modelId }, deps) => {
    if (!deps.preferences) throw new Error('les préférences ne sont pas disponibles')
    const row = tablesOf(deps).models.rows.find((candidate) => candidate.id === modelId)
    if (!row) throw new Error('modèle inconnu')
    if (row.status !== 'ready') throw new Error(`${row.label} n’est pas encore installé`)
    await deps.preferences.selectModel(modelId)
    return saved(deps)
  },

  'models:download': async ({ modelId }, deps) => {
    if (!deps.models) throw new Error('le gestionnaire de modèles n’est pas disponible')
    await deps.models.start(modelId)
    return deps.models.section()
  },

  'models:cancel': async ({ modelId }, deps) => {
    if (!deps.models) throw new Error('le gestionnaire de modèles n’est pas disponible')
    await deps.models.cancel(modelId)
    return deps.models.section()
  },

  /**
   * What is downloading right now.
   *
   * Answered from the download manager rather than from the settings tables so
   * a panel remounting mid-download gets the live figure without the cost of
   * re-reading every provider's credential. This is the channel whose absence
   * left the old panel showing an empty progress bar forever after the settings
   * overlay was closed and reopened.
   */
  'models:state': (_request, deps) => deps.models?.section() ?? tablesOf(deps).models,

  'boot:state': (_request, { bootState }) => bootState?.() ?? NO_BOOT_STATE,
}

/**
 * Everything Réglages renders, in one read.
 *
 * Extracted because five channels now answer with it: the snapshot itself and
 * the four that change something and then have to say what the screen looks
 * like afterwards. A handler that patched its own view of the tables would be
 * guessing at what the registries now think — and would be wrong exactly when a
 * new key changes *which* provider is selected, which is the interesting case.
 */
/**
 * What a *write* to Réglages answers with: the same snapshot, after telling the
 * rest of the app that something changed.
 *
 * Separate from `snapshot` rather than folded into it, because opening the
 * settings screen is a read and must not set anything running. The five writes
 * go through here so that none of them can be the one that forgets — the
 * failure it prevents is a rep pasting the key that finally makes a provider
 * usable and the meeting waiting on that provider never noticing.
 */
const saved = (deps: IpcDeps): InvokeResponse<'settings:snapshot'> => {
  try {
    deps.onSettingsChanged?.()
  } catch {
    // A drain that throws must not turn a successful save into a failed one.
    // The status is readable on demand and the button is still there.
  }
  return snapshot(deps)
}

const snapshot = (deps: IpcDeps): InvokeResponse<'settings:snapshot'> => {
  const health = deps.orchestrator.health()
  const capabilities = deps.capabilities?.() ?? {
    report: null,
    reason: 'VerySwing n’a pas encore été interrogé',
  }
  const tables = tablesOf(deps)

  return {
    stt: tables.stt,
    llm: tables.llm,
    models: tables.models,
    connectors: (Object.keys(CONNECTOR_LABEL) as ConnectorId[]).map((id) => ({
      id,
      label: CONNECTOR_LABEL[id],
      // The orchestrator seeds all six at construction, so this is never the
      // fallback in practice — it exists so the type does not need to say the
      // snapshot might be partial.
      health: health[id] ?? { state: 'down' as const, reason: 'état inconnu', since: 0, retryable: true },
    })),
    auth: authState(deps.identity),
    probe: capabilities.report,
    // Exactly one of the two is set. A missing probe with no explanation is
    // the silent degradation DEC-26 exists to forbid.
    probeReason: capabilities.report ? null : (capabilities.reason ?? 'sonde indisponible'),
    retention: deps.retention ?? DEFAULT_RETENTION,
  }
}

/** The subset of `ipcMain` this file needs. Injected, never imported. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void
}

export const registerIpc = (ipcMain: IpcMainLike, deps: IpcDeps): void => {
  for (const channel of Object.keys(invokeChannels) as InvokeChannel[]) {
    ipcMain.handle(channel, async (_event, payload) => {
      const spec = invokeChannels[channel]
      try {
        const request = spec.request.parse(payload ?? {})
        const handler = handlers[channel] as Handler<InvokeChannel>
        const response = await handler(request as InvokeRequest<InvokeChannel>, deps)
        return spec.response.parse(response)
      } catch (err) {
        // Every rejection is a logged event, not just a rejected promise —
        // an IPC failure the renderer swallows is invisible otherwise (DEC-27).
        deps.recorder.record({
          severity: 'error',
          code: 'ipc.handler.failed',
          module: 'ipc',
          message: err instanceof Error ? err.message : String(err),
          detail: { channel },
        })
        throw err
      }
    })
  }
}
