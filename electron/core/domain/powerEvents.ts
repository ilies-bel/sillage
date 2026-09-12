/**
 * **« mon portable s’est mis en veille pendant l’appel »** — which power event
 * ends a live recording, and the French sentence each one produces.
 *
 * The machine going to sleep takes the audio devices with it, and nothing in
 * this product noticed: `powerMonitor` was not referenced anywhere. So the
 * meeting stayed in `recording` with nothing behind it — precisely the condition
 * the boot sweep exists to repair after a crash, except that here the process is
 * still alive and no sweep will ever run. `EndOfMeetingWatch` cannot rescue it
 * either: its countdown starts from a *silence edge*, and a lid closed
 * mid-sentence leaves `#speaking` non-empty, so no timer is ever armed. Measured
 * on the shipped watch — a rep talking when the lid shuts, sixty minutes of fake
 * clock, **0 timers armed, 0 ends, state still `recording`**.
 *
 * Pure, and the split is the same one `endOfMeeting.ts` makes: this file says
 * what an event *means*, `app/session/PowerWatch.ts` subscribes to the real
 * emitter and dispatches.
 *
 * Being wrong is expensive in **both** directions, which is why every branch is
 * decided here rather than by a set of event names in a handler:
 *
 *  · `suspend` must end. The machine may never come back — a battery that dies
 *    asleep, a hibernate image discarded — so the transition has to be in the
 *    log before the process stops running.
 *  · `shutdown` must end, on the same argument, because `before-quit` is not
 *    promised to run first.
 *  · `session-end` must end, and it is the one of those two that a rep on
 *    Windows can actually reach: `powerMonitor`'s `shutdown` is `linux,darwin`
 *    only. « Éteindre le PC » and « Se déconnecter » both arrive here.
 *  · `lock-screen` must **not**. A locked screen still records on both
 *    platforms, and display sleep is not system sleep: a rep who locks their
 *    laptop on a headset call is having an ordinary call. Ending there destroys
 *    a live recording for a gesture that costs nothing.
 *  · `resume` restarts nothing. The rep pressed *Enregistrer*; the app does not
 *    press it for them, and a resumed capture would be a second recording with a
 *    different `startedAt` inside one meeting.
 *
 * `on-battery` / `on-ac` are here for the same reason as the two lock events:
 * they are what `powerMonitor` emits, and a rule that lists only what it acts on
 * cannot be read as a decision about the rest.
 */

/**
 * The `powerMonitor` events this product subscribes to, in subscription order.
 *
 * The union is **derived from this tuple** and not written twice: a list and a
 * union kept equal by hand is a decision that can be added to the type and
 * reached by nothing, and `PowerWatch` subscribes by walking this array. So an
 * event exists here or it does not exist — and `decidePowerEvent`'s switch is
 * exhaustive over the result, which is `tsc` refusing a new one with no branch.
 *
 * `shutdown` is **`@platform linux,darwin`** — read off Electron 43's own
 * `powerMonitor` declarations, where every other event here is `darwin,win32`.
 * So the branch this file argues hardest for is the one that cannot fire on the
 * platform this product ships to (HR-2). That is US-2's whole subject, and it is
 * the reason the Windows event needed its own tuple rather than an eighth entry
 * here: `PowerWatch` *walks* this array to subscribe, so an event `powerMonitor`
 * does not emit would have been a subscription with no emitter — the fourth
 * shape on this repo's list — and the rule would have read as covered.
 */
export const POWER_MONITOR_EVENTS = [
  'suspend',
  'resume',
  'shutdown',
  'lock-screen',
  'unlock-screen',
  'on-battery',
  'on-ac',
] as const

export type PowerMonitorEvent = (typeof POWER_MONITOR_EVENTS)[number]

