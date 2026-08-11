/**
 * Rows, not cards (VISION.md §6). Density over decoration.
 *
 * `List` is the bordered, hairline-divided container that appears eleven times
 * across `Agenda`, `Réglages`, `Historique` and `Review` as the same eight
 * utilities retyped:
 *
 *     border-card divide-y divide-[var(--border-subtle)] overflow-hidden rounded-lg border
 *
 * That `divide-[var(--border-subtle)]` arbitrary value is the tell. It is there
 * because Tailwind's `divide-*` reads `borderColor`, the config maps `subtle`
 * there, and every author independently rediscovered the escape hatch. One
 * component, one place to fix it if the divider ever changes.
 *
 * `Row` carries the two paddings the screens use — the dense one from Réglages
 * and the roomier one from Agenda — as a variant rather than as a difference
 * nobody chose.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ElementType, ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export interface ListProps {
  children: ReactNode
  /** `ul` by default; `div` when the rows are not list items. */
  as?: Extract<ElementType, 'ul' | 'ol' | 'div'>
  /**
   * The list's accessible name, in French.
   *
   * Worth having wherever a screen holds more than one list, which since the
   * search landed is most of them: a filter chip and the row it filters to
   * carry the *same* words — « Acme Industries » is both — so an unnamed list
   * of results is a list nobody can address, by assistive technology or by a
   * test. Naming the results is what makes "the chips" and "the calls" two
   * different things rather than one ambiguous one.
   */
  label?: string
  className?: string
}

export function List({ children, as: Tag = 'ul', label, className }: ListProps) {
  return (
    <Tag
      aria-label={label}
      className={cn(
        'border-card divide-y divide-[var(--border-subtle)] overflow-hidden rounded-lg border',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

const row = cva('bg-card flex min-w-0 gap-inline', {
  variants: {
    density: {
      /** Réglages: provider lines, connector lines, findings. */
      dense: 'px-row py-2.5',
      /** Agenda and Historique: a title with a subtitle under it. */
      roomy: 'px-5 py-3.5 gap-4',
    },
    align: { baseline: 'items-baseline', center: 'items-center' },
    interactive: { true: 'hover:bg-card-soft w-full text-left transition', false: '' },
  },
  defaultVariants: { density: 'dense', align: 'baseline', interactive: false },
})

export interface RowProps extends VariantProps<typeof row> {
  children: ReactNode
  as?: Extract<ElementType, 'li' | 'div'>
  className?: string
}

export function Row({ children, as: Tag = 'li', className, ...variants }: RowProps) {
  return <Tag className={cn(row(variants), className)}>{children}</Tag>
}

/**
 * The middle cell: a title and, when there is one, a subtitle under it. Both
 * truncate, because a client name long enough to wrap turns a scannable list
 * into a ragged one.
 *
 * `title` is `--ink-rep` and `subtitle` is `--ink-agent` nowhere near by
 * accident — provenance is colour and only colour (DEC-5), so these two are the
 * strong/muted pair everywhere else uses and the pairing stays consistent.
 */
export interface RowTitleProps {
  title: ReactNode
  subtitle?: ReactNode
  className?: string
}

export function RowTitle({ title, subtitle, className }: RowTitleProps) {
  return (
    <span className={cn('min-w-0 flex-1', className)}>
      <span className="text-strong block truncate text-copy">{title}</span>
      {subtitle ? <span className="text-muted block truncate text-ui">{subtitle}</span> : null}
    </span>
  )
}
