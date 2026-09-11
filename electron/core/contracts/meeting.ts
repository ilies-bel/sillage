/**
 * Meeting identity, calendar context and the session state vocabulary.
 *
 * `MeetingContext` is the deterministic-fact source (DEC-15). Everything in it
 * comes from Microsoft Graph and none of it is ever produced by a model (DEC-7).
 */
import { z } from 'zod'

/** Opaque, app-minted. Not the Graph event id — a meeting can exist without one. */
export const MeetingIdSchema = z.string().min(1)
export type MeetingId = z.infer<typeof MeetingIdSchema>

export const AttendeeTypeSchema = z.enum(['required', 'optional', 'resource'])
export type AttendeeType = z.infer<typeof AttendeeTypeSchema>

export const ResponseStatusSchema = z.enum([
  'none',
  'organizer',
  'tentativelyAccepted',
  'accepted',
  'declined',
  'notResponded',
])
export type ResponseStatus = z.infer<typeof ResponseStatusSchema>

/**
 * `email` is deliberately not `z.email()`. Graph returns room resources and
 * on-premises mailboxes whose SMTP address does not round-trip through a strict
 * RFC check, and dropping an attendee is worse than carrying an odd string:
 * attendee surnames are the highest-value STT boost terms in the product
 * (DEC-17) and the address is the primary entity-resolution key (DEC-18).
 */
export const AttendeeSchema = z.object({
  name: z.string(),
  email: z.string(),
  type: AttendeeTypeSchema,
  response: ResponseStatusSchema,
})
export type Attendee = z.infer<typeof AttendeeSchema>

export const SensitivitySchema = z.enum(['normal', 'personal', 'private', 'confidential'])
export type Sensitivity = z.infer<typeof SensitivitySchema>

/** Epoch milliseconds, UTC. The app has exactly one time representation. */
export const TimestampSchema = z.number().int()

/**
 * How long past its scheduled end an event stays recordable.
 *
 * Twenty minutes. DEC-9 says in as many words that sales calls overrun
 * constantly, and the rule this bounds used to be « `now >= scheduledEnd` →
 * skip », which stopped both the automatic offer and the manual control at the
 * scheduled minute — at the moment a conversation is going *well enough to run
 * late*. What the rep had instead was « Démarrer une réunion », which drops
 * `eventId` and with it the attendees, « Interlocuteurs », `speakerLabel`'s one
 * chance to name the far channel after a person rather than « Client », and the
 * strongest signal account resolution has.
 *
 * **It lives in `contracts` for the reason `meetingAnchor` and `speakerLabel`
 * do**: two surfaces apply it and `src/*` may import nothing else.
 * `core/domain/arming.ts` uses it to decide whether to keep *offering* — and
 * only while a microphone is still held, because the schedule alone is not
 * evidence the call is still happening. `src/screens/agenda/entries.ts` uses it
 * to decide whether the row is *past*, and there the microphone does not come
 * into it: `Agenda.armNow` deliberately does not consult `decideArming` — the
 * detector guesses, the rep has said — so the control has to be there even on a
 * machine with no microphone signal at all (an older binary, macOS before 14.4,
 * a locked-down Windows box, or a call taken on a desk phone).
 *
 * Written in two files as two numbers, they would drift the first time one
 * moved; that is the lesson `PROCESS_TTL_MS` and `ARM_POLL_MS` had to learn the
 * expensive way.
 */
export const OVERRUN_GRACE_MS = 20 * 60_000

export const MeetingContextSchema = z.object({
  /** Graph `event.id`. Null for a manually started session with no calendar entry. */
  eventId: z.string().nullable(),
  subject: z.string(),
  /** Graph `event.bodyPreview` — the agenda, as text. Never the full HTML body. */
  agenda: z.string(),
  organizer: AttendeeSchema,
  attendees: z.array(AttendeeSchema),
  onlineMeetingJoinUrl: z.string().nullable(),
  categories: z.array(z.string()),
  sensitivity: SensitivitySchema,
  scheduledStart: TimestampSchema,
  /** Bounds the session and sizes the end-of-meeting grace window (DEC-16). */
  scheduledEnd: TimestampSchema,
  /** Links the calls in a recurring series (DEC-15). Deferred in step 3. */
  seriesMasterId: z.string().nullable(),
  /** IANA zone the event was read in. Always `Europe/Paris` in v1. */
  timeZone: z.string(),
})
export type MeetingContext = z.infer<typeof MeetingContextSchema>

