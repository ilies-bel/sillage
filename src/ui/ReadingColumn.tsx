/**
 * **A column of prose that says how much of itself is still unread.**
 *
 * Two instruments, and neither was ever particular to the screen that got them.
 * A scroller draws no edge, so a document cut off at the fold looks exactly like
 * a document that ends there. At the review gate that is a safety property —
 * *Valider* is withheld until both columns have been shown — so it grew a mask,
 * a page turn, and thirteen rounds of adversarial attention.
 *
 * On the session screen, where the rep **meets** the compte-rendu for the first
 * time, the same pane had neither. Measured at 1280×800 it hid 1305 of 1796
 * pixels — 73% — with a hard rule immediately under the last visible line, so
 * the strongest available reading of « …a voté ce matin en comité » followed by
 * a border was that the compte-rendu is four paragraphs long. At 960×600, 83%.
 * The rule had even been *added* to fix the symptom: its own comment records
 * that the document « ended mid-sentence one line above ». Same document, same
 * product, one click apart, opposite treatment.
 *
 * The gate does not use this component — its guard measures the union of the
 * bands each column has shown and has to own its own `measure`. What is shared
 * is `PageTurn` and the `.fade-below` contract, which is the half that was
 * missing here.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PageTurn } from './PageTurn.tsx'

export interface ReadingColumnProps {
  children: ReactNode
  /** Completes the turn's label: « Lire la suite du compte-rendu ». */
  what: string
  className?: string
}

export function ReadingColumn({ children, what, className }: ReadingColumnProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  /** `null` when the column fits: there is nothing to turn to and no control. */
  const [turn, setTurn] = useState<'down' | 'up' | null>(null)

  /*
   * The two masks are written straight onto the element rather than held in
   * state: they are visual properties of the scroll position, they change on
   * every tick, and routing them through `useState` would re-render a long
   * document to move a gradient. Only the *control* is state, because it is one
   * boolean that changes at the ends of the scroll rather than throughout it.
   */
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const above = el.scrollTop > 8
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 8
    el.dataset.above = String(above)
    el.dataset.below = String(below)
    setTurn(below ? 'down' : above ? 'up' : null)
  }, [])

  useLayoutEffect(measure)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // `onScroll` never fires on a column that already fits, and the document
    // arrives one render after the pane does — both change the answer with no
    // scroll to hang off.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  }, [measure])

  const onTurn = () => {
    const el = ref.current
    if (!el) return
    if (turn === 'up') {
      el.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    // A page minus two lines of overlap, so the sentence the fold cut is read
    // whole instead of resumed mid-clause.
    el.scrollBy({ top: Math.max(80, el.clientHeight - 64), behavior: 'smooth' })
  }

  return (
    <div
      ref={ref}
      onScroll={measure}
      className={`fade-below min-h-0 flex-1 overflow-y-auto ${className ?? ''}`}
    >
      {children}
      {/*
        Inside the scroller, so it sticks to the foot of the column it turns —
        never in a decision's rectangle, and never a jump to the end: a teleport
        reveals, a page turn is read.
      */}
      {turn === null ? null : (
        <PageTurn
          what={turn === 'up' ? `Remonter dans ${what}` : `Lire la suite ${what}`}
          onTurn={onTurn}
        />
      )}
    </div>
  )
}
