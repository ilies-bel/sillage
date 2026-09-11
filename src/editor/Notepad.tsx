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
import { buildInputRules, buildKeymap } from './note/keymap'
import { trailingEmptyLineClickPlugin } from './note/trailing-empty-line-click'
import { dispatchEditorTransaction } from './transaction-guard'

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

/**
 * The last document the view held, kept across exactly one remount.
 *
 * `EditorErrorBoundary`'s recovery *is* a remount, and a remount reads
 * `initialDoc` — which on the session screen is the document as it was when the
 * screen opened, forty minutes of a call ago. So a transaction failure that the
 * boundary handled would have redrawn the pane with the rep's page of notes
 * missing, under a sentence promising that the recording continues. The last
 * *good* state is still in the view when a transaction throws (`updateState` did
 * not run), so it is handed across here.
 *
 * In memory and never a store write, the way the gate's `PENDING_EDITS` holds a
 * draft: this is a handoff between two mounts of the same component, and a
 * document stashed until Thursday would reappear over one the rep has since
 * changed. The write to the log is the debounced save, which the same handler
 * asks for.
 */
const RECOVERED = new Map<string, unknown>()

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

  /**
   * A transaction that threw, on its way to the error boundary.
   *
   * `transaction-guard.ts` was ported for this and then called by nobody, so the
   * view applied transactions bare — and a throw inside `dispatchTransaction`
   * happens in a ProseMirror DOM handler, which React does not see: no boundary
   * fires, `componentDidCatch` never runs, and « L'enregistrement continue. »
   * could not be shown for the exact failure it was written for. DEC-8 names
   * `transaction-guard` as a reason to take raw ProseMirror at all.
   *
   * React state, then a throw in render, because a boundary catches renders and
   * nothing else. The one-way path is deliberate: the state machine here is
   * « working » → « handed to the boundary », and the way back is the remount the
   * boundary performs.
   */
  const [crashed, setCrashed] = useState<unknown>(null)

  // Read through refs inside the effect so changing a callback prop does not
  // rebuild the editor.
  const held = useRef({ save, onSaveFailed, onReady })
  held.current = { save, onSaveFailed, onReady }

  useEffect(() => {
    const element = mount.current
    if (!element) return

    const recovered = RECOVERED.get(meetingId)
    RECOVERED.delete(meetingId)
    const doc = (recovered ? docFrom(recovered) : null) ?? docFrom(initialDoc)
    const state = EditorState.create({
      schema,
      ...(doc ? { doc } : {}),
      /*
       * `buildInputRules()` first. It had never been in this list: eight tests
       * covered it, `grep` found no caller, and typing `# `, `- `, `1. `, `> `,
       * `**gras**` or an apostrophe into the shipped notepad produced the
       * characters that were typed. It is what makes the block vocabulary
       * `index.css` styles reachable without a toolbar (HR-10), together with
       * `NOTE_SHORTCUTS`.
       *
       * `trailingEmptyLineClickPlugin()` is the other half of the dead pane
       * below: the CSS makes the box receive the click, this puts the caret in a
       * paragraph at the end of the document — a *new* one when the last block is
       * a heading or a list item, which is the case where the browser's own
       * answer (continue the list) is not what a rep clicking into white space
       * asked for.
       */
      plugins: [
        buildInputRules(),
        buildKeymap(),
        trailingEmptyLineClickPlugin(),
        history(),
        dropCursor(),
        gapCursor(),
      ],
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
        dispatchEditorTransaction({
          view: editor,
          transaction,
          // Only called when something in the batch changed the document:
          // selection-only transactions change nothing worth persisting, and
          // saving on them would mean a write per arrow key.
          onDocChanged() {
            setEmpty(isBlank(editor.state))
            schedule()
          },
          onError(error) {
            /*
             * The last good document, then the boundary.
             *
             * `updateState` did not run, so `editor.state` is still the state
             * before the failing transaction: it is worth keeping, and it is the
             * one thing here that cannot be recovered from anywhere else. The
             * flush is asked for by marking the work dirty — the effect's cleanup
             * runs on the way out of this mount and writes it.
             */
            RECOVERED.set(meetingId, editor.state.doc.toJSON())
            dirty.current = true
            setCrashed(error)
          },
        })
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

  // Render, so `EditorErrorBoundary` catches it. See `crashed` above.
  if (crashed) throw crashed

  return (
    // `data-scrolls`: an editor holds more than its box by definition — the rep
    // is typing into it and the caret is what decides what is on screen. It is
    // not the « clipped and looks short » failure `--scrollers` measures.
    <div
      data-scrolls
      className="notepad relative h-full min-h-0 overflow-y-auto text-[15px] leading-[1.7]"
    >
      {empty && placeholder ? (
        <span
          aria-hidden
          className="text-muted pointer-events-none absolute left-8 top-6 select-none"
        >
          {placeholder}
        </span>
      ) : null}
      {/*
        `flex h-full flex-col`, and the page margin moved onto the editable in
        `index.css`.

        Both are about one thing: every pixel under « Vos notes… » has to take a
        click. `.ProseMirror`'s `min-height: 100%` was inert for as long as it
        existed, because a percentage min-height resolves against *this* element
        and this element's specified height was `auto` (CSS 2.1 §10.7 reads that
        as `auto`). Measured on an empty notepad at 1280×800: the editable was
        **26px** tall inside a 676px wrapper in a 724px pane — 96% of the pane was
        not the editor. A rep looks at Teams, clicks back onto their own notes and
        gets no caret; nothing on screen says why, because a `contenteditable`
        that is not under the pointer looks exactly like one that is.

        A column flex container with a definite height is what makes the
        percentage resolvable, and it is the editable that grows into it.
      */}
      <div ref={mount} className="text-ink-rep flex h-full flex-col" />
    </div>
  )
}

/** An untouched document: one empty paragraph, or nothing at all. */
const isBlank = (state: EditorState): boolean =>
  state.doc.childCount === 0 ||
  (state.doc.childCount === 1 && state.doc.firstChild?.content.size === 0)
