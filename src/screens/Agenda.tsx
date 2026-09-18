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
import { useCallback, useMemo, useRef, useState } from 'react'
import type { HistoryFilter } from '../../electron/core/contracts/history.ts'
import type { AgendaSnapshotPayload } from '../../electron/core/contracts/ipc.ts'
import type { AuthState } from '../../electron/core/contracts/identity.ts'
import { meetingAnchor, type Meeting } from '../../electron/core/contracts/meeting.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { useShortcuts } from '../app/shortcuts.ts'
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
import {
  formatDayLong,
  formatDayMedium,
  formatMonthLong,
  upperFirst,
} from '../app/format.ts'
import { Button, Rail, Segmented, type SegmentedOption } from '../ui/index.ts'
import type { SectionId } from './Reglages.tsx'
import { useUpdateReady } from '../app/update.ts'
import { CalendarGrid } from './agenda/CalendarGrid.tsx'
import { CalendarConnect } from './agenda/CalendarConnect.tsx'
import { DayPane } from './agenda/DayPane.tsx'
import { NewMeeting } from './agenda/NewMeeting.tsx'
import { PendingGates, PENDING_LIMIT } from './agenda/PendingGates.tsx'
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
  /**
   * Opens Réglages — on a named pane when the caller knows which one.
   *
   * Three callers on this screen now want three different panes: the header
   * status control lands on *Connecteurs* (DEC-32), the empty day's line lands
   * on the same one, and the rail's « Mise à jour prête » lands on *Mise à
   * jour*. Sending all three to the landing section would make the one click
   * each of them hands over cost a second one.
   */
  onReglages: (section?: SectionId) => void
  /** Replays first run, from the empty day. It is seen once and worth seeing twice. */
}

