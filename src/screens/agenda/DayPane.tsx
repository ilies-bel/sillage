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
import type { ReactNode } from 'react'
import { formatRange, formatTime, formatDayMedium, upperFirst } from '../../app/format.ts'
import { noonOf, type DayKey } from '../../app/calendar.ts'
import { Button, EmptyState, List, Row, RowTitle, SectionHeader, StateDot } from '../../ui/index.ts'
import { STATE_LABEL, type AgendaEntry } from './entries.ts'

interface DayPaneProps {
  /** Already filtered to the range on screen, ascending. */
  entries: readonly AgendaEntry[]
  /** Why the calendar has nothing to show, in its own words. May be empty. */
  reason: string | null
  /** True when Graph is not connected — changes what the empty state offers. */
  signedOut: boolean
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
  signedOut,
  showDay,
  when,
  action,
  unsynced = false,
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
        <List>
          {upcoming.map((entry) => (
            <EntryRow key={entry.key} entry={entry} showDay={showDay} onOpen={onOpen} onArm={onArm} />
          ))}
        </List>
      ) : suppressed ? null : (
        <EmptyState
          action={action}
          reason={unsynced ? undefined : reason || undefined}
          hint={
            signedOut
              ? 'Le calendrier est facultatif — vous pouvez créer une réunion sur n’importe quel jour.'
              : undefined
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
          <List>
            {past.map((entry) => (
              <EntryRow key={entry.key} entry={entry} showDay={showDay} onOpen={onOpen} onArm={onArm} />
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
  onOpen: (meetingId: string) => void
  /** Start a scheduled call now, keeping the invite (`agenda:arm`). */
  onArm: (eventId: string) => void
}

function EntryRow({ entry, showDay, onOpen, onArm }: EntryRowProps) {
  const meetingId = entry.meetingId

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
    <Row density="roomy" align="center" className={entry.armed ? 'animate-rise-in' : undefined}>
      <span className="text-muted w-28 shrink-0 tabular-nums text-ui">
        {showDay ? (
          <span className="block">{upperFirst(formatDayMedium(noonOf(entry.day)))}</span>
        ) : null}
        {entry.end === null || entry.end <= entry.start
          ? formatTime(entry.start)
          : formatRange(entry.start, entry.end)}
      </span>

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
        **The armed row gets the weight, and its own verb.**

        The call happening right now wore the same outline *Ouvrir* as the four
        rows around it, while the filled blue primary in the header —
        « Démarrer une réunion » — starts a *different*, unscheduled meeting.
        So the strongest control on the home screen pointed away from the one
        thing the rep was there to do, and the one thing they were there to do
        looked like a row of history.

        HR-7's whole case is that row. `primary` on it, and *Enregistrer* rather
        than *Ouvrir*, because those are two different acts: one opens a meeting
        that already exists, the other starts capturing a call that is beginning
        now. There is at most one armed meeting at a time (`core/domain/arming.ts`
        picks the earliest), so this stays one primary per view.
      */}
      {meetingId ? (
        <Button
          variant={entry.armed && entry.state !== 'recording' ? 'primary' : 'bordered'}
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

          `bordered`, not `primary`. There is at most one armed meeting and it
          owns the screen's single filled button (HR-7); a row of blue
          *Enregistrer*s down the upcoming list would take that weight away from
          the call that is actually starting now.
        */
        <Button variant="bordered" onClick={() => onArm(entry.eventId as string)}>
          Enregistrer
        </Button>
      ) : null}
    </Row>
  )
}
