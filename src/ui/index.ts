/**
 * The primitives the screens actually repeat — derived from what is on screen
 * in `Agenda`, `Réglages`, `Historique`, `Review` and `Session`, not from a
 * speculative kit. `Agenda.tsx` and `Reglages.tsx` alone carry 84 `className`
 * sites, most of them retyping the same seven patterns.
 *
 * Two house rules are enforced here structurally rather than documented,
 * because this is the cheapest place to make them true:
 *
 *   · A state dot never renders without an adjacent text label. `StateDot`
 *     owns both halves and refuses a blank one — colour is never the only
 *     signal.
 *   · A disabled control always carries a French reason beside it. `Button`
 *     makes `disabled: true` unconstructible without `disabledReason`, and
 *     renders it into the DOM, not into a `title` attribute (DEC-26).
 *
 * Every variant resolves to token-backed Tailwind classes. No hex reaches this
 * folder, so `scripts/check-tokens.mjs` stays green.
 *
 * `src/*` may import `core/contracts/` only (ARCHITECTURE.md §4). Nothing here
 * imports anything from `electron/` at all — these are presentation primitives
 * and they take strings.
 */
export { StateDot, type StateDotProps } from './StateDot.tsx'
export { Button, unavailable, type ButtonProps } from './Button.tsx'
export { List, Row, RowTitle, type ListProps, type RowProps, type RowTitleProps } from './List.tsx'
export { Chip, type ChipProps } from './Chip.tsx'
export { SectionHeader, type SectionHeaderProps } from './SectionHeader.tsx'
export { SectionNav, type SectionNavItem, type SectionNavProps } from './SectionNav.tsx'
export { Segmented, type SegmentedOption, type SegmentedProps } from './Segmented.tsx'
export { EmptyState, Centered, type EmptyStateProps } from './EmptyState.tsx'
