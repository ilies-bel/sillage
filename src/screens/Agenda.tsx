/**
 * *Calendrier* — the home screen (VISION.md §6, screen 1). Two columns: the
 * calendar on the left, the selected range's meetings on the right. There is no
 * dashboard.
 *
 * Three things this screen must get right.
 *
 *  1. **The calendar is always drawn** (DEC-31). With `auth.status !==
 *     'signedIn'`, with Graph down, on a day with nothing in it. There is no
 *     branch here that puts a panel where the grid belongs — an empty grey box
 *     in the calendar's place teaches a rep that the product is broken when it
 *     is merely unconnected, and that is the specific failure DEC-31 names. A
 *     signed-out rep gets a real, usable, empty calendar they can place a
 *     meeting in.
 *  2. **Armed is an offer, never a recording** (HR-7). The dot means the app
 *     *would* record; a human still presses *Démarrer*. Nothing on this screen
 *     starts a session on its own.
 *  3. **The calendar is optional and never renders as a degradation** (DEC-26,
 *     DEC-32). Graph connects in the background, nothing here waits on it, and
 *     its failure is a sentence in the pane it affects — never an app-level
 *     banner. The single status control in the header reads capture,
 *     transcription and analysis only.
 *  4. **The search is the only entry into the past** (DEC-25, VISION.md §6).
 *     There is no *Historique* link in this header any more. A field and four
 *     rows of chips sit above the day list, the query runs in the main process,
 *     and *Historique* is where that same query goes when the rep wants the full
 *     record. It works signed out and on an empty corpus, because the store it
 *     reads is local.
 *
 * A rep can create a meeting on **any** day, not only today, and record it. That
 * meeting is drawn in the same grid as one that came from Outlook, because the
 * calendar is the app's own surface and not a rendering of Exchange.
 */
import { useCallback, useMemo, useState } from 'react'
import type { HistoryFilter } from '../../electron/core/contracts/history.ts'
import type { AgendaSnapshotPayload } from '../../electron/core/contracts/ipc.ts'
import type { AuthState } from '../../electron/core/contracts/identity.ts'
import type { Meeting } from '../../electron/core/contracts/meeting.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import {
  dayKeyOf,
  monthMatrix,
  monthOf,
  noonOf,
  spanOf,
  startOfWeek,
  weekOf,
  type DayKey,
} from '../app/calendar.ts'
import { formatAgo, formatDayLong, formatDayMedium, formatMonthLong } from '../app/format.ts'
import { Button, Segmented, unavailable, type SegmentedOption } from '../ui/index.ts'
import { CalendarGrid } from './agenda/CalendarGrid.tsx'
import { DayPane } from './agenda/DayPane.tsx'
import { NewMeeting } from './agenda/NewMeeting.tsx'
import { buildEntries, countsByDay, marksByDay } from './agenda/entries.ts'
import { NO_FILTER, isSearchActive } from './search/filters.ts'
import { Results } from './search/Results.tsx'
import { SearchBar } from './search/SearchBar.tsx'
import { useHistorySearch } from './search/useHistorySearch.ts'
import { StatusControl } from './StatusControl.tsx'

/**
 * `Jour · Semaine · Mois · Liste` (VISION.md §6). The grid stays a month grid
 * in all four — what changes is how much of it the list beside it covers.
 */
type View = 'jour' | 'semaine' | 'mois' | 'liste'

const VIEWS: readonly SegmentedOption<View>[] = [
  { id: 'jour', label: 'Jour' },
  { id: 'semaine', label: 'Semaine' },
  { id: 'mois', label: 'Mois' },
  { id: 'liste', label: 'Liste' },
]

/**
 * How many results the pane shows before deferring to *Historique*.
 *
 * Not a page size — there is no second page here. The calendar's right-hand
 * column is a glance; the full record is one link away and is the screen built
 * for it (VISION.md §6, DEC-25). Asking for eight rather than fifty also means
 * a rep who has not searched is holding eight rows of metadata, not fifty.
 */
const RESULT_LIMIT = 8

interface AgendaProps {
  onOpen: (meetingId: string) => void
  /**
   * Opens *Historique* on the query and chips already on screen (DEC-25).
   *
   * There is no *Historique* nav link any more: the search **is** the entry
   * point, and the expanded form has to open on the same question or the rep
   * would type it twice.
   */
  onHistorique: (query: string, filter: HistoryFilter) => void
  onReglages: () => void
}

