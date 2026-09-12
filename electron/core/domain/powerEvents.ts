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
 * Windows' own « the session is ending » arrives as `app.on('session-end')`
 * rather than through `powerMonitor`, and is US-2's.
 */
export const POWER_EVENTS = [
  'suspend',
  'resume',
  'shutdown',
  'lock-screen',
  'unlock-screen',
  'on-battery',
  'on-ac',
] as const

export type PowerEvent = (typeof POWER_EVENTS)[number]

/**
 * `end` carries the reason into `dispatch(id, 'end', reason)`, which the rep
 * reads back on the row and in the diagnostics log. `keep` carries one too: a
 * branch that decides to do nothing has still decided something, and the
 * sentence is what makes the two readable side by side.
 */
export type PowerDecision =
  | { action: 'end'; reason: string }
  | { action: 'keep'; reason: string }

export const decidePowerEvent = (event: PowerEvent): PowerDecision => {
  switch (event) {
    case 'suspend':
      return { action: 'end', reason: 'mise en veille de l’ordinateur' }
    case 'shutdown':
      return { action: 'end', reason: 'arrêt de l’ordinateur' }
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
