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
 *
 * **The document owns the gutter's width, and no caller passes it.** The three
 * surfaces that draw a compte-rendu each set their own `pl-6`, which is 24px —
 * narrower than `### `, so ten of the twenty-three markers on a real document
 * were clipped against the pane's left edge, the `###` losing a third of itself.
 * That is the exact failure the gutter exists to prevent, and it is invisible in
 * a DOM test: the text is present, the box is the wrong size. `GUTTER` is
 * measured against the widest marker in the vocabulary (`### `, four monospace
 * characters at `--type-meta`, plus the 6px `mr-1.5`) with room to spare, and
 * `scripts/harness/geometry.mjs` measures the painted rects.
 *
 * Set at `--type-copy`, the same size as the rep's own notepad. It was one step
 * down, which made the document the app produced quieter than the notes it was
 * written from — on the surfaces where the compte-rendu *is* the output.
 */
import { parseCompteRendu, parseInline } from './compteRenduLines.ts'

interface CompteRenduDocumentProps {
  /** The rendered document, exactly as `renderCompteRendu` produced it. */
  text: string
  /**
   * **Open the record on a fragment the model quoted** (DEC-21).
   *
   * The eleven typed fields each carry a `[source ▸]`; the prose beside them
   * carried none, on the screen whose whole argument is that a claim must be
   * checkable against the recording — and the prose is the string VerySwing
   * receives and the rep pastes into a proposal. The only part of it that
   * *claims* to be verbatim is what sits inside guillemets: `REGISTRE` licenses
   * « … » for a few words the client actually said, and everything else is the
   * model reporting.
   *
   * So those are the fragments this makes followable, and nothing else. There is
   * no pre-verification and deliberately none: the reader already says
   * « introuvable » when a quote is not in the record, and seeds its search with
   * the fragment that failed — so a quotation the model invented leads to a
   * screen that says so, without this surface fetching a transcript nobody asked
   * for. `source ▸` is asked for by a click and never otherwise, and this keeps
   * that rule.
   *
   * Absent on a surface with no record beside it. The quote is still drawn — it
   * is worth reading either way — it simply does not become a control that goes
   * nowhere (DEC-26).
   */
  onQuote?: (quote: string) => void
  className?: string
}

/**
 * The gutter every marker hangs in.
 *
 * `pl-10` is 40px against `### `, the widest marker in the vocabulary, which
 * measures 31px at `--type-meta` plus its 6px `mr-1.5`. The three callers each
 * used to pass their own `pl-6` — 24px, narrower than the thing it had to hold —
 * and the session pane passed none at all. A caller may add margins and a
 * `.measure`; it never sets this.
 *
 *     node scripts/harness/shot.mjs session-compte-rendu x.png --no-png --geometry
 *
 * prints the tightest clearance on the screen, which is the number to tune
 * against — not the marker that happened to break first.
 */
const GUTTER = 'pl-10'

/** What each line class is set in. The `#` gutter is common to all of them. */
const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'font-display text-strong mt-block first:mt-0 text-[20px] leading-tight',
  2: 'text-strong mt-block first:mt-0 text-[16px] font-semibold leading-snug',
  3: 'text-strong mt-row first:mt-0 text-copy font-semibold leading-snug',
}

export function CompteRenduDocument({ text, onQuote, className }: CompteRenduDocumentProps) {
  const lines = parseCompteRendu(text)

  return (
    <div className={className ? `${GUTTER} ${className}` : GUTTER}>
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
              <div className={HEADING_CLASS[line.level]}>
                <Prose text={line.text} onQuote={onQuote} />
              </div>
            </div>
          )
        }

        if (line.kind === 'bullet') {
          return (
            <div key={key} className="relative">
              <Marker>{line.marker}</Marker>
              <p className="text-body text-copy leading-relaxed">
                <Prose text={line.text} onQuote={onQuote} />
              </p>
            </div>
          )
        }

        return (
          <p key={key} className="text-body whitespace-pre-wrap text-copy leading-relaxed">
            <Prose text={line.text} onQuote={onQuote} />
          </p>
        )
      })}
    </div>
  )
}

