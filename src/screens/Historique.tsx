/**
 * *Historique* — every call ever captured, searchable (DEC-25).
 *
 *   ┌ Historique ──────────────── ⌕ « TJM » ─────────────────┐
 *   │ 12 mars   Acme SA     Validée   tâche · opportunité · mail │
 *   │ 08 mars   Nordis         Validée   tâche · mail        │
 *   │ 05 mars   Groupe Lefort  À valider ⚠ VSA indisponible  │
 *   │  └ Transcript · Mes notes · Compte-rendu · Extraction  │
 *   └────────────────────────────────────────────────────────┘
 *
 * Four things this screen is, and one it is not:
 *
 * **It is not in the navigation.** It is the expanded form of the calendar's
 * search (VISION.md §6), reached from it and from nowhere else — with the same
 * field and the same chips carried over, which is why the back link reads
 * *‹ Calendrier* and why `query` and `filter` arrive as props. A rep looking for
 * what a client said in March starts by typing the client's name on the home
 * screen, which is where they already are.
 *
 * **It is a reader over the event log.** There is no history table. Every row
 * and every section below is folded from `events` on demand by the main
 * process, which is why a call captured before a field existed still opens.
 *
 * **The search runs in the main process.** This component sends a string and
 * four chip values and receives rows with short excerpts; it never holds a
 * transcript it did not expand, and it never narrows a list it already has.
 * That is not an optimisation — shipping the corpus here so a filter could run
 * over it would put every client conversation in a devtools console.
 *
 * **Nothing here writes, and a failed push is not an exception to that.**
 * The one gesture in the product that reaches an external system is *Valider*,
 * on the review gate, once (DEC-4). It is tempting to put a *Réessayer* on a
 * row that says « 1 envoi en échec » — and it would be the wrong button.
 * `Outbox` retries everything it *can* retry on its own: an adapter that knows
 * nothing was created answers `{ ok: false, retryable: true }` and the row stays
 * `pending` for the next drain. A row reaches `failed` in exactly the opposite
 * case — the attempt threw, so nobody knows whether VerySwing created the record,
 * and `POST /v1/crm/tasks` carries no idempotency key. A retry button there is a
 * duplicate in the client's CRM one click away.
 *
 * What the rep was missing is not a button, it is the sentence. The failure used
 * to be an orange count on a collapsed row with its cause two clicks below it,
 * so the screen said *something went wrong* and made the rep go digging for
 * *what*. `PushFailure` now puts the cause, and the one thing worth doing about
 * it, on the row itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HistoryFilter,
  HistoryIntent,
  HistoryRecord,
  HistoryRow,
  HistorySearchResult,
} from '../../electron/core/contracts/history.ts'
import type { ReviewField } from '../../electron/core/contracts/review.ts'
import { speakerLabel, type TranscriptSegment } from '../../electron/core/contracts/transcript.ts'
import { invoke } from '../app/bridge.ts'
import { cn } from '../lib/utils.ts'
import { scrollToCenter, scrollToTop } from '../lib/scroll.ts'
import { AskPanel } from './session/AskPanel.tsx'
import { useShortcuts } from '../app/shortcuts.ts'
import { useUpdateReady } from '../app/update.ts'
import type { SectionId } from './Reglages.tsx'
import { meetingAnchor } from '../../electron/core/contracts/meeting.ts'
import { formatDayShort, formatOffset, formatTime, meetingHeading } from '../app/format.ts'
import { interleaveMarks, type MomentMark } from '../../electron/core/contracts/marks.ts'
import {
  Button,
  CopyButton,
  EmptyState,
  Rail,
  ReadingColumn,
  Row as UiRow,
  RowTitle,
  SectionHeader,
  type ReadingSubject,
} from '../ui/index.ts'
import {
  INTENTION_LABEL,
  NO_FILTER,
  PERIODE_LABEL,
  STATUT_LABEL,
  isSearchActive,
} from './search/filters.ts'
import { IntentSummary } from './search/Intents.tsx'
import { CompteRenduDocument } from './session/CompteRenduDocument.tsx'
import { Matches } from './search/Matches.tsx'
import { SearchBar } from './search/SearchBar.tsx'
import { useHistorySearch } from './search/useHistorySearch.ts'

/** The full record, so the cap is the corpus and not a viewport. */
const SEARCH_LIMIT = 50

