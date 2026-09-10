/**
 * The compte-rendu, split into lines a renderer can typeset — and joined back
 * into the byte-identical string it came from.
 *
 * ## Why this exists rather than a markdown renderer
 *
 * The invariant is that **VerySwing receives the string the rep read**
 * (DEC-44). A markdown renderer breaks that: it *hides* the markers, so a
 * document that had grown a table would look like a table on screen and land in
 * the CRM as literal pipes, and the one surface whose job is to let the rep
 * check the text before it goes would be the surface lying about it.
 *
 * A pane that draws the raw string is honest and unreadable — beside the rep's
 * own typeset notes it reads as a log dump of something the machine produced,
 * which is the opposite of what the document is.
 *
 * So: the markers stay on screen, muted, in a gutter, the way an editor shows
 * them — and the prose beside them is set as prose. Nothing is added and
 * nothing is removed, which is what `serializeCompteRendu(parse(x)) === x`
 * states and what `compteRenduLines.test.ts` proves for every fixture.
 *
 * The classes recognised here are exactly the ones `renderCompteRendu` emits —
 * `#`, `##`, `- ` — and nothing else. A construct the recipe never writes falls
 * through to `text` and is drawn verbatim, so a table that did appear would
 * still show as literal pipes, on screen and in the CRM alike. That is the
 * point: this is a typesetter for a known, closed vocabulary, not a parser for
 * an open one.
 */

/** One line of the document, with its marker kept separate from its prose. */
export type CompteRenduLine =
  /** `# `, `## `, `### ` — `marker` carries the hashes *and* the space. */
  | { kind: 'heading'; level: 1 | 2 | 3; marker: string; text: string }
  /** `- ` at the start of the line. */
  | { kind: 'bullet'; marker: string; text: string }
  /** An empty line. It is the document's paragraph spacing and it is preserved. */
  | { kind: 'blank' }
  /** Everything else, verbatim. */
  | { kind: 'text'; text: string }

/** `## ` and friends, at the very start of a line, with at least one space after. */
const HEADING = /^(#{1,3}) (.*)$/
/** `- ` at the very start of a line. A `-` with no space is prose (a dash). */
const BULLET = /^(- )(.*)$/

/**
 * Split the document into lines.
 *
 * `split('\n')` and never a trim: a document that ends on a blank line ends on
 * a blank line, because `serializeCompteRendu` has to be able to put it back.
 */
export function parseCompteRendu(source: string): CompteRenduLine[] {
  return source.split('\n').map((line): CompteRenduLine => {
    if (line === '') return { kind: 'blank' }

    const heading = HEADING.exec(line)
    if (heading) {
      const hashes = heading[1]
      return {
        kind: 'heading',
        level: hashes.length as 1 | 2 | 3,
        marker: `${hashes} `,
        text: heading[2],
      }
    }

    const bullet = BULLET.exec(line)
    if (bullet) return { kind: 'bullet', marker: bullet[1], text: bullet[2] }

    return { kind: 'text', text: line }
  })
}

/**
 * Put it back. `serializeCompteRendu(parseCompteRendu(x)) === x` for every `x`,
 * which is the whole warrant for typesetting the thing at all.
 */
export function serializeCompteRendu(lines: readonly CompteRenduLine[]): string {
  return lines
    .map((line) => {
      switch (line.kind) {
        case 'blank':
          return ''
        case 'heading':
        case 'bullet':
          return `${line.marker}${line.text}`
        case 'text':
          return line.text
      }
    })
    .join('\n')
}
