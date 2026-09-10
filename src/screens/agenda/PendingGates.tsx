/**
 * *En attente de validation* — the calls that were recorded and never confirmed.
 *
 * ## The failure it exists to catch
 *
 * A meeting that reaches `awaiting_confirmation` and is never validated is the
 * product's quietest failure: the audio was captured, the transcript is stored,
 * the compte-rendu is written — and nothing reached VerySwing, nothing reached
 * Outlook, and nobody was told. The rep believes the call is filed. Every other
 * failure in this app announces itself (DEC-26); this one is a rep walking away
 * from a screen.
 *
 * The app knows exactly which calls those are — `statut: 'a-valider'` over the
 * event log is the same question the search's own chip asks. So the home screen
 * asks it, once, and puts the answer where the rep already is.
 *
 * ## Why here rather than in the header
 *
 * The status control is for the three subsystems that make a meeting possible
 * (DEC-32), and a backlog of unconfirmed calls is not a degradation: the app is
 * working perfectly and the rep owes it a gesture. Putting a count in the header
 * chip would teach a rep to read « Tout fonctionne » as « you have work », which
 * is the two-meanings-one-signal problem that decision exists to prevent.
 *
 * ## What it is not
 *
 * It is not a second inbox and it does not grow into one: at most a handful of
 * rows, and the rest is *Historique* with the `À valider` chip already on —
 * which is the same query, one link away, as with everything else on this
 * screen (DEC-25).
 *
 * Nothing here confirms anything. *Ouvrir* is the same navigation the day list
 * uses; the one confirmation stays where it has always been (DEC-4).
 */
import type { HistoryRow } from '../../../electron/core/contracts/history.ts'
import { formatDayShort, meetingHeading } from '../../app/format.ts'
import { Button, List, Row, RowTitle, SectionHeader } from '../../ui/index.ts'

/** How many rows before the screen sends the rep to the full record. */
export const PENDING_SHOWN = 4

export interface PendingGatesProps {
  /** Already narrowed to `statut: 'a-valider'` by the main process. */
  rows: readonly HistoryRow[]
  /** *Tout l'historique* with the same chip on. */
  onSeeAll: () => void
  onOpen: (meetingId: string) => void
}

export function PendingGates({ rows, onSeeAll, onOpen }: PendingGatesProps) {
  // Nothing to owe is not an empty state — it is a section that does not exist.
  // A permanent « rien à valider » panel would be a congratulation the rep gets
  // every day and reads on none of them.
  if (rows.length === 0) return null

  const shown = rows.slice(0, PENDING_SHOWN)

  return (
    <section className="mt-block">
      <div className="mb-3 flex items-baseline gap-inline">
        <SectionHeader className="mb-0 min-w-0 flex-1">En attente de validation</SectionHeader>
        {rows.length > shown.length ? (
          <Button variant="text" className="shrink-0" onClick={onSeeAll}>
            {`Les ${rows.length} ›`}
          </Button>
        ) : null}
      </div>

      <List label="Réunions en attente de validation">
        {shown.map((row) => (
          <Row key={row.meeting.id} density="roomy" align="center">
            <span className="text-muted w-16 shrink-0 tabular-nums text-ui">
              {formatDayShort(
                row.meeting.endedAt ?? row.meeting.startedAt ?? row.meeting.createdAt,
              )}
            </span>
            <RowTitle {...meetingHeading(row.meeting)} />
            {/*
              What is still sitting there, in the words the gate uses. Not a
              count of days — « il y a 3 jours » is a reproach, and the date is
              already on the row.
            */}
            <span className="text-warn shrink-0 text-ui">Rien n’a été envoyé</span>
            <Button onClick={() => onOpen(row.meeting.id)}>Ouvrir</Button>
          </Row>
        ))}
      </List>
    </section>
  )
}
