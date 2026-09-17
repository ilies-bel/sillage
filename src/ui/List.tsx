/**
 * Rows, not cards (VISION.md §6). Density over decoration.
 *
 * `List` is the bordered, hairline-divided container that appears eleven times
 * across `Agenda`, `Réglages`, `Historique` and `Review` as the same eight
 * utilities retyped:
 *
 *     border-card divide-y divide-[var(--border-subtle)] overflow-hidden rounded-lg border
 *
 * That `divide-[var(--border-subtle)]` arbitrary value is the tell. It is there
 * because Tailwind's `divide-*` reads `borderColor`, the config maps `subtle`
 * there, and every author independently rediscovered the escape hatch. One
 * component, one place to fix it if the divider ever changes.
 *
 * `Row` carries the two paddings the screens use — the dense one from Réglages
 * and the roomier one from Agenda — as a variant rather than as a difference
 * nobody chose.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ElementType, ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export interface ListProps {
  children: ReactNode
  /** `ul` by default; `div` when the rows are not list items. */
  as?: Extract<ElementType, 'ul' | 'ol' | 'div'>
  /**
   * The list's accessible name, in French.
   *
   * Worth having wherever a screen holds more than one list, which since the
   * search landed is most of them: a filter chip and the row it filters to
   * carry the *same* words — « Acme Industries » is both — so an unnamed list
   * of results is a list nobody can address, by assistive technology or by a
   * test. Naming the results is what makes "the chips" and "the calls" two
   * different things rather than one ambiguous one.
   */
  label?: string
  /**
   * Drop the box: hairlines between the rows, and no edge stroke, no radius.
   *
   * **For a list whose grouping is already stated above it.** A `SectionHeader`
   * — a short accent rule and an uppercase label — plus `--space-block` under it
   * says « these belong together » on its own; the surrounding rectangle then
   * says it a second time, and a screen that says it three times in a column
   * (the calendar's day, *Passées*, *En attente de validation*) reads as three
   * competing containers rather than one list of a rep's calls.
   *
   * It is also what the reference does (`docs/stories/ref/granola-home.png`):
   * their note list draws no row borders at all — icon, title, subtitle,
   * right-aligned time, separated by a date caption and whitespace. VISION.md §6
   * has asked for « rows, not cards, for lists — density over decoration » from
   * the beginning; the boxes are the drift, not this.
   *
   * The hairlines stay. Their list is eight rows on a dark ground with no
   * trailing controls; ours carries a button on the right of every row, and
   * with nothing between them two adjacent rows read as one row with two
   * buttons.
   */
  bare?: boolean
  className?: string
}

/*
 * **`bare` carried a clip with nothing to clip, and it cut an arrival in half.**
 *
 * `overflow-hidden` belongs to the bordered variant: it is what stops the first
 * and last rows' square corners painting outside `rounded-lg`. `bare` has
 * neither the border nor the radius, so it inherited a clip whose only remaining
 * subject was whatever crossed the list's own edge — and the one thing that does
 * is `riseIn`, the 3px translate an arriving row enters on.
 *
 * Measured on `agenda-appel-imprevu`, whose upcoming list is one row the instant
 * a call is detected: « ascenseurs: ul.divide-y — 3px cachés en y (boîte 61px) »
 * at 1280×800 and 71px at 960×600. Not a fixture shape — a list holding one
 * arriving row is the first arming of any day with a single meeting ahead of it,
 * and the rep sees the bottom 3px of that row cut for the length of the
 * animation.
 *
 * It took a restaging to surface because the previous fixture always put a row
 * after the arriving one, so the translate landed in a neighbour's space instead
 * of over the edge. Arranging a fixture around an artefact is not the same as
 * not having one.
 */

