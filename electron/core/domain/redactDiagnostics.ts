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
 * of this file.** `redactDetail` is an allowlist over identifier *shapes*.
 * `redactMessage` is a denylist over free-form French, and it has now leaked in
 * four separate review rounds — a Windows home directory, then a vendor API key,
 * then a client's name inside a quotation, then a client's name that quoting
 * *published*. Each rule below carries the string that got past it. The verdict
 * was written down after the third round: **a denylist over free-form text
 * cannot be made safe, only made narrower.** A client's name is an ordinary
 * capitalised French word and no rule distinguishes « Néovia Santé » from
 * « Windows Defender ».
 *
 * **The fourth round stopped narrowing it and made the call site say instead.**
 * `DiagEvent.origin` is `'foreign'` when the message carries text this product
 * did not author — a vendor's error body, an OS string, a value interpolated in
 * from the world — and a foreign message leaves as `[message:N]`, not as prose
 * a denylist was asked to clean. `npm run check:diag` is what makes that
 * omission-proof: a `.record({…})` whose `message:` is anything but a string
 * literal must declare `'authored'` or `'foreign'`, so the next call site fails
 * CI rather than leaking. The rules below still run on an authored message —
 * a path or a key can reach one through a template — but they are no longer the
 * only thing between a client's name and a support mailbox.
 *
 * And `detail` is **not** the destination for what a message may not carry. The
 * grammar there admits words, because `far`, `rep`, `whisper` and `sodexial` are
 * one shape; what belongs there is a count, a length, or an id the app minted.
 * `main.ts`'s `lexicon.learned` — « 4 terme(s) appris pour un client », with the
 * count in `detail` — is the worked example.
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
 * The three shapes, and the whole vocabulary they exist to admit:
 *
 *     LOWER   [a-z0-9]{1,20}       far · rep · whisper · 606ec6e9bd8a8ff2 · fr
 *     UPPER   [A-Z0-9]{1,20}       OPPY · COMPANY · FREE
 *     CAMEL   [a-z][a-zA-Z]{0,19}  tooQuiet · fieldMissing · pushUnsettled
 *
 * A credential mixes case *and* digits inside one piece, which is none of the
 * three at any length: `AbCdEf0123456789` is refused at sixteen characters,
 * where the old rule kept it.
 *
 * **A capitalised word is a proper noun wherever it stands, and « beside another
 * segment » was not a rule — one hyphen defeated it.** The previous round
 * refused a *lone* PASCAL segment, because `Agenda` records
 * `detail: { subject: event.context.subject }` and a meeting's objet is very
 * often one word: « Sodexial », « Neovia ». But `isSafeString` short-circuited
 * on `segments.length > 1`, so anything with a separator in it never reached
 * that test at all. Measured against the shipped function:
 *
 *     'Sodexial'           → [string:8]   (the case the round was written for)
 *     'Sodexial-staffing'  → passes verbatim
 *     'Dupont-Marechal'    → passes verbatim
 *     'CR-Sodexial'        → passes verbatim
 *
 * A hyphenated objet and a double-barrelled French surname are not edge cases;
 * they are how the field is spelled. So PASCAL is out of the segment set
 * entirely, and the one place this product genuinely mints a capitalised word is
 * recognised as a **position** instead: the vendor half of a Hugging Face repo
 * id, `Xenova/whisper-small` (`core/contracts/models.ts`). The cost is measured
 * and accepted: `app.uncaughtException` puts `err.name` in `detail`, so
 * `TypeError` reads `[string:9]` while the `code` still says which handler fired.
 *
 * **What this grammar still cannot refuse, stated rather than implied.** It is
 * proof against *shapes* — a credential, an address, a locator — because those
 * are mechanical. It is not proof against a **word**: `far`, `rep`, `whisper`
 * and `sodexial` are one shape, and `local-whisper` and `jean-pierre.dupont`
 * are another. A proper noun somebody typed in lower case, or shouted in caps,
 * passes, and no tightening short of refusing `channel: 'far'` changes that. The
 * file's old claim that it « cannot be wrong by omission » was true of shapes
 * and false of words. The place that can be closed is the call site: a value
 * from outside the app belongs in `detail` as a count or a length, never as
 * itself.
 */