/**
 * One line's prose, with `**gras**` and `_italique_` set — and their markers
 * still on screen.
 *
 * Same rule as the gutter, one level down: nothing is hidden, so the string the
 * rep reads is the string VerySwing receives (DEC-44). The asterisks and the
 * underscores are drawn in `--text-muted`, which is quiet enough to read past
 * and present enough to be checked — and the words between them are bold or
 * italic, which is what makes « **Client** : Néovia Santé » a labelled line
 * rather than a row of punctuation.
 *
 * **They are set in the document's own face and size, not in mono at
 * `--type-meta`.** The block markers can afford a different face because they
 * hang in a gutter, in a column of their own, with nothing beside them. These
 * sit *inside* a line — and the first four lines of every ESN document open on
 * one: `**Client**`, `**Date**`, `**Interlocuteurs**`, `**Commercial**`. A
 * monospace asterisk pair at a smaller size, on its own baseline, jammed against
 * a bold capital, four times running, reads as markup that failed to render,
 * which is the exact impression the gutter exists to prevent. Same face, same
 * size, muted and a shade tighter: the marks are legible, checkable, and stop
 * being the loudest thing on the first screenful.
 *
 * `select-none` on the markers for the reason the gutter has it: the pane is
 * read-only and a rep dragging across it wants the prose. The editable copy at
 * the gate is where the raw string is selectable in full.
 */
function Prose({ text, onQuote }: { text: string; onQuote?: (quote: string) => void }) {
  return (
    <>
      {parseInline(text).map((run, index) => {
        const key = index
        if (run.kind === 'marker') {
          return (
            <span key={key} className="text-muted select-none tracking-tight">
              {run.text}
            </span>
          )
        }
        if (run.kind === 'strong') {
          return (
            <strong key={key} className="text-strong font-semibold">
              {run.text}
            </strong>
          )
        }
        if (run.kind === 'quote') {
          if (!onQuote) return <span key={key}>{run.text}</span>
          return (
            /*
              Underlined and dotted, the same treatment `Demander` gives a
              citation — a quotation is evidence on every surface of this
              product and should look like the same thing on all of them.
              `inline` so it never breaks the line it sits in, and the guillemets
              travel with it because the string is the rep's to read whole.
            */
            <button
              key={key}
              type="button"
              onClick={() => onQuote(run.inner)}
              className="text-body hover:text-strong decoration-muted underline decoration-dotted decoration-from-font underline-offset-4 transition"
            >
              {run.text}
            </button>
          )
        }
        if (run.kind === 'faible') {
          /*
            The same ink the rail and the banner give it — `--warn`, and
            `whitespace-nowrap` so the glyph and the word cannot be split across
            a line. `font-semibold` because at `--type-copy` the orange alone is
            a hue difference and nothing else, and a hue difference is what a
            deuteranope, a greyscale print and a projector all lose.
          */
          return (
            <span key={key} className="text-warn whitespace-nowrap font-semibold">
              {run.text}
            </span>
          )
        }
        if (run.kind === 'em') {
          return (
            <em key={key} className="italic">
              {run.text}
            </em>
          )
        }
        return <span key={key}>{run.text}</span>
      })}
    </>
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
    <span
      // `geometry.mjs` measures every one of these against the box it hangs in.
      data-hangs="marqueur"
      className="text-muted absolute top-0 right-full mr-1.5 select-none whitespace-pre font-mono text-meta leading-relaxed"
    >
      {children}
    </span>
  )
}

/**
 * **The legend.**
 *
 * The gutter of `#`, `##` and `- ` was drawn beside headings that are *also* set
 * as headings, and nothing on any of the three screens said why — so the first
 * thing the eye landed on in the compte-rendu column looked like leaked markup
 * or a rendering bug. It is neither, and the reason it is there is worth exactly
 * one sentence: the string a rep reads is byte-for-byte the string VerySwing
 * receives (DEC-44), which is a promise no markdown renderer can keep and the
 * only reason the markers survive at all.
 *
 * A component rather than a constant so the three surfaces that carry it — the
 * session pane, the gate, the history record — cannot drift into three
 * different explanations of the same gutter.
 *
 * It names four marks and not two. It said « ## et - », which are the two the
 * *recap* uses — while the first screenful of any compte-rendu is dominated by
 * `#` on the title and `**` on the four deterministic header lines. A legend
 * that omits the marks the eye actually lands on explains the wrong half.
 */
export function CompteRenduMarkersNote({ className }: { className?: string }) {
  return (
    // `.measure` on the note itself, not inherited from the wrapper: `ch`
    // resolves against the *element's* font size, and this line is set at
    // `--type-meta` inside a box sized for `--type-copy`. Left to the wrapper it
    // ran to a hundred and eleven characters — the exact failure « one reading
    // measure » exists to prevent, reintroduced one font size down.
    <p className={`measure ${className ?? ''}`}>
      Les marques <span className="font-mono">#</span> <span className="font-mono">##</span>{' '}
      <span className="font-mono">-</span> <span className="font-mono">**</span> font partie du
      texte : VerySwing reçoit exactement ce qui est affiché.
    </p>
  )
}
