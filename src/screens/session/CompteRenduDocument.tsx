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
 * characters at `--type-meta`, plus the 6px `mr-tight`) with room to spare, and
 * `scripts/harness/geometry.mjs` measures the painted rects.
 *
 * Set at `--type-prose`, the same size as the rep's own notepad — and this
 * paragraph used to say exactly that about `--type-copy`, which was **false**.
 * The notepad is 15px (`src/editor/Notepad.tsx`) and this was 14px, with the
 * headings a full step down as well (20/16/14 against 24/19/16), so the
 * document the app produced was quieter than the notes it was written from at
 * every level — on the surfaces where the compte-rendu *is* the output, and on
 * the one screen that draws both at once. The claim was right about what should
 * be true and wrong about what was, which is the eighth time prose in this repo
 * has been wrong about the code. `--type-prose` and its three siblings exist so
 * the sentence is now checkable against a token instead of a literal.
 */
import { Search } from 'lucide-react'
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
  /**
   * **Where the generated lines came from** (DEC-21), paired with the span each
   * was written from.
   *
   * `onQuote` above makes the quotations followable, and those were the only
   * followable thing in the document: five fragments across twenty-eight
   * substantive lines, and **none on the twelve bullets**. The bullets are the
   * operative half — « Envoyer 3 CV avec TJM avant vendredi » is the commitment
   * that becomes the VerySwing task — and they were the least checkable thing on
   * the screen.
   *
   * Matched on **string equality**, never on a heuristic: `compteRenduSources`
   * composes each entry through the same formatter that wrote the line, so a
   * bullet either is one of these or is not. A line that does not match is drawn
   * exactly as before, which is what keeps a recipe that types nothing — and a
   * stored extraction rendered by *Historique*, which has no panel — working
   * untouched.
   *
   * The document itself is not changed by this (DEC-44). VerySwing receives the
   * string the rep read; the provenance travels beside it.
   */
  sources?: readonly { text: string; span: { quote: string } }[]
  className?: string
}

/**
 * The gutter every marker hangs in.
 *
 * `pl-10` is 40px against `### `, the widest marker in the vocabulary, which
 * measures 31px at `--type-meta` plus its 6px `mr-tight`. The three callers each
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

/**
 * What each line class is set in. The `#` gutter is common to all of them.
 *
 * **One document scale, shared with the rep's notepad.** These were `[20px]`,
 * `[16px]` and `text-copy` — off the token scale, and one step below
 * `.notepad .ProseMirror`'s 24 / 19 / 16 at every level. The two documents sit
 * side by side on the session screen, so the product's own output was visibly
 * smaller than the scratchpad it was written from: the thing a rep is here to
 * read was set as the subordinate of the thing they jotted during the call.
 *
 * `--type-title` / `--type-heading` / `--type-subhead` are the notepad's own
 * numbers, named in `tokens.css`. The compte-rendu came up to meet them rather
 * than the notepad coming down, because the reference sets its note body near
 * 17px with a title at roughly twice that
 * (`docs/stories/ref/granola-note.png`) and the gap to close was upward.
 *
 * **And for three rounds that paragraph named only the sizes, so the same rung
 * was set in two typefaces.** The line above gave `font-display` to level 1 and
 * not to 2 or 3, while `.notepad .ProseMirror h1, h2, h3` takes the display
 * face from the base layer's tag rule — and the compte-rendu's headings are
 * `<div>`s, because this is a **typesetter** and not a markdown renderer, so
 * they inherited the body font instead. Driven on the shipped renderer,
 * `session-compte-rendu`@1280×800, the one screen that draws both documents at
 * once:
 *
 *     rung   bloc-notes                          compte-rendu
 *     24px   24/500/Fraunces  ls −0.8  lh 30     24/500/Fraunces  ls −0.8  lh 30
 *     19px   19/500/Fraunces  ls −0.4  lh 23.75  19/600/Inter     ls none  lh 26.13
 *     16px   (16/500/Fraunces by the same rule)  16/600/Inter     ls none  lh 22
 *
 * « À retenir » and « Résumé », the same rung and the same ink, in two
 * typefaces, one column apart. That is `4ee37e6`'s eyebrow and round 23's 28px
 * wordmark for the third round running, one rung lower each time, and each time
 * the family was decided by the tag rather than written down.
 *
 * **Which way it was settled, and it is a product decision and not a tidy-up.**
 * VISION §6 declares this ladder as « the compte-rendu and the rep's notepad are
 * one document set two ways », and `tokens.css` records that the *sizes* were
 * unified by bringing the compte-rendu up to the notepad's. The face follows the
 * same argument in the same direction: the notepad is the reference document,
 * all three of its headings are in the display face, and the alternative —
 * carving `font-family: var(--font-body)` into `.notepad .ProseMirror h2, h3` —
 * would be a fourth site deciding a family, which is the defect rather than the
 * fix. Fraunces at 16px is not a new setting in this product; it is what the
 * rep's own notepad has been drawing all along.
 *
 * No weight utility on any of the three: `.font-display` carries
 * `--display-weight` in the base layer, which is the rule `4ee37e6` shipped so
 * that writing the face writes the weight. The 0.4px of tracking is the
 * notepad's own — `index.css` writes it on `h2` and the base layer's `h3` rule
 * gives the same number to the rung below — and `leading-tight` is its 1.25,
 * which is what `text-title` was already wearing at level 1 while 2 and 3 wore
 * `leading-snug`. A rung is a size, a face, a weight, a tracking and a leading,
 * and holding three of the five equal is how two documents look alike in a
 * screenshot and different on a screen.
 *
 * `--census`' third display-face claim is what refuses the next one: every
 * heading inside a `[data-document]` is held to the declared display face, at
 * both smoke sizes, on every stage that draws either document.
 */
