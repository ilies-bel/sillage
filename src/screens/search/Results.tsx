/**
 * What the search found, in place of the day list (DEC-25, DEC-31).
 *
 * The calendar screen is the product's only entry into the past. When the box
 * has something in it — or a chip is on — this replaces `DayPane`, because a
 * rep who typed a client's name is no longer asking about Thursday.
 *
 * Two properties this list has by construction:
 *
 *  · **Every row came from the main process already narrowed.** There is no
 *    `.filter()` in this file and nothing to filter: what arrives is what
 *    matched, plus the excerpt saying where. The corpus never crosses.
 *  · **It is short on purpose, and says so.** The calendar's pane shows the
 *    first handful; the full record is *Historique*, one link away, carrying the
 *    same query and the same chips (VISION.md §6). A pane that tried to be the
 *    whole reader would be a second Historique inside the home screen.
 */
import type { HistoryRow } from '../../../electron/core/contracts/history.ts'
import { meetingAnchor } from '../../../electron/core/contracts/meeting.ts'
import { formatDayShort, meetingHeading } from '../../app/format.ts'
import { Button, EmptyState, List, Row, RowTitle } from '../../ui/index.ts'
import { IntentSummary } from './Intents.tsx'
import { Matches } from './Matches.tsx'

export interface ResultsProps {
  /** Null while the first answer is in flight. */
  rows: readonly HistoryRow[] | null
  failure: string | null
  /**
   * True when a row was **hidden** — the main process's own `capped`, never a
   * count of the rows above against the limit they were asked for. That
   * comparison is one more than the question: eight matches filling an
   * eight-row pane with nothing behind them drew « l'historique les porte
   * tous », sending a rep to a second screen for results that do not exist.
   */
  truncated: boolean
  onOpen: (meetingId: string) => void
}

export function Results({ rows, failure, truncated, onOpen }: ResultsProps) {
  if (failure) {
    return (
      <p role="alert" className="text-danger text-ui">
        {failure}
      </p>
    )
  }

  if (rows === null) return <p className="text-muted text-ui">Recherche…</p>

  if (rows.length === 0) {
    return (
      <EmptyState hint="La recherche porte sur les clients, les sujets, les transcriptions, vos notes, vos moments marqués et les comptes-rendus.">
        Aucun appel ne correspond.
      </EmptyState>
    )
  }

  return (
    <div>
      <List label="Résultats">
        {rows.map((row) => (
          <Row key={row.meeting.id} density="roomy" align="center" className="flex-wrap">
            <span className="text-muted w-16 shrink-0 tabular-nums text-ui">
              {formatDayShort(meetingAnchor(row.meeting))}
            </span>

            {/*
              **The one cell that is not a fixed width was the one that gave.**

              Measured on the shipped renderer, `agenda-search` at 960×600 — the
              minimum `app/main.ts` declares — this row is 462px wide and spends
              64 on the date, 80 on the status, 112 on the intent summary, 62 on
              *Ouvrir* and 64 on four `gap-row`s. That is 382 of the 430px inside
              the padding, and what was left for the client's name and the call's
              objet was **40.3px**. `line-clamp-2` then cut the word itself, with
              no ellipsis and nothing on screen saying so: the three results read
              « Sodex / comi… », « Group Maréc / quali… », « Banqu Delcou /
              prem… ». A search result a rep cannot identify is not a result.

              The row already wraps; it simply never had a reason to. A floor on
              the identity cell gives it one, and flexbox breaks the line after
              it instead of crushing it — the line-break decision reads an item's
              flex base size *clamped by its own min-width*. At 960 the title
              then gets 350px, which is above the widest heading these rows draw
              (187.1px, « comité de staffing hebdomadaire »), so name and objet
              land on one line each and the status, the ledger and *Ouvrir* go
              together on the next.

              **`lg:min-w-0` because 1280 must not move.** At 1280×800 the same
              arithmetic leaves 637.7px of hypothetical width against 638
              available — three tenths of a pixel of slack — so an unconditional
              floor would wrap the comfortable size too, on a rounding error. The
              breakpoint is the viewport and the real variable is this column's
              width; they agree here because the pane's width is a fixed share of
              the window, and `Rail` and the search field next door already step
              on the same `lg`.

              Windows (HR-2) is the tighter case and still clears it: a classic
              scrollbar takes 17px off this column, leaving 413px inside the
              padding, and the second line needs 286.
            */}
            <RowTitle {...meetingHeading(row.meeting)} className="min-w-[16rem] lg:min-w-0" />

            <span className="text-muted w-20 shrink-0 text-right text-ui">{row.status}</span>
            {/*
              **`truncate`, because `w-28` was a box and not a width — and only
              where the box is the reason.**

              The compact summary is `whitespace-nowrap` in a 112px cell, and
              « 1 envoi en échec · 2 effectués » measures 168.6 — 57px of it
              drawn outside the cell and clipped by `List`'s own
              `overflow-hidden`, with nothing on screen saying so. It was
              invisible while the window had slack; the rail (V2) took 224px of
              it and `--scrollers` found it at 960×600. The ellipsis is the cue
              the check is about, and the ledger is in the expanded record.

              That is still the answer at 1280×800, where this row is one line
              of 638px with 0.3px to spare. It stopped being the answer below
              `lg`: the row breaks after the title now, and the status, this
              summary and *Ouvrir* share a line of 430px that they use 286 of.
              Clipping 57px of a rep's own ledger beside 144px of nothing is the
              next round's finding, so the cell is sized to its text there. It
              is bounded text, not data — `counted()` above emits at most three
              counted phrases, 173.1px measured and ~240px at three-digit
              counts, which still leaves the line inside 430.
            */}
            <IntentSummary intents={row.intents} variant="compact" className="lg:w-28 lg:truncate" />

            <Button onClick={() => onOpen(row.meeting.id)}>Ouvrir</Button>

            {/* The evidence, on its own line so the row above stays scannable. */}
            <Matches matches={row.matches} className="w-full space-y-0.5 pl-16" />
          </Row>
        ))}
      </List>

      {/*
        Says there is more; does not offer a second way to reach it. *Tout
        l'historique ›* is permanent, on the search row a few pixels above, and
        two links to one destination on one screen is a rep deciding which of
        them they meant.
      */}
      {truncated ? (
        <p className="text-muted mt-snug text-ui">
          Les premiers résultats — l’historique les porte tous.
        </p>
      ) : null}
    </div>
  )
}
