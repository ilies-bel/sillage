/**
 * Which compte-rendu this meeting produces, chosen from the session header
 * (DEC-43).
 *
 * It sits in the header and not in the signal rail, even though the rail is the
 * surface that *shows* the consequence. DEC-14 says the rail is read-only and
 * that nothing on it is clickable during a call, and that rule is worth more
 * than the adjacency: a rep who has learned they can click one thing in the rail
 * will look at it again, during the call, which is the glance the rail exists
 * not to cost.
 *
 * ## Two moments, two behaviours
 *
 * **Before there is a compte-rendu** — the ordinary case, mid-call — a click is
 * the whole gesture. Nothing has been written, so nothing is at stake; the
 * choice is recorded and the extraction at the end of the meeting reads it.
 *
 * **After** — the meeting has ended and a document exists — the click arms a
 * confirmation instead, because the run costs minutes of a model's time and
 * replaces a document the rep may be reading. The confirmation is an inline
 * strip and not a modal: this screen holds a live ProseMirror view with the
 * rep's caret in it, and a dialog that steals focus from it to ask about a side
 * panel is a worse interruption than the thing it is protecting against.
 *
 * Nothing here touches the rep's notes, in either moment. Switching the recipe
 * rewrites the compte-rendu and nothing else (DEC-5).
 *
 * ## Why the state is a hook and the control is two components
 *
 * The toggle belongs in the one-line header; the sentence explaining what is
 * about to be overwritten does not fit on that line, and truncating *that*
 * sentence is how a rep regenerates a compte-rendu without reading what they
 * agreed to. So the confirmation is a strip in the document flow, under the
 * header — a different place in the DOM, driven by the same state. `useRecipeChoice`
 * owns that state so `Session.tsx` can place the two halves without owning any
 * of the logic between them.
 */
import { useCallback, useState } from 'react'
import { RECIPES, type RecipeId } from '../../../electron/core/contracts/recipes.ts'
import type { MeetingState } from '../../../electron/core/contracts/meeting.ts'
import { invoke } from '../../app/bridge.ts'
import { Button, Segmented, type SegmentedOption } from '../../ui/index.ts'

const OPTIONS: readonly SegmentedOption<RecipeId>[] = RECIPES.map((recipe) => ({
  id: recipe.id,
  label: recipe.label,
}))

const describe = (id: RecipeId): string =>
  RECIPES.find((recipe) => recipe.id === id)?.description ?? ''

const titleOf = (id: RecipeId): string => RECIPES.find((recipe) => recipe.id === id)?.title ?? id

export interface RecipeChoice {
  current: RecipeId
  /** The choice waiting on a confirmation. Null when nothing is pending. */
  pending: RecipeId | null
  busy: boolean
  failure: string | null
  select: (next: RecipeId) => void
  confirm: () => void
  cancel: () => void
}

export interface UseRecipeChoiceInput {
  meetingId: string
  /** What the meeting is currently set to produce. */
  recipe: RecipeId
  /**
   * Whether a compte-rendu already exists. Drives the confirmation, and it is
   * the *document*'s existence rather than the meeting's state because a meeting
   * can sit in `ended` with one (a re-run that failed) or without one (no model
   * configured yet).
   */
  hasCompteRendu: boolean
  /** The choice landed. The parent re-reads the meeting. */
  onChosen: (recipe: RecipeId) => void
}

export function useRecipeChoice({
  meetingId,
  recipe,
  hasCompteRendu,
  onChosen,
}: UseRecipeChoiceInput): RecipeChoice {
  const [pending, setPending] = useState<RecipeId | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const apply = useCallback(
    async (next: RecipeId) => {
      setBusy(true)
      setFailure(null)
      try {
        const outcome = await invoke('meeting:recipe', { meetingId, recipe: next })
        setPending(null)
        onChosen(outcome.recipe)
      } catch (error) {
        // Stated, not swallowed. The picker goes on showing the old value, which
        // is the truth: nothing was recorded, so nothing changed.
        setFailure(error instanceof Error ? error.message : 'modèle non enregistré')
      } finally {
        setBusy(false)
      }
    },
    [meetingId, onChosen],
  )

  const select = useCallback(
    (next: RecipeId) => {
      if (next === recipe) {
        setPending(null)
        return
      }
      if (hasCompteRendu) {
        setPending(next)
        return
      }
      void apply(next)
    },
    [apply, hasCompteRendu, recipe],
  )

  const confirm = useCallback(() => {
    if (pending !== null) void apply(pending)
  }, [apply, pending])

  const cancel = useCallback(() => {
    setPending(null)
    setFailure(null)
  }, [])

  return { current: recipe, pending, busy, failure, select, confirm, cancel }
}

interface RecipePickerProps {
  choice: RecipeChoice
  /** The machine's state — a run in flight locks the control. */
  state: MeetingState | null
}

export function RecipePicker({ choice, state }: RecipePickerProps) {
  /*
   * Locked while an extraction is in flight, and the reason says which.
   *
   * Not cosmetic: `meeting:recipe` would happily record a second choice mid-run,
   * and the run already reading the first one would finish and store a document
   * whose recipe is not the one the picker shows. One control, one run.
   */
  const running = state === 'extracting' || state === 'pushing' || choice.busy
  // Past the gate the document is history — it has been sent (DEC-25). A picker
  // that could still rewrite it would be offering to change a record.
  const settled = state === 'done'

  return (
    <div className="flex min-w-0 shrink-0 flex-col">
      <div className="flex shrink-0 items-center gap-inline">
        <span className="text-muted shrink-0 text-meta">Modèle</span>
        {running || settled ? (
          /*
           * A word, not a disabled toggle group. `Segmented` has no disabled
           * state and giving it one would mean a row of greyed pills that still
           * look pressable; the current value plus the reason is the same
           * information in a shape that promises nothing (DEC-26).
           */
          <span className="text-body shrink-0 text-ui">
            {titleOf(choice.current)}
            <span className="text-muted"> · {settled ? 'validé' : 'rédaction en cours'}</span>
          </span>
        ) : (
          <Segmented
            label="Modèle de compte-rendu"
            options={OPTIONS}
            current={choice.pending ?? choice.current}
            onSelect={choice.select}
          />
        )}
      </div>

      {choice.failure ? (
        <p role="alert" className="text-danger mt-0.5 text-meta">
          {choice.failure}
        </p>
      ) : null}
    </div>
  )
}

/** The confirmation strip. Rendered under the header, never over the notepad. */
export function RecipeSwitchNotice({ choice }: { choice: RecipeChoice }) {
  const to = choice.pending
  if (to === null) return null

  return (
    <div
      role="status"
      className="border-subtle bg-card-soft flex shrink-0 items-center gap-inline border-b px-gutter py-2"
    >
      <p className="text-body min-w-0 max-w-[74ch] flex-1 text-ui">
        Réécrire le compte-rendu avec « {titleOf(to)} » ?{' '}
        <span className="text-muted">
          {describe(to)} Le compte-rendu actuel (« {titleOf(choice.current)} ») sera remplacé ; vos
          notes et la transcription ne changent pas.
        </span>
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-inline">
        <Button variant="nav" onClick={choice.cancel}>
          Annuler
        </Button>
        {choice.busy ? (
          <Button variant="primary" disabled disabledReason="rédaction en cours">
            Rédaction…
          </Button>
        ) : (
          <Button variant="primary" onClick={choice.confirm}>
            Réécrire
          </Button>
        )}
      </div>
    </div>
  )
}
