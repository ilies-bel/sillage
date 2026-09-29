/**
 * The push status of each intent, on one line of a row (DEC-20, DEC-25).
 *
 * Every state gets its own word, never a shared one: "sent with a warning" and
 * "not sent" are not the same news, and a rep chasing a missing CRM record has
 * to tell them apart at a glance. (This said « `drained` is the only state that
 * gets a tick » from the root commit until now — `d8eab35` took the glyphs out
 * and left the sentence describing them. `pushWords.ts` owns the vocabulary and
 * the reason there is no glyph key to learn.)
 *
 * Shared by *Historique* and by the calendar's search results so the same call
 * reads the same on both screens — the second is the expanded form of the
 * first (VISION.md §6), and a row that summarised itself differently in the two
 * would make the rep check which one to believe. The words themselves are in
 * `pushWords.ts`, because « the same on both screens » was being asserted by
 * this docblock and contradicted by *Historique*'s own table.
 */
import type { HistoryIntent } from '../../../electron/core/contracts/history.ts'
import { INTENT_SHORT, pushWord } from './pushWords.ts'

/**
 * How much room the caller has.
 *
 * `full` names every intent and its state — « tâche envoyée · opportunité en
 * attente · mail en échec » — and is for *Historique*, whose rows run the width
 * of the window.
 *
 * `compact` is for the calendar's search pane, where the same summary sits
 * between a title and an *Ouvrir* button in about a hundred pixels. Naming
 * three intents there overran the column and ran *under* the button. It counts
 * instead, and it counts failures first, because that is the one state a rep is
 * scanning for; the full ledger is one click away in Historique and rides along
 * in the `title` in the meantime.
 */
export type IntentSummaryVariant = 'full' | 'compact'

/**
 * « 1 envoi en échec · 2 effectués », ordered by what a rep is looking for.
 *
 * The first part names the artefact, and it is the first part precisely because
 * the failure is what a rep scans a column of these for. Without the noun the
 * cell read « 2 envoyées » — envoyées *what*: the CRM task, the opportunity,
 * the Outlook draft? On a list with no column header that is a cell a rep has
 * to open a row to interpret.
 */
const counted = (intents: readonly HistoryIntent[]): string => {
  const failed = intents.filter((i) => i.state === 'failed').length
  const drained = intents.filter((i) => i.state === 'drained').length
  const waiting = intents.length - failed - drained
  const plural = (n: number) => (n > 1 ? 's' : '')
  const parts: string[] = []
  if (failed > 0) parts.push(`${failed} envoi${plural(failed)} en échec`)
  if (waiting > 0)
    parts.push(failed > 0 ? `${waiting} en attente` : `${waiting} envoi${plural(waiting)} en attente`)
  if (drained > 0)
    parts.push(
      failed > 0 || waiting > 0
        ? `${drained} effectué${plural(drained)}`
        : `${drained} envoi${plural(drained)} effectué${plural(drained)}`,
    )
  return parts.join(' · ')
}

export function IntentSummary({
  intents,
  variant = 'full',
  className,
}: {
  intents: readonly HistoryIntent[]
  variant?: IntentSummaryVariant
  className?: string
}) {
  if (intents.length === 0) {
    return <span className={`text-muted shrink-0 text-right text-ui ${className ?? ''}`}>—</span>
  }

  if (variant === 'compact') {
    return (
      <span
        title={intents
          .map((intent) => `${INTENT_SHORT[intent.kind]} ${pushWord(intent.state, intent.kind)}`)
          .join(' · ')}
        className={`shrink-0 whitespace-nowrap text-right text-ui ${
          intents.some((intent) => intent.state === 'failed') ? 'text-warn' : 'text-muted'
        } ${className ?? ''}`}
      >
        {counted(intents)}
      </span>
    )
  }

  return (
    /* `whitespace-nowrap`: the cluster wrapped mid-list on a narrow row and
       left an orphaned « · » at the end of the line. It is three short phrases
       and it either fits on one line or the caller wanted `compact`. */
    <span className={`shrink-0 whitespace-nowrap text-right text-ui ${className ?? ''}`}>
      {intents.map((intent, index) => (
        <span
          key={intent.intentId}
          /* The reason, where there is one — colour is never the only signal
             and « en échec » with no cause is a dead end (DEC-26). */
          title={intent.lastError ?? undefined}
          className={intent.state === 'failed' ? 'text-warn' : 'text-muted'}
        >
          {index > 0 ? ' · ' : ''}
          {`${INTENT_SHORT[intent.kind]} ${pushWord(intent.state, intent.kind)}`}
        </span>
      ))}
    </span>
  )
}
