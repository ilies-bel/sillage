/**
 * Self-update, as a contract (DEC-26, DEC-32).
 *
 * ## Two schemas, because two different things are true
 *
 * `UpdateState` is everything the updater itself knows: what GitHub published,
 * what has been downloaded, what went wrong. It is the module's whole output
 * and it knows nothing about meetings.
 *
 * `UpdateStatus` is what the renderer receives: that state plus whether an
 * install may proceed *right now*, which is a question only the session can
 * answer (`core/domain/updateGate.ts`). Keeping them apart is what stops
 * `modules/update` from importing the state machine to disable its own button.
 *
 * ## Why there is no `autoInstall`
 *
 * The app never restarts itself. `phase: 'ready'` is a terminus — the update
 * sits on disk until a human presses *Installer et redémarrer*, or until the
 * rep quits the app on their own and the installer runs on the way out. A
 * product whose one job is to be running when a call starts does not get to
 * choose its own restart moment, and DEC-4's single confirmation gate is not a
 * budget to spend on infrastructure.
 *
 * ## Why an update never moves the general status
 *
 * DEC-32: capture, transcription and analysis move the app-level status and
 * nothing else. A failed update check is not a degradation of the product —
 * the product records meetings perfectly well on the version already
 * installed. This surfaces in Réglages and in the diagnostics, nowhere else.
 */
import { z } from 'zod'
import { TimestampSchema } from './meeting.ts'

export const UpdatePhaseSchema = z.enum([
  /**
   * No update mechanism at all: a dev run, or a build whose packaging carries
   * no update metadata. Stated rather than hidden — « pas de mise à jour
   * automatique » is a fact a tester needs, and a silent « à jour » would be a
   * lie on the exact build most likely to be stale.
   */
  'disabled',
  /** Checked, and this is the newest version. */
  'idle',
  'checking',
  /** Newer version exists; the download has not finished. */
  'available',
  'downloading',
  /** Downloaded and staged. The install happens on request, never on its own. */
  'ready',
  /**
   * The check or the download failed. Never fatal: DEC-26 puts the whole of
   * this subsystem downstream of everything that matters.
   */
  'error',
])
export type UpdatePhase = z.infer<typeof UpdatePhaseSchema>

export const UpdateStateSchema = z.object({
  phase: UpdatePhaseSchema,
  /** What is running now. Always present — it is the one thing always known. */
  currentVersion: z.string().min(1),
  /** The published version, once a check has found one. */
  availableVersion: z.string().min(1).nullable(),
  /** 0…100 while `downloading`, null otherwise. */
  percent: z.number().min(0).max(100).nullable(),
  /**
   * French. Always set on `error` and `disabled`.
   *
   * Also set while `downloading` on the second and third attempts, and that is
   * the point of it being here rather than only on `error`: there is no resume
   * underneath, so a retry sends the bar back to zero. Without a line saying
   * why, a rep sees the same download apparently restart itself and reasonably
   * concludes the app is broken.
   */
  reason: z.string().nullable(),
  /** When the last check completed, successfully or not. */
  checkedAt: TimestampSchema.nullable(),
})
export type UpdateState = z.infer<typeof UpdateStateSchema>

export const UpdateStatusSchema = UpdateStateSchema.extend({
  /**
   * Whether *Installer et redémarrer* may act. False while any session holds
   * unfinished work; the renderer disables the control and prints
   * `blockedReason` beside it rather than letting the click fail.
   *
   * Advisory only. `update:install` re-checks on the main side, because a
   * meeting can start between the render and the click and the renderer's copy
   * of this is always a few milliseconds stale.
   */
  installable: z.boolean(),
  /** French, non-null exactly when `installable` is false and `phase` is `ready`. */
  blockedReason: z.string().nullable(),
})
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

/**
 * What `app/` drives. The module owns the transport and the staging, and owns
 * no policy at all — which is why `check` and `download` are separate verbs.
 *
 * The download is not automatic, and that is a decision about bandwidth rather
 * than about consent. An update is most of half a gigabyte, and the moment it
 * would otherwise start downloading is the moment a rep is on a Teams call
 * being transcribed. Competing with the call for upstream is a way to damage a
 * meeting without ever touching the capture path. So `app/` asks the same
 * update gate before downloading that it asks before installing.
 */
export interface UpdatePort {
  /** Synchronous: the last known state, never a network call. */
  state(): UpdateState
  /** Fire a check. Resolves to the resulting state; never rejects (DEC-26). */
  check(): Promise<UpdateState>
  /**
   * Fetch the staged version. Resolves to the resulting state; never rejects.
   * A no-op unless `phase` is `available`.
   */
  download(): Promise<UpdateState>
  /**
   * Quit and run the staged installer. Resolves `false` when there is nothing
   * staged. The caller has already consulted the update gate.
   */
  install(): Promise<boolean>
  /** Called on every state change, so `app/` can broadcast it. */
  onChanged(listener: (state: UpdateState) => void): () => void
}

/**
 * The state a build with no update support reports. A named export because
 * both `main.ts` (dev runs) and the module (no metadata) produce it, and two
 * hand-written copies would drift in their French.
 */
export const updatesUnavailable = (currentVersion: string, reason: string): UpdateState => ({
  phase: 'disabled',
  currentVersion,
  availableVersion: null,
  percent: null,
  reason,
  checkedAt: null,
})
