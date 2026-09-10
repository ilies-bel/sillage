/**
 * The compte-rendu, typeset — with every marker still on screen.
 *
 * See `compteRenduLines.ts` for why this is a typesetter over a closed
 * vocabulary and not a markdown renderer. The short version: the CRM gets the
 * string the rep read (DEC-44), so nothing here may hide a character. The
 * hashes and the list dashes are drawn in a left gutter, muted, exactly the way
 * an editor shows them — and the prose beside them is set as prose instead of
 * as a log dump.
 *
 * The gutter is `absolute` in a `relative` line box rather than a flex column,
 * because the heading text has to sit on the same left edge as the paragraph
 * text under it. A flex gutter would indent every line by the width of the
 * widest marker, and the document would read as if it were quoted.
 */
import { parseCompteRendu } from './compteRenduLines.ts'

interface CompteRenduDocumentProps {
  /** The rendered document, exactly as `renderCompteRendu` produced it. */
  text: string
  className?: string
}

/** What each line class is set in. The `#` gutter is common to all of them. */
const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'font-display text-strong mt-block first:mt-0 text-[19px] leading-tight',
  2: 'text-strong mt-block first:mt-0 text-[14px] font-semibold leading-snug',
  3: 'text-strong mt-row first:mt-0 text-ui font-semibold leading-snug',
}

export function CompteRenduDocument({ text, className }: CompteRenduDocumentProps) {
  const lines = parseCompteRendu(text)

  return (
    <div className={className}>
      {lines.map((line, index) => {
        // Index as key: these are lines of one immutable string, they have no
        // identity of their own and the list is replaced wholesale or not at all.
        const key = index

        if (line.kind === 'blank') {
          /*
           * A blank line is the document's paragraph spacing, and it is real
           * text — so it keeps a box. `h-2` rather than a full line height:
           * headings and bullets already carry their own margins, and a full
           * blank line on top of those left the document airy to the point of
           * looking unfinished at the window's minimum height.
           */
          return <div key={key} aria-hidden className="h-2" />
        }

        if (line.kind === 'heading') {
          return (
            <div key={key} className="relative">
              <Marker>{line.marker}</Marker>
              <div className={HEADING_CLASS[line.level]}>{line.text}</div>
            </div>
          )
        }

        if (line.kind === 'bullet') {
          return (
            <div key={key} className="relative">
              <Marker>{line.marker}</Marker>
              <p className="text-body text-ui leading-relaxed">{line.text}</p>
            </div>
          )
        }

        return (
          <p key={key} className="text-body whitespace-pre-wrap text-ui leading-relaxed">
            {line.text}
          </p>
        )
      })}
    </div>
  )
}

/**
 * The marker, in the gutter.
 *
 * `whitespace-pre` because the marker carries its trailing space and that space
 * is part of the string the rep is checking. `select-none` is deliberate and is
 * *not* hiding it: the pane is read-only, and a rep dragging across the
 * document to copy it wants the prose, not a column of hashes — the editable
 * copy at the gate is where the raw string is selectable in full.
 */
function Marker({ children }: { children: string }) {
  return (
    <span className="text-muted absolute top-0 right-full mr-1.5 select-none whitespace-pre font-mono text-meta leading-relaxed">
      {children}
    </span>
  )
}