export function Agenda({ onOpen, onHistorique, onReglages }: AgendaProps) {
  const agenda = useInvoke('agenda:snapshot', {})
  const auth = useInvoke('auth:state', {})
  /* The rail's one conditional row. `phase: 'ready'` only — see `app/update.ts`. */
  const updateReady = useUpdateReady()
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

  /*
   * The keyboard (`app/shortcuts.ts`, VISION.md §6 « keyboard-first »).
   *
   * The three that belong to the home screen. `Ctrl/⌘ N` is not here: it is on
   * *Démarrer une réunion* itself, in `NewMeeting`, because that control owns
   * both the creation and the busy state a second press has to be refused
   * against — a shortcut wired to a copy of that logic would be a second way to
   * start a recording, and it would drift.
   */
  const searchRef = useRef<HTMLInputElement>(null)
  useShortcuts({
    rechercher: () => searchRef.current?.focus(),
    /*
      Overridden here, and only here: `App.tsx` opens the reader on an empty
      query, and this screen has one on the field beside it. `Ctrl/⌘ H` from
      the calendar carries what the rep has already typed, which is the whole
      relationship between the two screens (DEC-25).
    */
    historique: () => onHistorique(query, filter),
  })

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

  /*
   * The backlog: calls that were recorded and never confirmed.
   *
   * A second question to the same channel rather than a filter over `entries`,
   * because the answer is not on this screen's calendar — a call from three
   * weeks ago is still owed and the grid is showing September. The main process
   * already answers exactly this question for the `À valider` chip; asking it
   * with no query and that one chip is the same query, and the corpus still
   * never crosses (DEC-25).
   *
   * `PENDING_LIMIT` and not « one more than it draws »: the section's count is
   * the point of it, and it has to be the same number on every day of the
   * calendar. An empty query folds no transcript, so this is one indexed scan
   * and a chip filter.
   */
  const pendingFilter = useMemo<HistoryFilter>(
    () => ({ ...NO_FILTER, statut: 'a-valider' }),
    [],
  )
  const pending = useHistorySearch('', pendingFilter, PENDING_LIMIT)

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

  /**
   * **The one row that carries the screen's filled control** (US-26, HR-7).
   *
   * Measured on the shipped home screen at 1280×800, at 14:35 with the Néovia call
   * being recorded: six controls in the right-hand column — *Ouvrir* at y=206,
   * the arm control at 276 and 345, *Ouvrir* at 464, 534 and 681 — every one of them
   * `bordered`, `rgb(255,255,255)` on a 1px `rgb(211,222,230)` border. And
   * *Démarrer une réunion* in the header was **bordered too**, because
   * `NewMeeting` steps it down beside an armed row (`armedElsewhere`) and the armed
   * row here is `recording`, which `DayPane` drew as an ordinary *Ouvrir*. So the
   * screen a rep opens mid-call had **no filled control at all**: the header had
   * given the weight up and nothing took it.
   *
   * One row gets it, and the ranking is what the rep would do next:
   *
   *  1. the call that is **being recorded** — « En cours », opened and not started;
   *  2. the **armed** row — « Prêt », the offer `core/domain/arming.ts` made, which
   *     is what carried the fill before and still does. It cannot coexist with (1):
   *     `Orchestrator.dispatch` allows one recording at a time and `Agenda.#arm`
   *     refuses beside a live one, so the two are a ranking and never a tie;
   *  3. the **oldest** row still `à valider`, across the day list *and* *En attente
   *     de validation*, because a compte-rendu that never reached VerySwing is the
   *     product's quietest failure and the rep owes it one gesture.
   *
   * It is an id and not a flag per component, which is the whole point: « exactly
   * one filled control » is a fact about the *screen*, and two components each
   * deciding locally is how a screen ends up with two. `null` is an ordinary
   * answer — a quiet day owes nothing, and then the header's *Démarrer une
   * réunion* is the only fill, which is what it was built to be.
   *
   * Nothing gains or loses an affordance here. Every control that was on a row is
   * still on it, with the same verb and the same handler; only the ink moves.
   */
  const emphasis = useMemo<string | null>(() => {
    const live = inRange.find((entry) => entry.state === 'recording')
    if (live?.meetingId) return live.meetingId
    const armed = inRange.find((entry) => entry.armed)
    if (armed?.meetingId) return armed.meetingId

    /*
     * Oldest first, and over both lists at once — `entry.start` and
     * `meetingAnchor` are the same clock. The day pane draws its past rows newest
     * first and the pending section is ordered by the store, so « the earliest »
     * cannot be read off either render order.
     */
    const owed = inRange
      .filter((entry) => entry.state === 'awaiting_confirmation' && entry.meetingId !== null)
      .map((entry) => ({ id: entry.meetingId as string, at: entry.start }))
    for (const row of pending.result?.rows ?? []) {
      if (owed.some((seen) => seen.id === row.meeting.id)) continue
      owed.push({ id: row.meeting.id, at: meetingAnchor(row.meeting) })
    }
    owed.sort((a, b) => a.at - b.at)
    return owed[0]?.id ?? null
  }, [inRange, pending.result])

  /**
   * **Whether the range on screen is one Graph was actually asked about.**
   *
   * The sync window is yesterday through a week ahead — eight days — and this
   * grid draws six weeks. So an empty Thursday three weeks out was reported as
   * « Aucune réunion ce jour-là. », which is a claim about the calendar the app
   * has no basis for, under the *arming* reason, which accounted for it with
   * « Teams émet du son ». Thirty-four of forty-two days.
   *
   * Only when the **whole** visible range is outside the window: a week that
   * straddles the edge has been half answered, and « nothing here » is true of
   * the half that was asked. A day inside the window with nothing on it is an
   * empty day and says so.
   */
  const unsynced = useMemo(() => {
    const bounds = snapshot?.window
    if (!bounds || bounds.to === 0) return false
    const days =
      view === 'liste'
        ? []
        : view === 'jour'
          ? [selected]
          : view === 'semaine'
            ? weekOf(selected)
            : monthMatrix(month).flat().filter((day) => monthOf(day) === monthOf(month))
    if (days.length === 0) return false
    const from = dayKeyOf(bounds.from)
    const to = dayKeyOf(bounds.to)
    return days.every((day) => day < from || day > to)
  }, [snapshot, view, selected, month])

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

  /**
   * *Préparer* on an upcoming invite: arm it now, then open it.
   *
   * The arming is the **same** one the clock performs — `agenda:arm` reaches
   * `Agenda.armNow`, which calls the private `#arm` that `decideArming` calls —
   * so the meeting carries the invite's `eventId`, its subject and its
   * attendees. That is the whole reason this exists rather than reusing
   * *Démarrer une réunion*, whose meeting has `eventId: null` by design.
   *
   * It opens the session but does **not** start recording: HR-7 says arming is
   * an offer a human accepts, and the rep pressing a row is asking to be taken
   * to the call, not to have capture begin behind a list. *Démarrer* on the
   * session screen is the second press, and it is the same second press an
   * automatically armed meeting asks for.
   *
   * **The button said *Enregistrer* until this round, and the paragraph above is
   * why that was wrong** — this handler has never once reached
   * `session:command`. So did the armed row's, which reaches no channel at all:
   * two identical rectangles carrying the product's capture verb, neither of
   * them capturing, on one screen. `agenda/__tests__/verbs.test.tsx` presses
   * every control this screen draws and refuses a label that covers two acts.
   *
   * A refusal is shown rather than swallowed — `#arm` declines an event whose
   * meeting has already been held, and « rien ne se passe » on a button is the
   * dead control DEC-26 forbids. `preload.ts` has already stripped Electron's
   * `Error invoking remote method` prefix, so what surfaces is our sentence.
   */
  /**
   * Re-read the calendar, from the one place that asks about it (`agenda:refresh`).
   *
   * It was a permanent *Synchronisé il y a 4 min* under the month grid. It is the
   * empty card's freshness clause now — see `DayPaneProps.onRefresh`.
   */
  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      agenda.set(await invoke('agenda:refresh', {}))
    } finally {
      setBusy(false)
    }
  }, [agenda])

  /** The last refusal from `agenda:arm`, shown on the page — see `armNow`. */
  const [refusal, setRefusal] = useState<string | null>(null)

  const armNow = useCallback(
    async (eventId: string) => {
      setBusy(true)
      try {
        setRefusal(null)
        const { meetingId } = await invoke('agenda:arm', { eventId })
        agenda.set(await invoke('agenda:snapshot', {}))
        meetings.reload()
        onOpen(meetingId)
      } catch (error) {
        /*
          **On the screen, not in Chromium's own chrome.**

          This was `window.alert`. HR-10 is « one window, no modal chrome », and
          this repo's own invariants say nothing Electron composes reaches a
          rep's eyes — `preload.ts` exists to strip « Error invoking remote
          method » for exactly that reason. A native modal is the strongest
          version of what both forbid: it blocks the window, it is drawn by the
          browser, and it arrives over a client call on the path HR-9 calls
          primary.

          The sentence inside it is worth keeping intact — `Agenda.armNow`
          composes « Une réunion est déjà en cours d'enregistrement. Terminez-la,
          puis reprenez celle-ci — elle reste proposée. », which names the
          remedy and says the offer survives. It goes into the page's own
          `role="alert"` instead, where a screen reader gets it too: the agenda
          had no live region at all, so the one refusal a rep meets weekly was
          announced by nothing.
        */
        setRefusal(
          error instanceof Error ? error.message : 'Impossible de démarrer cette réunion.',
        )
      } finally {
        setBusy(false)
      }
    },
    [agenda, meetings, onOpen],
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/*
        The rail, on every screen a rep can reach outside a call (V2). It holds
        three destinations and two footer rows and it is the same component on
        *Historique*, so « where am I » is answered in one place.

        `À valider` is a query and not a screen — it opens *Historique* with the
        chip the calendar's own section links to (DEC-25), which is the same
        query asked from two places rather than a second inbox.
      */}
      <Rail
        current="aujourdhui"
        pending={pending.result?.rows.length ?? null}
        updateReady={updateReady}
        onPlace={(place) => {
          if (place === 'a-valider') onHistorique('', pendingFilter)
          else if (place === 'historique') onHistorique('', NO_FILTER)
        }}
        onReglages={() => onReglages()}
        onUpdate={() => onReglages('maj')}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/*
        Full width, with the border that separates it from the two columns
        below. The screen is a surface, not a page of floating cards.

        **Its gutters step with the window, because at the floor they were the
        largest thing on it that answered nothing.** `px-gutter pb-row pt-7` —
        32px a side and 28 above — was the same number of pixels at 960×600 as
        at 1280×800, on a header whose content is a date, a status dot and one
        button. Measured through `shot.mjs`, that header was 63 970 px², 11.1 %
        of a 960×600 window against 8.4 % of a 1280×800 one; at the smaller
        step it is 54 562, 9.5 %. Nothing in it moved and nothing in it shrank
        — the type is the type, the controls are the controls (`--targets`
        still reads « toutes ≥ 24 px »), and what gave way is the air.
      */}
      <header className="border-subtle flex items-baseline justify-between gap-row border-b px-row pb-inline pt-block lg:px-gutter lg:pb-row lg:pt-7">
        {/*
          **The page is named by what changed, and the day is drawn once.**

          This held « Calendrier » in 42px serif — the largest thing on the screen,
          over a calendar — and beside it `formatDayLong(now)` at 11px uppercase,
          which the day pane's own `h2` then drew a *second* time: measured on the
          shipped screen, « dimanche 13 septembre » at y=40 and « Dimanche 13
          septembre » at y=148, 108px apart at 1280×800 and 107 at 960×600. The
          casefold is why no review round saw it — one was `text-transform:
          uppercase`, so as strings they differed.

          Of the two positions this one survives, and the `h2` in `main` goes. Both
          were built and measured, and the difference is not the one the layout
          suggests: promoting the `h2` costs **nothing** vertically (the row's
          height is set by the `Jour · Semaine · Mois · Liste` switch beside it, so
          the first day row stays at y=188 either way, and the header loses 4px).
          What decides it is the scroller. `main` is `overflow-y-auto`, so a title
          promoted there **leaves the screen**: measured at 960×600 — the minimum
          `app/main.ts` declares — scrolling the day list to its end takes it from
          top 138 to **−10**, above `main`'s own top edge at 78, on a 148px scroll;
          in *Liste* it goes to −365 at 1280×800 and −565 at 960×600. A page whose
          title scrolls away has no title. **And note the shape of how that hides:
          at 1280×800 on *Jour* the day list fits, so nothing scrolls and the
          version measures perfectly — it only breaks at the size `main.ts` declares
          as the minimum, and in the one view a rep switches to when they want more
          than a day.** That is HR-2's mac-first failure one level over: correct on
          the comfortable machine, wrong on the one that ships, and invisible to
          anybody who looked once. It is why `smoke.mjs` drives two sizes, and it is
          worth not re-deriving.
          Here it is outside the scroller and the tallest text box above the fold
          at both sizes (28px against the grid's 14px `h2`).

          It carries the **selected range** rather than `now`, which is a
          correction and not a move: the `h2` it replaces answered « what is the
          right column showing » — the day, the week, the month, or « Toutes les
          réunions » — while the header answered « what day is it today », so a rep
          who clicked Thursday read a list of Thursday under a title saying Sunday.
          The day the rep is *on* is what changed; today is marked in the grid.
        */}
        <h1 className="font-display text-strong text-display leading-none">
          {searching ? 'Résultats' : upperFirst(rangeLabel(view, selected, month, inRange.length))}
        </h1>

        <div className="flex items-center gap-inline">
          {/*
            The one general status (DEC-32). VISION.md §6 puts it here and
            nowhere else — this header is the only one in the product that is
            not inside a call, which is the whole reason the footer strip that
            *was* inside every call had to go. The calendar is not in it: it is
            optional (DEC-26) and an unreachable Graph is not a degradation of
            the app.
          */}
          <StatusControl onReglages={() => onReglages('connecteurs')} />

          {/*
            *Réglages* used to be a word in this header. It is in the rail now,
            at the bottom, with « Mise à jour prête » above it — one place for
            the two rows that are not destinations, on every screen rather than
            on this one. A header link and a rail row would be two doors to one
            pane, and the header is where the screen says what it is *about*.
          */}
          {/*
            The header drops *Ajouter au …* exactly when the day pane is
            drawing its own — one scheduling control on screen, and it is the
            one the rep is looking at. *Démarrer une réunion* is never dropped:
            it always means now, and without Graph it is the only way in.
          */}
          <NewMeeting
            day={selected}
            today={today}
            onCreated={created}
            showSchedule={searching || inRange.some((entry) => !entry.past)}
            /*
              **`armedElsewhere` is read by `NewMeeting` as « the list already
              carries the screen's one fill », and the set of rows that can claim
              it has widened.**

              Its own comment is « never the second filled blue on the screen »,
              with the measurement beside it: *Démarrer une réunion* at x=1099 and
              the armed row's control at x=1140, both `--brand-700`, 172px
              apart and horizontally overlapping — « one primary per view »
              (VISION.md §6) being two. That reasoning is about the *fill*, not
              about arming; arming was simply the only thing that could take it.
              US-26 gives it to a live call and to the oldest unvalidated call as
              well, so this is the same question asked of the same answer.

              Passing `entry.armed` here now would put a second blue on the home
              screen the moment a call is being recorded or a compte-rendu is
              waiting, which is most afternoons.
            */
            armedElsewhere={emphasis !== null}
          />
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
        {/*
          **The calendar narrows before the day does** — the rule `ui/Rail.tsx`
          already states about itself, applied to the other piece of chrome on
          this screen.

          It was `w-80`, fixed, at every size. At the 960×600 minimum `main.ts`
          declares that is 320px of a 960px window holding a month grid with 28
          of its 42 cells empty, while the column it sits beside truncated the
          one thing a rep scans a day for: measured on the shipped screen, all
          three upcoming titles clipped — « Néovia San… », « Banque Delcourt… »,
          « Arkelia Logistiqu… », eleven of thirty-five characters kept on the
          first. A month grid loses nothing at 256px; a meeting title loses its
          client.

          Three steps rather than a breakpoint that hides it, because DEC-31
          says the calendar is always drawn: 240 under 1024, 288 to 1280, 320
          above — and the first of those was 256 until the floor was measured
          rather than estimated. What sets it is WCAG 2.2's 24×24 on a day cell,
          not the look of the grid: the cell is `(colonne − 2×padding)/7` less
          the 2px the `td` holds it in, so 240 with `px-inline` draws **26.7px**
          cells against 256 with `px-row`'s 28.4 — measured, both, through
          `shot.mjs` at 960×600.

          **And the number that decides it is the Windows one** (HR-2). This
          column is `overflow-y-auto` and on `agenda-sans-entra` it really does
          scroll — 681px of content in 494 — where a classic scrollbar takes
          17px out of the column's own width and macOS's overlay one takes
          none. Measured at that width the cell is **24.28px**, still over the
          floor; at 224 the same measurement gives **22.0** and the grid fails
          `--targets` on the platform this ships to while passing on the one
          it is written on.

          **And this width is what makes the search row wrap at 960 — measured,
          it is still the right answer.** `SearchBar` needs 608.1px to hold its
          field, « Tout l'historique › » and the four-way view switch on one
          line; at 960 the day column offers 512, so the switch drops to a
          second line and the row is 75px tall instead of 33. That 42px is real
          — isolated by forcing the row to one line on the shipped screen, it is
          **21 600 px², 3.8 % of the window, and a fourth whole meeting row**.
          It cannot be bought here. Swept through `shot.mjs` at 960×600, the row
          holds one line only once this pane reaches **144px**, and there the
          day cells are **13×36**: `--targets` exits 5 with « 42 contrôle(s)
          sous 24 px », every cell of a grid DEC-31 says is always drawn and
          that the rep presses to change the day.

              calendrier  barre  cellule    lignes visibles  entières
                     240     75     26.7    177 240  30.8 %         3
                     208     75    22.14    188 318  32.7 %         4
                     176     75    17.56    199 395  34.6 %         4
                     144     33     13.0    209 399  36.4 %         5

          Half the target floor for 3.8 % of the window is not a trade this
          screen should take. The wrap stays.
        */}
        <aside className="bg-card-soft border-subtle w-60 shrink-0 overflow-y-auto border-r px-inline py-row lg:w-72 lg:px-row xl:w-80">
          <CalendarGrid
            month={month}
            onMonth={setMonth}
            selected={selected}
            onSelect={select}
            today={today}
            marks={marks}
            counts={counts}
          />

          {authState ? (
            <CalendarConnect auth={authState} onReglages={() => onReglages('calendrier')} />
          ) : null}

          {/*
            **The sync line is gone, and where it went is the point.**

            « Synchronisé il y a 4 min » sat here permanently, under the grid, on
            every screenful of every day — an optional connector (DEC-26)
            reporting itself whether or not anything turned on it, which is the
            app-level line DEC-32 retired one level up. Read on a day that has
            calls in it, it answers nothing: the calls are on the screen.

            It is said once now, in the empty day's card, where it is the
            *answer* — « there is nothing here » is a claim about the calendar,
            and how old the reading is, is how much that claim is worth. The
            manual refresh went with it: `agenda:refresh` is still the channel,
            and nothing on this screen waits on it (DEC-26).
          */}
        </aside>

        {/*
          `--bg-card`, the brightest of the three surfaces, against the
          sidebar's `--bg-card-soft`. The pair is what the design uses to say
          which column is the subject and which is the index, and it is also
          what stops the window from ending in bare canvas half way down: below
          the last row there is still a surface, which is what a page is.

          **And its gutters are the header's question asked of the column that
          pays for it.** 32px a side on a 528px column is 12 % of the width the
          rep is actually reading, at the one size where the meeting title was
          already down to 167px (against 375 at 1280×800) and wrapping to two
          clamped lines. With the calendar column at 240 and these gutters at
          16, the title is **215px** and the meetings a rep can see go from
          153 200 px² to 177 240 — 26.6 % of the window to 30.8 %. At 1280×800
          every one of those numbers is unchanged, to the pixel: this is the
          floor's problem and only the floor's.
        */}
        <main className="bg-card min-h-0 min-w-0 flex-1 overflow-y-auto px-row py-inline lg:px-gutter lg:py-row">
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
            inputRef={searchRef}
            onHistorique={() => onHistorique(query, filter)}
            /*
              The axes appear when the rep asks. On this screen the day list is
              directly underneath, and a permanent row of « 7 jours »,
              « À valider » and seven client names reads as a filter *on that
              list* — which it is not: pressing one replaces it with search
              results. On *Historique*, where the search is the whole screen,
              they stay.
            */
            chipsAlways={false}
            className="mb-inline"
            /*
              The view switch belongs to the day list, so over search results it
              is four buttons that change nothing — the dead control DEC-26
              forbids. What takes its place is the way back.
            */
            trailing={
              searching ? (
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
              )
            }
          />

          {searching ? (
            <Results
              rows={search.result?.rows ?? null}
              failure={search.failure}
              /*
                The main process's own answer, never a count against
                `RESULT_LIMIT`. `rows.length >= limit` is one more than the
                question — eight matches, eight rows, nothing hidden, and the
                pane told the rep to go and look in *Historique* for results
                that do not exist. `useHistorySearch` derives it once, from the
                field the channel has always shipped.
              */
              truncated={search.capped}
              onOpen={onOpen}
            />
          ) : (
            <>
            {refusal === null ? null : (
              /*
                `role="alert"`, so it reaches a screen reader as well as an eye —
                the agenda had no live region anywhere, and this is the one thing
                on it that appears without a press and has to be read.
              */
              <div
                role="alert"
                className="border-warn bg-card text-body mb-row flex items-start gap-inline rounded-sm border px-inline py-snug text-ui"
              >
                {/*
                  `measure` on the span, not on the row: the row also holds
                  *Fermer*, and a reading measure belongs to the element holding
                  the prose. Without it this sentence ran 96 characters a line at
                  1280×800 — the `--prose` ceiling is 75 — and it passed unseen
                  because nothing had ever pressed the control that raises it.
                  `agenda-preparer-refus` presses it now.
                */}
                <span className="measure min-w-0 flex-1">{refusal}</span>
                <Button variant="text" className="shrink-0" onClick={() => setRefusal(null)}>
                  Fermer
                </Button>
              </div>
            )}
            <DayPane
              onArm={armNow}
              entries={inRange}
              /* The screen's one filled control, decided once, above. */
              emphasis={emphasis}
              reason={snapshot?.reason ?? null}
              showDay={view !== 'jour'}
              when={selected < today ? 'past' : selected > today ? 'future' : 'today'}
              unsynced={unsynced}
              /*
                The calendar's own freshness, said where it answers something:
                in the empty card, and nowhere else on the screen.
              */
              readAt={snapshot?.syncedAt ?? null}
              now={now}
              onRefresh={() => void refresh()}
              refreshing={busy}
              /*
                The header's *Ajouter au …* again, this time where the rep is
                looking. Same component and therefore the same form, the same
                validation and the same `onCreated` — a second copy of the
                control, never a second way of doing it.
              */
              action={
                <NewMeeting variant="empty" day={selected} today={today} onCreated={created} />
              }
              onOpen={onOpen}
            />
            </>
          )}

          {/*
            What the rep owes, under what the rep has planned.

            Below the day and not beside it: it is not about today. It is drawn
            only when there is something in it, and only when the pane is showing
            a day — over search results it would be a second list answering a
            question nobody asked.

            Rows already visible above are dropped: a call held this morning that
            has not been validated is in *Passées* two inches higher, and the
            same meeting twice on one screen is a rep wondering whether they are
            two.
          */}
          {searching ? null : (
            <PendingGates
              rows={(pending.result?.rows ?? []).filter(
                (row) => !inRange.some((entry) => entry.meetingId === row.meeting.id),
              )}
              /* The backlog's size, before the de-duplication above — so the
                 number is a fact about the rep's work and not about which day
                 cell happens to be open. */
              total={pending.result?.rows.length ?? 0}
              /* Whether there are more than the rows counted — the handler's own
                 answer, so « 50+ » is drawn when a row was hidden and never
                 because the count happens to equal the limit. */
              capped={pending.capped}
              /* The same one id the day list is given: whichever list holds that
                 row draws the fill, and neither can invent a second. */
              emphasis={emphasis}
              now={now}
              onSeeAll={() => onHistorique('', pendingFilter)}
              onOpen={onOpen}
            />
          )}
        </main>
      </div>
      </div>
    </div>
  )
}

