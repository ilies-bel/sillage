/**
 * The CRM module's surface, plus the translation `app/` needs: a failure into a
 * `ConnectorHealth` a human can act on.
 *
 * Same shape as `modules/calendar/index.ts` and `modules/mail/index.ts`, and for
 * the same reason. DEC-26 requires a disabled control to state why, and the
 * difference between "identifiants refusés" and "VerySwing temporairement
 * indisponible" is the difference between opening Réglages and waiting ten
 * seconds. Only this file knows both what VSA said and what the app can do about
 * it.
 *
 * One thing is deliberately absent from every string below: the compte-rendu is
 * never at risk. The CRM being down greys the CRM intents and nothing else — the
 * meeting is recorded, the notes are written, the Outlook draft still ships
 * (DEC-26), and the outbox row stays retryable.
 *
 * **No VerySwing identifier appears in this file.** It is one level above
 * `vsa/`, where `scripts/check-crm-containment.mjs` starts failing the build.
 */
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import { VsaError } from './vsa/http.ts'

export { VsaCrm } from './vsa/VsaCrm.ts'
export type { VsaCrmOptions } from './vsa/VsaCrm.ts'
export { vsaConfig, missingVsaSettings } from './vsa/config.ts'
export type { VsaConfig } from './vsa/config.ts'
export { VsaError, VsaSession, urlFor } from './vsa/http.ts'
export type { FetchLike, VsaRequest } from './vsa/http.ts'
export { probeVsa, columnGaps, EXPECTATIONS } from './vsa/probe.ts'
export type { ProbeReport, CapabilityFinding, CapabilityState, ColumnGap } from './vsa/probe.ts'
export {
  ReferentialCache,
  REFERENTIALS,
  REFERENTIAL_TTL_MS,
  PICK_HINTS,
  pick,
  normalise,
  numericCode,
} from './vsa/referentials.ts'
export type { ReferentialEntry, ReferentialId, ReferentialSet, ReferentialChoice } from './vsa/referentials.ts'
export { Directory, DIRECTORY_TTL_MS, EMPTY_SNAPSHOT, PAGE_SIZE, MAX_PAGES } from './vsa/directory.ts'
export type { DirectoryAccount, DirectoryContact, DirectorySnapshot, AccountKind } from './vsa/directory.ts'
export {
  rankCandidates,
  siblingCandidates,
  familyOf,
  domainOf,
  domainLabel,
  normaliseEmail,
  OK_SCORE,
  AMBIGUITY_MARGIN,
  PUBLIC_EMAIL_DOMAINS,
} from './vsa/resolve.ts'
export type { ResolutionInput } from './vsa/resolve.ts'
export {
  columnsFor,
  domainFor,
  field,
  TASK_FIELDS,
  OPPORTUNITY_FIELDS,
  EXTRACTION_FIELDS,
  ALL_FIELD_TABLES,
  TEXT,
  AMOUNT,
  ATOM,
  DAY,
} from './vsa/fieldMap.ts'
export type { FieldRow, Codec, DomainValue, VsaScalar } from './vsa/fieldMap.ts'

export const crmHealth = (error: unknown, at: number): ConnectorHealth => {
  if (error instanceof VsaError) {
    // The credentials are wrong, not stale — the session already re-logged in
    // and was refused a second time. No amount of retrying fixes a password, and
    // a retry button here is the dead affordance DEC-26 forbids.
    if (error.badCredentials) {
      return {
        state: 'down',
        reason: 'identifiants VerySwing refusés — vérifiez la configuration dans Réglages',
        since: at,
        retryable: false,
      }
    }
    if (error.status === 403) {
      return {
        state: 'down',
        reason: 'accès refusé — ce compte VerySwing n’a pas les droits nécessaires',
        since: at,
        retryable: false,
      }
    }
    if (error.notFound) {
      return {
        state: 'down',
        reason: 'endpoint VerySwing absent de ce tenant — voir le diagnostic de connexion',
        since: at,
        retryable: false,
      }
    }
    if (error.retryable) {
      const wait = error.retryAfterMs ? ` — nouvelle tentative dans ${Math.ceil(error.retryAfterMs / 1000)} s` : ''
      // Degraded, not down: the compte-rendu is written and one retry away from
      // VerySwing. A 500 is weather, and the outbox row survives it.
      return { state: 'degraded', reason: `VerySwing temporairement indisponible${wait}`, since: at, retryable: true }
    }
    return { state: 'down', reason: error.message, since: at, retryable: false }
  }

  return {
    state: 'down',
    reason: error instanceof Error ? error.message : 'VerySwing indisponible',
    since: at,
    retryable: true,
  }
}
