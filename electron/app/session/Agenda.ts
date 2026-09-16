/**
 * Calendar × process signal → an armed meeting. This is what "it armed itself"
 * means (demo beat #1, VISION.md §539).
 *
 * The orchestrator wires modules; this holds the loop that joins two of them.
 * Every rule it applies lives in `core/domain/arming.ts` and is pure — what is
 * here is scheduling, identity and the one side effect: creating a session and
 * putting it in `armed`.
 *
 * **Arming is an offer, not a recording** (HR-7). The session exists and the
 * screen says so; a human still presses *Démarrer*. Nothing below ever
 * dispatches `start`.
 */
import { createHash } from 'node:crypto'
import type { CalendarEvent, CalendarPort, CalendarWindow } from '../../core/contracts/calendar.ts'
import { EMPTY_WINDOW } from '../../core/contracts/calendar.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import { AFTER_THE_CALL, meetingAnchor } from '../../core/contracts/meeting.ts'
import type { Meeting, MeetingContext, MeetingId } from '../../core/contracts/meeting.ts'
import {
  ARM_LEAD_MS,
  CALENDAR_CLAIM_MS,
  calendarClaims,
  nextArmable,
  ownClaims,
  OVERRUN_GRACE_MS,
} from '../../core/domain/arming.ts'
import {
  adHocContext,
  adHocMeetingId,
  adHocTitle,
  AD_HOC_NOMINAL_MS,
  decideAdHoc,
} from '../../core/domain/adHoc.ts'
import type { MeetingSignal } from '../../modules/capture/MeetingApps.ts'
import type { Orchestrator } from './Orchestrator.ts'

/**
 * Never sleep longer than this, whatever the horizon says.
 *
 * A laptop that suspends through a `setTimeout` wakes with the timer still
 * pending and the meeting already over. A ceiling turns that into a five-minute
 * delay instead of a missed call.
 */
export const MAX_SLEEP_MS = 5 * 60_000

/** Below this, a horizon is now. Avoids a spin of zero-delay timers. */
const MIN_SLEEP_MS = 1_000

/** How stale the calendar may get before a tick re-syncs it. */
export const SYNC_INTERVAL_MS = 5 * 60_000

/**
 * A calendar event always produces the same meeting id.
 *
 * Restart-safety, not tidiness: `create()` on an id that already exists would
 * append a second `meeting.created` for the same call, and the rep would find
 * two rows for one conversation. Hashed rather than used raw because a Graph
 * event id is a 152-character base64 blob that ends up in file names and logs.
 */
export const meetingIdFor = (eventId: string): string =>
  `evt-${createHash('sha1').update(eventId).digest('hex').slice(0, 16)}`

export interface AgendaSnapshot {
  events: CalendarEvent[]
  syncedAt: number
  /** The days Graph was actually asked about — see the IPC schema. */
  window: { from: number; to: number }
  /**
   * The meeting currently offered, if any.
   *
   * `eventId` is null for an **unscheduled** call — one detected by a
   * conferencing application holding a microphone with nothing in the calendar
   * (`core/domain/adHoc.ts`). The renderer reads the null to know there is no
   * calendar row to point at.
   */
  armed: { meetingId: string; eventId: string | null; subject: string } | null
  /** Why nothing is armed, in French, for the empty state. */
  reason: string
}

export interface AgendaOptions {
  calendar: CalendarPort
  orchestrator: Orchestrator
  /**
   * Both detection signals, already sampled. Injected as a value rather than a
   * probe so this class never learns how either is obtained.
   *
   * `running` is « a conferencing app is open » and `inCall` is « one is holding
   * a microphone ». The second is what makes an unscheduled call detectable at
   * all; see `core/domain/adHoc.ts`.
   */
  meetingSignal: () => MeetingSignal
  /**
   * Refreshes those signals. Awaited before each evaluation.
   *
   * The argument is whether the *process* half can matter — i.e. whether any
   * calendar event is in the window at all. Nothing else can read it, and
   * sampling it costs a process spawn, so a day with no events must not pay for
   * one. See `MeetingApps.refresh`.
   */
  refreshMeetingSignal?: (wantProcessList: boolean) => Promise<unknown>
  diagnostics?: DiagRecorder
  clock?: () => number
  onHealth?: (health: ConnectorHealth) => void
  onChanged?: (snapshot: AgendaSnapshot) => void
  /** Maps a failure to a health state. Injected so `app/` keeps that mapping. */
  healthFor?: (error: unknown, at: number) => ConnectorHealth
  /**
   * A meeting has just become armed — **once per meeting**, at the transition.
   *
   * `#arm` returns early when the same meeting is already armed, so this fires
   * on the edge and never on the tick. `main.ts` uses it to raise an OS
   * notification, which is the only thing that reaches a rep who is in Teams
   * with this window behind three others; a callback that fired every thirty
   * seconds would be a notification every thirty seconds.
   */
  onArmed?: (armed: { meetingId: string; subject: string }) => void
  /**
   * **The meetings the rep placed in this app, so they can claim their own
   * conversations** (`ownClaims`).
   *
   * A port rather than a store handle, for the reason every other boundary here
   * is one: `Agenda` decides, `app/` wires. Optional because a caller that does
   * not pass it gets exactly the behaviour this class had before — the
   * calendar's claims and nothing else — which is what every existing test
   * asserts.
   */
  ownMeetings?: (from: number, to: number) => readonly Meeting[]
  /**
   * What the calendar column says before the first tick has decided anything.
   *
   * Defaults to a sync in progress, which is the truth over a real calendar
   * and a lie over `NULL_CALENDAR`: a rep with no Microsoft account was shown
   * « synchronisation du calendrier en cours… » about a sync that never
   * starts. `main.ts` passes the sentence that is true for that branch.
   */
  initialReason?: string
}

/**
 * The three facts `#arm` works from, which is less than an event.
 *
 * `context` is consulted in exactly one branch — the create — and a meeting the
 * rep placed in this app exists already, so it is `null` there. One `#arm`
 * rather than a second entry point is this class's own rule: « the meeting id,
 * the subject and `MeetingContext` are composed in one place, so a rep-armed
 * meeting and a clock-armed one cannot drift ».
 */
interface ArmTarget {
  meetingId: MeetingId
  /** The invite this came from, or `null` for a meeting the rep placed here. */
  eventId: string | null
  subject: string
  /** Only for creating a meeting that does not exist yet; `null` never creates. */
  context: MeetingContext | null
}

