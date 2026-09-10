/**
 * **What the operating system will and will not let us record — as health.**
 *
 * ## Why this exists
 *
 * `CaptureSession.probe()` answered one question: does the native module load.
 * That is a real question and it is not the one that costs a rep a meeting. On
 * macOS the two things capture needs are granted by the *user*, in a TCC
 * prompt, and the screen-recording one is the prompt people refuse — so the
 * common failure is a machine where everything loads, the recording starts, the
 * meter moves on the rep's own channel, and the far end of every call is
 * silence. Nothing said so until the compte-rendu came back describing a
 * monologue.
 *
 * The app had no surface for this at all. `Onboarding.tsx` step 2 is built from
 * the three required connectors and offers *Autoriser* on a retryable one — and
 * `capture` had no registered retry, so the button could never appear and the
 * row's only remedy was *Réglages ›*, whose *Requis* card draws a control on
 * exactly the same condition. Install, refuse the prompt, and there was no
 * screen in the product that could ask again.
 *
 * ## Why the reasons are split three ways
 *
 * « L'audio n'est pas autorisé » is one sentence for three situations with
 * opposite consequences, and the rep's next move differs in each:
 *
 *  · **the microphone alone is missing** — the client is recorded and the rep is
 *    not, so the compte-rendu reads as a briefing rather than a conversation;
 *  · **the system audio alone is missing** — the far end is lost, which is the
 *    half the product exists for, and the recording *looks* healthy;
 *  · **both** — nothing is captured, and this is the only one that is `down`.
 *
 * One missing channel is `degraded`, never `down`: a meeting still happens, a
 * transcript still exists, and DEC-26 says an optional-but-worse path is not a
 * refusal. `down` is reserved for « pressing *Démarrer* records nothing ».
 *
 * ## `denied` and `not-determined` are not the same remedy
 *
 * A permission never asked for can still be asked for: the OS shows its prompt
 * and the rep answers it. One already refused will not prompt again — the OS
 * silently returns the old answer — so the only thing that fixes it is the
 * system settings pane. The health carries which, because a *Autoriser* that
 * cannot prompt is the dead control DEC-26 forbids, and « allez dans les
 * réglages du système » shown to somebody who has never been asked is a screen
 * sending them somewhere they did not need to go.
 *
 * Pure, and in `core/domain` for that reason: the Electron half is three calls
 * in `app/main.ts` and everything that decides anything is here, tested with no
 * Electron and no TCC database.
 */
import type { ConnectorHealth } from '../contracts/health.ts'

/**
 * What `systemPreferences.getMediaAccessStatus` answers, plus the case where
 * nobody could answer at all.
 *
 * `unknown` is not defensive padding: on Linux, and on any host where the call
 * throws, guessing `granted` would paint a green row over an unmeasured fact
 * and guessing `denied` would put a permission warning in front of a rep whose
 * machine has no such permission. It is measured as « we did not measure it »
 * and treated as granted-until-proven-otherwise, because the *capture path*
 * itself will report the truth the moment a meeting starts (DEC-32).
 */
export type AccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface CaptureAccess {
  /** The rep's own voice. */
  microphone: AccessStatus
  /** The far end — screen recording on macOS, nothing to grant on Windows. */
  screen: AccessStatus
}

/** Whether this channel will reach the recorder. `unknown` counts as yes. */
const usable = (status: AccessStatus): boolean => status === 'granted' || status === 'unknown'

/**
 * Whether asking again can still produce a prompt.
 *
 * `restricted` is the managed-device case — a profile forbids it and no amount
 * of asking or of visiting the settings pane changes that — so it is neither
 * askable nor fixable by the rep, and the sentence has to say so rather than
 * offering a button that will silently do nothing.
 */
export const canPrompt = (status: AccessStatus): boolean => status === 'not-determined'

const MIC = 'le micro'
const SCREEN = 'l’audio système'

/** What to tell a rep to do about a channel they have not got. */
const remedy = (statuses: readonly AccessStatus[]): string => {
  if (statuses.every((status) => status === 'restricted')) {
    return 'Cet ordinateur est géré et l’autorisation est bloquée par votre service informatique.'
  }
  if (statuses.some(canPrompt)) return 'Autorisez-le pour que Sillage puisse l’enregistrer.'
  // Already refused once: the OS will not ask again, so the button that asks is
  // not the remedy and must not be offered as one.
  return 'Vous l’avez refusé : réautorisez Sillage dans les réglages de confidentialité du système.'
}

/**
 * The connector health for a set of statuses, or `null` when there is nothing
 * to say — which is the ordinary case on Windows and on a machine where both
 * prompts were accepted.
 *
 * `null` rather than `{ state: 'ok' }` so the caller can keep whatever *other*
 * fact it had about capture: the native module failing to load is a different
 * and worse problem, and a permission probe must not paint over it.
 */
export const capturePermissionHealth = (
  access: CaptureAccess,
  now: number,
): ConnectorHealth | null => {
  const mic = usable(access.microphone)
  const screen = usable(access.screen)
  if (mic && screen) return null

  const missing: AccessStatus[] = []
  if (!mic) missing.push(access.microphone)
  if (!screen) missing.push(access.screen)

  /*
   * `retryable` is « can this screen's button change anything », not « is this
   * permission grantable ». Visiting the settings pane is something the button
   * can do; a managed device is not.
   */
  const retryable = missing.some((status) => status !== 'restricted')

  if (!mic && !screen) {
    return {
      state: 'down',
      reason: `Ni ${MIC} ni ${SCREEN} ne sont autorisés — une réunion ne serait pas enregistrée. ${remedy(missing)}`,
      since: now,
      retryable,
    }
  }

  return {
    state: 'degraded',
    reason: !screen
      ? `${SCREEN} n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. ${remedy(missing)}`
      : `${MIC} n’est pas autorisé — vous ne serez pas enregistré, seul le client le sera. ${remedy(missing)}`,
    since: now,
    retryable,
  }
}

/**
 * What a *Autoriser* press should actually do, given what the OS says now.
 *
 * Separated from the doing so the decision is testable: `ask` fires the OS
 * prompt and only works on a permission that has never been answered; `open`
 * puts the rep in front of the settings pane; `nothing` is the managed device,
 * where both would be theatre.
 */
export type PermissionAction = 'ask' | 'open' | 'nothing'

export const actionFor = (status: AccessStatus): PermissionAction => {
  if (usable(status)) return 'nothing'
  if (canPrompt(status)) return 'ask'
  if (status === 'restricted') return 'nothing'
  return 'open'
}
