/**
 * The mail module's surface, plus the translation `app/` needs: a failure into
 * a `ConnectorHealth` a human can act on.
 *
 * DEC-26 requires that a disabled control always say why. "Outlook nous limite,
 * nouvelle tentative dans 30 s" and "reconnexion nécessaire" call for different
 * things from the rep — waiting versus clicking — and only this file knows both
 * what Graph said and what the app can do about it.
 */
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import { ConsentRequiredError, InteractionRequiredError } from '../../core/contracts/identity.ts'
import { ForbiddenScopeError, GraphError } from './graph.ts'

export { OutlookMail, MAIL_SCOPES } from './OutlookMail.ts'
export type { MailPort, OutlookMailOptions } from './OutlookMail.ts'
export { GRAPH_BASE, MESSAGES_PATH, draftsUrl, GraphError, ForbiddenScopeError, postDraft } from './graph.ts'
export type { FetchLike, GraphPostOptions } from './graph.ts'

export const mailHealth = (error: unknown, at: number): ConnectorHealth => {
  // A scope the app must never request was wired in. No retry, no reconnection:
  // the build is wrong and the affordance must not pretend otherwise.
  if (error instanceof ForbiddenScopeError) {
    return {
      state: 'down',
      reason: 'configuration invalide — autorisation de messagerie interdite demandée',
      since: at,
      retryable: false,
    }
  }

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
        reason: 'accès à la messagerie refusé — autorisation Mail.ReadWrite manquante',
        since: at,
        retryable: false,
      }
    }
    if (error.retryable) {
      const wait = error.retryAfterMs ? ` — nouvelle tentative dans ${Math.ceil(error.retryAfterMs / 1000)} s` : ''
      // Degraded, not down: the meeting is recorded, the compte-rendu is
      // written, and the draft is one retry away. A throttled request is not a
      // lost follow-up.
      return { state: 'degraded', reason: `messagerie temporairement indisponible${wait}`, since: at, retryable: true }
    }
    return { state: 'down', reason: error.message, since: at, retryable: false }
  }

  return {
    state: 'down',
    reason: error instanceof Error ? error.message : 'messagerie indisponible',
    since: at,
    retryable: true,
  }
}
