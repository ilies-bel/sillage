/**
 * What *Demander* offers before anybody has typed anything.
 *
 * ## Two kinds of offer, and only one of them is conditional
 *
 * **Questions** — the three in `ASK_QUESTIONS` — are the answer to « this box
 * is open, what do I type ». They are about the call and nothing else, so they
 * can be offered on any call, on any build, and they are scaffolding: a
 * container query drops them where the column is too narrow to spend the room
 * on them (`design/index.css`).
 *
 * **An action** names something this product does *next*, and that is a
 * different promise. `FOLLOW_UP` names the Outlook follow-up draft — the one
 * `draftIntents` composes at the gate from `mailSubject` / `mailBody` — and
 * offers the material for it: what was committed to during the call, by whom,
 * and by when, quoted from the recording like every other answer here.
 *
 * ## Why the action is withheld, and on exactly what
 *
 * A control that is present and does nothing is DEC-26's own example. The
 * follow-up draft has two structural prerequisites and `draftIntents` names
 * them in this order:
 *
 *   · **no Microsoft account** — « Aucun compte Microsoft connecté. » That is
 *     the build DEC-28 ships the first demo in: there is no Entra registration,
 *     so `auth:signIn` can only reject and no draft will ever be created. A
 *     chip saying « le mail de suivi » there names an artefact this
 *     installation cannot produce.
 *   · **no recipients** — « Aucun destinataire au calendrier. » The recipients
 *     come from the invite (`mailRecipients`, from Graph, never typed and never
 *     inferred — DEC-7), so a call with no calendar entry at all has none by
 *     construction. `eventId === null` is that case, and it is the whole of
 *     what the session screen can see from here: a *calendar* meeting whose
 *     only attendee is the rep also has no recipients, and that residual is
 *     named at the gate, on the row, where the recipient list actually exists.
 *
 * Both are asked, and the answer is « no offer » in every case that is not a
 * clear yes — including « the account could not be read ». Withholding costs a
 * rep one chip they can still type the question of; offering costs them a step
 * towards a draft that will not be there.
 *
 * ## What pressing it does *not* do
 *
 * It asks a question. It creates no draft, opens no gate, stores nothing and
 * confirms nothing (DEC-25, DEC-4) — the chip is an entry point to work that
 * already exists, never a second way to do it. The question is shown above the
 * answer in the panel, as every question is, so the chip's label is never the
 * last word on what was asked.
 */
import { useState } from 'react'
import type { AuthState } from '../../../electron/core/contracts/identity.ts'
import { useBroadcast, useInvoke } from '../../app/bridge.ts'

/** One offer: what the chip says, and the question it sends. */
export interface AskAction {
  id: string
  label: string
  question: string
}

/**
 * Three questions a rep actually asks, offered as one tap on an empty panel.
 *
 * Not a feature list and not a demo script: an empty text field with a
 * placeholder is a surface where the honest reaction is « what can I ask it »,
 * and answering that with prose costs a paragraph nobody reads. Three real
 * questions answer it in the only way that generalises — by being asked.
 */
export const ASK_QUESTIONS: readonly string[] = [
  'Qu’est-ce qui bloque côté client ?',
  'Qu’est-ce qui a été dit sur le TJM ?',
  'Qui décide, et quand ?',
]

/**
 * The suggested action on a note.
 *
 * The label is the verb (« Rédiger la relance »), because a chip on a finished
 * call is read as the next thing to do and « Préparer le mail de suivi » named
 * a folder rather than an act. What it is wired to does not change: the
 * question is what the model is actually asked,
 * and it is a question about the recording rather than a request for a draft —
 * `ASK_INSTRUCTIONS` rule 1 refuses advice and general knowledge outright, so a
 * chip that asked for an email to be written would reliably come back « la
 * transcription de cet appel ne permet pas de répondre », which is the worst
 * possible first press.
 */
export const FOLLOW_UP: AskAction = {
  id: 'mail-suivi',
  label: 'Rédiger la relance',
  question: 'Quels engagements ont été pris pendant cet appel, par qui et pour quand ?',
}

/**
 * Whether this meeting may carry the follow-up offer.
 *
 * Pure, so the rule is testable without a bridge and without a DOM — the hook
 * below is only the reading of `auth:state`.
 */
export const followUpOffered = (input: {
  auth: AuthState | null
  fromCalendar: boolean
}): AskAction | null => {
  if (input.auth === null || input.auth.status !== 'signedIn') return null
  if (!input.fromCalendar) return null
  return FOLLOW_UP
}

/**
 * The offer, live.
 *
 * `auth:state` on mount and `auth:changed` after it — a rep who signs in from
 * *Réglages* while a compte-rendu is open gets the chip without reopening the
 * meeting, and one who signs out loses it in the same breath. Null while the
 * read is in flight and null if it fails: see above, the absence is the safe
 * answer here and the presence is the one that has to be earned.
 */
export function useFollowUpAction(input: { fromCalendar: boolean }): AskAction | null {
  const read = useInvoke('auth:state', {})
  const [pushed, setPushed] = useState<AuthState | null>(null)
  useBroadcast('auth:changed', (state) => setPushed(state))

  const auth = pushed ?? (read.state.status === 'ready' ? read.state.value : null)
  return followUpOffered({ auth, fromCalendar: input.fromCalendar })
}
