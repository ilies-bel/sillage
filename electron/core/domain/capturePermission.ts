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
import type { CaptureChannel, CapturePermission } from '../contracts/permissions.ts'

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

/**
 * **The same two channels, opening a sentence — and it is not a style rule.**
 *
 * The `degraded` reason below begins with one of these names, so it began
 * lowercase: « le micro n’est pas autorisé — … ». Two surfaces read that string.
 *
 * `capturePermissionView` hands it to the onboarding row, which draws it as a
 * standalone paragraph — a French sentence opening in lower case.
 *
 * The widget throws it away. `src/widget/healthSentence.ts` decides whether a
 * `reason` was written for a rep by an allowlist over **shapes**, and one of
 * the three conditions is « opens on a capital », because every fragment a
 * state machine writes for itself in this tree opens lowercase. Driven over all
 * twenty-five status pairs through the shipped composer: **twelve of the
 * twenty-one that produce a health were replaced**, and every one of them was
 * `degraded` — the state DEC-32 reserves for « one channel is missing », whose
 * whole point is that the sentence names which side. The window said « une
 * partie de la réunion peut manquer au compte-rendu » instead, which names
 * nothing, over a live client call, on Windows as much as on macOS:
 * `main.ts` records that the Windows 10 global microphone switch reports
 * `denied`.
 *
 * The predicate is not wrong. This was — the seven sentences in this tree that
 * are written for a rep open on a capital, name the side and end on a remedy,
 * and these did two of the three. Declared as their own constants rather than
 * upper-cased at the call site: a transformation over a display string is one
 * more thing to be right about, and « l’audio » → « L’audio » is not the rule a
 * naive `toUpperCase` on the first character would keep if the name ever
 * changed.
 */
const MIC_OPENING = 'Le micro'
const SCREEN_OPENING = 'L’audio système'

interface Missing {
  /** « le micro » or « l’audio système », for a sentence that names it. */
  name: string
  status: AccessStatus
}

/**
 * What to tell a rep to do about the channels they have not got.
 *
 * **The two halves can need different remedies, and this said only one.** It
 * asked « is any of these askable » and answered for the whole set, so a
 * microphone that was never asked for beside screen recording that was refused
 * — a rep who accepted the first macOS prompt and refused the second, then
 * reinstalled — produced
 *
 *     Ni le micro ni l’audio système ne sont autorisés — une réunion ne serait
 *     pas enregistrée. Autorisez-le pour que Sillage puisse l’enregistrer.
 *
 * « Autorisez-le », singular, after a clause naming two, for a pair where
 * authorising fixes exactly one. The OS will not prompt for the refused one
 * again, so nothing in that sentence brings back the far end of the call.
 *
 * `restricted` beside an askable channel is deliberately not this case: a
 * managed profile is fixable by nobody, so there is no second instruction to
 * give and the sentence stays the askable one’s. `denied` has one.
 */
