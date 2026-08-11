/**
 * Where the query hit, under the row that matched.
 *
 * Without it a search result is an assertion — the rep has to open each row to
 * find out why it is in the list. With it, the row carries its own evidence.
 *
 * What is drawn here is a `HistoryMatch`: the surface, and forty characters
 * either side of the hit. Never the surface itself. The whole transcript stays
 * in the main process until somebody expands the record and asks for it
 * (DEC-25), and this component has no way to render one if it were sent.
 */
import type { HistoryMatch } from '../../../electron/core/contracts/history.ts'

const WHERE_LABEL: Record<HistoryMatch['where'], string> = {
  transcript: 'Transcript',
  notes: 'Mes notes',
  compteRendu: 'Compte-rendu',
}

export function Matches({ matches, className }: { matches: readonly HistoryMatch[]; className?: string }) {
  if (matches.length === 0) return null

  return (
    <ul className={className}>
      {matches.map((match) => (
        <li key={match.where} className="text-muted flex gap-2 text-meta">
          <span className="w-24 shrink-0">{WHERE_LABEL[match.where]}</span>
          <span className="text-body min-w-0 flex-1 italic">« {match.excerpt} »</span>
        </li>
      ))}
    </ul>
  )
}
