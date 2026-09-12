/**
 * **The machine going to sleep — or off — ends the recording, and says so on the
 * way back.**
 *
 * `core/domain/powerEvents.ts` holds the rule — which events end a live
 * recording and the sentence each produces. This is the other half: it
 * subscribes to the real emitters, and on the events the rule ends it dispatches
 * `end` **synchronously, inside the handler**.
 *
 * **Two emitters, because Windows' « the session is ending » is not a
 * `powerMonitor` event and not an `app` one either.** `powerMonitor`'s `shutdown`
 * is declared `@platform linux,darwin`, so US-1's shutdown branch could never fire
 * on the platform this product ships to (HR-2); what fires there is `session-end`,
 * declared on `BaseWindow`/`BrowserWindow` as `@platform win32`. US-2's own text
 * says `app.on('session-end')` and Electron 43's `App` interface has no such
 * event — `app` is a plain `EventEmitter`, so that subscription would have
 * compiled, never fired, and read as a fix. So `POWER_MONITOR_EVENTS` is walked
 * against `powerMonitor` and `WINDOW_POWER_EVENTS` against every window this
 * process owns, through one decision table.
 *
 * Both halves of that are load-bearing:
 *
 *  · **Synchronously.** The machine may never come back — a battery that dies
 *    asleep, a hibernate image the OS discards — so the transition has to be in
 *    the log before the process stops running. A `queueMicrotask`, a `setTimeout`
 *    or an `await` here is a transition that happens on some machines and not on
 *    the ones the rep will be upset about. `Orchestrator.dispatch` is synchronous
 *    and broadcasts `session:changed`, and it already fires `#enhance` on the
 *    `recording → ended` edge — which flushes both providers and runs the recipe
 *    when the machine wakes. So this file adds a *caller*, never a path.
 *  · **No `stopRecording` await**, unlike `before-quit`. A quit is deferrable and
 *    this is not: `powerMonitor` does not hold the machine awake while a handler
 *    finishes, so eight seconds of flushing would be eight seconds that may not
 *    exist. The flush still happens, on the way out or on the way back, through
 *    the enhancement `dispatch` starts.
 *
 * And the rep is told, because the screen was off when it happened (DEC-26: a
 * stated degradation, never a silent one). Mirrors the arming notification
 * (DEC-46, `announceMeeting` in `main.ts`) rather than inventing a second
 * mechanism: one `Notification`, its click brings the window forward on that
 * meeting, and failing to show is free — a notification that will not show is not
 * a meeting that will not end.
 *
 * A shutdown and a Windows session end raise **nothing**: the sentence names the
 * sleep, there is no `resume` to read it on, and a meeting remembered against one
 * of them would wait in the field for some later sleep to publish it as a stale
 * fact about a call that has since been dealt with. `PowerDecision.notice` is
 * where that is decided, next to the sentence it would print.
 *
 * **Exactly once per sleep, and nothing at all when the sleep ended no
 * recording.** The interrupted meeting is remembered at `suspend` and the notice
 * is raised at `resume`, then forgotten: a machine that sleeps twice in a morning
 * with no call in between must say nothing either time, and a rep who resumes,
 * suspends and resumes again must not read a stale sentence about a call that has
 * since been dealt with.
 *
 * Electron is reached only through injected objects and a structural type, so
 * this file imports nothing from `electron` at runtime and the whole of it is
 * drivable under `node --test` against a real `Orchestrator`.
 */
import type { MeetingId } from '../../core/contracts/meeting.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import {
  POWER_MONITOR_EVENTS,
  WINDOW_POWER_EVENTS,
  decidePowerEvent,
  sleepInterruptedNotice,
  type PowerEvent,
  type PowerMonitorEvent,
  type WindowPowerEvent,
} from '../../core/domain/powerEvents.ts'
import type { Orchestrator } from './Orchestrator.ts'
import type { Store } from '../../modules/store/index.ts'

/**
 * The half of Electron's `powerMonitor` this uses. Structural so the test drives
 * a plain emitter and this file needs no runtime `electron` import.
 */
export interface PowerEmitter {
  on(event: PowerMonitorEvent, listener: () => void): unknown
}

/**
 * The half of Electron's `BaseWindow` this uses: Windows' `session-end`.
 *
 * It is a **window** event and not an `app` one — `core/domain/powerEvents.ts`
 * carries the reading off Electron 43's own declarations — so the subscription
 * has to happen per window, and `WindowHost` below is how they are reached.
 */
export interface SessionEndEmitter {
  on(event: WindowPowerEvent, listener: () => void): unknown
}

/**
 * Every top-level window of this process, present and future.
 *
 * `WM_ENDSESSION` is delivered to each of them, so each is subscribed and the
 * handler is idempotent (the recording filter below sees `ended` the second
 * time). Both halves are load-bearing and neither is optional:
 *
 *  · **`all`**, because a watch installed after a window exists would
 *    otherwise miss precisely the window the rep is looking at, silently. Today
 *    `main.ts` installs this before `createWindow()`; a future reordering must
 *    not decide whether a shutdown costs a recording.
 *  · **`onOpened`**, because the widget over the call (DEC-49) is
 *    created *while* a meeting is recording, and on macOS `activate` mints a new
 *    main window after the last one closed.
 */