export class Agenda {
  #options: AgendaOptions
  #clock: () => number
  #diagnostics: DiagRecorder
  #window: CalendarWindow = EMPTY_WINDOW
  #armed: AgendaSnapshot['armed'] = null
  // The state between boot and the first sync, and it is shown to the rep. It
  // is a sync in progress, not a fault — naming it "non synchronisé" reports a
  // one-second startup as a problem with their calendar.
  #reason = 'synchronisation du calendrier en cours…'
  /**
   * The caller's sentence for a fold that holds nothing — see `initialReason`.
   *
   * Kept as well as applied, because applying it once was the same as not
   * applying it at all. `#tick` sets `#reason` from `nextArmable` before
   * `#publish` has ever run, so over `NULL_CALENDAR` the sentence `main.ts`
   * writes for the no-Microsoft branch — « aucun calendrier connecté — les
   * appels en cours sont détectés sans lui » — was overwritten on the first tick
   * and **never reached a published snapshot**. Measured: at boot it is the
   * caller's, after one tick it is « aucune réunion dans la fenêtre », and the
   * published list only ever contains the second.
   *
   * That is worse than a sentence that is briefly wrong. On the branch DEC-28
   * makes the first deliverable, the calendar column's only explanation of
   * itself named what is *absent* and said nothing about the detector that is
   * still running — and the one line that did say so was unobservable.
   */
  #emptyReason: string | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #stopped = false
  /*
   * The microphone hold this instance is watching.
   *
   * `decideAdHoc` is pure and cannot remember when a hold began, so the three
   * facts it needs live here. They are reset together — see `#trackHold` — because
   * a rep who leaves Teams and joins Zoom is in a *new* call, and carrying the
   * old instant forward would offer the new one with no dwell at all.
   */
  #heldApp: string | null = null
  #heldSince: number | null = null
  /**
   * **The ad-hoc meeting this agenda armed, tracked here and never inferred.**
   *
   * `#withdrawAdHoc` used to read its target out of `#armed` — and `#arm(event)`
   * *overwrites* `#armed`. So the moment a rep pressed *Enregistrer* on an
   * upcoming calendar row while an unscheduled offer was standing, nothing in the
   * product could ever name that ad-hoc meeting again: it stayed `armed` for the
   * life of the process, which is in `UPDATE_BLOCKING_STATES`, so **every
   * installer was refused** with « une réunion est sur le point de démarrer »
   * about a call that had ended; `meetingLive` then read that row and answered
   * `none` for every subsequent call, so **the detector turned itself off for the
   * rest of the working day**; and the row sat in *À venir* wearing « Prêt », past
   * `Projections.listMeetings`'s filter, which deliberately keeps an `armed`
   * ad-hoc row because a standing offer wants attention.
   *
   * That is verbatim the harm `#trackHold`'s docblock below says it ended for the
   * Teams→Zoom case, reintroduced one caller over — the *third* consecutive round
   * in which this rule was the finding. Reading the withdrawal target out of the
   * field being overwritten was the whole bug, and a field of its own is the only
   * shape that cannot be wrong that way.
   */
  /**
   * Meetings already reported as refusing to arm, so the diagnostic is an edge.
   *
   * A `Set` for the life of the agenda rather than a single id: several events can be
   * recommended and refused over a day, and collapsing them onto one field would make
   * the second refusal reopen the first. See the note at the `agenda.arm.refused`
   * record site for the ninety-four identical rows this replaces.
   */
  #refused = new Set<string>()
  #adHocArmed: string | null = null
  /**
   * **This conversation has been decided** — offered, or live while the product
   * was already working on a meeting.
   *
   * It was `#adHocOffered`, a latch set only when *we* minted an ad-hoc meeting,
   * and `meetingLive` was a *pause*: suppressed while something was live, and
   * offerable again the moment that something left the two states the guard
   * counted. So « press *Terminer* while still on the call » — which the widget's
   * own docblock calls an ordinary thing for a client to ask — took the meeting to
   * `ended`, released the guard, and the detector offered to record the
   * conversation it had **just recorded**: a second row on the day, and an OS
   * notification whose click broadcasts `session:open` and navigates the rep off
   * the screen they are reading. The same held at `awaiting_confirmation`, which is
   * the one screen DEC-4 protects.
   *
   * The fix is not a wider state set, and that matters: `ended` and `extracting`
   * can persist **indefinitely** by design — DEC-39 says a meeting with no model
   * configured waits for one, which on the demo build (DEC-28) is every meeting —
   * so counting them would disable detection permanently, which is finding 1's
   * harm by another route. What closes the window is *when* it closes: a hold that
   * was live-suppressed is spent at that moment and stays spent, because it is the
   * same conversation whatever happens to the meeting afterwards.
   *
   * The horizon property survives, and it is worth saying why: a genuinely new
   * call is a new **hold**. `#trackHold` clears this on a lost hold and on a change
   * of application, and a conferencing app releases the microphone when its call
   * ends, so « end one call, take another » arrives here as a different
   * `heldSince` and is offered.
   */
  #adHocSpent = false
  /*
   * The last snapshot actually published, so an unchanged one is not.
   *
   * `onChanged` fired at the end of every tick, and that was defensible while a
   * tick was a five-minute calendar re-sync. Detecting unscheduled calls made the
   * loop run every thirty seconds — it has to, because the microphone is polled
   * — and an identical `agenda:changed` ten times as often is ten times as many
   * renderer re-renders of a screen where nothing moved. The broadcast is for a
   * *change*; saying so is cheaper than the render it avoids.
   */
  #published: string | null = null

  constructor(options: AgendaOptions) {
    this.#options = options
    if (options.initialReason) {
      this.#reason = options.initialReason
      this.#emptyReason = options.initialReason
    }
    this.#clock = options.clock ?? Date.now
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#window = options.calendar.window()
  }

