/**
 * The one file that knows which settings pane a refusal belongs to.
 *
 * Declared in `scripts/check-platform.mjs`. It is unavoidable: a URL that opens
 * *Confidentialité et sécurité › Enregistrement de l'écran* on macOS has no
 * Windows spelling, and `ms-settings:privacy-microphone` has no macOS one.
 * Concentrating both here is what keeps the branch out of the module that reads
 * the statuses, out of `app/`, and — the point of the exercise — out of `src/`.
 *
 * The platform is a **parameter**, never a read, exactly as
 * `capture/MeetingApps.ts` takes one: both tables are then unit-tested from
 * either host, which is the only way a Windows string written on a Mac is ever
 * checked at all.
 *
 * ## What the tables say
 *
 * macOS grants both scopes, in two different panes — sending a rep whose
 * microphone is refused to *Enregistrement de l'écran* is a dead end that looks
 * like a working button.
 *
 * Windows grants the microphone and **nothing else**: WASAPI loopback takes the
 * machine's own output with no permission at all, so `systemAudio` there is not
 * "allowed", it is ungoverned — `notRequired` in the contract, and no pane.
 */
import type { PermissionScope } from '../../core/contracts/permissions.ts'

/** Node's `process.platform`, taken as a value so it can be a fixture. */
export type PlatformId = NodeJS.Platform

const MACOS_PRIVACY = 'x-apple.systempreferences:com.apple.preference.security'

/**
 * Where a rep changes their mind, per platform and per scope. `null` means
 * "this machine has no pane for that", which the renderer reads as
 * `canOpenSettings: false` and draws as no button.
 */
export const settingsUrlFor = (platform: PlatformId, scope: PermissionScope): string | null => {
  if (platform === 'darwin') {
    return scope === 'microphone'
      ? `${MACOS_PRIVACY}?Privacy_Microphone`
      : `${MACOS_PRIVACY}?Privacy_ScreenCapture`
  }
  if (platform === 'win32') {
    return scope === 'microphone' ? 'ms-settings:privacy-microphone' : null
  }
  // Linux is neither a target (HR-2) nor a lie: no pane, so no button.
  return null
}

/**
 * Is this scope something the machine can refuse?
 *
 * False makes the scope `notRequired`, which is not `granted` — see
 * `core/contracts/permissions.ts`. On Windows only the microphone is governed.
 */
export const isGoverned = (platform: PlatformId, scope: PermissionScope): boolean => {
  if (scope === 'microphone') return platform === 'darwin' || platform === 'win32'
  return platform === 'darwin'
}

/**
 * The French sentence a refusal carries, naming the pane it was refused in.
 *
 * Composed here, beside the URL it matches, so the two cannot drift: the
 * sentence tells the rep where they are being sent, and the button sends them
 * there. The renderer renders it verbatim and never writes one.
 */
export const refusalSentence = (platform: PlatformId, scope: PermissionScope): string => {
  if (scope === 'microphone') {
    return platform === 'darwin'
      ? 'Le micro est refusé pour Sillage dans Réglages › Confidentialité et sécurité › Microphone. Sans lui, votre voix n’est pas enregistrée.'
      : 'Le micro est bloqué pour Sillage dans les paramètres de confidentialité de Windows. Sans lui, votre voix n’est pas enregistrée.'
  }
  return 'L’audio de votre ordinateur est refusé dans Réglages › Confidentialité et sécurité › Enregistrement de l’écran. Sans lui, votre interlocuteur n’est pas enregistré.'
}
