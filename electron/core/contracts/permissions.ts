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
 * `openSettings` is the whole remedy; the prompt stays where it already lives,
 * on `health:retry` for a permission nobody has answered yet.
 */
import { z } from 'zod'
import type { Channel } from './transcript.ts'

/**
 * Where consent stands, in four words that mean the same thing on every host.
 *
 *  · `ready` — everything capture needs has been granted, or there was nothing
 *    on this host to grant. Nothing to draw but the green dot.
 *  · `to-grant` — never answered. The OS will still prompt, and the settings
 *    pane is the surer route, so the row offers it.
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
 * **Is this host still holding back an authorisation this side of the call needs?**
 *
 * Shared by two things that must agree and did not: the settings-pane button
 * the dry-run card draws under a silent row, and the sentence above it. The
 * predicate lived only in `EssaiAudio.tsx`, so the *button* was conditional and
 * the *prose* was not — the card correctly withheld a control it could not
 * justify, then sent the rep to the pane in words anyway. CLAUDE.md's rule is
 * that a fact shared by two sides of a boundary belongs here; this is that
 * fact, and it is now read once.
 *
 * Two of the four states answer `false` for different reasons that come to the
 * same advice: `ready` — nothing was refused, including on every Windows
 * machine, where there is nothing to refuse (HR-2's primary platform) — and
 * `blocked`, where a profile forbids it and neither asking nor the pane
 * changes that. `canOpenSettings` is in the predicate rather than beside it
 * because naming a pane this host does not have is the same dead end.
 *
 * `null` — consent not read yet — answers `false`, which is the safe direction:
 * the authorisation clause is the half of a remedy that can send somebody
 * hunting for a grant that is not missing.
 */
export const permissionOutstandingFor = (
  consent: CapturePermission | null,
  channel: Channel,
): boolean => {
  if (!consent || !consent.canOpenSettings) return false
  if (consent.state !== 'to-grant' && consent.state !== 'denied') return false
  return consent.channel === 'both' || consent.channel === PERMISSION_CHANNEL[channel]
}

/**
 * The two verbs `app/` is allowed to have about consent.
 *
 * Implemented in `app/main.ts` rather than in `modules/capture/`: the module
 * opens devices and does not own the app's relationship with the OS, and the
 * three Electron calls behind this (`getMediaAccessStatus`, `openExternal`, and
 * the pane URLs) are wiring, not the audio boundary.
 */
export interface CapturePermissionPort {
  /** Measured now, never cached: a rep grants it in another window and comes back. */
  read(): CapturePermission
  /**
   * Put the rep in front of the pane that holds this permission. `false` when
   * there was none to open, which the caller reports rather than swallowing —
   * a button that silently does nothing is worse than one that says it could
   * not.
   */
  openSettings(): Promise<boolean>
}
