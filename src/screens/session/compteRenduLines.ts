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
 *    `snake_case` identifier in a client's prose is left exactly alone;
 *  · `⚠ faible` — the one token this product has of its own (DEC-21).
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
  /**
   * **`⚠ faible`, the one mark this product invented, drawn as a mark.**
   *
   * `renderCompteRendu` writes it into the document on purpose: DEC-21's whole
   * argument is that a rep skimming the prose — rather than opening the form —
   * still sees which sentence the app could not stand behind. The typesetter
   * learned `**gras**` and `_italique_` and never learned this one, so the
   * marker rendered in `--text-body` at `--type-copy`, **pixel-identical to the
   * prose around it**, while the same eight characters were orange in the rail
   * and orange in the header banner. Three renderings of one measurement on one
   * screen, and the only one inside the artefact that leaves the machine was the
   * invisible one.
   *
   * It is a run and not a substitution: the string is untouched and VerySwing
   * still receives the same bytes (DEC-44). Only the ink changes, which is what
   * a typesetter is for.
   */
  | { kind: 'faible'; text: string }
  /**
   * **A fragment the model quoted, which is the only part of the prose that
   * claims to be verbatim** (DEC-21, DEC-44).
   *
   * `REGISTRE` licenses « … » for a few words the client actually said, when the
   * formulation itself is the point — and nothing else in the compte-rendu makes
   * that claim: the rest is the model reporting, hedges kept, quantities
   * approximate. So the eleven typed fields each carried a `[source ▸]` and the
   * two thousand four hundred pixels of prose beside them carried none, on the
   * screen whose whole argument is that a claim must be checkable against the
   * record.
   *
   * It is a run so that a surface which *has* the transcript can make it lead
   * there. The parser only ever says « these words are inside guillemets »;
   * whether they are in the recording is a question for whoever holds the
   * segments, and a surface that does not hold them draws the quote as prose
   * rather than as a control that goes nowhere (DEC-26).
   */
  | { kind: 'quote'; text: string; inner: string }

/*
 * `\*\*(\S(?:[^*]*\S)?)\*\*` — bold may not be empty and may not open or close
 * on a space, which is what stops « 2 * 3 * 4 » from becoming emphasis.
 *
 * `(?<![\p{L}\p{N}_])_(\S(?:[^_]*\S)?)_(?![\p{L}\p{N}_])` — italic only at a
 * word boundary on both sides. Without the look-arounds `sillage_audio.rs` and
 * `elodie_v@…` would each swallow half a line into an italic run.
 */
/*
 * `«\s(…)\s»` — the French pair, with its spaces, and never spanning a line.
 * The inner group is what `locateQuote` is handed; the run's own `text` is the
 * whole thing including the guillemets, because the round-trip property is that
 * the runs concatenate back to the exact string.
 */
const INLINE =
  /(⚠\u00a0?\sfaible)|\*\*(\S(?:[^*]*\S)?)\*\*|(?<![\p{L}\p{N}_])_(\S(?:[^_]*\S)?)_(?![\p{L}\p{N}_])|(«[  ]?(\S(?:[^«»]*\S)?)[  ]?»)/gu

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

    const faible = match[1]
    const bold = match[2]
    const quoted = match[4]
    if (quoted !== undefined) {
      runs.push({ kind: 'quote', text: quoted, inner: match[5] as string })
    } else if (faible !== undefined) {
      // Whole, including its space — it is one mark, and splitting it would let
      // a line break fall between the glyph and the word.
      runs.push({ kind: 'faible', text: faible })
    } else if (bold === undefined) {
      runs.push({ kind: 'marker', text: '_' })
      runs.push({ kind: 'em', text: match[3] as string })
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

/**
 * **Where the composer's metadata block is — by shape, never by content.**
 *
 * `modules/extract/compteRendu.ts` opens every document the same way:
 *
 *     # <objet>
 *     (vide)
 *     Client : …
 *     Date : …
 *     Interlocuteurs : …
 *     Commercial : …            ← absent when `repEmail` is null (HR-3 is optional)
 *     (vide)
 *     ## Résumé                 ← DEC-40, both recipes
 *
 * Four lines, sometimes three, that are not prose and are not a heading: they
 * are the meeting's identity, and the parser above classes them `text` because
 * they carry no marker. This finds that run so a surface can *set* it as a
 * block rather than as four paragraphs.
 *
 * **Structural and not a heuristic, deliberately.** A rule that looked for
 * « Client : » would be the app guessing which of its own lines are metadata —
 * and this repo's invariant is that the document's lines are followable *by
 * string equality* against `compteRenduSources`, never by a heuristic. So the
 * shape is the whole rule, and all four conditions must hold:
 *
 *   · the document opens on a level-1 heading (DEC-40's `# <objet>`),
 *   · followed by exactly one blank,
 *   · followed by two or more `text` lines and nothing else,
 *   · closed by a blank whose next non-blank line is a heading.
 *
 * The last is what stops a document that opens on a title and then a paragraph
 * from having its first paragraph folded: prose is not followed by a heading
 * one blank later, `## Résumé` is. A document that does not match returns
 * `null` and is set exactly as before — which is every fixture the tests feed
 * that is not a whole composed document.
 *
 * Two lines is the floor because one line folded is one line drawn: there is
 * nothing to collapse, and a control offering to expand a single line already
 * on screen is the dead control DEC-26 forbids.
 *
 * It returns a **range into the array it was given**, so a caller reads the
 * lines themselves rather than a copy this function decided how to format.
 * Nothing here composes a string; `serializeCompteRendu` above is still the
 * only thing that turns lines back into a document, and it is untouched.
 */
export function metadataBlock(
  lines: readonly CompteRenduLine[],
): { start: number; end: number } | null {
  const first = lines[0]
  if (first === undefined || first.kind !== 'heading' || first.level !== 1) return null
  if (lines[1]?.kind !== 'blank') return null

  let end = 2
  while (lines[end]?.kind === 'text') end += 1
  if (end - 2 < 2) return null

  if (lines[end]?.kind !== 'blank') return null
  let after = end + 1
  while (lines[after]?.kind === 'blank') after += 1
  if (lines[after]?.kind !== 'heading') return null

  return { start: 2, end }
}
