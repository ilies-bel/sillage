/**
 * DEC-12 makes a promise with a number in it: *"killing the app at minute 40
 * loses at most half a second."* These are the tests that make it a claim
 * rather than an intention.
 *
 * The other invariant checked here is DEC-5's: nothing writes into this
 * document during a call. That one is structural — `Notepad` has no incoming
 * transaction path at all — so what is testable is the consequence: a rerender
 * carrying a *different* document does not disturb what the rep has typed.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { Notepad, SAVE_DEBOUNCE_MS } from '../Notepad.tsx'
import { schema } from '../note/schema'

interface Saved {
  meetingId: string
  revision: number
  doc: unknown
}

const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/**
 * Types into the mounted editor the way ProseMirror itself would — through a
 * transaction, not by setting `textContent`. jsdom has no real caret, so
 * simulating keystrokes at the DOM level would be testing jsdom.
 */
const typeInto = (view: EditorView, text: string) => {
  const { state } = view
  act(() => view.dispatch(state.tr.insertText(text, state.selection.from)))
}

/** Renders and hands back the live view, which `onReady` publishes. */
const mount = (props: Partial<Parameters<typeof Notepad>[0]> = {}) => {
  let view: EditorView | null = null
  const rendered = render(
    <Notepad
      meetingId="m1"
      initialDoc={null}
      initialRevision={0}
      save={save}
      onReady={(v) => {
        view = v
      }}
      {...props}
    />,
  )
  expect(view, 'the editor should have mounted').toBeTruthy()
  return { ...rendered, view: view as unknown as EditorView }
}

let saves: Saved[]
let save: (payload: Saved) => Promise<{ revision: number }>

beforeEach(() => {
  vi.useFakeTimers()
  saves = []
  let revision = 0
  save = async (payload) => {
    saves.push(payload)
    revision += 1
    return { revision }
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('persistence is debounced, not per keystroke', () => {
  test('a burst of typing costs one write', async () => {
    const { view } = mount()

    typeInto(view, 'bonjour')
    typeInto(view, ' Acme')
    typeInto(view, ' SA')

    expect(saves).toHaveLength(0)

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })

    expect(saves).toHaveLength(1)
    expect(JSON.stringify(saves[0].doc)).toContain('bonjour Acme SA')
  })

  test('nothing is written before the debounce elapses', async () => {
    const { view } = mount()
    typeInto(view, 'a')

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1)
    })
    expect(saves).toHaveLength(0)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(saves).toHaveLength(1)
  })

  test('the window closing flushes what the debounce still holds', async () => {
    // This is the case DEC-12 is actually about — the app going away between
    // the last keystroke and the timer.
    const { view } = mount()
    typeInto(view, 'notes non enregistrées')

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(saves).toHaveLength(1)
    expect(JSON.stringify(saves[0].doc)).toContain('notes non enregistrées')
  })

  test('unmounting flushes too', async () => {
    const rendered = mount()
    typeInto(rendered.view, 'texte')

    await act(async () => {
      rendered.unmount()
    })

    expect(saves).toHaveLength(1)
  })

  test('a selection change is not a document change', async () => {
    // Saving on selection would mean a write per arrow key, for a document
    // that did not move.
    const { view } = mount({ initialDoc: paragraph('salut'), initialRevision: 3 })
    typeInto(view, '!')

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })
    expect(saves).toHaveLength(1)

    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    })
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2)
    })

    expect(saves).toHaveLength(1)
  })
})

describe('a failed write is retried, never dropped', () => {
  test('the paragraph survives a transient IPC failure', async () => {
    const failures: unknown[] = []
    let allow = false
    const flaky = async (payload: Saved) => {
      if (!allow) throw new Error('IPC indisponible')
      saves.push(payload)
      return { revision: 1 }
    }

    const { view } = mount({ save: flaky, onSaveFailed: (error) => failures.push(error) })

    typeInto(view, 'première phrase')
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })

    expect(failures).toHaveLength(1)
    expect(saves).toHaveLength(0)

    // The next keystroke retries, and carries the text the failed write held.
    allow = true
    typeInto(view, ' et la suite')
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })

    expect(saves).toHaveLength(1)
    expect(JSON.stringify(saves[0].doc)).toContain('première phrase et la suite')
  })
})

describe('the document is the rep’s alone during the call (DEC-5)', () => {
  test('a rerender with a different initialDoc does not touch what was typed', async () => {
    const rendered = mount()
    typeInto(rendered.view, 'ce que le commercial a tapé')

    // Something upstream re-renders with a new document — an enhancement
    // arriving mid-call, say. It must not land. Gray AI text enters exactly
    // once, at meeting end, through a remount on a new meeting key.
    rendered.rerender(
      <Notepad
        meetingId="m1"
        initialDoc={paragraph('texte généré par le modèle')}
        initialRevision={9}
        save={save}
      />,
    )

    const text = rendered.container.querySelector('.ProseMirror')?.textContent ?? ''
    expect(text).toContain('ce que le commercial a tapé')
    expect(text).not.toContain('texte généré par le modèle')
  })
})

describe('an unloadable document is refused rather than overwritten', () => {
  test('a doc the schema cannot parse starts empty and does not immediately save', async () => {
    // A document written by a different build. Silently starting blank and
    // then persisting that blank on the first keystroke would destroy it.
    const { container } = mount({
      initialDoc: { type: 'doc', content: [{ type: 'clip', attrs: { id: 'x' } }] },
      initialRevision: 4,
    })

    expect(container.querySelector('.ProseMirror')?.textContent).toBe('')
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3)
    })
    expect(saves).toHaveLength(0)
  })
})

describe('the placeholder', () => {
  test('shows on an empty document and goes on the first character', () => {
    const { container, view } = mount({ placeholder: 'Vos notes…' })

    expect(container.textContent).toContain('Vos notes…')
    typeInto(view, 'a')
    expect(container.textContent).not.toContain('Vos notes…')
  })

  test('never shows over an existing document', () => {
    const { container } = mount({
      initialDoc: paragraph('déjà écrit'),
      initialRevision: 2,
      placeholder: 'Vos notes…',
    })
    expect(container.textContent).not.toContain('Vos notes…')
  })
})

test('the editor mounts against the ported note schema', () => {
  // Cheap guard on the wiring: `Notepad` builds its state from `note/schema`,
  // and a schema change that breaks the plugins would otherwise surface first
  // in the app rather than here.
  const state = EditorState.create({ schema })
  expect(state.doc.type.name).toBe('doc')
})
