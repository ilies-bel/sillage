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
import { meetingHeading } from '../../core/contracts/meeting.ts'
import type { Meeting, MeetingState } from '../../core/contracts/meeting.ts'
import type { MomentMark } from '../../core/contracts/marks.ts'
import type { UpdatePort, UpdateStatus } from '../../core/contracts/update.ts'
import { updatesUnavailable } from '../../core/contracts/update.ts'
import { updateReadiness } from '../../core/domain/updateGate.ts'
import { withoutChannelBleed } from '../../core/domain/channelBleed.ts'
import type { HistoryIntent, HistoryRow } from '../../core/contracts/history.ts'
import type { ProviderSection } from '../../core/contracts/settings.ts'
import type { ModelSection } from '../../core/contracts/models.ts'
import type { BootState } from '../../core/contracts/boot.ts'
import { isRefusal, refuse } from '../../core/contracts/refusal.ts'
import { resolveMentionSentence } from '../../core/contracts/mention.ts'
import type { EssaiResult } from '../../core/contracts/essai.ts'
import type { CapturePermissionPort } from '../../core/contracts/permissions.ts'
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
import type { AccountCandidate, CrmPort } from '../../core/contracts/crm.ts'
import { askTranscript, compteRenduSources, renderCompteRendu } from '../../modules/extract/index.ts'
import { verifyAnswer } from '../../core/domain/askAnswer.ts'
import {
  ONBOARDING_KEY,
  OnboardingStateSchema,
  type OnboardingState,
} from '../../core/contracts/onboarding.ts'
import type { LlmPort } from '../../core/contracts/llm.ts'
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
  /** « Cette machine uniquement » (DEC-37). */
  setOfflineOnly(value: boolean): Promise<void>
  /**
   * The sentence the rep reads to the client (US-19). Raw — null when nobody has
   * said — because `core/contracts/mention.ts` is the one place that decides what a
   * blank means, and two readers resolving it separately is how two defaults start
   * disagreeing.
   */
  mentionSentence(): string | null
  /** Store it. An empty value returns to the default rather than storing emptiness. */
  setMentionSentence(value: string): Promise<void>
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
  /**
   * VerySwing, for the one read the gate does: **which accounts this call could
   * belong to**.
   *
   * `accountCandidates` was the literal `[]` with a comment saying step 8 would
   * fill it, so `Review.tsx` never drew the picker and `set('accountId', …)` was
   * unreachable — a rep whose account could not be resolved had no way to say
   * which one it is, on the screen built to let them correct exactly that.
   * That is DEC-18's mitigation *a*, and it was missing on the case that needs
   * it most: `Enhancement` now declines to guess between two close candidates,
   * which is right, and leaves the rep to choose.
   *
   * Read at panel time and never stored: candidates are a fact about the CRM
   * *now*, and one frozen at extraction would go stale the moment somebody
   * creates the account the rep was looking for. Optional and never fatal —
   * VerySwing is an optional connector (DEC-26) and a gate that refuses to open
   * because a lookup failed is worse than one that opens with no suggestions.
   */
  crm?: CrmPort | null
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
   * Whether a push is on the wire right now — `Outbox.settledSynchronously()`,
   * inverted. The updater's one real danger is a POST interrupted between the
   * request and the commit that stores its id, and that lasts as long as the
   * request, not as long as the meeting stays in `pushing`. See `updateGate.ts`.
   */
  pushInFlight?: () => boolean
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
  /**
   * Whether « cette machine uniquement » is on (DEC-37).
   *
   * A function, resolved in `main.ts`: the answer is the stored preference
   * *or* the development override, and this file has no business knowing there
   * is one.
   */
  offlineOnly?: () => boolean
  /** Starting, cancelling and reporting Hugging Face downloads (DEC-35b). */
  models?: ModelDownloads | null
  /**
   * Twenty seconds of real capture, reporting what each channel heard
   * (`core/contracts/essai.ts`). Composed in `main.ts`, because it opens the
   * audio devices and broadcasts, and both are wiring.
   */
  essai?: (() => Promise<EssaiResult>) | null
  /**
   * Where consent stands, and the pane that fixes a refusal
   * (`core/contracts/permissions.ts`). Implemented in `main.ts`, which is the
   * one file allowed to know that a privacy pane is a URL and which URL.
   *
   * Absent in a test and on any host where the app cannot ask: the channels
   * then refuse with a stated reason, and the row falls back to the health
   * sentence it already had (DEC-26).
   */
  capturePermission?: CapturePermissionPort | null
  /**
   * The DEC-24 capability diff, or why there is none. Read lazily so a probe
   * that is still in flight at boot shows as "en cours" rather than as absent.
   */
  capabilities?: () => { report: CapabilityReport | null; reason: string | null }
  /**
   * The language model, resolved **per call** (DEC-34).
   *
   * A function and not a port, for the reason `providers` is a function: a rep
   * can paste a key in Réglages and the very next question has to reach it. A
   * port captured at registration time would leave *Demander* refusing on a
   * machine the rep has just configured.
   *
   * Null is a stated degradation and never a throw — `meeting:ask` answers with
   * the reason on screen (DEC-26).
   */
  llm?: (() => { port: LlmPort } | null) | null
  retention?: RetentionPolicy
  /**
   * What screen 0 reports (DEC-30). Read lazily rather than passed by value:
   * `boot()` publishes it once at startup and again if a step ever moves, and
   * a snapshot captured at registration time would freeze the first of those.
   */
  bootState?: () => BootState
  /**
   * Self-update. Absent in a dev run and on any build without update metadata,
   * and the channels answer `disabled` rather than throwing — DEC-26 again: the
   * screen must render, and « pas de mise à jour automatique » is the honest
   * thing for it to say.
   */
  updates?: UpdatePort | null
  /** Why there is no updater, when it is more specific than « not in this build ». */
  noUpdaterReason?: string | null
  /** `app.getVersion()`, so the update panel can name the running build even
   *  when there is no updater to ask. */
  appVersion?: string
  /**
   * The in-meeting widget's window gestures (`app/windows/Overlay.ts`).
   *
   * Absent in every test and in any run with no overlay — the channels then
   * answer `{ ok: false }` rather than throwing, which is what lets a renderer
   * treat « the window would not move » as a fact rather than as an exception
   * (DEC-26). They all return a boolean for the same reason: a widget that asked
   * to be resized and was not is drawing at the wrong size, and it is the only
   * thing that can notice.
   *
   * None of them can create or close a window. `left` is the one that ends in a
   * `destroy()` and it still cannot: it shortens a wait the main process had
   * already started for a window it had already decided to take away, which is
   * why a reply from a renderer is allowed to touch it at all.
   */
  widget?: {
    resize(box: {
      width: number
      height: number
      pillTop: number
      pillHeight: number
    }): { ok: boolean; above: boolean }
    passThrough(through: boolean): boolean
    focusMain(meetingId: string | null): boolean
    left(afterMs: number): boolean
    /** The renderer's own measurement deadline, from its own mount. */
    measuring(withinMs: number): boolean
  } | null
  /**
   * A mark the rep just made, to every window.
   *
   * Injected rather than reached for, because broadcasting is `main.ts`'s job
   * and this file has no `BrowserWindow` in it — the same shape `drain` has.
   */
  broadcastMark?: (meetingId: string, mark: MomentMark) => void
  /** The other half of the same wiring: a mark the rep took back. */
  broadcastForget?: (meetingId: string, markId: string) => void
}