export function Agenda({ onOpen, onHistorique, onReglages }: AgendaProps) {
  const agenda = useInvoke('agenda:snapshot', {})
  const auth = useInvoke('auth:state', {})
  const [busy, setBusy] = useState(false)

  useBroadcast('agenda:changed', agenda.set)
  useBroadcast('auth:changed', auth.set)

  const now = Date.now()
  const today = dayKeyOf(now)
  const [selected, setSelected] = useState<DayKey>(today)
  // The month on screen. Separate from the selection on purpose: paging ahead
  // to see next month must not silently move the day whose meetings are listed.
  const [month, setMonth] = useState<DayKey>(today)
  const [view, setView] = useState<View>('jour')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER)

  /**
   * The meetings this screen has to draw, scoped to the window it draws.
   *
   * A flat `limit: 200` was a truncation waiting to happen — page the grid back
   * a year and the dots stop appearing under days that have meetings, silently.
   * So the question carries its range: the six weeks the grid is showing, which
   * is exactly what the cells, the marks and the *Jour · Semaine · Mois* lists
   * can reach. *Liste* is the one view that spans everything, and it asks for
   * everything (capped by the contract's own 500 — past that, the search below
   * is the reader, and it is not capped by a viewport).
   */
  const range = useMemo(() => {
    const weeks = monthMatrix(month)
    return spanOf(weeks[0][0], weeks[5][6])
  }, [month])

  const meetings = useInvoke(
    'meeting:list',
    view === 'liste'
      ? { limit: 500, from: null, to: null }
      : { limit: 500, from: range.from, to: range.to },
  )
  useBroadcast('session:changed', meetings.reload)

  /**
   * The search, in the main process (DEC-25). One question, asked once.
   *
   * It runs whether or not the rep has typed: an empty question is the listing
   * the client chips are built from, and the chips cannot be drawn without the
   * client names — which are the main process's to know. What comes back is
   * never a corpus; it is at most `RESULT_LIMIT` rows plus short excerpts.
   */
  const search = useHistorySearch(query, filter, RESULT_LIMIT)
  const searching = isSearchActive(query, filter)

  const snapshot: AgendaSnapshotPayload | null =
    agenda.state.status === 'ready' ? agenda.state.value : null
  const authState: AuthState | null = auth.state.status === 'ready' ? auth.state.value : null
  const known: readonly Meeting[] = meetings.state.status === 'ready' ? meetings.state.value : []

  const entries = useMemo(
    () => buildEntries({ snapshot, meetings: known, now: Date.now() }),
    // `now` is read per render on purpose — a meeting crosses into *Passées*
    // when the app next re-renders, not on a timer nobody asked for.
    [snapshot, known],
  )
  const marks = useMemo(() => marksByDay(entries), [entries])
  const counts = useMemo(() => countsByDay(entries), [entries])

  const inRange = useMemo(() => {
    if (view === 'liste') return entries
    if (view === 'jour') return entries.filter((entry) => entry.day === selected)
    if (view === 'semaine') {
      const week = new Set(weekOf(selected))
      return entries.filter((entry) => week.has(entry.day))
    }
    return entries.filter((entry) => monthOf(entry.day) === monthOf(month))
  }, [entries, view, selected, month])

  const select = useCallback((day: DayKey) => {
    setSelected(day)
    setMonth(day)
  }, [])

  /**
   * A meeting created for *now* is **recording** by the time its session opens.
   *
   * The rep pressed a button that said *Démarrer*; the recording starting is
   * what that word promised. It used to open the session in `idle` with a second
   * *Démarrer* in the header — two presses for one intention, and the gap
   * between them was a call already in progress that the app was not hearing.
   *
   * `start` is dispatched before the route changes so the session screen mounts
   * on a meeting that is already recording, rather than mounting on `idle` and
   * flipping a moment later — that flicker is on the one screen whose whole job
   * is to say, unambiguously, whether the microphone is live.
   *
   * A refused `start` is not a reason to withhold the screen. The dispatch is
   * the state machine's to refuse, the session screen states what the machine
   * says, and stranding the rep on the calendar with a meeting they cannot see
   * would be worse than opening it in whatever state it really is.
   *
   * One placed on another day stays in the grid and starts nothing; dropping a
   * rep into a live recording for a call that is next Thursday would be the app
   * deciding something nobody asked for (DEC-31, HR-7).
   */
  const created = useCallback(
    async (meeting: Meeting) => {
      if (meeting.scheduledStart !== null) {
        meetings.reload()
        select(dayKeyOf(meeting.scheduledStart))
        return
      }

      try {
        await invoke('session:command', {
          meetingId: meeting.id,
          command: 'start',
          reason: 'démarrage immédiat',
        })
      } catch {
        // Opened anyway — see above.
      }
      meetings.reload()
      onOpen(meeting.id)
    },
    [meetings, onOpen, select],
  )

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      agenda.set(await invoke('agenda:refresh', {}))
    } finally {
      setBusy(false)
    }
  }, [agenda])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        Full width, with the border that separates it from the two columns
        below. The screen is a surface, not a page of floating cards.
      */}
      <header className="border-subtle flex items-baseline justify-between gap-4 border-b px-gutter pb-4 pt-7">
        {/*
          Title and date on one line (`5.1 Aujourd'hui — Canonical`). Stacked,
          the date read as a subtitle of the screen; beside the title it reads
          as what it is — which day the calendar is opened on.
        */}
        <div className="flex items-baseline gap-inline">
          <h1 className="font-display text-strong text-display leading-none">Calendrier</h1>
          <p className="text-muted text-label font-semibold uppercase tracking-wider">
            {formatDayLong(now)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/*
            The one general status (DEC-32). VISION.md §6 puts it here and
            nowhere else — this header is the only one in the product that is
            not inside a call, which is the whole reason the footer strip that
            *was* inside every call had to go. The calendar is not in it: it is
            optional (DEC-26) and an unreachable Graph is not a degradation of
            the app.
          */}
          <StatusControl onReglages={onReglages} />

          {/*
            One word, not a nav bar. HR-10 says one window and no modal chrome,
            and a permanent sidebar for a screen a rep opens once a week is
            chrome that is present during every call it is not wanted in.

            *Historique* used to sit here. It does not any more (DEC-25,
            VISION.md §6): it is not a destination, it is where the search below
            goes when the rep wants the full record — so it is reached by typing
            a client's name on the screen they are already on, and the link that
            opens it carries that query with it.
          */}
          <Button variant="text" onClick={onReglages}>
            Réglages
          </Button>
          <NewMeeting day={selected} today={today} onCreated={created} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
          Drawn before anything is known, and drawn identically when nothing
          ever will be. No `authState` and no `snapshot` is read on this side of
          the screen — that is what "always drawn" means in code.

          It carries its own surface and runs the full height of the window.
          The previous shape — a transparent column holding a card that sized
          to its content — left 42% of the window as bare canvas below the
          grid, which is what made a finished screen read as an unfinished one.
        */}
        <aside className="bg-card-soft border-subtle w-80 shrink-0 overflow-y-auto border-r px-row py-row">
          <CalendarGrid
            month={month}
            onMonth={setMonth}
            selected={selected}
            onSelect={select}
            today={today}
            marks={marks}
            counts={counts}
          />

          {/*
            The calendar's own sync state, beside the calendar. Not in the
            header: a connector that is optional (DEC-26, DEC-32) states its
            condition on the control it belongs to, and never as an app-level
            line.
          */}
          {snapshot && authState?.status === 'signedIn' ? (
            <div className="mt-2 flex justify-center">
              <Button
                variant="text"
                onClick={() => void refresh()}
                {...unavailable(busy, 'Synchronisation…')}
              >
                {`Synchronisé ${formatAgo(snapshot.syncedAt, now)}`}
              </Button>
            </div>
          ) : null}
        </aside>

        {/*
          `--bg-card`, the brightest of the three surfaces, against the
          sidebar's `--bg-card-soft`. The pair is what the design uses to say
          which column is the subject and which is the index, and it is also
          what stops the window from ending in bare canvas half way down: below
          the last row there is still a surface, which is what a page is.
        */}
        <main className="bg-card min-h-0 flex-1 overflow-y-auto px-gutter py-row">
          {/*
            Above the list, and the product's only entry into the past
            (VISION.md §6). It is drawn signed out and on an empty corpus: the
            box takes text either way, the chips it can offer it offers, and the
            answer comes from the store — which is local, and owes Graph, VSA
            and Outlook nothing (DEC-26, DEC-32).
          */}
          <SearchBar
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            clients={search.result?.clients ?? []}
            onHistorique={() => onHistorique(query, filter)}
            className="mb-3"
          />

          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-strong capitalize text-copy">
              {searching ? 'Résultats' : rangeLabel(view, selected, month)}
            </h2>
            {/*
              The view switch belongs to the day list, so it goes with it. A
              `Jour · Semaine · Mois · Liste` left on screen over a list of
              search results would be four buttons that change nothing — the
              dead control DEC-26 forbids. What takes its place is the way back.
            */}
            {searching ? (
              <Button
                variant="text"
                onClick={() => {
                  setQuery('')
                  setFilter(NO_FILTER)
                }}
              >
                Effacer la recherche
              </Button>
            ) : (
              <Segmented
                label="Période affichée"
                options={VIEWS}
                current={view}
                onSelect={setView}
              />
            )}
          </div>

          {searching ? (
            <Results
              rows={search.result?.rows ?? null}
              failure={search.failure}
              truncated={(search.result?.rows.length ?? 0) >= RESULT_LIMIT}
              onOpen={onOpen}
            />
          ) : (
            <DayPane
              entries={inRange}
              reason={snapshot?.reason ?? null}
              signedOut={authState?.status !== 'signedIn'}
              showDay={view !== 'jour'}
              onOpen={onOpen}
            />
          )}
        </main>
      </div>
    </div>
  )
}

/** What the right column is showing, in French, always on screen. */
const rangeLabel = (view: View, selected: DayKey, month: DayKey): string => {
  if (view === 'jour') return formatDayLong(noonOf(selected))
  if (view === 'semaine') {
    const first = startOfWeek(selected)
    const week = weekOf(selected)
    return `Semaine du ${formatDayMedium(noonOf(first))} au ${formatDayMedium(noonOf(week[6]))}`
  }
  if (view === 'mois') return formatMonthLong(noonOf(month))
  return 'Toutes les réunions'
}
