/**
 * The compte-rendu, beside the rep's own notes, from the moment the analysis
 * lands (DEC-5, DEC-14).
 *
 * ## Why it is here and not only behind *Relire et valider*
 *
 * A meeting that ended used to leave the session screen showing the rep's raw
 * notes and a button. The one thing the product exists to produce was one click
 * away, on a screen called *Revue*, behind a label that reads like paperwork —
 * so the rep pressed *Terminer*, waited through several minutes of « Rédaction
 * du compte-rendu… », and then saw their own notes again. Nothing on screen was
 * the output.
 *
 * So it is drawn where they already are, next to the notes it was written from.
 *
 * ## What it deliberately is not
 *
 * **It is not the review gate.** DEC-4 says one human confirmation and DEC-23
 * says nothing surfaces while the meeting is recording. Both hold: this pane
 * carries no pre-filled form, no drafted intents, no `⚠ faible` markers and no
 * button that sends anything — `meeting:get` hands over the rendered document
 * and nothing else. *Relire et valider* is still the only door, and it is still
 * the only place anything leaves the machine.
 *
 * **It does not write into the rep's document.** DEC-5 is the invariant this
 * screen is built around, and the notepad's whole design is that there is no
 * incoming-transaction path into it (`editor/Notepad.tsx`). A pane beside the
 * notepad is a read; appending grey text into the document would be a write, and
 * it would put the AI's sentences inside the undo history of the one surface the
 * rep owns. The rep's notes stay theirs, editable, untouched, on the left.
 *
 * **It is read-only, and looks it.** The editable copy is at the gate, on a
 * surface that says « · modifiable » precisely because a borderless textarea is
 * indistinguishable from a preview. This one is a preview, so it is typed as
 * prose and takes no cursor.
 *
 * ## And it carries no caption and no manual
 *
 * It had both, on the screen a rep has open while a client is talking. The
 * caption read « COMPTE-RENDU » over a document whose own first line is
 * `# <objet>` at `--type-copy` — 479 px of eyebrow above 1 930 px of document
 * saying the same word, and the document says it larger. The manual read « Les
 * marques # ## - ** font partie du texte … » and explained this product's
 * typesetting convention to somebody who cannot act on it here: the text is
 * read-only and the line above it already says where the correction goes.
 * `CompteRenduMarkersNote` is drawn at the gate, which is the surface where the
 * document is editable and where the press that sends it to VerySwing lives —
 * see the rule in `ui/SectionHeader.tsx` and the component's own docblock.
 *
 * Measured on the shipped renderer, `session-compte-rendu` at both smoke sizes:
 * the reading column gained **65 px at each** — 458 → 523 of a 1 930 px document
 * at 1280×800, and 321 → 386 of 2 203 at 960×600, which is 14% and 20% more of
 * the document on screen. 29 of those pixels are the eyebrow (17 of ink and the
 * `mb-3` under it) and 36 are the manual, which wrapped to two lines in this
 * column at both sizes.
 */
import { ReadingColumn } from '../../ui/index.ts'
import { AskPanel } from './AskPanel.tsx'
import { useFollowUpAction } from './askActions.ts'
import { CompteRenduDocument } from './CompteRenduDocument.tsx'

interface CompteRenduPaneProps {
  /** The rendered markdown, as `renderCompteRendu` produced it. */
  compteRendu: string
  /** Which call *Demander* asks about. */
  meetingId: string
  /**
   * Whether this meeting came from the calendar (`eventId !== null`).
   *
   * Not a detail of the document: it is half of « can a follow-up draft exist
   * for this call », because the recipients are the invite's attendees and
   * nothing else (DEC-7). See `askActions.ts` for the other half and for why
   * the offer is withheld rather than shown refusing.
   */
  fromCalendar: boolean
}

export function CompteRenduPane({
  compteRendu,
  meetingId,
  fromCalendar,
}: CompteRenduPaneProps) {
  const followUp = useFollowUpAction({ fromCalendar })

  return (
    <div className="flex h-full flex-col overflow-hidden px-row py-row">
      {/*
        Typeset, and not a markdown renderer — `CompteRenduDocument` keeps every
        `#` and every `- ` on screen, muted, in a gutter. This is the exact text
        that lands in the CRM task description and in the gate's textarea, so a
        pane that *hid* a marker would show the rep something the CRM will not
        receive, on the one surface whose job is to let them check it before it
        goes. Drawing it as one raw block was honest and unreadable: beside the
        rep's own typeset notes it read as a log dump of something the machine
        had produced rather than as the document the product exists to write.
      */}
      {/*
        `ReadingColumn`, and not a bare `overflow-y-auto`, because this pane was
        hiding 73% of the document at 1280×800 with nothing on screen saying so —
        see the component. The fade and the page turn are the gate's own two
        instruments, on the surface where the rep meets the compte-rendu first.
      */}
      <ReadingColumn subject={{ determiner: 'le', noun: 'compte-rendu' }}>
        <CompteRenduDocument text={compteRendu} />
      </ReadingColumn>

      {/*
        **And no note under it.**

        « Lecture seule — corrigez-le à l'étape « Relire et valider ». » sat
        pinned under the document on its own rule, which is a sentence about the
        *next* screen taking a line of the column on this one. The pane is prose
        with no cursor in it and takes no keystrokes, which is the whole of what
        « lecture seule » was telling the rep; and the way to the gate is the one
        filled button in this screen's header, saying « Relire et valider » in
        the words this note was quoting. The promise is not dropped, it is made
        by the control rather than by a caption above it.
      */}

      {/*
        *Demander*, pinned under the document — which is where a general-purpose
        notetaker puts its « ask anything », and the placement is right for the
        same reason: the question a rep has is about the thing they are reading.

        Under the read-only note rather than above it, because the document is
        what the rep came for and the question is what they have *after* reading
        it. And pinned rather than scrolling with the document, so it is reachable
        from any point of a long compte-rendu.

        No `onLocate`: this pane has no transcript beside it. The citations are
        still drawn — a quoted sentence with its timestamp is worth reading on its
        own — they simply do not open, which the panel states rather than
        offering a control that goes nowhere (DEC-26). The gate is where a
        citation is followable, because that is where the reader lives.
      */}
      {/*
        `pinned`, and `max-h-[45%]` is the share it may take. Unbounded, one
        answer pushed the document down to its heading and one line of
        « Résumé » — asking a question cost the rep the thing they were asking
        about. The document keeps the majority of the column in every case.
      */}
      {/*
        And the one suggested action, which is this pane's and not the panel's:
        the note is where a rep asks « et maintenant, je fais quoi de ça ? », and
        the answer this product has is the follow-up draft it composes at the
        gate. Offered only where that draft can exist — `askActions.ts` holds
        the rule and the two reasons `draftIntents` gives.
      */}
      <AskPanel
        meetingId={meetingId}
        pinned
        action={followUp}
        className="border-subtle mt-3 max-h-[45%] shrink-0 border-t pt-3"
      />
    </div>
  )
}
