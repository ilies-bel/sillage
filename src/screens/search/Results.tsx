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
import { formatDayShort, meetingHeading } from '../../app/format.ts'
import { Button, EmptyState, List, Row, RowTitle } from '../../ui/index.ts'
import { IntentSummary } from './Intents.tsx'
import { Matches } from './Matches.tsx'

export interface ResultsProps {
  /** Null while the first answer is in flight. */
  rows: readonly HistoryRow[] | null
  failure: string | null
  /** True when the answer filled the pane, so there is more behind the link. */
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
      <EmptyState hint="La recherche porte sur les clients, les sujets, les transcriptions et vos notes.">
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
              {formatDayShort(row.meeting.startedAt ?? row.meeting.scheduledStart ?? row.meeting.createdAt)}
            </span>

            <RowTitle {...meetingHeading(row.meeting)} />

            <span className="text-muted w-20 shrink-0 text-right text-ui">{row.status}</span>
            <IntentSummary intents={row.intents} className="w-28" />

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
        <p className="text-muted mt-2 text-ui">
          Les premiers résultats — l’historique les porte tous.
        </p>
      ) : null}
    </div>
  )
}
