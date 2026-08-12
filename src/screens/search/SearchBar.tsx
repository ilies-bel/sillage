/**
 * The search (VISION.md §6, screen 1) — a field and one line of chips.
 *
 *   ┌ ⌕ Rechercher un client, un sujet, un mot dit…       Tout l’historique › ┐
 *   │ 7 jours · 30 jours · 90 jours │ À valider · … │ Tâche · … │ Acme · No…→ │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * Three things it is, and one it is not.
 *
 * **It is one component on two screens.** VISION.md §6 says *Historique* is the
 * expanded form of this same query — « the same field, the same filter chips,
 * carried over ». Two implementations would drift, and the day they did, the
 * expanded form would answer a different question from the one the rep typed.
 *
 * **It is inline.** No dropdown, no popover, no dialog (HR-10). Every value on
 * every axis is one click away, and pressing a pressed chip is how a filter
 * comes off. There is no hidden state.
 *
 * **It holds nothing.** `query` and `filter` are the caller's, and the results
 * are the main process's. This component has no list of meetings in it and no
 * way to acquire one — which is what makes « the renderer never holds a corpus
 * it did not ask for » a property of the code rather than a promise.
 *
 * What it is not is a form. There is no submit: the caller debounces and asks.
 *
 * ## Why one line, and what it cost
 *
 * It was four rows — one per axis, each headed by a « Tous / Toute / Toutes »
 * chip — stacking ~90px of chrome above the day list on the screen the app
 * opens on. Two things had to give for one line, and only one of them is a
 * trade:
 *
 * 1. **The neutral chips went** (`filters.ts`). They were ~45% of the width and
 *    they bought an axis name most readers do not need and a reset a pressed
 *    chip can do itself. No trade — the row is shorter and says the same thing.
 *
 * 2. **The line scrolls**, with the axes ordered so that what scrolls off is
 *    the least missed. First the three closed enumerations, nine chips and
 *    always the same nine; last the client facet, up to `CLIENT_FACET_LIMIT`
 *    (12) names of arbitrary length that are already a sample of a longer list
 *    and are all reachable by typing in the box.
 *
 * The scroller was drafted around the client axis alone, the enumerations held
 * fixed beside it on the argument that a closed vocabulary must be visible
 * whole or the rep cannot know what the filter can do. It got as far as the
 * screenshot: at `minWidth` (960px, `app/main.ts`) the *Intention* axis ran
 * past the edge of the pane and « Mail » was not on screen at all — clipped by
 * a column that has no business scrolling sideways, and by nothing this
 * component could fade or scroll. The guarantee was never available at that
 * width; holding it only moved the clipping onto the axis with no way to
 * recover. So the whole line scrolls, and « Effacer » stays outside it, because
 * a reset that scrolls out of view is a reset a rep cannot find.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { HistoryFilter } from '../../../electron/core/contracts/history.ts'
import { Button, Chip } from '../../ui/index.ts'
import {
  INTENTIONS,
  INTENTION_LABEL,
  isFiltering,
  NO_FILTER,
  PERIODES,
  PERIODE_LABEL,
  STATUTS,
  STATUT_LABEL,
} from './filters.ts'

export interface SearchBarProps {
  query: string
  onQuery: (query: string) => void
  filter: HistoryFilter
  onFilter: (filter: HistoryFilter) => void
  /**
   * The client names the chips offer, from the main process. Empty on an empty
   * corpus and while the first answer is in flight — in which case the axis is
   * not drawn at all, rule included, because an axis with nothing in it is a
   * separator with a gap after it and a control that does nothing (DEC-26).
   */
  clients: readonly string[]
  /**
   * Opens *Historique* on this same query and these same chips — permanently,
   * whatever the field holds and whatever came back.
   *
   * Omitted on *Historique* itself, which is already the expanded form. It is
   * mandatory on the calendar, and the reason is a dead end that shipped: the
   * only link into *Historique* used to live at the foot of the result list, so
   * it appeared only when a search returned at least one row. On an empty
   * corpus — a fresh install, the first day of the demo — the screen the whole
   * record lives behind could not be opened at all. A rep who has never
   * recorded anything is exactly the rep who needs to see that the room exists.
   */
  onHistorique?: () => void
  className?: string
}

