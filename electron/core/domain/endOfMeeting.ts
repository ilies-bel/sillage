/**
 * "Is this meeting over?" (DEC-16)
 *
 * The failure mode being designed against is not a session that runs thirty
 * seconds long — it is a session that ends while someone is still talking,
 * because everything after the cut is lost and the rep does not find out until
 * the compte-rendu is missing the next steps. So the default grace is generous
 * and the short one is only reached once the calendar says the meeting was
 * supposed to be over anyway.
 *
 * Pure. The silence detection itself belongs to `modules/capture/`; this file
 * only decides what a given stretch of it means.
 */

/** The ordinary case: a long pause in a call is a pause, not an ending. */
export const SILENCE_GRACE_MS = 75_000

/**
 * Past the scheduled end, the same silence means something different: the
 * calendar already said this was over, so the burden of proof flips and 25 s is
 * enough (DEC-16).
 */
export const SILENCE_GRACE_PAST_END_MS = 25_000

export interface EndOfMeetingInput {
  now: number
  /**
   * When the audio last carried speech, or null while someone is still
   * talking. Audio resuming sets this back to null, which cancels a pending end
   * silently — no dialog, no "are you still there?" over a live call.
   */
  silentSince: number | null
  /** From the calendar. Null for a session the rep started by hand. */
  scheduledEnd: number | null
  /** The rep pressed *Terminer*. Short-circuits everything below. */
  manual: boolean
}

export type EndOfMeetingDecision =
  | { action: 'end'; reason: string }
  | { action: 'wait'; untilMs: number; reason: string }
  | { action: 'continue'; reason: string }

/**
 * Which grace applies, decided by when the silence *started* rather than by the
 * clock now.
 *
 * That distinction is load-bearing. Deciding on `now` would let a meeting that
 * fell silent well before its scheduled end be cut short the instant the end
 * time passed, mid-pause, with the room still occupied.
 */
export const graceFor = (silentSince: number, scheduledEnd: number | null): number =>
  scheduledEnd !== null && silentSince >= scheduledEnd
    ? SILENCE_GRACE_PAST_END_MS
    : SILENCE_GRACE_MS

export const decideEndOfMeeting = (input: EndOfMeetingInput): EndOfMeetingDecision => {
  if (input.manual) return { action: 'end', reason: 'terminée par l’utilisateur' }
  if (input.silentSince === null) return { action: 'continue', reason: 'audio en cours' }

  const grace = graceFor(input.silentSince, input.scheduledEnd)
  const deadline = input.silentSince + grace
  if (input.now < deadline) {
    return {
      action: 'wait',
      untilMs: deadline,
      reason: `silence depuis ${Math.round((input.now - input.silentSince) / 1000)} s`,
    }
  }
  return { action: 'end', reason: `silence pendant ${Math.round(grace / 1000)} s` }
}