const remedy = (missing: readonly Missing[]): string => {
  if (missing.every(({ status }) => status === 'restricted')) {
    return 'Cet ordinateur est géré et l’autorisation est bloquée par votre service informatique.'
  }

  const askable = missing.filter(({ status }) => canPrompt(status))
  const refused = missing.filter(({ status }) => status === 'denied')

  if (askable.length > 0 && refused.length > 0) {
    const ask = askable.map(({ name }) => name).join(' et ')
    const open = refused.map(({ name }) => name).join(' et ')
    return `Autorisez ${ask}, puis réautorisez ${open} dans les réglages de confidentialité du système.`
  }

  /*
   * Singular or plural with the count, because both of these were written as
   * constants and both are printed after « Ni le micro ni l'audio système » on
   * the `down` case: « Ni le micro ni l'audio système ne sont autorisés — …
   * Autorisez-le » and « … Vous l'avez refusé », both measured on the shipped
   * sentence. A `restricted` channel beside one askable one is the case that
   * legitimately stays singular, and it does: it is not in either list.
   */
  if (askable.length > 1) return 'Autorisez-les pour que Sillage puisse les enregistrer.'
  if (askable.length > 0) return 'Autorisez-le pour que Sillage puisse l’enregistrer.'
  // Already refused: the OS will not ask again, so the button that asks is not
  // the remedy and must not be offered as one.
  if (refused.length > 1) {
    return 'Vous les avez refusés : réautorisez Sillage dans les réglages de confidentialité du système.'
  }
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

  const missing: Missing[] = []
  if (!mic) missing.push({ name: MIC, status: access.microphone })
  if (!screen) missing.push({ name: SCREEN, status: access.screen })

  /*
   * `retryable` is « can this screen's button change anything », not « is this
   * permission grantable ». Visiting the settings pane is something the button
   * can do; a managed device is not.
   */
  const retryable = missing.some(({ status }) => status !== 'restricted')

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
      ? `${SCREEN_OPENING} n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. ${remedy(missing)}`
      : `${MIC_OPENING} n’est pas autorisé — vous ne serez pas enregistré, seul le client le sera. ${remedy(missing)}`,
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

/**
 * **The same measurement, as the row draws it.**
 *
 * `capturePermissionHealth` above answers the general status (DEC-32) and its
 * `retryable` means « can a button change anything ». The onboarding row asks
 * something narrower — refused, or never asked? and is there a pane on this
 * host? — and the only place those two were known was `main.ts`. A renderer
 * that had to work them out would have to work out which platform it is on,
 * which is the one branch `src/` may never contain.
 *
 * So it is derived here, from the same statuses, and the sentence is the same
 * sentence: `reason` is `capturePermissionHealth`'s, word for word, so the row
 * and the status strip cannot come to disagree about what was refused.
 *
 * `canOpenSettings` is supplied by the caller because only `main.ts` knows
 * whether this host has a URL for the pane — and it is a **capability** there,
 * measured as « is the URL non-empty », never as a platform test.
 */
export const capturePermissionView = (
  access: CaptureAccess,
  canOpenSettings: boolean,
  now: number,
): CapturePermission => {
  const health = capturePermissionHealth(access, now)
  if (!health) return { state: 'ready', channel: null, reason: null, canOpenSettings: false }

  const mic = usable(access.microphone)
  const screen = usable(access.screen)
  const channel: CaptureChannel = !mic && !screen ? 'both' : mic ? 'screen' : 'microphone'
  // `capturePermissionHealth` returns `null` rather than `ok`, so a non-null
  // health always carries its sentence; the narrowing has to be written out.
  const reason = health.state === 'ok' ? null : health.reason

  const missing: AccessStatus[] = []
  if (!mic) missing.push(access.microphone)
  if (!screen) missing.push(access.screen)

  /*
   * A managed device first: it is the one state where *both* remedies are
   * theatre, so it must not be reported as something a pane could fix.
   */
  if (missing.every((status) => status === 'restricted')) {
    return { state: 'blocked', channel, reason, canOpenSettings: false }
  }

  /*
   * Never answered is « à autoriser »; answered with a no is « refusé ». The OS
   * silently returns the old answer to a second ask, which is why the two are
   * not the same row and why neither of them offers a prompt: the pane is the
   * remedy that works in both, and offering *Autoriser* on a refusal is the
   * dead control DEC-26 forbids.
   */
  const state = missing.some(canPrompt) ? 'to-grant' : 'denied'
  return { state, channel, reason, canOpenSettings }
}

/**
 * **What a capture retry is allowed to say it measured.**
 *
 * `main.ts` registers one retry for `capture`, and the press that reaches it is
 * *Autoriser* on the onboarding screen — the screen a rep meets before their
 * first client call. That retry can measure exactly two things: whether the
 * native module loads, and what the OS now answers about the permission. It
 * cannot measure a device, because the device facts this product has — a
 * microphone that would not open, an 8 kHz HFP profile, an output route that
 * moved mid-call — are all observed *while capturing*, and nothing is capturing
 * when a rep is on the onboarding screen.
 *
 * It answered `?? { state: 'ok' }`, which is the one thing it is not entitled
 * to say. `capturePermissionHealth` returns `null` rather than `ok` precisely
 * « so the caller can keep whatever *other* fact it had about capture … a
 * permission probe must not paint over it », and `main.ts`'s boot path honours
 * that with `?? loaded`. The retry did not: over « micro indisponible — Device
 * unavailable », one press turned the row green, dropped the sentence and
 * removed the button, and because that goes through `setHealth` it moved the
 * general status (DEC-32) and Réglages' capture row with it.
 *
 * Four of the five health emissions in `modules/capture/index.ts` are
 * `retryable: true`, so the button is the majority case rather than the corner.
 *
 * So: a fault this probe did not look at survives the probe. The one row it is
 * entitled to clear is the permission sentence it has just invalidated, and it
 * is identified by string equality against what `capturePermissionHealth`
 * itself composed a moment earlier — the same device this repo uses to make the
 * compte-rendu's lines followable, and not a heuristic over the wording.
 *
 * `standing` is the row the orchestrator currently holds, which by DEC-45 may
 * be a dry run's verdict; that outranks this probe and is kept, which falls out
 * of the rule rather than needing a case of its own.
 */
export const captureRetryHealth = (
  before: ConnectorHealth | null,
  after: ConnectorHealth | null,
  standing: ConnectorHealth,
): ConnectorHealth => {
  if (after) return after
  if (standing.state === 'ok') return standing
  return before !== null && before.state !== 'ok' && before.reason === standing.reason
    ? { state: 'ok' }
    : standing
}