export function SearchBar({
  query,
  onQuery,
  filter,
  onFilter,
  clients,
  onHistorique,
  className,
}: SearchBarProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-inline">
        <input
          type="search"
          aria-label="Rechercher un client, un sujet, une transcription ou une note"
          placeholder="Rechercher un client, un sujet, un mot dit en réunion…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          maxLength={200}
          className="text-strong bg-inner border-card placeholder:text-muted min-w-0 flex-1 rounded-sm border px-2.5 py-1.5 text-ui"
        />

        {onHistorique ? (
          <Button variant="text" className="shrink-0" onClick={onHistorique}>
            Tout l’historique ›
          </Button>
        ) : null}
      </div>

      {/* One line: every axis in one scroller, and the reset outside it. */}
      <div className="mt-2 flex items-center gap-tight">
        {/* Joined rather than passed as the array: the caller writes
            `clients={result?.clients ?? []}`, so a fresh `[]` arrives on every
            render with no answer yet and an identity dep would re-measure on
            each one. */}
        <Scroller deps={[clients.join('\0')]}>
          <Axis
            label="Période"
            values={PERIODES}
            labels={PERIODE_LABEL}
            current={filter.periode}
            neutral={NO_FILTER.periode}
            onSelect={(periode) => onFilter({ ...filter, periode })}
          />

          <Rule />

          <Axis
            label="Statut"
            values={STATUTS}
            labels={STATUT_LABEL}
            current={filter.statut}
            neutral={NO_FILTER.statut}
            onSelect={(statut) => onFilter({ ...filter, statut })}
          />

          <Rule />

          <Axis
            label="Intention"
            values={INTENTIONS}
            labels={INTENTION_LABEL}
            current={filter.intention}
            neutral={NO_FILTER.intention}
            onSelect={(intention) => onFilter({ ...filter, intention })}
          />

          {/*
            The client axis, last and inside the same scroller: it is the axis
            whose values are data rather than vocabulary, so it is the one that
            can be cut without the rep losing sight of what the filter can do.
            Drawn at all only when the main process offers names — an axis
            holding nothing is a control that does nothing (DEC-26).
          */}
          {clients.length > 0 ? (
            <>
              <Rule />
              <div role="group" aria-label="Client" className="flex shrink-0 gap-tight">
                {clients.map((client) => (
                  <Chip
                    key={client}
                    pressed={filter.client === client}
                    onClick={() =>
                      onFilter({ ...filter, client: filter.client === client ? null : client })
                    }
                  >
                    {client}
                  </Chip>
                ))}
              </div>
            </>
          ) : null}
        </Scroller>

        {/*
          The reset that the four neutral chips used to be, in one control and
          only while there is something to reset — a permanent « Effacer » over
          an untouched filter is the dead control DEC-26 forbids. It sits at the
          end of the line rather than the head of it: appearing at the head
          would shove every chip sideways the moment the rep pressed one.
        */}
        {isFiltering(filter) ? (
          <Button variant="text" className="ml-inline shrink-0" onClick={() => onFilter(NO_FILTER)}>
            Effacer
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One enumerated axis: its chips, and nothing else on screen.
 *
 * The name is here as the `role="group"` label, which is what a screen reader
 * announces before the chips and what these groups are found by in the tests.
 * Nothing captions them visually — the chips name themselves (`filters.ts`) and
 * the rules separate them.
 *
 * Not `radiogroup`: these are toggles, and the markup should say what it is (the
 * same distinction `Segmented` draws against `SectionNav`). The toggle is also
 * the only way off an axis now, so it is load-bearing rather than decorative —
 * pressing the pressed chip sends `neutral` back.
 */
function Axis<Value extends string, Neutral extends string>({
  label,
  values,
  labels,
  current,
  neutral,
  onSelect,
}: {
  label: string
  values: readonly Value[]
  labels: Record<Value, string>
  current: Value | Neutral
  neutral: Neutral
  onSelect: (value: Value | Neutral) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-tight">
      {values.map((value) => (
        <Chip
          key={value}
          pressed={current === value}
          onClick={() => onSelect(current === value ? neutral : value)}
        >
          {labels[value]}
        </Chip>
      ))}
    </div>
  )
}

/**
 * The line itself, and the three ways to move it.
 *
 * The fade is measured rather than always drawn: a permanent gradient over a
 * row that fits would dim a chip that is entirely on screen, which is a lie in
 * the one direction that matters (it says « there is more » when there is not).
 * `data-fade` names which edges are cut and `.filter-scroller` in
 * `design/index.css` masks those; a browser without `ResizeObserver` — jsdom,
 * where the renderer's tests run — simply keeps whatever the first pass found.
 *
 * The wheel handler is the mouse's way in, and it is here because the measured
 * answer contradicted the assumption: Chromium does **not** turn a vertical
 * wheel into horizontal scrolling on a row like this. It hands the tick to the
 * nearest ancestor that scrolls vertically, so a mouse over the chips scrolled
 * the day list behind them and the chips past the edge could not be reached at
 * all without a trackpad or the Tab key. A horizontal gesture (`deltaX`) is left
 * alone — the browser already scrolls this element with it, and handling it too
 * would move the row twice per flick — and a tick that would hit either end is
 * not swallowed, so the page keeps scrolling once the row has nothing left to
 * give. The third way is the Tab key, which the browser handles by itself: a
 * chip past the edge is still a tab stop and focusing it scrolls it into view.
 *
 * `deps` is what the row holds, so the measurement is redone when the client
 * facet arrives or changes. A width change needs no dep — that is the
 * `ResizeObserver`, and it fires for « Effacer » appearing beside the row too.
 */
function Scroller({ children, deps }: { children: ReactNode; deps: readonly unknown[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<'none' | 'start' | 'end' | 'both'>('none')

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
      setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none')
    }

    /*
     * Non-passive, and therefore native rather than `onWheel`: React attaches
     * its wheel listener to the root as passive, so a `preventDefault()` in a
     * JSX handler is ignored and the page scrolls anyway.
     */
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      const next = Math.min(max, Math.max(0, el.scrollLeft + event.deltaY))
      if (next === el.scrollLeft) return
      event.preventDefault()
      el.scrollLeft = next
    }

    measure()
    el.addEventListener('scroll', measure, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      el.removeEventListener('wheel', onWheel)
      observer?.disconnect()
    }
  }, deps)

  return (
    <div
      ref={ref}
      data-fade={fade}
      className="filter-scroller flex min-w-0 flex-1 items-center gap-tight"
    >
      {children}
    </div>
  )
}

/**
 * The hairline between two axes. Decoration — it carries no name and no state.
 *
 * The margin is the point: with the row's `gap-tight` alone, the space between
 * two axes equals the space between two chips of the same axis, and four groups
 * read as one run of thirteen chips.
 */
function Rule(): ReactNode {
  return <span aria-hidden className="border-subtle mx-1 h-4 shrink-0 self-center border-l" />
}