/**
 * **« j’ai éteint le PC, la réunion est restée ouverte »** — the same remedy as
 * `suspend`, one event earlier, on the platform that matters.
 *
 * Windows' own « the session is ending » is `session-end`, and it is emitted on
 * the **window**, not on `app`: in Electron 43 it is declared on `BaseWindow` and
 * `BrowserWindow` as `@platform win32` (« Emitted when a session is about to end
 * due to a shutdown, machine restart, or user log-off. Once this event fires,
 * there is no way to prevent the session from ending. »), and the `App` interface
 * declares no such event at all. US-2's own text names `app.on('session-end')`;
 * that was checked before it was written, and `app` is a plain `EventEmitter`, so
 * subscribing there compiles, never fires, and looks exactly like a fix. So this
 * tuple is walked against each window (`PowerWatch`), and `POWER_MONITOR_EVENTS`
 * against `powerMonitor` — two emitters, one decision table.
 *
 * `query-session-end` is deliberately **not** here, though it is the earlier of
 * the pair (`WM_QUERYENDSESSION` before `WM_ENDSESSION`) and would buy a few more
 * milliseconds. It can be vetoed — by this app or by any other — so ending a
 * recording on it would destroy a live call for a shutdown that never happened,
 * which is the `lock-screen` mistake with a Windows spelling.
 */
export const WINDOW_POWER_EVENTS = ['session-end'] as const

export type WindowPowerEvent = (typeof WINDOW_POWER_EVENTS)[number]

export type PowerEvent = PowerMonitorEvent | WindowPowerEvent

/**
 * Every event the rule decides, whichever emitter carries it. The two tuples
 * above are what gets *subscribed*; this is what gets *decided*, and the tests
 * walk it so an event added to either list lands here and has to be named.
 */
export const POWER_EVENTS: readonly PowerEvent[] = [
  ...POWER_MONITOR_EVENTS,
  ...WINDOW_POWER_EVENTS,
]

/**
 * `end` carries the reason into `dispatch(id, 'end', reason)`, which the rep
 * reads back on the row and in the diagnostics log. `keep` carries one too: a
 * branch that decides to do nothing has still decided something, and the
 * sentence is what makes the two readable side by side.
 *
 * `notice` is the other half of « the rep is told exactly once per sleep ». The
 * notice is raised on `resume`, so it is owed only by an end the rep comes *back*
 * from with this process still running — and `sleepInterruptedNotice` says « la
 * mise en veille a arrêté l’enregistrement », which is a **false** sentence about
 * a shutdown or a Windows session end. Neither of those is followed by a `resume`
 * in the ordinary case, so the field looks redundant until one of them does not
 * happen: `session-end` can be raced by a shutdown another application vetoes,
 * and then the remembered meeting waits in the field until some later sleep wakes
 * up and reads it. A stale sentence about a call that has since been dealt with is
 * exactly what the « exactly once » rule was written against.
 */
export type PowerDecision =
  | { action: 'end'; reason: string; notice: 'on-resume' | 'none' }
  | { action: 'keep'; reason: string }

export const decidePowerEvent = (event: PowerEvent): PowerDecision => {
  switch (event) {
    case 'suspend':
      return { action: 'end', reason: 'mise en veille de l’ordinateur', notice: 'on-resume' }
    case 'shutdown':
      return { action: 'end', reason: 'arrêt de l’ordinateur', notice: 'none' }
    case 'session-end':
      return { action: 'end', reason: 'fermeture de la session Windows', notice: 'none' }
    case 'resume':
      return { action: 'keep', reason: 'sortie de veille — l’enregistrement n’est pas relancé' }
    case 'lock-screen':
      return { action: 'keep', reason: 'écran verrouillé — l’appel continue' }
    case 'unlock-screen':
      return { action: 'keep', reason: 'écran déverrouillé' }
    case 'on-battery':
      return { action: 'keep', reason: 'passage sur batterie' }
    case 'on-ac':
      return { action: 'keep', reason: 'passage sur secteur' }
  }
}

/**
 * What the rep reads when they open the lid, because the screen was off when the
 * recording stopped (DEC-26: a stated degradation, never a silent one).
 *
 * It says a new recording and not « reprendre »: `start` is not a legal command
 * from `ended` (`MeetingSession`'s table), so the meeting that was interrupted
 * cannot be resumed, and offering that would be the dead control DEC-26 forbids.
 * The title is the objet, the way the arming notification's is (DEC-46).
 */
export const sleepInterruptedNotice = (
  subject: string | null,
): { title: string; body: string } => ({
  title: subject && subject.trim() !== '' ? subject : 'Réunion',
  body: 'La mise en veille a arrêté l’enregistrement. Ouvrir Sillage pour en démarrer un nouveau ?',
})
