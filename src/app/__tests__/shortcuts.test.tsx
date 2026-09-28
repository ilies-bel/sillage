/**
 * The keyboard.
 *
 * What has to hold is not « the key works » — it is everything that stops a
 * shortcut from being a second, weaker path to something the product guards:
 *
 *  · **it does not fire while a rep is typing**, because most of this product's
 *    surface is a field, a textarea or the rep's own `contenteditable` notepad,
 *    and `Ctrl N` inside a compte-rendu being corrected must not start a
 *    recording — with the one exception that means something while typing,
 *    `Échap`. This line said « the **two** exceptions » for as long as it
 *    existed, and Réglages printed the same claim to the rep: the second one
 *    both named was `valider`, which `ALLOWED_WHILE_TYPING` has never held and
 *    which the docblock over `EDITABLE` records removing as « the most dangerous
 *    line in this file ». The file asserted the behaviour correctly below and
 *    was wrong about it in prose at the top — shape nine on `CLAUDE.md`'s list;
 *  · **an unclaimed key is left alone** (no `preventDefault`), so a screen with
 *    no search does not eat `Ctrl K` from the browser and the OS;
 *  · **both modifiers work**, always, because Windows is the primary platform
 *    and macOS is where this is written (HR-2);
 *  · **a held key repeats nothing** — one press, one act.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SHORTCUTS, useShortcuts, type ShortcutId } from '../shortcuts.ts'

afterEach(cleanup)

const Harness = ({
  fired,
  ids = ['nouvelle', 'rechercher', 'historique', 'reglages', 'retour', 'valider'],
}: {
  fired: ShortcutId[]
  ids?: readonly ShortcutId[]
}) => {
  const handlers: Partial<Record<ShortcutId, () => void>> = {}
  for (const id of ids) handlers[id] = () => fired.push(id)
  useShortcuts(handlers)
  return (
    <div>
      <input aria-label="champ" />
      <textarea aria-label="zone" />
      {/*
        As ProseMirror really is: the caret sits in a child, and the keydown
        lands there and not on the editable host.
      */}
      <div contentEditable aria-label="notes" suppressContentEditableWarning>
        <p data-testid="ligne">une note</p>
      </div>
    </div>
  )
}

/** A press on the window, which is where the listener lives. */
const press = (key: string, over: KeyboardEventInit = {}, target: Window | Element = window) =>
  fireEvent.keyDown(target, { key, ...over })

describe('what each key resolves to', () => {
  test('every declared shortcut is reachable, with Ctrl and with ⌘', () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const fired: ShortcutId[] = []
      render(<Harness fired={fired} />)

      press('n', modifier)
      press('k', modifier)
      press('h', modifier)
      press(',', modifier)
      press('Enter', modifier)
      press('Escape')

      expect(fired).toEqual(['nouvelle', 'rechercher', 'historique', 'reglages', 'valider', 'retour'])
      cleanup()
    }
  })

  test('the table Réglages prints has a row for each one the matcher answers', () => {
    const fired: ShortcutId[] = []
    render(<Harness fired={fired} />)
    press('n', { ctrlKey: true })
    press('k', { ctrlKey: true })
    press('h', { ctrlKey: true })
    press(',', { ctrlKey: true })
    press('Enter', { ctrlKey: true })
    press('Escape')

    // The pane is a view of `SHORTCUTS`; this is what stops it drifting into a
    // second, hand-written list that claims a key nothing answers.
    expect(SHORTCUTS.map((s) => s.id).sort()).toEqual([...fired].sort())
  })

  test('a modifier the app did not ask for is not the app’s to take', () => {
    const fired: ShortcutId[] = []
    render(<Harness fired={fired} />)

    // ⌥⌘N is a different binding, and on Windows Ctrl+Alt+N is AltGr on several
    // keyboard layouts — taking it would eat a character a rep is typing.
    press('n', { metaKey: true, altKey: true })
    press('n', {})
    expect(fired).toEqual([])
  })

  test('a held key acts once', () => {
    const fired: ShortcutId[] = []
    render(<Harness fired={fired} />)
    press('h', { ctrlKey: true })
    press('h', { ctrlKey: true, repeat: true })
    expect(fired).toEqual(['historique'])
  })
})

describe('it stays out of the way while a rep is writing', () => {
  test.each(['champ', 'zone', 'notes'])('Ctrl N does nothing from « %s »', (label) => {
    const fired: ShortcutId[] = []
    const { getByLabelText } = render(<Harness fired={fired} />)
    press('n', { ctrlKey: true }, getByLabelText(label))
    expect(fired).toEqual([])
  })

  /*
   * The one a tag check misses. The notepad is ProseMirror, so the caret is in
   * a `<p>` and the keydown lands there — an ordinary paragraph as far as the
   * target's own tag name is concerned.
   */
  test('Ctrl N does nothing from a paragraph inside the notepad', () => {
    const fired: ShortcutId[] = []
    const { getByTestId } = render(<Harness fired={fired} />)
    press('n', { ctrlKey: true }, getByTestId('ligne'))
    expect(fired).toEqual([])
  })

  test.each(['champ', 'zone', 'notes'])('Échap still leaves from « %s »', (label) => {
    const fired: ShortcutId[] = []
    const { getByLabelText } = render(<Harness fired={fired} />)
    press('Escape', {}, getByLabelText(label))
    // A draft survives it — `PENDING_EDITS` at the gate, the store in the
    // notepad — which is what makes leaving a safe thing to do mid-sentence.
    expect(fired).toEqual(['retour'])
  })

  /**
   * **The most dangerous line this file ever had.**
   *
   * `valider` was allowed while typing, on the argument that `Ctrl Entrée`
   * « submits, which is what those keys do in every mail client » — and that
   * muscle memory is precisely what made it wrong. The only screen that claims
   * `valider` is the review gate, and two of the things a rep types there are
   * the follow-up mail's **subject and body**. In a mail client, `Ctrl Entrée`
   * in a mail body sends that mail; here it fired `review:confirm` — the
   * VerySwing task and the Outlook draft, from inside the box whose content is
   * the thing being sent, with no idempotency key and no undo (DEC-4).
   * *Demander*'s input is on the same screen and did the same.
   */
  test.each(['champ', 'zone', 'notes'])('Ctrl Entrée does not confirm from « %s »', (label) => {
    const fired: ShortcutId[] = []
    const { getByLabelText } = render(<Harness fired={fired} />)
    press('Enter', { ctrlKey: true }, getByLabelText(label))
    expect(fired).toEqual([])
  })

  test('and it still confirms from outside a field', () => {
    // Losing it inside a field costs nothing: the rep is one Tab or one click
    // from the button, which is the gesture DEC-4 is actually about.
    const fired: ShortcutId[] = []
    render(<Harness fired={fired} />)
    press('Enter', { ctrlKey: true })
    expect(fired).toEqual(['valider'])
  })
})

describe('a key nobody claimed is left to the platform', () => {
  test('no handler means no preventDefault', () => {
    const fired: ShortcutId[] = []
    // A screen with no search: `Ctrl K` has to stay whatever the browser and
    // the OS say it is, rather than becoming a control that does nothing.
    render(<Harness fired={fired} ids={['retour']} />)

    const claimed = fireEvent.keyDown(window, { key: 'Escape' })
    const unclaimed = fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    // `fireEvent` returns false when the event was cancelled.
    expect(claimed).toBe(false)
    expect(unclaimed).toBe(true)
    expect(fired).toEqual(['retour'])
  })
})