export interface WindowHost {
  /** Every window open now — `BrowserWindow.getAllWindows()`. */
  all(): SessionEndEmitter[]
  /** Every window opened from now on — `app.on('browser-window-created')`. */
  onOpened(listener: (window: SessionEndEmitter) => void): void
}

/**
 * The half of Electron's `Notification` this uses — the class, because it is the
 * class `main.ts` passes in.
 */
export interface NotificationHost {
  isSupported(): boolean
  new (options: { title: string; body: string; silent?: boolean }): {
    on(event: 'click', listener: () => void): unknown
    show(): void
  }
}

export interface PowerWatchDeps {
  power: PowerEmitter
  /** Where Windows' `session-end` is heard. Required: see `WindowHost`. */
  windows: WindowHost
  /** Narrow on purpose: this decides nothing about a meeting, it only ends one. */
  orchestrator: Pick<Orchestrator, 'liveIds' | 'stateOf' | 'dispatch'>
  /** For the objet the notification is titled with. */
  store: Pick<Store, 'projections'>
  diagnostics: DiagRecorder
  /**
   * Electron's `Notification`, or null where there is none to give — a headless
   * run, a test that is not about the notice. Null is a first-class answer: the
   * recording still ends.
   */
  notification?: NotificationHost | null
  /** The notification's click: bring the window forward on that meeting. */
  onOpen?: (meetingId: MeetingId) => void
}

export const watchPower = (deps: PowerWatchDeps): void => {
  /**
   * The meeting a sleep ended, held until the rep is told. Null means the last
   * sleep cost nothing, which is the case that must stay silent.
   */
  let interrupted: MeetingId | null = null

  const endRecordings = (
    event: PowerEvent,
    reason: string,
    notice: 'on-resume' | 'none',
  ): void => {
    /*
     * **The first half of the double-end guard.** On a Windows shutdown
     * `session-end` reaches every top-level window of this process — the app
     * window and the pill over the call (DEC-49) — and `before-quit` may well
     * follow it; `before-quit` filters on exactly this predicate too. Whichever
     * arrives first moves the meeting to `ended` and every later arrival finds
     * nothing recording.
     *
     * The second half is `outcome.ok` below, and the two are **redundant by
     * measurement, not by intention**: weakening either one alone still leaves one
     * `session.transition` in the log and one `session.powerEnded` row, and
     * weakening both gives two of each on « two windows, one shutdown ». So do not
     * read either as decorative, and do not rely on one of them on the way out.
     */
    const recording = deps.orchestrator
      .liveIds()
      .filter((id) => deps.orchestrator.stateOf(id) === 'recording')

    for (const meetingId of recording) {
      /*
       * Guarded the way `before-quit`'s loop is, and for a sharper reason: this
       * runs inside an OS event handler at the most awkward instant there is, and
       * an exception escaping here is an unhandled one that takes the main process
       * down — the argument `Orchestrator`'s broadcast wrapper already makes about
       * a timer. One meeting failing must not cost the next one its end.
       */
      try {
        const outcome = deps.orchestrator.dispatch(meetingId, 'end', reason)
        if (!outcome.ok) continue
        // Only an end the rep comes back from owes them the resume sentence, and
        // only that one may hold the field — see `PowerDecision.notice`.
        if (notice === 'on-resume') interrupted = meetingId
        deps.diagnostics.record({
          severity: 'warn',
          code: 'session.powerEnded',
          module: 'app',
          // Our own French, from the closed table in `core/domain/powerEvents.ts`.
          origin: 'authored',
          message: reason,
          detail: { event },
          meetingId,
        })
      } catch (error) {
        deps.diagnostics.record({
          severity: 'error',
          code: 'session.powerEndFailed',
          module: 'app',
          origin: 'foreign',
          message: error instanceof Error ? error.message : 'arrêt impossible',
          detail: { event },
          meetingId,
        })
      }
    }
  }

  const announce = (): void => {
    const meetingId = interrupted
    if (meetingId === null) return
    // Forgotten whether or not the OS agrees to show anything: the promise is
    // « once per sleep », not « until it is seen ».
    interrupted = null

    const host = deps.notification
    if (!host) return
    // The store read is inside the try as well: a resume arriving while the app is
    // quitting would read a closed database, and this is an OS handler, where a
    // throw is an unhandled one.
    try {
      if (!host.isSupported()) return
      const notice = sleepInterruptedNotice(
        deps.store.projections.getMeeting(meetingId)?.title ?? null,
      )
      const notification = new host({ title: notice.title, body: notice.body, silent: false })
      notification.on('click', () => deps.onOpen?.(meetingId))
      notification.show()
    } catch {
      // A notification that will not show is not a meeting that will not end.
    }
  }

  /** One decision table, whichever emitter carried the event. */
  const handle = (event: PowerEvent): void => {
    const decision = decidePowerEvent(event)
    if (decision.action === 'end') {
      endRecordings(event, decision.reason, decision.notice)
      return
    }
    // `resume` is the one `keep` that owes the rep a sentence, and it owes it
    // only when a sleep actually cost a recording.
    if (event === 'resume') announce()
  }

  for (const event of POWER_MONITOR_EVENTS) {
    deps.power.on(event, () => handle(event))
  }

  const watchWindow = (window: SessionEndEmitter): void => {
    for (const event of WINDOW_POWER_EVENTS) {
      window.on(event, () => handle(event))
    }
  }
  for (const window of deps.windows.all()) watchWindow(window)
  deps.windows.onOpened(watchWindow)
}
