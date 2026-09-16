/**
 * The overflow — « … » — and the two or three actions that do not earn a bar.
 *
 * ## Why it exists
 *
 * A toolbar is a claim about what a rep does on a screen. The gate's toolbar
 * carried *Copier* beside the view switch, at the same weight as *Lecture /
 * Modifier / Transcription* — and copying the compte-rendu is not one third of
 * what happens here: the one thing that happens here is reading the document and
 * pressing *Valider*. Every control drawn at that weight spends some of the
 * attention the confirmation needs (DEC-4).
 *
 * So the secondary actions go behind one glyph. They are not hidden — the glyph
 * is a real control with a French accessible name, it is in the tab order, and
 * the menu it opens is a `role="menu"` a screen reader announces — they are
 * simply not competing with the decision.
 *
 * ## Why this is not a modal
 *
 * HR-10: one window, no modal chrome. Nothing here traps focus, nothing dims the
 * page, and the menu closes on `Échap`, on an outside press, and on choosing an
 * item — three ways out, none of which is a dialog. It is absolutely positioned
 * so opening it moves nothing: the review gate measures what the rep was shown
 * (`shippedHeight`), and a menu that reflowed the column under it would be a
 * control charging the arming guard for its own existence.
 *
 * ## Keyboard
 *
 * `Échap` closes and hands focus back to the trigger — a rep who opened a menu
 * by accident must not be left with the caret nowhere. The first item is focused
 * on open and `↑`/`↓` walk them, which is what `role="menu"` promises; anything
 * less would be an ARIA role lying about its own behaviour.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export interface OverflowMenuItem {
  /** The label, in French. It is the whole of the accessible name. */
  label: ReactNode
  /** A stable key — the label may be a node that changes under the rep. */
  id: string
  onSelect: () => void
}

export interface OverflowMenuProps {
  /**
   * What the menu is the overflow *of*, in French, for the trigger's accessible
   * name: « Autres actions sur le compte-rendu ». A screen with two of these
   * and a bare « Autres actions » on both names neither of them.
   */
  what: string
  items: readonly OverflowMenuItem[]
  className?: string
}

export function OverflowMenu({ what, items, className }: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)

  const close = (giveBackFocus: boolean) => {
    setOpen(false)
    if (giveBackFocus) trigger.current?.focus()
  }

  /*
   * An outside press closes it. `pointerdown` and not `click`: a rep pressing a
   * control behind the menu should have that control's own press land, and a
   * `click` listener that closed on the way up would have had the menu still on
   * screen when the target was hit-tested.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const node = event.target
      if (node instanceof Node && root.current?.contains(node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // The first item, on open. A menu whose items no key reaches is a list.
  useEffect(() => {
    if (!open) return
    const first = list.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
  }, [open])

  const walk = (from: HTMLElement, delta: 1 | -1) => {
    const all = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const at = all.indexOf(from)
    if (at === -1) return
    const next = all[(at + delta + all.length) % all.length]
    next?.focus()
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Autres actions sur ${what}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            close(true)
          }
        }}
        /*
         * A square of the same bordered chip every other control on this row
         * wears, so the row reads as one set. `size-6` is the 24×24 floor
         * `shot.mjs --targets` measures, stated rather than arrived at through
         * padding — there is no text in this control for padding to move.
         */
        className="border-card bg-inner text-muted hover:bg-subtle hover:text-body active:translate-y-px inline-flex size-6 shrink-0 items-center justify-center rounded-sm border transition"
      >
        <Ellipsis aria-hidden className="size-4" />
      </button>

      {open ? (
        <div
          ref={list}
          role="menu"
          aria-label={`Autres actions sur ${what}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close(true)
              return
            }
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              walk(target, 1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              walk(target, -1)
            }
          }}
          /*
           * `--shadow-overlay` is the token for a surface off the paper, and this
           * one is over a document: a 1px border alone would leave the words
           * underneath reading through the gap between two near-whites.
           */
          className="border-card bg-card shadow-overlay absolute right-0 top-full z-10 mt-hair min-w-[180px] rounded-sm border py-hair"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                item.onSelect()
              }}
              className="text-body hover:bg-subtle hover:text-strong focus-visible:bg-subtle flex min-h-[24px] w-full items-center px-inline py-tight text-left text-ui transition"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
