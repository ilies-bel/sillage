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

/** Ordered, because a chip row that reorders itself is a chip row nobody aims at. */
export const PERIODES: readonly HistoryPeriod[] = ['toute', '7j', '30j', '90j']
export const STATUTS: readonly HistoryStatus[] = ['tous', 'a-valider', 'validees', 'abandonnees']
export const INTENTIONS: readonly HistoryIntention[] = [
  'toutes',
  'crm.task',
  'crm.opportunity',
  'mail.draft',
]

/**
 * The labels — and the one rule that shapes all three tables: **every chip says
 * what it filters, so the row needs no heading.**
 *
 * The rows used to be headed `PÉRIODE` / `STATUT` / `INTENTION` in a fixed
 * left-hand column, and the headings were load-bearing: the neutral value of
 * each axis read « Toujours », « Tous », « Toutes », which name nothing on their
 * own. Three near-identical words, stacked, each meaning something different and
 * each legible only by tracking left to a label. That is a caption explaining a
 * control, which is the sign the control is not saying enough.
 *
 * So the neutral chip carries the axis name — « Toute période », « Tous
 * statuts », « Toutes intentions ». It is always first, always present, and it
 * is also the reset for its axis, so the thing that names the dimension is the
 * thing that clears it. The other values were already self-describing (« 7
 * jours » is a période and nothing else), and with the neutral chip named there
 * is nothing left for a heading to add.
 *
 * The axis name survives for screen readers as the `role="group"` label in
 * `SearchBar.tsx` — dropped from the screen, not from the accessible tree.
 */
export const PERIODE_LABEL: Record<HistoryPeriod, string> = {
  toute: 'Toute période',
  '7j': '7 jours',
  '30j': '30 jours',
  '90j': '90 jours',
}

export const STATUT_LABEL: Record<HistoryStatus, string> = {
  tous: 'Tous statuts',
  'a-valider': 'À valider',
  validees: 'Validées',
  abandonnees: 'Abandonnées',
}

export const INTENTION_LABEL: Record<HistoryIntention, string> = {
  toutes: 'Toutes intentions',
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