  snapshot(): AgendaSnapshot {
    return {
      events: this.#window.events,
      syncedAt: this.#window.syncedAt,
      // The bounds the cursor was earned over. They have always been on the
      // window and never left the main process, so the calendar asserted
      // « Aucune réunion ce jour-là » about days Graph was never asked about.
      window: { from: this.#window.from, to: this.#window.to },
      armed: this.#standingOffer(),
      reason: this.#reason,
    }
  }

  /**
   * `#armed` as the *machine* sees it, which is the only reading a consumer of
   * this snapshot can act on.
   *
   * `#armed` is this class's note of what it last offered. It is cleared when
   * the hold drops, and the hold outlives the meeting — so between *Terminer*
   * and the rep hanging up, this field named a meeting the orchestrator calls
   * `ended`. `AgendaSnapshot.armed` is documented as « the meeting currently
   * offered »; what it actually returned was « the last meeting this agenda
   * touched, while the hold lasts ».
   *
   * Driven end to end, that is what the rep saw: `buildEntries` read the field,
   * `EntryRow` set `entry.armed = true` beside `past = true`, and a conversation
   * that had just been recorded drew a *« Prêt »* state dot and an
   * *« Enregistrer »* button under **Passées** — HR-7's own words, « armed is an
   * offer, never a recording », inverted into an offer to record something
   * already recorded.
   *
   * `#tick` already had this rule and kept it to itself, in the two lines that
   * compute `calendarOffered`: « `still standing` is the machine's word, not
   * this field's ». One lookup, so the detector and the screen cannot disagree
   * about whether an offer is live.
   */
  #standingOffer(): AgendaSnapshot['armed'] {
    if (this.#armed === null) return null
    const state = this.#options.orchestrator.stateOf(this.#armed.meetingId)
    return state === 'armed' || state === 'recording' ? this.#armed : null
  }

  /**
   * Arm a scheduled event because the rep asked, not because the clock did.
   *
   * `#tick` reaches `#arm` through `decideArming`, which is a *guess* at when
   * the rep would want this — a five-minute window around the event × a
   * conferencing process running. Until this existed the guess was the only way
   * in, and an upcoming event that had produced no meeting yet therefore had no
   * control on its row at all (`src/screens/agenda/DayPane.tsx` renders inside
   * `{meetingId ? … : null}`). A call that starts ten minutes early left the rep
   * with only « Démarrer une réunion », which creates a meeting with
   * `eventId: null` and loses every deterministic fact the invite carries.
   *
   * **The same `#arm` the clock uses**, deliberately: the meeting id, the
   * subject and `MeetingContext` are composed in one place, so a rep-armed
   * meeting and a clock-armed one cannot drift. `decideArming` is not consulted
   * — the detector guesses, the rep has said — and `#arm` still re-checks the
   * meeting's own state, so an event that has already been recorded and
   * confirmed is refused there rather than here.
   *
   * Bounded by the fold. `eventId` arrives from the renderer, so it is matched
   * against the events this agenda actually holds; an id from anywhere else
   * refuses rather than creating a meeting for an event nobody can see.
   */
  armNow(eventId: string): { meetingId: string } {
    const event = this.#window.events.find((candidate) => candidate.id === eventId)
    if (!event) throw new Error('Cet événement n’est plus dans le calendrier affiché.')
    this.#arm(
      {
        meetingId: meetingIdFor(event.id),
        eventId: event.id,
        subject: event.context.subject,
        context: event.context,
      },
      false,
    )
    /*
     * Read back rather than returned from `#arm`: `#arm` has three exits — a
     * standing offer it keeps, a fresh arming, and a refusal that clears
     * `#armed` — and the id the *renderer* should open is whatever the agenda
     * now says is armed. Composing it here from `meetingIdFor` would be a second
     * source for one fact, and would happily name a meeting the dispatch just
     * refused.
     */
    const armed = this.#armed
    /*
     * **And it has to be the event the rep pressed.**
     *
     * This read `#armed` back and returned whatever it named, on the argument that
     * « the id the renderer should open is whatever the agenda now says is armed ».
     * That is true of the two exits it listed and false of a third: `#arm` has paths
     * that leave `#armed` naming a *different* meeting — a refusal for this event, or a
     * call under way that takes the conversation — and `src/screens/Agenda.tsx` then
     * calls `onOpen(meetingId)` with it. Measured
     * (`scratch/r29-armnow-wrong-meeting.mjs`): `armNow('EV-A')` returned EV-B's
     * meeting id, so pressing *Enregistrer* on Sodexial's row opened **Néovia's**
     * session screen, where the next press records the Sodexial call into Néovia's
     * meeting — its `eventId`, its attendees, its `speakerLabel`, its account, and
     * therefore its VerySwing task and its Outlook draft.
     *
     * The round-27 docblock beside `#refused` says « `armNow` throws each time, so the
     * rep is told ». It did not throw when a different event was armed; it silently
     * named it. So the check is on the *event*, which is the only thing the rep
     * pointed at.
     */
    if (!armed || armed.eventId !== eventId) {
      /*
       * **And the two refusals are not the same fact, so they do not get the same
       * sentence.**
       *
       * Round 29 added an early return to `#arm` for « another meeting is recording », and
       * `armNow` reached it through this line: the rep whose 14:00 runs to 15:05 — which
       * DEC-9 says is what sales calls do — presses *Enregistrer* on the 15:00 row and is
       * told « Cette réunion ne peut plus être démarrée », through `window.alert`. It can
       * be started, thirty seconds after they press *Terminer*. And the fallback they
       * reach for, *Démarrer une réunion*, is refused too (correctly, « une autre réunion
       * est déjà en cours d'enregistrement »), so the reading available to them is « the
       * 15:00 row is broken » and the likely outcome is the call recorded with
       * `eventId: null` — losing the attendees, the objet, `speakerLabel`, the account
       * resolution and the VerySwing link, which is the exact harm this method exists to
       * prevent.
       *
       * So the live call is named, and the sentence says what to do. DEC-26: a refusal is
       * a fact the rep can act on, never a dead end.
       */
      const busy = this.#options.orchestrator
        .liveIds()
        .find((id) => this.#options.orchestrator.stateOf(id) === 'recording')
      if (busy !== undefined) {
        throw new Error(
          'Une réunion est déjà en cours d’enregistrement. Terminez-la, puis reprenez ' +
            'celle-ci — elle reste proposée.',
        )
      }
      throw new Error('Cette réunion ne peut plus être démarrée.')
    }
    // Through the same guard as the tick: arming changes the snapshot, so this
    // always publishes — and a second source for « has it changed » is how the
    // two answers drift.
    this.#publish()
    return { meetingId: armed.meetingId }
  }

  /**
   * Is the invite behind a standing offer finished, cancelled or gone?
   *
   * The one question the expiry branch above should be asking. An event that has
   * fallen out of the synced window counts as gone — it cannot be re-armed and the
   * offer names a row the screen no longer has — and so does an all-day entry, which
   * `nextArmable` refuses to treat as a call in the first place.
   */
  /**
   * When the calendar's own offer for a conversation happening **now** becomes
   * available, or null when the calendar does not account for one.
   *
   * `calendarClaim` answers this about the *events*; only this class can finish the
   * question, because « the calendar accounts for this call » is false once the
   * calendar is **done** with that event. A 14:00–15:00 meeting the rep recorded and
   * ended at 14:20 is still inside the claim's window until 15:20 — `#arm` would
   * refuse it, correctly, since it is past `armed` — and deferring to an offer that
   * can never come cost a rep who took a different client's call at 14:35 **forty-five
   * minutes of silence**, plus a `warn` diagnostic per tick whose sentence is about
   * the wrong meeting. On the demo build (DEC-28, no model configured) a meeting stays
   * `ended` for ever, so it was every slot on the calendar, every day.
   *
   * `AFTER_THE_CALL` is read from `core/contracts/` rather than restated, because
   * *Historique* asks the same question one layer up and two copies of that list are
   * two answers to « is this conversation over ».
   *
   * **Every claimant, not the earliest one.** This asked `calendarClaim`, which answers
   * one event, and concluded « the calendar accounts for nothing » when *that* meeting
   * was over — discarding the claim of every other event whose slot also covers now.
   * Measured (`scratch/r28-claim-earliest.mjs`): a 14:00 call ended at 14:20 and the rep
   * joining their own 15:00 invite at 14:50 got « Appel non planifié — Teams » at
   * 14:50:25, then the calendar arming the same conversation at 15:00 —
   * `liveStates = ["recording","armed"]`, two rows, two notifications, the second
   * navigating them off a live recording. Twenty-five minutes wide per adjacent pair,
   * and on the demo build every slot after a recorded one is exposed, for ever (DEC-39).
   * Sixth consecutive round on this rule, and the fifth time the previous fix was right
   * about the axis the round before it named.
   *
   * The offer instant is the **earliest unspent** claimant's, which is also why the list
   * arrives sorted: a spent slot must not push the horizon past the one that is about to
   * arm. Every claimant is inside `CALENDAR_CLAIM_MS`, so the answer is never more than
   * twenty-five minutes out — a bounded deferral, which is what `decideAdHoc` wants.
   */
  #calendarOffersAt(now: number): number | null {
    /*
     * **Both kinds of claim, earliest first.**
     *
     * This read `this.#window.events` alone, which is Graph — so on a build with
     * no Entra registration, the only meetings that exist are the rep's own and
     * none of them claimed anything. See `ownClaims` for what that cost and why
     * the bound it uses is not a new decision.
     */
    const offers: number[] = []
    for (const claim of calendarClaims(this.#window.events, now)) {
      if (this.#spent(claim.id)) continue
      offers.push(claim.context.scheduledStart - ARM_LEAD_MS)
      break
    }
    for (const meeting of ownClaims(this.#ownMeetings(now), now)) {
      /*
       * Keyed on the meeting itself, not on `meetingIdFor(eventId)`: these have
       * no event, and « is the product finished with this conversation » has to
       * be asked of the thing that holds the state.
       */
      const state = this.#options.orchestrator.stateOf(meeting.id)
      if (state !== null && AFTER_THE_CALL.has(state)) continue
      offers.push(meetingAnchor(meeting) - ARM_LEAD_MS)
      break
    }
    return offers.length === 0 ? null : Math.min(...offers)
  }

  /**
   * The rep's own meetings around `now`, or none when nothing is wired.
   *
   * The window is the claim window `ownClaims` applies, widened by the nominal
   * bound so a meeting that started before `now` is still fetched and can still
   * be found to be claiming.
   */
  #ownMeetings(now: number): readonly Meeting[] {
    const read = this.#options.ownMeetings
    if (read === undefined) return []
    return read(now - AD_HOC_NOMINAL_MS - OVERRUN_GRACE_MS, now + CALENDAR_CLAIM_MS)
  }

  /**
   * Has the product already finished with this event's conversation?
   *
   * One predicate for the two places that ask it — which slot may still be armed, and
   * which slot still claims the microphone — because they are the same question and two
   * copies of it are two answers. `AFTER_THE_CALL` lives in `core/contracts/` for the
   * reason `meetingAnchor` does: *Historique* asks it one layer up.
   *
   * `armed` and `recording` are deliberately **not** in it. A conversation that is
   * offered or under way is the opposite of finished, and treating it as spent would let
   * the calendar arm the next slot beside a live recording — `["recording","armed"]`,
   * the defect round 24 closed.
   */
  #spent(eventId: string): boolean {
    const state = this.#options.orchestrator.stateOf(meetingIdFor(eventId))
    return state !== null && AFTER_THE_CALL.has(state)
  }

  #over(eventId: string, now: number): boolean {
    const event = this.#window.events.find((candidate) => candidate.id === eventId)
    if (!event) return true
    if (event.isCancelled || event.isAllDay) return true
    return now >= event.context.scheduledEnd + OVERRUN_GRACE_MS
  }

