/**
 * The rep's notes, as plain text.
 *
 * `modules/extract` needs what the rep typed during the call — with raw notes
 * present they steer the enhancement and are quoted verbatim (DEC-5). The notes
 * are persisted as a ProseMirror document, and the code that knows how to
 * render one lives in `src/editor/`, which `app/` may not import
 * (ARCHITECTURE.md §4).
 *
 * So the flattening is here, in `core/domain/`, where it belongs anyway: it is
 * a pure rule over a data structure, with no I/O and no Electron, and it can be
 * unit-tested against a document nobody had to open an editor to produce.
 *
 * This is deliberately **not** a markdown serialiser. `src/editor/markdown.ts`
 * is that, and duplicating it would be two things to keep in step. What the
 * model needs is the words and the block boundaries; what it does not need is
 * whether a run was bold.
 */

/** The shape of a persisted ProseMirror node. Nothing here trusts it. */
interface DocNode {
  type?: unknown
  text?: unknown
  content?: unknown
}

/** Node types whose children are separate lines rather than one paragraph. */
const BLOCK = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'tableRow',
  'horizontalRule',
])

const isNode = (value: unknown): value is DocNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Flattens a persisted document to text, one block per line.
 *
 * Total by construction: the input comes out of SQLite, may have been written
 * by an older schema, and is `unknown` in the contract. A document this cannot
 * read yields `''`, which makes the extraction run on the transcript alone —
 * the DEC-5 case where the rep typed nothing. Throwing here would turn an
 * unreadable note into a failed compte-rendu, which is a much worse trade.
 */
export const documentToText = (doc: unknown): string => {
  const lines: string[] = []
  let current = ''

  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed) lines.push(trimmed)
    current = ''
  }

  /**
   * `inCell` exists because a table cell's contents are paragraphs, and a
   * paragraph normally ends a line. Inside a cell it must not: a row is one
   * line, and « Dupont | DSI » split across two lines reads to the model as two
   * unrelated notes.
   */
  const walk = (node: unknown, inCell: boolean): void => {
    if (!isNode(node)) return

    if (typeof node.text === 'string') {
      current += node.text
      return
    }

    const type = typeof node.type === 'string' ? node.type : ''
    const cell = type === 'tableCell' || type === 'tableHeader'
    const block = BLOCK.has(type) && !inCell

    if (block) flush()

    // `hardBreak` is a line break inside one block — the rep pressed
    // shift+enter, which in a notepad means "still the same thought".
    if (type === 'hardBreak') current += '\n'

    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child, inCell || cell)
    }

    // Table cells are neighbours on a row, not separate thoughts.
    if (cell) current += ' '

    if (block) flush()
  }

  walk(doc, false)
  flush()

  return lines.join('\n')
}

/** True when the rep typed nothing worth passing to the model. */
export const isBlankDocument = (doc: unknown): boolean => documentToText(doc).trim().length === 0
