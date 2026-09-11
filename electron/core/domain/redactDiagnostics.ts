/**
 * `DiagEvent[] → DiagBundle`, pure (DEC-27, ARCHITECTURE.md §5.I).
 *
 * The guarantee "the redacted export contains no client conversation content"
 * has to be a unit test, not a claim — a bundle full of prospect transcripts
 * sitting in a support mailbox is a GDPR incident, and the safe export is the
 * one the button reaches first.
 *
 * So redaction works from an **allowlist**. `detail` keeps only values that
 * cannot carry prose: numbers, booleans, and strings that match one of a closed
 * set of identifier *shapes*. Anything else is replaced by a description of what
 * was dropped, which is usually as diagnostic as the value itself ("a 4 kB
 * string was here") and always safe. A denylist would need to anticipate every
 * field a future module invents; this cannot be wrong by omission — but it has
 * twice been wrong by *admission*, which is a shape drawn wider than the thing
 * it was meant to describe, and that is what the sweep in the test guards.
 *
 * **The two halves are not equally safe, and the difference is the whole story
 * of this file.** `redactDetail` is a genuine allowlist. `redactMessage` is a
 * denylist over free-form French, and it has now leaked in three separate review
 * rounds — a Windows home directory, then a vendor API key, then a client's
 * name. Each rule below carries the string that got past it. The honest verdict,
 * written down so the fourth round does not have to rediscover it: **a denylist
 * over free-form text cannot be made safe, only made narrower.** A client's name
 * is an ordinary capitalised French word and no rule distinguishes
 * « Néovia Santé » from « Windows Defender ». What follows removes every
 * *mechanical* shape — an address, a locator, a credential, a quotation — and
 * what it cannot remove is a name a call site chose to interpolate. So the rule
 * that actually holds the promise lives at the call sites: **a message says how
 * many and of what kind; the thing itself goes in `detail`, where the allowlist
 * answers `[string:12]`.** `main.ts`'s `lexicon.learned` is the worked example.
 */
import type {
  DiagBundle,
  DiagEnvironment,
  DiagEvent,
  ExportMode,
} from '../contracts/diagnostics.ts'

/**
 * **A `detail:` string is kept only when it is built out of identifier segments
 * — and that is a grammar, not a length.**
 *
 * This started as « no spaces, at most sixty-four characters », which passed a
 * key, a bearer token, a URL and a home directory verbatim. It became
 * « …at most thirty-two », and thirty-two is exactly the length of an Azure
 * Speech key and of a Deepgram key's first half:
 *
 *     '0123456789abcdef0123456789abcdef'  (32) → passed verbatim
 *     'AIzaSyD-1234567890abcdefghijklmn'  (32) → passed verbatim
 *
 * Twice now the rule has been one character wide of a real credential, because a
 * single number had to sit above an ISO timestamp (24) and a UUID (36) while
 * staying below a key (32) — an interval that does not exist.
 *
 * So the bound moved off the value and onto the **segment**. A value is split on
 * `. - _ : /` and every piece must be one of four shapes; the longest piece this
 * product actually mints is sixteen characters (a meeting id's suffix,
 * `evt-606ec6e9bd8a8ff2`), and the shortest unbroken run in any credential
 * measured here is twenty-four. Twenty is between them with room on both sides,
 * and — this is the part that makes the class of error structurally
 * impossible — `redactDiagnostics.test.ts` asserts refusal **at every length
 * from twenty-one to sixty-four, for every credential alphabet**, so no single
 * number can again be one over.
 *
 * The four shapes, and the whole vocabulary they exist to admit:
 *
 *     LOWER   [a-z0-9]{1,20}       far · rep · whisper · 606ec6e9bd8a8ff2 · fr
 *     UPPER   [A-Z0-9]{1,20}       OPPY · COMPANY · FREE
 *     CAMEL   [a-z][a-zA-Z]{0,19}  tooQuiet · fieldMissing · pushUnsettled
 *     PASCAL  [A-Z][a-zA-Z]{0,19}  Xenova — and only beside another segment
 *
 * A credential mixes case *and* digits inside one piece, which is none of the
 * four at any length: `AbCdEf0123456789` is refused at sixteen characters, where
 * the old rule kept it.
 *
 * **PASCAL alone is a proper noun, so a lone one is refused.** `Agenda` records
 * `detail: { subject: context.subject }` and a meeting's objet is very often one
 * word — « Sodexial », « Neovia » — which is ASCII, unspaced, and was therefore
 * kept in full by every version of this allowlist. It is admitted only *beside*
 * another segment, which is what `Xenova/whisper-small` is and what a company
 * name is not. The cost is measured and accepted: `app.uncaughtException` puts
 * `err.name` in `detail`, so `TypeError` now reads `[string:9]` while the `code`
 * still says which handler fired.
 */
