/**
 * The one place the renderer asks the main process to search (DEC-25).
 *
 * Both screens that carry the box — the calendar and *Historique* — call this
 * and nothing else. That is the point: the rule « the renderer never holds a
 * corpus it did not ask for » is only as strong as the number of places that
 * could break it, and this is the number one.
 *
 * What it does beyond `invoke`, and why each is here rather than in a screen:
 *
 *  · **Debounce.** Each search folds every meeting's log in the main process. A
 *    rep typing « TJM » should cost one pass, not three.
 *  · **Staleness.** A late answer to an older question must never overwrite a
 *    newer one, and « older » now means the query *or* the chips — so both are
 *    echoed back by the channel and both are compared here.
 *  · **Unmount.** No state is set after the component is gone.
 *
 * There is deliberately no client-side cache and no client-side re-filter. A
 * cache of results is a copy of the corpus with a different name, and narrowing
 * yesterday's rows in the renderer is the exact shortcut this channel exists to
 * make unnecessary.
 */
import { useEffect, useState } from 'react'
import type {
  HistoryFilter,
  HistorySearchResult,
} from '../../../electron/core/contracts/history.ts'
import { invoke } from '../../app/bridge.ts'
import { sameFilter } from './filters.ts'

/** How long the box stays quiet before it asks. One request per pause, not per key. */
const DEBOUNCE_MS = 200

export interface HistorySearchState {
  /** Null until the first answer arrives. Never a locally computed subset. */
  result: HistorySearchResult | null
  failure: string | null
}

export function useHistorySearch(
  query: string,
  filter: HistoryFilter,
  limit: number,
): HistorySearchState {
  const [result, setResult] = useState<HistorySearchResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      invoke('history:search', { query, limit, filter })
        .then((value) => {
          if (!live) return
          // The channel echoes both halves of the question back. An answer to a
          // question nobody is asking any more is dropped, not rendered.
          if (value.query !== query || !sameFilter(value.filter, filter)) return
          setResult(value)
          setFailure(null)
        })
        .catch((error: unknown) => {
          if (live) setFailure(error instanceof Error ? error.message : 'recherche impossible')
        })
    }, DEBOUNCE_MS)

    return () => {
      live = false
      clearTimeout(timer)
    }
    // The filter is compared field by field rather than by identity: every
    // render of a screen holding it in state produces a new object, and
    // depending on the reference would re-fire the search on every keystroke
    // in an unrelated field.
  }, [query, limit, filter.client, filter.periode, filter.statut, filter.intention])

  return { result, failure }
}
