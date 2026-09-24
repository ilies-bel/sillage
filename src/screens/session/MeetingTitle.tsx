/**
 * The meeting's objet and client, typed where they are actually known.
 *
 * A meeting now starts on one click and therefore starts with no name — nothing
 * asks for one in front of the microphone, and nothing invents one afterwards
 * (`modules/extract/facts.ts`). This is where it gets one: an input in the
 * session header, in the call or after it, on the screen the rep is already
 * looking at.
 *
 * ## Why an input and not a heading with a pencil
 *
 * The two states of an edit-in-place control are a heading and a field, and the
 * rep has to discover that the first can become the second. Here it is always
 * the field: it is borderless until hovered or focused, so it reads as a title
 * and behaves as a text box, and an untitled meeting shows a real `placeholder`
 * rather than a stored « Sans titre » that would travel into the CRM.
 *
 * ## Saving
 *
 * On blur and on Enter, never per keystroke: `meeting:rename` appends an event
 * to the meeting's log, and one event per character would put a thousand rows in
 * the log for a nine-character objet. Escape restores what was there.
 *
 * A meeting armed from Outlook takes its subject from Graph, and `meeting:rename`
 * does not touch `MeetingContext` — renaming one here changes what the app calls
 * it and never what Exchange does.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../app/bridge.ts'

interface MeetingTitleProps {
  meetingId: string
  /** As the store has it. `''` for a meeting started on one click. */
  title: string
  /** The rep's display name for the client, or null. */
  clientName: string | null
}

