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
import { nextArmable } from '../../core/domain/arming.ts'
import {
  adHocContext,
  adHocMeetingId,
  adHocTitle,
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
  #adHocOffered = false
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
      armed: this.#armed,
      reason: this.#reason,
    }
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
    this.#arm(event)
    /*
     * Read back rather than returned from `#arm`: `#arm` has three exits — a
     * standing offer it keeps, a fresh arming, and a refusal that clears
     * `#armed` — and the id the *renderer* should open is whatever the agenda
     * now says is armed. Composing it here from `meetingIdFor` would be a second
     * source for one fact, and would happily name a meeting the dispatch just
     * refused.
     */
    const armed = this.#armed
    if (!armed) throw new Error('Cette réunion ne peut plus être démarrée.')
    // Through the same guard as the tick: arming changes the snapshot, so this
    // always publishes — and a second source for « has it changed » is how the
    // two answers drift.
    this.#publish()
    return { meetingId: armed.meetingId }
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

    const choice = nextArmable(this.#window.events, now, signal.running, signal.inCall)
    this.#reason = choice.decision.reason

    if (choice.decision.action === 'arm' && choice.event) {
      this.#arm(choice.event)
    } else if (this.#armed && this.#armed.eventId !== null) {
      // The offer expired — the event ended, was cancelled, or the app closed.
      // Leaving it on screen would have the rep pressing Démarrer on a meeting
      // that is over.
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
     */
    if (!(choice.decision.action === 'arm' && choice.event)) {
      /*
       * **Is this product already doing something about a meeting?**
       *
       * `liveStates()` is every session this process holds — created or
       * rehydrated this run — so anything recording, extracting, awaiting
       * confirmation or draining counts. `idle` and `done` do not: a meeting that
       * finished is not a reason to refuse the next call.
       *
       * The field this replaces was `calendarArmed: false`, hard-coded, so the
       * rule it named was never applied. See `AdHocInput.meetingLive` for the
       * three paths that went through the hole.
       */
      const live = this.#options.orchestrator
        .liveStates()
        .some((state) => state === 'armed' || state === 'recording')

      const adHoc = decideAdHoc({
        micHeldBy: signal.inCall,
        now,
        heldSince: this.#heldSince,
        meetingLive: live,
        offered: this.#adHocOffered,
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
      this.#adHocOffered = false
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
      this.#adHocOffered = false
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
  #withdrawAdHoc(): void {
    const standing = this.#armed
    if (!standing || standing.eventId !== null) return
    if (this.#options.orchestrator.stateOf(standing.meetingId) !== 'armed') return
    this.#armed = null
    this.#options.orchestrator.dispatch(
      standing.meetingId,
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
    this.#adHocOffered = true

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

  #arm(event: CalendarEvent): void {
    const meetingId = meetingIdFor(event.id)
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

    // Rehydrated from the log if a previous launch already armed this event —
    // which is exactly the restart case `meetingIdFor` exists for.
    const existing = this.#options.orchestrator.session(meetingId)
    if (!existing) {
      this.#options.orchestrator.create({
        id: meetingId,
        title: event.context.subject || 'Réunion',
        context: event.context,
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

    this.#armed = { meetingId, eventId: event.id, subject: event.context.subject }
    // After the state is set and before the diagnostic, so a listener that
    // throws cannot leave the agenda armed-but-unrecorded — and it is wrapped,
    // because a notification is never a reason a meeting fails to arm (DEC-26).
    try {
      this.#options.onArmed?.({ meetingId, subject: event.context.subject })
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
      message: 'réunion armée depuis le calendrier',
      detail: { start: event.context.scheduledStart, subject: event.context.subject },
      meetingId,
    })
  }
}
