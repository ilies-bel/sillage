/**
 * What the machine will let us listen to — and what the rep can do about it.
 *
 * ## The shape is the decision
 *
 * Capture needs two things on a Mac and one on Windows: the microphone, and —
 * only on macOS — the screen-recording grant that ScreenCaptureKit takes the
 * machine's own output under. Windows has no such permission: WASAPI loopback
 * is not gated by anything a rep can refuse.
 *
 * The renderer must not know any of that. It is written on a Mac and shipped to
 * Windows (HR-2), and a screen that says « ouvrez Enregistrement de l'écran »
 * to a Windows rep is the kind of defect nobody on this side of the Atlantic
 * ever sees. So the main process answers with rows that are already
 * platform-neutral:
 *
 *   · a scope that is not governed here is `notRequired` and is not drawn;
 *   · a scope the rep has refused carries `reason` — a French sentence composed
 *     where the refusal is known, never assembled in `src/`;
 *   · `canOpenSettings` says whether there is a pane to send them to. It is a
 *     capability, not a platform: the renderer draws the button when it is true
 *     and draws no button when it is false, and never asks which OS it is on.
 *
 * ## Why there is no `ask`
 *
 * The invariant is « a refusal leads to the settings pane, not a prompt ».
 * macOS shows its TCC sheet exactly once per binary; every later
 * `askForMediaAccess` resolves false without so much as a flicker, which reads
 * to the rep as a dead button. So the port cannot ask, by construction: its
 * only verb is `openSettings`.
 */
import { z } from 'zod'

/**
 * The two things a meeting listens to (DEC-32's *capture*, both channels).
 *
 * `systemAudio` is « l'audio de votre ordinateur » — the far end of the call.
 * It is a scope rather than a platform flag because on macOS it is governed by
 * a *different* pane from the microphone, and sending a rep to the wrong one is
 * the whole failure this file exists to prevent.
 */
export const PermissionScopeSchema = z.enum(['microphone', 'systemAudio'])
export type PermissionScope = z.infer<typeof PermissionScopeSchema>

/**
 * Four answers, none of them a platform.
 *
 * `prompt` is « jamais demandé » — the first run. `notRequired` is the Windows
 * answer for `systemAudio`, and it is not the same as `granted`: granted means
 * the rep allowed it, and `notRequired` means there was never anything to
 * allow. A row that says `granted` on Windows would put a « prêt » line on
 * screen for a permission that does not exist.
 */
export const PermissionStatusSchema = z.enum(['granted', 'prompt', 'denied', 'notRequired'])
export type PermissionStatus = z.infer<typeof PermissionStatusSchema>

export const PermissionRowSchema = z.object({
  scope: PermissionScopeSchema,
  status: PermissionStatusSchema,
  /**
   * Why it is refused, in French, composed in the main process — `null` in
   * every other state. The renderer renders it verbatim and never writes one:
   * only the side that read the refusal knows which pane refused.
   */
  reason: z.string().min(1).nullable(),
  /** Is there a settings pane to open for this scope on this machine. */
  canOpenSettings: z.boolean(),
})
export type PermissionRow = z.infer<typeof PermissionRowSchema>

/** Both scopes, always both rows — a missing row is not the same as `notRequired`. */
export const CapturePermissionsSchema = z.object({ rows: z.array(PermissionRowSchema).length(2) })
export type CapturePermissions = z.infer<typeof CapturePermissionsSchema>

/** What `permissions:openSettings` answers. A refusal carries its sentence. */
export const OpenSettingsResultSchema = z.object({
  opened: z.boolean(),
  reason: z.string().min(1).nullable(),
})
export type OpenSettingsResult = z.infer<typeof OpenSettingsResultSchema>

/**
 * The port. `app/` injects one implementation; `modules/permissions/` is the
 * only place that knows what an `x-apple.systempreferences:` URL is.
 */
export interface CapturePermissionsPort {
  read(): Promise<CapturePermissions>
  openSettings(scope: PermissionScope): Promise<OpenSettingsResult>
}

/**
 * The renderer's half, re-exported so the main process has one import site for
 * this contract. See `permissionRows.ts` for why the values live there.
 */
export {
  PERMISSION_SCOPES,
  captureVerdict,
  refusalReasons,
  scopeToOpen,
  type CaptureVerdict,
} from './permissionRows.ts'
