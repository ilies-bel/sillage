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
 *  · **A row with no session carries no button** (DEC-26). An invite the app
 *    has never opened is information; a dead *Ouvrir* on it would be the exact
 *    dead control that decision forbids.
 *  · **An empty range says why it is empty**, in the calendar's own words, and
 *    never as a failure of the app (DEC-26, DEC-32). Graph being unreachable is
 *    a line in this pane, not a banner over the product.
 */
import { formatRange, formatTime, formatDayMedium } from '../../app/format.ts'
import { noonOf, type DayKey } from '../../app/calendar.ts'
import { Button, EmptyState, List, Row, RowTitle, SectionHeader, StateDot } from '../../ui/index.ts'
import { STATE_LABEL, type AgendaEntry } from './entries.ts'

interface DayPaneProps {
  /** Already filtered to the range on screen, ascending. */
  entries: readonly AgendaEntry[]
  /** Why the calendar has nothing to show, in its own words. May be empty. */
  reason: string | null
  /** True when Graph is not connected — changes what the empty state offers. */
  signedOut: boolean
  /** Shown on a row when the range spans more than one day. */
  showDay: boolean
  onOpen: (meetingId: string) => void
}

export function DayPane({ entries, reason, signedOut, showDay, onOpen }: DayPaneProps) {
  const upcoming = entries.filter((entry) => !entry.past)
  // Newest first: the call a rep wants after a meeting is the one that just
  // ended, and it is at the bottom of an ascending list.
  const past = entries.filter((entry) => entry.past).slice().reverse()

  return (
    <div className="min-h-0">
      {upcoming.length > 0 ? (
        <List>
          {upcoming.map((entry) => (
            <EntryRow key={entry.key} entry={entry} showDay={showDay} onOpen={onOpen} />
          ))}
        </List>
      ) : (
        <EmptyState
          reason={reason || undefined}
          hint={
            signedOut
              ? 'Le calendrier est facultatif — vous pouvez créer une réunion sur n’importe quel jour.'
              : undefined
          }
        >
          Aucune réunion à venir.
        </EmptyState>
      )}

      {past.length > 0 ? (
        <section className="mt-block">
          <SectionHeader>Passées</SectionHeader>
          <List>
            {past.map((entry) => (
              <EntryRow key={entry.key} entry={entry} showDay={showDay} onOpen={onOpen} />
            ))}
          </List>
        </section>
      ) : null}
    </div>
  )
}

interface EntryRowProps {
  entry: AgendaEntry
  showDay: boolean
  onOpen: (meetingId: string) => void
}

function EntryRow({ entry, showDay, onOpen }: EntryRowProps) {
  const meetingId = entry.meetingId

  return (
    <Row density="roomy" align="center">
      <span className="text-muted w-28 shrink-0 tabular-nums text-ui">
        {showDay ? (
          <span className="block capitalize">{formatDayMedium(noonOf(entry.day))}</span>
        ) : null}
        {entry.end === null || entry.end <= entry.start
          ? formatTime(entry.start)
          : formatRange(entry.start, entry.end)}
      </span>

      <RowTitle title={entry.title} subtitle={entry.subtitle ?? undefined} />

      {/*
        The accent dot and the word it means, as one thing. VISION.md §6 asks
        for quiet, so it is 6px and it does not pulse; it carries a text label
        because colour alone cannot state a condition that changes what a
        button does. And the orange stays on the dot: `--accent` is 2.44:1, so
        `text-accent` on the word *Prêt* would render it at 2.41:1 on the card.
        `StateDot` makes that unspellable.
      */}
      {entry.armed ? (
        <StateDot
          tone="armed"
          label="Prêt"
          className="text-label font-semibold uppercase tracking-wider"
        />
      ) : entry.state ? (
        <span className="text-muted shrink-0 text-ui">{STATE_LABEL[entry.state]}</span>
      ) : null}

      {meetingId ? <Button onClick={() => onOpen(meetingId)}>Ouvrir</Button> : null}
    </Row>
  )
}
