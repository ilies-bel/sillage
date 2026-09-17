/**
 * Runs DEC-16's grace countdown against a live meeting.
 *
 * `core/domain/endOfMeeting.ts` decides what a stretch of silence *means* and
 * knows nothing about time passing. This is the other half: it turns the two
 * capture edges into a `silentSince`, asks the rule what to do, and either waits
 * or ends the meeting. Splitting it this way is what keeps the rule testable
 * with no timers and this file testable with a fake clock.
 *
 * **Silence is judged on both channels together.** DEC-9 talks about the system
 * audio, but a meeting where the rep is talking and nobody answers is not over —
 * and neither is the reverse. The meeting is silent only when both ends are.
 */
import type { Channel } from '../../core/contracts/transcript.ts'
import { decideEndOfMeeting } from '../../core/domain/endOfMeeting.ts'
import { MAX_ARMABLE_DURATION_MS } from '../../core/domain/arming.ts'

export interface EndOfMeetingWatchDeps {
  /** From the calendar. Null for a session the rep started by hand. */
  scheduledEnd: number | null
  /** Ends the meeting. The reason is the one the rule produced. */
  onEnd: (reason: string) => void
  clock?: () => number
  /**
   * Injected so a test drives the countdown with a fake clock instead of
   * waiting seventy-five real seconds.
   */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class EndOfMeetingWatch {
  #deps: EndOfMeetingWatchDeps
  #clock: () => number
  #setTimer: (fn: () => void, ms: number) => unknown
  #clearTimer: (handle: unknown) => void
  /**
   * Channels currently carrying speech. The meeting is silent when this is
   * empty — a set rather than two booleans because "which channels are live"
   * is exactly the question, and it answers `size === 0` directly.
   */
  #speaking = new Set<Channel>()
  #silentSince: number | null = null
  #timer: unknown = null
  /**
   * The hold's own ceiling. Separate from `#timer` because the two are
   * opposites: `#timer` is the countdown a hold suspends, and this is what
   * suspends the suspension.
   */
  #holdTimer: unknown = null
  #stopped = false
  #held = false

  constructor(deps: EndOfMeetingWatchDeps) {
    this.#deps = deps
    this.#clock = deps.clock ?? Date.now
    this.#setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.#clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as never))
  }

  /** Visible for the session screen: when the current silence began, or null. */
  get silentSince(): number | null {
    return this.#silentSince
  }

  speechStarted(channel: Channel): void {
    if (this.#stopped) return
    this.#speaking.add(channel)
    if (this.#silentSince === null) return
    // Audio resumed inside the grace window. Cancelled silently — no dialog, no
    // "are you still there?" over a live call (DEC-9).
    this.#silentSince = null
    this.#disarm()
  }

  speechEnded(channel: Channel): void {
    if (this.#stopped) return
    this.#speaking.delete(channel)
    if (this.#speaking.size > 0) return
    // Already counting: a second channel falling quiet does not restart the
    // clock, or a two-sided pause would never reach its deadline.
    if (this.#silentSince !== null) return
    this.#silentSince = this.#clock()
    this.#evaluate()
  }

  /*
   * **`manual()` is gone, and it was never callable.**
   *
   * « The rep pressed *Terminer*. Short-circuits the grace window entirely. »
   * — except pressing *Terminer* goes through the state machine, and
   * `Orchestrator.stopRecording` calls `stop()` on this watch as its second
   * line. Calling `manual()` from there would have fired `onEnd` on a meeting
   * the orchestrator was already ending. Declared, documented, unit-tested,
   * with no caller and no correct place for one: the shape `check:surfaces`
   * exists to catch, one layer below where it was looking.
   */

  /** The meeting ended by another route. Nothing may fire afterwards. */
  /**
   * **A paused call is quiet on purpose.**
   *
   * Holding stops the silence clock without forgetting it was silent: the
   * timer is disarmed and the edges keep arriving. Releasing restarts the
   * count from *now* if every channel is still quiet — the two minutes the rep
   * spent away are theirs, not the grace window's — and does nothing at all
   * if someone is speaking.
   */
  hold(): void {
    if (this.#stopped || this.#held) return
    this.#held = true
    this.#disarm()
    this.#holdTimer = this.#setTimer(() => this.release(), MAX_ARMABLE_DURATION_MS)
  }

  release(): void {
    if (this.#stopped || !this.#held) return
    this.#held = false
    this.#clearHold()
    if (this.#speaking.size > 0) {
      this.#silentSince = null
      return
    }
    this.#silentSince = this.#clock()
    this.#evaluate()
  }

  get held(): boolean {
    return this.#held
  }

  stop(): void {
    this.#stopped = true
    this.#disarm()
    this.#clearHold()
  }

  #clearHold(): void {
    if (this.#holdTimer === null) return
    this.#clearTimer(this.#holdTimer)
    this.#holdTimer = null
  }

  #evaluate(): void {
    if (this.#stopped || this.#held) return
    const decision = decideEndOfMeeting({
      now: this.#clock(),
      silentSince: this.#silentSince,
      scheduledEnd: this.#deps.scheduledEnd,
      manual: false,
    })

    if (decision.action === 'end') {
      this.#end(decision)
      return
    }
    if (decision.action === 'continue') {
      this.#disarm()
      return
    }

    // `wait`. Re-ask at the deadline rather than trusting the timer to have
    // slept exactly that long: a laptop that suspended mid-meeting wakes with
    // the clock far past the deadline, and re-asking turns that into an end
    // rather than another full grace window.
    this.#disarm()
    const delay = Math.max(0, decision.untilMs - this.#clock())
    this.#timer = this.#setTimer(() => {
      this.#timer = null
      this.#evaluate()
    }, delay)
  }

  #end(decision: { action: string; reason: string }): void {
    this.#stopped = true
    this.#disarm()
    this.#deps.onEnd(decision.reason)
  }

  #disarm(): void {
    if (this.#timer === null) return
    this.#clearTimer(this.#timer)
    this.#timer = null
  }
}
