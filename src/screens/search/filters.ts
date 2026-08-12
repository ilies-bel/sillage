/**
 * The renderer's half of the search filter (DEC-25, DEC-31): the four axes, in
 * French, and the two predicates a screen needs to know what it is looking at.
 *
 * **No logic that decides what matches lives here.** That is
 * `core/domain/historySearch.ts`, in the main process, and it stays there — this
 * file knows what a chip is *called* and whether any chip is on, and nothing
 * about which meetings survive one.
 *
 * The tables are `Record<Axis, string>` rather than arrays of `{ id, label }`
 * on purpose: a `Record` over a union from the contract is exhaustive, so an
 * axis gaining a value in `core/contracts/history.ts` fails to compile here
 * instead of quietly rendering one chip fewer.
 *
 * `src/*` may import `core/contracts/` only, and only as types — the schemas in
 * that file build Zod at module scope and none of it may reach the bundle. So
 * `NO_FILTER` is restated here rather than imported from the domain; it is four
 * literals, and the type is what keeps the two copies honest.
 */
import type {
  HistoryFilter,
  HistoryIntention,
  HistoryPeriod,
  HistoryStatus,
} from '../../../electron/core/contracts/history.ts'

/** Nothing selected on any axis. What the chip row opens in. */
export const NO_FILTER: HistoryFilter = {
  client: null,
  periode: 'toute',
  statut: 'tous',
  intention: 'toutes',
}

/**
 * A value that filters — every value of an axis except that axis's « no filter ».
 *
 * The neutral value is not among them because **it draws no chip** (see the
 * labels below). Excluding it from the type rather than skipping it at render
 * time is what keeps the tables exhaustive: a `Record` over `Exclude<…>` still
 * fails to compile when `core/contracts/history.ts` gains a value, and it also
 * fails if the neutral literal is ever renamed there.
 */
export type PeriodeChoice = Exclude<HistoryPeriod, 'toute'>
export type StatutChoice = Exclude<HistoryStatus, 'tous'>
export type IntentionChoice = Exclude<HistoryIntention, 'toutes'>

/** Ordered, because a chip row that reorders itself is a chip row nobody aims at. */
export const PERIODES: readonly PeriodeChoice[] = ['7j', '30j', '90j']
export const STATUTS: readonly StatutChoice[] = ['a-valider', 'validees', 'abandonnees']
export const INTENTIONS: readonly IntentionChoice[] = [
  'crm.task',
  'crm.opportunity',
  'mail.draft',
]

/**
 * The labels — and the one rule that shapes all three tables: **only values that
 * filter are on screen.**
 *
 * There used to be a fourth chip at the head of each axis, and it went through
 * two shapes before going. First « Toujours » / « Tous » / « Toutes » under a
 * fixed `PÉRIODE` / `STATUT` / `INTENTION` column — three near-identical words,
 * each legible only by tracking left to a heading. Then the heading was folded
 * into the chip itself, « Toute période » / « Tous statuts » / « Toutes
 * intentions », which reads on its own and cost the column.
 *
 * What it did not cost is width, and width is what the filter has: four neutral
 * chips are ~45% of the row, which is the difference between four stacked rows
 * of chips and one line. They bought the axis name for a reader who mostly does
 * not need it — « 7 jours » is a période and nothing else, « Validées » is a
 * statut — and a reset that a pressed chip can do by un-pressing itself.
 *
 * So: no neutral chip. Pressing a pressed chip returns its axis to `NO_FILTER`,
 * `Effacer` clears every axis at once, and the axis name survives for screen
 * readers as the `role="group"` label in `SearchBar.tsx` — dropped from the
 * screen, not from the accessible tree.
 */
export const PERIODE_LABEL: Record<PeriodeChoice, string> = {
  '7j': '7 jours',
  '30j': '30 jours',
  '90j': '90 jours',
}

export const STATUT_LABEL: Record<StatutChoice, string> = {
  'a-valider': 'À valider',
  validees: 'Validées',
  abandonnees: 'Abandonnées',
}

export const INTENTION_LABEL: Record<IntentionChoice, string> = {
  'crm.task': 'Tâche',
  'crm.opportunity': 'Opportunité',
  'mail.draft': 'Mail',
}

/** Is at least one chip on? Restates `isFiltering` from the domain, in French. */
export const isFiltering = (filter: HistoryFilter): boolean =>
  filter.client !== NO_FILTER.client ||
  filter.periode !== NO_FILTER.periode ||
  filter.statut !== NO_FILTER.statut ||
  filter.intention !== NO_FILTER.intention

/**
 * Is the rep searching at all?
 *
 * This is what decides whether the calendar shows its day list or its results,
 * so it has to be true of a chip pressed with an empty box: « les réunions
 * validées des 30 derniers jours » is a search, and it has no query string.
 */
export const isSearchActive = (query: string, filter: HistoryFilter): boolean =>
  query.trim().length > 0 || isFiltering(filter)

/** Two filters are the same question. Used to drop a stale answer, like `query`. */
export const sameFilter = (a: HistoryFilter, b: HistoryFilter): boolean =>
  a.client === b.client &&
  a.periode === b.periode &&
  a.statut === b.statut &&
  a.intention === b.intention
