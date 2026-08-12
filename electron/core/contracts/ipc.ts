/**
 * IPC is a contract, generated once (ARCHITECTURE.md §5.B).
 *
 * Every channel is declared here with a zod schema for its payload.
 * `app/ipc/register.ts` and `preload.ts` are both derived from these tables and
 * neither contains logic. Adding a channel is one entry in one file; main,
 * preload and the renderer cannot drift.
 *
 * This is the direct answer to an 11,810-line `ipcHandlers.ts`.
 */
import { z } from 'zod'
import {
  MeetingIdSchema,
  MeetingSchema,
  MeetingStateSchema,
  TimestampSchema,
  UserCommandSchema,
} from './meeting.ts'
import { TranscriptSegmentSchema } from './transcript.ts'
import { SignalSchema } from './signals.ts'
import { OutboxEntrySchema } from './push.ts'
import { ConnectorHealthSchema, ConnectorIdSchema, HealthSnapshotSchema } from './health.ts'
import { DiagEventSchema, ExportModeSchema } from './diagnostics.ts'
import { AuthStateSchema } from './identity.ts'
import { CalendarEventSchema } from './calendar.ts'
import {
  ReviewConfirmationSchema,
  ReviewEditsSchema,
  ReviewIntentSchema,
  ReviewSnapshotSchema,
} from './review.ts'
import { HistoryFilterSchema, HistoryRecordSchema, HistorySearchResultSchema } from './history.ts'
import { SettingsSnapshotSchema } from './settings.ts'
import { ModelProgressSchema, ModelSectionSchema } from './models.ts'
import { BootStateSchema } from './boot.ts'
import { EnhancementStatusSchema } from './extraction.ts'
import { RecipeIdSchema } from './recipes.ts'
import { UpdateStatusSchema } from './update.ts'

/**
 * Today's calendar and what the app is currently offering to record.
 *
 * `armed` is an offer, never a recording: a human still presses *Démarrer*
 * (HR-7). `reason` is why nothing is armed, so the empty state can say
 * something better than nothing.
 */
export const AgendaSnapshotSchema = z.object({
  events: z.array(CalendarEventSchema),
  syncedAt: TimestampSchema,
  armed: z
    .object({ meetingId: MeetingIdSchema, eventId: z.string(), subject: z.string() })
    .nullable(),
  reason: z.string(),
})
export type AgendaSnapshotPayload = z.infer<typeof AgendaSnapshotSchema>

/**
 * Renderer → main, request/response. The renderer never reaches main any other
 * way: there is no `ipcRenderer.send` surface.
 */
