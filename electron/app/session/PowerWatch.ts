/**
 * **The machine going to sleep ends the recording, and says so on the way back.**
 *
 * `core/domain/powerEvents.ts` holds the rule — which events end a live
 * recording and the sentence each produces. This is the other half: it
 * subscribes to the real `powerMonitor`, and on the events the rule ends it
 * dispatches `end` **synchronously, inside the handler**.
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
  POWER_EVENTS,
  decidePowerEvent,
  sleepInterruptedNotice,
  type PowerEvent,
} from '../../core/domain/powerEvents.ts'
import type { Orchestrator } from './Orchestrator.ts'
import type { Store } from '../../modules/store/index.ts'

/**
 * The half of Electron's `powerMonitor` this uses. Structural so the test drives
 * a plain emitter and this file needs no runtime `electron` import.
 */
export interface PowerEmitter {
  on(event: PowerEvent, listener: () => void): unknown
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

  const endRecordings = (event: PowerEvent, reason: string): void => {
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
        interrupted = meetingId
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

  for (const event of POWER_EVENTS) {
    deps.power.on(event, () => {
      const decision = decidePowerEvent(event)
      if (decision.action === 'end') {
        endRecordings(event, decision.reason)
        return
      }
      // `resume` is the one `keep` that owes the rep a sentence, and it owes it
      // only when a sleep actually cost a recording.
      if (event === 'resume') announce()
    })
  }
}
