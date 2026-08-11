/**
 * The push status of each intent, on one line of a row (DEC-20, DEC-25).
 *
 * `drained` is the only state that gets a tick; everything else keeps its own
 * mark, because "sent with a warning" and "not sent" are not the same news and
 * a rep chasing a missing CRM record needs to tell them apart at a glance.
 *
 * Shared by *Historique* and by the calendar's search results so the same call
 * reads the same on both screens — the second is the expanded form of the
 * first (VISION.md §6), and a row that summarised itself differently in the two
 * would make the rep check which one to believe.
 */
import type { HistoryIntent } from '../../../electron/core/contracts/history.ts'

const INTENT_SHORT: Record<HistoryIntent['kind'], string> = {
  'crm.task': 'tâche',
  'crm.opportunity': 'oppy',
  'mail.draft': 'mail',
}

const STATE_MARK: Record<HistoryIntent['state'], string> = {
  pending: '…',
  blocked: '…',
  draining: '…',
  drained: '✓',
  failed: '⚠',
}

export function IntentSummary({
  intents,
  className,
}: {
  intents: readonly HistoryIntent[]
  className?: string
}) {
  if (intents.length === 0) {
    return <span className={`text-muted shrink-0 text-right text-ui ${className ?? ''}`}>—</span>
  }

  return (
    <span className={`shrink-0 text-right text-ui ${className ?? ''}`}>
      {intents.map((intent, index) => (
        <span key={intent.intentId} className={intent.state === 'failed' ? 'text-warn' : 'text-muted'}>
          {index > 0 ? ' · ' : ''}
          {INTENT_SHORT[intent.kind]}
          {STATE_MARK[intent.state]}
        </span>
      ))}
    </span>
  )
}
