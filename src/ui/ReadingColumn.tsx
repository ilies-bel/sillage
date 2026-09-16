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
import { readingTurnLabels, type ReadingSubject } from './readingSubject.ts'
import { scrollElementBy, scrollElementTo } from '../lib/scroll.ts'

/**
 * The one string form still accepted, and it is one literal wide.
 *
 * `src/screens/session/AskPanel.tsx` is the seventh caller of this component and
 * is held by another lane this round, so it cannot be converted here. Typing the
 * door as the literal that file passes keeps its label **correct** — the subject
 * is resolved from `LEGACY_SUBJECT` below, so « Remonter dans les réponses » and
 * « Lire la suite des réponses », not the interpolation this round removed —
 * while no new caller can reach it and `tsc` says so at the call site. When that
 * file supplies a `subject`, this type, the map and the union go with it.
 */
type LegacyWhat = 'des réponses'

const LEGACY_SUBJECT: Record<LegacyWhat, ReadingSubject> = {
  'des réponses': { determiner: 'les', noun: 'réponses' },
}

/**
 * `subject` and `what` are exclusive, and each shape is complete.
 *
 * That is the half of R32-2 that keeps it fixed: the previous prop was one
 * `string`, so « the genitive » and « the nominative » were the same type and a
 * caller supplying one of them supplied the other by accident.
 */
export type ReadingColumnProps = {
  children: ReactNode
  className?: string
} & (
  | { subject: ReadingSubject; what?: never }
  | {
      subject?: never
      what: LegacyWhat
    }
)

export function ReadingColumn({ children, subject, what, className }: ReadingColumnProps) {
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
      scrollElementTo(el, { top: 0 })
      return
    }
    // A page minus two lines of overlap, so the sentence the fold cut is read
    // whole instead of resumed mid-clause.
    scrollElementBy(el, { top: Math.max(80, el.clientHeight - 64) })
  }

  return (
    /*
      **Below the column, not over it.**

      The turn used to be the scroller's last child with `sticky bottom-0`, which
      kept it reachable at every scroll position — the right property — and paid
      for it by drawing an opaque button on the text it points at. Measured
      across the product: nine files reach this component, and at 960×600
      `session-demander` drew three at once, one over the rep's own email
      address. In Historique it covered « 15:03 · marqué » — the rep's own mark,
      behind a button telling them to go read it.

      Docking keeps both properties instead of trading them. It does **not**
      disturb the review gate's arming guard, which is what a previous attempt
      claimed: `review-garde-mort` reports *Valider* reached in 6 presses then 4,
      docked and not, byte-identical.
    */
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        onScroll={measure}
        className={`fade-below min-h-0 flex-1 overflow-y-auto ${className ?? ''}`}
      >
        {children}
        {/*
          **The room the fade needs under the last line.**

          The turn used to sit here, in the flow, and the pixels it occupied gave
          the final line somewhere to go at the end of the scroll. Docking took
          that away and `onboarding-suite` caught it at 960×600 — read to the
          very bottom, the last beat still sat under `.fade-below`'s mask. The
          control was providing that clearance by accident; it is stated now.

          `data-unmeasured`, so the review gate does not count it as something
          the rep has to read: `shippedHeight` subtracts exactly these subtrees,
          and a column whose shipped height grew by a spacer is a column the
          arming guard would think had more in it.
        */}
        {turn === null ? null : <div aria-hidden data-unmeasured className="h-14 shrink-0" />}
      </div>
      {turn === null ? null : (
        <PageTurn what={readingTurnLabels(subject ?? LEGACY_SUBJECT[what])[turn]} onTurn={onTurn} />
      )}
    </div>
  )
}
