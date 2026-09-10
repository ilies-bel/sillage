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

/**
 * ## The line's own vocabulary: `**gras**` and `_italique_`
 *
 * `renderCompteRendu` writes inline emphasis and this file did not know it. The
 * deterministic header is four `**Client** : …` lines, every row of « Éléments
 * retenus » is `- **Besoin** : …`, and absence is stated `_non évoqué_` — so the
 * document opened on five lines of literal asterisks, the recap was a column of
 * them, and the pane looked like a renderer that had failed rather than a
 * document. No screenshot pass caught it because the harness fixture was four
 * invented headings with no header block and no recap.
 *
 * The answer is the one the gutter already gives: **draw the marker**. The
 * asterisks stay on screen, muted and small, and the words between them are set
 * bold — which is what an editor shows and is the only treatment that keeps
 * DEC-44's promise, because VerySwing receives the asterisks too.
 *
 * The vocabulary stays closed, and stays the composer's:
 *
 *  · `**…**` — never spanning a line, never empty, no nesting;
 *  · `_…_` — the same, and only at a word boundary, so an `email_address` or a
 *    `snake_case` identifier in a client's prose is left exactly alone.
 *
 * Anything else falls through as plain text and is drawn verbatim, which is the
 * same rule the line classes follow and for the same reason.
 */
export type InlineRun =
  /** Prose. */
  | { kind: 'plain'; text: string }
  /** The `**` or the `_` itself — on screen, muted, never removed. */
  | { kind: 'marker'; text: string }
  /** What `**…**` wrapped. */
  | { kind: 'strong'; text: string }
  /** What `_…_` wrapped. */
  | { kind: 'em'; text: string }

/*
 * `\*\*(\S(?:[^*]*\S)?)\*\*` — bold may not be empty and may not open or close
 * on a space, which is what stops « 2 * 3 * 4 » from becoming emphasis.
 *
 * `(?<![\p{L}\p{N}_])_(\S(?:[^_]*\S)?)_(?![\p{L}\p{N}_])` — italic only at a
 * word boundary on both sides. Without the look-arounds `sillage_audio.rs` and
 * `elodie_v@…` would each swallow half a line into an italic run.
 */
const INLINE = /\*\*(\S(?:[^*]*\S)?)\*\*|(?<![\p{L}\p{N}_])_(\S(?:[^_]*\S)?)_(?![\p{L}\p{N}_])/gu

/**
 * Split one line's prose into runs.
 *
 * Its property is the same as the parser's above and is proved the same way:
 * the runs concatenate back to the exact string handed in. Nothing is dropped,
 * which is the whole reason the markers are runs of their own rather than
 * something the renderer throws away.
 */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  let at = 0

  for (const match of text.matchAll(INLINE)) {
    const start = match.index
    if (start > at) runs.push({ kind: 'plain', text: text.slice(at, start) })

    const bold = match[1]
    if (bold === undefined) {
      runs.push({ kind: 'marker', text: '_' })
      runs.push({ kind: 'em', text: match[2] as string })
      runs.push({ kind: 'marker', text: '_' })
    } else {
      runs.push({ kind: 'marker', text: '**' })
      runs.push({ kind: 'strong', text: bold })
      runs.push({ kind: 'marker', text: '**' })
    }
    at = start + match[0].length
  }

  if (at < text.length) runs.push({ kind: 'plain', text: text.slice(at) })
  return runs
}