/** What a build with no updater reports, in one place so the French matches. */
export const NO_UPDATER = 'mise à jour automatique indisponible dans cette build'

/**
 * The updater's state plus the session's answer to "may this act now".
 *
 * Takes its three inputs rather than `IpcDeps`, because `main.ts` calls it too
 * — on every updater change and on every session transition — and building a
 * fake deps object there to reach one function would be worse than a signature.
 * Five call sites, one implementation, so `installable` cannot mean two things.
 */
export const updateStatus = (
  updates: UpdatePort | null | undefined,
  states: readonly MeetingState[],
  appVersion: string,
  /**
   * Why there is no updater, when the caller knows something better than « not
   * in this build » — today that is an unsigned Windows build, where the reason
   * is the whole of what the rep needs (`core/domain/updateTrust.ts`).
   */
  absentReason: string | null = null,
  draining = false,
): UpdateStatus => {
  const state = updates?.state() ?? updatesUnavailable(appVersion, absentReason ?? NO_UPDATER)
  const readiness = updateReadiness(states, draining)
  return {
    ...state,
    // Only `ready` is installable at all; the gate decides whether it may.
    installable: state.phase === 'ready' && readiness.safe,
    blockedReason: state.phase === 'ready' && !readiness.safe ? readiness.reason : null,
  }
}

/** The `IpcDeps` form, for the handlers. */
const statusOf = (deps: IpcDeps): UpdateStatus =>
  updateStatus(
    deps.updates,
    deps.orchestrator.liveStates(),
    deps.appVersion ?? '0.0.0',
    deps.noUpdaterReason ?? null,
    deps.pushInFlight?.() ?? false,
  )

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

const EMPTY_AGENDA = {
  events: [],
  syncedAt: 0,
  // An empty window rather than a wide one: with no calendar connected, no day
  // has been asked about, and the empty state must not claim otherwise.
  window: { from: 0, to: 0 },
  armed: null,
  reason: 'Aucun calendrier connecté',
}

/**
 * Which accounts this call could belong to, for the picker under *Client*.
 *
 * Never throws and never blocks the gate: VerySwing is optional (DEC-26), and
 * a confirmation screen that will not open because a lookup timed out is worse
 * than one that opens with no suggestions — the *Client* row already says the
 * account is unresolved and the opportunity already states why it cannot ship.
   *
 * Two different questions, depending on what is already known. **Unresolved**
 * and the question is « which company is this » — `resolveAccount`, the same
 * verb `Enhancement` used and declined to act on when two candidates were too
 * close, which is precisely the case the rep is here to settle.
 * **Resolved** and the question is DEC-18's: « is this the right one of
 * several in the same group » — `listSiblings` under the shared parent, so a
 * compte-rendu meant for *Néovia Santé — Pôle Ouest* does not land in
 * *Néovia Hospitalisation* with nothing on screen having said a choice existed.
 */
const accountCandidates = async (
  crm: CrmPort | null | undefined,
  accountId: string | null,
  attendees: readonly { email: string }[],
  hint: string,
): Promise<AccountCandidate[]> => {
  if (!crm) return []
  const attendeeEmails = attendees.map((a) => a.email).filter((email) => email.trim() !== '')
  if (attendeeEmails.length === 0) return []
  try {
    const candidates = await crm.resolveAccount({ attendeeEmails, hint })
    if (accountId === null) return candidates

    /*
     * Resolved, so the remaining question is DEC-18's: is this the right one of
     * several in the same group. Both customers and prospects carry a parent
     * link, so listing siblings is a group-by rather than a heuristic — and it
     * is the case `resolveAccount` alone can miss, because a sibling the scorer
     * found no signal for is exactly the one nobody would think to look for.
     */
    const parent = candidates.find((c) => c.accountId === accountId)?.parentAccountId
    if (!parent) return candidates
    const siblings = await crm.listSiblings(parent)
    const seen = new Set(candidates.map((c) => c.accountId))
    return [...candidates, ...siblings.filter((s) => !seen.has(s.accountId))]
  } catch {
    return []
  }
}

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

