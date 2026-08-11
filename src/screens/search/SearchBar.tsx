/**
 * The search (VISION.md §6, screen 1) — a field and four rows of chips.
 *
 *   ┌ ⌕ Rechercher un client, un sujet, un mot dit… ──────────────────┐
 *   │ Tous clients · Acme SA · Nordis · Groupe Lefort                 │
 *   │ Toute période · 7 jours · 30 jours · 90 jours                   │
 *   │ Tous statuts · À valider · Validées · Abandonnées               │
 *   │ Toutes intentions · Tâche · Opportunité · Mail                  │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Three things it is, and one it is not.
 *
 * **It is one component on two screens.** VISION.md §6 says *Historique* is the
 * expanded form of this same query — « the same field, the same filter chips,
 * carried over ». Two implementations would drift, and the day they did, the
 * expanded form would answer a different question from the one the rep typed.
 *
 * **It is inline.** No dropdown, no popover, no dialog (HR-10). Every value on
 * every axis is on screen and one click away, and pressing the « any » chip of
 * an axis is how a filter comes off. There is no hidden state.
 *
 * **It holds nothing.** `query` and `filter` are the caller's, and the results
 * are the main process's. This component has no list of meetings in it and no
 * way to acquire one — which is what makes « the renderer never holds a corpus
 * it did not ask for » a property of the code rather than a promise.
 *
 * What it is not is a form. There is no submit: the caller debounces and asks.
 */
import type { HistoryFilter } from '../../../electron/core/contracts/history.ts'
import { Button, Chip } from '../../ui/index.ts'
import {
  INTENTIONS,
  INTENTION_LABEL,
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
   * simply not drawn, because a *Client* row holding only « Tous » is a control
   * that does nothing (DEC-26).
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

      {/* One row per axis still, and a touch more air between them now that no
          heading marks where one ends. */}
      <div className="mt-2 space-y-tight">
        {clients.length > 0 ? (
          <Axis label="Client">
            <Chip pressed={filter.client === null} onClick={() => onFilter({ ...filter, client: null })}>
              Tous clients
            </Chip>
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
          </Axis>
        ) : null}

        <Axis label="Période">
          {PERIODES.map((periode) => (
            <Chip
              key={periode}
              pressed={filter.periode === periode}
              onClick={() => onFilter({ ...filter, periode })}
            >
              {PERIODE_LABEL[periode]}
            </Chip>
          ))}
        </Axis>

        <Axis label="Statut">
          {STATUTS.map((statut) => (
            <Chip
              key={statut}
              pressed={filter.statut === statut}
              onClick={() => onFilter({ ...filter, statut })}
            >
              {STATUT_LABEL[statut]}
            </Chip>
          ))}
        </Axis>

        <Axis label="Intention">
          {INTENTIONS.map((intention) => (
            <Chip
              key={intention}
              pressed={filter.intention === intention}
              onClick={() => onFilter({ ...filter, intention })}
            >
              {INTENTION_LABEL[intention]}
            </Chip>
          ))}
        </Axis>
      </div>
    </div>
  )
}

/**
 * One axis: its chips, and nothing else on screen.
 *
 * The name is still here — as the `role="group"` label, which is what a screen
 * reader announces before the chips and what these rows are found by in the
 * tests. What went is the visible heading: a fixed 80px column of `PÉRIODE` /
 * `STATUT` / `INTENTION` that existed only because the neutral chip of each axis
 * used to read « Toujours » / « Tous » / « Toutes » and named nothing. The chips
 * name themselves now (`filters.ts`), so the column was captioning controls that
 * had learned to speak — and taking a fifth of the row's width to do it.
 *
 * Not `radiogroup`: these are toggles, and the markup should say what it is (the
 * same distinction `Segmented` draws against `SectionNav`).
 */
function Axis({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-tight">
      {children}
    </div>
  )
}
