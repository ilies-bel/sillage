/**
 * The renderer's half of `permissions.ts` — the fold from two rows to the one
 * thing the onboarding row says.
 *
 * Separate from `permissions.ts` for the reason `bootSteps.ts` is separate from
 * `boot.ts`: the schemas there are call expressions no bundler tree-shakes, and
 * dragging Zod across the renderer boundary for four string literals is the
 * cost this split exists to avoid. `permissions.ts` re-exports these, so the
 * main process still has one import site for the contract.
 *
 * The fold is here rather than in `core/domain/` because `src/*` may import
 * `core/contracts/` and nothing else (ARCHITECTURE.md §4), and the alternative
 * — the screen deciding for itself what two rows mean — is a second
 * implementation of the rule, in the layer least able to be tested.
 */
import type { CapturePermissions, PermissionRow, PermissionScope } from './permissions.ts'

/** The order the row draws its scopes in, and the order refusals are read in. */
export const PERMISSION_SCOPES = ['microphone', 'systemAudio'] as const

/**
 * What the onboarding row is: one sentence, one dot, at most one control.
 *
 * `toGrant` and `denied` are deliberately not the same verdict even though both
 * end at the same pane. « À autoriser » is a machine that has never been asked;
 * « refusé » is a rep who said no, and the sentence they are owed names the
 * refusal rather than inviting them to a first run that will not happen.
 */
export type CaptureVerdict = 'ready' | 'toGrant' | 'denied'

const rowFor = (permissions: CapturePermissions, scope: PermissionScope): PermissionRow | null =>
  permissions.rows.find((row) => row.scope === scope) ?? null

/**
 * `denied` outranks `toGrant`, which outranks `ready`.
 *
 * A machine where the microphone is refused and the screen grant was never
 * asked for is a refusal, not a first run: the refusal is the thing standing
 * between the rep and a recording, and it is the thing the sentence has to
 * name. `notRequired` never contributes — see the header of `permissions.ts`
 * for why it is not `granted`.
 */
export const captureVerdict = (permissions: CapturePermissions): CaptureVerdict => {
  const statuses = permissions.rows.map((row) => row.status)
  if (statuses.includes('denied')) return 'denied'
  if (statuses.includes('prompt')) return 'toGrant'
  return 'ready'
}

/**
 * The scope the one control opens, or `null` when there is nothing to open.
 *
 * The refused scope first, because that is the pane the rep has to change
 * something in; then the unasked one. A scope whose machine has no pane
 * (`canOpenSettings: false`) is never returned, which is what keeps the button
 * off a Windows screen-recording row that does not exist.
 */
export const scopeToOpen = (permissions: CapturePermissions): PermissionScope | null => {
  const openable = (status: PermissionRow['status']) => (row: PermissionRow) =>
    row.status === status && row.canOpenSettings
  const rows = PERMISSION_SCOPES.map((scope) => rowFor(permissions, scope)).filter(
    (row): row is PermissionRow => row !== null,
  )
  return (rows.find(openable('denied')) ?? rows.find(openable('prompt')))?.scope ?? null
}

/**
 * Every refusal sentence, in scope order. Empty unless something is refused.
 *
 * Plural because both scopes can be refused at once on macOS, and a screen that
 * printed only the first would send the rep to one pane and leave them
 * wondering why the app still could not hear the call.
 */
export const refusalReasons = (permissions: CapturePermissions): string[] =>
  PERMISSION_SCOPES.flatMap((scope) => {
    const row = rowFor(permissions, scope)
    return row && row.status === 'denied' && row.reason ? [row.reason] : []
  })
