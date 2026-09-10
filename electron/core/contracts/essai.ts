/**
 * **The dry run: twenty seconds of real capture, before a client is on the
 * line.**
 *
 * ## Why the product needs one
 *
 * Everything in this app after the microphone is recoverable. A model that is
 * not configured can be configured after the call and the compte-rendu still
 * gets written (DEC-39); a CRM that is down drains later; an Outlook token
 * expires and the draft is created on the next attempt. **Capture is the one
 * thing that cannot be repaired afterwards** — a call recorded on one channel
 * is a call half lost, permanently, and the rep finds out when the compte-rendu
 * comes back describing a monologue.
 *
 * Onboarding step 2 asks for the permissions and reads the connector health
 * back. That is a statement about *grants*, not about sound: on macOS the grant
 * can be given and the loopback still produce nothing (a virtual audio device in
 * the chain, an output routed to a headset the tap does not see), and the
 * microphone can be granted and muted in hardware. The only way to know is to
 * listen.
 *
 * Granola solves the same problem by playing a two-minute video out of the
 * speakers and transcribing it back. The mechanism is right and the framing is
 * theirs: it demonstrates the product. This demonstrates the *machine* — the rep
 * talks, plays anything they like, and the app reports what it heard on each
 * channel, separately, in the rep's own words.
 *
 * ## What it deliberately is not
 *
 * **Not a meeting.** No row in the store, nothing in *Historique*, no
 * compte-rendu, no intents, no state machine (DEC-32 is untouched — the trial
 * reports its own result and never moves the app's status). The reserved
 * `ESSAI_MEETING_ID` exists only so the level broadcast, which is keyed by
 * meeting, can carry the trial's frames to the same `LevelMeter` a call uses.
 * One meter, drawn from one measurement, so a rep who has seen it here
 * recognises it during the call.
 *
 * **Not a transcription.** The trial never reaches the transcriber and stores
 * nothing. Raw audio is discarded as it arrives, exactly as during a meeting
 * (DEC-12) — what survives is two peaks and two verdicts.
 */
import { z } from 'zod'

/**
 * The meeting id the trial's `audio:level` frames carry.
 *
 * Reserved, and it can never collide: real ids are generated, and `Projections`
 * would have to have stored a meeting under this exact string for anything to
 * confuse the two. `LevelMeter` filters on the id it was given, so a trial
 * running while a meeting records — which cannot happen, the trial refuses —
 * still could not cross the wires.
 */
export const ESSAI_MEETING_ID = 'essai-audio'

/**
 * Twenty seconds.
 *
 * Long enough to say a sentence and start a video; short enough that a rep who
 * installed the app between two meetings will actually run it. Granola asks for
 * two minutes and gets away with it because the rep is watching a film; here
 * they are being asked to talk to their laptop, which is a different favour.
 */
export const ESSAI_SECONDS = 20

/** Per channel: was anything heard, and how loud was the loudest moment. */
export const EssaiChannelSchema = z.object({
  /** Above the transcriber's floor at least once. */
  heard: z.boolean(),
  /** Loudest peak over the run, on the 0…1 scale the meter draws. */
  peak: z.number().min(0).max(1),
})
export type EssaiChannel = z.infer<typeof EssaiChannelSchema>

export const EssaiResultSchema = z.object({
  rep: EssaiChannelSchema,
  far: EssaiChannelSchema,
  /** The amplitude below which the transcriber drops a window. */
  floor: z.number().min(0).max(1),
  /** How long it actually listened, which is not always what was asked for. */
  seconds: z.number().min(0),
})
export type EssaiResult = z.infer<typeof EssaiResultSchema>

/*
 * ── what the result means, in the rep's words ───────────────────────────────
 *
 * Here rather than in `core/domain/` for the reason `meetingAnchor` is in
 * `contracts/meeting.ts`: the renderer draws this and `src/*` may import
 * `core/contracts/` and nothing else. Two copies of a verdict — one the screen
 * shows and one a test checks — is the drift this file exists to prevent.
 *
 * What twenty seconds of listening actually established — in the rep's words.
 *
 * The two channels have **opposite failures and opposite fixes**, which is the
 * whole reason the trial reports them separately rather than as one green tick:
 *
 *  · nothing on `rep` and the rep is not recorded — the compte-rendu reads as a
 *    briefing the client delivered, and the fix is a microphone or a mute
 *    switch, on their side of the machine;
 *  · nothing on `far` and *the client* is not recorded — the compte-rendu reads
 *    as a monologue, and the fix is the screen-recording grant or an output
 *    routed somewhere the tap cannot see.
 *
 * The second is the one this product exists to prevent and the one a rep cannot
 * discover on their own: their own voice is in the transcript, so the recording
 * looks like it worked.
 *
 * **A silent channel is never called a failure.** The rep may simply not have
 * played anything, and a screen that says « l'audio système ne fonctionne pas »
 * to somebody who sat in silence has told them something false about their
 * machine — which is worse than saying nothing, because they will act on it.
 * So the sentence is what was measured (« rien n'a été entendu ») plus what to
 * do about it, and the verdict word is « à vérifier », never « en panne ».
 */

/** One row of the result, as the screen draws it. */
export interface EssaiLine {
  channel: 'rep' | 'far'
  /** What this channel is, to a rep. Never « rep » and never « far ». */
  title: string
  /** `heard` → the good sentence; otherwise what to check. */
  sentence: string
  heard: boolean
}

export const essaiLines = (result: EssaiResult): readonly EssaiLine[] => [
  {
    channel: 'rep',
    title: 'Votre voix',
    heard: result.rep.heard,
    sentence: result.rep.heard
      ? 'Entendue. Ce que vous dites sera transcrit.'
      : 'Rien n’a été entendu. Si vous avez parlé, vérifiez que le micro n’est pas coupé — sinon vous ne serez pas dans le compte-rendu.',
  },
  {
    channel: 'far',
    title: 'L’audio de votre ordinateur',
    heard: result.far.heard,
    sentence: result.far.heard
      ? 'Entendu. Ce que dit le client sera transcrit.'
      : 'Rien n’a été entendu. Si vous avez joué un son, c’est le côté client qui manquera : vérifiez l’autorisation d’enregistrement de l’écran et la sortie audio utilisée.',
  },
]

/**
 * The one line above the two, and it says what the trial *proved* rather than
 * grading the machine.
 *
 * A rep who ran the trial in silence gets « rien n'a été entendu » and no
 * verdict at all, because nothing was established — offering « tout va bien »
 * for twenty seconds of silence is the same lie in the other direction.
 */
export const essaiSummary = (result: EssaiResult): string => {
  if (result.rep.heard && result.far.heard) {
    return 'Les deux côtés de l’appel sont captés. Il n’y a rien d’autre à régler.'
  }
  if (!result.rep.heard && !result.far.heard) {
    return 'Rien n’a été entendu pendant l’essai. Si vous avez parlé ou joué un son, quelque chose bloque la capture.'
  }
  return result.far.heard
    ? 'Le client serait capté, vous non.'
    : 'Vous seriez capté, le client non — c’est la moitié qui compte le plus.'
}

/**
 * Whether the trial is worth offering again rather than moving on.
 *
 * Not « did it pass ». A rep who heard both channels has nothing left to prove;
 * one who heard neither may simply have said nothing, and the honest offer is
 * *recommencer*, not a warning.
 */
export const essaiWorthRepeating = (result: EssaiResult): boolean =>
  !(result.rep.heard && result.far.heard)
