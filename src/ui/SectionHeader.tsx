/**
 * The section header VISION.md §6 specifies: short accent rule, then an
 * uppercase, letterspaced, muted label.
 *
 * The rule and the type already live in `.pane-label` in `src/design/index.css`
 * — a component class rather than eight copies of six utilities. This wrapper
 * adds the two things every one of its fifteen call sites also writes by hand:
 * the heading level, and the `mb-3` under it.
 *
 * It is not a re-implementation. `.pane-label` stays the single definition; if
 * the accent rule ever changes width, it changes in one CSS rule and not here.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export interface SectionHeaderProps {
  children: ReactNode
  /**
   * `h2` by default. `legend` is for the `<fieldset>` in Review — a legend
   * carrying the same visual treatment, which is a real case and not a
   * hypothetical one.
   */
  as?: 'h2' | 'h3' | 'legend'
  className?: string
}

export function SectionHeader({ children, as: Tag = 'h2', className }: SectionHeaderProps) {
  return <Tag className={cn('pane-label mb-3', className)}>{children}</Tag>
}