/**
 * The page's title: how many calls are listed under it, and what narrows them.
 *
 * *Historique* has no « what changed » — it is a search field, a chip row and a
 * list of past calls, and every one of those names itself. So the h1 carries the
 * one thing on the screen that is information rather than furniture, and it is
 * recomputed on every answer.
 *
 * Four things it must never get wrong, and the fourth is a defect this repo has
 * already shipped:
 *
 *  - **Zero is a count.** « Aucun appel » beside the active chips is what tells a
 *    rep that « 7 jours » is the reason the list is empty, which is more than the
 *    empty state under it can say.
 *  - **One is singular.** « 1 appels » on the only row that matched is the app
 *    failing to read its own answer.
 *  - **The count describes the rows, so it comes from the answer.** `result.filter`
 *    and never the live chips: `useHistorySearch` debounces, so for 200 ms the
 *    state says one thing and the list under the title shows another. The
 *    truncation sentence at the foot of the list reads the answer for exactly this
 *    reason.
 *  - **It never claims fifty.** `history:search` stops at `SEARCH_LIMIT` and the
 *    handler reports `capped` — it collected one row *past* the limit and dropped
 *    it, so what is known is « more than fifty », never how many. « 50 appels »
 *    over a corpus of eight hundred is the silent ceiling this screen has already
 *    been caught on once, under a preview promising « l’historique les porte
 *    tous » (DEC-25), and the sentence at the foot of the list says so too — with
 *    the corpus it is fifty of.
 *
 * The query is deliberately **not** in it. It is in the box three rows below,
 * where the rep typed it; restating it in 28 px serif is the one thing this round
 * is about. What the query does to this title is change the number.
 */
const listTitle = (result: HistorySearchResult, capped: boolean): string =>
  [countPhrase(result.rows.length, capped), ...scopePhrases(result.filter)].join(' · ')

const countPhrase = (shown: number, capped: boolean): string => {
  if (capped) return `Plus de ${SEARCH_LIMIT} appels`
  if (shown === 0) return 'Aucun appel'
  return shown === 1 ? '1 appel' : `${shown} appels`
}

/**
 * The chips that are on, in the chip row's own words.
 *
 * The labels come from `filters.ts` rather than being written again here: a chip
 * reading « 90 jours » and a title reading « 3 derniers mois » would be two names
 * for one filter, one line apart.
 */
const scopePhrases = (filter: HistoryFilter): string[] =>
  [
    filter.client,
    // The neutral value is compared as a literal and not as `NO_FILTER.periode`,
    // which is typed as the whole axis and therefore narrows nothing. The three
    // label tables are `Record<Exclude<Axis, neutral>, string>`, so renaming a
    // neutral value in `core/contracts/history.ts` makes each of these three
    // comparisons a compile error rather than a silent extra word in the title.
    filter.periode === 'toute' ? null : PERIODE_LABEL[filter.periode],
    filter.statut === 'tous' ? null : STATUT_LABEL[filter.statut],
    filter.intention === 'toutes' ? null : INTENTION_LABEL[filter.intention],
  ].filter((label): label is string => label !== null)

interface HistoriqueProps {
  onBack: () => void
  /**
   * Opens Réglages, on a named pane when the caller knows which one.
   *
   * The rail is on this screen too, so the two rows that are not destinations —
   * *Réglages* and « Mise à jour prête » — are reachable from here as well.
   * Passed in rather than routed here: this screen is a reader and owns no route.
   */
  onReglages: (section?: SectionId) => void
  /** What the rep typed on the calendar. Empty when they opened it with an empty box. */
  query?: string
  filter?: HistoryFilter
}

