/**
 * **"Should the app offer to record a call that is not in the calendar?"**
 *
 * This is the one axis on which Granola was straightforwardly better than this
 * product. Its detection is *not* calendar-gated: a native module reports which
 * application holds the microphone, a table of conferencing bundle ids says
 * whether that application is a call, and the offer appears. So a client who
 * rings at 11:05 about yesterday's proposal — the call nobody put in Outlook,
 * which for a sales rep is a large share of the working day — is caught.
 *
 * Sillage caught none of them. `core/domain/arming.ts` requires a calendar event
 * with real attendees as the first half of a conjunction, so **no event meant no
 * offer, ever**, and the rep's only route was « Démarrer une réunion » — which
 * means noticing, mid-conversation, that they should be recording. VISION.md's
 * own argument against that is `ARM_LEAD_MS`'s: *"a rep who is talking is not
 * looking for a button."*
 *
 * Pure by construction, like `arming.ts`: a microphone reading, a clock, and two
 * facts about what is already on screen. No native module, no Electron.
 *
 * ## Why a dwell time, and why it is the whole safety argument
 *
 * The microphone signal is specific but not free of noise. A Slack voice
 * message, a dictation, « test your microphone » in Teams' settings, a browser
 * tab asking for permission — each holds an input stream for a few seconds. An
 * offer per blip would be the nagging that `Onboarding`'s docblock calls "how an
 * onboarding becomes the thing people close without reading", except during a
 * client call.
 *
 * A continuous hold is required instead. Twenty-five seconds is chosen against
 * the two costs it sits between: long enough that none of the blips above can
 * reach it, and short enough that the offer is on screen while the rep is still
 * exchanging pleasantries rather than ten minutes into the substance. It is
 * deliberately *not* `ARM_LEAD_MS`, which measures something else entirely — how
 * early a *known* meeting is anticipated.
 *
 * ## What this is not
 *
 * It is an **offer** (HR-7). Nothing here starts a recording, and that is what
 * makes a false positive cheap: the rep sees a dismissible row and ignores it.
 * That asymmetry is why the rules below fail toward *not* offering — a missed
 * offer costs one manual press, while an offer during the rep's dentist
 * appointment is the product being wrong about their day.
 *
 * There is no `sensitivity` guard here because there is no event to carry one:
 * Outlook's flag is the one place a user says "this is not for tooling"
 * (`arming.ts`), and an unscheduled call has no Outlook entry at all. The offer
 * is the only thing that happens, and a rep who does not want this call recorded
 * does nothing — which is also the outcome for every ad-hoc call today.
 */
import type { MeetingContext } from '../contracts/meeting.ts'

/**
 * How long a conferencing application must hold a microphone **without
 * interruption** before an unscheduled call is offered.
 */
export const AD_HOC_DWELL_MS = 25_000

/**
 * How often to re-ask while a hold is building toward the dwell.
 *
 * Same reasoning as `ARM_POLL_MS`: the signal is a **poll**, not a
 * subscription — nothing calls back when a process opens an input stream — so a
 * horizon further out than this is a promise to notice something at an instant
 * when nothing will have been looked at. Unlike the process list, this reading
 * costs no process spawn, so it can be asked at the resolution the decision
 * actually needs.
 */
export const AD_HOC_POLL_MS = 5_000

