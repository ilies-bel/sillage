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
  grain?: boolean
  className?: string
}

export function EmptyState({ children, reason, hint, grain = true, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-card bg-card-soft rounded-lg border px-6 py-10 text-center',
        grain && 'grain',
        className,
      )}
    >
      <p className="text-body text-copy">{children}</p>
      {reason ? <p className="text-muted mt-1.5 text-ui">{reason}</p> : null}
      {hint ? <p className="text-muted mt-4 text-ui">{hint}</p> : null}
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