export function Historique({
  onBack,
  onReglages,
  query: initialQuery = '',
  filter: initialFilter = NO_FILTER,
}: HistoriqueProps) {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter)
  const [expanded, setExpanded] = useState<string | null>(null)
  const updateReady = useUpdateReady()

  const search = useHistorySearch(query, filter, SEARCH_LIMIT)
  const rows: readonly HistoryRow[] | null = search.result?.rows ?? null

  /*
   * `Ctrl/⌘ K` puts the cursor in the field — the one shortcut that needs a
   * control this screen owns. `Échap` is installed once, in `App.tsx`, for
   * every screen: two handlers on one key would both fire.
   */
  const searchRef = useRef<HTMLInputElement>(null)
  useShortcuts({ rechercher: () => searchRef.current?.focus() })

  const toggle = useCallback((meetingId: string) => {
    setExpanded((previous) => (previous === meetingId ? null : meetingId))
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/*
        The same rail as the calendar's, on the same three destinations (V2).

        *À valider* and *Historique* are both **this** screen: one is the chip
        the calendar's *En attente de validation* links to and the other is the
        same reader with nothing on. So the rail sets the filter rather than
        navigating, which is what makes the current item honest — the two places
        the rep can be here are two states of one question (DEC-25), and a rail
        that "navigated" to the screen it is already on would be a control that
        does nothing.
      */}
      <Rail
        current={filter.statut === 'a-valider' ? 'a-valider' : 'historique'}
        pending={null}
        updateReady={updateReady}
        onPlace={(place) => {
          if (place === 'aujourdhui') onBack()
          else if (place === 'a-valider') setFilter({ ...NO_FILTER, statut: 'a-valider' })
          else setFilter(NO_FILTER)
        }}
        onReglages={() => onReglages()}
        onUpdate={() => onReglages('maj')}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="px-gutter pb-4 pt-7">
        <div className="flex items-baseline gap-4">
          <Button variant="nav" onClick={onBack}>
            ‹ Calendrier
          </Button>
          {/*
            **The title is the count, not the noun.**

            It read « Historique » — serif, the largest thing on the screen, over
            a search field, a chip row and a list of past calls. Nothing on that
            screen could be mistaken for anything else, so the strongest ink was
            spent on the one string that never changes, while the one number a rep
            cannot get anywhere else — how many calls the list under it actually
            holds — was nowhere at all.

            A non-breaking space while the first answer is in flight, and never a
            word: the h1 is 28 px with `leading-none`, an *empty* one generates no
            line box at all and an ordinary space collapses to nothing, so the search
            field under it would jump by the height of a title when the count lands,
            200 ms of debounce later. « Chargement… » is already said once, inside
            the list, and saying a thing twice is the defect this round is about.
          */}
          <h1 className="font-display text-strong flex-1 text-display leading-none">
            {search.result ? listTitle(search.result, search.capped) : '\u00A0'}
          </h1>
        </div>

        {/*
          The same component the calendar carries, on the same state (VISION.md
          §6). Two implementations would drift, and the day they did, the
          expanded form would answer a different question from the one the rep
          typed on the screen they came from.
        */}
        <SearchBar
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          clients={search.result?.clients ?? []}
          inputRef={searchRef}
          /*
            **Two axes, not four** (V2). *Période* and *Statut* are the reader's
            own questions — how far back, and what state the call is in. The two
            data axes are the calendar's: see `SearchBarProps.dataAxes`.
          */
          dataAxes={false}
          className="mt-4"
        />
      </header>

      {search.failure ? (
        <p role="alert" className="text-danger border-subtle border-b px-gutter py-1.5 text-ui">
          {search.failure}
        </p>
      ) : null}

      {/*
        `<main>`, and it is not only a label.

        This screen had no landmark at all, so a screen reader's region list
        offered nothing for the one surface DEC-25 exists for — and
        `shot.mjs --scrollers` scoped itself to `main *, aside *, dialog *`,
        so the check that measures « content cut off with nothing saying so »
        visited **zero elements here** and reported green over four panes, one of
        which hid 95% of a fifty-minute transcript. The check is scoped to the
        tree now; the landmark is owed regardless.
      */}
      <main className="min-h-0 flex-1 overflow-y-auto px-gutter pb-block">
        {rows === null ? (
          <p className="text-muted text-copy">Chargement…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            hint={
              isSearchActive(query, filter)
                ? 'La recherche porte sur les clients, les sujets, les transcriptions, vos notes, vos moments marqués et les comptes-rendus.'
                : undefined
            }
          >
            {isSearchActive(query, filter)
              ? 'Aucun appel ne correspond.'
              : 'Aucun appel enregistré.'}
          </EmptyState>
        ) : (
          /*
            **Each call is a card of its own** (V2). A divided list said these
            rows were one block to be read down; they are not — they are the
            record, and what a rep does here is pick one and open it. The
            rectangle is the queue row's: an edge stroke, `rounded-sm`, 16px by
            10px. It is also what makes an *expanded* row legible: a record six
            hundred pixels tall inside a hairline-divided list reads as the list
            having come apart.
          */
          <ul aria-label="Appels enregistrés" className="flex flex-col gap-2">
            {rows.map((row) => (
              <Row
                key={row.meeting.id}
                row={row}
                expanded={expanded === row.meeting.id}
                onToggle={() => toggle(row.meeting.id)}
              />
            ))}
          </ul>
        )}
        {/*
          **The cap, said out loud.**

          `SEARCH_LIMIT` is fifty and the loop in `history:search` simply breaks
          — while the eight-row preview a rep arrives *from* draws « Les premiers
          résultats — l'historique les porte tous. » An ESN rep passes fifty
          calls matching « TJM » inside a year, and from that point the screen
          that was just promised to carry all of them silently carried fifty.

          A sentence rather than paging: what a rep does next is narrow the
          search, and the chips to do it are three rows above. Telling them the
          list is truncated is what makes that a choice rather than a wrong
          belief.

          **And it says what was searched**, which is `scanned` — a field the
          channel has shipped on every answer since it existed and no screen has
          ever read. That mattered while the scan itself stopped at five hundred
          meetings: the sentence promised fifty *of the corpus* and the corpus was
          being cut short two fields away, with the only number that could have
          said so travelling unread. The scan reads everything now and this draws
          the count, so « les cinquante plus récents » has something to be fifty
          of. `capped` implies more than `SEARCH_LIMIT` matches, so the plural
          here is never wrong.

          **And it is two sentences, because `capped` is set for the listing
          too.** With an empty box and sixty calls in the store the screen drew
          « Les 50 appels les plus récents *qui correspondent* … *affinez la
          recherche* » over an **empty** search field: a remedy naming a control
          the rep has not used, on an answer that matched nothing because nothing
          was asked. DEC-26's rule about a dead control is about buttons; a
          sentence that names an action which is not available is the same
          failure in prose. So the listing says what it is a list *of* and points
          at the box beside it, which is a thing the rep can actually do next,
          and the search keeps the sentence it earned.

          The discriminator is the **answer's own** echoed question and not the
          live box: `useHistorySearch` drops stale replies, so the two agree, and
          reading the answer is what keeps the sentence describing the rows under
          it rather than a keystroke that has not been asked yet.
        */}
        {search.capped && search.result ? (
          <p className="text-muted mt-block measure text-meta">
            {isSearchActive(search.result.query, search.result.filter)
              ? `Les ${SEARCH_LIMIT} appels les plus récents qui correspondent, sur ${search.result.scanned} appels parcourus. Affinez la recherche pour en voir d’autres.`
              : `Les ${SEARCH_LIMIT} appels les plus récents, sur ${search.result.scanned} appels enregistrés. Cherchez un client, un sujet ou un mot prononcé pour retrouver les autres.`}
          </p>
        ) : null}
      </main>
      </div>
    </div>
  )
}