const SEGMENT = /^(?:[a-z0-9]{1,20}|[A-Z0-9]{1,20}|[a-z][a-zA-Z]{0,19}|[A-Z][a-zA-Z]{0,19})$/
/**
 * The same set without PASCAL, for a value that is one segment on its own.
 * Stated positively rather than as « not PASCAL »: `OPPY` is an all-caps VSA
 * literal *and* matches `[A-Z][a-zA-Z]{0,19}`, so the negative reading refused
 * `linkType` — the one field that says how a compte-rendu hangs off the CRM.
 */
const LONE_SEGMENT = /^(?:[a-z0-9]{1,20}|[A-Z0-9]{1,20}|[a-z][a-zA-Z]{0,19})$/
const SEGMENT_SPLIT = /[.\-_:/]/
/**
 * A model id is `vendor/name` and nothing here has two slashes; a path does.
 * That single bound is what refuses `Users/jean.dupont/sillage.db`, which every
 * segment of is a perfectly ordinary word — so the old `LOCATOR` guard, which
 * only ever caught a path that *started* with `/`, `~` or `X:`, is no longer
 * what stops it. Dots are bounded for the same reason and loosely: `0.1.4` and
 * `capture.level.tooQuiet` are the longest real ones.
 */
const MAX_SLASHES = 1
const MAX_DOTS = 3
const MAX_SEGMENTS = 8

const countOf = (value: string, char: string): number =>
  value.split(char).length - 1

