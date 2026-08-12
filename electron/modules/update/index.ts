/**
 * The update module's surface.
 *
 * No health mapping here, unlike `modules/mail`. An update is not a connector:
 * DEC-32 keeps it out of the general status entirely, and DEC-26 makes it the
 * most optional thing in the app. Its whole readout is `UpdateState`, and
 * Réglages is the only screen that draws it.
 */
export { AutoUpdate, updateFailureReason } from './AutoUpdate.ts'
export type {
  AutoUpdaterLike,
  AutoUpdaterLoader,
  AutoUpdateOptions,
  ProgressLike,
  UpdateInfoLike,
} from './AutoUpdate.ts'
