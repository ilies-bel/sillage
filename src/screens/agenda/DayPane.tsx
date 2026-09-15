/**
 * The right-hand column: what is in the selected range, and what was.
 *
 * Two sections, and the divider between them is DEC-31's: *Passées* holds the
 * calls already held in the selected range, with their state. Everything above
 * it is still to come. A call *outside* the range is the search's job, one
 * component up — this pane never widens itself to find one.
 *
 * The rules that hold across both:
 *
 *  · **Armed is an offer, never a recording** (HR-7). The dot means the app
 *    *would* record; a human still presses. Nothing here starts anything.
 *  · **A row with no session carries no *Ouvrir*** (DEC-26) — a *past* invite
 *    the app never opened is information, and a dead *Ouvrir* on it would be the
 *    exact dead control that decision forbids. An **upcoming** one is not
 *    information: it is a call that can be started, and it carries *Enregistrer*
 *    instead. Reading the rule as « no meeting, no button » left four of the
 *    five upcoming rows with nothing on them at all.
 *  · **An empty range says why it is empty**, in the calendar's own words, and
 *    never as a failure of the app (DEC-26, DEC-32). Graph being unreachable is
 *    a line in this pane, not a banner over the product.
 */
import { CalendarDays } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatAgo, formatRange, formatTime, formatDayMedium, upperFirst } from '../../app/format.ts'
import { noonOf, type DayKey } from '../../app/calendar.ts'
import { cn } from '../../lib/utils.ts'
import {
  Button,
  EmptyState,
  List,
  Row,
  RowTitle,
  SectionHeader,
  StateDot,
  unavailable,
} from '../../ui/index.ts'
import { STATE_LABEL, type AgendaEntry } from './entries.ts'

interface DayPaneProps {
  /** Already filtered to the range on screen, ascending. */
  entries: readonly AgendaEntry[]
  /** Why the calendar has nothing to show, in its own words. May be empty. */
  reason: string | null
  /**
   * Where the selected range sits relative to today.
   *
   * The empty panel said « Aucune réunion à venir. » on every empty range,
   * including one ten days behind — a sentence that is simply false about a
   * Monday that has already happened, on the screen whose whole job is to be
   * trusted about what is on the calendar. Three ranges, three true sentences.
   */
  when: 'past' | 'today' | 'future'
  /** Shown on a row when the range spans more than one day. */
  showDay: boolean
  /**
   * The way out of an empty range, drawn inside the empty panel.
   *
   * A node rather than a callback: scheduling is `NewMeeting`'s own form and its
   * own state, and this pane has no business owning either — it only owes the
   * rep somewhere to press.
   */
  action?: ReactNode
  /**
   * **True when the range on screen is outside the days Graph was asked about.**
   *
   * `modules/calendar/delta.ts` syncs yesterday through a week ahead — eight
   * days — and `Agenda.tsx` draws a six-week grid. So *Mois* and *Liste* said
   * « Aucune réunion ce jour-là. » about **thirty-four of forty-two days** on
   * which nothing had been looked up, and the `reason` beneath explained that
   * emptiness with the *arming* reason: an empty Thursday three weeks out was
   * accounted for by « Teams émet du son ».
   *
   * Nobody can widen the window for free — a delta link bakes its range in and
   * keeps answering for it forever — so the honest move is to say which days the
   * answer covers. An absence of evidence is not evidence of absence, and this
   * is a calendar: being trusted about what is on it is the whole job.
   */
  unsynced?: boolean
  /**
   * **The one meeting on this screen that carries a filled control** (US-26).
   *
   * An id and not a predicate, and it comes from `Agenda` rather than being
   * decided here, because « exactly one filled control » is a fact about the
   * *screen* and this pane is one of two lists on it — the other is *En attente de
   * validation*, which offers the same *Ouvrir* on the same kind of row. Two
   * components each answering « is this row the important one » from what they can
   * see is how a screen ends up with two blues, and the comparison it takes is
   * across both lists: the oldest `à valider` call may be in either.
   *
   * `null` means no row does, which is an ordinary day.
   */
  emphasis: string | null
  /**
   * When the calendar was last read, or `null` when it never has been.
   *
   * Drawn **only** in the empty card, and that placement is the whole argument.
   * It used to be a permanent line under the month grid — an optional connector
   * (DEC-26) reporting itself on every screenful, which is the app-level banner
   * DEC-32 retired one level down. On an empty day it stops being chrome and
   * becomes the answer: « there is nothing here » is a claim about the calendar,
   * and how old the reading is, is how much the claim is worth.
   */
  readAt?: number | null
  /** The clock `readAt` is measured against — the screen's own, never a new one. */
  now?: number
  /** Opens Réglages on *Connecteurs*. The card's one way out of the second half. */
  /**
   * Re-read the calendar (`agenda:refresh`).
   *
   * On the freshness clause itself, and only in the empty card. That is the one
   * moment the question is live: a rep looking at an empty day who believes a
   * meeting is missing is asking « is this answer current », and the sentence
   * saying how old it is, is the thing to press. As a permanent control under
   * the month grid it was an optional connector's plumbing on every screenful.
   */
  onRefresh?: () => void
  /** A refresh is on the wire. The clause says so rather than going dead. */
  refreshing?: boolean
  onOpen: (meetingId: string) => void
  /**
   * Start a scheduled call now, keeping the invite it came from.
   *
   * Separate from `onOpen` because they are different acts on different things:
   * one opens a meeting that exists, the other asks `agenda:arm` to bring one
   * into being from a calendar event — which is the same path the clock takes,
   * so the attendees and the subject survive.
   */
  onArm: (eventId: string) => void
}

