/**
 * The keyboard, declared once.
 *
 * ## Why this exists
 *
 * VISION.md §6 opens with « one window, no modal chrome, **keyboard-first**,
 * nothing blinks » — and the app had not one global shortcut. Every route in
 * the product was reachable only by finding a control with a mouse: a rep
 * between two calls got to *Historique* through the calendar's search field,
 * and to *Réglages* through a button in a header they had to look at. The
 * general-purpose notetakers this is measured against are driven from the
 * keyboard end to end, and a rep who has the app open on a second screen during
 * a call is exactly the person who cannot go hunting for a button.
 *
 * ## What it refuses to be
 *
 * **Not a command palette.** A palette is modal chrome over the window (HR-10)
 * and it answers « what can I do » with a list the rep has to read *while*
 * looking for the thing they already knew they wanted. These act directly, and
 * `SHORTCUTS` is printed as a table in Réglages, where somebody looking for the
 * list can read it once and stop needing it.
 *
 * **Not a second way to do something dangerous.** Nothing here confirms
 * anything (DEC-4): the gate's own accelerator is offered only when *Valider*
 * is already armed, and it does exactly what pressing the button does, refusals
 * included. A shortcut that could ship a CRM task the button was still refusing
 * would be a second gate.
 *
 * ## The modifier
 *
 * `Ctrl` **or** `⌘`, always both accepted, never detected. Windows is the
 * primary platform (HR-2) and macOS is where this is written, so a branch on
 * the host is the exact mac-first mistake that check-platform.mjs exists to
 * catch — and there is nothing to gain from it: no shortcut here collides with
 * a browser or OS binding on either platform, so accepting both costs nothing
 * and removes a platform branch from the renderer.
 */
import { useEffect } from 'react'

/** One row of the table Réglages prints, and of the matcher below. */
export interface Shortcut {
  id: ShortcutId
  /** As a rep reads it. `Ctrl` and `⌘` both work; the label says so once. */
  keys: string
  label: string
}

export type ShortcutId = 'nouvelle' | 'rechercher' | 'historique' | 'reglages' | 'retour' | 'valider'

/**
 * Ordered as a rep would use them: start a call, find one, then the two screens
 * that are not the calendar, then the two that act on what is on screen.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'nouvelle', keys: 'Ctrl/⌘ N', label: 'Démarrer une réunion' },
  { id: 'rechercher', keys: 'Ctrl/⌘ K', label: 'Rechercher dans les appels' },
  { id: 'historique', keys: 'Ctrl/⌘ H', label: 'Ouvrir l’historique' },
  { id: 'reglages', keys: 'Ctrl/⌘ ,', label: 'Ouvrir les réglages' },
  { id: 'retour', keys: 'Échap', label: 'Revenir au calendrier' },
  { id: 'valider', keys: 'Ctrl/⌘ Entrée', label: 'Valider, quand la revue le permet' },
]

/** What a key press resolves to, before anyone decides whether to honour it. */
const resolve = (event: KeyboardEvent): ShortcutId | null => {
  if (event.key === 'Escape') return 'retour'
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null
  if (event.key === 'Enter') return 'valider'
  switch (event.key.toLowerCase()) {
    case 'n':
      return 'nouvelle'
    case 'k':
      return 'rechercher'
    case 'h':
      return 'historique'
    case ',':
      return 'reglages'
    default:
      return null
  }
}

/**
 * Where the press came from.
 *
 * The rep's notepad is a `contenteditable`, the gate is eleven text fields and
 * two textareas, and *Demander* is an input — so most of this product's surface
 * is somewhere a person is typing. `Ctrl N` inside the compte-rendu they are
 * correcting must not start a recording.
 *
 * The two exceptions are the two that mean something *while* typing: `Échap`
 * leaves, and `Ctrl Entrée` submits — which is what those keys do in every mail
 * client a rep has ever used.
 *
 * `closest`, not the target's own tag. A keydown inside ProseMirror lands on
 * whatever element the caret is in — a `<p>`, a `<li>`, an `<h2>` — never on the
 * editable host, so a check on the target itself sees an ordinary paragraph and
 * lets the shortcut through. The rep's notepad is the surface this matters most
 * on, and it is the one such a check would miss.
 */
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

const typing = (target: EventTarget | null): boolean => {
  const el = target as Element | null
  return typeof el?.closest === 'function' && el.closest(EDITABLE) !== null
}

const ALLOWED_WHILE_TYPING: readonly ShortcutId[] = ['retour', 'valider']

/**
 * Install the ones this screen answers, for as long as it is mounted.
 *
 * A handler that is absent is not a shortcut that does nothing — the key is
 * simply not claimed, so the browser and the OS keep it. That is why the map is
 * partial and why nothing here calls `preventDefault` before a handler has been
 * found: `Ctrl K` on a screen with no search must still be whatever the
 * platform says it is.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void {
  // No dependency array, deliberately: the map is rebuilt on every render by
  // every caller, and a listener captured once would call last render's
  // closures — which on this screen means navigating with a stale meeting id.
  // One `addEventListener` per render is nothing next to the render itself.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      const id = resolve(event)
      if (id === null) return
      if (typing(event.target) && !ALLOWED_WHILE_TYPING.includes(id)) return
      const handler = handlers[id]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