export function MeetingTitle({ meetingId, title, clientName }: MeetingTitleProps) {
  const [objet, setObjet] = useState(title)
  const [client, setClient] = useState(clientName ?? '')
  /** What was last persisted, so a save is skipped when nothing moved. */
  const saved = useRef({ objet: title, client: clientName ?? '' })

  /*
   * The store wins when the meeting changes underneath — a Graph sync landing
   * `meeting.context.updated`, or this screen being reopened on another meeting.
   * Not a controlled-from-props input: that would fight the rep mid-word every
   * time a broadcast re-rendered the header.
   */
  useEffect(() => {
    saved.current = { objet: title, client: clientName ?? '' }
    setObjet(title)
    setClient(clientName ?? '')
  }, [meetingId, title, clientName])

  const save = useCallback(async () => {
    const next = { objet: objet.trim(), client: client.trim() }
    if (next.objet === saved.current.objet && next.client === saved.current.client) return
    try {
      await invoke('meeting:rename', {
        meetingId,
        title: next.objet,
        clientName: next.client,
      })
      saved.current = next
    } catch {
      // The rename failed and the field keeps what the rep typed, so the next
      // blur retries it. A header that reverted their words to prove a channel
      // is down would lose the only copy of them.
    }
  }, [meetingId, objet, client])

  const keys = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
        return
      }
      if (event.key === 'Escape') {
        setObjet(saved.current.objet)
        setClient(saved.current.client)
        event.currentTarget.blur()
      }
    },
    [],
  )

  return (
    /*
     * `overflow-hidden`, because `min-w-0` on its own only lets this box shrink
     * — it does not stop what is inside from painting outside it. The client
     * input used to be `shrink-0`, so once the header ran out of room the two
     * fields overflowed *this* container and drew straight over the control
     * beside it: at the app's own minimum window (960px, `main.ts`) « Modèle »
     * landed in the middle of « Néovia Santé ». Both fields shrink and both
     * truncate now, and the clip is the backstop for whatever is added next.
     *
     * `gap-snug` and not `gap-inline`: the header this sits in is itself a
     * `gap-inline` row, so at twelve the objet and its client were exactly as
     * far apart as the pair of them was from the *Modèle* picker and the back
     * link — two fields naming one meeting, spaced like four unrelated
     * controls. Eight inside twelve is two rungs of the declared ladder, which
     * is the smallest difference this scale can make and still be seen.
     */
    /*
     * **`py-tight` on both fields, and it is a height and not a taste.**
     *
     * At `py-hair` the header drew three controls in one row at three heights:
     * the objet at **31.69px**, the client at **28.59**, and *Démarrer* /
     * *Terminer* beside them at **32.59** — the objet and the button 0.90px
     * apart, on eleven screens at both sizes. A difference that small is not a
     * hierarchy, it is the arithmetic of `--type-copy` and `--type-ui` sharing a
     * padding rung with a button that does not, and `--census` fails on it now.
     *
     * Six is the padding the `Button` beside them already carries. It puts the
     * client field at exactly the button's 32.59 — the same control height, not
     * nearly it — and the objet at 35.69, which is three pixels clear and is
     * what holding `--type-copy` costs. The row is baseline-aligned, so the
     * fields grow around their own text rather than pushing the header apart.
     */
    <div className="flex min-w-0 flex-1 items-baseline gap-snug overflow-hidden">
      {/*
        `h1` is elsewhere on this screen's structure; this is the input that
        carries the name, so it takes the accessible label instead. Not
        `font-display` — the base layer gives every `h1` Fraunces at
        `--display-tracking`, a setting for 28px and a smudge at 14.
      */}
      <input
        value={objet}
        aria-label="Objet de la réunion"
        placeholder="Sans objet"
        maxLength={200}
        onChange={(event) => setObjet(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={keys}
        /*
         * Sized to what is in it, floored, capped, and **not** growing.
         *
         * This field used to be `flex-1`, and both ends of that were wrong.
         *
         * Growing was the visible half: `flex-1` takes every spare pixel, so on
         * a wide window the objet inflated to fill the header and pushed the
         * client box to the far side of it. At 1440 « Néovia Santé » sat some
         * 900px from the title it belongs to, reading as a fourth, unlabelled
         * header item rather than as that meeting's client. A subtitle has to be
         * beside the thing it subtitles.
         *
         * Shrinking to nothing was the other half: `flex: 1 1 0%` gives this
         * field a zero basis, so under compression it surrendered every pixel it
         * had while the 144px client box beside it kept all of its — the header
         * at 960px showed « Né… » and no objet at all. The objet is the
         * meeting's name and the client is a subtitle, so the floor goes here
         * and the client gives ground first.
         *
         * `field-sizing: content` is what makes hugging possible at all: an
         * `input` does not shrink-wrap its value the way a `span` would, so
         * without it a 20-character objet still occupied a 42-character box and
         * the client stayed adrift. It needs no measuring span and no resize
         * observer. Chromium-only, which here is every target — Electron ships
         * its own, so the two platforms of HR-2 render this identically, and a
         * browser without it falls back to the bounded fixed box.
         *
         * **`max-w-full`, and the `max-w-[42ch]` it replaces was a ceiling under
         * the floor.** Its own comment here read « nothing the calendar produces
         * reaches it ». Measured on the shipped renderer, `agenda-preparer` —
         * the screen *Préparer* lands on, staged from the product's own fixture:
         *
         *     plafond 42ch          379.42px
         *     boîte de contenu      365.41px
         *     texte de l’objet      368.84px   ← coupé, aux deux tailles
         *     place libre dans sa propre cellule, 1280×800   355.66px
         *
         * So the one invite the harness arms ended in an ellipsis at **both**
         * smoke sizes while 355.66px of its own flex cell went unused. The cap
         * was not protecting a control: everything to its right is `shrink-0`
         * and the cell is `flex-1 min-w-0 overflow-hidden`, so the header
         * already bounds this field — the objet can only ever take what the
         * controls leave, and past that it shrinks and truncates exactly as
         * before. `100%` says that in the one place that cannot drift from the
         * layout, where a character count guessed in advance cannot.
         *
         * After, same stage, same fixture: 382.84px of box, 368.84 of content,
         * 368.84 of text — the whole objet, at 1280×800 and at 960×600, with
         * the header row still ending at x=1248 of 1280 and x=928 of 960, as it
         * did before.
         *
         * **Not measured by any pass — closed.** `--cells` is the check whose
         * subject this is, and it was blind to it by three separate
         * constructions: it read what a cell's contents *want* through a `Range`
         * over its child nodes and an `<input>` has none; it took a flex row's
         * want to be its widest cell rather than the sum of them, and the cell
         * that is short here is the group holding these two fields; and it
         * skipped any cell whose `textContent` was empty, which a group of
         * fields is. It reported « 0 à l’étroit » on this screen with the objet
         * visibly cut. All three are widened now, and this line is marked in the
         * commit that closes it rather than left standing in the present tense.
         *
         * What it measures here, at 960×600 — the minimum `main.ts` declares:
         *
         *     « Objet de la réunion »   boîte 156.3   veut 261   ← 105px coupés
         *     « Client »                boîte  64     veut  89   ←  25px coupés
         *     le groupe                 boîte 228.3   veut 358
         *
         * — « Néovia Santé — ca… » beside « Néovia… ». Both fields carry
         * `field-sizing: content`, which sets a *preferred* size and does not
         * stop a flex parent from shrinking past it, so the declaration this
         * repo's invariants name as « nothing hides inside a field » reads as
         * kept and is not.
         *
         * **And the pass says it is the window and not this row**, which is the
         * honest reading and the reason nothing here changed: against a 129.7px
         * shortfall the header's fixed neighbours hold **nothing a character
         * wide** — six pixels of a status chip's rounding, which the claim's own
         * floor refuses — so no redistribution inside this row can fix it. At 960 the header
         * carries more than the window holds. Dropping the client field would
         * buy the objet 72px and leave it 33 short of the same fixture's title;
         * the room would have to come from the meter (DEC-38) or the recipe
         * picker (DEC-43), and neither is a layout decision. The pass counts it
         * on every run at both sizes, so the next attempt starts from a number.
         */
        className="text-strong placeholder:text-muted hover:border-subtle focus:border-subtle focus:bg-inner min-w-[7rem] max-w-full shrink truncate rounded-sm border border-transparent bg-transparent px-tight py-tight font-sans text-copy font-medium outline-none [field-sizing:content]"
      />
      <input
        value={client}
        aria-label="Client"
        placeholder="Client"
        maxLength={200}
        onChange={(event) => setClient(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={keys}
        /*
          `max-w-36` is the ceiling it wants and `min-w-[4rem]` the floor it
          keeps. It gives ground to the objet — the field with the longer value
          and the one a rep is more often reading — but it was `min-w-0`, and at
          960px, the window's own minimum, it surrendered to **fourteen pixels**:
          a text field too narrow to show a character, too narrow to click, and
          holding the client's name on the screen where the rep is on the call
          with them. Four rem clears WCAG 2.2's target size with room and still
          lets the objet win every pixel above it (`shot.mjs --targets`).

          `field-sizing: content` for the same reason as the objet — a one-word
          client in a 144px box leaves a hole between the two halves of what is
          meant to read as one title.
        */
        className="text-muted placeholder:text-muted hover:border-subtle focus:border-subtle focus:bg-inner max-w-36 min-w-[4rem] truncate rounded-sm border border-transparent bg-transparent px-tight py-tight text-ui outline-none [field-sizing:content]"
      />
    </div>
  )
}
