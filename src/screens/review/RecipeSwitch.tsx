/**
 * **Which compte-rendu this is, on the document, at the gate** (DEC-43).
 *
 * The recipe was decided before the call and then invisible for ever: a rep who
 * recorded a discovery call under the ESN trame and wanted the free one had no
 * way to say so without re-recording. Measured on the shipped gate at 1280×800
 * and 960×600 — the words « Prise de besoin », « Compte-rendu libre », « Modèle »
 * appear **nowhere** on the screen, and none of its forty-two controls can change
 * it. The document VerySwing receives was shaped by a choice the screen that
 * ships it never mentions.
 *
 * So the shape is named on the document and the other shapes are one press away.
 * Three things bound it and each is the reason a line of this file reads the way
 * it does.
 *
 * **It is a picker over the declared set, never an editor** (DEC-43). `RECIPES`
 * is the whole of what it offers and a third recipe is an entry there plus its
 * prompt — a rep-authored template would be a prompt nobody benchmarks, which is
 * the half of DEC-13 that stands.
 *
 * **The consequence is on screen before the press, and it is counted rather than
 * asserted.** A rewrite replaces the document the rep's corrections were made
 * against, so those corrections go — `PENDING_EDITS` is per meeting and in
 * memory, and silently discarding a rep's corrections is the one thing the
 * review gate exists to prevent (DEC-4). `edited` is the number of fields that
 * differ from what the main process pre-filled, so the sentence says « votre
 * correction » when there is one and names the count when there are several, and
 * says something different when there are none. A sentence that guesses would be
 * the only thing on this screen not measured.
 *
 * **It is chrome, so it does not ship, so it is marked.** The caller wraps this
 * in `data-unmeasured` — the arming guard measures what leaves the machine, and
 * a control is not content. Measured on the shipped gate at both smoke sizes:
 * opening the panel grows the column's scroll range by **230 px** and its
 * *measured* height by **0.0 px**. What the mark buys is stated honestly and is
 * not an arming difference — unmarked, the panel is forgiven anyway, because the
 * press that opened it is inside the column and holds the caret, and `read()`
 * credits growth under the rep's own cursor. What it buys is that the recorded
 * content height stays the document's (2 375 px) instead of the document plus a
 * control (2 630 px), so a later arrival of real unseen prose is measured against
 * the document rather than against 254 px of slack a control bought.
 *
 * No sparkle. The reference frame marks its recipe chip with ✨ because that is
 * how it marks « AI »; nothing in this product does, and `⚠ faible` is the only
 * glyph it spends on a claim about a model.
 */
import { useState } from 'react'
import { RECIPES, recipeById, type RecipeId } from '../../../electron/core/contracts/recipes.ts'
import { Button } from '../../ui/index.ts'
import { cn } from '../../lib/utils.ts'

export interface RecipeSwitchProps {
  /**
   * What the meeting is set to produce. `null` while that is not known — the
   * chip is then absent rather than blank, because a control naming no value is
   * a control that promises nothing (DEC-26), and the gate is not waiting on it.
   */
  current: RecipeId | null
  /**
   * How many fields the rep has changed from the main process's pre-fill.
   * Counted by the caller, which is the only thing holding both.
   */
  edited: number
  /** Why the last press recorded nothing, in French, or null. */
  failure: string | null
  onRewrite: (next: RecipeId) => void
}

export function RecipeSwitch({ current, edited, failure, onRewrite }: RecipeSwitchProps) {
  const [open, setOpen] = useState(false)
  if (current === null) return null

  const recipe = recipeById(current)
  const others = RECIPES.filter((other) => other.id !== current)

  return (
    <div className="mb-inline">
      {/*
        The whole label is inside the button, so the accessible name says what
        the control is about — « Modèle : Prise de besoin commercial » — rather
        than naming a value and leaving the subject to the paragraph beside it.
        Same shape as the row's `source ▸`: `min-h-[24px]` and `inline-flex
        items-center`, because this sits on a baseline under the section header
        and padding would push the document down instead of growing the target.
      */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="border-card bg-inner text-body hover:bg-subtle inline-flex min-h-[24px] shrink-0 items-center gap-hair rounded-sm border px-snug py-0.5 text-meta transition"
      >
        {`Modèle : ${recipe.title}`}
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>

      {failure ? (
        <p role="alert" className="text-danger measure mt-hair text-meta">
          {failure}
        </p>
      ) : null}

      {open ? (
        /*
          **A fill, not a fill and a stroke.**

          This sat on `--bg-card-soft` inside a `--border-subtle` box, on the
          document column, which is white. Measured in the page at both smoke
          sizes: the fill was ΔL* **1.478** from the white under it — about a
          just-noticeable difference — so the hairline was doing all of the
          bounding and the ground was a step nobody could see.

          `--bg-subtle` is the ground the gate already uses for « material you
          read rather than type into », four lines from here in the field rail,
          and on white it is ΔL* **4.422**. At three times the step the filled
          area *is* the region, which is the argument the rail's own note makes
          at length, so the stroke comes off with it: one grammar on this
          screen — a panel is a fill, a hairline is a rule between things.
        */
        <div className="bg-subtle mt-tight rounded-sm p-snug">
          {/* What the document on screen was shaped by, in the recipe's own words. */}
          <p className="text-muted measure text-meta">{recipe.description}</p>

          {/*
            **The consequence, above the control that causes it.**

            Below the buttons it would be a sentence the rep reads after the
            press, which on this screen is a correction already destroyed. The
            three things it names are the three that are recomposed — the
            document, the eleven typed rows and the follow-up draft — and the
            two that are not: the notes are the rep's (DEC-5) and the transcript
            is the record (DEC-21).
          */}
          <p
            className={cn(
              'measure mt-snug text-meta',
              edited > 0 ? 'text-warn font-semibold' : 'text-muted',
            )}
          >
            {edited === 0
              ? 'Réécrire remplace le compte-rendu, les champs et le brouillon de cet écran.'
              : edited === 1
                ? 'Réécrire remplace le compte-rendu, les champs et le brouillon : votre correction sur cet écran sera perdue.'
                : `Réécrire remplace le compte-rendu, les champs et le brouillon : vos ${edited} corrections sur cet écran seront perdues.`}{' '}
            Vos notes et la transcription ne changent pas. La validation reprendra dès que le
            nouveau compte-rendu sera prêt.
          </p>

          <ul>
            {others.map((other) => (
              <li key={other.id} className="mt-snug">
                <Button
                  variant="bordered"
                  /*
                    Closed by the press, because the gesture is over: the choice
                    is recorded, and what happens next is a document arriving in
                    the column behind this panel. Leaving it open would put a
                    second « Réécrire avec … » under the rep's pointer over a
                    document that is already being replaced. A press that was
                    *refused* still says so — `failure` is drawn outside this
                    block, beside the chip.
                  */
                  onClick={() => {
                    setOpen(false)
                    onRewrite(other.id)
                  }}
                >
                  {`Réécrire avec « ${other.title} »`}
                </Button>
                {/*
                  The recipe's own `description`, which states what it does *and*
                  what it costs — the free one has no typed field, so no measured
                  confidence and no VerySwing opportunité. That is the sentence a
                  rep needs before pressing, and it is declared once in
                  `recipes.ts` rather than written again here.
                */}
                <p className="text-muted measure mt-hair text-meta">{other.description}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
