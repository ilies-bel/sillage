/**
 * The notepad. The only editable surface on the session screen, and the only
 * thing on it with a cursor (DEC-14).
 *
 * Written for this product rather than ported, so it follows the repo's style
 * and not upstream's — it wires the ported schema, keymap and plugins to a
 * ProseMirror view and to `document:save`.
 *
 * Two invariants live here:
 *
 *  - **Nothing writes into this document during a call** (DEC-5, DEC-14). There
 *    is no incoming-transaction path: the component takes an initial document
 *    and after that the only source of transactions is the keyboard. Gray AI
 *    text enters exactly once, at meeting end, through a remount with a new
 *    `initialDoc` — not through a live channel.
 *  - **Killing the app at minute 40 loses at most half a second** (DEC-12).
 *    Every transaction is persisted on a ~500ms trailing debounce, and the
 *    pending one is flushed on unmount and on `pagehide`.
 */
import { useEffect, useRef, useState } from 'react'
import { EditorState, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node as PMNode } from 'prosemirror-model'
import { history } from 'prosemirror-history'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { schema } from './note/schema'
import { buildKeymap } from './note/keymap'

/** DEC-12 says "at most half a second". This is that number. */
export const SAVE_DEBOUNCE_MS = 500

interface NotepadProps {
  meetingId: string
  /** The persisted document, or null before the rep has typed anything. */
  initialDoc: unknown
  /** Revision the document was read at; the save channel is optimistic on it. */
  initialRevision: number
  save: (payload: { meetingId: string; revision: number; doc: unknown }) => Promise<{
    revision: number
  }>
  onSaveFailed?: (error: unknown) => void
  placeholder?: string
  /**
   * The live view, once mounted, and null on teardown.
   *
   * The screen needs it to put the caret in the notepad when a session opens —
   * it is the only cursor on that screen (DEC-14) and it should not have to be
   * clicked for. It is *not* a write channel: `EditorView` would let a caller
   * dispatch, and nothing in this product does. DEC-5 is held by there being no
   * such caller, which is what `Notepad.test.tsx` checks.
   */
  onReady?: (view: EditorView | null) => void
}

const docFrom = (raw: unknown): PMNode | null => {
  if (!raw || typeof raw !== 'object') return null
  try {
    return PMNode.fromJSON(schema, raw)
  } catch {
    // A document the current schema cannot load is a document from a different
    // build. Starting empty would *overwrite* it on the next keystroke, so the
    // editor refuses to mount instead and the caller shows the failure.
    return null
  }
}

export function Notepad({
  meetingId,
  initialDoc,
  initialRevision,
  save,
  onSaveFailed,
  placeholder,
  onReady,
}: NotepadProps) {
  const mount = useRef<HTMLDivElement>(null)
  // Held in refs, not state: a re-render per keystroke would tear down the
  // ProseMirror view, and the view owns the selection.
  const view = useRef<EditorView | null>(null)
  const revision = useRef(initialRevision)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  const inFlight = useRef(false)

  /*
   * The placeholder is React state rather than a CSS `::before`, because the
   * CSS version cannot read the text: `attr()` only sees the element the pseudo
   * sits on, and that element is ProseMirror's, not ours. This flips at most
   * twice in a meeting — on the first character and if the rep deletes
   * everything — so it costs no renders worth counting.
   */
  const [empty, setEmpty] = useState(true)

  // Read through refs inside the effect so changing a callback prop does not
  // rebuild the editor.
  const held = useRef({ save, onSaveFailed, onReady })
  held.current = { save, onSaveFailed, onReady }

  useEffect(() => {
    const element = mount.current
    if (!element) return

    const doc = docFrom(initialDoc)
    const state = EditorState.create({
      schema,
      ...(doc ? { doc } : {}),
      plugins: [buildKeymap(), history(), dropCursor(), gapCursor()],
    })

    const flush = async () => {
      if (!dirty.current || inFlight.current) return
      const current = view.current
      if (!current) return

      dirty.current = false
      inFlight.current = true
      try {
        const result = await held.current.save({
          meetingId,
          revision: revision.current,
          doc: current.state.doc.toJSON(),
        })
        revision.current = result.revision
      } catch (error) {
        // Put the work back. The next transaction — or unmount — retries it,
        // so a transient IPC failure costs a delay and never the paragraph.
        dirty.current = true
        held.current.onSaveFailed?.(error)
      } finally {
        inFlight.current = false
      }
    }

    const schedule = () => {
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    }

    setEmpty(isBlank(state))

    const editor = new EditorView(element, {
      state,
      dispatchTransaction(transaction: Transaction) {
        const next = editor.state.apply(transaction)
        editor.updateState(next)
        // Selection-only transactions change nothing worth persisting, and
        // saving on them would mean a write per arrow key.
        if (!transaction.docChanged) return
        setEmpty(isBlank(next))
        schedule()
      },
    })
    view.current = editor
    held.current.onReady?.(editor)

    // The window closing is the case DEC-12 is actually about. `pagehide`
    // fires where `beforeunload` is unreliable under Electron, and the flush is
    // best-effort: the debounce is what keeps the loss bounded, not this.
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)

    return () => {
      window.removeEventListener('pagehide', onHide)
      if (timer.current) clearTimeout(timer.current)
      void flush()
      held.current.onReady?.(null)
      editor.destroy()
      view.current = null
    }
    // `initialDoc`/`initialRevision` are the mount-time document by contract:
    // a new one means a different meeting, and the key on the caller remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId])

  return (
    <div className="notepad relative h-full min-h-0 overflow-y-auto px-8 py-6 text-[15px] leading-[1.7]">
      {empty && placeholder ? (
        <span
          aria-hidden
          className="text-muted pointer-events-none absolute left-8 top-6 select-none"
        >
          {placeholder}
        </span>
      ) : null}
      <div ref={mount} className="text-ink-rep min-h-full" />
    </div>
  )
}

/** An untouched document: one empty paragraph, or nothing at all. */
const isBlank = (state: EditorState): boolean =>
  state.doc.childCount === 0 ||
  (state.doc.childCount === 1 && state.doc.firstChild?.content.size === 0)