export const invokeChannels = {
  /**
   * Start a meeting the calendar knows nothing about.
   *
   * Not a fallback. Where Graph is unavailable — no Entra registration yet, a
   * tenant whose consent policy has not been granted, an ad-hoc call that was
   * never an invite — this is the *only* way a session begins, and the product
   * still has to work. Everything downstream of `MeetingContext` is written to
   * accept `eventId: null` for exactly this reason.
   *
   * `clientName` is what the rep types. It is a display name and never a CRM
   * identifier: DEC-7 keeps deterministic data out of anything a human or a
   * model typed, and account resolution still happens against VSA at the
   * review gate.
   */
  'meeting:create': {
    request: z.object({
      /**
       * Blank is normal and is what *Démarrer une réunion* sends.
       *
       * Recording starts on one click, so there is no form in front of it and no
       * subject to ask for — the rep is walking into a call, and a required
       * field there is a form between them and the one thing the product must
       * not miss. The objet is typed in the session header during or after the
       * call (`meeting.renamed`), and until it is, nothing stands in for it:
       * `draftIntents` states the requirement at the gate rather than inventing
       * a name.
       */
      title: z.string().trim().max(200).default(''),
      clientName: z.string().trim().max(200).nullable().default(null),
      /**
       * The instant the rep placed it on, when that is not now (DEC-31).
       *
       * Null means "now", which is what *Démarrer* on today's cell sends and
       * what every caller before the calendar existed sent implicitly. A day
       * other than today sends that day's chosen time, the meeting is drawn in
       * that day's cell, and it is recordable from there — the calendar is the
       * app's own surface, not a rendering of Outlook, so a meeting that is not
       * in anybody's Exchange still belongs in it.
       */
      scheduledStart: TimestampSchema.nullable().default(null),
    }),
    response: MeetingSchema,
  },

  /**
   * The meetings the calendar has to draw, scoped to the window it draws.
   *
   * `limit` alone was a truncation waiting to happen: a month grid paged back
   * far enough outran a flat « most recently updated 200 » and quietly lost the
   * dots under its own days. So the range is part of the question. `from` and
   * `to` bound the **day the meeting belongs on** (DEC-31) — the day the rep
   * placed it on, else the day it ran, else the day it was created — which is
   * the same anchor the grid places a row by, and the same one *période*
   * measures against in `history:search`.
   *
   * Both null is the whole corpus, capped by `limit`. That is what the *Liste*
   * view asks for and what every caller before the grid existed asked for
   * implicitly.
   */
  'meeting:list': {
    request: z.object({
      limit: z.number().int().positive().max(500).default(50),
      from: TimestampSchema.nullable().default(null),
      to: TimestampSchema.nullable().default(null),
    }),
    response: z.array(MeetingSchema),
  },
  /**
   * The objet and the client, as the rep types them in the session header.
   *
   * Separate from `meeting:create` because it is a different moment: creation is
   * one click with nothing filled in, and this is the naming that happens once
   * the call is under way — or after it, from the compte-rendu they are reading.
   * It never touches `MeetingContext`: a meeting armed from Outlook takes its
   * subject from Graph, and letting this overwrite that would make the calendar
   * and the app disagree about the same event.
   */
  'meeting:rename': {
    request: z.object({
      meetingId: MeetingIdSchema,
      title: z.string().trim().max(200),
      /** Null leaves the stored client name alone; `''` clears it. */
      clientName: z.string().trim().max(200).nullable().default(null),
    }),
    response: MeetingSchema,
  },
  'meeting:get': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: z.object({
      meeting: MeetingSchema,
      segments: z.array(TranscriptSegmentSchema),
      signals: z.array(SignalSchema),
      outbox: z.array(OutboxEntrySchema),
      /** The last persisted ProseMirror doc. `null` before the rep types. */
      document: z.unknown().nullable(),
      /**
       * The compte-rendu, once the extraction has produced one — `null` at every
       * other moment, which is every moment before the meeting ends.
       *
       * It is on this channel rather than only behind `review:get` because the
       * session screen draws it beside the rep's own notes as soon as the
       * analysis lands (DEC-5's "exactly once, at meeting end"). That is a
       * *read*, not the gate: it carries no pre-filled form, no drafted intents
       * and no confirmation, so DEC-4 still has one door and `review:get` is
       * still the only thing that opens it. While the meeting is `recording`
       * there is no extraction, so this is null and DEC-23 costs nothing to
       * hold here.
       */
      compteRendu: z.string().nullable(),
      /**
       * Which compte-rendu this meeting is set to produce (DEC-43) — what the
       * header picker draws as current.
       *
       * The meeting's choice, not the stored document's. They differ exactly
       * while a rep has switched the picker and the regeneration has not landed
       * yet, and in that window the picker must show what they just clicked
       * while the pane still shows the document that exists.
       */
      recipe: RecipeIdSchema,
    }),
  },
  /**
   * Choose this meeting's compte-rendu recipe (DEC-43).
   *
   * A channel of its own rather than a field on `meeting:rename`, because the
   * two are different gestures with different consequences: renaming edits a
   * label, and this can spend a model call. When the meeting already has a
   * compte-rendu the handler starts a regeneration and says so — it does not
   * wait for it, because the run takes minutes and the renderer is holding a
   * click. The document that replaces the current one arrives the way every
   * other extraction does, over `session:changed`.
   */
  'meeting:recipe': {
    request: z.object({ meetingId: MeetingIdSchema, recipe: RecipeIdSchema }),
    response: z.object({
      recipe: RecipeIdSchema,
      /** True when a run was started to replace the existing compte-rendu. */
      regenerating: z.boolean(),
      state: MeetingStateSchema,
    }),
  },
  /**
   * The only way a human moves the machine. `command` is the user subset —
   * the renderer cannot fabricate `extractionSucceeded`.
   */
  'session:command': {
    request: z.object({
      meetingId: MeetingIdSchema,
      command: UserCommandSchema,
      /** Free text, recorded on the transition event. */
      reason: z.string().nullable().default(null),
    }),
    response: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), state: MeetingStateSchema }),
      z.object({ ok: z.literal(false), state: MeetingStateSchema, reason: z.string() }),
    ]),
  },
  /** Debounced ~500ms from the editor (DEC-12). */
  'document:save': {
    request: z.object({
      meetingId: MeetingIdSchema,
      revision: z.number().int().nonnegative(),
      doc: z.unknown(),
    }),
    response: z.object({ revision: z.number().int().nonnegative() }),
  },
  'health:snapshot': {
    request: z.object({}),
    response: HealthSnapshotSchema,
  },
  /** The retry behind every disabled control (DEC-26). Never a dead button. */
  'health:retry': {
    request: z.object({ connector: ConnectorIdSchema }),
    response: ConnectorHealthSchema,
  },
  'diagnostics:recent': {
    request: z.object({ limit: z.number().int().positive().max(1000).default(200) }),
    response: z.array(DiagEventSchema),
  },
  'diagnostics:export': {
    request: z.object({ mode: ExportModeSchema }),
    response: z.object({ path: z.string(), events: z.number().int().nonnegative() }),
  },

  /**
   * Identity. A token is never among these: `src/*` may import
   * `core/contracts/` and nothing else, and a bearer token that crosses IPC is
   * a bearer token in a devtools console.
   */
  'auth:state': { request: z.object({}), response: AuthStateSchema },
  /** Opens the system browser. The one channel that may take a minute to settle. */
  'auth:signIn': { request: z.object({}), response: AuthStateSchema },
  'auth:signOut': { request: z.object({}), response: AuthStateSchema },

  'agenda:snapshot': { request: z.object({}), response: AgendaSnapshotSchema },
  /** The refresh button. Forces a Graph sync rather than waiting for the tick. */
  'agenda:refresh': { request: z.object({}), response: AgendaSnapshotSchema },

  /**
   * The review gate (DEC-4). Everything the *Prêt à envoyer* panel renders:
   * the compte-rendu, the pre-filled form with a measured confidence and a
   * source span per row, and the three drafted intents.
   *
   * The response is a closed union. While the meeting is `recording` it carries
   * a reason and **no panel**, so there is nothing for the renderer to surface
   * — DEC-23 is enforced by the shape of the answer, not by a caller
   * remembering to check the state.
   */
  'review:get': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: ReviewSnapshotSchema,
  },
  /**
   * Where this meeting's compte-rendu has got to.
   *
   * Read once when the session screen mounts, because the broadcast of the same
   * name only fires on a change and a screen opened after the change would
   * otherwise show nothing. Same shape from both, computed by the same function
   * in `app/` — two spellings of one answer is how a screen ends up disagreeing
   * with itself across a remount.
   */
  'enhancement:status': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: EnhancementStatusSchema,
  },
  /**
   * Run the extraction now, for a meeting that has ended without one.
   *
   * Separate from `session:command`'s `extract` because that channel dispatches
   * the state machine and nothing else: a renderer that used it would move the
   * meeting to `extracting` with no run behind it, and the rep would watch a
   * state that never resolves. The transition belongs to the code that does the
   * work — `Enhancement` dispatches `extract` itself, once it has a model.
   */
  'enhancement:retry': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: EnhancementStatusSchema,
  },
  /**
   * *Ce qui sera créé*, recomputed from the form as it currently stands.
   *
   * **Why this channel exists at all.** `review:get` drafts the intents from the
   * *pre-fill*, and the rep then edits the form for as long as they like. With
   * only that one call, the panel keeps showing what would have been created
   * before they touched anything — so the one screen whose entire job is « what
   * you read is what the CRM receives » was showing something else. Two ways it
   * bit, and the second is not cosmetic:
   *
   *  · the summaries name the old account and the old task title;
   *  · `available` is `edits.accountId !== null`, so picking an account from the
   *    candidate chips (DEC-18, mitigation *a*) left the opportunity row reading
   *    « Compte non résolu » **and disabled**. Resolving the account could not
   *    enable the opportunity, which is the whole of what that mitigation is
   *    for.
   *
   * It reads nothing and writes nothing: same `draftIntents` as `review:get`
   * and `review:confirm`, called with the renderer's current values. A round
   * trip rather than a copy of the rule in `src/` — the renderer may not import
   * `core/domain/`, and a second implementation of "what will be created" is
   * exactly the drift this screen cannot afford.
   */
  'review:preview': {
    request: z.object({
      meetingId: MeetingIdSchema,
      edits: ReviewEditsSchema,
      intentIds: z.array(z.string().min(1)),
    }),
    response: z.object({ intents: z.array(ReviewIntentSchema) }),
  },
  /**
   * The one confirmation (DEC-4, HR-7). Takes the form as the rep left it plus
   * the intent ids they left checked, records `confirmation.recorded` with
   * those ids, and creates a `push.intent.created` for each — and only each.
   *
   * `confirm` goes through the state machine first, which accepts it from
   * `awaiting_confirmation` and nowhere else. A call arriving mid-call is
   * refused before a single event is written.
   */
  'review:confirm': {
    request: z.object({
      meetingId: MeetingIdSchema,
      edits: ReviewEditsSchema,
      /** What the rep left checked. Unchecking is recorded, never inferred. */
      intentIds: z.array(z.string().min(1)),
    }),
    response: ReviewConfirmationSchema,
  },

  /**
   * The search (DEC-25, DEC-31). One channel, two screens.
   *
   * **The query runs in the main process, and that is the point of the
   * channel.** The alternative — ship every transcript to the renderer and
   * filter there — would put the whole corpus of client conversations in a
   * devtools console, make every keystroke cost the size of the corpus, and
   * break the moment the corpus outgrew a message. What crosses here is a row
   * per meeting plus one short excerpt per surface that matched.
   *
   * `filter` is the four chips (client, période, statut, intention) and it is
   * applied on this side for exactly the same reason. It is optional so a
   * caller with no chips on sends nothing, and absent means « aucun filtre ».
   *
   * An empty `query` with no filter is not an error: it lists the recent calls,
   * which is what both screens show before anybody types.
   *
   * The calendar and *Historique* differ only in `limit` — the calendar's pane
   * shows the first handful and offers the full record; Historique is the full
   * record. Neither ever receives a row it did not ask for.
   */
  'history:search': {
    request: z.object({
      query: z.string().max(200).default(''),
      limit: z.number().int().positive().max(200).default(50),
      filter: HistoryFilterSchema.optional(),
    }),
    response: HistorySearchResultSchema,
  },
  /** One expanded row: the whole record of a call, folded from its log. */
  'history:record': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: HistoryRecordSchema,
  },

  /**
   * Everything Réglages renders, in one read.
   *
   * One channel rather than five because the screen is a snapshot: provider
   * tables, connector states, the DEC-24 probe verdict and the retention policy
   * are read together, once, and kept current afterwards by `health:changed`
   * and `auth:changed` — the broadcasts that already exist.
   */
  'settings:snapshot': { request: z.object({}), response: SettingsSnapshotSchema },

  /**
   * Store a provider credential (DEC-34).
   *
   * The key travels renderer → main **once**, in this request, and stops at the
   * vault. There is deliberately no channel in the other direction: nothing can
   * ask for a stored key back. `settings:snapshot` reports `{stored, hint}` and
   * that is the entire vocabulary the screen has for a secret.
   *
   * Answers with the fresh snapshot rather than an ack, so the row updates from
   * the same read that produced it — a screen that patched its own state on
   * success would be guessing at what the registries now think, and would be
   * wrong the moment a key makes a *different* provider the selected one.
   */
  'settings:setCredential': {
    request: z.object({
      providerId: z.string().min(1),
      /** Trimmed by the handler. Empty is a validation error, not a delete — see below. */
      value: z.string().min(1),
    }),
    response: SettingsSnapshotSchema,
  },

  /**
   * Forget a provider credential.
   *
   * Its own channel rather than `setCredential('')`, because deleting a
   * credential and fat-fingering an empty field must not be the same request.
   */
  'settings:clearCredential': {
    request: z.object({ providerId: z.string().min(1) }),
    response: SettingsSnapshotSchema,
  },

  /**
   * Choose the provider this app will use for a capability.
   *
   * Until now the registries *ranked* and the rep read the outcome. A rank is a
   * good default and a bad prison: the reason someone stores two keys is that
   * they want to pick. Null returns to the ranking (DEC-30's default), which is
   * why this is not a plain string.
   */
  'settings:selectProvider': {
    request: z.object({
      capability: z.enum(['stt', 'llm']),
      providerId: z.string().min(1).nullable(),
    }),
    response: SettingsSnapshotSchema,
  },

  /**
   * Set one of a provider's declared non-secret settings (DEC-34).
   *
   * Separate from `setCredential` because the two have opposite rules about the
   * value. A key is write-only and never handed back; a base URL is written,
   * displayed, corrected and displayed again. Routing a URL through the
   * credential channel would put it in the keychain and then refuse to show it,
   * which is the one place it needs to be visible.
   *
   * An empty value clears the setting, and that is not the inconsistency it
   * looks like next to `clearCredential`: an empty text field on screen *is* the
   * request to unset it, and there is no destructive act here to protect anyone
   * from — the value is on screen, and retyping it costs nothing.
   */
  'settings:setProviderField': {
    request: z.object({
      providerId: z.string().min(1),
      key: z.string().min(1),
      value: z.string(),
    }),
    response: SettingsSnapshotSchema,
  },

  /** Choose the checkpoint the local engine loads (DEC-35). Refused unless `ready`. */
  'settings:selectModel': {
    request: z.object({ modelId: z.string().min(1) }),
    response: SettingsSnapshotSchema,
  },

  /**
   * Start fetching a checkpoint from Hugging Face (DEC-35b).
   *
   * Returns as soon as the download is *accepted*, not when it finishes: the
   * bytes are minutes away and an `invoke` that outlived them would time out
   * somewhere unhelpful. Progress arrives on `models:progress`.
   */
  'models:download': {
    request: z.object({ modelId: z.string().min(1) }),
    response: ModelSectionSchema,
  },

  /** Cancel an in-flight download and clean the partial bytes. */
  'models:cancel': {
    request: z.object({ modelId: z.string().min(1) }),
    response: ModelSectionSchema,
  },

  /**
   * What is downloading right now.
   *
   * Exists because the panel can be unmounted and remounted while bytes are
   * arriving — closing the settings overlay mid-download and reopening it. The
   * old implementation had no such channel: the remounted panel started from
   * zero state and showed an empty progress bar forever, while the worker
   * carried on downloading behind it.
   */
  'models:state': { request: z.object({}), response: ModelSectionSchema },

  /**
   * What screen 0 draws (DEC-30).
   *
   * A channel *and* a broadcast, for the same reason `agenda:snapshot` and
   * `health:snapshot` are: `boot()` resolves all three steps before
   * `createWindow()` is called, so a renderer that only listened would have
   * missed every one of them and sat on three pending lines forever. The
   * broadcast exists for what changes afterwards — the first-run model
   * download, which is the state this screen was designed around.
   */
  'boot:state': { request: z.object({}), response: BootStateSchema },

  /**
   * What Réglages draws under « Mise à jour ».
   *
   * `installable` is recomputed on every read rather than cached, because it
   * depends on the session and the session moves without the updater moving.
   * Réglages reloads this on `session:changed` for the same reason.
   */
  'update:status': { request: z.object({}), response: UpdateStatusSchema },

  /**
   * Check now, because the rep asked.
   *
   * The background loop in `main.ts` already checks on its own schedule; this
   * exists for the tester who has just been told a build is out and does not
   * want to wait for the next tick. Resolves to the state *after* the check —
   * including `error`, which is a legitimate answer and not a rejected call.
   */
  'update:check': { request: z.object({}), response: UpdateStatusSchema },

  /**
   * Download the staged version, on request.
   *
   * Refused while a meeting holds unfinished work, and the refusal carries the
   * reason: half a gigabyte crossing the wire during a call is a way to damage
   * a meeting without touching the capture path (DEC-26).
   */
  'update:download': { request: z.object({}), response: UpdateStatusSchema },

  /**
   * Quit and install. **The only channel here that can end the process.**
   *
   * Re-checks the update gate on the main side before acting, and returns
   * `{ started: false, reason }` when it refuses. The renderer's `installable`
   * is a few milliseconds stale by definition — a meeting can begin between the
   * paint and the click — so the renderer's copy decides what the button looks
   * like and this decides what happens.
   */
  'update:install': {
    request: z.object({}),
    response: z.object({ started: z.boolean(), reason: z.string().nullable() }),
  },
} as const