export function List({ children, as: Tag = 'ul', label, bare = false, className }: ListProps) {
  return (
    <Tag
      aria-label={label}
      className={cn(
        'divide-y divide-[var(--border-subtle)]',
        bare ? '' : 'border-card overflow-hidden rounded-lg border',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

const row = cva('bg-card flex min-w-0 gap-inline', {
  variants: {
    density: {
      /** Réglages: provider lines, connector lines, findings. */
      dense: 'px-row py-2.5',
      /** Agenda and Historique: a title with a subtitle under it. */
      roomy: 'px-block py-3.5 gap-row',
      /**
       * A row that is a card of its own: *Passées*, the validation queue, the
       * reader's calls. 16px by 10px — `--space-row` and the same vertical as
       * `dense` — so that the three lists a rep scans on the home screen are one
       * rectangle and not three near-misses. The edge stroke and the radius are
       * the caller's, because only the caller knows whether the card is a `li`,
       * a `button` or a wrapper around both.
       */
      card: 'px-row py-2.5 gap-row',
    },
    align: { baseline: 'items-baseline', center: 'items-center' },
    interactive: { true: 'hover:bg-card-soft w-full text-left transition', false: '' },
  },
  defaultVariants: { density: 'dense', align: 'baseline', interactive: false },
})

export interface RowProps extends VariantProps<typeof row> {
  children: ReactNode
  as?: Extract<ElementType, 'li' | 'div'>
  className?: string
}

export function Row({ children, as: Tag = 'li', className, ...variants }: RowProps) {
  return <Tag className={cn(row(variants), className)}>{children}</Tag>
}

/**
 * **The leading cell: the clock, and the reason every row starts on one edge.**
 *
 * Measured at 1280×800 on the agenda, the one screen `docs/stories/ref/
 * granola-home.png` is the direct comparison for, three sections shared one
 * uninterrupted scroller and drew three different row grammars:
 *
 *     section      title x   clock      button right
 *     schedule       724     leading        1228
 *     Passées        592     trailing       1135
 *     En attente     676     leading        1228
 *
 * A 132px spread of title left edges and 93px of rag on the buttons. Two causes:
 * *Passées* moved its clock to the trailing edge, which both un-indented its
 * titles and pushed its buttons off the right edge the other two share; and the
 * two leading clocks were `w-28` and `w-16`, so even the sections that agreed
 * about the shape disagreed about the width.
 *
 * The geometry was not new — it predates the round that took the borders off.
 * What that round changed is that the box bracketing *Passées* is gone, so the
 * three grammars now sit on one continuous ground with nothing saying why the
 * shape changes mid-column. Their list drops the strokes **and** keeps one grid;
 * the rigid grid is what makes dropping the strokes affordable.
 *
 * So: one width, named once, wide enough for the longest thing any list puts
 * here — « 14:30 – 15:30 » at `--type-ui`, tabular. A short date (« 11/09 »)
 * sits in the same column with slack rather than in a column of its own.
 */
export function RowLead({ children }: { children: ReactNode }) {
  return <span className="text-muted w-28 shrink-0 tabular-nums text-ui">{children}</span>
}

/**
 * The middle cell: a title and, when there is one, a subtitle under it.
 *
 * **The title wraps to two lines; the subtitle still truncates.** Both used to
 * truncate, on the argument that « a client name long enough to wrap turns a
 * scannable list into a ragged one ». That is right at 1280×800, where the
 * titles fit on one line and this clamp therefore changes nothing. It is wrong
 * at the 960×600 minimum `main.ts` declares, where it was measured cutting all
 * three of the day's meetings — « Néovia San… », « Banque Delcourt… », « Arkelia
 * Logistiqu… », eleven of thirty-five characters kept on the first — and a
 * meeting a rep cannot identify is worse than a row that is one line taller.
 *
 * Two lines and not `break-words`: the raggedness the old rule feared is real,
 * and this bounds it. The subtitle is the attendee list, which is the field that
 * can run to any length and the one a rep scans past, so it keeps `truncate`.
 *
 * `title` is `--ink-rep` and `subtitle` is `--ink-agent` nowhere near by
 * accident — provenance is colour and only colour (DEC-5), so these two are the
 * strong/muted pair everywhere else uses and the pairing stays consistent.
 */
export interface RowTitleProps {
  title: ReactNode
  subtitle?: ReactNode
  className?: string
}

export function RowTitle({ title, subtitle, className }: RowTitleProps) {
  return (
    <span className={cn('min-w-0 flex-1', className)}>
      {/*
        No `block` beside the clamp: `line-clamp-2` *is* a display utility
        (`display: -webkit-box`), and a `block` next to it wins and makes the
        clamp inert — the title then wrapped to as many lines as it liked, which
        is the raggedness the two-line bound exists to prevent. `check:tokens`
        catches this pair; it caught this one.
      */}
      <span className="text-strong line-clamp-2 text-copy">{title}</span>
      {subtitle ? <span className="text-muted block truncate text-ui">{subtitle}</span> : null}
    </span>
  )
}
