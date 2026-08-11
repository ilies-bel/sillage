/**
 * `DiagEvent[] → DiagBundle`, pure (DEC-27, ARCHITECTURE.md §5.I).
 *
 * The guarantee "the redacted export contains no client conversation content"
 * has to be a unit test, not a claim — a bundle full of prospect transcripts
 * sitting in a support mailbox is a GDPR incident, and the safe export is the
 * one the button reaches first.
 *
 * So redaction works from an **allowlist**. `detail` keeps only values that
 * cannot carry prose: numbers, booleans, and short identifier-shaped strings.
 * Anything else is replaced by a description of what was dropped, which is
 * usually as diagnostic as the value itself ("a 4 kB string was here") and
 * always safe. A denylist would need to anticipate every field a future module
 * invents; this cannot be wrong by omission.
 */
import type {
  DiagBundle,
  DiagEnvironment,
  DiagEvent,
  ExportMode,
} from '../contracts/diagnostics.ts'

/**
 * Identifier-shaped: provider ids, error codes, device names, enum values,
 * ISO timestamps, semver. No spaces, so no sentence survives it.
 */
const SAFE_STRING = /^[A-Za-z0-9_.:/+@-]{1,64}$/
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const URL_WITH_PAYLOAD = /\bhttps?:\/\/\S+/g
/** Quoted runs are how transcript excerpts end up inside an error message. */
const QUOTED = /["“”«»'`]{1}[^"“”«»'`]{8,}["“”«»'`]{1}/g

const MAX_MESSAGE = 240

/** Even inside SAFE_STRING an address is content — it identifies a person. */
const isSafeString = (v: string): boolean => SAFE_STRING.test(v) && !v.includes('@')

export const redactMessage = (message: string): string =>
  message
    .replace(EMAIL, '[email]')
    .replace(URL_WITH_PAYLOAD, '[url]')
    .replace(QUOTED, '[quoted]')
    .slice(0, MAX_MESSAGE)

const describe = (value: unknown): string => {
  if (typeof value === 'string') return `[string:${value.length}]`
  if (Array.isArray(value)) return `[array:${value.length}]`
  if (value && typeof value === 'object') return `[object:${Object.keys(value).length}]`
  return `[${typeof value}]`
}

export const redactDetail = (detail: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
    } else if (typeof value === 'string' && isSafeString(value)) {
      out[key] = value
    } else {
      out[key] = describe(value)
    }
  }
  return out
}

/**
 * `meetingId` survives. It is an app-minted opaque id — it says *which* call a
 * failure belongs to, which is most of the diagnostic value, and it says
 * nothing about who was on it. Correlating it back to a client requires the
 * machine's own database.
 */
export const redactDiagEvent = (event: DiagEvent): DiagEvent => ({
  id: event.id,
  ts: event.ts,
  severity: event.severity,
  code: event.code,
  module: event.module,
  message: redactMessage(event.message),
  detail: redactDetail(event.detail),
  meetingId: event.meetingId,
})

export const buildDiagBundle = (
  mode: ExportMode,
  events: DiagEvent[],
  environment: DiagEnvironment,
  generatedAt: number,
): DiagBundle => ({
  mode,
  generatedAt,
  environment,
  events: mode === 'redacted' ? events.map(redactDiagEvent) : events,
})
