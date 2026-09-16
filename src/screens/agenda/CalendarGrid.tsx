/**
 * The month grid (DEC-31, VISION.md §6).
 *
 * **It is always drawn.** With no Entra registration, with Graph down, on a
 * month with nothing in it. There is no branch in this component that replaces
 * it with a panel inviting the rep to connect something — that empty grey box is
 * the specific failure DEC-31 forbids, because it teaches a rep whose product is
 * merely unconnected that it is broken. A calendar with nothing in it is a
 * calendar; it is also the thing they click to place a meeting in.
 *
 * What it never does is decide anything. It draws days and reports clicks; what
 * a day *contains* is `entries.ts`, and what happens when one is chosen is the
 * screen's.
 *
 * On the dots: colour is never the only signal (VISION.md §6). The dot is
 * `aria-hidden` and every cell carries a French accessible name that states the
 * date, how many meetings are on it and whether one of them is armed — so the
 * information is in the accessible tree whether or not the reader can see
 * orange.
 */
import { addMonths, monthMatrix, monthOf, noonOf, type DayKey } from '../../app/calendar.ts'
import {
  formatDayLong,
  formatDayNumber,
  formatMonthLong,
  formatWeekdayShort,
  upperFirst,
} from '../../app/format.ts'
import { cn } from '../../lib/utils.ts'
import { Button } from '../../ui/index.ts'
import type { DayMark } from './entries.ts'

interface CalendarGridProps {
  /** The month on screen, as any day inside it. */
  month: DayKey
  onMonth: (month: DayKey) => void
  selected: DayKey
  onSelect: (day: DayKey) => void
  /** The rep's today, so the grid can mark it without reading the clock itself. */
  today: DayKey
  marks: ReadonlyMap<DayKey, DayMark>
  counts: ReadonlyMap<DayKey, number>
}

