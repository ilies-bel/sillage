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

/*
 * French, and the same three words every other surface uses.
 *
 * « Transcript » is the key in the contract, where English is the rule — and it
 * was being drawn as if it were a label. It is not a French word, and the review
 * gate's own tab and Historique's section both say « Transcription », so a rep
 * met the same artefact under two names one click apart.
 */
const WHERE_LABEL: Record<HistoryMatch['where'], string> = {
  // The call's own objet and client. A `Record` and not a lookup with a
  // fallback, on purpose: a surface added to the contract without a French name
  // fails the typecheck instead of drawing its own key at a rep.
  meeting: 'Intitulé',
  // The widget's own word, and the reader's: « Marquer ce moment », « Moment
  // marqué ». A rep who typed it during the call meets it here under the name
  // they pressed, not under a new one invented for a search result.
  marks: 'Moments marqués',
  transcript: 'Transcription',
  notes: 'Mes notes',
  compteRendu: 'Compte-rendu',
}

export function Matches({ matches, className }: { matches: readonly HistoryMatch[]; className?: string }) {
  if (matches.length === 0) return null

  return (
    <ul className={className}>
      {matches.map((match) => (
        <li key={match.where} className="text-muted flex gap-2 text-meta">
          {/*
            `w-28` and not `w-24`: « Moments marqués » is the longest of the five
            names and wrapped to two lines in ninety-six pixels, which put the
            excerpt beside it out of line with every other row on the surface
            whose whole job is « which surface matched, and where ».
          */}
          <span className="w-28 shrink-0">{WHERE_LABEL[match.where]}</span>
          <span className="text-body min-w-0 flex-1 italic">« {match.excerpt} »</span>
        </li>
      ))}
    </ul>
  )
}
