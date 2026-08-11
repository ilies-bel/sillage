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
     */
    <div className="flex min-w-0 flex-1 items-baseline gap-inline overflow-hidden">
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
        // `min-w-[7rem]` and not `min-w-0`. `flex-1` is `flex: 1 1 0%`, so under
        // compression this field — the one with a zero basis — gave up every
        // pixel it had while the client box beside it kept its full 144px: the
        // header at 960px showed « Né… » and no objet at all. The objet is the
        // meeting's name and the client is a subtitle, so the floor goes here
        // and the client truncates first.
        className="text-strong placeholder:text-muted hover:border-subtle focus:border-subtle focus:bg-inner min-w-[7rem] flex-1 truncate rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 font-sans text-copy font-medium outline-none"
      />
      <input
        value={client}
        aria-label="Client"
        placeholder="Client"
        maxLength={200}
        onChange={(event) => setClient(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={keys}
        // `w-36` is what it wants, not what it keeps: `min-w-0` lets it give
        // ground to the objet, which is the field with the longer value and the
        // one a rep is more often reading.
        className="text-muted placeholder:text-muted hover:border-subtle focus:border-subtle focus:bg-inner w-36 min-w-0 truncate rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-ui outline-none"
      />
    </div>
  )
}