  /** Runs a tick now, then keeps ticking until `stop()`. */
  start(): void {
    this.#stopped = false
    void this.#loop()
  }

  stop(): void {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  async #loop(): Promise<void> {
    if (this.#stopped) return
    const wakeAt = await this.tick()
    if (this.#stopped) return
    const delay = Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, wakeAt - this.#clock()))
    this.#timer = setTimeout(() => void this.#loop(), delay)
    // A pending timer must not keep Electron's main process alive on its own.
    this.#timer.unref?.()
  }

  /**
   * One evaluation. Returns the instant to re-evaluate at.
   *
   * Public because the loop is the untestable part and this is not: a test
   * drives ticks at chosen instants with no timers involved.
   */
  async tick(options: { now?: number; force?: boolean } = {}): Promise<number> {
    const now = options.now ?? this.#clock()
    await this.#sync(now, options.force === true)
    await this.#options.refreshMeetingSignal?.(this.#window.events.length > 0)

    const signal = this.#options.meetingSignal()
    this.#trackHold(signal.inCall, now)

    /*
     * **A conversation the product has already finished is not a candidate, and
     * leaving it in cost the next call its five minutes of anticipation.**
     *
     * `nextArmable` prefers the earliest event whose slot contains `now` — correctly,
     * and its own split between `current` and `overrun` exists so a call running over
     * does not beat the one the rep is in. What it cannot know is session state, so a
     * 14:00–15:00 call the rep *ended at 14:20* went on winning that comparison until
     * its own slot closed, and `#arm` then refused it (`arm` is illegal past `armed`)
     * without ever reaching the 15:00 invite behind it. Measured
     * (`scratch/r28-nextarmable-spent.mjs`): the 15:00 call is offered at **15:00**
     * instead of 14:55 — DEC-46's « something happens at 14:30 » is the whole point of
     * `ARM_LEAD_MS`, and the notification now fires while the client is already on the
     * line. On the demo build DEC-28 ships first that is every call after the first,
     * every day, because `ended` persists for ever with no model (DEC-39).
     *
     * `AFTER_THE_CALL` and deliberately not « anything past `idle` »: `armed` and
     * `recording` must keep blocking, or the calendar would arm the 15:00 slot beside a
     * 14:00 call still being recorded — `liveStates = ["recording","armed"]`, two rows
     * for two conversations where one is live, which is the defect round 24 closed. The
     * same predicate `#calendarOffersAt` uses, from the same set in `core/contracts/`,
     * because « is the calendar done with this conversation » must not have two answers.
     */
    const candidates = this.#window.events.filter((event) => !this.#spent(event.id))
    const choice = nextArmable(candidates, now, signal.running, signal.inCall)
    /*
     * **The caller's sentence survives an empty fold.**
     *
     * `nextArmable` answers « aucune réunion dans la fenêtre », which is true
     * and, on a build with no calendar at all, useless: it describes a window
     * the rep cannot fill and does not mention that unscheduled calls are still
     * detected. `main.ts` passes the sentence that is true for that branch and
     * this used to discard it on the first tick.
     *
     * Bounded to a fold that holds nothing, so it cannot mask a real answer: the
     * moment a calendar has a single event, `nextArmable` owns the line again.
     * On `NULL_CALENDAR` that never happens, which is exactly the branch the
     * sentence was written for. The ad-hoc branch below still overwrites it with
     * something more specific when a call is actually under way.
     */
    this.#reason =
      this.#emptyReason !== null && this.#window.events.length === 0
        ? this.#emptyReason
        : choice.decision.reason

    if (choice.decision.action === 'arm' && choice.event) {
      this.#arm({
        meetingId: meetingIdFor(choice.event.id),
        eventId: choice.event.id,
        subject: choice.event.context.subject,
        context: choice.event.context,
      })
    } else if (
      this.#armed &&
      this.#armed.eventId !== null &&
      (this.#over(this.#armed.eventId, now) || this.#spent(this.#armed.eventId))
    ) {
      /*
       * **« Is the event over » and not « did `nextArmable` decline to arm it ».**
       *
       * This branch used to fire on *any* non-`arm` answer, and `wait` is one — so
       * two ordinary things withdrew an offer that was still good.
       *
       * `armNow` is the rep pressing *Enregistrer* on an upcoming row, deliberately
       * without consulting `decideArming` (« the detector guesses, the rep has
       * said »). Outside `ARM_LEAD_MS` the very next tick answered `wait` and
       * **undid the press**, logging `disarm` with « la réunion est passée sans
       * enregistrement » about a call half an hour in the future. Worse, the control
       * that made it renders only while `entry.meetingId` is null — the press creates
       * the meeting — so it was gone for the rest of the day: verbatim the defect
       * `b497664` added that control to end, reachable by pressing the control
       * `b497664` added. Measured: « Prêt / Enregistrer » → thirty seconds later
       * « En attente / Ouvrir ».
       *
       * And the same on the clock path, which nobody had noticed: inside the window
       * with no conferencing audio, `decideArming` answers `wait`, so a rep who
       * closed Teams after the offer appeared had it withdrawn too.
       *
       * Over means over — absent from the fold, cancelled, or past
       * `scheduledEnd + OVERRUN_GRACE_MS`, which is the same boundary
       * `decideArming` uses for `skip` and `calendarClaim` for its claim.
       *
       * **Or spent, which used to be answered from inside `#arm` and no longer can be.**
       * The re-check of a standing offer whose call has *ended* lived in `#arm`'s
       * already-armed branch, and it was reachable only because `nextArmable` went on
       * naming the finished event — which is the defect above this one: the next slot
       * was never reached. Filtering spent events out of the candidates closed that and
       * took the withdrawal's only path with it, so a rep who finished at minute 20 of a
       * 60-minute slot kept « Prêt » and the day's one filled *Enregistrer* on a row whose
       * meeting is `awaiting_confirmation`, for forty minutes. `#arm`'s own check stays —
       * it is a state read and it still catches the case where another event is armed in
       * the same tick — but the question is asked here too, where the answer is not
       * conditional on which event `nextArmable` happened to pick.
       */
      const expired = this.#armed.meetingId
      this.#armed = null
      /*
       * **And the machine is told, which it never was.**
       *
       * `disarm` has had an entry in `SessionCommandSchema` and a rule in
       * `TRANSITIONS` since the state machine was written, and **no dispatcher**:
       * a grep for it outside those two files returned the declarations and
       * nothing else. So a 14:30 that came and went without the rep recording
       * left the meeting in `armed` for ever — a row the boot sweep does not
       * touch (it ends `recording`), that `Agenda` will not re-arm (`arm` is
       * illegal from `armed`), and that nothing in the product could move.
       *
       * The offer being withdrawn is exactly the moment the machine should hear
       * about it: the calendar window closed, nobody pressed *Enregistrer*, and
       * `idle` is what that meeting is. Only from `armed` — a call under way is
       * `recording` and is not this branch's business — and the outcome is
       * ignored on purpose, because a meeting that has moved on by itself is not
       * an error.
       */
      if (this.#options.orchestrator.stateOf(expired) === 'armed') {
        this.#options.orchestrator.dispatch(expired, 'disarm', 'la réunion est passée sans enregistrement')
      }
    }

    let horizon =
      choice.decision.action === 'wait' ? choice.decision.untilMs : now + SYNC_INTERVAL_MS

    /*
     * **The unscheduled call.**
     *
     * Only when the calendar has not already armed something: the scheduled
     * offer wins outright, and two offers for one conversation is the defect
     * `#arm`'s docblock records at length. `decideAdHoc` is told that as a fact
     * rather than inferring it, so the rule stays readable in one place.
     *
     * **« Did an offer happen », not « did a pure function say one should ».** This
     * was gated on `choice.decision.action === 'arm'`, and `#arm` then *refuses* —
     * for a meeting already recorded, ended, confirmed or pushed. When it refuses
     * nothing is armed, and this branch had already been skipped on the strength of
     * the recommendation. Measured: a rep who finished their 14:00–15:00 call at
     * 14:20 and took a different client's call at 14:35 waited until **15:20** for an
     * offer — forty-five minutes of silence on a live call — with eight `warn`
     * diagnostics in between whose message is a refusal sentence about an unrelated
     * meeting (« Compte-rendu en attente d'analyse. »), in the bundle whose button
     * says it can be sent to support. And on the demo build (DEC-28, no model) that
     * meeting stays `ended` for ever, so it fires for every slot on the calendar.
     *
     * Read after the calendar branch has run, from the field that records what
     * actually happened.
     */
    /*
     * « Still standing » is the machine's word, not `#armed`'s. `#armed` is
     * `Agenda`'s own note of what it last offered; the session is what knows
     * whether that offer is live. A rep who armed a row and then abandoned it
     * leaves a note here pointing at an `idle` meeting, and treating that as a
     * standing offer would silence the detector on the strength of a decision
     * that is over.
     *
     * `#standingOffer` is that rule, and it is a method because the snapshot
     * needs the same one — it did not have it, and shipped an ended meeting to
     * the screen as an offer for as long as the rep kept talking.
     */
    const standing = this.#standingOffer()
    const calendarOffered = standing?.eventId != null
    /*
     * **Is this product already doing something about a meeting?**
       *
       * `liveStates()` is every session this process holds, created or rehydrated
       * this run — and the two states counted are **deliberately** the two, not
       * the six. This comment used to claim « anything recording, extracting,
       * awaiting confirmation or draining counts », the code counted two, and the
       * twenty-fifth round found the gap by pressing *Terminer* mid-call. Widening
       * the set is the obvious fix and the wrong one: `ended` and `extracting`
       * persist **for ever** when no model is configured (DEC-39), which is every
       * meeting on the demo build DEC-28 calls the first deliverable, so counting
       * them would turn the detector off permanently — finding 1's harm by another
       * route.
       *
       * What closes that window is `#adHocSpent`, which makes the suppression a
       * decision about the *conversation* instead of a pause keyed on an instant.
       * These two states are the ones where a second armed meeting would put a
       * second filled *Enregistrer* on the day, which is the screen-level harm
       * `#arm`'s docblock records.
       *
       * The field this replaces was `calendarArmed: false`, hard-coded, so the
       * rule it named was never applied at all. See `AdHocInput.spent` for the
       * paths that went through that hole and this one.
       */
    const live = this.#options.orchestrator
      .liveStates()
      .some((state) => state === 'armed' || state === 'recording')
    /*
     * **Suppression is a decision, not a delay** — see `#adHocSpent`.
     *
     * Marked here rather than inside `decideAdHoc`, which is pure and answers
     * the same question for the same input every time. What the domain rule
     * cannot know is that the *hold* outlives the meeting: this is the caller's
     * fact about its own state, and the one line that makes « one conversation,
     * one offer » true of a conversation rather than of an instant.
     *
     * **Outside `calendarOffered`, which is where it belonged all along.** This
     * latch lived inside that branch, so it was written only on ticks where no
     * calendar offer stood — and on the calendar path, HR-9's primary one, a
     * calendar offer stands for the whole call. The field invented to make « one
     * conversation, one offer » true of a conversation was therefore never
     * written on the path it matters most on.
     *
     * What that cost, driven minute by minute on this class: a rep joins their
     * 14:00 call, is offered it, records it, presses *Terminer* at 14:20 and
     * keeps talking. At 14:21 `calendarOffered` goes false for the first time,
     * the branch finally runs — and by then nothing is live, so `#adHocSpent` is
     * still false, the hold is still held, and the detector offers the same
     * conversation a second time. The day shows two rows for one call, the
     * second wearing the screen's one filled *Enregistrer*, and a second OS
     * notification fires whose click navigates the rep off the compte-rendu
     * being written.
     *
     * A standing calendar offer is `armed` or `recording` by its own definition
     * above, so it is already inside `liveStates()`: lifting the latch out of
     * the branch is the whole fix, and it needs no second condition.
     */
    if (live) this.#adHocSpent = true

    /*
     * **And the meeting the rep placed here arms, which is the half that was
     * missing.**
     *
     * `ownClaims` stopped the detector offering a second, anonymous row for a
     * conversation the rep had already named — and nothing took its place, so on
     * the build DEC-28 makes the first deliverable the product noticed the call,
     * silenced its own detector, armed nothing and notified nothing. That is
     * exactly the failure this repo's own notes predicted when only one half
     * could be built (« deferring the detector to a meeting the agenda cannot
     * arm leaves the rep with no offer instead of a duplicate one ») and it
     * shipped for one round.
     *
     * The conjunction is the calendar path's, with the parts that exist: a
     * conversation claiming *now*, and a meeting app actually making sound.
     * `decideAdHoc` reads the same microphone signal for the same reason, so
     * « the rep is in a call » has one source. `#arm` re-checks the meeting's own
     * state and refuses beside a live recording, so nothing here needs to.
     *
     * No `context`: the meeting exists — the rep made it — and `#arm` refuses to
     * invent one.
     */
    if (signal.running !== null) {
      for (const meeting of ownClaims(this.#ownMeetings(now), now)) {
        const state = this.#options.orchestrator.stateOf(meeting.id)
        if (state !== null && AFTER_THE_CALL.has(state)) continue
        if (now < meetingAnchor(meeting) - ARM_LEAD_MS) continue
        this.#arm({
          meetingId: meeting.id as MeetingId,
          eventId: null,
          subject: meeting.title,
          context: null,
        })
        break
      }
    }

    if (!calendarOffered) {
      const adHoc = decideAdHoc({
        micHeldBy: signal.inCall,
        now,
        heldSince: this.#heldSince,
        meetingLive: live,
        spent: this.#adHocSpent,
        /*
         * **The calendar's claim, read from the same fold `nextArmable` just read.**
         *
         * Not from `choice`: `nextArmable` answers « which event should be armed
         * *now* », and outside `ARM_LEAD_MS` that is `wait` — which is exactly the
         * window a rep joining early falls into, and exactly the window this has to
         * see. Asking the fold a second, different question is the point.
         */
        calendarOffersAt: this.#calendarOffersAt(now),
      })
      /*
       * The horizon is taken from **every** branch, including the one that
       * decides nothing.
       *
       * Measured before it was: a call starting at t=0 on a build with no
       * calendar was offered at **t=325s**, because `none` carried no horizon and
       * the fallback was `SYNC_INTERVAL_MS`. A horizon is a floor on attention
       * and never a ceiling on it, so this only ever tightens.
       */
      horizon = Math.min(horizon, adHoc.untilMs)

      if (adHoc.action === 'offer') {
        this.#armAdHoc(adHoc.app, now)
        this.#reason = adHoc.reason
      } else if (adHoc.action === 'wait') {
        this.#reason = adHoc.reason
      } else if (this.#armed?.eventId === null && signal.inCall === null) {
        /*
         * The hold ended, so the unscheduled offer goes with it — the same
         * withdrawal the calendar branch above performs, for the same reason: a
         * standing *Enregistrer* on a call that is over is a button a rep
         * presses. `recording` is exempt because the rep accepted the offer and
         * the call being over is exactly when they stop it themselves.
         */
        this.#withdrawAdHoc()
      }
    }

    this.#publish()

    return horizon
  }

