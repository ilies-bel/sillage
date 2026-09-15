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
import { EssaiResultSchema } from './essai.ts'
import {
  MeetingIdSchema,
  MeetingSchema,
  MeetingStateSchema,
  TimestampSchema,
} from './meeting.ts'
import { TranscriptSegmentSchema, TranscriptViewSchema } from './transcript.ts'
import { MARK_NOTE_MAX, MomentMarkSchema } from './marks.ts'
import { SignalSchema } from './signals.ts'
import { ConnectorHealthSchema, ConnectorIdSchema, HealthSnapshotSchema } from './health.ts'
import { CapturePermissionSchema } from './permissions.ts'
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
import { MENTION_MAX_CHARS } from './mention.ts'
import { SettingsSnapshotSchema } from './settings.ts'
import { ModelProgressSchema, ModelSectionSchema } from './models.ts'
import { BootStateSchema } from './boot.ts'
import { EnhancementStatusSchema } from './extraction.ts'
import { RecipeIdSchema } from './recipes.ts'
import { UpdateStatusSchema } from './update.ts'
import { AskAnswerSchema } from './ask.ts'
import { OnboardingStateSchema } from './onboarding.ts'

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
  /**
   * **What Graph was actually asked about**, so the calendar can stop asserting
   * things about days it never queried.
   *
   * `modules/calendar/delta.ts` syncs yesterday through a week ahead — eight
   * days — while `Agenda.tsx` draws a six-week grid. *Mois* and *Liste*
   * therefore said « Aucune réunion ce jour-là. » about **thirty-four of
   * forty-two days** on which nothing had been looked up, and explained that
   * emptiness with `reason` — which is the *arming* reason, so an empty Thursday
   * three weeks out was accounted for by « Teams émet du son ».
   *
   * Nobody can widen the window for free: a delta link bakes its range in and
   * keeps answering for that range forever. So the honest fix is to say which
   * days the answer covers and let the empty state distinguish « nothing that
   * day » from « not asked ».
   */
  window: z.object({ from: TimestampSchema, to: TimestampSchema }),
  armed: z
    .object({
      meetingId: MeetingIdSchema,
      /**
       * Null for an **unscheduled** call — one detected by a conferencing
       * application holding a microphone with nothing in the calendar
       * (`core/domain/adHoc.ts`). The renderer reads the null to know there is no
       * calendar row to point the offer at.
       */
      eventId: z.string().nullable(),
      subject: z.string(),
    })
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
  /**
   * Arm a scheduled event **now**, because the rep said so.
   *
   * `core/domain/arming.ts` decides this on its own — a five-minute window
   * around the event × a conferencing process running — and that decision is a
   * *guess at what the rep would want*. Everything else on the agenda row
   * assumed the guess was the only way in, and the cost of that was a screen
   * with nothing on it: an upcoming event the calendar knows about but which has
   * produced no meeting yet has `meetingId === null`, and
   * `src/screens/agenda/DayPane.tsx` renders its control inside
   * `{meetingId ? … : null}`. **Four of five upcoming rows were inert** — no
   * button, and the row is not clickable either.
   *
   * A sales call starting ten minutes early is an ordinary Tuesday, and the only
   * control the rep had was « Démarrer une réunion » in the header, which
   * `meeting:create`'s own docblock describes as « a meeting the calendar knows
   * nothing about ». Taking it costs `eventId`, and with it every deterministic
   * fact DEC-7 says may not come from a model: the attendees, so the
   * compte-rendu's « Interlocuteurs » line is empty and `speakerLabel` can never
   * resolve « exactly one interlocutor on the far side means the far channel
   * *is* that person » — every turn reads « Client » for the rest of the call —
   * and the strongest signal VerySwing account resolution has.
   *
   * So the rep gets the same door the clock has, and it is the **same door**:
   * this reaches `Agenda`'s own arm path, so the meeting id, the subject and
   * `MeetingContext` are composed exactly as an automatic arming composes them.
   * A second way to create a calendar-linked meeting would be a second thing to
   * keep equal.
   *
   * It is bounded by the fold: only an event the current agenda actually holds
   * can be named, so this is not a verb for arming an arbitrary string. And it
   * does not consult `decideArming` — that is the point. The detector exists to
   * guess; the rep has said. Same shape as DEC-45, where the dry run's verdict
   * outranks the boot probe because one is a measurement and the other is an
   * inference.
   */
  'agenda:arm': {
    request: z.object({ eventId: z.string().min(1).max(512) }),
    response: z.object({
      /** The meeting now armed, ready for the renderer to open. */
      meetingId: MeetingIdSchema,
    }),
  },
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
   *
   * **It used to carry `state`, and that field could not answer the question it
   * was added for.** The renderer's question is « did the rewrite start », because
   * a run that cannot start leaves the gate open with nothing arriving. Driven
   * against the real `Orchestrator` and the real `Enhancement`, wired the way
   * `main.ts` wires them, the handler answered `awaiting_confirmation` in **both**
   * cases: it reads `stateOf` synchronously and the decision sits two microtasks
   * away, behind `orchestrator.enhance`'s `await stopRecording`. Measured —
   * `{"recipe":"libre","regenerating":true,"state":"awaiting_confirmation"}`
   * whether a model existed or not, with `session:changed → extracting` and
   * `enhancement:status → running` arriving a turn later in the one case and
   * `enhancement:status → idle` in the other. `check:surfaces` could not see that
   * nobody read it: its reader-join is `\bstate\b`, which the calling file
   * matches ten times over. The answer the renderer wants is
   * `enhancement:status`, which is the one function in the product that composes
   * it.
   */
  'meeting:recipe': {
    request: z.object({ meetingId: MeetingIdSchema, recipe: RecipeIdSchema }),
    response: z.object({
      recipe: RecipeIdSchema,
      /**
       * True when a run was *asked for* to replace the existing compte-rendu —
       * never a claim that one started. `void runEnhancement?.(…)` is fired and
       * not awaited, and whether it starts is `enhancement:status`' answer.
       */
      regenerating: z.boolean(),
    }),
  },
  /**
   * The only way a human moves the machine. `command` is the user subset —
   * the renderer cannot fabricate `extractionSucceeded`.
   */
  'session:command': {
    request: z.object({
      meetingId: MeetingIdSchema,
      /*
       * **Not `UserCommandSchema`, which is wider than this channel may be.**
       *
       * This handler dispatches the state machine and does nothing else, and
       * `extract` already has its own channel for exactly that reason (see
       * below): a renderer that moved a meeting to `extracting` with no run
       * behind it would leave the rep watching a state that never resolves.
       *
       * **`confirm` is the same hazard with no recovery.** Driven over the
       * bridge it answered `{"ok":true,"state":"pushing"}` with zero intents
       * created, zero rows in the outbox and no `confirmation.recorded` — and
       * `pushSettled`'s guard requires at least one intent, so it self-loops,
       * `abort` is illegal from `pushing`, and the gate reads « Envoi en cours… »
       * for the life of the database about a compte-rendu that was never sent.
       * It is also a second path past the one confirmation (DEC-4, HR-7): the
       * write into a client's CRM belongs to `review:confirm`, which drafts the
       * intents, records what the rep confirmed, and dispatches this itself.
       */
      command: z.enum(['start', 'end', 'abort']),
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
  /**
   * Where consent stands, platform-neutral (`core/contracts/permissions.ts`).
   *
   * Read on demand rather than broadcast: a rep grants a permission in another
   * window and comes straight back, so the row re-asks when it is shown and
   * after the pane has been opened. The renderer reads `state`,
   * `channel` and `canOpenSettings` and branches on nothing else — it must
   * never learn which platform it is on.
   */
  'capture:permission': {
    request: z.object({}),
    response: CapturePermissionSchema,
  },
  /**
   * The one remedy for a refusal: the OS's own privacy pane.
   *
   * Never a second prompt — the OS silently returns the old answer, so asking
   * again is the dead control DEC-26 forbids. `opened: false` is the honest
   * answer on a host with no such pane, and it is reported rather than
   * swallowed.
   */
  'capture:permission:open': {
    request: z.object({}),
    response: z.object({ opened: z.boolean() }),
  },
  /**
   * The dry run (`core/contracts/essai.ts`): open both channels for a fixed
   * number of seconds, report what was heard on each, keep nothing.
   *
   * An `invoke` that resolves when the listening is over rather than a
   * start/stop pair, because the trial has one honest shape — it runs for its
   * twenty seconds and reports — and a pair would need a state machine, a
   * timeout for the renderer that navigates away mid-trial, and an answer to
   * « what does a second start mean ». While it runs it broadcasts `audio:level`
   * under `ESSAI_MEETING_ID`, so the meter a rep sees here is the meter they
   * will see during the call, drawn from the same measurement.
   */
  'capture:essai': {
    request: z.object({}),
    response: EssaiResultSchema,
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
  /**
   * **Pause is a capture verb, not a meeting state.**
   *
   * The machine stays in `recording`: one recording at a time, the crash sweep,
   * `liveIds()` and the widget's existence all key on that state and none of
   * them has an opinion about a rep who stepped out for two minutes. What a
   * pause does is upstream of all of them — `Recording` stops handing frames to
   * the transcriber and `EndOfMeetingWatch` holds its silence clock, so a held
   * call is neither transcribed nor ended for being quiet. The input meter goes
   * on: proof of life is the meter, never the transcript (DEC-38), and a paused
   * meter that fell silent would look exactly like a dead device.
   *
   * Idempotent — `paused: true` on a paused call answers `true` and changes
   * nothing — and answered with the truth: a meeting that is not recording
   * answers `false`, which is what the widget then draws.
   */
  'session:pause': {
    request: z.object({ meetingId: MeetingIdSchema, paused: z.boolean() }),
    response: z.object({ paused: z.boolean() }),
  },

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
   * The stored transcript of the meeting at the gate — read on demand, when the
   * rep asks to see a citation in context.
   *
   * **Why it is a channel and not a field on `ReviewPanel`.** The panel is read
   * every time the gate opens and again on every `session:changed`; a
   * fifty-minute call is several hundred segments, and shipping all of them on
   * a screen most reps confirm without opening a single source would put the
   * whole conversation across the bridge for nothing. This is asked for once, by
   * a click, and never at all if nobody clicks.
   *
   * **It is not the live transcript pane DEC-38 removed.** That surface was a
   * proof of life during a call, it was seconds late, and the input meter
   * replaced it. This is the record afterwards: DEC-21 verifies every citation
   * against exactly these segments, and `[source ▸]` has always pointed at them
   * — it simply had no way to show them. Nothing here streams and nothing here
   * renders while the meeting is `recording`.
   *
   * Final segments only, ascending. An interim is never persisted as an event
   * and can never be cited, so a reader that showed them would be showing text
   * the verification did not run against.
   */
  'review:transcript': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: TranscriptViewSchema,
  },

  /**
   * **The rep marking a moment of their own call** (`core/contracts/marks.ts`).
   *
   * Refused unless the meeting is recording, and the refusal is the honest one:
   * « ce moment » has no referent once the call is over, and a mark stamped
   * after the fact would sit in the reader among turns it has nothing to do
   * with. The gate is the place to say something about a call that has ended.
   *
   * The id is minted in the main process, not in the renderer: two windows can
   * press this — the session screen and the widget floating over Teams — and an
   * id generated on either side would be two sources for one identity.
   */
  'meeting:mark': {
    request: z.object({
      meetingId: MeetingIdSchema,
      note: z.string().trim().max(MARK_NOTE_MAX).default(''),
      /** The turn the rep pressed on, or null for the pill's own button. */
      segmentId: z.string().min(1).nullable().default(null),
    }),
    response: MomentMarkSchema,
  },

  /**
   * **A mark the rep takes back.**
   *
   * It is typed one-handed into a box floating over a client's face and sent on
   * `Enter`, so a mistake is made here more easily than anywhere else in the
   * product — and until this existed there was no way to correct one, on a note
   * the rep reads again at the gate in their own words.
   *
   * Not restricted to a recording, unlike `meeting:mark`: « ce moment » has no
   * referent once the call is over, but « that one was a typo » has one for as
   * long as the mark does.
   */
  'meeting:forget': {
    request: z.object({ meetingId: MeetingIdSchema, markId: z.string().min(1) }),
    response: z.object({ forgotten: z.boolean() }),
  },

  /**
   * **What the widget draws** (`app/windows/Overlay.ts`).
   *
   * One read on open, then kept current by `session:changed`, `audio:level`,
   * `health:changed` and `moment:marked` — the broadcasts that already exist,
   * reaching this window because a broadcast goes to every window and not to
   * the one that asked.
   *
   * `null` means « no call is being recorded ». The widget is destroyed in that
   * state rather than drawn empty, so this answers null only in the frame
   * between the meeting ending and the window closing, and on the first read of
   * a window that opened on a race.
   */
  'widget:state': {
    request: z.object({}),
    response: z.object({
      meeting: z
        .object({
          meetingId: MeetingIdSchema,
          /** The objet as the rep typed it, or empty until they do (DEC-31). */
          title: z.string(),
          clientName: z.string().nullable(),
          startedAt: TimestampSchema,
          marks: z.array(MomentMarkSchema),
          /** Frames are being dropped before the transcriber (`session:pause`). */
          paused: z.boolean(),
        })
        .nullable(),
      /**
       * The sentence the pill's « Prévenir le client » press hands over (US-19).
       *
       * It rides here rather than on `settings:snapshot` for two reasons. The widget
       * does not call that channel at all — it would be a second round trip on the
       * one critical path the window is deliberately held off screen for
       * (`MEASURE_DEADLINE_MS`), while two audio devices are opening and a
       * transcriber is booting. And it arrives with the **same** answer the pill is
       * measured on, so the control cannot be drawn before the sentence exists.
       *
       * Already resolved by `resolveMentionSentence`, so the renderer holds no
       * fallback of its own: a default written in two places is a default that will
       * stop agreeing with itself.
       */
      mentionSentence: z.string().min(1),
    }),
  },

  /**
   * The widget telling the main process how big it has become.
   *
   * The window is frameless and transparent, so every pixel of it that is not
   * the pill is a pixel of Teams the rep cannot click. Sizing it from the
   * content is what keeps that area zero — and the content is the only thing
   * that knows, because it is the collapsed pill or the expanded card depending
   * on a press that happened in the renderer.
   *
   * It moves one window, the overlay, whichever window sends it. That is not an
   * oversight: there is one overlay, `IpcDeps.widget` is absent when there is
   * none, and the alternative — routing on `event.sender` — would put the
   * window registry inside the routing layer to defend against a renderer that
   * is this product's own and is served under `connect-src 'self'`.
   */
  'widget:resize': {
    request: z.object({
      width: z.number().int().positive().max(1000),
      height: z.number().int().positive().max(1000),
      /**
       * Where the pill is inside the frame, and how tall it is.
       *
       * Measured and sent rather than agreed as a constant: the shadow margin
       * around the card belongs to the renderer, and a number two files have to
       * keep equal is a number that will stop being equal. It is what lets the
       * main process put the window wherever leaves the **pill** exactly where
       * it was — the first version anchored a window edge, which moved the
       * control the rep had just pressed by the height of the panel.
       */
      pillTop: z.number().int().nonnegative().max(1000).default(0),
      pillHeight: z.number().int().nonnegative().max(1000).default(0),
    }),
    response: z.object({
      ok: z.boolean(),
      /**
       * Which way the panel stacks. Decided by the main process, because only
       * it knows which display the pill is on — and answered here, on the reply
       * to the renderer's own measurement, because the renderer needs it
       * *before* it lays the panel out or the first frame draws in the wrong
       * place.
       *
       * It is answered here **and** broadcast on `widget:placed`, and those are
       * two different events rather than a duplicate: this one is « you asked,
       * here is the answer for the layout you are about to do », and the
       * broadcast is « the answer changed and you did not ask ». A drag across
       * the display's midline resizes nothing, so there is no request to reply
       * to and the renderer would otherwise go on stacking the panel off the
       * top of the screen.
       */
      above: z.boolean(),
    }),
  },

  /**
   * **The halo is not the widget.**
   *
   * The card draws a shadow, and a shadow needs pixels outside the card to land
   * on — which on a transparent always-on-top window are pixels of the call
   * underneath that the rep cannot click. The renderer says when the pointer is
   * over that margin and the window stops taking the mouse
   * (`setIgnoreMouseEvents(…, { forward: true })`), which still delivers mouse
   * *moves* so it can notice the pointer coming back and switch it off again.
   */
  'widget:passThrough': {
    request: z.object({ through: z.boolean() }),
    response: z.object({ ok: z.boolean() }),
  },

  /**
   * **The widget has armed its exit and says how long it needs.**
   *
   * The pill is destroyed when the recording stops, and `destroy()` is
   * instantaneous: a card with a shadow over a video call vanished between two
   * frames, at the one moment the rep is certainly looking at it — they had just
   * pressed its *Terminer*. Everything else in this product that leaves the
   * screen fades (`--motion`, `animate-rise-in`); the one surface drawn *over
   * another application* popped.
   *
   * A fixed wait in the main process was the obvious fix and the wrong one in
   * both directions. Too short and a loaded machine — a call being transcribed,
   * which is the only condition this window exists in — never paints the first
   * animated frame, so the rep sees exactly the pop the wait was added to
   * remove. And with `prefers-reduced-motion` the durations collapse to `0ms`,
   * so a constant would hold a static pill on screen for a fifth of a second
   * after the call ended, for the rep who asked for less motion.
   *
   * So the renderer answers with the duration **it** resolved, read off its own
   * computed style, and the main process destroys the window that long after the
   * reply. The reply is sent before the first animated frame is painted
   * (a layout effect), so the window always outlives the animation rather than
   * approximately matching it. `0` means there is nothing to wait for and the
   * window goes now, which is what reduced motion asks for.
   *
   * It is **not** load-bearing: `Overlay` starts a fallback timer when it asks,
   * and a renderer that never replies loses its window all the same. A pill that
   * outlives the call it reports is worse than a pill that pops.
   */
  'widget:left': {
    request: z.object({
      /** What the renderer's own transition will take, in milliseconds. */
      afterMs: z.number().finite().nonnegative(),
    }),
    response: z.object({ ok: z.boolean() }),
  },

  /**
   * **« I am mounted, and I will have a size for you within N ms. »**
   *
   * The widget's first frame is a handshake across a process boundary and the two
   * halves were armed **from different clocks**. `Overlay` arms `FIRST_FRAME_MS`
   * (300) inside its `ready-to-show` handler; `Widget.tsx` arms
   * `MEASURE_DEADLINE_MS` (200) from its own React mount. The hundred milliseconds
   * between them is not margin — it is a hundred milliseconds *minus* the gap
   * between `ready-to-show` in the main process and the mount in the renderer, and
   * that gap is on the critical path of `startRecording`: two audio devices opening
   * and a transcriber booting, on a Windows laptop (HR-2), while the harness's own
   * answer to `widget:state` is 150 ms of it. Measured on this Mac at **81 ms and
   * 47 ms** across two launches, leaving a real margin of 19 and 53. Lose it and
   * the main process wins a race it has the *worse* answer to: what
   * `FIRST_FRAME_MS` reveals when it fires is `INITIAL_SIZE`, 232×52, forty-nine
   * pixels narrower than the pill and carrying « Aucun enregistrement » over a live
   * call. `harnessFixture.test.ts` holds the four constants in order and could
   * never see this, because an ordering between constants is not an ordering
   * between *expiries* when the origins differ.
   *
   * So the renderer states its own deadline from its own mount, one IPC hop before
   * this arrives, and `Overlay` re-arms from *that* instant. One origin, and the
   * ordering is then true by construction rather than by a subtraction nobody had
   * done.
   *
   * It is **not** load-bearing, the same way `widget:left` is not: a renderer that
   * never sends it keeps the `ready-to-show` deadline it has today, and
   * `APPEARANCE_MS` is above both. A widget that does not appear is worse than one
   * that appears wrong (DEC-26) — the rep has no taskbar entry and nothing to
   * alt-tab to.
   */
  'widget:measuring': {
    request: z.object({
      /**
       * How long from *now* the renderer may take to report a size. Its own
       * `MEASURE_DEADLINE_MS`, sent rather than agreed, because a number two files
       * have to keep equal is a number that will stop being equal — the same reason
       * `pillTop` is measured and `widget:left` carries `afterMs`.
       */
      withinMs: z.number().finite().nonnegative().max(5_000),
    }),
    response: z.object({ ok: z.boolean() }),
  },

  /**
   * **Bring the main window back**, and put it on this meeting.
   *
   * The widget's way out of itself: the rep is in Teams, they want the notepad,
   * and the Sillage window is behind three others — on Windows it may be
   * minimised, where `focus()` alone does nothing. This restores, shows and
   * focuses it, then broadcasts `session:open` so the window lands on the call
   * rather than on whatever screen it was left on.
   *
   * It is the second thing in the product that navigates without the rep having
   * pressed something inside the main window, and like the first — the 14:30
   * notification (DEC-46) — it happens only on a press the rep made.
   */
  'window:focus': {
    request: z.object({ meetingId: MeetingIdSchema.nullable().default(null) }),
    response: z.object({ ok: z.boolean() }),
  },
  /**
   * *Demander* — one question about one call, answered from that call's record
   * (`core/contracts/ask.ts`).
   *
   * Asked by a gesture and never on its own: it spends a model call, so nothing
   * prefetches it and there is no such thing as an empty answer arriving with
   * the screen.
   *
   * It writes nothing. The answer is not appended to the meeting's log, is not a
   * fact about it, and is gone when the rep asks the next question — the same
   * standing *Historique* has as a reader over the log (DEC-25). Making it
   * durable would mean deciding what an answer *means* when the transcript it
   * was derived from is re-read months later, and the honest answer to that is
   * « ask again ».
   */
  /**
   * Whether first run has happened (`core/contracts/onboarding.ts`).
   *
   * Two channels rather than one flag on `settings:snapshot`, because the write
   * has to be able to happen from a screen that never opens Réglages, and
   * folding it into the settings payload would make dismissing an onboarding a
   * settings change — which every provider table and every deferred enhancement
   * listens to.
   */
  'onboarding:state': {
    request: z.object({}),
    response: OnboardingStateSchema,
  },
  /**
   * Recorded on the way out, whichever way the rep left it. Nagging somebody who
   * said no is how an onboarding becomes the thing people close without reading.
   */
  'onboarding:seen': {
    request: z.object({}),
    response: OnboardingStateSchema,
  },
  'meeting:ask': {
    request: z.object({
      meetingId: MeetingIdSchema,
      question: z.string().min(1).max(500),
    }),
    response: AskAnswerSchema,
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
  /**
   * « Cette machine uniquement » (DEC-37).
   *
   * Answers the whole snapshot rather than an ack, like every other settings
   * write here: turning it on **removes** every remote engine from the
   * candidate set, so the tables the screen is drawing change under the switch
   * the rep just pressed, and a screen that patched its own state would show a
   * cloud provider still marked « Utilisé » while the next meeting ran on
   * Whisper.
   */
  'settings:setOfflineOnly': {
    request: z.object({ value: z.boolean() }),
    response: SettingsSnapshotSchema,
  },

  'settings:selectProvider': {
    request: z.object({
      capability: z.enum(['stt', 'llm']),
      providerId: z.string().min(1).nullable(),
    }),
    response: SettingsSnapshotSchema,
  },

  /**
   * The sentence the rep reads to the client (US-19, `core/contracts/mention.ts`).
   *
   * `z.string()` and not `.min(1)`: an empty field **is** the request to return to
   * the default, and the snapshot answers with what the product will actually use,
   * so the box refills itself with the default rather than staying blank. That is
   * the `setProviderField` rule and not the `clearCredential` one — the value is on
   * screen, retyping it costs nothing, and there is nothing destructive to protect
   * anyone from.
   *
   * Bounded by `MENTION_MAX_CHARS`, which is a statement about a *window*: the card
   * is drawn inside the frameless, always-on-top overlay that is sized to its own
   * content, over the face of the person on the call. The bound is stated on the
   * field and enforced here; nothing truncates, because a sentence silently cut in
   * half is one a rep reads out to a client with the end missing.
   */
  'settings:setMentionSentence': {
    request: z.object({ value: z.string().max(MENTION_MAX_CHARS) }),
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
  /**
   * The pause flipped, on either surface. The widget and the session screen
   * both draw it, and neither trusts its own press: the answer to
   * `session:pause` is one window's, this is every window's.
   */
  'recording:paused': z.object({ meetingId: MeetingIdSchema, paused: z.boolean() }),
  'transcript:appended': z.object({
    meetingId: MeetingIdSchema,
    segment: TranscriptSegmentSchema,
  }),
  'signal:appended': z.object({ meetingId: MeetingIdSchema, signal: SignalSchema }),
  /**
   * A mark the rep just made, to every window (`core/contracts/marks.ts`).
   *
   * Both windows that can make one also draw the list, and the one that did not
   * press is the one that would otherwise be wrong: a rep who marks from the
   * widget and then opens the session screen must not find a list that is one
   * short.
   */
  'moment:marked': z.object({ meetingId: MeetingIdSchema, mark: MomentMarkSchema }),
  /**
   * **The widget's placement changed and the widget did not ask.**
   *
   * `widget:resize` answers `above` on the reply, which covers every change the
   * renderer *caused*. Two changes it does not cause, and both were silent:
   *
   *   · **A display went away.** `placeWindow`'s quarter-overlap rule is the
   *     defence against the one unrecoverable window in this product — frameless,
   *     always on top, absent from the taskbar, nothing to alt-tab to — and it
   *     ran nowhere but on the reply to a resize. So a rep who dragged the pill
   *     onto a second monitor and unplugged it was rescued only when the *next
   *     turn of the call* changed the frame's height, which is to say: never,
   *     when transcription is the thing that has died. Measured on the shipped
   *     `Overlay`: pill at y=1920 with the remaining work area ending at 877.
   *   · **A drag across the display's midline.** `flex-col` becomes
   *     `flex-col-reverse`, which moves the pill by the panel's whole height and
   *     leaves the frame exactly `width × height` — no resize, no request, no
   *     reply, and the renderer went on stacking the panel off the top of the
   *     screen.
   *
   * So the main process owns re-placement, because only it knows about displays,
   * and says so on a channel of its own. It carries nothing but the stacking
   * direction: *where* the window is, the main process has already moved it to.
   */
  'widget:placed': z.object({ above: z.boolean() }),
  /**
   * **Play your exit** — the one broadcast addressed to a single window.
   *
   * Sent straight to the leaving window's `webContents`, never through
   * `broadcast()`, and that is the whole reason it is worth a note: a recording
   * can stop and another start inside the same second (a rep taking two calls
   * back to back), so for a moment there are two widget windows — the one fading
   * out and the one that has just appeared. A fan-out over every window would
   * tell the new pill to leave as well, and it would, silently, leaving the rep
   * with nothing over their live call.
   *
   * It carries nothing. The renderer's answer is `widget:left`, which carries
   * the only number either side needs.
   */
  'widget:leave': z.object({}),
  /**
   * And the other half: a mark the rep took back.
   *
   * Both of these are **the only way** the widget's list changes — it does not
   * insert what it just asked for. That was worth fixing rather than
   * decorating: an optimistic insert draws a mark that may not have been
   * written, and it leaves the broadcast doing nothing, which is how a channel
   * ends up declared and unreached (`scripts/check-surfaces.mjs`). One path, and
   * the row on screen is the row in the log.
   */
  'moment:forgotten': z.object({ meetingId: MeetingIdSchema, markId: z.string().min(1) }),
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
  /**
   * **Open this meeting** — the app asking the window to go somewhere.
   *
   * The only broadcast that navigates, and it exists for one case: the rep is in
   * Teams, the 14:30 has started, and Sillage is behind three windows with the
   * offer on a screen nobody is looking at. The OS notification is what reaches
   * them; this is what the notification's click does. Everything else in this
   * product is the rep asking the app, and it stays that way — nothing sends
   * this on a timer, only on a click the rep made.
   */
  'session:open': z.object({ meetingId: MeetingIdSchema }),
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