const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'font-display text-strong mt-block first:mt-0 text-title leading-tight',
  2: 'font-display text-strong mt-block first:mt-0 text-heading leading-tight tracking-[-0.4px]',
  3: 'font-display text-strong mt-row first:mt-0 text-subhead leading-tight tracking-[-0.4px]',
}

/**
 * The `⚠ faible` the composer appends, as it can appear in a rendered line.
 *
 * The space before it is a non-breaking one in the composer's output and an
 * ordinary one in a hand-written fixture, and both have to strip — a field whose
 * quote could not be verified is the field whose provenance a rep most wants to
 * follow, so losing the match there would be exactly backwards.
 */
const TRAILING_FAIBLE = /[\s\u00a0]*⚠[\s\u00a0]*faible[\s\u00a0]*$/u

export function CompteRenduDocument({
  text,
  onQuote,
  sources,
  className,
}: CompteRenduDocumentProps) {
  const lines = parseCompteRendu(text)

  /*
   * The line, without its `⚠ faible`, against what the composer wrote.
   *
   * The marker is appended to the rendered line and is not part of what was
   * said, so it is stripped before the comparison — otherwise every field the
   * extraction could not verify would lose the provenance it most needs. Exact
   * equality after that, on purpose: both strings came from the same formatter,
   * and a near-match here would be the app guessing which sentence the evidence
   * belongs to, which is the failure DEC-21 exists to prevent.
   */
  const sourceFor = (line: string): string | null => {
    if (!sources || sources.length === 0) return null
    const bare = line.replace(TRAILING_FAIBLE, '').trim()
    const hit = sources.find((s) => s.text === bare)
    // The **quote**, not the line. The line is how the document says it; the
    // quote is what was said, and only the second is findable in a transcript.
    return hit ? hit.span.quote : null
  }

  return (
    /*
      `data-document`: this element declares what it is, and the notepad
      (`src/editor/Notepad.tsx`) declares the same thing. VISION §6 calls the two
      « one document set two ways » and gives them one type ladder; `--census`'s
      third display-face claim holds every heading inside either of them to the
      display face, and it finds them by this attribute rather than by a
      selector list in the harness that a rename in this file would turn silent.
    */
    <div data-document="compte-rendu" className={className ? `${GUTTER} ${className}` : GUTTER}>
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
          /*
            The whole line is the citation when the composer wrote it from one.
            Not a fragment inside it: the bullet *is* the claim, and « 2 × Data
            Engineer confirmé — Databricks, Airflow, dbt » is one assertion whose
            evidence is one span. `onQuote` is given the line's own text, and the
            reader looks it up the way it looks up a quotation — including
            answering « introuvable », which is the honest outcome for a line the
            model composed from something it misheard.
          */
          const sourced = sourceFor(line.text)
          return (
            <div key={key} className="relative">
              <Marker>{line.marker}</Marker>
              <p className="text-body text-prose leading-relaxed">
                {sourced && onQuote ? (
                  /*
                    **Lighter than a quotation's underline, on purpose.**

                    A guillemet fragment is rare and sits inside a paragraph, so
                    it can afford the `--text-muted` rule `Demander` gives a
                    citation. Every bullet being followable is the opposite
                    situation: six consecutive rows of « Éléments retenus » all
                    ruled at that weight turned the section into a link farm and
                    made the document harder to read than the thing it is
                    evidence for. So the rest state is `--border-card`, which is
                    the weight of a table rule — present, findable, and not
                    competing with the words — and hover and focus bring it up to
                    the same rule a quotation wears, because at that point the
                    rep has singled the line out.

                    `focus-visible` and not only `hover`: twelve of these are
                    reached by keyboard, and a control whose only affordance is a
                    pointer is a control half the product cannot use.

                    `min-h-[24px]` because a one-line bullet — « **TJM évoqué** :
                    550 € » — measures 23, and WCAG 2.2's *Target Size* exception
                    for a control *inline in a sentence* does not apply: this
                    control **is** the line. Eight of the twelve were under the
                    floor, in a rail whose rows are a trackpad-width apart.
                  */
                  <button
                    type="button"
                    onClick={() => onQuote(sourced)}
                    aria-label={`Voir la source dans la transcription : ${line.text}`}
                    className="group text-body hover:text-strong hover:bg-inner focus-visible:bg-inner decoration-card hover:decoration-muted focus-visible:decoration-muted -mx-hair min-h-[24px] rounded-sm px-hair text-left underline decoration-dotted decoration-from-font underline-offset-4 transition"
                  >
                    <Prose text={line.text} />
                    {/*
                      The magnifier, at the end of the line, under the cursor
                      only. It names what the press does — open the record on
                      this line — where the dotted rule only says that a press
                      does something. Hidden at rest so twelve followable rows
                      do not become twelve glyphs; `focus-visible` brings it up
                      for the keyboard as hover does for the pointer. Brand
                      blue, not warn: this is a way in, not a doubt.
                    */}
                    {/*
                      **Zero inline width, because a decorative glyph must never
                      own a line.** At 960 the compte-rendu column is narrow
                      enough that a followable line can fill it to within less
                      than the magnifier's 14px, and the icon then wrapped alone
                      onto a second line: the control's box went from 24.38px to
                      48.75px — exactly two line boxes — for one line of text.
                      Measured on `review` at 960×600, the two rows the census
                      compared:

                        « 2 × Data Engineer … »  span top=1913 w=392  svg top=1916
                        « 1 × Lead Data … »      span top=1938 w=438  svg top=1965

                      At rest the icon is `opacity-0`, so what a rep saw was one
                      line in the column sitting under 24 pixels of nothing, and
                      a hit area twice its neighbours'. `--census` found it on
                      its first run and no other pass could: `--targets` asks
                      whether a control clears 24px and this one cleared it
                      twice over, `--geometry` measures declared hangs, and the
                      reading measure is about characters, not boxes. It takes a
                      check that reads a *distribution* to see that one member
                      of a family is the odd one.

                      The glyph is painted, not laid out: it keeps its 14px box
                      for the eye and contributes nothing to the line's width,
                      so it can no longer create the break opportunity that
                      orphaned it. It sits in the button's own `px-hair`, after
                      text that has already been measured to fit.
                    */}
                    <Search
                      aria-hidden
                      className="text-brand ml-hair inline size-3.5 w-0 -translate-y-px overflow-visible opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  </button>
                ) : (
                  <Prose text={line.text} onQuote={onQuote} />
                )}
              </p>
            </div>
          )
        }

        return (
          <p key={key} className="text-body whitespace-pre-wrap text-prose leading-relaxed">
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
      className="text-muted absolute top-0 right-full mr-tight select-none whitespace-pre font-mono text-meta leading-relaxed"
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
 * A component rather than a constant so the surfaces that carry it cannot drift
 * into different explanations of the same gutter.
 *
 * **It is drawn once, at the gate, and on no read-only surface.** It was on all
 * three that typeset a compte-rendu, two of which a rep can do nothing about —
 * including the session pane, during the call, where the document is read-only
 * and the line beside it already says the correction happens at the gate. A
 * legend a reader can only obey is a manual; the same sentence where the text is
 * editable and one press from a client's CRM is a promise (DEC-44). So a new
 * surface that draws a `CompteRenduDocument` draws no legend unless the document
 * there can be *changed*, and `Review.test.tsx` pins it to the gate while
 * `session-output.test.tsx` pins its absence from the session screen.
 *
 * One call site is left over and it is in another lane as this is written:
 * `Historique.tsx` draws it over a past record, which is as read-only as a
 * surface gets. Deleting it there is one line and the reason is this paragraph.
 *
 * It names four marks and not two. It said « ## et - », which are the two the
 * *recap* uses — while the first screenful of any compte-rendu is dominated by
 * `#` on the title and `**` on the four deterministic header lines. A legend
 * that omits the marks the eye actually lands on explains the wrong half.
 */
/**
 * **`ships` is « does this document reach VerySwing », and it is not a constant.**
 *
 * The sentence ended « VerySwing reçoit exactement ce qui est affiché », which is
 * a claim about a `POST /v1/crm/tasks` and was printed whether or not one was
 * going to be made. Driven on the shipped gate at 1280×800 with `crm.task`
 * unticked: this line and, twenty pixels under it, « La tâche VerySwing ne part
 * pas : ce texte-ci ne quitte pas l'application ». Same column, same frame,
 * opposite facts.
 *
 * What stays true either way is the half the note exists for — the markers are
 * text, not typesetting — so that half is unconditional and only the destination
 * moves.
 */
export function CompteRenduMarkersNote({
  className,
  ships,
}: {
  className?: string
  ships: boolean
}) {
  return (
    // `.measure` on the note itself, not inherited from the wrapper: `ch`
    // resolves against the *element's* font size, and this line is set at
    // `--type-meta` inside a box sized for `--type-copy`. Left to the wrapper it
    // ran to a hundred and eleven characters — the exact failure « one reading
    // measure » exists to prevent, reintroduced one font size down.
    <p className={`measure ${className ?? ''}`}>
      Les marques <span className="font-mono">#</span> <span className="font-mono">##</span>{' '}
      <span className="font-mono">-</span> <span className="font-mono">**</span> font partie du
      texte
      {ships
        ? ' : VerySwing reçoit exactement ce qui est affiché.'
        : ', et ils partent avec lui si la tâche VerySwing est cochée.'}
    </p>
  )
}