/**
 * What the right column is showing, in French — and it is the page's title
 * (US-22), not a caption over the list.
 *
 * This used to be drawn as an `h2` inside `main` *and* the day was printed a
 * second time in the header, which is the echo `shot.mjs --echo` now measures.
 *
 * **`mois` names the count, because the month is already named beside it.**
 * `--echo` found this the moment the title moved into the header and changed tag:
 * « Novembre 2026 » at y=28 as the page title and « Novembre 2026 » at y=99 as the
 * calendar's own pager, on `agenda-hors-fenetre` at both sizes. Seventy pixels
 * apart, and the pager is the control the rep uses to *change* it — so the title
 * repeating it said nothing at all. (It was there before US-22 too, as an `h2`
 * against the pager's `h2`; identical tag and class, which is the one pair
 * exemption 1 cannot see. Changing the tag is what exposed it.) The count is what
 * switching to *Mois* actually asks about, and it is the same gesture US-22 asks
 * of *Historique*'s title.
 */
const rangeLabel = (view: View, selected: DayKey, month: DayKey, held: number): string => {
  if (view === 'jour') return formatDayLong(noonOf(selected))
  if (view === 'semaine') {
    const first = startOfWeek(selected)
    const week = weekOf(selected)
    return `Semaine du ${formatDayMedium(noonOf(first))} au ${formatDayMedium(noonOf(week[6]))}`
  }
  if (view === 'mois') {
    const on = formatMonthLong(noonOf(month))
    if (held === 0) return `Aucune réunion en ${on}`
    return `${held} réunion${held > 1 ? 's' : ''} en ${on}`
  }
  return 'Toutes les réunions'
}