const SEGMENT = /^(?:[a-z0-9]{1,20}|[A-Z0-9]{1,20}|[a-z][a-zA-Z]{0,19})$/
/**
 * The one position a capitalised word is machine vocabulary: `Vendor/name`, a
 * Hugging Face repo id. It is anchored to the slash rather than allowed
 * anywhere, so `Sodexial-staffing` has nowhere to match — and the rest of the
 * value is still held to `SEGMENT`, so `Sodexial/Comité` is refused on the `é`.
 * The residual is `Sodexial/staffing` — a capitalised word, one slash, one
 * lowercase word — which is the model-id shape exactly and cannot be told apart
 * from it. Dropping the exemption instead would answer `[string:20]` for
 * `model:`, which is the field the memory gate and the download path are
 * diagnosed through.
 */
const MODEL_VENDOR = /^[A-Z][a-zA-Z]{0,19}\//
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
  // The vendor half of a model id is consumed first and counted as one segment.
  // Everything after it goes through the same grammar as everything else, so
  // the exemption is one capitalised word in one position and nothing more.
  const vendor = MODEL_VENDOR.exec(value)
  const body = vendor ? value.slice(vendor[0].length) : value
  if (body.length === 0) return false
  const segments = body.split(SEGMENT_SPLIT)
  if (segments.length + (vendor ? 1 : 0) > MAX_SEGMENTS) return false
  // `@` and `\` are in no segment shape, so an address and a Windows path are
  // refused here; so, now, is a capitalised word anywhere but the vendor slot.
  return segments.every((segment) => SEGMENT.test(segment))
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
 * l’appel` would pair across the elision.
 *
 * **And ASCII `'` did the same thing to the strings that come from *outside*
 * the app, which is the only kind it ever appears in.** The reasoning above was
 * that product prose never contains an ASCII apostrophe, so where one appears it
 * is quoting a value. True — and it omits that the *rest* of that sentence is a
 * vendor's English or a Java backend's French, both of which are full of
 * apostrophes that quote nothing: an English possessive, a French elision. With
 * an odd count the pairing ate the gaps again, and this time it did worse than
 * miss the name — it **published** one that had been delimited before the rule
 * ran:
 *
 *     in   The mailbox's owner rejected recipient 'Jean-Pierre Dupont' for 'Sodexial'
 *     out  The mailbox[quoted]Jean-Pierre Dupont[quoted]Sodexial'
 *
 *     in   l'objet 'Sodexial — comité' n'a pas pu être créé
 *     out  l[quoted]Sodexial — comité[quoted]a pas pu être créé
 *
 * `crm/vsa/http.ts`'s `messageOf` returns VerySwing's body verbatim and a
 * Java/SQL backend emits ASCII `'`, so this is the live path, not a contrivance.
 *
 * So an ASCII `'` opens a quotation only where a quotation can open — after a
 * non-letter — and closes only where one can close. A possessive (`mailbox's`)
 * and an elision (`l'objet`, `n'a`) are both preceded by a letter and are
 * neither. The content is lazy and may cross an apostrophe, so
 * `'l'appel d'offres'` is taken whole; an **unbalanced** opener matches nothing
 * and leaves its text standing, which is the residual and is why
 * `origin: 'foreign'` exists one layer up — a message with an unbalanced ASCII
 * quote is by construction one this product did not write.
 *
 * The other four delimiters keep their own class, which cannot be used for
 * anything but quoting and so cannot straddle a gap the way `'` did.
 */
const QUOTED = new RegExp(
  '«[^«»\\n]*»|“[^“”\\n]*”|"[^"\\n]*"|`[^`\\n]*`' +
    "|(?<![A-Za-z0-9À-ÿ])'[^\\n]{0,200}?'(?![A-Za-z0-9À-ÿ])",
  'g',
)

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
 * **A foreign message leaves as its length and nothing else.**
 *
 * `[message:N]` is the same answer `describe` gives a string in `detail`, and it
 * costs less than it looks: `code` already says what failed (`crm.task.failed`,
 * `transcribe.upload.failed`) and `detail` already carries the retryable flag,
 * the provider, the count. What is lost is the vendor's own sentence, which is
 * exactly the thing four rounds of denylist could not be made safe.
 *
 * `redactMessage` still runs on an **authored** message. A template this product
 * wrote can still interpolate a path, and `origin: 'authored'` is a claim about
 * provenance, not about hygiene.
 *
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
  message:
    event.origin === 'foreign'
      ? `[message:${event.message.length}]`
      : redactMessage(event.message),
  ...(event.origin ? { origin: event.origin } : {}),
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
