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
 */
import { ReadingColumn, SectionHeader } from '../../ui/index.ts'
import { AskPanel } from './AskPanel.tsx'
import { useFollowUpAction } from './askActions.ts'
import { CompteRenduDocument, CompteRenduMarkersNote } from './CompteRenduDocument.tsx'

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
      <SectionHeader className="shrink-0">Compte-rendu</SectionHeader>

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
        The way out, stated once. The rep reading this pane is one step from the
        gate, and the gate is where the editable copy lives — saying so here is
        cheaper than letting them discover that this text cannot be corrected.

        `border-t` and not just a margin. This line is pinned under a scroller,
        and with only `mt-2` between them the document's last visible line was
        clipped hard against it: at the app's minimum window the compte-rendu
        ended mid-sentence one line above « Lecture seule », and the two read as
        one run of text — the caption looked like the document's closing line
        rather than a note about it. A rule is what says the scroll ended and
        something else began.
      */}
      <div className="text-muted border-subtle mt-2 shrink-0 border-t pt-2 text-meta">
        <p>Lecture seule — corrigez-le à l’étape « Relire et valider ».</p>
        <CompteRenduMarkersNote className="mt-0.5" />
      </div>

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
