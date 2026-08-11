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
import { SectionHeader } from '../../ui/index.ts'

interface CompteRenduPaneProps {
  /** The rendered markdown, as `renderCompteRendu` produced it. */
  compteRendu: string
}

export function CompteRenduPane({ compteRendu }: CompteRenduPaneProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden px-row py-row">
      <SectionHeader className="shrink-0">Compte-rendu</SectionHeader>

      {/*
        `whitespace-pre-wrap` and not a markdown renderer. This is the exact text
        that lands in the CRM task description and in the gate's textarea, and a
        pane that prettified it would show the rep something the CRM will not
        receive — on the one surface whose job is to let them check it before it
        goes. The headings read as headings because the recipe writes them that
        way (DEC-13).
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="text-body whitespace-pre-wrap text-ui leading-relaxed">{compteRendu}</p>
      </div>

      {/*
        The way out, stated once. The rep reading this pane is one step from the
        gate, and the gate is where the editable copy lives — saying so here is
        cheaper than letting them discover that this text cannot be corrected.
      */}
      <p className="text-muted mt-2 shrink-0 text-meta">
        Lecture seule — corrigez-le à l’étape « Relire et valider ».
      </p>
    </div>
  )
}
