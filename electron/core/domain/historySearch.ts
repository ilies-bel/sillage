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
 * Lowercase, strip combining marks, **and fold the apostrophe**. `NFD` splits
 * `é` into `e` + U+0301 and the range removes the mark, which is the whole of
 * accent-insensitivity and needs no table.
 *
 * **The apostrophe is not an accent and NFD does nothing to it.** Everything
 * this product stores carries U+2019: `check:french` enforces it in repo prose,
 * `terms.fr-esn.ts` ships « appel d’offres » as a Whisper boost term, and both
 * the STT and the composer write it. A Windows AZERTY keyboard — the primary
 * platform (HR-2) — emits U+0027. So the only route back into a past call
 * answered « Aucun appel ne correspond. » for « appel d'offres », « l'équipe »,
 * « c'est », « aujourd'hui », about calls sitting in the store:
 *
 *     query ascii  "appel d'offres" -> []
 *     query curly  "appel d’offres" -> [meeting, transcript]
 *     coeur / cœur                  -> []
 *
 * `normalizeForVerification` folds both, 140 lines away, in a module this
 * screen's own file already imports — and `contracts/transcript.ts` records
 * exactly this failure as one already found and fixed for the citation reader.
 * This was the third copy of the same fold and the last one still wrong. It is
 * kept separate rather than merged because that one collapses punctuation to
 * spaces, which would move every excerpt offset on this screen.
 *
 * The ligatures for the same reason: `Cœur` and `coeur` are one word to a rep
 * and NFD leaves `œ` alone. They are also the one step of this fold that
 * **changes the length of the text**, which is why `foldMapped` exists.
 *
 * **And the no-break spaces, which is the apostrophe's failure one character
 * further out.** French typography puts U+00A0 before `: ; ! ?` and U+202F
 * inside « … »; Word and Outlook insert them by autocorrect, and a note pasted
 * out of a mail thread is full of both. A keyboard emits U+0020 and nothing
 * else. So « bloque a 550 : » typed into the box answered « Aucun appel ne
 * correspond. » about a note sitting in the store — and **undiagnosably**,
 * because `ellipsise` collapses every run of whitespace, so the excerpt the rep
 * would have seen had they found the call renders with ordinary spaces. There
 * was nothing on any screen to notice.
 *
 * The Unicode space separators and only those. Every one of them folds one
 * character to one character, so the map below is untouched. The zero-width
 * characters are deliberately left alone: removing one would make this a fold
 * that *deletes*, and no French input method puts one between two words a rep
 * means to search for.
 */
export const fold = (text: string): string => foldRun(text)

/** The fold itself, applied to one piece of text. `fold` is this, whole. */
const foldRun = (part: string): string =>
  part
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')

/** The fold, plus where in the original every folded character came from. */
interface FoldedText {
  folded: string
  /** `source[i]` is the index in the original of `folded[i]`. Same length as `folded`. */
  source: number[]
}

/**
 * The fold, with a map back into the text it was cut from.
 *
 * **The excerpt is sliced from the original and the hit is found in the folded
 * copy, so the two index spaces have to be joined.** `fold` is length-preserving
 * for every French character in NFC form *except the ligatures it folds itself*:
 * `œ` → `oe` and `æ` → `ae` each add a character, and « mise en œuvre », « cœur
 * de métier » and « nœud » are ordinary ESN French. One of them anywhere earlier
 * in a surface shifted every index after it.
 *
 * Folding runs of ASCII whole and everything else one code point at a time is
 * what buys the map for almost nothing: ASCII is one character to one character
 * at every step above — `A`→`a`, the backtick → `'`, the rest untouched — so a
 * run of it is its own map, and French text is overwhelmingly such runs.
 *
 * Folding piecewise is not identical to folding whole in exactly one case:
 * lowercasing is context-sensitive for Greek (`ΑΣ` folds to `ας` whole and to
 * `ασ` here). No French word is affected, and `matchesFor` folds the needle with
 * *this* function so the two sides of a comparison can never disagree.
 */
const foldMapped = (text: string): FoldedText => {
  let folded = ''
  const source: number[] = []
  let index = 0
  while (index < text.length) {
    let end = index
    while (end < text.length && text.charCodeAt(end) < 0x80) end += 1
    if (end > index) {
      const run = foldRun(text.slice(index, end))
      for (let k = 0; k < run.length; k += 1) source.push(index + k)
      folded += run
      index = end
      continue
    }
    // One code point, not one unit: a surrogate pair folds as a character.
    const char = String.fromCodePoint(text.codePointAt(index) as number)
    const out = foldRun(char)
    for (let k = 0; k < out.length; k += 1) source.push(index)
    folded += out
    index += char.length
  }
  return { folded, source }
}

