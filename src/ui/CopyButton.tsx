/**
 * « Copier », and then « Copié » for a moment.
 *
 * ## Why it exists
 *
 * Nothing in this product could get one character out of it. The compte-rendu,
 * the follow-up and the transcript were all readable and none of them were
 * takeable — and on the build the first demo ships in (DEC-28, no Entra app
 * registration) the gate says, in as many words, « aucun destinataire — aucun
 * brouillon ne sera créé, **le texte reste copiable** » and then offered no way
 * to copy it. That sentence is a promise the app was not keeping.
 *
 * The rep's real workflow has more than one destination: a mail client the app
 * does not have a token for, a Teams message, a colleague's Slack, a proposal
 * document. Every one of those is a paste.
 *
 * ## Why the confirmation is a label change and not a toast
 *
 * HR-10: one window, no modal chrome. A toast is chrome, it appears somewhere
 * the rep is not looking, and it outlives the gesture. Swapping the word on the
 * button the rep just pressed puts the answer under their cursor and takes it
 * away again by itself. The width does not move: « Copié » is set on the same
 * box, so nothing beside it steps sideways.
 *
 * A failure says so rather than lying by omission — a clipboard the platform
 * refuses is exactly the case the fallback in `lib/clipboard.ts` exists for, and
 * if that fails too the rep has to know the paste will be stale.
 */
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard.ts'
import { Button } from './Button.tsx'

export interface CopyButtonProps {
  /** What lands on the clipboard. Exactly this, byte for byte. */
  text: string
  /**
   * What was copied, in French, for the accessible name — « le compte-rendu »,
   * « le brouillon ». A screen holds several of these and « Copier » alone
   * names none of them.
   */
  what: string
  className?: string
}

/** How long the confirmation stands. Long enough to read, short enough to forget. */
const HELD_MS = 1_600

export function CopyButton({ text, what, className }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const run = async () => {
    const ok = await copyText(text)
    setState(ok ? 'done' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), HELD_MS)
  }

  return (
    <Button
      variant="text"
      className={className}
      onClick={() => void run()}
      /*
        The accessible name says what, the visible label says whether. A screen
        reader that only ever heard « Copier » on four different buttons would
        be hearing the same control four times.
      */
      aria-label={state === 'idle' ? `Copier ${what}` : undefined}
    >
      {state === 'done' ? 'Copié' : state === 'failed' ? 'Copie impossible' : 'Copier'}
    </Button>
  )
}