/**
 * Arming is a pure decision over a calendar event plus the current audio state
 * (`core/domain/arming.ts`, step 3). `wait` carries the instant to re-evaluate,
 * so the caller never polls on a guess.
 */
export const ArmingDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('arm'), reason: z.string() }),
  z.object({ action: z.literal('wait'), untilMs: TimestampSchema, reason: z.string() }),
  z.object({ action: z.literal('skip'), reason: z.string() }),
])
export type ArmingDecision = z.infer<typeof ArmingDecisionSchema>

/**
 * The session state machine's vocabulary. Declared here rather than in
 * `app/session/` because the renderer reads it and the renderer may import
 * `core/contracts/` only.
 */
export const MeetingStateSchema = z.enum([
  'idle',
  'armed',
  'recording',
  'ended',
  'extracting',
  'awaiting_confirmation',
  'pushing',
  'done',
  'aborted',
])
export type MeetingState = z.infer<typeof MeetingStateSchema>

/**
 * Everything that can move the machine. Declared beside the states because a
 * transition table is only readable when both halves of it are in one place.
 */
export const SessionCommandSchema = z.enum([
  'arm',
  'disarm',
  'start',
  'end',
  'abort',
  'extract',
  'extractionSucceeded',
  'extractionFailed',
  'confirm',
  'pushSettled',
])
export type SessionCommand = z.infer<typeof SessionCommandSchema>

/**
 * The subset a human may issue. The rest are reported *by* modules as work
 * completes — the renderer cannot claim an extraction succeeded, and a module
 * cannot confirm on the rep's behalf (HR-7: a human confirms or it does not
 * ship).
 */
export const UserCommandSchema = z.enum(['start', 'end', 'abort', 'extract', 'confirm'])
export type UserCommand = z.infer<typeof UserCommandSchema>

/**
 * **What a meeting is doing, in one French line each.**
 *
 * Two surfaces read it and both put it in front of a rep. `reviewAvailability`
 * uses it to say why the gate is closed, and `MeetingSession.dispatch` uses it
 * to say why a command was refused — which used to be
 * « confirm is not legal from pushing », rendered verbatim in a `role="alert"`
 * banner at the gate on the likeliest gesture at the most consequential screen,
 * a second press of *Valider*. The transition identifier is still what the
 * diagnostic records: it is precise, it is what a support reader needs, and it
 * is not a sentence.
 *
 * One table rather than two, because two screens naming the same state
 * differently is two things for a rep to reconcile — the reason `meetingAnchor`
 * and `speakerLabel` live here as well.
 */
export const STATE_REASON: Record<MeetingState, string> = {
  idle: 'La réunion n’a pas encore démarré.',
  armed: 'La réunion n’a pas encore démarré.',
  recording: 'Réunion en cours.',
  ended: 'Compte-rendu en attente d’analyse.',
  extracting: 'Analyse en cours…',
  awaiting_confirmation: 'En attente de votre validation.',
  pushing: 'Envoi en cours…',
  done: 'Déjà validée.',
  aborted: 'Réunion abandonnée.',
}

/**
 * A projection row, not a source of truth. Rebuildable by folding the event
 * log (ARCHITECTURE.md §5.C). Never written to directly.
 */
export const MeetingSchema = z.object({
  id: MeetingIdSchema,
  state: MeetingStateSchema,
  title: z.string(),
  eventId: z.string().nullable(),
  /** Resolved client display name, when one is known. Not a CRM identifier. */
  clientName: z.string().nullable(),
  /**
   * The day this meeting belongs on — `context.scheduledStart` for a meeting
   * that came from the calendar, the day the rep placed it on for one they
   * created by hand (DEC-31).
   *
   * Null only for a meeting started for right now with no calendar entry, where
   * `createdAt` *is* the day. It is here and not derived in the renderer
   * because « le calendrier est toujours dessiné » means a meeting created on
   * Tuesday for Thursday has to be drawn on Thursday after a restart, and a
   * value the projection does not carry is a value the grid cannot place.
   */
  scheduledStart: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema.nullable(),
  confirmedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
})
export type Meeting = z.infer<typeof MeetingSchema>