  /** Publish the snapshot, but only when it differs from the last one sent. */
  #publish(): void {
    const snapshot = this.snapshot()
    const key = JSON.stringify(snapshot)
    if (key === this.#published) return
    this.#published = key
    this.#options.onChanged?.(snapshot)
  }

  /**
   * Follow the current microphone hold.
   *
   * A *change* of application restarts the dwell rather than continuing it: the
   * rep left one call and joined another, and the second deserves the same
   * twenty-five seconds of evidence as the first. Losing the hold clears the
   * « already offered » latch, which is what makes the *next* call offerable
   * after this one was dismissed.
   */
  #trackHold(inCall: string | null, now: number): void {
    if (!inCall) {
      this.#heldApp = null
      this.#heldSince = null
      this.#adHocSpent = false
      return
    }
    if (this.#heldApp !== inCall) {
      /*
       * **The previous hold's offer is withdrawn here, and it used not to be.**
       *
       * `#armAdHoc` mints its id from `heldSince`, so a new hold is always a new
       * meeting, and `#withdrawAdHoc` only ever names whatever is *currently* in
       * `#armed` — which the new offer overwrites. So leaving Teams for Zoom
       * stranded the Teams meeting in `armed` for the life of the process, and
       * `armed` is in `UPDATE_BLOCKING_STATES`: **every installer was refused for
       * the rest of the session** with « une réunion est sur le point de
       * démarrer », about a call that had ended. A row the boot sweep does not
       * touch, that `Agenda` will not re-arm, that nothing in the product could
       * move — exactly what the `disarm` docblock was written to end.
       */
      this.#withdrawAdHoc()
      this.#heldApp = inCall
      this.#heldSince = now
      this.#adHocSpent = false
    }
  }

  /**
   * Withdraw a standing **unscheduled** offer, and tell the machine.
   *
   * Only an offer, and only an unscheduled one. A meeting the rep accepted is
   * `recording` and is not this method's business — the call ending is exactly
   * when they stop it themselves — and clearing `#armed` for it would take the
   * live call's own row off the screen. A calendar offer is withdrawn by the
   * branch in `tick` that owns the calendar decision.
   */
  /**
   * Take back the calendar offer `#armed` currently names, before it is overwritten.
   *
   * The mirror of `#withdrawAdHoc` and it is read the same way: the target comes from
   * the field that is *about* to be replaced, so it is read **here**, one line before,
   * and never from somewhere that will have moved on. Only a meeting still in `armed` is
   * disarmed — `recording` is a call under way and is not this function's business, and
   * anything past those has already moved on by itself.
   */
  #withdrawCalendar(except: string): void {
    const standing = this.#armed
    if (standing === null || standing.eventId === null) return
    if (standing.meetingId === except) return
    if (this.#options.orchestrator.stateOf(standing.meetingId) !== 'armed') return
    this.#options.orchestrator.dispatch(
      standing.meetingId,
      'disarm',
      'la réunion est passée sans enregistrement',
    )
  }

  #withdrawAdHoc(): void {
    const meetingId = this.#adHocArmed
    if (meetingId === null) return
    /*
     * **The id comes from `#adHocArmed`, never from `#armed`.** `#arm(event)`
     * overwrites `#armed`, so a target read from there is unreachable the instant
     * a calendar row is armed over a standing offer — see `#adHocArmed`.
     *
     * `#armed` is still cleared, but only when it is *this* meeting: after a
     * calendar arm it names the event's meeting, and taking that off the screen
     * would withdraw the offer the rep just accepted.
     */
    if (this.#armed?.meetingId === meetingId) this.#armed = null
    this.#adHocArmed = null
    if (this.#options.orchestrator.stateOf(meetingId) !== 'armed') return
    this.#options.orchestrator.dispatch(
      meetingId,
      'disarm',
      'l’appel s’est terminé sans enregistrement',
    )
  }

  /**
   * Offer a call that is not in the calendar.
   *
   * The calendar path's shape, minus the event: a deterministic id so every tick
   * of one hold resolves to one meeting, a synthesised context that claims
   * nothing (`adHocContext`), and `onArmed` so the OS notification fires. That
   * notification matters *more* here than on the calendar path — DEC-46's 14:30
   * notification tells a rep something they already knew was coming, while this
   * one is the only way they learn the app noticed a call nobody scheduled.
   */
  #armAdHoc(app: string, now: number): void {
    const heldSince = this.#heldSince ?? now
    const meetingId = adHocMeetingId(heldSince)
    // Latched before anything can fail. A refusal below is not a reason to ask
    // again on every poll for the rest of the call.
    this.#adHocSpent = true

    if (!this.#options.orchestrator.session(meetingId)) {
      this.#options.orchestrator.create({
        id: meetingId,
        title: adHocTitle(app),
        context: adHocContext(app, heldSince),
      })
    }

    const outcome = this.#options.orchestrator.dispatch(meetingId, 'arm', `appel ${app} hors calendrier`)
    const state = outcome.ok ? outcome.to : outcome.state
    if (state !== 'armed' && state !== 'recording') {
      this.#diagnostics.record({
        severity: 'warn',
        code: 'agenda.adhoc.refused',
        module: 'session',
        // Authored on both branches: `state` is a `MeetingState`, and
        // `outcome.reason` is `STATE_REASON[from]` — a literal table in
        // `MeetingSession.ts`. A refusal's sentence is the point of the row.
        origin: 'authored',
        message: outcome.ok ? `état inattendu: ${state}` : outcome.reason,
        detail: { meetingId, state },
        meetingId,
      })
      return
    }

    this.#armed = { meetingId, eventId: null, subject: adHocTitle(app) }
    // Tracked in its own field, so a calendar arm overwriting `#armed` cannot
    // strand this meeting in `armed` for the life of the process.
    this.#adHocArmed = meetingId
    try {
      this.#options.onArmed?.({ meetingId, subject: adHocTitle(app) })
    } catch {
      // The offer is on screen either way; the notification is the extra.
    }
    this.#diagnostics.record({
      severity: 'info',
      code: 'agenda.adhoc.armed',
      module: 'session',
      // Authored: `app` is `MeetingApp.label` — « Teams », « Navigateur »,
      // « Aircall » — a literal from `MEETING_APPS`, never the process name the
      // machine reported. `matchMicHolder` returns the label and nothing else,
      // which is what keeps the rep's own binaries out of this line.
      origin: 'authored',
      message: `appel non planifié détecté — ${app}`,
      detail: { meetingId, app },
      meetingId,
    })
  }

  async #sync(now: number, force: boolean): Promise<void> {
    if (!force && now - this.#window.syncedAt < SYNC_INTERVAL_MS) return
    try {
      this.#window = await this.#options.calendar.sync(now)
      this.#options.onHealth?.({ state: 'ok' })
    } catch (error) {
      // The previous fold stays on screen and stays armable. A calendar that
      // cannot be refreshed is not a calendar that is gone (DEC-26).
      this.#options.onHealth?.(
        this.#options.healthFor?.(error, now) ?? {
          state: 'down',
          reason: error instanceof Error ? `calendrier indisponible — ${error.message}` : 'calendrier indisponible',
          since: now,
          retryable: true,
        },
      )
    }
  }

  /**
   * @param notify whether this arming should raise the OS notification.
   *
   * `false` for `armNow`, and DEC-46 is explicit about why: the notification exists
   * because « something happens at 14:30 », and its click is « the only thing in the
   * product that navigates without the rep having pressed something inside it ».
   * `armNow` *is* a press inside the product. It was raising « La réunion commence.
   * Ouvrir Sillage pour l'enregistrer ? » in answer to the rep's own click, about a
   * meeting half an hour away, and the click of that notification then navigated them
   * somewhere they had not asked to go.
   */
  #arm(target: ArmTarget, notify = true): void {
    const { meetingId, subject } = target
    /*
     * **Already armed is not « nothing to do »: the call may have ended since.**
     *
     * This returned flat, so the meeting's *state* was never consulted again
     * once the offer was standing — and `#armed` is cleared in `#tick` only when
     * `decideArming` stops returning `arm`. `decideArming` is pure over the
     * calendar and the audio: it knows nothing about session state, clears on
     * `now >= scheduledEnd` or when the meeting audio goes quiet, and
     * `MeetingApps` reports a *running process*, not a call.
     *
     * A rep who finished at minute 20 of a 60-minute slot therefore kept, for
     * forty minutes: **Prêt** on a row whose meeting is `awaiting_confirmation`,
     * under the *Passées* divider, wearing the screen's one filled primary
     * reading *Enregistrer* — while `PendingGates` counted the same call and
     * pointed at that row saying « Une autre est dans la liste du jour,
     * au-dessus ». Three statements about one meeting, two of them false, on one
     * screen, and its day dot orange for the rest of the hour.
     *
     * So the standing offer is re-checked rather than assumed. `armed` and
     * `recording` keep it — a call under way is precisely the row to show, and
     * withdrawing it mid-call would be the opposite defect — and anything past
     * those withdraws it. Cheap: a state read, no dispatch, no store write.
     */
    if (this.#armed?.meetingId === meetingId) {
      const state = this.#options.orchestrator.stateOf(meetingId)
      if (state !== 'armed' && state !== 'recording') this.#armed = null
      return
    }

    /*
     * **A call under way takes the conversation, and the calendar waits.**
     *
     * `MeetingSession`'s table is per meeting, so `arm` is legal for every session
     * independently, and `dispatch`'s « one recording at a time » guards `start` only.
     * So two invites that abut with the first still recording — a 14:00 call running to
     * 15:05, which is what a call that matters does — armed the 15:00 invite beside it:
     * measured (`scratch/r29-arm-over-recording.mjs`),
     * `liveStates = ["recording","armed"]`, which is *verbatim* the string CLAUDE.md
     * names as the defect round 24 closed, with two rows on the day and a **second OS
     * notification whose click navigates the rep off their live recording** (DEC-46).
     *
     * A decision and not a refusal, so no diagnostic: the offer is simply not made
     * while the rep is in a call, and the standing offer — the recording one — stays,
     * because that is the row to show. The next tick after they end it arms the invite,
     * because `#spent` then filters the finished call out of the candidates.
     */
    const recording = this.#options.orchestrator
      .liveIds()
      .find((id) => id !== meetingId && this.#options.orchestrator.stateOf(id) === 'recording')
    if (recording !== undefined) return

    // Rehydrated from the log if a previous launch already armed this event —
    // which is exactly the restart case `meetingIdFor` exists for.
    const existing = this.#options.orchestrator.session(meetingId)
    if (!existing) {
      /*
       * A target with no context cannot be created here and must not be: it is a
       * meeting the rep made in this app, which exists in the store already. If
       * the session is missing, something else removed it, and inventing a
       * replacement would put a meeting with no client on the rep's record.
       */
      if (target.context === null) return
      this.#options.orchestrator.create({
        id: meetingId,
        title: target.context.subject || 'Réunion',
        context: target.context,
      })
    }

    const outcome = this.#options.orchestrator.dispatch(meetingId, 'arm', 'calendrier')
    // A call already under way is still the offer to show; one already ended is
    // not, and re-offering it would put *Démarrer* on a finished conversation.
    const state = outcome.ok ? outcome.to : outcome.state
    if (state !== 'armed' && state !== 'recording') {
      /*
       * **And the standing offer is withdrawn, which it was not.**
       *
       * The comment above says a call already ended is not the offer to show,
       * and then this branch returned without touching `#armed` — so the offer
       * survived the end of the call. `#armed` is cleared in `#tick` only when
       * `decideArming` stops returning `arm`, and `decideArming` is pure over the
       * calendar and the audio: it knows nothing about session state, clears on
       * `now >= scheduledEnd` or when the meeting audio goes quiet, and
       * `MeetingApps` reports a *running process*, not a call. So a rep who
       * finished at minute 20 of a 60-minute slot kept, for forty minutes:
       * **Prêt** on a row whose meeting is `awaiting_confirmation`, under the
       * *Passées* divider, wearing the screen's one filled primary reading
       * *Enregistrer* — while `PendingGates` counted the same call and pointed at
       * that row saying « Une autre est dans la liste du jour, au-dessus ». Three
       * statements about one meeting, two of them false, on one screen.
       *
       * Only when it is *this* meeting: a refusal for some other event says
       * nothing about the one currently armed.
       */
      if (this.#armed?.meetingId === meetingId) this.#armed = null
      /*
       * **Once per meeting, not once per tick.**
       *
       * `#arm` is reached from every tick for as long as `nextArmable` recommends an
       * event, and it refuses for as long as that meeting is past `armed` — which on
       * the demo build (DEC-28, no model configured) is **for ever**, because DEC-39
       * says a meeting with no model waits for one. Measured on the shipped class over
       * eighty-five minutes: **ninety-four `warn` rows**, all identical, all saying
       * « Compte-rendu en attente d'analyse. » about a meeting the rep finished — in
       * the bundle whose own button reads « Sans contenu de conversation. Peut être
       * envoyé au support. » A support reader looking for what went wrong finds
       * ninety-four copies of a sentence about something that went right.
       *
       * The edge is the event worth recording: the *first* time this meeting was
       * recommended and refused. `#refused` is cleared when the meeting is armed
       * successfully, so a genuine second refusal after a successful arming is still
       * heard.
       *
       * **Round 28 closed the path those ninety-four rows came down**, and the set stays
       * because the remaining one is real. A conversation the product has finished is no
       * longer a candidate at all (`#spent`), so the tick never asks — which is better
       * than asking and collapsing the answer. What still reaches here is `armNow`: the
       * rep pressing *Enregistrer* on a row drawn before the calendar armed and recorded
       * that call, which consults no detector by design. Once per meeting however many
       * times it is pressed, and `armNow` throws each time, so the rep is told.
       */
      if (this.#refused.has(meetingId)) return
      this.#refused.add(meetingId)
      this.#diagnostics.record({
        severity: 'warn',
        code: 'agenda.arm.refused',
        module: 'session',
        // Authored on both branches: `state` is a `MeetingState`, and
        // `outcome.reason` is `STATE_REASON[from]` — a literal table in
        // `MeetingSession.ts`. A refusal's sentence is the point of the row.
        origin: 'authored',
        message: outcome.ok ? `état inattendu: ${state}` : outcome.reason,
        detail: { meetingId, state },
        meetingId,
      })
      return
    }

    /*
     * **Withdraw the unscheduled offer before overwriting the field that names
     * it.** Without this, a rep pressing *Enregistrer* on an upcoming row while a
     * call was detected left the ad-hoc meeting `armed` with nothing able to reach
     * it: every installer refused, the detector off for the session, a phantom row
     * on the day. See `#adHocArmed`.
     */
    this.#withdrawAdHoc()
    /*
     * **And the calendar offer it is replacing, which had no equivalent at all.**
     *
     * `#withdrawAdHoc` above exists because `#armed` is *overwritten* here and a
     * target read out of the field being overwritten is unreachable — round 25's
     * finding, and `#adHocArmed` is its own field for exactly that reason. The
     * calendar half was never written. Two invites that abut — 14:00–15:00 and
     * 15:00–16:00, the ordinary shape of a rep's day — and at 15:00 `nextArmable`
     * answers `arm` for the second, so the expiry branch in `tick` is an `else if`
     * that never runs and the first is never named again. Measured on the shipped
     * `Agenda` (`scratch/r29-armed-stranded.mjs`), with the rep taking the 14:00 on
     * their mobile:
     *
     *   15:00  liveStates ["armed","armed"]
     *   16:30  liveStates ["armed","idle"]   ← the second withdrew itself; the first cannot
     *   17:00  liveStates ["armed","idle"]   updateReadiness { safe: false }
     *
     * Three costs, all for the rest of the process and all past a relaunch, because
     * the row is in the store: **every installer refused** with « une réunion est sur
     * le point de démarrer » about a call that never happened; the ad-hoc detector
     * **off for the working day**, because `meetingLive` counts that row and
     * `#adHocSpent` latches — measured, one offer for a genuine 17:00 client call on
     * two non-adjacent invites and **zero** on two that abut; and a row in *À venir*
     * wearing « Prêt », past `entries.ts`'s `isPast`, on a day four days gone.
     *
     * `agenda.test.ts` had « leaving Teams for Zoom does not strand the Teams meeting »
     * (ad-hoc → ad-hoc) and « arming a calendar row over a standing offer does not
     * strand the offer » (calendar → ad-hoc). The calendar → calendar direction — the
     * ordinary one — had no test, and a hundred and one tests passed with this live.
     */
    this.#withdrawCalendar(meetingId)
    this.#refused.delete(meetingId)
    this.#armed = { meetingId, eventId: target.eventId, subject }
    // After the state is set and before the diagnostic, so a listener that
    // throws cannot leave the agenda armed-but-unrecorded — and it is wrapped,
    // because a notification is never a reason a meeting fails to arm (DEC-26).
    try {
      if (notify) this.#options.onArmed?.({ meetingId, subject })
    } catch {
      // The offer is on screen either way; the notification is the extra.
    }
    this.#diagnostics.record({
      severity: 'info',
      code: 'agenda.armed',
      module: 'session',
      /*
       * **The subject is the client's, so it goes in `detail` and not here.**
       *
       * `redactMessage` is a denylist — emails, URLs, paths, quoted runs — and a
       * meeting's objet is none of those: « Sodexial — comité de staffing
       * renfort Java Q4 » came back from it unchanged and into the bundle whose
       * button reads « Sans contenu de conversation. Peut être envoyé au
       * support ». `redactDetail` is the allowlist, and it replaces a
       * fifty-character string with `[string:50]`, which is the whole of what a
       * support reader needs: a meeting was armed, and it had a subject.
       */
      /*
        **One literal, and « depuis le calendrier » is dropped rather than
        branched.** A meeting the rep placed in this app arms through this same
        method now, so the old sentence is no longer true of every caller — and
        `check:diag` is right to refuse the ternary that would have said which:
        a recorded message must be a literal this product wrote, because that is
        what makes `origin: 'foreign'` mean anything. Which kind it was is
        already in the record: a calendar arming carries a `start`, and a
        rep-placed one carries `null`.
      */
      message: 'réunion armée',
      detail: { start: target.context?.scheduledStart ?? null, subject },
      meetingId,
    })
  }
}
