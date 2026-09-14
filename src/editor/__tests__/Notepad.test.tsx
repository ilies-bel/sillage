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
import { EditorErrorBoundary } from '../editor-error-boundary.tsx'
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

/**
 * **The plugins, asked of the shipped view rather than of the module.**
 *
 * `buildInputRules` had eight green tests here and no caller: `Notepad`'s plugin
 * list was `[buildKeymap(), history(), dropCursor(), gapCursor()]`, so in the
 * product `# ` stayed a hash, `- ` stayed a dash and `'` stayed U+0027. A test of
 * a function is not a test of a wiring, which is why these drive the live
 * `EditorView` that `onReady` publishes — the same object the rep's keystrokes
 * reach — and never `buildInputRules()` directly.
 *
 * What they cannot do is measure: jsdom gives every box a height of zero, so the
 * trailing-click plugin's own rule (« is the pointer below the last block ») can
 * only be checked for being *installed* here. `scratch/notepad-probe.mjs` drives
 * it in a real browser at both window sizes, which is where the 26px editable was
 * found.
 */
describe('the shipped plugin list', () => {
  /** Feeds a character to whatever in the live state handles typed input. */
  const typeCharacter = (view: EditorView, text: string) =>
    act(() => {
      const { from, to } = view.state.selection
      for (const plugin of view.state.plugins) {
        const handler = plugin.props.handleTextInput
        if (!handler) continue
        const handled = handler.call(plugin, view, from, to, text, () =>
          view.state.tr.insertText(text, from, to),
        )
        if (handled) return
      }
      view.dispatch(view.state.tr.insertText(text, from, to))
    })

  /** Presses a key on the live state, the way `EditorView` does. */
  const press = (view: EditorView, init: KeyboardEventInit) =>
    act(() => {
      for (const plugin of view.state.plugins) {
        const handler = plugin.props.handleKeyDown
        if (!handler) continue
        if (handler.call(plugin, view, new KeyboardEvent('keydown', init))) return
      }
    })

  test('« # » and a space make a heading, not a paragraph with a hash in it', () => {
    const { view } = mount()
    typeCharacter(view, '#')
    typeCharacter(view, ' ')
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(view.state.doc.firstChild?.attrs.level).toBe(1)
  })

  test('« - » and a space make a bullet list', () => {
    const { view } = mount()
    typeCharacter(view, '-')
    typeCharacter(view, ' ')
    expect(view.state.doc.firstChild?.type.name).toBe('bulletList')
  })

  test('the apostrophe a rep types is the one everything else stores', () => {
    // U+2019, like `check:french` enforces in the repo's own prose and like
    // `terms.fr-esn.ts` spells « appel d’offres ». Typed notes were the one text
    // in the product written with the straight quote.
    const { view } = mount()
    for (const character of "l'appel") typeCharacter(view, character)
    expect(view.state.doc.textContent).toBe('l’appel')
  })

  test('Ctrl and ⌘ both make a bullet list, on either platform', () => {
    // `app/shortcuts.ts`'s rule, held where it costs nothing: no digit
    // combination collides with a Cocoa text binding, so both are claimed and
    // nothing in this file asks what host it is running on.
    for (const modifier of ['ctrlKey', 'metaKey'] as const) {
      const { view } = mount()
      typeCharacter(view, 'x')
      press(view, { key: '8', shiftKey: true, [modifier]: true })
      expect(view.state.doc.firstChild?.type.name, modifier).toBe('bulletList')
      cleanup()
    }
  })

  test('the same press again is the way back to prose', () => {
    const { view } = mount()
    typeCharacter(view, 'x')
    press(view, { key: '2', shiftKey: true, ctrlKey: true })
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    press(view, { key: '2', shiftKey: true, ctrlKey: true })
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
  })

  test('Backspace gives back the characters an input rule took', () => {
    const { view } = mount()
    typeCharacter(view, '-')
    typeCharacter(view, ' ')
    // Asserted on the way through, or the test below passes on an editor where
    // no rule fired at all — which is exactly the state this whole file was
    // green against.
    expect(view.state.doc.firstChild?.type.name).toBe('bulletList')
    press(view, { key: 'Backspace' })
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.textContent).toBe('- ')
  })

  test('the trailing-line click handler is installed', () => {
    const { view } = mount()
    const installed = view.state.plugins.some((plugin) =>
      Boolean(plugin.props.handleDOMEvents?.mousedown),
    )
    expect(installed, 'the pane below the last line has to take a click').toBe(true)
  })
})

/**
 * **A transaction that throws reaches the boundary, and the notes survive it.**
 *
 * `transaction-guard.ts` was ported for this and called by nobody, so the view
 * applied transactions bare. A throw inside `dispatchTransaction` happens in a
 * ProseMirror DOM handler — React never sees it, no boundary fires, and
 * « L'enregistrement continue. » could not be shown for the one failure it was
 * written for.
 *
 * The fixture is a *stale* transaction, which is the real shape of it: one built
 * against a document the state has since moved past throws `RangeError:
 * Applying a mismatched transaction` inside `applyTransaction`.
 */
describe('a failing transaction', () => {
  test('hands the crash to the boundary and keeps what the rep had typed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const views: EditorView[] = []
    const rendered = render(
      <EditorErrorBoundary resetKey="m1">
        <Notepad
          meetingId="m1"
          initialDoc={null}
          initialRevision={0}
          save={save}
          onReady={(v) => {
            if (v) views.push(v)
          }}
        />
      </EditorErrorBoundary>,
    )

    const view = views[0]
    const stale = view.state.tr.insertText('périmée', 1)
    typeInto(view, 'ce que le commercial a tapé')
    await act(async () => {
      view.dispatch(stale)
    })

    // The boundary's recovery is a remount, and a remount reads `initialDoc` —
    // null here, as on the first minute of a call. Without the handoff the rep's
    // page of notes would have been redrawn empty.
    expect(views).toHaveLength(2)
    expect(rendered.container.textContent).toContain('ce que le commercial a tapé')

    // And it is in the log, not only on screen.
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS)
    })
    expect(JSON.stringify(saves)).toContain('ce que le commercial a tapé')

    // A second failure is where the sentence itself is owed: one automatic
    // remount, then the message and a button (`editor-error-boundary.tsx`).
    const second = views[1]
    const staleAgain = second.state.tr.insertText('encore', 1)
    typeInto(second, ' et la suite')
    await act(async () => {
      second.dispatch(staleAgain)
    })
    expect(rendered.container.textContent).toContain('L’enregistrement continue.')

    consoleError.mockRestore()
  })
})

test('the editor mounts against the ported note schema', () => {
  // Cheap guard on the wiring: `Notepad` builds its state from `note/schema`,
  // and a schema change that breaks the plugins would otherwise surface first
  // in the app rather than here.
  const state = EditorState.create({ schema })
  expect(state.doc.type.name).toBe('doc')
})
