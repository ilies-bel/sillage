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
                className="text-muted pb-hair text-meta font-medium"
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
                /*
                  **No cell gutter, and the gate that decides it is `--targets`.**

                  This was `p-0.5`: 2px a side, off a ladder whose smallest rung
                  is 4 (`design/tokens.css`), and painted 44 times on the
                  stagings that draw this grid — the single densest off-scale
                  site on the calendar. The rung above it cannot be taken. The
                  day button is `w-full`, so every pixel the cell keeps is a
                  pixel off the target. Driven at 960×600, the minimum
                  `app/main.ts` declares — not computed, each value shipped and
                  measured: 26.7×36 at `p-0.5`, and **22.7×36 at `p-hair`**,
                  which `shot.mjs --targets` answers with « 42 contrôle(s) sous
                  24 px · 23×36 — « lundi 31 août, aucune réunion » ». The rung
                  above 2 takes the whole month grid under WCAG 2.2's floor.

                  Zero is the only value on this axis that is both on the scale
                  and not a regression: **30.7×36 at 960×600** and 41×36 at
                  1280×800, against the same floor. The cells abut, which is
                  what every calendar a rep has ever used does, and `rounded-sm`
                  plus a fill that only appears on hover, today and the
                  selection keeps them told apart. `p-0` rather than no class at
                  all: the UA gives a bare `td` 1px, which is smaller still and
                  is a number nobody chose.
                */
                <td key={day} className="p-0">
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
    **The order is the code's own two axes, read down.** Filled then hollow,
    twice: square then square, dot then dot. So the pair that shares a shape is
    also the pair that shares a hue, and the four entries teach « square is the
    meeting, round is the recorder » and « filled is happening, hollow is
    offered » in one pass down the list rather than in four separate readings.
    The column reflowed as a 2×2 and does not any more — see `Legend` — so the
    pairing has to come from the order.
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
        **One entry per line, because the 2×2 never once drew as a 2×2.**

        The history is worth the paragraph. It was `flex flex-wrap`, which landed
        2/2 at 1280 and **2/1/1** at 960 — three ragged rows at the size
        `main.ts` declares as the floor. The fix was `grid-cols-2`, argued as « a
        key that reflows cannot teach a two-axis code »: hue says *which kind*,
        fill says *offered or happening*, so the columns are the two fills and
        the rows the two hues.

        The reflow moved inside the cell. This `ul` is **287 px** wide at 1280×800
        and at 1440×900, and **223 px** at 960×600 — it is fixed by the left
        column, not by the window — so two equal columns leave, after the 12 px
        `gap-x-inline` and each row's 6 px dot and 6 px `gap-tight`,
        **125.5 px** of room at the wide size and **93.5 px** at the floor.
        Measured in the legend's own 11px face: « enregistrement en cours »
        is 127.1, « réunion enregistrée » 101.1, « réunion prévue » 78.2,
        « réunion prête » 69.3.

        So at 1280 one of the four wrapped and at 960 two did — and because a
        grid row stretches, both cells of a row grew with the one that broke.
        What shipped was 17 px over 34.1 px at the wide size and 34.1 over 34.1
        at the floor: the 2×2 drawn as « enregistrement en / cours » beside
        « réunion / prête ». The wide size misses by **1.6 px**, which is not a
        margin to hold a key on across a font fallback on the primary platform
        (HR-2).

        Shortening the labels was the other way out and it is closed: the only
        set that fits 93.5 px is adjectival (« en cours », « prête »), and
        « en cours » *is* `STATE_LABEL.recording` as the row beside it draws it —
        the echo this list was corrected for two rounds ago — while a masculine
        noun (« appel prêt ») breaks the gender agreement `MARK_NAME` needs to
        keep tracking this list for a screen reader.

        One column costs 92.2 px against 59.1 at 1280 and 76.2 at 960, and buys
        four whole phrases instead of eight fragments. The two axes survive the
        turn: read down, the pairs are filled-blue, hollow-blue, filled-orange,
        hollow-orange — the same table, transposed.

        **Nothing in the harness can see this.** `--scrollers` is silent because
        a wrapped cell grows rather than clips, `--prose` counts only `.measure`
        surfaces, and `--geometry` measures only what declares `data-hangs`.
        `scratch/legend.mjs` in the round-20 report is the driver; a `--wraps`
        probe in `shot.mjs` is the standing check this wants, and that file is
        another lane's.
      */}
      {/*
        **`data-graphic`, and the legend is the stronger case of the two, not the
        weaker one.**

        The grid's dot opts in (below) and this one did not, so the four colours
        whose whole job is to be told apart were the four the 3:1 floor had never
        been measured on. `--contrast` saw them — it counted them in its
        *undeclared* census, which is a heuristic and by design never fails — so
        « contraste: texte AA, 10 graphique(s) à 3:1, 5 marque(s) non déclarée(s) »
        was printed on every agenda stage, at both sizes, with four of those five
        being this key.

        The grid's exemption argument does not reach here in either direction. A
        `StateDot` on a row is a second carrier of a word already written down —
        1.4.11's own exemption, and why it stays out. A grid cell has a date and
        nothing else, so its dot is the only thing saying which day carries the
        mark. This is the third case: the swatch is not *about* its own label, it
        is the sample a rep matches against a 6px dot two inches above. If it is
        not separable from the ground, the key does not key anything — and it is
        the one place the four appear side by side.

        Measured on the shipped screen once declared, at 1280×800 and at 960×600,
        on the aside's `--bg-card-soft` `rgb(249,251,253)`:

            réunion enregistrée      bg-brand-500       3.24:1
            réunion prévue           border-brand-500   3.24:1
            enregistrement en cours  bg-accent          3.26:1
            réunion prête            border-accent      3.26:1

        All four clear it, by a quarter of a point. That margin is the reason to
        declare rather than the reason not to: nothing was holding it, and the
        two hollow marks are carried by a 1px border, which is the thinnest ink
        this product draws.

        **And clearing the ground was never the question a key answers.** All
        four of those numbers were green while « réunion enregistrée » and
        « enregistrement en cours » measured 1.0077:1 against *each other*
        — the pair a rep actually compares, four lines apart in this very list.
        `shot.mjs --marks` asks that question now and `MARK_CLASS` carries the
        answer; the two sizes below exist because of it.

        `MARK_NAME` and not `label`, so the name this reports is the one the grid
        reports for the same mark and a census cannot show the same colour under
        two names.
      */}
      <ul className="text-muted grid grid-cols-1 gap-y-tight text-meta">
        {LEGEND.map(({ mark, label }) => (
          <li key={mark} className="flex items-center gap-tight">
            {/*
              **A fixed 8 px box around a mark that is 6 or 8 px wide**, because
              the marks stopped being one size the day shape became the second
              channel. Without it the four labels sit on two left edges 2 px
              apart — G35-12 (« the rail's five rows sit on two left edges ») in
              a key of four lines, and a key whose entries do not align is
              harder to read down than the code it teaches.
            */}
            <span aria-hidden className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
              <span data-graphic={MARK_NAME[mark]} className={cn('shrink-0', MARK_CLASS[mark])} />
            </span>
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
  /*
    **And round is the recorder, square is the meeting — because fill was the
    only channel here and hue was doing the rest of the work.**

    Measured with `shot.mjs --marks`, which exists because no pass in the
    harness had ever compared two marks to *each other*: `--accent`
    `rgb(215,112,0)` against `--brand-500` `rgb(5,148,218)` is **1.0077:1,
    ΔL\* 0.226** — a fifth of a just-noticeable lightness difference, on 6 px
    dots, one above the other in the legend and side by side in the grid. In
    greyscale, or for a blue-orange deficiency, « réunion enregistrée » and
    « enregistrement en cours » were **one mark**, and the question the month is
    read to answer is « is anything recording right now ». `--contrast` was
    green over it the whole time and correctly so: each mark clears its own
    ground at 3.24–3.26:1.

    The two colours cannot move. `--accent` is pinned at 3.38:1 on white as a
    mark and sits 1.76:1 from `--warn`, which was itself moved to hue 42° after
    three filled shapes collided at 1.48:1; `--brand-500` has 0.005 of margin on
    `--bg-subtle`. Both are therefore locked into the same lightness band, which
    is *why* they measure 1.0077:1 — so the second channel has to be shape, and
    fill-against-hollow was already spent on offered-against-happening.

    So **the round mark is the recorder** — hollow is armed, filled is rolling —
    and **the square is the meeting in the book**, hollow when it is only
    planned, filled once it is recorded.

    The size difference is load-bearing and not decoration: at one size a square
    and a circle differ only by their corners (**0.2186** for 6 px against 6 px),
    which is under the 0.30 floor. So the pairs must differ in size as well as
    in shape, and that leaves the question of *which* pair is the larger — which
    this file got backwards for the life of the mark.

    **The round mark is now the larger one, and that is a hierarchy fix, not a
    taste one.** The paragraph above says the question the month is read to
    answer is « is anything recording right now », and the answer was being
    drawn at **44.2%** of the area of a meeting that finished three weeks ago:
    a 6 px dot is 28.3 px², an 8 px square 64.0 px². A reviewer measured it off
    the shipped screen — day 17, « 5 réunions, dont une en cours
    d'enregistrement », 6 px circle; day 3, « 1 réunion, dont une enregistrée »,
    8 px square. Key and grid agreed, so it was the hierarchy and not a legend
    bug.

    `--marks` decides which orientations are available, and only two of the four
    clear its floor. Measured on `agenda`, « enregistrée » against « en cours »:

        6 px circle  vs  8 px square   0.5605   ✓   (what shipped)
        8 px circle  vs  6 px square   0.2910   ✗
        10 px circle vs  8 px square   0.2357   ✗
        10 px circle vs  6 px square   ≥0.4444  ✓   (this)

    A circle larger than the square is penalised unless the gap is wide, so
    simply swapping the two sizes fails — which is why this is 10/6 and not 8/6.
    At 10/6 the tightest pair on the screen is no longer this one at all: it is
    « enregistrée » against « prévue », one ink, fill against hollow, **0.4444**.

    What it costs: the orange circle is 10 px here and `StateDot` draws 6 px, so
    « en cours » no longer has one glyph on both surfaces — it has one *shape*
    and one ink on both, and a larger one on the surface where it is competing
    with three other marks for a scan. `Widget.tsx` draws it alone over the
    client's video, where nothing is competing with it. The fill/hollow axis
    that `MARK_CLASS` and the widget both spend (`shot.mjs`'s own false-positive
    list says so) is untouched.
  */
  recording: 'h-2.5 w-2.5 rounded-full bg-accent',
  armed: 'h-2.5 w-2.5 rounded-full border border-accent',
  captured: 'h-1.5 w-1.5 bg-brand-500',
  scheduled: 'h-1.5 w-1.5 border border-brand-500',
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
        that flickers all morning. It is 10px rather than 6 for the same reason:
        the marks are two sizes (`MARK_CLASS`), so the row is the taller of
        them and a day that changes state does not move the number above it.
        It was 8px while the square was the larger mark; it tracks whichever
        mark is tallest, so it moved when they swapped.
      */}
      <span aria-hidden className="flex h-2.5 items-center">
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
          <span data-graphic={MARK_NAME[mark]} className={MARK_CLASS[mark]} />
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
