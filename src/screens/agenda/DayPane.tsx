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
 *    information: it is a call that can be started, and it carries *Préparer*
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
import { useLeaving } from '../../app/useLeaving.ts'
import { cn } from '../../lib/utils.ts'
import {
  Button,
  EmptyState,
  List,
  Row,
  RowLead,
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
   * Arm a scheduled call now, keeping the invite it came from (*Préparer*).
   *
   * Separate from `onOpen` because they are different acts on different things:
   * one opens a meeting that exists, the other asks `agenda:arm` to bring one
   * into being from a calendar event — which is the same path the clock takes,
   * so the attendees and the subject survive.
   *
   * It does **not** start a capture, and the verb no longer says it does — see
   * the control itself. `session:command { start }` is reached from exactly two
   * places in this product and neither of them is a day row.
   */
  onArm: (eventId: string) => void
}

/** Declared once: a new lambda each render would re-fire `useLeaving`'s effect. */
const entryKey = (entry: AgendaEntry): string => entry.key

/**
 * The divider DEC-31 draws, exported for the same reason `PENDING_HEADING` is:
 * `agenda/__tests__/labels.test.ts` compares every heading on this screen
 * against every state word the rows can print, and it has to read the strings
 * the product draws rather than copies of them.
 */
export const PAST_HEADING = 'Passées'

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

  /*
   * The upcoming half, plus whatever has just been withdrawn from it, held for
   * one `--motion` so it can leave. Only this half: `past` grows by a row
   * arriving, never by one being taken away.
   */
  const leavingUpcoming = useLeaving(upcoming, entryKey)

  return (
    <div className="min-h-0">
      {upcoming.length > 0 || leavingUpcoming.length > upcoming.length ? (
        <List bare>
          {leavingUpcoming.map((entry) => (
            <EntryRow
              key={entry.key}
              entry={entry}
              showDay={showDay}
              filled={entry.meetingId !== null && entry.meetingId === emphasis}
              onOpen={onOpen}
              onArm={onArm}
              leaving={entry.leaving}
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
          <SectionHeader>{PAST_HEADING}</SectionHeader>
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
            from a record is the section header above it and the `--space-block`
            under that — which is all it ever needed. The round that removed the
            boxes first kept a *second* carrier as well, moving the clock to the
            trailing edge down here; measured, that left three row grammars on
            one continuous ground — a 132px spread of title left edges and 93px
            of rag on the buttons — which is worse than the border it replaced.
            `ui/List.tsx`'s `RowLead` is the single grid all three now sit on.

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
          {suppressed && action ? <div className="mt-snug">{action}</div> : null}
        </section>
      ) : null}
    </div>
  )
}

interface EntryRowProps {
  /** Withdrawn, and held for one `--motion` so it can leave — `useLeaving`. */
  leaving?: boolean
  entry: AgendaEntry
  showDay: boolean
  /** This is the screen's one filled control — see `DayPaneProps.emphasis`. */
  filled: boolean
  onOpen: (meetingId: string) => void
  /** Arm a scheduled call now, keeping the invite (`agenda:arm`) — *Préparer*. */
  onArm: (eventId: string) => void
}

function EntryRow({ entry, showDay, filled, onOpen, onArm, leaving }: EntryRowProps) {
  const meetingId = entry.meetingId

  /*
   * **The clock leads, on every row of this pane and of the queue beside it.**
   *
   * It used to move: leading on the schedule, trailing on *Passées*, on the
   * argument that in a schedule the clock is the index and in a record of calls
   * already held it is a detail. The argument is sound and the border it lived
   * inside used to carry it. That border is gone, so what the rep now sees is
   * one continuous column in which the shape changes twice for no stated reason
   * — measured, a 132px spread of title left edges and 93px of rag on the
   * buttons across three sections of one scroller.
   *
   * The distinction it was drawing is still drawn: `SectionHeader` and the
   * `--space-block` above it say « these already happened », which is what the
   * geometry was re-stating a second time and less clearly.
   */
  const when = (
    <RowLead>
      {showDay ? (
        <span className="block">{upperFirst(formatDayMedium(noonOf(entry.day)))}</span>
      ) : null}
      {entry.end === null || entry.end <= entry.start
        ? formatTime(entry.start)
        : formatRange(entry.start, entry.end)}
    </RowLead>
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
      density="roomy"
      align="center"
      /*
        No edge stroke: the list above owns the grouping now.

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

        **And the hover ground follows the target, which for one round it did
        not.** `hover:bg-subtle` sat here unconditionally while the stretch was
        given to one branch, so the `onArm` rows lit the full row under the
        cursor exactly like the rows above and below them and answered nothing
        when pressed. Measured at 1280×800 and at 960×600, on the day list, the
        week and *Liste*:

            vue      lignes  cible + survol  survol SANS cible
            jour        6          3               2
            semaine    11          5               5
            liste      14          9               5

        Five of fourteen rows in one uninterrupted scroller, indistinguishable
        from the nine that are targets — and they are the five upcoming invites,
        which is the offer `agenda-demarrer-tot` exists to protect. A hover ground
        is the strongest « this is a target » a list has; paint it on a row that
        is not one and the row is a control that does nothing.

        So the ground is drawn on the same condition as the stretch. The `onArm`
        row is not left mute: its own control is `bordered`, which carries
        `hover:bg-subtle` of its own (`ui/Button.tsx`), so the feedback is the
        size of the thing that answers.
      */
      className={cn(
        'relative transition',
        // The same condition the stretched hit area is drawn on, below.
        entry.meetingId !== null && 'hover:bg-subtle',
        /*
          **`!leaving`, because a row cannot be arriving and leaving at once.**

          These two were independent conditions, so a row that was withdrawn
          while its arrival was still running wore both — and a CSS *animation*
          outranks a *transition* on the same property, so `riseIn`'s
          `opacity: 0 → 1` on `--ease-out` painted over `.leaving`'s
          `opacity: 0` on `--ease-in` for the rest of its 150 ms. The departure
          did not start until the arrival finished.

          Measured on `session-attente-sortie`, which is the stage where the two
          overlap: at the frame `.leaving` lands, `el.getAnimations()` answers
          `[{ riseIn, running, currentTime: 17 }]` and `--motion` reads
          « li.bg-card — 150ms / cubic-bezier(0.22,1,0.36,1) : part moyenne du
          changement déjà faite 83 % ». Ease-out on the way in, ease-in on the
          way out — not both on one element.

          Nothing could see it until this round: `--motion` runs after
          `settled()`, which waits every `.leaving` out before it measures, so
          the one pass that judges departure curves was handed a page with no
          departures on it. `motionReader` is what changed.

          The other two rungs of this ladder already spell it exclusively —
          `Reglages.tsx` and `Review.tsx` both write
          `leaving ? 'leaving' : 'animate-rise-in'`, the shape `useDismiss`'s own
          docblock shows. This row was the one that did not.
        */
        entry.armed && !leaving && 'animate-rise-in',
        /*
          And the other end of it. The offer arrived over 150 ms of
          `animate-rise-in` and was removed between two frames — VISION §6 asks
          for « ease-out on the way in, ease-in on the way out » and only half of
          it was built, which `--motion` has reported as « 0 qui s'en vont » on
          every app screen for six rounds. It matters most on this row because
          this row is the screen's one filled control: a control that size
          vanishing with no frame in between reads as a misclick.
        */
        leaving && 'leaving pointer-events-none',
      )}
    >
      {when}

      <RowTitle title={entry.title} subtitle={entry.subtitle ?? undefined} />

      {/*
        The accent dot and the word it means, as one thing. VISION.md §6 asks
        for quiet, so it is 6px and it does not pulse; it carries a text label
        because colour alone cannot state a condition that changes what a
        button does. And the orange stays on the dot: `--accent` is 3.38:1 — the
        floor a *graphic* is held to — so `text-accent` on the word *Prêt* would
        render it at 3.35:1 on the card, short of the 4.5 a word needs.
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
        « Prêt » and still wore the day's one filled control — whose whole
        case (HR-7) is that it points at the one thing the rep is there to do, and
        it was pointing at a call already being recorded and saying it had not
        started. Every review round has photographed this on the flagship stage,
        and `DayPane.test.tsx`'s only fixture sets `armed: false` and never `true`.

        The offer and the recording are two different things to say — and for a
        round the screen said only one of them. `recording` fell through to the
        plain `STATE_LABEL` span, so a **live call** was « En cours » at
        `--type-ui` in `--text-muted`, sentence case, no dot: pixel-identical to
        « À valider » and « Validée », and quieter than the *offer* two rows
        above it, which had the dot, the uppercase, the weight and the tracking.

        The product spent its whole state vocabulary on the thing that had not
        happened and none on the thing that was happening, on the screen a rep
        opens mid-call. « Armed is an offer, never a recording » (HR-7) is the
        product's central safety claim, and a rep could not read which of the two
        they were looking at without reading a 12px word.

        Both are the accent now — VISION.md §6 gives that colour to « armed *or*
        recording », which is why `StateDot`'s tone is called `armed` and means
        both — and the *label* is what separates them. That is the honest split:
        the colour says « this meeting is live in some sense », which is true of
        both, and the word says which.
      */}
      {entry.state === 'recording' || entry.armed ? (
        <StateDot
          tone={entry.state === 'recording' ? 'recording' : 'armed'}
          label={entry.state === 'recording' ? STATE_LABEL.recording : 'Prêt'}
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

        **And the verb is no longer the row's own, because the act is not the
        row's own.** This branch had two labels over one `onClick`: an armed row
        said *Enregistrer*, everything else said *Ouvrir*, on the argument that
        « an armed meeting is one the rep is about to record ». Driven through the
        shipped screen (`scratch/verbs.test.tsx`), with an armed row and an
        upcoming invite on one day:

            VERBS ON SCREEN: ["Démarrer une réunion","Enregistrer","Enregistrer"]
            PRESS «Enregistrer» #0: channels=[]                          navigated=true
            PRESS «Enregistrer» #1: channels=["agenda:arm", …]           navigated=true
            PRESS «Démarrer une réunion»: channels=["meeting:create","session:command", …]

        Two identical rectangles, two different acts — and **neither of them
        records**. The armed row's press reaches no channel at all: it is
        `onOpen`, the same navigation the three rows under it perform, and
        `Agenda.armNow`'s own docblock says so (« It opens the session but does
        **not** start recording: HR-7 says arming is an offer a human accepts »).
        The one control on the screen that does dispatch `session:command
        { start }` is the header's *Démarrer une réunion*, whose verb is the other
        one. The product's capture verb is *Démarrer* — `Session.tsx` uses it for
        the press that opens the microphone — so *Enregistrer* on a day row was
        the capture verb on the two controls that do not capture, on the screen a
        rep opens every morning, in front of HR-7's « armed is an offer, never a
        recording ».

        So the word follows the act. This branch is `onOpen` on every row, so it
        is *Ouvrir* on every row; the `onArm` branch below is a different act and
        gets a different word. What separates the armed row from the four under
        it is `StateDot`'s « PRÊT » and the fill — a state and an emphasis, which
        is what they are — and no longer a verb making a promise the press does
        not keep.
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
          /*
            **The row is the target wherever the verb is « Ouvrir », which is
            now every row this branch draws.**

            The stretch used to be withheld from the armed row, and the reason
            was sound while that row said *Enregistrer*: measured on
            `agenda-appel-imprevu`, `elementFromPoint` at 30% across a 672px row
            returned a button carrying the product's capture verb, and a 672px
            invisible rectangle is a lot of surface on which to say the wrong
            thing about recording a client.

            The word is right now, so the rule it encoded — « the stretch follows
            the word » — puts the rectangle back. Every press here is `onOpen`,
            navigation is reversible, and a rep who lands on the wrong session
            screen presses *Retour*. The `onArm` branch below still has no
            stretch, and that is the half of the rule that matters: arming mints
            a meeting, and « the rep clicked somewhere in a 1050px rectangle » is
            not how one should begin.
          */
          className="after:absolute after:inset-0 after:content-['']"
          onClick={() => onOpen(meetingId)}
        >
          Ouvrir
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
          filled control (HR-7, US-26); a column of blue verbs down the upcoming
          list would take that weight away from the call that is actually
          happening.

          **« Préparer », and it used to say « Enregistrer ».** Driven at the
          bridge (`scratch/verbs.test.tsx`), the press reaches
          `agenda:arm` → `agenda:snapshot` → `meeting:list` and then navigates.
          It reaches `session:command` never. `Agenda.armNow`'s own docblock is
          explicit — « It opens the session but does **not** start recording:
          HR-7 says arming is an offer a human accepts, and the rep pressing a
          row is asking to be taken to the call, not to have capture begin behind
          a list » — so the button was the product's capture verb on a press that
          does not capture, and it was the *same* word as the armed row above,
          which does not even do this much. One verb, two acts, on a screen whose
          central safety claim is that arming is not recording.

          *Préparer* is what happens: the invite becomes a meeting carrying its
          `eventId`, its subject and its attendees, the row starts wearing « PRÊT »
          — the same word — and the session screen it opens offers *Démarrer*,
          which is this product's one verb for opening a microphone (`Session.tsx`,
          and the header's *Démarrer une réunion* beside this list). Two presses,
          which is what the code has always done; the second one is now the only
          one that claims to.
        */
        <Button variant="bordered" onClick={() => onArm(entry.eventId as string)}>
          Préparer
        </Button>
      ) : null}

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