interface RowProps {
  row: HistoryRow
  expanded: boolean
  onToggle: () => void
}

function Row({ row, expanded, onToggle }: RowProps) {
  const { meeting } = row
  const self = useRef<HTMLLIElement>(null)

  /*
   * **Opening a row brings the row to the top, deliberately.**
   *
   * Left to the browser, clicking a row near the bottom of the list scrolled it
   * the *minimum* distance needed to fit the record that had just appeared under
   * it — which put the row's own heading half-off the top edge of the scroller
   * and left « Mes notes » orphaned below a sliced title. The rep opened a call
   * and the first thing they could no longer read was which call it was.
   *
   * `scroll-mt-2` on the `li` keeps a hair of space above the title so it lands
   * as a whole row rather than flush against the cut, and `block: 'start'`
   * honours it.
   *
   * **And again when the record lands.** The record is fetched, so the row that
   * is scrolled on the click is the collapsed one — a hundred pixels tall — and
   * it grows by six hundred a moment later, while a smooth scroll is still
   * running. Chromium settles the animation against the layout it started with,
   * so the last row in the list opened *below the window's bottom edge*: the rep
   * pressed a call and the four sections DEC-25 promises were off screen with
   * nothing to say they had appeared. Scrolling once more on arrival costs
   * nothing when the row was already at the top.
   */
  const settle = useCallback(() => scrollToTop(self.current), [])
  useEffect(() => {
    if (expanded) scrollToTop(self.current)
  }, [expanded])

  return (
    <li ref={self} className="bg-card border-card scroll-mt-2 overflow-hidden rounded-sm border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="hover:bg-card-soft w-full text-left transition"
      >
        <UiRow as="div" density="card" align="center" className="bg-transparent">
          <RowTitle {...meetingHeading(meeting)} />
          <span className="text-muted w-20 shrink-0 text-right text-ui">{row.status}</span>
          {/*
                A count, not the ledger. Three named intents ran past the row
                at 1280 and « mail en échec » was cut against the edge — which
                is the one state a rep is scanning for. The ledger, with each
                intent, its state, its VerySwing id and its failure sentence, is
                « Envois » in the expanded record two clicks below.
              */}
              <IntentSummary intents={row.intents} variant="compact" className="w-48 truncate" />
          {/*
            The date, at the trailing edge (V2). In a schedule the clock is the
            index and leads; in a record of calls that have already happened it
            is a detail of the card, and the card is led by the client's name —
            which is what a rep is scanning for here.
          */}
          <span className="text-muted shrink-0 text-right tabular-nums text-ui">
            {formatDayShort(meetingAnchor(meeting))}
          </span>
        </UiRow>
      </button>

      <Matches matches={row.matches} className="px-5 pb-2.5" />
      <PushFailure intents={row.intents} />

      {expanded ? <Record meetingId={meeting.id} intents={row.intents} onReady={settle} /> : null}
    </li>
  )
}

/**
 * An adapter's failure sentence, closed off so the next sentence can start.
 *
 * These come from `VsaCrm` and `OutlookMail` and are written as fragments —
 * « jeton Microsoft expiré — reconnexion nécessaire », « la sandbox VSA n'a pas
 * répondu en 10 s ». They are never rewritten (a paraphrase is one more thing
 * that can disagree with the log); they are punctuated.
 */