export function DayPane({
  entries,
  reason,
  showDay,
  when,
  action,
  unsynced = false,
  emphasis,
  readAt = null,
  now = Date.now(),
  onRefresh,
  refreshing = false,
  onOpen,
  onArm,
}: DayPaneProps) {
  const upcoming = entries.filter((entry) => !entry.past)
  // Newest first: the call a rep wants after a meeting is the one that just
  // ended, and it is at the bottom of an ascending list.
  const past = entries.filter((entry) => entry.past).slice().reverse()

  /*
   * **The empty state is about the *day*, not about the upcoming half of it.**
   *
   * It was keyed on `upcoming.length`, with `past` rendered unconditionally
   * below — so on **every past day that holds a call**, « Aucune réunion ce
   * jour-là. » was drawn directly above the list of that day's meetings:
   *
   *     mardi 4 août, 1 réunion, dont une enregistrée
   *       claim above : ["Aucune réunion ce jour-là."]
   *       Passées     : ["10:00 – 11:00 Groupe Maréchal — qualification besoin ERP"]
   *
   * The `unsynced` variant is the worse half: « le calendrier n'a pas été
   * interrogé dessus » about a day on which **this app recorded a call**, which
   * it has first-hand knowledge of. Five past days in the fixture, five false
   * cards, on the home screen, for every day of a rep's working history.
   *
   * Only the `today` sentence was ever written for a day that has a past list —
   * « Plus aucune réunion aujourd'hui » is true beside one — and that is the
   * shape the others needed: the card appears when the day holds nothing at all.
   */
  /** The day holds calls; only the *upcoming* half of it is empty. */
  const suppressed = upcoming.length === 0 && past.length > 0 && when !== 'today'

  return (
    <div className="min-h-0">
      {upcoming.length > 0 ? (
        <List bare>
          {upcoming.map((entry) => (
            <EntryRow
              key={entry.key}
              entry={entry}
              showDay={showDay}
              filled={entry.meetingId !== null && entry.meetingId === emphasis}
              onOpen={onOpen}
              onArm={onArm}
            />
          ))}
        </List>
      ) : suppressed ? null : (
        <EmptyState
          icon={<CalendarDays size={22} aria-hidden />}
          action={action}
          reason={unsynced ? undefined : reason || undefined}
          /*
            **One line, and it is about the calendar rather than about the app.**

            It replaces « Le calendrier est facultatif — vous pouvez créer une
            réunion sur n'importe quel jour. », which answered a question the rep
            had not asked (they are looking at an empty day, not wondering
            whether Microsoft is mandatory) and said nothing about *why* the day
            is empty. What is worth knowing on an empty day is how fresh the
            answer is, and whether there is anything connected to have answered
            it — and then where to go about the second half.
          */
          hint={
            <CalendarLine
              readAt={readAt}
              now={now}
              onRefresh={onRefresh}
              refreshing={refreshing}
            />
          }
        >
          {/*
            Three ranges, three true sentences — and none of them answers a
            question the rep did not ask.

            It said « Aucune réunion n'a été enregistrée sur cette période »,
            which is wrong twice on a day view: « sur cette période » of a single
            Monday, and « enregistrée » answers whether anything was *recorded*
            when the rep asked whether anything was *in the calendar*.
          */}
          {unsynced
            ? 'Ces jours sont hors de la période synchronisée — le calendrier n’a pas été interrogé dessus. Vous pouvez quand même y créer une réunion.'
            : when === 'today'
              ? 'Plus aucune réunion aujourd’hui.'
              : showDay
                ? 'Aucune réunion sur cette période.'
                : 'Aucune réunion ce jour-là.'}
        </EmptyState>
      )}

      {past.length > 0 ? (
        <section className="mt-block">
          <SectionHeader>Passées</SectionHeader>
          {/*
            **A past call and a call still ahead are the same object, and the
            screen used to draw them in two chrome languages 200 pixels apart.**

            This block said « a past call is a card; a call still ahead is a
            row », and argued it: above the divider a schedule read down as one
            block, below it a record of discrete things to pick from. The
            distinction is real. Carrying it in a *border* was the mistake — a
            rep scanning the day sees a bordered list, then two bordered cards,
            then one more under *En attente*, and reads three containers
            competing rather than one day's calls.

            So the distinction stays and the boxes go. What separates a schedule
            from a record here is what always did the work: the section header
            above, and `EntryRowProps.card` moving the clock from the leading
            edge to the trailing one — in a schedule the time is the index, in a
            record it is a detail. Both are content. Neither is a rectangle.

            `bare` on both halves, so the day is one surface (VISION.md §6:
            « rows, not cards, for lists — density over decoration »), and the
            reference does the same — `docs/stories/ref/granola-home.png` draws
            no row borders at all.
          */}
          <List bare as="ul" label="Réunions passées">
            {past.map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                showDay={showDay}
                card
                filled={entry.meetingId !== null && entry.meetingId === emphasis}
                onOpen={onOpen}
                onArm={onArm}
              />
            ))}
          </List>
          {/*
            The *Ajouter au …* control follows the card that used to carry it.

            Suppressing a false « aucune réunion » must not also remove the way
            to create one: DEC-31 says a rep can create and record a meeting on
            any day, including a past one, and the header's copy is at the top of
            a screen the rep has scrolled away from.
          */}
          {suppressed && action ? <div className="mt-2">{action}</div> : null}
        </section>
      ) : null}
    </div>
  )
}

