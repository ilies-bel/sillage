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

/*
 * The rep's words, not the CRM's.
 *
 * This said « oppy » — not an abbreviation anybody speaks, but the spelling the
 * VerySwing schema uses for its opportunity column, worn as a French label. The
 * CRM boundary (DEC-29) exists so that vocabulary stops inside the adapter, and
 * a renderer that contracts a domain noun into the adapter's spelling walks it
 * straight back out — `check-crm-containment.mjs` fails on exactly that.
 * « opportunité » is the word the review gate already uses for the same thing,
 * and a row that named it differently would make the rep check which one to
 * believe.
 */
const INTENT_SHORT: Record<HistoryIntent['kind'], string> = {
  'crm.task': 'tâche',
  'crm.opportunity': 'opportunité',
  'mail.draft': 'mail',
}

/*
 * `…` is not available as a state mark, whatever it means.
 *
 * It read as a truncation: « opportunité… » beside « tâche✓ » is exactly what a
 * clipped label looks like, so a rep could not tell a push still in flight from
 * a word the column had run out of room for — and on the one surface whose job
 * is to say whether the CRM actually received something, those two readings
 * have opposite consequences. `↻` says *in flight* and cannot be read as
 * anything else.
 */
/*
 * Words, and no glyph key to learn.
 *
 * This was `✓ / ↻ / ⚠` — three symbols with no legend anywhere in the product,
 * on the one column that says whether the client's CRM actually received
 * anything. `✓` is guessable; `↻` is not, and `…` (what it replaced) was
 * routinely read as a truncated label. A rep should not have to learn a private
 * alphabet to find out that a push failed.
 *
 * They are short enough to sit three-to-a-row and long enough to be read
 * without a key, which is the whole trade.
 */
const STATE_WORD: Record<HistoryIntent['state'], string> = {
  pending: 'en attente',
  blocked: 'en attente',
  draining: 'envoi…',
  drained: 'envoyée',
  failed: 'en échec',
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
    /* `whitespace-nowrap`: the cluster wrapped mid-list on a narrow row and
       left an orphaned « · » at the end of the line. It is three short phrases
       and it either fits on one line or the row is too narrow for the column. */
    <span className={`shrink-0 whitespace-nowrap text-right text-ui ${className ?? ''}`}>
      {intents.map((intent, index) => (
        <span
          key={intent.intentId}
          /* Colour is never the only signal: the glyph carries the state and
             this spells it out for a screen reader and for a hover. */
          /* The reason, where there is one — colour is never the only signal
             and « en échec » with no cause is a dead end (DEC-26). */
          title={intent.lastError ?? undefined}
          className={intent.state === 'failed' ? 'text-warn' : 'text-muted'}
        >
          {index > 0 ? ' · ' : ''}
          {`${INTENT_SHORT[intent.kind]} ${STATE_WORD[intent.state]}`}
        </span>
      ))}
    </span>
  )
}