export function CalendarGrid({
  month,
  onMonth,
  selected,
  onSelect,
  today,
  marks,
  counts,
}: CalendarGridProps) {
  const weeks = monthMatrix(month)
  const current = monthOf(month)

  /*
   * No card chrome. The grid used to be a bordered, rounded, `--bg-card` panel
   * floating on the canvas, which left the column it sits in transparent and
   * the bottom half of the window bare. The surface belongs to the column now
   * (see `Agenda.tsx`) — one panel, full height, with a border where it meets
   * the list. A card inside a panel is two edges describing one boundary.
   */
  return (
    <section aria-label="Calendrier">
      <header className="mb-snug flex items-center justify-between gap-snug">
        {/*
          `min-w-[24px]`, because a chevron is five pixels wide.
          `Button` gives every control 24px of height; the width comes from its
          label, and « ‹ » has almost none. These are the two controls a rep uses
          to look at last month, on a grid that fills the left third of the home
          screen — and they were a five-pixel target beside a heading (WCAG 2.2;
          `shot.mjs --targets` measures it).
        */}
        <Button
          variant="text"
          className="min-w-[24px]"
          aria-label="Mois précédent"
          onClick={() => onMonth(addMonths(month, -1))}
        >
          ‹
        </Button>
        <h2 className="text-strong text-copy">{upperFirst(formatMonthLong(noonOf(month)))}</h2>
        <Button
          variant="text"
          className="min-w-[24px]"
          aria-label="Mois suivant"
          onClick={() => onMonth(addMonths(month, 1))}
        >
          ›
        </Button>
      </header>

      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {weeks[0].map((day) => (
              <th
                key={day}
                scope="col"
                className="text-muted pb-hair text-label font-medium"
              >
                {upperFirst(formatWeekdayShort(noonOf(day)))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => (
                <td key={day} className="p-0.5">
                  <DayCell
                    day={day}
                    inMonth={monthOf(day) === current}
                    isToday={day === today}
                    selected={day === selected}
                    mark={marks.get(day) ?? null}
                    count={counts.get(day) ?? 0}
                    onSelect={onSelect}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        Always available, and not only when the rep has wandered off. Paging
        back three months and losing today is the one navigation dead end a
        calendar can have.
      */}
      <div className="mt-snug flex justify-center">
        <Button
          variant="text"
          onClick={() => {
            onMonth(today)
            onSelect(today)
          }}
        >
          Aujourd’hui
        </Button>
      </div>

      <Legend />
    </section>
  )
}

/**
 * What the dots mean, under the grid that draws them (`5.1 Aujourd'hui`).
 *
 * A three-colour code with nothing naming it is a code only its author can
 * read, and one of the three is the orange — the colour the palette spends its
 * strictness on (VISION.md §6). It is worth eleven words to say which.
 *
 * Built from `MARK_CLASS`, so a dot cannot change colour in the grid and keep
 * its old colour in the legend.
 *
 * **Each entry names what the day holds, and the middle one used to name a
 * *state* instead.** It was « prêt », which is `STATE_LABEL.armed` — the word the
 * row beside it already draws through `StateDot`. So on `agenda-appel-imprevu` the
 * screen said « prêt » twice, 248 pixels apart: once as a key for a 6px dot in the
 * grid and once as the condition of the row that dot points at. `shot.mjs --echo`
 * measures it at both sizes.
 *
 * « réunion prête » is the fix and it is a consistency gain rather than a dodge:
 * the other two entries are noun phrases about the day's content, and `MARK_NAME`
 * below — whose own docblock says the wording tracks this list deliberately —
 * already announces the same mark to a screen reader as « dont une prête ». The
 * state word stays where it belongs, on the row.
 */
const LEGEND: readonly { mark: DayMark; label: string }[] = [
  /*
    Read as a 2×2: filled in the left column, hollow in the right; blue on the
    top row, orange on the bottom. That is the code's own two axes, so a rep
    learns both from one glance instead of reading four entries in a line.
  */
  { mark: 'captured', label: 'réunion enregistrée' },
  { mark: 'scheduled', label: 'réunion prévue' },
  { mark: 'recording', label: 'enregistrement en cours' },
  { mark: 'armed', label: 'réunion prête' },
]

function Legend() {
  return (
    <div className="border-subtle mt-row border-t pt-row">
      {/*
        **A 2×2 grid, because a key that reflows cannot teach a two-axis code.**

        It was `flex flex-wrap`, so the four entries landed 2/2 at 1280 and
        **2/1/1** at 960 — three ragged rows at the size `main.ts` declares as the
        floor. The code has two dimensions: hue says *which kind* (blue is a
        meeting, orange is a recording) and fill says *offered or happening*. A
        wrap that puts them in an arbitrary order scrambles both, and the one
        block whose whole job is to teach the code is the first thing to break.

        Ordered so the columns are the two fills and the rows the two hues, which
        is the code drawn as a table rather than a sentence.
      */}
      <ul className="text-muted grid grid-cols-2 gap-x-inline gap-y-tight text-label">
        {LEGEND.map(({ mark, label }) => (
          <li key={mark} className="flex items-center gap-tight">
            <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', MARK_CLASS[mark])} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface DayCellProps {
  day: DayKey
  inMonth: boolean
  isToday: boolean
  selected: boolean
  mark: DayMark | null
  count: number
  onSelect: (day: DayKey) => void
}

/**
 * The three marks, and why the third exists.
 *
 * VISION.md §6 names two — blue for a captured meeting, orange for armed. A day
 * that carries only an invite nobody has opened yet is neither, and drawing
 * nothing there would make the grid disagree with the list beside it. It gets
 * the outline of the blue dot: present, unfilled, and never mistaken for the
 * filled one at a glance.
 */
const MARK_CLASS: Record<DayMark, string> = {
  /*
    **Filled is happening, hollow is offered** — the same split `StateDot` makes
    on the row this dot points at, so the grid and the list agree. It did not:
    a recording call is also armed, so it took the armed mark and the legend
    called that « réunion prête ». The grid said *ready* about a call in
    progress.
  */
  recording: 'bg-accent',
  armed: 'border border-accent',
  captured: 'bg-brand-500',
  scheduled: 'border border-brand-500',
}

function DayCell({ day, inMonth, isToday, selected, mark, count, onSelect }: DayCellProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-pressed={selected}
      aria-current={isToday ? 'date' : undefined}
      aria-label={cellName(day, count, mark)}
      className={cn(
        'flex h-9 w-full flex-col items-center justify-center gap-tight rounded-sm text-ui transition',
        selected
          ? 'bg-brand-50 text-brand-700 font-medium'
          : inMonth
            ? 'text-body hover:bg-subtle'
            : 'text-muted hover:bg-subtle',
        isToday && !selected && 'font-semibold',
      )}
    >
      <span aria-hidden className="tabular-nums leading-none">
        {formatDayNumber(noonOf(day))}
      </span>
      {/*
        The dot's row is always laid out, whether or not there is a dot in it —
        a grid whose numbers shift by two pixels as meetings arrive is a grid
        that flickers all morning.
      */}
      <span aria-hidden className="flex h-1.5 items-center">
        {mark ? (
          /*
            `data-graphic`, because here the dot is the whole signal.

            `StateDot` refuses to render without a *visible* label beside it, so
            on a row the dot is a second carrier of something already written
            down — that is the exemption 1.4.11 allows and why it does not opt
            in. A calendar cell has a date and nothing else: the legend under the
            grid explains the code, but only this mark says which day carries it.
            Undeclared, it was invisible to `--contrast`, which printed
            « 0 graphique(s) » on the one screen the marks are the point of.
          */
          <span
            data-graphic={MARK_NAME[mark]}
            className={cn('h-1.5 w-1.5 rounded-full', MARK_CLASS[mark])}
          />
        ) : null}
      </span>
    </button>
  )
}

/**
 * French, and the whole state of the cell — the dot is decoration over this.
 *
 * All four marks, because the legend under the grid promises four meanings and
 * only two used to survive into the accessible tree: `captured` and `scheduled`
 * both fell through to the bare count, so a recorded meeting and an untouched
 * Outlook invite announced identically. The distinction existed solely as
 * filled-versus-outlined on a 6px dot at 2.94:1 — colour and shape alone, which
 * is the one thing this grid's own comments say it must never be.
 *
 * And for a while `scheduled` was the opposite defect: it survived here, was
 * spoken, and was drawn by nothing, because `DayCell` guarded
 * `mark !== 'scheduled'`. A state in the accessibility tree and on no pixel.
 *
 * The wording tracks `LEGEND` deliberately: what the eye is told and what the
 * screen reader is told are the same three sentences.
 */
const MARK_NAME: Record<DayMark, string> = {
  // The spoken names track `LEGEND` deliberately — see its docblock. A rep
  // using a screen reader hears the same distinction the dot now draws.
  recording: 'dont une en cours d’enregistrement',
  armed: 'dont une prête',
  captured: 'dont une enregistrée',
  /*
    « réunion prévue », the same fact `LEGEND` draws — not « aucune enregistrée ».
    This said what the day *lacked* while the dot says what it *holds*, so a
    screen-reader rep and a sighted rep were told opposite things about the same
    mark, under a docblock asserting the two track each other.
  */
  scheduled: 'dont une prévue',
}

const cellName = (day: DayKey, count: number, mark: DayMark | null): string => {
  const date = formatDayLong(noonOf(day))
  if (count === 0) return `${date}, aucune réunion`
  const meetings = count === 1 ? '1 réunion' : `${count} réunions`
  return mark ? `${date}, ${meetings}, ${MARK_NAME[mark]}` : `${date}, ${meetings}`
}