/**
 * How often to look for a call **starting**, when none is known to be running.
 *
 * This number exists because its absence was measured. Every branch below used
 * to answer `none` with no horizon, so the caller fell back to whatever the
 * *calendar* had decided — and on a build with no calendar that is
 * `SYNC_INTERVAL_MS`, five minutes. Driving the shipped `Agenda` over an empty
 * calendar with a call starting at t=0:
 *
 *     call starts at t=0; offer appears at t=325s
 *
 * Five and a half minutes, on the build where this is the *only* detection there
 * is. It is the same defect `ARM_POLL_MS` was written to fix, one signal over: a
 * horizon further out than the poll is a promise to notice something at an
 * instant when nothing will have been looked at.
 *
 * So every decision here carries its own horizon, including the ones that decide
 * nothing. Thirty seconds against the twenty-five-second dwell puts the worst
 * case at just under a minute, and the cost is one in-process property read —
 * measured at 3.4 ms, no process spawn — about 2 900 times a day.
 *
 * Two costs are accepted rather than hidden. A machine whose binary predates
 * `mic_apps.rs` ticks at this interval and finds nothing, for ever: the decision
 * cannot tell « no call » from « cannot ask », and threading a capability flag
 * through three layers to save a no-op timer wake is a worse trade than the wake.
 * And a thirty-second timer is a thirty-second timer — it does not coalesce the
 * way a five-minute one does. That is the honest price of noticing a call nobody
 * scheduled, and it is paid in an in-process property read rather than in the
 * process spawn round 23 measured at 874 a day.
 *
 * The version of this that costs nothing is a **property listener** —
 * `AudioObjectAddPropertyListener` on the process-object list, and
 * `IAudioSessionNotification` on Windows — which would make the signal pushed
 * rather than polled and delete this constant outright. It needs a callback
 * across the napi boundary on both platforms, which is real machinery and real
 * risk on the one platform that cannot be run from here; it is the next thing to
 * build here, not a thing that is missing.
 */
export const AD_HOC_IDLE_POLL_MS = 30_000

export interface AdHocInput {
  /**
   * The conferencing application holding a microphone right now, or null.
   * `null` also covers « we could not ask » — an older binary, an unsupported
   * platform — which is why it can only ever withhold the offer (DEC-45).
   */
  micHeldBy: string | null
  now: number
  /**
   * When the current uninterrupted hold began, or null when nothing is held.
   *
   * Held by the caller rather than derived here, because a pure function cannot
   * remember. `Agenda` resets it the moment `micHeldBy` goes null or names a
   * different application — a rep who leaves Teams and joins Zoom is in a new
   * call, and carrying the old instant forward would offer the new one instantly.
   */
  heldSince: number | null
  /**
   * **A meeting is already armed or recording — any meeting, from any path.**
   *
   * This field was `calendarArmed`, it was documented as « the scheduled offer
   * wins outright », and `Agenda` passed it a hard-coded `false`. So the rule was
   * not merely too narrow, it was not applied at all — and the twenty-fourth
   * review round drove three paths straight through the hole:
   *
   *   - a calendar call being **recorded** that runs past its slot, where
   *     `OVERRUN_GRACE_MS` keeps the microphone held: at minute 51 the detector
   *     armed a second meeting over the live one;
   *   - a rep who pressed « Démarrer une réunion » — the existing route for an
   *     unscheduled call, and the *fast* one, since this one waits 25 seconds —
   *     and got an offer to record the call they were already recording;
   *   - a one-poll microphone drop during an ad-hoc recording, which minted a
   *     second ad-hoc meeting over the first.
   *
   * Each produced `liveStates: ["recording","armed"]`, a second row on the day
   * wearing the screen's one filled *Enregistrer*, and an OS notification reading
   * « La réunion commence » about a call in progress — whose click broadcasts
   * `session:open` and navigates the rep **off their live recording**.
   *
   * That is verbatim the defect `Agenda.#arm`'s docblock records at length
   * (« Three statements about one meeting, two of them false, on one screen »).
   * It was fixed on the calendar path and reintroduced one branch over, which is
   * this repo's defect shape (b): a fix that produces the next round's finding.
   *
   * One conversation, one offer. The question is not « is the *calendar* armed »
   * but « is this product already doing something about a meeting », and only the
   * caller can answer it.
   */
  meetingLive: boolean
  /**
   * **This conversation has been decided** — offered, or live while the product
   * was already working on a meeting.
   *
   * Two facts, and they are one fact, which is what took three rounds to see.
   * Without the first, a rep who dismisses the offer is asked again on the next
   * poll for the rest of the call. Without the second, `meetingLive` is a *pause*:
   * « press *Terminer* while still on the call » — which the widget's own docblock
   * calls an ordinary thing for a client to ask — moves the meeting out of the
   * states the caller counts, and the detector offers to record the conversation it
   * has **just recorded**, with an OS notification that navigates the rep off
   * whatever they are reading.
   *
   * The unit is the **hold**, not the instant and not the meeting. One offer per
   * hold; the next hold is a new call, because a conferencing application releases
   * the microphone when its call ends. That is what keeps this a horizon rather
   * than a park: « end one call, take another » arrives as a different `heldSince`
   * and is offered.
   *
   * Deliberately not inferred from a wider `meetingLive`: `ended` and `extracting`
   * persist indefinitely when no model is configured (DEC-39), which is every
   * meeting on the demo build DEC-28 calls the first deliverable, so counting them
   * would disable detection permanently.
   */
  spent: boolean
  /**
   * **The instant the calendar's own offer for this conversation becomes available,
   * or null when the calendar does not account for a call happening now.**
   *
   * The axis this rule was on for three rounds was « is a meeting live », and that is
   * not the question. A rep joining their own 14:30 Teams call at 14:22 has no live
   * meeting, no armed meeting and a microphone held by Teams — so the detector
   * offered « Appel non planifié — Teams », the OS said « La réunion commence » about
   * a card naming no client, and at 14:25 the calendar armed the *same* conversation
   * a second time. Two rows, two notifications, and four presses to two simultaneous
   * recordings of one call.
   *
   * A number rather than a boolean, because the answer is not « refuse » but
   * « **defer** »: the offer the rep should get is the calendar's — it carries the
   * attendees, the objet, `speakerLabel`'s one chance to name the far channel after a
   * person, and the strongest signal account resolution has — and this is when it
   * arrives. `decideAdHoc` returns `none` with that as its horizon, so the rep gets
   * the good offer at the first instant it exists instead of a worse one now.
   *
   * `calendarClaim` in `core/domain/arming.ts` computes it, and the window is
   * `CALENDAR_CLAIM_MS`, deliberately wider than `ARM_LEAD_MS`: the calendar's claim
   * on a conversation reaches further than its readiness to arm one.
   */
  calendarOffersAt: number | null
}