const isSafeString = (value: string): boolean => {
  if (value.length === 0) return false
  if (countOf(value, '/') > MAX_SLASHES) return false
  if (countOf(value, '.') > MAX_DOTS) return false
  const segments = value.split(SEGMENT_SPLIT)
  if (segments.length > MAX_SEGMENTS) return false
  if (!segments.every((segment) => SEGMENT.test(segment))) return false
  // `@` and `\` are in no segment shape, so an address and a Windows path are
  // already refused above; a lone proper noun is not, and has to be named.
  return segments.length > 1 || LONE_SEGMENT.test(segments[0] as string)
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const URL_WITH_PAYLOAD = /\bhttps?:\/\/\S+/g

/**
 * **A path crosses a space, because the client's document has one in its name —
 * and for three rounds this rule removed the wrong half.**
 *
 * The rule was greedy to the first whitespace, under a comment claiming that
 * « a path with a space in it loses its tail rather than its head, which still
 * removes the part that names a person ». It is the other way round, and that is
 * exactly backwards from what matters:
 *
 *     in   échec vers C:\Users\Jean-Pierre.Dupont\Documents\Appel d’offres Néovia.docx
 *     out  échec vers [chemin] d’offres Néovia.docx
 *
 * The head — the rep's own home directory — went, and the tail — the client's
 * appel d'offres, by name — stayed, on the primary platform (HR-2), in the
 * bundle whose own button reads « Sans contenu de conversation. Peut être envoyé
 * au support. » `/Users/jean.dupont/Documents/Offre Sodexial.pdf` left
 * `[chemin] Sodexial.pdf`, and `~/Documents/Néovia Santé/notes.md` left
 * `[chemin] Santé[chemin]` — the second placeholder being `/notes.md` matching
 * again on its own.
 *
 * So the run crosses a space, but only while what follows still looks like a
 * path: another separator, or a **alphabetic** file extension, within the next
 * sixty characters. Alphabetic because `capture.file.opened` reads
 * `… .wav — 312.4 s à 16000 Hz` and a `.4` would otherwise pull the duration
 * into the placeholder; a French sentence resuming after a filename
 * (« … \\SRV-PARIS\partage\clients\Neovia.xlsx impossible ») has neither, which
 * is what keeps the message readable. Six crossings, so a message with two
 * paths in it cannot be swallowed whole.
 *
 * **And the POSIX anchor's lookbehind counts an accented letter as a boundary,
 * which is how the second `[chemin]` appeared above.** `\w` is `[A-Za-z0-9_]`,
 * so `Santé/vault.db` inside `dossiers/Néovia Santé/vault.db` looked like an
 * absolute path beginning at the `é` — the rule matched the tail on its own and
 * left `dossiers/Néovia Santé` standing. In French this is the *normal* case,
 * not an edge one, so the class is spelled out rather than borrowed from `\w`.
 */
const MORE_PATH = String.raw`(?=[^"«»“”\n]{0,60}?(?:[\\/]|\.[A-Za-z]{1,8}(?![A-Za-z0-9])))`
const COMPONENT = String.raw`[^\s"«»“”\n]*`
const PATH_TAIL = String.raw`${COMPONENT}(?:[ \t]${MORE_PATH}${COMPONENT}){0,6}`
const PATH = new RegExp(
  String.raw`(?:\\\\[A-Za-z0-9._-]|[A-Za-z]:[\\/]|~[\\/]` +
    String.raw`|(?<![A-Za-z0-9À-ÿ._\\/-])/(?=[A-Za-z0-9._-]))${PATH_TAIL}`,
  'g',
)
/**
 * **And the relative one, which no anchor above can see.**
 *
 * `capture.file.opened` is `` `${source.path} — …` `` and a source path is
 * whatever the operator pointed the demo at: `enregistrements/neovia-sante-comite.wav`
 * has no drive letter, no leading slash and no `~`, so it went through
 * completely untouched, client name and all. A relative path is admitted only
 * when it ends in an alphabetic extension — that is what separates
 * `dossiers/Néovia Santé/vault.db` from `Xenova/whisper-small`, which is a model
 * id and must survive, and from `3/4`, which is a ratio.
 */
const RELATIVE_FILE = new RegExp(
  String.raw`(?<![\w./\\@-])[A-Za-z0-9À-ÿ_~-]+[\\/]` +
    String.raw`(?=[^"«»“”\n]{0,80}?\.[A-Za-z]{1,8}(?![A-Za-z0-9]))${PATH_TAIL}`,
  'g',
)
/**
 * **A credential is an unbroken run no French word and no minted id reaches.**
 *
 * `redactMessage` stripped the URL and left the key sitting next to it. Every
 * provider this product talks to puts its rejected key in the error body, and
 * `OpenAiCompatibleLlm` interpolates that body into `llm.auth`'s message
 * (`` `clé API du modèle refusée — ${detail}` ``), `crm/vsa/http.ts` returns
 * VerySwing's body verbatim, and `main.ts`'s `uncaughtException` handler records
 * any `err.message` at all. Measured, all four passed through unchanged:
 *
 *     sk-proj-AbCdEf0123456789AbCdEf0123456789        (OpenAI, 40)
 *     eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ…       (bearer JWT, 155)
 *     AIzaSyD-1234567890abcdefghijklmnopqrstu         (Google, 39)
 *     0123456789abcdef0123456789abcdef                (Azure, 32)
 *     1234567890abcdef1234567890abcdef12345678        (Deepgram, 40)
 *
 * Twenty-four, and the number is measured from both sides. Above: the shortest
 * unbroken run in any credential here is 24. Below: every `message:` literal
 * under `electron/` was swept for its longest run in this alphabet, and the
 * answer is `resynchronisation` (17, `GraphCalendar.ts`), then
 * `authentification` (16) and `synchronisation` (15) — French does not reach
 * twenty-four, and neither does `Xenova/whisper` (14). `-` is **out** of the class,
 * so `evt-606ec6e9bd8a8ff2` (20 characters, and a meeting id is worth keeping)
 * splits into `evt` and a sixteen-character run. A JWT's `.` splits it into
 * three runs and each is replaced on its own, which destroys the token.
 *
 * It is not a rule about names: it removes the credential, and the sentence
 * around it survives to say a key was refused.
 */
const OPAQUE_RUN = /[A-Za-z0-9+/=_]{24,}/g
/** `Bearer <token>` shorter than the run above — the header, named explicitly. */
const AUTH_HEADER = /\b(?:bearer|basic)\s+[A-Za-z0-9+/=._~-]{8,}/gi
/**
 * **Quoted runs are how transcript excerpts end up inside an error message, and
 * the pairing was doing the opposite of what it claimed.**
 *
 * It was one character class for both delimiters and a minimum of eight, so any
 * quote could close any other quote and it ate the **gaps**:
 *
 *     in   Expected 'esn' | 'libre', received 'Néovia Santé'
 *     out  Expected 'esn' | 'libre[quoted]Néovia Santé'
 *
 * — `', received '` is twelve characters and matched; the client's name, which
 * is the only thing in that sentence worth removing, was left in the open. The
 * eight-character minimum was the other half of the same defect: `« Neovia »` is
 * ten and went, `« Acme »` is six and stayed.
 *
 * Each delimiter now closes with itself, and there is no minimum. `’` (U+2019)
 * is deliberately **not** a delimiter: it is the French apostrophe that
 * `check:french` enforces in every string this product writes, so `l’échec de
 * l’appel` would pair across the elision. ASCII `'` is a delimiter precisely
 * because product prose never contains one — where it appears it comes from an
 * English library or a JSON echo, and there it is quoting a value.
 */
const QUOTED = /«[^«»\n]*»|“[^“”\n]*”|"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g

const MAX_MESSAGE = 240

/**
 * The order is load-bearing. Addresses and locators first, so a key inside a
 * URL's query is not left behind when the URL goes; the credential runs next, so
 * they are gone before quoting decides what a delimiter is; quotations last,
 * because by then what is left between quotes is prose.
 */
export const redactMessage = (message: string): string =>
  message
    .replace(EMAIL, '[email]')
    .replace(URL_WITH_PAYLOAD, '[url]')
    .replace(PATH, '[chemin]')
    .replace(RELATIVE_FILE, '[chemin]')
    .replace(AUTH_HEADER, '[secret]')
    .replace(OPAQUE_RUN, '[secret]')
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