interface EntryRowProps {
  entry: AgendaEntry
  showDay: boolean
  /**
   * Draw the entry as a card of its own rather than as a row of a divided list.
   *
   * *Passées* only. The time moves to the trailing edge with it: in a schedule
   * the clock is the index and belongs first, and in a record of calls that have
   * already happened it is a detail of the card, which is the far side.
   */
  card?: boolean
  /** This is the screen's one filled control — see `DayPaneProps.emphasis`. */
  filled: boolean
  onOpen: (meetingId: string) => void
  /** Start a scheduled call now, keeping the invite (`agenda:arm`). */
  onArm: (eventId: string) => void
}

function EntryRow({ entry, showDay, card = false, filled, onOpen, onArm }: EntryRowProps) {
  const meetingId = entry.meetingId

  const when = (
    <span
      className={cn(
        'text-muted shrink-0 tabular-nums text-ui',
        card ? 'text-right' : 'w-28',
      )}
    >
      {showDay ? (
        <span className="block">{upperFirst(formatDayMedium(noonOf(entry.day)))}</span>
      ) : null}
      {entry.end === null || entry.end <= entry.start
        ? formatTime(entry.start)
        : formatRange(entry.start, entry.end)}
    </span>
  )

  return (
    /*
     * **The armed row arrives, rather than simply being there.**
     *
     * Only the armed one, and only on mount. An offer is the one row on this
     * screen that appeared *because the app noticed something* — a calendar
     * window opening, or `core/domain/adHoc.ts` detecting a call nobody
     * scheduled — and a list item inserted with no transition is the textbook
     * change-blindness case: a rep looking straight at the day sees a row that
     * reads as having always been there.
     *
     * DEC-46's OS notification covers the rep who is in Teams with this window
     * behind three others. Nothing covered the rep who is looking at the app,
     * which on an unscheduled call is the likelier of the two — they have not
     * been told a meeting is coming, so they have no reason to be anywhere else.
     *
     * The other rows deliberately do not animate. VISION.md §6 asks for quiet and
     * a rep switches Jour/Semaine/Mois constantly; animating a whole list on
     * every switch buys nothing and costs a hundred and fifty milliseconds of
     * motion each time. `riseIn` is `var(--motion) var(--ease-out)`, so it is 150
     * ms, it is the one curve this product owns, and it collapses to nothing
     * under `prefers-reduced-motion` because `--motion` does — no second rule to
     * keep in step, which is what `shot.mjs --motion` checks.
     */
    <Row
      density={card ? 'card' : 'roomy'}
      align="center"
      /*
        No edge stroke: the list above owns the grouping now, and `card` means
        only « the clock is a detail of this row, so it goes last ».

        **`relative`, because the row is the target on the rows where a click is
        safe.** Measured at 1280×800 the row is 1050 CSS px wide and only the
        ~85px button responded to the pointer — the primary object of the
        primary screen, inert across 92% of itself, with no hover feedback to
        say so either way. The reference makes the whole row the target
        (`docs/stories/ref/granola-home.png`).

        The stretch is on the *button*, below, and only on the branch whose
        `onClick` is `onOpen`. That is the whole of the care this needs: a row
        that only carries `eventId` starts a capture (`onArm`), and « the rep
        clicked somewhere in a 1050px rectangle » is not how a recording of a
        client call should begin. Navigation is reversible; arming is not.
      */
      className={cn(
        'relative transition hover:bg-subtle',
        entry.armed && 'animate-rise-in',
      )}
    >
      {card ? null : when}

      <RowTitle title={entry.title} subtitle={entry.subtitle ?? undefined} />

      {/*
        The accent dot and the word it means, as one thing. VISION.md §6 asks
        for quiet, so it is 6px and it does not pulse; it carries a text label
        because colour alone cannot state a condition that changes what a
        button does. And the orange stays on the dot: `--accent` is 2.44:1, so
        `text-accent` on the word *Prêt* would render it at 2.41:1 on the card.
        `StateDot` makes that unspellable.
      */}
      {/*
        **`armed` is a state and « Prêt » is a claim about one, and testing the
        flag first made the claim unfalsifiable.**

        `Agenda.#arm` keeps `#armed` pointing at the meeting through `recording`,
        deliberately — « a call under way is precisely the row to show ». This
        branch read that flag before it read the state, so
        `STATE_LABEL.recording = 'En cours'` was **unreachable on the agenda for
        every calendar-armed meeting**, which is the primary path (HR-9). Measured
        on the shipped screen: at fifty minutes into a recording the row still read
        « Prêt » and still wore the day's one filled *Enregistrer* — whose whole
        case (HR-7) is that it points at the one thing the rep is there to do, and
        it was pointing at a call already being recorded and saying it had not
        started. Every review round has photographed this on the flagship stage,
        and `DayPane.test.tsx`'s only fixture sets `armed: false` and never `true`.

        The offer and the recording are two different things to say, so the dot is
        reserved for the offer: `recording` has its own label and, below, its own
        verb — *Ouvrir*, because a call under way is opened, never started again.
      */}
      {entry.armed && entry.state !== 'recording' ? (
        <StateDot
          tone="armed"
          label="Prêt"
          className="text-label font-semibold uppercase tracking-wider"
        />
      ) : entry.state ? (
        <span className="text-muted shrink-0 text-ui">{STATE_LABEL[entry.state]}</span>
      ) : null}

      {/*
        **One row on this screen gets the weight, and the verb is the row's own.**

        Two things were wrong at once and they have one fix. The row *being
        recorded* wore the same outline *Ouvrir* as the four rows around it — and
        because `Agenda` steps *Démarrer une réunion* down beside an armed row,
        and a recording row is still armed, the home screen a rep opens mid-call
        had **no filled control anywhere**: measured at 1280×800, six controls in
        the right-hand column, all `rgb(255,255,255)` on a 1px border, and the
        header's primary bordered too. The weight had been given up and nothing
        took it.

        `filled` is decided once for the whole screen in `Agenda` (see
        `DayPaneProps.emphasis`) — the live call, else the armed offer, else the
        oldest call still `à valider`, which may be in the other list. Reading
        `entry.armed` here instead is what made that impossible to get right: it
        cannot see the recording, it cannot see the pending list, and two lists
        deciding separately is two blues.

        The **verb** stays this row's own, and it is not the same question.
        *Enregistrer* means « start capturing a call that is beginning now », which
        is what an armed row offers; *Ouvrir* means « take me to this meeting »,
        which is what a call already recording, and a compte-rendu waiting to be
        validated, both want. A live call is opened, never started again.
      */}
      {meetingId ? (
        /*
          `after:absolute after:inset-0` — the button's hit area is the row.

          A stretched pseudo-element rather than wrapping the row in a `button`:
          the row is an `li` carrying a title, a clock and a state label, and a
          button around all of it would read every one of them out as part of the
          control's name. This keeps one control with one accessible name and
          gives it the rectangle. Everything else in the row is text, so there is
          nothing underneath for the overlay to steal.
        */
        <Button
          variant={filled ? 'primary' : 'bordered'}
          className="after:absolute after:inset-0 after:content-['']"
          onClick={() => onOpen(meetingId)}
        >
          {entry.armed && entry.state !== 'recording' ? 'Enregistrer' : 'Ouvrir'}
        </Button>
      ) : entry.eventId !== null && !entry.past ? (
        /*
          **A call that has not started yet is not information.**

          The rule this slot was written to — « an entry with no meeting is
          information and carries no button (DEC-26) » — is right about a *past*
          event the app never recorded, where an *Ouvrir* would open nothing.
          It was applied to the upcoming half as well, and there it is the
          opposite of DEC-26: not a dead control, a **missing** one. Four of the
          five upcoming rows on the default agenda had nothing on them at all,
          and the row is not clickable either.

          Sales calls start early. The only control the rep had was the header's
          « Démarrer une réunion », which `meeting:create` describes as a meeting
          the calendar knows nothing about — so taking it drops `eventId`, and
          with it the attendees, « Interlocuteurs » on the compte-rendu header,
          `speakerLabel`'s one chance to name the far channel after a person
          instead of « Client », and the strongest signal account resolution has.
          The rep pays that for being on time.

          `bordered`, always, and this row is not an `emphasis` candidate at all:
          a row with no meeting has no id to name. One row owns the screen's single
          filled control (HR-7, US-26); a column of blue *Enregistrer*s down the
          upcoming list would take that weight away from the call that is actually
          happening.
        */
        <Button variant="bordered" onClick={() => onArm(entry.eventId as string)}>
          Enregistrer
        </Button>
      ) : null}

      {/* Last on a card, first on a row — see `EntryRowProps.card`. */}
      {card ? when : null}
    </Row>
  )
}