/**
 * Every branch carries `untilMs`, including `none`.
 *
 * « Nothing to do » and « nothing to do *yet* » are the same answer to a caller
 * that has to decide when to ask again, and the five-minute lag above is what
 * happens when only some of the branches say so. Round 22 wrote the rule for
 * `arming.ts` and it is the same one: a decision that wants to be asked again
 * sooner has to say so itself, or every caller inherits whatever some other
 * subsystem's ceiling happens to be.
 */
export type AdHocDecision =
  | { action: 'offer'; app: string; untilMs: number; reason: string }
  | { action: 'wait'; untilMs: number; reason: string }
  | { action: 'none'; untilMs: number; reason: string }

export const decideAdHoc = (input: AdHocInput): AdHocDecision => {
  const { micHeldBy, now, heldSince, meetingLive, spent, calendarOffersAt } = input

  if (!micHeldBy) {
    return {
      action: 'none',
      untilMs: now + AD_HOC_IDLE_POLL_MS,
      reason: 'aucun appel en cours hors du calendrier',
    }
  }

  /*
   * **The calendar gets first claim on the conversation.** Asked before `meetingLive`
   * and before the dwell, because a scheduled call is not an unscheduled one at any
   * point in its dwell — and asked on every tick rather than latched, so a rep whose
   * call runs past `scheduledEnd + OVERRUN_GRACE_MS` and keeps talking is eventually
   * offered the unscheduled meeting the conversation has become.
   *
   * The horizon is the calendar's own offer instant, never the poll interval: there is
   * nothing to re-ask until then, and naming it is what stops the rep waiting a full
   * `AD_HOC_IDLE_POLL_MS` past the moment the good offer became available.
   */
  if (calendarOffersAt !== null) {
    return {
      action: 'none',
      untilMs: calendarOffersAt > now ? calendarOffersAt : now + AD_HOC_POLL_MS,
      reason: 'cet appel est au calendrier',
    }
  }

  if (meetingLive) {
    /*
     * Still asked at the idle interval rather than parked: whatever is live can
     * end — a calendar offer is withdrawn when its event passes, a recording is
     * stopped — and the call underneath it may carry on. Parking here would mean
     * a rep who ends one call and takes another immediately gets no offer for the
     * second.
     */
    return {
      action: 'none',
      untilMs: now + AD_HOC_IDLE_POLL_MS,
      reason: 'une réunion est déjà en cours ou proposée',
    }
  }

  // A hold with no start instant cannot be aged. Treating it as beginning now is
  // the conservative reading: it delays the offer by one dwell and never brings
  // it forward.
  const since = heldSince ?? now
  const ripeAt = since + AD_HOC_DWELL_MS
  if (now < ripeAt) {
    return {
      action: 'wait',
      untilMs: Math.min(ripeAt, now + AD_HOC_POLL_MS),
      reason: `${micHeldBy} émet du son depuis peu`,
    }
  }

  if (spent) {
    // A live hold, so the *end* of it is what is being watched for now — that is
    // what withdraws the offer — and that deserves the tight interval.
    return {
      action: 'none',
      untilMs: now + AD_HOC_POLL_MS,
      reason: `appel ${micHeldBy} déjà proposé`,
    }
  }

  return {
    action: 'offer',
    app: micHeldBy,
    untilMs: now + AD_HOC_POLL_MS,
    reason: `${micHeldBy} émet du son hors calendrier`,
  }
}

