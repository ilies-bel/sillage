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
  /** The meeting currently offered, if any. */
  armed: { meetingId: string; eventId: string; subject: string } | null
  /** Why nothing is armed, in French, for the empty state. */
  reason: string
}

export interface AgendaOptions {
  calendar: CalendarPort
  orchestrator: Orchestrator
  /**
   * The process signal, already sampled. Injected as a value rather than a
   * probe so this class never learns how it is obtained.
   */
  meetingAudio: () => string | null
  /** Refreshes that signal. Awaited before each evaluation. */
  refreshMeetingAudio?: () => Promise<unknown>
  diagnostics?: DiagRecorder
  clock?: () => number
  onHealth?: (health: ConnectorHealth) => void
  onChanged?: (snapshot: AgendaSnapshot) => void
  /** Maps a failure to a health state. Injected so `app/` keeps that mapping. */
  healthFor?: (error: unknown, at: number) => ConnectorHealth
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
      armed: this.#armed,
      reason: this.#reason,
    }
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
    await this.#options.refreshMeetingAudio?.()

    const choice = nextArmable(this.#window.events, now, this.#options.meetingAudio())
    this.#reason = choice.decision.reason

    if (choice.decision.action === 'arm' && choice.event) {
      this.#arm(choice.event)
    } else if (this.#armed) {
      // The offer expired — the event ended, was cancelled, or the app closed.
      // Leaving it on screen would have the rep pressing Démarrer on a meeting
      // that is over.
      this.#armed = null
    }

    this.#options.onChanged?.(this.snapshot())

    return choice.decision.action === 'wait'
      ? choice.decision.untilMs
      : now + SYNC_INTERVAL_MS
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
          reason: error instanceof Error ? error.message : 'calendrier indisponible',
          since: now,
          retryable: true,
        },
      )
    }
  }

  #arm(event: CalendarEvent): void {
    const meetingId = meetingIdFor(event.id)
    if (this.#armed?.meetingId === meetingId) return

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
      this.#diagnostics.record({
        severity: 'warn',
        code: 'agenda.arm.refused',
        module: 'session',
        message: outcome.ok ? `état inattendu: ${state}` : outcome.reason,
        detail: { meetingId, state },
        meetingId,
      })
      return
    }

    this.#armed = { meetingId, eventId: event.id, subject: event.context.subject }
    this.#diagnostics.record({
      severity: 'info',
      code: 'agenda.armed',
      module: 'session',
      message: `réunion armée depuis le calendrier: ${event.context.subject}`,
      detail: { start: event.context.scheduledStart },
      meetingId,
    })
  }
}