/**
 * **When the calendar was last read, and whether anything answered it.**
 *
 * One line, drawn only in the empty card, and each half appears only when it has
 * something to say: the reading time when there has been one, « Microsoft non
 * connecté » only when there is no account. On a rep who is signed in with a
 * fresh sync it is one short clause, which is all an empty Tuesday needs.
 *
 * *Connecteurs ›* is the way out of the second half and is drawn with it — a
 * sentence naming a condition with no way to act on it is the dead end DEC-26
 * forbids, and a link to the connector pane on a screen where nothing is wrong
 * would be chrome. It is `nav`, never a fill: the screen's one filled control is
 * decided in `Agenda` (US-26) and an empty day is not where it goes.
 */
function CalendarLine({
  readAt,
  now,
  onRefresh,
  refreshing,
}: {
  readAt: number | null
  now: number
  onRefresh?: () => void
  refreshing?: boolean
}) {
  // A reading that never happened has no age: « lu jamais » is not a sentence.
  if (readAt === null || readAt <= 0) return null
  const read = `Calendrier lu ${formatAgo(readAt, now)}`
  return onRefresh ? (
    <Button variant="nav" onClick={onRefresh} {...unavailable(refreshing === true, 'Lecture…')}>
      {read}
    </Button>
  ) : (
    <span>{read}</span>
  )
}
