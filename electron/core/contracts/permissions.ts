/**
 * **What the operating system lets this machine record — said once, in terms no
 * screen has to translate.**
 *
 * `core/domain/capturePermission.ts` already turns the two OS statuses into a
 * `ConnectorHealth`, and that is the right shape for the general status strip
 * (DEC-32): one sentence, one tone, one *Autoriser*. It is the wrong shape for
 * the row the onboarding draws, because « retryable » answers « can a button
 * change anything » and the row has to answer something narrower — **has this
 * been refused, or has it simply never been asked**, and **is there a settings
 * pane on this host to send the rep to**. Those two were only ever known inside
 * `main.ts`, so the renderer's only way to draw the difference would have been
 * to work out which platform it was on. That is the mac-first branch
 * `check-platform.mjs` exists to catch, in the one tree that must never contain
 * one.
 *
 * So the main process answers it, and the answer is **platform-neutral**:
 * `state` is a word about consent, `channel` is which side of the call goes
 * missing, and `canOpenSettings` is a capability — measured as « there is a URL
 * this host knows », never as « this is a Mac ». Windows has no screen-recording
 * permission to grant and therefore never reports one missing; nothing in the
 * renderer needs to know that, and nothing in it does.
 *
 * **A refusal leads to the pane, never to a prompt.** The OS silently returns
 * the old answer to a second ask, so a screen that offers *Autoriser* on a
 * refusal draws a control that can never do anything — the thing DEC-26 forbids.
 * `openSettings` is that remedy.
 *
 * **And a permission nobody has answered leads to the prompt, never to the
 * pane**, which is `request`. This paragraph used to end « the prompt stays
 * where it already lives, on `health:retry` for a permission nobody has
 * answered yet » — and the capture row *suppresses* the health branch the moment
 * this channel answers, so on a first launch there was no prompt anywhere in the
 * product and the only control drawn opened a pane that does not list an
 * application which has never attempted capture. `captureRemedyFor` below
 * decides between the two, once, for both screens.
 */
import { z } from 'zod'
import type { Channel } from './transcript.ts'

/**
 * Where consent stands, in four words that mean the same thing on every host.
 *
 *  · `ready` — everything capture needs has been granted, or there was nothing
 *    on this host to grant. Nothing to draw but the green dot.
 *  · `to-grant` — never answered. The OS will still prompt, which is the row's
 *    first remedy (`request`); the pane is what it falls back to once the ask
 *    has been made and the status has not moved.
 *  · `denied` — answered, with a no. The pane is the only remedy left.
 *  · `blocked` — a managed device: a profile forbids it and neither asking nor
 *    visiting the pane changes that, so the row says so and offers nothing.
 */
export const CapturePermissionStateSchema = z.enum(['ready', 'to-grant', 'denied', 'blocked'])
export type CapturePermissionState = z.infer<typeof CapturePermissionStateSchema>

/**
 * Which side of the call is at stake — and they are not interchangeable.
 *
 * Losing the microphone costs the rep's own voice, so the compte-rendu reads as
 * a briefing the client delivered; losing the system audio costs the far end,
 * which is the half this product exists for and the one that *looks* healthy
 * from the inside. `null` when nothing is missing.
 */
export const CaptureChannelSchema = z.enum(['microphone', 'screen', 'both'])
export type CaptureChannel = z.infer<typeof CaptureChannelSchema>

export const CapturePermissionSchema = z.object({
  state: CapturePermissionStateSchema,
  /** Which side goes missing, or `null` when the answer is `ready`. */
  channel: CaptureChannelSchema.nullable(),
  /**
   * The sentence the rep reads, composed in `core/domain/` and never in a
   * screen: the same French the health row carries, so the two surfaces cannot
   * drift into disagreeing about what was refused. `null` when `ready`.
   */
  reason: z.string().nullable(),
  /**
   * Whether this host has a privacy pane to open — a **capability**, tested by
   * whether a URL exists, never by a platform name. `false` is the honest
   * answer on a host with no such pane, and the row then draws no button rather
   * than one that opens nothing.
   */
  canOpenSettings: z.boolean(),
})
export type CapturePermission = z.infer<typeof CapturePermissionSchema>

/**
 * Which grant each side of the call depends on — the one mapping between the
 * transcript's two channels and the host's two permissions.
 */
const PERMISSION_CHANNEL: Record<Channel, CaptureChannel> = {
  rep: 'microphone',
  far: 'screen',
}