/** The five surfaces of one call, as text. Built by the caller from the log. */
export interface SearchableRecord {
  /** The objet and the client name — what a rep types first. */
  meeting: string
  /**
   * **The rep's own marks, and the one thing they can type from inside the call.**
   *
   * `core/contracts/marks.ts` is written one-handed over a client's face and
   * capped at 280 characters, the widget draws it and *Historique*'s reader
   * draws it — and no search reached it, so « prix : ils bloquent à 550 » was in
   * the record and could not be found by typing `550`. A mark is the product's
   * answer to « a rep who is talking is not looking for a button »; it was
   * write-only.
   *
   * Only the note is text. A mark made with no note carries no words and
   * contributes none — it is a moment, and a moment is not searchable prose.
   */
  marks: string
  transcript: string
  notes: string
  compteRendu: string
}

/**
 * The order excerpts are reported in, and `meeting` leads it deliberately.
 *
 * A hit on the call's own name is the strongest answer to « which call was
 * that »; a hit in four hundred lines of transcript is the weakest. The row
 * shows one excerpt per surface, so the order is what a rep reads first.
 */
const WHERE_ORDER: readonly HistoryMatchWhere[] = [
  'meeting',
  // Second, and above the rep's own notes for the same reason `meeting` leads:
  // a mark is one sentence the rep chose to type *while the client was talking*,
  // so it is the least ambiguous thing in the record after the call's own name.
  'marks',
  'transcript',
  'notes',
  'compteRendu',
]

/**
 * One excerpt per surface that matched, in a fixed order.
 *
 * One per surface rather than one per hit: a query like `de` occurs four
 * hundred times in a transcript, and four hundred excerpts is a payload, not an
 * answer. The row exists to say *this call mentions it, here is where* — the
 * expanded record is where somebody reads the rest.
 */
export const matchesFor = (record: SearchableRecord, query: string): HistoryMatch[] => {
  // `foldMapped` and not `fold`: the haystack is folded by the first and the two
  // sides of a comparison have to be folded by the same function (see its
  // docblock — the piecewise fold differs from the whole one for Greek).
  const needle = foldMapped(query.trim()).folded
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
 * **A folded index is not an index into the text**, so it is mapped back before
 * anything is sliced. This used to bail out instead: when the fold changed
 * length the excerpt fell back to the first eighty characters of the surface,
 * which is still true and is **not an excerpt** — the row exists to say *which
 * surface matched and where*, and that rendering silently stopped doing the
 * second half. The justification named `ﬁ` as the character that changes
 * length, and `ﬁ` does not: its decomposition is a *compatibility* one, so the
 * `NFD` above leaves it alone and `fold('ﬁ')` is one character. The two that do
 * are the two this fold writes itself — `œ` → `oe` and `æ` → `ae` — and « mise
 * en œuvre », « cœur de métier » and « nœud » are ordinary ESN French. So one
 * « œ » anywhere in a transcript destroyed every excerpt on the surface, and a
 * search for `TJM` answered with the opening of the call.
 *
 * The right reason matters more than the guard did: the wrong one is what the
 * next edit reads.
 */
const excerptFor = (text: string, needle: string): string | null => {
  const { folded, source } = foldMapped(text)
  const at = folded.indexOf(needle)
  if (at < 0) return null

  const from = source[at] ?? 0
  // The raw index just past the hit. `source[…]` of the character *after* it when
  // there is one, and never before the end of the last character consumed — a
  // needle that matched only the `o` of a folded `œ` shares one raw index with
  // the `e`, and an empty window would drop the hit it is built around.
  const last = source[at + needle.length - 1] ?? from
  const after = source[at + needle.length] ?? text.length
  const to = Math.max(after, last + 1)

  // `CONTEXT` is counted in UTF-16 units, and a slice is taken in them, so a
  // window boundary can land *between the halves of one character* — an emoji
  // in a rep's note, a rare CJK ideograph in a client's name. What ships then is
  // a lone surrogate, which no font can draw: the row's evidence opens on `<?>`.
  // Both edges are nudged outward onto a code-point boundary, which keeps the
  // whole character rather than dropping half of it. Guarded on the *matching*
  // half, so a text that already holds an unpaired surrogate is left as it is
  // rather than silently shifted by one.
  const start = onCodePointBoundary(text, Math.max(0, from - CONTEXT))
  const end = onCodePointBoundary(text, Math.min(text.length, to + CONTEXT))
  return ellipsise(text.slice(start, end), start > 0, end < text.length)
}

/** The same index, moved back by one when it would cut a surrogate pair. */
const onCodePointBoundary = (text: string, index: number): number => {
  if (index <= 0 || index >= text.length) return index
  const low = text.charCodeAt(index)
  const high = text.charCodeAt(index - 1)
  const splits = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
  return splits ? index - 1 : index
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

/*
 * Re-exported, not redefined. It moved to `core/contracts/meeting.ts` when the
 * renderer turned out to need it too — `src/*` may import `contracts` and
 * nothing else, so three screens had each written their own version of this
 * question and the three answers disagreed. Callers here keep the name.
 */
export { meetingAnchor } from '../contracts/meeting.ts'
import { meetingAnchor } from '../contracts/meeting.ts'

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
