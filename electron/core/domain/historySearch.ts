/**
 * The matching rule behind the search box and its filter chips (DEC-25), pure.
 *
 * It lives here rather than in the IPC handler for the usual reason — a rule in
 * a handler is a rule nobody can test — and for one specific to this screen:
 * the *search runs in the main process*, so the only way to see what it matched
 * is to unit-test the function that decided.
 *
 * Two decisions worth stating, both about French:
 *
 *  - **Diacritics are folded.** A rep who types `demarrage` means `démarrage`,
 *    and a search that answers "aucun résultat" to a missing accent is a search
 *    nobody uses twice. Case is folded with it.
 *  - **Substring, not word.** ESN vocabulary is compound and inflected — `TJM`,
 *    `TJMs`, `régie`, `en régie` — and a word-boundary matcher would miss the
 *    plural of the single most searched term in the product.
 */
import type {
  HistoryFilter,
  HistoryIntent,
  HistoryMatch,
  HistoryMatchWhere,
  HistoryPeriod,
  HistoryStatus,
} from '../contracts/history.ts'
import type { Meeting, MeetingState } from '../contracts/meeting.ts'

/** Characters either side of a hit in the excerpt. Enough to read, short enough to ship. */
const CONTEXT = 40

/**
 * Lowercase and strip combining marks. `NFD` splits `é` into `e` + U+0301, the
 * range then removes the mark — which is the whole of accent-insensitivity, and
 * it does not need a table.
 */
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** The four surfaces of one call, as text. Built by the caller from the log. */
export interface SearchableRecord {
  transcript: string
  notes: string
  compteRendu: string
}

const WHERE_ORDER: readonly HistoryMatchWhere[] = ['transcript', 'notes', 'compteRendu']

/**
 * One excerpt per surface that matched, in a fixed order.
 *
 * One per surface rather than one per hit: a query like `de` occurs four
 * hundred times in a transcript, and four hundred excerpts is a payload, not an
 * answer. The row exists to say *this call mentions it, here is where* — the
 * expanded record is where somebody reads the rest.
 */
export const matchesFor = (record: SearchableRecord, query: string): HistoryMatch[] => {
  const needle = fold(query.trim())
  if (needle.length === 0) return []

  const matches: HistoryMatch[] = []
  for (const where of WHERE_ORDER) {
    const excerpt = excerptFor(record[where], needle)
    if (excerpt !== null) matches.push({ where, excerpt })
  }
  return matches
}

/**
 * The excerpt, cut out of the **original** text rather than the folded one.
 *
 * Folding is length-preserving for every character French uses in NFC form, but
 * not in general — `ﬁ` folds to two characters and would shift every index
 * after it. So the index is found in a folded copy and applied to the original
 * only after both have been checked to be the same length; when they are not,
 * the excerpt falls back to the head of the surface, which is still true and
 * still readable.
 */
const excerptFor = (text: string, needle: string): string | null => {
  const folded = fold(text)
  const at = folded.indexOf(needle)
  if (at < 0) return null

  if (folded.length !== text.length) return ellipsise(text.slice(0, CONTEXT * 2), false, true)

  const start = Math.max(0, at - CONTEXT)
  const end = Math.min(text.length, at + needle.length + CONTEXT)
  return ellipsise(text.slice(start, end), start > 0, end < text.length)
}

const ellipsise = (body: string, before: boolean, after: boolean): string =>
  `${before ? '…' : ''}${body.replace(/\s+/g, ' ').trim()}${after ? '…' : ''}`

/** True when a query is worth running at all. An empty box lists everything. */
export const isSearching = (query: string): boolean => query.trim().length > 0

// ── The filter chips (DEC-25, DEC-31) ───────────────────────────────────────
//
// Here rather than in the handler, for the reason the matcher is: a rule in an
// IPC handler is a rule nobody can test, and this one decides what a rep can
// find. It is also the half of the search that costs nothing to run — a client
// name, a state and a date, no transcript folded — so the caller applies it
// first and only pays for the text match on what survives.