/**
 * The compte-rendu of one call: **what the rep validated**, and only failing
 * that what the model wrote.
 *
 * The fallback is the whole of it. `edits.compteRendu` used to reach
 * `draftIntents` and nothing else, so the string VerySwing received and the
 * string every read surface drew were two different documents from the moment a
 * rep corrected a sentence at the gate. Measured on the real gate, the real
 * store and the real outbox: the intent payload carried the added sentence, the
 * archive did not, the archive still carried a line the rep had struck out — so
 * a search for the correction found nothing and a search for the deleted line
 * found the call and offered that very line as its evidence. CLAUDE.md's
 * invariant is « VerySwing receives the string the rep read »; this is its
 * converse, and it now holds by construction, because every surface that draws
 * or searches a compte-rendu comes through here.
 *
 * `null` from `confirmedCompteRendu` is an absence and not an empty document
 * (its docblock has the distinction), which is what makes every meeting
 * confirmed before that field existed read exactly as it always has: nothing was
 * recorded, so the stored extraction is rendered, which is what those meetings
 * have always shown.
 */
const compteRenduOf = (store: Store, meetingId: string): string | null => {
  const confirmed = store.projections.confirmedCompteRendu(meetingId)
  if (confirmed !== null) return confirmed
  const stored = store.projections.extraction(meetingId)
  return stored ? renderCompteRendu(stored.extraction, stored.verification) : null
}

/**
 * The five searchable surfaces of one call, folded from its log.
 *
 * **`meeting` is the one a rep types first and the one that was missing.** The
 * other three are all *contents* of a call, so « Néovia » — the client name this
 * screen offers as a chip, one row above the box — found nothing unless somebody
 * had said the word aloud and the transcriber had spelled it that way. A call
 * that had not reached the gate was unreachable by name at all: no transcript,
 * no notes, no compte-rendu, and the search replaces the day list while it is
 * active, so the row was not on screen either. Four French strings and VISION §6
 * all said this worked.
 *
 * The title and the client are joined with a newline for the reason the
 * transcript is: an excerpt must never weld two unrelated fields into a phrase
 * nobody wrote. **And they are joined the way the row draws them** — through
 * `meetingHeading`, which is why that function had to move into `contracts`.
 * Joining the raw objet to the raw client name printed the client twice: the
 * objet a rep types opens on the client's own name almost every time, so the
 * excerpt read « Sodexial — comité de staffing Sodexial » under a row that had
 * just printed « Sodexial » once, three pixels up. The row strips the duplicate
 * and the evidence line under it put it straight back.
 *
 * The transcript is joined with newlines rather than spaces so a *match* can
 * never weld the end of one speaker's sentence to the start of another's: no
 * typed query contains a newline, so no hit spans two turns. It does not survive
 * into the excerpt — `ellipsise` collapses every run of whitespace to one space,
 * which is what makes a markdown excerpt one readable line — so the marks list
 * carries a visible separator as well. It is a list of short independent notes
 * rather than one continuous conversation, and two of them run together read as
 * a sentence the rep never typed.
 *
 * **`marks` was the fifth, and it is the only thing a rep can type from inside
 * the call.** `Projections.marks` existed, `MomentMark.note` carries the rep's
 * own words, the widget wrote them and two readers drew them — and no search
 * reached them, so « prix : ils bloquent à 550 », typed one-handed over a
 * client's face, was in the record and could not be found by typing `550`. A
 * mark taken back is already absent from that projection (`moment.forgotten`),
 * so a retracted note is not findable either, which is what DEC-27 means here.
 */
/** Between two marks: a newline for the match, a middle dot for the excerpt. */
const MARK_JOIN = '\n· '

const searchableRecord = (store: Store, meetingId: string) => {
  const meeting = store.projections.getMeeting(meetingId)
  const heading = meeting ? meetingHeading(meeting) : null
  return {
    meeting: [heading?.title ?? '', heading?.subtitle ?? '']
      .filter((part) => part !== '')
      .join('\n'),
    // Notes only: a mark made with no note is a moment, not prose. Joined with
    // the separator above, which is the one part of the join that reaches the
    // rep's eyes.
    marks: store.projections
      .marks(meetingId)
      .map((mark) => mark.note)
      .filter((note) => note !== '')
      .join(MARK_JOIN),
    transcript: store.projections
      .segments(meetingId)
      .map((segment) => segment.text)
      .join('\n'),
    notes: documentToText(store.projections.document(meetingId)?.doc ?? null),
    compteRendu: compteRenduOf(store, meetingId) ?? '',
  }
}