/**
 * **The day a meeting belongs on**, as an instant (DEC-31) — the one moment
 * every surface sorts by, filters by and prints.
 *
 * The order is the calendar grid's: the day the rep put it on, else the day it
 * ran, else the day it was created. *Période* has to agree with where the
 * meeting is drawn, or a call filed under Thursday would drop out of « 7 jours »
 * on Wednesday.
 *
 * It lives in `contracts` and not in `core/domain/historySearch.ts`, where it
 * was, because `src/*` may import `core/contracts/` and nothing else — so every
 * screen that needed this question answered had rolled its own answer, and the
 * three answers disagreed. Historique printed `startedAt ?? scheduledStart ??
 * createdAt`, the pending-gates list printed `endedAt ?? …`, and the store
 * ordered by `updated_at`, which is not a date at all but the last time the
 * event log touched the row. Historique therefore drew 10/09, 09/09, 07/09,
 * **01/09, 03/09**, 27/08: a call validated late had been *edited* more recently
 * than a call held two days after it, so it sorted above it. On a screen whose
 * only organising principle is recency, that is the defect a rep notices in the
 * first minute and never trusts again.
 *
 * `endedAt` is deliberately never consulted: a recording left running overnight
 * would move the call to the next morning, and the rep filed it the day they
 * held it.
 */
export const meetingAnchor = (meeting: Meeting): number =>
  meeting.scheduledStart ?? meeting.startedAt ?? meeting.createdAt

/**
 * **How a row names one call: the client on top, the objet under it, and the
 * client's name printed once.**
 *
 * The objet a rep types almost always opens with the client's own name —
 * « Sodexial — comité de staffing hebdomadaire », « Nordis Retail — cadrage
 * support N2 » — because that is how a calendar invitation is written. Drawn
 * as-is the row said « Sodexial » over « Sodexial — comité de staffing
 * hebdomadaire », which spends the strongest line on a word repeated three
 * pixels below it and buries the only part that distinguishes one call from the
 * next. So the client stays on top, where the eye scans, and the objet drops the
 * prefix it duplicates along with the dash that joined them. Nothing is invented
 * and nothing is truncated away: an objet that does not open on the client is
 * drawn whole.
 *
 * The third case — neither name — is not an edge: a meeting now starts on one
 * click with no objet and no client, and it stays that way until the rep types
 * one into the session header. Two screens had the same `clientName || title`
 * pair, which drew an *empty row* for such a meeting: a list of dates with
 * nothing beside them. « Sans objet » is a rendering and stops at the screen —
 * nothing is written into the store, so the CRM never receives it.
 *
 * **It lives in `contracts` for the reason `meetingAnchor` and `speakerLabel`
 * do, and it moved here because the main process needs it too.** It was in
 * `src/app/format.ts`, where four screens could reach it and the search could
 * not — so `searchableRecord` built its own surface by joining the raw title to
 * the raw client name, and the excerpt under the row read « Sodexial — comité de
 * staffing Sodexial ». The row above it printed the name once and the evidence
 * line under it put it back, three pixels apart, on the same screen. One
 * function, one answer, everywhere a call is named.
 */
export const meetingHeading = (meeting: {
  title: string
  clientName: string | null
}): { title: string; subtitle: string | undefined } => {
  const client = meeting.clientName?.trim() ?? ''
  const objet = meeting.title.trim()
  if (client === '') return { title: objet === '' ? 'Sans objet' : objet, subtitle: undefined }
  if (objet === '') return { title: client, subtitle: undefined }
  const rest = withoutClientPrefix(objet, client)
  return { title: client, subtitle: rest === '' ? undefined : rest }
}

/**
 * `« Sodexial — comité de staffing »` under a `Sodexial` title becomes
 * `« comité de staffing »`. Case- and accent-insensitive on the name, and it
 * only ever strips a *leading* occurrence followed by a separator — « point
 * Sodexial » keeps every word it has.
 */
const HEADING_SEPARATOR = /^\s*[\u2014\u2013\-:\u00b7|]\s*/
const foldName = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr')

const withoutClientPrefix = (objet: string, client: string): string => {
  if (!foldName(objet).startsWith(foldName(client))) return objet
  // « Sodexial » as the whole objet leaves nothing for a second line to say —
  // the title above it already is that word — so the row draws one line.
  return objet.slice(client.length).replace(HEADING_SEPARATOR, '').trim()
}
