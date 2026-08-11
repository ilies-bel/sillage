/**
 * The calendar module's surface, plus the one translation `app/` needs: a
 * failure into a `ConnectorHealth` a human can act on.
 *
 * DEC-26 requires that a disabled control always say why, and the difference
 * between "Microsoft nous limite, nouvelle tentative dans 30 s" and "reconnexion
 * nécessaire" is the difference between waiting and clicking. That mapping lives
 * here because it is the only place that knows both what Graph said and what the
 * app can do about it.
 */
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import { ConsentRequiredError, InteractionRequiredError } from '../../core/contracts/identity.ts'
import { GraphError } from './graph.ts'

export { GraphCalendar, WINDOW_KEY, DEFAULT_TIME_ZONE, MAX_PAGES } from './GraphCalendar.ts'
export type { GraphCalendarOptions } from './GraphCalendar.ts'
export { GRAPH_BASE, GraphError, graphGet } from './graph.ts'
export type { FetchLike, GraphGetOptions } from './graph.ts'
export { mapEvent, removedId, SKIPPED_SENSITIVITY } from './mapEvent.ts'
export {
  applyDelta,
  byStart,
  needsFullSync,
  prune,
  windowFor,
  MIN_LOOKAHEAD_MS,
  WINDOW_AHEAD_MS,
  WINDOW_BACK_MS,
} from './delta.ts'
export { zonedToEpoch } from './time.ts'

export const calendarHealth = (error: unknown, at: number): ConnectorHealth => {
  // Not retryable: no amount of waiting grants a consent. Someone has to ask an
  // administrator, and the banner should say so rather than spin.
  if (error instanceof ConsentRequiredError) {
    return {
      state: 'down',
      reason: 'autorisation refusée — votre administrateur Microsoft doit approuver l’application',
      since: at,
      retryable: false,
    }
  }
  if (error instanceof InteractionRequiredError) {
    return { state: 'down', reason: 'reconnexion à Microsoft nécessaire', since: at, retryable: true }
  }

  if (error instanceof GraphError) {
    if (error.needsSignIn) {
      return { state: 'down', reason: 'session Microsoft expirée', since: at, retryable: true }
    }
    if (error.status === 403) {
      // A consent problem, not an outage. Retrying changes nothing, and
      // offering a retry button here is the dead affordance DEC-26 forbids.
      return {
        state: 'down',
        reason: 'accès au calendrier refusé — autorisation Calendars.Read manquante',
        since: at,
        retryable: false,
      }
    }
    if (error.retryable) {
      const wait = error.retryAfterMs ? ` — nouvelle tentative dans ${Math.ceil(error.retryAfterMs / 1000)} s` : ''
      // Degraded, not down: the last fold is still on screen and still correct
      // enough to arm from. A throttled request is not a lost calendar.
      return { state: 'degraded', reason: `calendrier temporairement indisponible${wait}`, since: at, retryable: true }
    }
    return { state: 'down', reason: error.message, since: at, retryable: false }
  }

  return {
    state: 'down',
    reason: error instanceof Error ? error.message : 'calendrier indisponible',
    since: at,
    retryable: true,
  }
}