/**
 * How many client names the chips offer.
 *
 * The scanned meetings arrive newest first, so this is « the clients this rep
 * has been working with », which is what a chip row is for. A rep looking for a
 * client further back than that types the name — the box beside the chips
 * searches the same corpus and is not capped by anything but `limit`, which is
 * true now that the scan reads every meeting and was not before.
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
    if (!meeting) throw refuse('la réunion n’a pas pu être créée')
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
    if (!session) throw refuse(`réunion inconnue: ${meetingId}`)
    session.emit({ type: 'meeting.renamed', title, clientName: clientName ?? null })
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)
    return meeting
  },

  'meeting:get': ({ meetingId }, { store }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)
    return {
      meeting,
      segments: store.projections.segments(meetingId),
      signals: store.projections.signals(meetingId),
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
    if (!session) throw refuse(`réunion inconnue: ${meetingId}`)

    session.emit({ type: 'meeting.recipe.chosen', recipe })

    // The stored extraction, not the state: a meeting in `awaiting_confirmation`
    // has one and a meeting in `ended` may too, and what decides whether there
    // is anything to replace is whether a document exists.
    const existing = store.projections.extraction(meetingId)
    const changed = existing !== null && existing.extraction.interpretation.recipe !== recipe
    if (changed) void runEnhancement?.(meetingId)

    /*
     * `regenerating` is « a run was asked for », never « a run started », and the
     * difference is not this handler's to report. `state` used to ride here for
     * exactly that purpose and could not do it: `stateOf` is read synchronously
     * and `Enhancement`'s decision is two microtasks away, behind
     * `orchestrator.enhance`'s `await stopRecording` — measured,
     * `awaiting_confirmation` whether a model existed or not. Whoever needs the
     * answer asks `enhancement:status`, which is the one function that composes
     * it.
     */
    return { recipe, regenerating: changed }
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

  /*
   * The dry run. Refused rather than silently queued when there is no
   * implementation wired — a renderer that gets an unexplained rejection draws
   * « une erreur est survenue » and the rep learns nothing (DEC-26).
   */
  /*
   * Consent, measured now. A rep grants a permission in another window and
   * comes straight back, so nothing here is cached.
   */
  'capture:permission': (_request, { capturePermission }) => {
    if (!capturePermission) {
      throw refuse('Les autorisations d’enregistrement ne sont pas lisibles dans cette configuration.')
    }
    return capturePermission.read()
  },

  'capture:permission:open': async (_request, { capturePermission }) => {
    if (!capturePermission) {
      throw refuse('Les réglages de confidentialité ne sont pas accessibles depuis cette configuration.')
    }
    return { opened: await capturePermission.openSettings() }
  },

  'capture:essai': async (_request, { essai }) => {
    if (!essai) {
      throw refuse('L’essai audio n’est pas disponible dans cette configuration.')
    }
    return essai()
  },

  'diagnostics:recent': ({ limit }, { diagnostics }) => diagnostics.recent(limit ?? 200),

  'diagnostics:export': ({ mode }, { diagnostics, exportDirectory }) =>
    diagnostics.writeBundle(mode, exportDirectory),

  'auth:state': (_request, { identity }) => authState(identity),

  'auth:signIn': async (_request, { identity, agenda }) => {
    // Unreachable from the product — Réglages disables the control and states
    // `AuthState.reason` beside it. Kept because the channel is public and a
    // rejection is better than a sign-in that silently does nothing.
    if (!identity) throw refuse(NO_REGISTRATION)
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

  /*
   * No agenda means no fold, so there is no event to name and nothing to arm.
   * The sentence is the rep's, not a stack: DEC-26 says a refusal is stated,
   * and `preload.ts` strips the `Error invoking remote method` prefix.
   */
  'agenda:arm': (_request, { agenda }) => {
    if (!agenda) throw new Error('Le calendrier n’est pas connecté.')
    return agenda.armNow(_request.eventId)
  },
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
  'review:get': async ({ meetingId }, { store, orchestrator, identity, crm }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)

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

    /*
     * **The gate is open on this meeting, which is what makes it block an installer.**
     *
     * `awaiting_confirmation` is in `UPDATE_BLOCKING_STATES` for the rep's *edits*, and
     * nothing dispatches when a gate opens — so a meeting that reached the gate on a
     * previous launch stopped refusing « Installer et redémarrer » the moment
     * `liveStates()` stopped answering from the rehydration cache. Said here rather than
     * on the state, because the stored state is stale for ever when no model is
     * configured (DEC-39) and would refuse every installer for ever, which is the
     * defect round 28 closed. Said after the availability check, so only a gate that
     * actually opened counts.
     */
    orchestrator.atGate(meetingId)

    const { extraction, verification } = stored
    /*
     * The **model's** document, deliberately, and not `compteRenduOf`. This is
     * the only read in the product that wants the extraction rather than what
     * was last validated: the gate is reachable from `awaiting_confirmation`
     * alone, so a meeting arriving here after a confirmation got here by
     * extracting *again*, and the rep is being asked to check the new document —
     * not a correction made to the one it replaced.
     */
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
    // Whether there is an account to draft from at all. Both passes, or the
    // gate would open on one reason and its first preview would replace it.
    const mailAccount = authState(identity).status === 'signedIn'
    const probe = draftIntents({
      meetingId,
      facts: extraction.facts,
      edits,
      mailTo,
      mailAccount,
      recipe,
      checked: [],
    })
    const drafted = draftIntents({
      meetingId,
      facts: extraction.facts,
      edits,
      mailTo,
      mailAccount,
      recipe,
      checked: defaultChecked(probe),
    })

    return {
      open: true as const,
      panel: {
        meeting,
        edits,
        fields: reviewFields(extraction, verification),
        /*
         * DEC-18, mitigation *a* — and this was the literal `[]` with a comment
         * promising step 8 would fill it. `Review.tsx` draws the picker only when
         * the list is non-empty, so `set('accountId', …)` was unreachable: a rep
         * whose account could not be resolved had no way at all to say which one
         * it is, on the screen built to let them correct exactly that. With
         * `Enhancement` now declining to guess between two close candidates, this
         * is the case that needs it most.
         */
        accountCandidates: await accountCandidates(
          crm,
          extraction.facts.account.accountId,
          extraction.facts.interlocuteurs,
          meeting.title,
        ),
        interlocuteurs: extraction.facts.interlocuteurs,
        mailTo,
        overall: verification.overall,
        intents: drafted.map((d) => d.view),
        /*
         * The document's own provenance (DEC-21). Composed from the same
         * `Cited<T>` items the document was rendered from, so the renderer
         * matches on string equality; the free recipe extracts nothing typed and
         * therefore contributes none, which is correct rather than missing.
         */
        sources: compteRenduSources(extraction),
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
  'review:preview': ({ meetingId, edits, intentIds }, { store, identity }) => {
    const stored = store.projections.extraction(meetingId)
    if (!stored) return { intents: [] }

    const facts = stored.extraction.facts
    return {
      intents: draftIntents({
        meetingId,
        facts,
        edits,
        mailTo: mailRecipients(facts.interlocuteurs),
        // Whether there is an account to draft from, so the disabled row can
        // name the blocker that is actually in the way rather than the one it
        // happens to notice first (DEC-26, DEC-28).
        mailAccount: authState(identity).status === 'signedIn',
        recipe: stored.extraction.interpretation.recipe,
        checked: intentIds,
      }).map((d) => d.view),
    }
  },

  'review:confirm': ({ meetingId, edits, intentIds }, { store, orchestrator, clock, drain }) => {
    const session = orchestrator.session(meetingId)
    if (!session) throw refuse(`réunion inconnue: ${meetingId}`)

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
    session.emit({
      type: 'confirmation.recorded',
      intentIds: created,
      at: (clock ?? Date.now)(),
      // **The document that was on screen when the rep pressed the button.**
      // It travelled into the intents and nowhere else, so *Historique* drew —
      // and the search searched — the model's draft rather than the rep's
      // corrected text, on the one screen that exists to find a past call.
      // Written verbatim, empty string included: deleting the document and
      // validating is something `reviewGate.ts` deliberately allows, and the
      // record says what happened rather than reinstating the draft over it.
      compteRendu: edits.compteRendu,
    })
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
   *
   * **The scan reads every meeting, and it used to stop at five hundred.**
   * `SEARCH_SCAN_LIMIT` called itself « a guard against a pathological log
   * rather than a page size » and argued, correctly, that scanning fifty and
   * returning fifty would make the fifty-first call unfindable — then did
   * exactly that one order of magnitude up. Call five hundred and one answered
   * « Aucun appel ne correspond. », under a preview screen promising
   * « l'historique les porte tous » (DEC-25), with the *result* cap reported and
   * the scan cap not: `capped` has always measured `rows`, and `scanned` — the
   * only field that could have told a rep the corpus was cut short — was shipped
   * on every answer and read by no screen. That is the `diag:appended` shape one
   * level down, in a payload field rather than a channel, and `check:surfaces`
   * looks for it now.
   *
   * What that costs is measured rather than guessed at. The corpus itself is one
   * `SELECT` over a projection table — four milliseconds for two thousand
   * meetings — and the expensive half is the per-meeting fold below, which is why
   * the cheap axes run first and why the loop stops one row past `limit`. On
   * fifty-minute calls (forty turns each), « TJM » costs 33 ms whatever the
   * corpus, because it stops at the fifty-first match; a query that matches
   * *nothing* reads every log, and that is 325 ms over five hundred calls and
   * 1.2 s over two thousand, once per pause in the rep's typing. That is the
   * price of the promise, and it is the right way round: a search that cannot
   * find a call the product swears it keeps is not a search.
   */
  'history:search': (request, { store, clock }) => {
    const query = request.query ?? ''
    const limit = request.limit ?? 50
    const filter = withFilterDefaults(request.filter)
    const now = (clock ?? Date.now)()
    const searching = isSearching(query)
    const meetings = store.projections.listMeetings(null)
    const rows: HistoryRow[] = []

    for (const meeting of meetings) {
      const intents = historyIntents(store, meeting.id)
      if (!passesFilter({ meeting, intents, filter, now })) continue

      const matches = searching ? matchesFor(searchableRecord(store, meeting.id), query) : []
      if (searching && matches.length === 0) continue

      rows.push({ meeting, status: STATE_LABEL[meeting.state], intents, matches })
      // One row **past** the limit, and the extra one never travels. `>= limit`
      // was over-reporting by one: exactly fifty matches with nothing hidden
      // still drew « Affinez la recherche pour en voir d'autres », which tells a
      // rep to narrow a search that is already complete.
      if (rows.length > limit) break
    }

    const capped = rows.length > limit

    // Over everything scanned, not over `rows`: a facet computed after its own
    // filter offers one chip — the one already pressed — and no way back.
    return {
      query,
      filter,
      scanned: meetings.length,
      clients: clientFacet(meetings),
      rows: capped ? rows.slice(0, limit) : rows,
      // The loop above stopped one past `limit`; the screen is owed the fact,
      // and it draws `scanned` beside it so the sentence says what was searched.
      capped,
    }
  },

  /**
   * One expanded row (DEC-25): the four sections plus the push status.
   *
   * `fields` comes from the same `reviewFields` the gate used, so a span shown
   * here is the span the rep saw when they validated — a second derivation
   * would eventually disagree with the record it claims to be.
   */
  /**
   * The transcript behind the citations at the gate (DEC-21).
   *
   * Final segments only and straight off the projection — the same rows
   * `spanVerification.ts` ran against, so what the rep reads when they follow a
   * `source ▸` is what the app checked the quote in. Nothing is filtered here,
   * and in particular the channel-bleed drop (DEC-41) is *not* applied: that
   * one exists so the model reads each sentence once, and a rep looking for a
   * quote must be able to find it wherever it was said.
   */
  'review:transcript': ({ meetingId }, { store }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)
    return {
      segments: store.projections.segments(meetingId),
      marks: store.projections.marks(meetingId),
    }
  },

  /**
   * **The rep marking a moment** (`core/contracts/marks.ts`).
   *
   * Refused unless the call is actually recording, and read from the
   * orchestrator rather than from the projection: the projection is the folded
   * log and the orchestrator is what is happening now, and between the two the
   * second is the one « ce moment » is about.
   *
   * The id and the instant are minted here. Two windows can press this — the
   * session screen and the widget floating over Teams — and a renderer-side id
   * would be two sources for one identity, while a renderer-side clock would
   * put a mark before the turn it followed on a machine whose windows disagree
   * by a second.
   */
  'meeting:mark': ({ meetingId, note, segmentId }, deps) => {
    const { store, orchestrator } = deps
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)
    const state = orchestrator.stateOf(meetingId) ?? meeting.state
    if (state !== 'recording') {
      throw refuse('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
    }
    const mark: MomentMark = {
      id: randomUUID(),
      at: (deps.clock ?? Date.now)(),
      note: note ?? '',
      segmentId: segmentId ?? null,
    }
    store.append(meetingId, { type: 'moment.marked', mark })
    deps.broadcastMark?.(meetingId, mark)
    return mark
  },

  /**
   * A mark taken back. Appended, never deleted (DEC-27).
   *
   * Idempotent and quiet about an id it does not know: the widget removes the
   * row optimistically and a refusal would put back a line the rep has already
   * watched go, for a mark that is not there either way.
   */
  'meeting:forget': ({ meetingId, markId }, deps) => {
    const { store } = deps
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)
    const known = store.projections.marks(meetingId).some((mark) => mark.id === markId)
    if (!known) return { forgotten: false }
    store.append(meetingId, { type: 'moment.forgotten', markId })
    deps.broadcastForget?.(meetingId, markId)
    return { forgotten: true }
  },

  /**
   * What the widget draws, in one read (`app/windows/Overlay.ts`).
   *
   * `liveIds()` and not the projection: the widget exists for the duration of a
   * recording, and a meeting the projection still calls `recording` after a
   * crash is exactly the stranded row `main.ts`'s boot sweep ends — drawing a
   * widget over it would be a floating pill saying a call is being recorded
   * when no device is open.
   */
  'widget:state': (_request, { store, orchestrator, preferences }) => {
    /*
     * Sent on **every** answer, including `{ meeting: null }` (US-19). That answer is
     * the one the renderer's `MEASURE_DEADLINE_MS` waits for and treats as settled
     * either way, so a sentence attached to the meeting instead would arrive only
     * when there is one — and the pill measured off the placeholder is exactly the
     * frame the main process must never be shown (`FONT_DEADLINE_MS`).
     */
    const mentionSentence = resolveMentionSentence(preferences?.mentionSentence() ?? null)
    const meetingId =
      orchestrator.liveIds().find((id) => orchestrator.stateOf(id) === 'recording') ?? null
    if (meetingId === null) return { meeting: null, mentionSentence }
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) return { meeting: null, mentionSentence }
    return {
      mentionSentence,
      meeting: {
        meetingId,
        title: meeting.title,
        clientName: meeting.clientName,
        startedAt: meeting.startedAt ?? meeting.createdAt,
        marks: store.projections.marks(meetingId),
      },
    }
  },

  'widget:resize': ({ width, height, pillTop, pillHeight }, { widget }) =>
    widget?.resize({
      width,
      height,
      pillTop: pillTop ?? 0,
      pillHeight: pillHeight ?? 0,
    }) ?? { ok: false, above: false },

  'widget:passThrough': ({ through }, { widget }) => ({
    ok: widget?.passThrough(through) ?? false,
  }),

  'widget:left': ({ afterMs }, { widget }) => ({ ok: widget?.left(afterMs) ?? false }),
  /*
   * The renderer's own measurement clock, so both first-frame deadlines share an
   * origin — see `widget:measuring` in `core/contracts/ipc.ts` and
   * `Overlay.measuring`.
   */
  'widget:measuring': ({ withinMs }, { widget }) => ({
    ok: widget?.measuring(withinMs) ?? false,
  }),

  'window:focus': ({ meetingId }, { widget }) => ({
    ok: widget?.focusMain(meetingId ?? null) ?? false,
  }),

  /**
   * *Demander* — one question about one call (`core/contracts/ask.ts`).
   *
   * Three refusals before the model is reached, and each of them is a sentence
   * on screen rather than an exception (DEC-26):
   *
   *  · **the call is still running.** Nothing about the analysis surfaces during
   *    a meeting (DEC-23), and the transcript a question would be answered from
   *    is by definition the part that has already happened;
   *  · **there is no record yet.** A meeting with no final segments has nothing
   *    to answer from, and « je ne sais pas » from a model asked over an empty
   *    string is a worse way to say that;
   *  · **there is no model configured.** The same degradation the compte-rendu
   *    has, worded for this screen, with Réglages named.
   *
   * The transcript is read whole and unfiltered — the channel-bleed drop
   * (DEC-41) is for the recipe, and a quote must be findable wherever it was
   * said (the same reasoning `review:transcript` carries).
   */
  /*
   * First run, read and recorded (`core/contracts/onboarding.ts`).
   *
   * A missing row is a fresh install, and an unparseable one is treated the same
   * way: the worst case is showing the onboarding once more, and the alternative
   * — throwing on a corrupt string — would hold the whole window shut over a
   * preference.
   */
  'onboarding:state': (_request, { store }) => {
    const raw = store.appState.get(ONBOARDING_KEY)
    if (raw === null) return { seen: false }
    try {
      const parsed = OnboardingStateSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : { seen: false }
    } catch {
      // `JSON.parse` throws before the schema ever sees the string, so the
      // try/catch is not belt and braces — it is the only thing standing between
      // one corrupt preference and a window that will not open.
      return { seen: false }
    }
  },

  'onboarding:seen': (_request, { store }) => {
    const state: OnboardingState = { seen: true }
    store.appState.set(ONBOARDING_KEY, JSON.stringify(state))
    return state
  },

  'meeting:ask': async ({ meetingId, question }, { store, orchestrator, llm }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)

    const state = orchestrator.stateOf(meetingId) ?? meeting.state
    if (state === 'recording' || state === 'armed') {
      throw refuse('La réunion est en cours — les questions attendent la fin de l’appel.')
    }

    /*
     * **De-bleeded, exactly as the recipe reads it** (DEC-41).
     *
     * `withoutChannelBleed` is imported in one place — `main.ts`, for the
     * compte-rendu — and this path read the raw log. On a laptop with open
     * speakers the microphone hears the far end too, measured at **24 of 38 rep
     * segments on a real call**, so this is the ordinary configuration and not
     * an edge.
     *
     * What it cost: the client's own sentence exists twice, once correctly on
     * `far` and once as the rep's echo on `rep`. `askAnswer`'s blind search
     * tries `rep` first, so a quote the model left unattributed — which rule 6
     * of the prompt explicitly invites — came back labelled « Moi », and
     * pressing it opened the reader on the rep's echo. The wrong side of the
     * call, on the one sentence that mattered, on the surface whose entire
     * claim is that every word is checkable (DEC-47). It also spent half the
     * sixty-thousand-character budget on duplicates.
     */
    const segments = withoutChannelBleed(
      store.projections.segments(meetingId).filter((segment) => segment.isFinal),
    )
    if (segments.length === 0) {
      throw refuse('Aucune transcription n’a été enregistrée pour cet appel.')
    }

    const resolved = llm?.() ?? null
    if (!resolved) {
      throw refuse(
        'Aucun modèle de langage n’est configuré — ajoutez-en un dans Réglages, « Modèle de langage ».',
      )
    }

    const { draft, readFrom } = await askTranscript(resolved.port, { question, segments })
    return verifyAnswer(question, draft, segments, readFrom)
  },

  'history:record': ({ meetingId }, { store }) => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) throw refuse(`réunion inconnue: ${meetingId}`)

    const stored = store.projections.extraction(meetingId)

    return {
      meeting,
      segments: store.projections.segments(meetingId),
      notes: documentToText(store.projections.document(meetingId)?.doc ?? null),
      // The same reading `meeting:get` and the search do: what the rep
      // validated, falling back to the model's document when nobody has.
      compteRendu: compteRenduOf(store, meetingId),
      // From the extraction's deterministic half, which is Graph's answer
      // (DEC-7) — the same list the gate names as « Interlocuteurs ».
      interlocuteurs: stored?.extraction.facts.interlocuteurs ?? [],
      fields: stored ? reviewFields(stored.extraction, stored.verification) : [],
      overall: stored?.verification.overall ?? 'ok',
      intents: historyIntents(store, meetingId),
      marks: store.projections.marks(meetingId),
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
      throw refuse('la clé est vide')
    }
    if (!deps.credentials) throw refuse('le coffre-fort n’est pas disponible sur cette machine')
    await deps.credentials.set(providerId, trimmed)
    return saved(deps)
  },

  'settings:clearCredential': async ({ providerId }, deps) => {
    if (!deps.credentials) throw refuse('le coffre-fort n’est pas disponible sur cette machine')
    await deps.credentials.clear(providerId)
    return saved(deps)
  },

  /**
   * « Cette machine uniquement » (DEC-37), written where a rep can reach it.
   *
   * `onSettingsChanged` for the same reason every other settings write calls
   * it: this can be the thing that makes — or unmakes — a usable model, and a
   * meeting sitting in `ended` is waiting on exactly that promise (DEC-39).
   */
  'settings:setOfflineOnly': async ({ value }, deps) => {
    if (!deps.preferences) throw refuse('les préférences ne sont pas disponibles')
    await deps.preferences.setOfflineOnly(value)
    deps.onSettingsChanged?.()
    return snapshot(deps)
  },

  /**
   * The sentence the rep reads to the client (US-19).
   *
   * `onSettingsChanged` for the reason every other write in this pane calls it, and
   * **not** as a way of refreshing the pill: `main.ts` injects
   * `drainDeferredEnhancements`, so what it does is retry a compte-rendu that was
   * waiting on a model (DEC-39). It is called here because any Réglages write can be
   * the one that makes a model usable, and a meeting sitting in `ended` is doing so on
   * that promise.
   *
   * **How the pill actually learns the new wording, stated because the obvious
   * assumption is wrong.** It does not poll and nothing broadcasts to it here. The
   * widget re-reads `widget:state` on `session:changed`, and a recording has no
   * transitions — so a sentence changed *during* a call reaches the pill at the next
   * recording, not at the next keystroke. That is the honest behaviour and the
   * defensible one: the wording the pill hands over is the wording that was
   * configured when the call started, and an administrator rewriting legal text
   * mid-call is not a case this product should silently win.
   *
   * Nothing here validates the *content*. The wording is the ESN's, and this product
   * has no rule that separates a sentence it dislikes from one it does not —
   * `check:diag`'s own verdict on free-form text is that a denylist over it cannot be
   * made safe, only made narrower.
   */
  'settings:setMentionSentence': async ({ value }, deps) => {
    if (!deps.preferences) throw refuse('les préférences ne sont pas disponibles')
    await deps.preferences.setMentionSentence(value)
    deps.onSettingsChanged?.()
    return snapshot(deps)
  },

  'settings:selectProvider': async ({ capability, providerId }, deps) => {
    if (!deps.preferences) throw refuse('les préférences ne sont pas disponibles')
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
    if (!deps.preferences) throw refuse('les préférences ne sont pas disponibles')
    const tables = tablesOf(deps)
    const row = [...tables.stt.rows, ...tables.llm.rows].find(
      (candidate) => candidate.id === providerId,
    )
    if (!row) throw refuse('fournisseur inconnu')
    if (!row.fields.some((field) => field.key === key)) {
      throw refuse(`${row.label} n’a pas de réglage « ${key} »`)
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
    if (!deps.preferences) throw refuse('les préférences ne sont pas disponibles')
    const row = tablesOf(deps).models.rows.find((candidate) => candidate.id === modelId)
    if (!row) throw refuse('modèle inconnu')
    if (row.status !== 'ready') throw refuse(`${row.label} n’est pas encore installé`)
    await deps.preferences.selectModel(modelId)
    return saved(deps)
  },

  'models:download': async ({ modelId }, deps) => {
    if (!deps.models) throw refuse('le gestionnaire de modèles n’est pas disponible')
    /*
     * **Never during a call** (DEC-26).
     *
     * `ModelDownloads.start` posts `init` straight to its own worker, which
     * bypasses `acquireLoadSlot` and `memoryVerdict` — the two guards
     * `engine.ts` describes as the reason an ONNX session that cannot allocate
     * « does not fail politely, it takes the process with it ». So pressing
     * *Télécharger* mid-call built a second ONNX session beside the meeting's,
     * on a laptop already running a recording, a transcriber and Teams.
     *
     * The app refuses a ten-second installer while a call is live
     * (`updateReadiness`); a multi-gigabyte download that spawns a model runtime
     * is the same question with a bigger answer. Stated, never silent: the
     * download is the rep's own gesture and they are owed the reason.
     */
    if (deps.orchestrator.liveStates().some((state) => state === 'recording')) {
      throw refuse(
        'Une réunion est en cours — le téléchargement attendra la fin de l’appel pour ne pas lui prendre de mémoire.',
      )
    }
    await deps.models.start(modelId)
    return deps.models.section()
  },

  'models:cancel': async ({ modelId }, deps) => {
    if (!deps.models) throw refuse('le gestionnaire de modèles n’est pas disponible')
    await deps.models.cancel(modelId)
    return deps.models.section()
  },

  'boot:state': (_request, { bootState }) => bootState?.() ?? NO_BOOT_STATE,

  'update:status': (_request, deps) => statusOf(deps),

  'update:check': async (_request, deps) => {
    // `check()` never rejects (DEC-26), so there is nothing to catch: an
    // unreachable server resolves to `phase: 'error'` and the panel prints it.
    await deps.updates?.check()
    return statusOf(deps)
  },

  'update:download': async (_request, deps) => {
    /*
     * Gated, and not for consent — for bandwidth. Downloading half a gigabyte
     * while the rep is on the call being transcribed degrades that call, which
     * is a way to damage a meeting without ever touching the capture path.
     */
    if (updateReadiness(deps.orchestrator.liveStates(), deps.pushInFlight?.() ?? false).safe) {
      await deps.updates?.download()
    }
    return statusOf(deps)
  },

  'update:install': async (_request, deps) => {
    const readiness = updateReadiness(
      deps.orchestrator.liveStates(),
      deps.pushInFlight?.() ?? false,
    )
    /*
     * The authoritative check. The renderer's `installable` decides what the
     * button looks like; this decides what happens, because a meeting can start
     * between the paint and the click and only this side knows in time.
     */
    if (!readiness.safe) {
      deps.recorder.record({
        severity: 'info',
        code: 'update.install.refused',
        module: 'update',
        // Authored, and the whole value space was read before saying so:
        // `updateReadiness().reason` is `BLOCKING[state]` or `PUSH_IN_FLIGHT`,
        // both literals in `core/domain/updateGate.ts`, and that module is pure
        // core with nothing foreign reaching it. Declaring this `foreign` would
        // put `[message:34]` in the log where « un envoi vers VerySwing est en
        // cours » is the entire content of the row.
        origin: 'authored',
        message: readiness.reason ?? 'installation impossible',
        detail: { states: [...deps.orchestrator.liveStates()] },
      })
      return { started: false, reason: readiness.reason }
    }
    const started = (await deps.updates?.install()) ?? false
    return {
      started,
      reason: started ? null : 'aucune mise à jour n’est prête à être installée',
    }
  },
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
    /*
     * Read from the same place a meeting reads it (`main.ts`'s `offlineOnly`),
     * so the switch on screen cannot say one thing while the next recording
     * does another — which is what `resolveLlm` and `recordingOptionsFor` were
     * both once guilty of for the whole settings surface.
     */
    offlineOnly: deps.offlineOnly?.() ?? false,
    /*
     * Resolved, never raw (US-19): the screen draws what the *pill* will hand over,
     * so a deployment that saved an empty box sees the default in the field rather
     * than a box that looks configured and is not. `widget:state` resolves through
     * the same function, which is why there is no fallback in either renderer.
     */
    mentionSentence: resolveMentionSentence(deps.preferences?.mentionSentence() ?? null),
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
        /*
         * Every rejection is a logged event, not just a rejected promise — an
         * IPC failure the renderer swallows is invisible otherwise (DEC-27).
         *
         * **But a refusal is not a failure.** DEC-26 fills this app with
         * sentences composed on purpose for a rep to read — « la réunion est en
         * cours », « aucune transcription n'a été enregistrée » — and each of
         * them crosses this boundary as a thrown `Error`, because that is how a
         * promise says no. Logged at `error` they wrote red lines into the
         * diagnostics bundle beside the ones that mean the native module would
         * not load, and a bundle where the product working and the product
         * broken look identical is the evidence nobody can read on a support
         * call. `scripts/e2e.mjs` found two on a clean first launch, both of
         * them the app behaving exactly as designed.
         *
         * Still recorded, at `info`: « the rep asked and was told no » is worth
         * having in the log, and it is the *severity* that carries the meaning.
         */
        const stated = isRefusal(err)
        deps.recorder.record({
          severity: stated ? 'info' : 'error',
          code: stated ? 'ipc.handler.refused' : 'ipc.handler.failed',
          module: 'ipc',
          // Foreign, and this is the widest such site in the product: it is the
          // message of *any* throw from *any* handler — a Zod issue naming a
          // field's value, a vendor's HTTP body, a filesystem path. A refusal
          // (`isRefusal`) is one of ours, but the two share one `record` call and
          // the declaration has to be true of both branches.
          origin: 'foreign',
          message: err instanceof Error ? err.message : String(err),
          detail: { channel },
        })
        throw err
      }
    })
  }
}
