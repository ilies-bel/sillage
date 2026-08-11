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
import { formatDayLong, formatDayNumber, formatMonthLong, formatWeekdayShort } from '../../app/format.ts'
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
      <header className="mb-2 flex items-center justify-between gap-2">
        <Button variant="text" aria-label="Mois précédent" onClick={() => onMonth(addMonths(month, -1))}>
          ‹
        </Button>
        <h2 className="text-strong text-copy capitalize">{formatMonthLong(noonOf(month))}</h2>
        <Button variant="text" aria-label="Mois suivant" onClick={() => onMonth(addMonths(month, 1))}>
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
                className="text-muted pb-1 text-label font-medium capitalize"
              >
                {formatWeekdayShort(noonOf(day))}
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
      <div className="mt-2 flex justify-center">
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
 */
const LEGEND: readonly { mark: DayMark; label: string }[] = [
  { mark: 'captured', label: 'réunion enregistrée' },
  { mark: 'armed', label: 'prêt' },
  { mark: 'scheduled', label: 'événement seul' },
]

function Legend() {
  return (
    <div className="border-subtle mt-row border-t pt-row">
      <ul className="text-muted flex flex-wrap gap-inline text-label">
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
  armed: 'bg-accent',
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
        {mark ? <span className={cn('h-1.5 w-1.5 rounded-full', MARK_CLASS[mark])} /> : null}
      </span>
    </button>
  )
}

/**
 * French, and the whole state of the cell — the dot is decoration over this.
 *
 * All three marks, because the legend under the grid promises three meanings and
 * only two used to survive into the accessible tree: `captured` and `scheduled`
 * both fell through to the bare count, so a recorded meeting and an untouched
 * Outlook invite announced identically. The distinction existed solely as
 * filled-versus-outlined on a 6px dot at 2.94:1 — colour and shape alone, which
 * is the one thing this grid's own comments say it must never be.
 *
 * The wording tracks `LEGEND` deliberately: what the eye is told and what the
 * screen reader is told are the same three sentences.
 */
const MARK_NAME: Record<DayMark, string> = {
  armed: 'dont une prête',
  captured: 'dont une enregistrée',
  scheduled: 'aucune enregistrée',
}

const cellName = (day: DayKey, count: number, mark: DayMark | null): string => {
  const date = formatDayLong(noonOf(day))
  if (count === 0) return `${date}, aucune réunion`
  const meetings = count === 1 ? '1 réunion' : `${count} réunions`
  return mark ? `${date}, ${meetings}, ${MARK_NAME[mark]}` : `${date}, ${meetings}`
}