/**
 * **Which remedy a row may offer — ask, or open the pane.**
 *
 * The product has known the answer since `capturePermission.ts` was written:
 * `actionFor('not-determined')` is `ask`, and `requestCaptureAccess` in
 * `main.ts` raises the OS prompt on exactly that. No screen could reach it. The
 * renderer's only route out was `capture:permission:open`, so on a first launch
 * — `microphone` and `screen` both `not-determined`, which is every rep's first
 * launch on macOS — step 2 drew one control, « Ouvrir les réglages », under a
 * sentence reading « Autorisez-les pour que Sillage puisse les enregistrer. »
 * A privacy pane does not list an application that has never *attempted*
 * capture, so the one remedy on screen was a list the app was not in: the dead
 * end `EssaiAudio` and `Onboarding` exist to remove, on the screen a rep sees
 * once.
 *
 * It is decided here rather than in the screen that draws it because the main
 * process decides the same thing from the other side — `actionFor` over two
 * `AccessStatus`es — and the two must not be able to disagree. Bound over all
 * twenty-five status pairs in `core/domain/__tests__/capturePermission.test.ts`:
 * the row offers the ask exactly when `requestCaptureAccess` will prompt.
 *
 * `asked` is « has this screen already made the prompt », and it is the whole of
 * why this takes a second argument. On macOS the screen-recording grant does not
 * land until the app is relaunched, so the honest answer to an ask can be the
 * identical `to-grant` — and re-offering the same press there is the control
 * DEC-26 forbids. After one ask the row hands over to the pane, which the
 * attempt has just made useful. A refusal never gets a prompt at all: the OS
 * silently returns the old answer.
 */
export type CaptureRemedy = 'ask' | 'open' | 'none'

export const captureRemedyFor = (
  consent: CapturePermission | null,
  asked: boolean,
): CaptureRemedy => {
  // No consent read — an older main process, or a channel that threw. The row
  // keeps the health sentence and the retry it already had (DEC-26).
  if (!consent) return 'none'
  // `ready` has nothing to grant; `blocked` is a managed profile, where both
  // remedies are theatre and the sentence is the whole of what can be said.
  if (consent.state !== 'to-grant' && consent.state !== 'denied') return 'none'
  /*
   * A prompt is a capability of the application and a pane is a capability of
   * the host, so asking does not need `canOpenSettings` and opening does.
   */
  if (consent.state === 'to-grant' && !asked) return 'ask'
  return consent.canOpenSettings ? 'open' : 'none'
}


/**
 * **The same question, asked about one side of the call.**
 *
 * The dry-run card draws a row per channel — the rep's microphone above, the
 * machine's output below — so a row must never offer the remedy for the *other*
 * side. This is `captureRemedyFor` with that filter in front of it, and it
 * replaced a second predicate of mine that answered a cruder question.
 *
 * That one, `permissionOutstandingFor`, asked « is a grant outstanding » and
 * treated `to-grant` and `denied` as one case — true of the `paneFixes` it was
 * lifted from, and defensible for exactly as long as the pane was the product's
 * only route. The ask landed the same day. A sentence reading « réautorisez
 * Sillage dans les réglages de confidentialité du système » on a permission
 * **nobody has answered** sends a rep on first launch to a list their app is
 * not in — which is the defect `captureRemedyFor` exists to end, re-committed
 * one surface over. So there is one predicate about this, not two, which is the
 * rule `locateSegments` and `meetingAnchor` already follow.
 *
 * A consent naming the other channel answers `'none'` rather than deferring:
 * `captureRemedyFor` reads the whole consent and cannot know which row is
 * asking.
 */
export const channelRemedyFor = (
  consent: CapturePermission | null,
  channel: Channel,
  asked: boolean,
): CaptureRemedy =>
  consent !== null &&
  (consent.channel === 'both' || consent.channel === PERMISSION_CHANNEL[channel])
    ? captureRemedyFor(consent, asked)
    : 'none'

/**
 * The three verbs `app/` is allowed to have about consent.
 *
 * Implemented in `app/main.ts` rather than in `modules/capture/`: the module
 * opens devices and does not own the app's relationship with the OS, and the
 * four Electron calls behind this (`getMediaAccessStatus`, `askForMediaAccess`,
 * `openExternal`, and the pane URLs) are wiring, not the audio boundary.
 */
export interface CapturePermissionPort {
  /** Measured now, never cached: a rep grants it in another window and comes back. */
  read(): CapturePermission
  /**
   * Ask the OS for what it has never been asked for, then **re-measure**.
   *
   * The answer is the consent as it stands afterwards, because that is the only
   * thing a row can draw: granted and the row goes green, refused and it falls
   * through to the pane, unchanged — the macOS screen-recording case, where the
   * grant lands on the next launch — and it falls through to the pane as well.
   * `read()` is not enough on its own and `openSettings()` is the wrong remedy
   * for a permission nobody has answered: the pane does not list an app that
   * has never attempted capture.
   */
  request(): Promise<CapturePermission>
  /**
   * Put the rep in front of the pane that holds this permission. `false` when
   * there was none to open, which the caller reports rather than swallowing —
   * a button that silently does nothing is worse than one that says it could
   * not.
   */
  openSettings(): Promise<boolean>
}