/** Nothing selected on any axis. The state the chip row opens in. */
export const NO_FILTER: HistoryFilter = {
  client: null,
  periode: 'toute',
  statut: 'tous',
  intention: 'toutes',
}

/**
 * A partial filter — an omitted field over IPC, an older renderer — filled in.
 *
 * Field by field rather than by spreading over `NO_FILTER`: a payload carrying
 * `{ client: undefined }` spreads *over* the default and yields `undefined`,
 * which is neither « aucun client » nor a client and would compare unequal to
 * both.
 */
export type PartialFilter = { [K in keyof HistoryFilter]?: HistoryFilter[K] | undefined }

export const withFilterDefaults = (filter?: PartialFilter | null): HistoryFilter => ({
  client: filter?.client ?? NO_FILTER.client,
  periode: filter?.periode ?? NO_FILTER.periode,
  statut: filter?.statut ?? NO_FILTER.statut,
  intention: filter?.intention ?? NO_FILTER.intention,
})

/** True when at least one chip is on. The renderer uses it to decide what to draw. */
export const isFiltering = (filter: HistoryFilter): boolean =>
  filter.client !== NO_FILTER.client ||
  filter.periode !== NO_FILTER.periode ||
  filter.statut !== NO_FILTER.statut ||
  filter.intention !== NO_FILTER.intention

/** Two filters are the same query. Used to drop a stale answer, like `query`. */
export const sameFilter = (a: HistoryFilter, b: HistoryFilter): boolean =>
  a.client === b.client &&
  a.periode === b.periode &&
  a.statut === b.statut &&
  a.intention === b.intention

const PERIOD_DAYS: Record<HistoryPeriod, number | null> = {
  toute: null,
  '7j': 7,
  '30j': 30,
  '90j': 90,
}

const DAY_MS = 86_400_000

/**
 * The three post-call buckets, over the state machine's own vocabulary.
 *
 * `pushing` is *validée* and not *à valider*: the rep confirmed, the outbox is
 * draining, and asking them to validate a second time is the one thing DEC-4
 * forbids. `ended` and `extracting` are *à valider* because the call happened
 * and nothing has been confirmed — a meeting whose extraction never completed
 * is exactly the row a rep is hunting for, and dropping it out of every bucket
 * would make it findable only by scrolling.
 */
const STATUS_STATES: Record<HistoryStatus, ReadonlySet<MeetingState> | null> = {
  tous: null,
  'a-valider': new Set<MeetingState>(['ended', 'extracting', 'awaiting_confirmation']),
  validees: new Set<MeetingState>(['pushing', 'done']),
  abandonnees: new Set<MeetingState>(['aborted']),
}

/**
 * The day a meeting belongs on, as an instant (DEC-31).
 *
 * The same order the calendar grid places a row by: the day the rep put it on,
 * else the day it ran, else the day it was created. *Période* has to agree with
 * where the meeting is drawn, or a call filed under Thursday would drop out of
 * « 7 jours » on Wednesday.
 */
export const meetingAnchor = (meeting: Meeting): number =>
  meeting.scheduledStart ?? meeting.startedAt ?? meeting.createdAt

export interface FilterInput {
  meeting: Meeting
  /** What the call produced, from the outbox projection. */
  intents: readonly HistoryIntent[]
  filter: HistoryFilter
  /** The main process's clock. *Période* is relative and must be measured once. */
  now: number
}

/** Every axis, ANDed. `NO_FILTER` passes everything, which is the listing case. */
export const passesFilter = ({ meeting, intents, filter, now }: FilterInput): boolean => {
  if (filter.client !== null && meeting.clientName !== filter.client) return false

  const days = PERIOD_DAYS[filter.periode]
  if (days !== null && meetingAnchor(meeting) < now - days * DAY_MS) return false

  const states = STATUS_STATES[filter.statut]
  if (states !== null && !states.has(meeting.state)) return false

  if (filter.intention !== 'toutes' && !intents.some((i) => i.kind === filter.intention)) {
    return false
  }

  return true
}
