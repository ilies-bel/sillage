/**
 * `modules/permissions` — what this machine will let us listen to.
 *
 * One external boundary: the OS privacy database, read through Electron's
 * `systemPreferences`, and the settings pane, opened through `shell`. Both are
 * **injected** rather than imported, which is what lets the whole fold run
 * under `node --test` with no Electron at all — and, more to the point, lets a
 * Mac check what the Windows branch answers.
 *
 * Nothing here knows a platform *name*: `deepLinks.ts` owns every literal and
 * takes the platform as a parameter. This file only asks it questions.
 *
 * ## Capability-tested, never platform-tested
 *
 * `systemPreferences.getMediaAccessStatus` exists on macOS and Windows and not
 * on Linux, and Electron has changed which kinds it accepts more than once. So
 * the read is guarded on the function being there and on the answer being one
 * it recognises; anything else is `prompt`, which is the honest answer for « we
 * could not find out » — it draws a dot and a way to the pane, and it never
 * claims a grant the app does not have.
 */
import type {
  CapturePermissions,
  CapturePermissionsPort,
  OpenSettingsResult,
  PermissionRow,
  PermissionScope,
} from '../../core/contracts/permissions.ts'
import { PERMISSION_SCOPES } from '../../core/contracts/permissionRows.ts'
import { isGoverned, refusalSentence, settingsUrlFor, type PlatformId } from './deepLinks.ts'

/** The media kind Electron names each scope by. Its vocabulary, not ours. */
const MEDIA_KIND: Record<PermissionScope, 'microphone' | 'screen'> = {
  microphone: 'microphone',
  systemAudio: 'screen',
}

/** The subset of `electron.systemPreferences` this module uses. */
export interface MediaAccessLike {
  getMediaAccessStatus?: (kind: 'microphone' | 'screen') => string
}

export interface PermissionsDeps {
  /** `process.platform`, passed in — see `deepLinks.ts`. */
  platform: PlatformId
  media: MediaAccessLike
  /** `shell.openExternal`. Resolves false when the URL could not be opened. */
  openExternal: (url: string) => Promise<void>
}

/**
 * Electron's four answers, mapped onto ours. `restricted` — an MDM policy, a
 * managed laptop — is a refusal the rep cannot lift, and it is still a refusal:
 * the sentence names the pane, and the pane is where they will read that it is
 * managed. Anything unrecognised falls through to `prompt`.
 */
const statusOf = (raw: string | undefined): PermissionRow['status'] => {
  if (raw === 'granted') return 'granted'
  if (raw === 'denied' || raw === 'restricted') return 'denied'
  return 'prompt'
}

const readScope = (deps: PermissionsDeps, scope: PermissionScope): PermissionRow => {
  const url = settingsUrlFor(deps.platform, scope)

  if (!isGoverned(deps.platform, scope)) {
    // Not « autorisé » — ungoverned. The row is not drawn at all, and saying
    // `granted` here would put a « prêt » line on screen for a permission this
    // machine has never heard of.
    return { scope, status: 'notRequired', reason: null, canOpenSettings: false }
  }

  const status = statusOf(deps.media.getMediaAccessStatus?.(MEDIA_KIND[scope]))
  return {
    scope,
    status,
    reason: status === 'denied' ? refusalSentence(deps.platform, scope) : null,
    canOpenSettings: url !== null,
  }
}

/**
 * The port `app/` injects. A class rather than a closure only because the two
 * verbs share the dependencies; it holds no state and caches nothing — a rep
 * who has just changed a switch in System Settings must get the new answer on
 * the next read, and a cache is how a screen ends up telling them they are
 * still refused.
 */
export class CapturePermissionsReader implements CapturePermissionsPort {
  #deps: PermissionsDeps

  constructor(deps: PermissionsDeps) {
    this.#deps = deps
  }

  async read(): Promise<CapturePermissions> {
    return { rows: PERMISSION_SCOPES.map((scope) => readScope(this.#deps, scope)) }
  }

  async openSettings(scope: PermissionScope): Promise<OpenSettingsResult> {
    const url = settingsUrlFor(this.#deps.platform, scope)
    if (url === null) {
      return {
        opened: false,
        reason: 'cette machine n’a pas de réglage à ouvrir pour cette autorisation',
      }
    }
    try {
      await this.#deps.openExternal(url)
      return { opened: true, reason: null }
    } catch (err) {
      // Never a rejection across IPC: the screen has a button and is owed a
      // sentence, not a stack trace (DEC-26).
      return { opened: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }
}

/**
 * What the app answers with when no reader was wired — a test harness, or a
 * boot that registered IPC without one.
 *
 * `prompt` with no pane: it draws the row, says nothing is settled, and offers
 * no control that cannot work. `granted` here would be the app claiming a grant
 * nobody read.
 */
export const UNREAD_PERMISSIONS: CapturePermissions = {
  rows: PERMISSION_SCOPES.map((scope) => ({
    scope,
    status: 'prompt' as const,
    reason: null,
    canOpenSettings: false,
  })),
}

export { isGoverned, refusalSentence, settingsUrlFor, type PlatformId } from './deepLinks.ts'