/**
 * What an unscheduled call is called before anybody has said anything about it.
 *
 * The application is named because it is the only thing known about the call,
 * and it is what lets a rep recognise their own conversation in *Historique*
 * three days later. It is a title, never a fact about the client — DEC-7 keeps
 * deterministic data out of the LLM's hands, and this is the mirror rule: the
 * app must not invent a participant either.
 */
export const adHocTitle = (app: string): string => `Appel non planifié — ${app}`

/**
 * A nominal length for a call nobody scheduled.
 *
 * `MeetingContext.scheduledEnd` *bounds* the session and sizes DEC-16's
 * end-of-meeting grace window; it is not a claim about when the call will end,
 * and for an unscheduled call there is nothing to claim. An hour is the bound
 * that behaves like the ordinary case — long enough that no real call is cut
 * short by it, and `EndOfMeetingWatch` ends a call on silence rather than on the
 * clock anyway.
 */
export const AD_HOC_NOMINAL_MS = 60 * 60_000

/**
 * A `MeetingContext` for a call that never had an invite.
 *
 * The mirror of `main.ts`'s `manualContext`, and deliberately as empty: there is
 * no organiser, no attendee list and no agenda, and inventing any of them is
 * exactly the DEC-7 violation the extraction refuses. What this costs is stated
 * rather than hidden — no « Interlocuteurs », no chance for `speakerLabel` to
 * name the far channel after a person instead of « Client », and no account
 * resolution from an attendee domain. It is the same cost « Démarrer une
 * réunion » already pays, and the offer is still worth incomparably more than a
 * call nobody recorded.
 *
 * `sensitivity` is `normal` because an unscheduled call has no Outlook flag to
 * read. Nothing is inferred from that: the outcome is an offer, and a rep who
 * does not want this conversation recorded does nothing.
 */
export const adHocContext = (app: string, heldSince: number): MeetingContext => ({
  eventId: null,
  subject: adHocTitle(app),
  agenda: '',
  organizer: { name: '', email: '', type: 'required', response: 'organizer' },
  attendees: [],
  onlineMeetingJoinUrl: null,
  categories: [],
  sensitivity: 'normal',
  scheduledStart: heldSince,
  scheduledEnd: heldSince + AD_HOC_NOMINAL_MS,
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
})

/**
 * A stable meeting id for one continuous hold.
 *
 * Keyed on the instant the hold began, so every tick of the same call resolves
 * to the same meeting — the property `meetingIdFor` exists for on the calendar
 * side, and for the same reason: `create()` on an id that already exists would
 * append a second `meeting.created` and the rep would find two rows for one
 * conversation.
 */
export const adHocMeetingId = (heldSince: number): string => `adhoc-${heldSince.toString(36)}`