export type InvokeChannel = keyof typeof invokeChannels
export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeChannels)[C]['request']>
export type InvokeResponse<C extends InvokeChannel> = z.infer<
  (typeof invokeChannels)[C]['response']
>

/** Main → renderer, fire and forget. */
export const broadcastChannels = {
  'session:changed': z.object({ meetingId: MeetingIdSchema, state: MeetingStateSchema }),
  'transcript:appended': z.object({
    meetingId: MeetingIdSchema,
    segment: TranscriptSegmentSchema,
  }),
  'signal:appended': z.object({ meetingId: MeetingIdSchema, signal: SignalSchema }),
  /**
   * The input meter, ten times a second while a meeting records.
   *
   * Peak amplitude per channel on the 0…1 scale, not a decibel and not a grade —
   * the renderer decides how to draw it. This is the only broadcast on this
   * surface that fires on a timer rather than on an event, which is why the
   * component that consumes it subscribes on its own instead of lifting the
   * value into the session screen: ten re-renders a second through the notepad's
   * subtree is ten chances to drop a keystroke.
   */
  'audio:level': z.object({
    meetingId: MeetingIdSchema,
    rep: z.number().min(0).max(1),
    far: z.number().min(0).max(1),
    /**
     * The amplitude below which the transcriber drops a window, so the meter can
     * mark it. Sent with every sample rather than compiled into the renderer
     * because `src/` may import `core/contracts/` and nothing else — a copy of
     * `SPEECH_FLOOR` on the other side of that line could drift from the value
     * `whisper/vad.ts` actually applies, and a mark in the wrong place is worse
     * than no mark. Riding along with the measurement, it cannot disagree.
     */
    floor: z.number().min(0).max(1),
  }),
  /**
   * The compte-rendu's progress, pushed on every change.
   *
   * Needed alongside `session:changed` because the case that matters most makes
   * no transition at all: a meeting that ends with no model configured stays in
   * `ended`, so a screen listening only for state changes learns nothing and
   * draws nothing. That silence was the defect.
   */
  'enhancement:status': z.object({
    meetingId: MeetingIdSchema,
    status: EnhancementStatusSchema,
  }),
  'health:changed': z.object({
    connector: ConnectorIdSchema,
    health: ConnectorHealthSchema,
    at: TimestampSchema,
  }),
  'diag:appended': z.object({ event: DiagEventSchema }),
  /** Pushed on every arming tick, so the agenda never has to poll. */
  'agenda:changed': AgendaSnapshotSchema,
  'auth:changed': AuthStateSchema,
  /**
   * The whole boot state, not a patch. Three fields and a version string is
   * cheaper to send than it is to reconcile, and a splash that has to merge
   * two partial updates in the right order is a splash that can show a step
   * regressing from `ready` to `pending`.
   */
  'boot:changed': BootStateSchema,
  /**
   * One model's download, pushed to **every** live window (DEC-35b).
   *
   * Broadcast rather than answered to the window that asked, because the window
   * that asked may be gone: closing the settings overlay mid-download destroyed
   * the `WebContents` these events used to be sent to, and every subsequent one
   * was dropped while the bytes kept arriving. A download belongs to the app.
   */
  'models:progress': ModelProgressSchema,
  /**
   * The updater's state, whenever it moves.
   *
   * Carries `installable` like the invoke does, so a screen that is already
   * open does not have to ask again to know whether its button may act. The
   * gate is evaluated at broadcast time, which is why `main.ts` also re-emits
   * this on `session:changed`: the state did not move, but the answer did.
   */
  'update:changed': UpdateStatusSchema,
} as const

export type BroadcastChannel = keyof typeof broadcastChannels
export type BroadcastPayload<C extends BroadcastChannel> = z.infer<(typeof broadcastChannels)[C]>

export const INVOKE_CHANNEL_NAMES = Object.keys(invokeChannels) as InvokeChannel[]
export const BROADCAST_CHANNEL_NAMES = Object.keys(broadcastChannels) as BroadcastChannel[]

/**
 * The shape `preload.ts` exposes on `window.app`. Declared here so the renderer
 * gets it from `core/contracts/` — the only folder it is allowed to import.
 */
export interface AppBridge {
  invoke<C extends InvokeChannel>(channel: C, payload: InvokeRequest<C>): Promise<InvokeResponse<C>>
  on<C extends BroadcastChannel>(
    channel: C,
    listener: (payload: BroadcastPayload<C>) => void,
  ): () => void
}