const sentence = (reason: string | null): string => {
  const trimmed = reason?.trim() ?? ''
  if (trimmed === '') return 'Cause non enregistrée.'
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/** Which application a rep has to open to find out what really happened. */
const WHERE_TO_LOOK: Record<HistoryIntent['kind'], string> = {
  'crm.task': 'VerySwing',
  'crm.opportunity': 'VerySwing',
  'mail.draft': 'Outlook',
}

/**
 * The cause of a failed push, on the collapsed row.
 *
 * « 1 envoi en échec » in orange, and nothing else, is a screen telling a rep
 * that their compte-rendu may or may not be in the client's CRM and declining to
 * say which — the row has the sentence, it was simply two clicks away in
 * « Envois ». Réglages gives a broken *connector* a *Réessayer*; the row where
 * the write actually failed gave nothing at all.
 *
 * There is still no button here and that is deliberate — see the note at the top
 * of the file: `failed` is precisely the state where nobody knows whether the
 * record was created, so the useful instruction is to look in VerySwing, not to
 * press something. Saying so is the fix. A `pending` intent needs none of this:
 * it is a queue that has not drained yet and it drains itself.
 */
function PushFailure({ intents }: { intents: readonly HistoryIntent[] }) {
  const failed = intents.filter((intent) => intent.state === 'failed')
  if (failed.length === 0) return null

  return (
    <div className="px-5 pb-2.5">
      {failed.map((intent) => (
        <p key={intent.intentId} className="text-ui">
          <span className="text-warn">{intent.label} — échec.</span>{' '}
          {/* The adapter's own sentence. Never a rewrite of it: what a rep
              reads here is what the CRM said, and a paraphrase would be one
              more thing that can disagree with the log. */}
          {/*
            The adapter's sentence, then ours, with a separator between them.

            They were joined by a bare space, and the adapter's sentence does not
            end in a full stop — so the row read « …reconnexion nécessaire À
            vérifier dans Outlook avant de refaire l'envoi. », a capital À
            colliding with a lowercase word and the boundary between two
            different voices swallowed. The em dash is the one this app already
            uses to join a clause to its consequence.
          */}
          <span className="text-muted">{sentence(intent.lastError)}</span>{' '}
          {/*
            Named by the system that was actually being written to. « À vérifier
            dans VerySwing » under a failed *Outlook* draft sends the rep to the
            wrong application, and the kind is right there on the intent.
          */}
          <span className="text-muted">{`À vérifier dans ${WHERE_TO_LOOK[intent.kind]} avant de refaire l’envoi.`}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * The expanded record: the four sections of DEC-25, in order.
 *
 * Fetched when the row opens rather than with the list. A transcript is the
 * biggest thing in the product and fifty of them would arrive with every
 * search — which is the same mistake as filtering in the renderer, made one
 * layer later.
 */
function Record({
  meetingId,
  intents,
  onReady,
}: {
  meetingId: string
  intents: readonly HistoryIntent[]
  /** Told once the row has its real height, so the caller can settle the scroll. */
  onReady: () => void
}) {
  const [record, setRecord] = useState<HistoryRecord | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  /** The quote *Demander* was last asked to show, lit in the transcription. */
  const [located, setLocated] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    invoke('history:record', { meetingId })
      .then((value) => {
        if (live) setRecord(value)
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : 'lecture impossible')
      })
    return () => {
      live = false
    }
  }, [meetingId])

  /*
   * After paint, not in the `then`: the row is still the old height until React
   * has committed this render, and scrolling to a box that no longer exists is
   * how the first attempt at this landed on the wrong row.
   */
  useEffect(() => {
    if (record || failure) onReady()
  }, [record, failure, onReady])

  if (failure) {
    return (
      <p role="alert" className="text-danger px-5 pb-4 text-ui">
        {failure}
      </p>
    )
  }
  if (!record) return <p className="text-muted px-5 pb-4 text-ui">Chargement…</p>

  return (
    <div className="bg-inner border-subtle grid grid-cols-2 gap-6 border-t px-5 py-4">
      {/*
        **No « TRANSCRIPTION » over it.** A transcript names itself: every row is
        an offset, a side and a sentence, and nothing else on this record looks
        remotely like that. The label was not wrong, it was the app reading its own
        layout out loud.

        The word survives where it is doing work and *only* there — on the search
        excerpt under a collapsed row, where five one-line fragments of identical
        shape (« Intitulé », « Moments marqués », « Transcription », « Mes notes »,
        « Compte-rendu ») have nothing but that first column to say which surface
        the query hit.
      */}
      {/* One grid cell holding the record and the question about it, so the
          panel sits *under* the section's capped scroller rather than inside
          it — an answer clipped at 288px is an answer nobody can read. */}
      <div className="min-w-0">
      <Section
        subject={{ determiner: 'la', noun: 'transcription' }}
        copy={
          record.segments.length > 0
            ? {
                text: transcriptText(record.segments, record.interlocuteurs),
                what: 'la transcription',
              }
            : undefined
        }
      >
        <Transcript
          segments={record.segments}
          marks={record.marks}
          quote={located}
          interlocuteurs={record.interlocuteurs}
        />

      </Section>

      {/*
        **This is the screen *Demander* was written for, and this is the
        column.**

        Its own docblock opens on « a rep three weeks later remembers that the
        client said something about the grille achats and cannot remember
        what ». Three weeks later they are here — this is the product's only
        entry into the past (DEC-25).

        It sat at the foot of the record, which measured **1503 of a 1604-pixel
        scroller**: ninety-four per cent down, two and a half screenfuls past
        the fold, on a screen whose own screenshot did not contain it. Under
        the transcription instead, because that is what its citations point at:
        press a quote and the turn it came from lights forty pixels above,
        without the rep leaving the box they are reading.

        It writes nothing and confirms nothing, which is what lets it live on a
        reader at all (DEC-4, DEC-25).
      */}
      <AskPanel
        meetingId={meetingId}
        onLocate={(quote) => setLocated(quote)}
        interlocuteurs={record.interlocuteurs}
        className="border-subtle mt-3 border-t pt-3"
      />
      </div>

      <Section title="Mes notes" subject={{ determiner: 'vos', noun: 'notes' }}>
        {record.notes.trim() ? (
          <p className="text-strong whitespace-pre-wrap text-copy leading-relaxed">{record.notes}</p>
        ) : (
          <p className="text-muted text-ui">Rien n’a été saisi pendant cet appel.</p>
        )}
      </Section>

      {/*
        **No « COMPTE-RENDU » over it either.** The document's own first line is
        `# <objet>` — `CompteRenduDocument` hangs the marker in the gutter and sets
        the objet as a title — so the caption was a heading above a heading, and the
        smaller of the two was the app's.
      */}
      <Section
        subject={{ determiner: 'le', noun: 'compte-rendu' }}
        copy={record.compteRendu ? { text: record.compteRendu, what: 'le compte-rendu' } : undefined}
      >
        {record.compteRendu ? (
          /*
            Typeset by `CompteRenduDocument`, with every marker still in the
            gutter — the same reading the session pane and the review gate give
            it, so a rep looking a call up three weeks later sees the document
            they validated rather than its source.

            It was `font-mono` at 11px, which read as a log dump of something
            the machine had produced. That was never the point of DEC-5's
            provenance rule: the *ink* carries the authorship, not the face.
          */
          /*
            The same affordance the gate gives it, and here the record is in the
            box above: pressing a quotation lights the turn it came from.

            **And no typesetting manual under it.** « Les marques # ## – ∗∗ font
            partie du texte : VerySwing reçoit exactement ce qui est affiché » is a
            real promise and it is owed **once**, at the moment the rep can act on
            it — the gate, where the document is editable and where the press that
            writes it into VerySwing lives. This screen is as read-only as a surface
            gets: nothing here can be corrected and nothing here ships anywhere, so
            the sentence was the app explaining its own rendering to somebody who
            cannot use the explanation.
          */
          <CompteRenduDocument text={record.compteRendu} onQuote={(quote) => setLocated(quote)} />
        ) : (
          <p className="text-muted text-ui">Cet appel n’a pas produit de compte-rendu.</p>
        )}
      </Section>

      <Section title="Extraction" subject={{ determiner: 'l’', noun: 'extraction' }}>
        <Extraction fields={record.fields} />
        <PushStatus intents={intents} />
      </Section>

    </div>
  )
}

function Section({
  title,
  subject,
  copy,
  children,
}: {
  /**
   * The caption, **only where the content cannot name itself**.
   *
   * Two of the four panes have none. A transcript is offsets, sides and
   * sentences; a compte-rendu opens on its own `# <objet>`. « Mes notes » and
   * « Extraction » keep theirs, and they are the reason this is optional rather
   * than gone: they sit side by side, they are both plain French prose, and
   * nothing about either box says which is the rep's own typing and which is what
   * the model read off the call.
   */
  title?: string
  /**
   * What « Copier » puts on the clipboard for this section, if anything.
   *
   * Historique is a reader (DEC-25) and this does not change that: taking a
   * copy of what is already on screen writes nothing, sends nothing and pushes
   * nothing. It is the one gesture a rep needs from an archive — the compte-rendu
   * of a call three weeks ago, pasted into a proposal — and the screen had it
   * behind « select the text in a 288px scroller without missing a line ».
   */
  copy?: { text: string; what: string }
  /**
   * What this pane holds, as a noun and its determiner — never as a label.
   *
   * The page turn reads it two ways (« Lire la suite **de la** transcription »,
   * « Remonter dans **la** transcription »), and while this was one string every
   * one of these four panes supplied the genitive and read « Remonter dans de la
   * transcription » at the end of the scroll. See `ui/readingSubject.ts`.
   */
  subject: ReadingSubject
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0">
      {/*
        The head row exists for whatever is in it, and it is **absent** when there
        is nothing: a captionless pane with no *Copier* draws no row at all rather
        than an empty 24-pixel band above its first line.

        A pane that keeps only the control gets no `mb-2` — the 8 px under a 10 px
        uppercase eyebrow is what stops it touching the prose, and a button sitting
        at the far right of the row, four hundred pixels from the first word, is not
        near anything to be held off.
      */}
      {title || copy ? (
        <div className={cn('flex items-center gap-inline', title ? 'mb-2' : null)}>
          {/*
            `h2`, and through the same component every other screen's section
            header goes through.

            It was a hand-written `<h3 className="pane-label">`: the right ink,
            the wrong level. The page's only other heading is the h1 — the calls
            themselves are buttons, not headings — so the panes of DEC-25 jumped
            h1 → h3, and a screen reader's heading list, which is how the record is
            navigated without a mouse, reported a level that nothing on the page
            defines.
          */}
          {title ? <SectionHeader className="mb-0 min-w-0 flex-1">{title}</SectionHeader> : null}
          {/*
            `ml-auto`, and not `flex-1` on a heading that may not be there: the
            control belongs at the end of the rule either way, and this is the
            lesson the gate reader's own *Copier la transcription* carries — it
            floated sixty pixels inside its own rule at 1280×800 the day the
            paragraph beside it stopped growing.
          */}
          {copy ? (
            <CopyButton
              text={copy.text}
              what={copy.what}
              className="ml-auto text-meta"
            />
          ) : null}
        </div>
      ) : null}
      {/*
        `.measure` — the product's one reading width, so a compte-rendu read
        three weeks later is set the way it was set at the gate — and
        `ReadingColumn`, which is the other half and was missing.

        It was a bare `max-h-72 overflow-y-auto`: 288 pixels, no mask, no page
        turn, on four panes. Measured through the product's own reader with a
        fifty-minute call in it:

            TranscriptionCopier  box 288  content 5436  hidden 95%
            Compte-renduCopier   box 288  content  345  hidden 17%
            fade-below on screen: 0     page-turn controls: 0

        Which is the defect `ReadingColumn`'s own header records as fixed for the
        session pane — « Same document, same product, one click apart, opposite
        treatment » — with *Historique*, the screen DEC-25 exists for, still on
        the wrong side of it. Two things hid it: `shot.mjs --scrollers` scopes
        itself to `main *, aside *, dialog *` and this screen had **no landmark
        at all**, so the check visited zero elements here and reported green; and
        `bridge-stub.mjs` answers `history:record` with six segments, so every
        screenshot ever taken showed a record that fits.
      */}
      <ReadingColumn subject={subject} className="measure max-h-72 pr-1">
        {children}
      </ReadingColumn>
    </section>
  )
}



/**
 * The transcript as plain text, for the clipboard.
 *
 * Same three columns the reader draws, tab-separated — a paste into a document
 * keeps them as columns and a paste into a chat still reads as a dialogue. It
 * is built from the same rows on screen and adds nothing to them.
 */
const transcriptText = (
  segments: readonly TranscriptSegment[],
  interlocuteurs: readonly { name: string; email: string }[],
): string =>
  segments
    .map(
      (segment) =>
        `${formatOffset(segment.startMs)}\t${speakerLabel(segment.channel, interlocuteurs)}\t${segment.text}`,
    )
    .join('\n')

function Transcript({
  segments,
  marks,
  quote,
  interlocuteurs,
}: {
  segments: readonly TranscriptSegment[]
  /**
   * The rep's own marks, made from the widget during the call
   * (`core/contracts/marks.ts`).
   *
   * The same helper as the gate's reader and the widget's live list, so one
   * call read on three screens puts a mark in the same place on all three —
   * which is the rule `speakerLabel` and `meetingAnchor` already follow, for
   * the reason they follow it: two screens disagreeing about one record is two
   * things for a rep to reconcile.
   */
  marks: readonly MomentMark[]
  /** From the calendar, so the far channel can be named when there is one of
   *  them (`speakerLabel`, DEC-7). */
  interlocuteurs: readonly { name: string; email: string }[]
  /**
   * A fragment *Demander* leaned on, to be shown in the record.
   *
   * Matched with the same fold `locateQuote` uses — accents dropped, case
   * folded, punctuation collapsed — because the answer's quote is the model's
   * transcription of what it read and the stored segment is the transcriber's,
   * and the two disagree on a comma often enough that an exact match would
   * light nothing on a citation that is perfectly real.
   */
  quote?: string | null
}) {
  const hit = useRef<HTMLLIElement>(null)
  const needle = quote ? foldQuote(quote) : null

  useEffect(() => {
    if (needle) scrollToCenter(hit.current)
  }, [needle])

  /*
   * **A call with no transcript still has the rep's marks in it.**
   *
   * This returned here on `segments.length === 0` and swallowed them, on the
   * meetings that need them most: a call whose far channel never opened, a
   * machine with no weights, a recording that failed — every one of those is a
   * call where the only record of what mattered is what the rep pressed during
   * it. The sentence is still said, because « no transcript » is a fact worth
   * stating, and the marks are drawn under it.
   */
  if (segments.length === 0 && marks.length === 0) {
    return <p className="text-muted text-ui">Aucune transcription pour cet appel.</p>
  }

  let marked = false
  return (
    <>
    {segments.length === 0 ? (
      <p className="text-muted mb-1.5 text-ui">
        Aucune transcription pour cet appel — seuls vos moments marqués sont ci-dessous.
      </p>
    ) : null}
    <ul className="space-y-1">
      {interleaveMarks(segments, marks).map((row) => {
        if (row.kind === 'mark') {
          return (
            <li key={row.key} className="flex gap-2 text-ui">
              <span className="text-brand-700 w-10 shrink-0 tabular-nums text-meta font-semibold">
                {formatTime(row.mark.at)}
              </span>
              <span className="text-brand-700 w-12 shrink-0 text-meta font-semibold">marqué</span>
              <span className="text-strong measure border-brand-500 min-w-0 flex-1 border-l-2 pl-2">
                {row.mark.note === '' ? 'Marqué pendant l’appel.' : row.mark.note}
              </span>
            </li>
          )
        }
        const segment = row.segment
        // The first segment that contains it, and only the first: a phrase said
        // twice would otherwise light the whole column and point at nothing.
        const isHit = needle !== null && !marked && foldQuote(segment.text).includes(needle)
        if (isHit) marked = true
        return (
          <li
            key={row.key}
            ref={isHit ? hit : undefined}
            className={`flex gap-2 rounded-sm text-ui ${isHit ? 'bg-brand-50 -mx-1 px-1 py-0.5' : ''}`}
          >
            <span className="text-muted w-10 shrink-0 tabular-nums text-meta">
              {formatOffset(segment.startMs)}
            </span>
            <span className="text-muted w-12 shrink-0 text-meta">
              {speakerLabel(segment.channel, interlocuteurs)}
            </span>
            {/*
              `.measure` because this is prose and the column is wide: at `text-ui` in
              the 599px pane a turn drew **97 characters a line**, which is the number
              the class exists to end — and no stage could see it until the fixture's
              transcript lasted as long as its call, because five short turns either fit
              in one line under the ceiling or wrapped into two well under it.
            */}
            <span className="text-body measure min-w-0 flex-1">{segment.text}</span>
          </li>
        )
      })}
    </ul>
    </>
  )
}

/**
 * The comparison `locateQuote` makes, in the renderer.
 *
 * Not imported from `core/domain/` — `src/*` may import `core/contracts/` and
 * nothing else — and deliberately not *exactly* that function either: this one
 * only has to light a row, where that one decides whether a citation is
 * verified at all. Being a shade looser here costs a highlight in the wrong
 * place at worst; being looser there would call an invented quote verified.
 */
const foldQuote = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Each field with the span it was read from (DEC-21).
 *
 * A span whose `startMs` is null is one the app could not locate in the stored
 * transcript, and it wears `⚠ faible` for exactly that reason. Showing the
 * quote anyway is deliberate: "the model said this and we could not find it" is
 * the most useful thing this screen can tell somebody months later.
 */
function Extraction({ fields }: { fields: readonly ReviewField[] }) {
  if (fields.length === 0) {
    return <p className="text-muted text-ui">Aucune extraction pour cet appel.</p>
  }

  return (
    <dl className="space-y-1.5">
      {fields.map((field) => (
        <div key={field.key}>
          <dt className="text-muted flex items-baseline gap-2 text-meta">
            {field.label}
            {/* `font-semibold`, the same weight the rail and the document give
                it: `--warn` and `--text-muted` differ by 0.001 in relative
                luminance, so colour alone carries nothing in greyscale, through
                a projector, or to a deuteranope — and this row sits beside
                « vérifié · 1:58 » at the same size. The reader was the one
                surface the weight fix missed. */}
            {field.confidence === 'faible' ? (
              <span className="text-warn font-semibold">⚠ faible</span>
            ) : null}
          </dt>
          <dd className="text-body measure text-ui italic">
            {field.span
              ? `« ${field.span.quote} »${
                  field.span.startMs === null
                    ? ' — introuvable dans la transcription'
                    : ` — ${formatOffset(field.span.startMs)}`
                }`
              : 'Du calendrier Outlook et de VerySwing — jamais lu sur la transcription.'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** What became of each intent, with the failure sentence when there was one. */
function PushStatus({ intents }: { intents: readonly HistoryIntent[] }) {
  if (intents.length === 0) return null

  return (
    <div className="mt-4">
      <h3 className="pane-label mb-2">Envois</h3>
      <ul className="space-y-1">
        {intents.map((intent) => (
          <li key={intent.intentId} className="text-ui">
            <span className="text-body">{intent.label}</span>{' '}
            <span className={intent.state === 'failed' ? 'text-warn' : 'text-muted'}>
              {PUSH_LABEL[intent.state]}
            </span>
            {intent.remoteId ? <span className="text-muted"> · {intent.remoteId}</span> : null}
            {/* A failed row without its reason is the dead control DEC-26 forbids. */}
            {intent.lastError ? (
              <span className="text-muted block">{intent.lastError}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

const PUSH_LABEL: Record<HistoryIntent['state'], string> = {
  pending: 'en attente',
  blocked: 'en attente d’un autre envoi',
  draining: 'envoi en cours',
  drained: 'envoyé',
  failed: 'échec',
}
