/**
 * The panel that says nothing is here, and why.
 *
 * `reason` is separate from `children` on purpose. An empty state that only
 * says « Aucune réunion aujourd'hui. » is indistinguishable from a bug; the
 * screens that get this right already pass the calendar's own refusal through
 * to the second line (DEC-26), and keeping it a named slot is what stops the
 * next one from dropping it.
 *
 * `grain` opts into the paper texture (VISION.md §6). It is off by default and
 * belongs only here and on the other genuinely quiet surfaces — the splash, an
 * empty transcript pane, an empty signal rail. Never on anything that repaints
 * during a call.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export interface EmptyStateProps {
  /** The one-line French statement of what is not here. */
  children: ReactNode
  /** Why it is not here, in the words of whatever refused. */
  reason?: ReactNode
  /** A last line for what the rep can do instead. */
  hint?: ReactNode
  /**
   * The control that gets the rep out of here, drawn *inside* the panel.
   *
   * A sentence is not a way out. An empty state whose only action sits
   * elsewhere on the screen is the dead end DEC-26 forbids — the rep reads that
   * there is nothing, and the panel offers them nothing to do about it.
   */
  action?: ReactNode
  grain?: boolean
  className?: string
}

export function EmptyState({
  children,
  reason,
  hint,
  action,
  grain = true,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-card bg-card-soft rounded-lg border px-6 py-10 text-center',
        grain && 'grain',
        className,
      )}
    >
      {/*
        `.measure` on both, because an empty state is prose and some of these
        sentences are long: « Ces jours sont hors de la période synchronisée… »
        rendered eighty-nine characters a line before this, and the class goes on
        the element that holds the text — `ch` resolves against its own font
        size, so the two here need it separately.
      */}
      <p className="measure text-body text-copy">{children}</p>
      {reason ? <p className="measure text-muted mt-1.5 text-ui">{reason}</p> : null}
      {hint ? <p className="text-muted mt-4 text-ui">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

/**
 * The same idea for a whole pane: *Chargement…*, a failure, an empty screen.
 * Written out identically at the bottom of `Réglages`, `Session` and `Review`
 * as a local `Centered` in each.
 */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted flex h-full flex-col items-center justify-center text-copy">
      {children}
    </div>
  )
}
