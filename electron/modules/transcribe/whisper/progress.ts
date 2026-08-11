/**
 * Byte-weighted download progress for the first load of a model.
 *
 * Ported unchanged in behaviour, because the bug it replaces is subtle and
 * would come straight back. transformers reports progress *per file*, and a
 * Whisper checkpoint is five tiny JSON files plus one or two enormous `.onnx`
 * ones. Averaging the per-file percentages by *count* reports
 * `(5×100 + 2×0) / 7 ≈ 75%` the instant the metadata lands, then sits there for
 * the entire real download — the "jumps to 80% and stalls" bar.
 *
 * Aggregating by bytes instead makes the number mean what it says.
 * `expectedBytes` (the catalog size) is the denominator from byte zero so the
 * bar is smooth from 0 %, and it is `max`'d against the observed total so an
 * under-estimate self-corrects upward and the bar can never exceed 100.
 */

export interface ProgressEvent {
  file?: string
  name?: string
  status?: string
  loaded?: unknown
  total?: unknown
  progress?: unknown
}

export class ProgressAggregator {
  #fileBytes = new Map<string, { loaded: number; total: number }>()
  #lastPosted = 0
  #expectedBytes: number

  constructor(expectedBytes: number) {
    const n = Number(expectedBytes)
    this.#expectedBytes = Number.isFinite(n) && n > 0 ? n : 0
  }

  /** The percentage to publish, or `null` when this event changes nothing. */
  update(data: ProgressEvent): number | null {
    const key = data.file ?? data.name
    if (!key) return null

    if (data.status === 'progress') {
      const total = Number(data.total)
      const loaded = Number(data.loaded)
      const prev = this.#fileBytes.get(key)
      if (Number.isFinite(total) && total > 0 && Number.isFinite(loaded)) {
        const clamped = Math.min(total, Math.max(0, loaded))
        this.#fileBytes.set(key, {
          loaded: prev ? Math.max(prev.loaded, clamped) : clamped,
          total: prev ? Math.max(prev.total, total) : total,
        })
      } else {
        // A streamed file with no byte counts: apply its percentage to the
        // last total we saw for it, or skip while that is still unknown.
        const pct = Number(data.progress)
        if (prev && prev.total > 0 && Number.isFinite(pct)) {
          const byPct = Math.min(prev.total, Math.max(0, (pct / 100) * prev.total))
          this.#fileBytes.set(key, { loaded: Math.max(prev.loaded, byPct), total: prev.total })
        }
      }
    } else if (data.status === 'done') {
      const prev = this.#fileBytes.get(key)
      if (prev && prev.total > 0) this.#fileBytes.set(key, { loaded: prev.total, total: prev.total })
    } else {
      // `initiate` / `download` / unknown. Do not seed a 0/0 entry — an entry
      // with total 0 is exactly what turns this back into a count average.
      return null
    }

    let loadedSum = 0
    let observedTotal = 0
    for (const v of this.#fileBytes.values()) {
      if (v.total > 0) {
        loadedSum += v.loaded
        observedTotal += v.total
      }
    }
    const totalSum = Math.max(this.#expectedBytes, observedTotal)
    if (totalSum <= 0) return null

    // Capped at 99: only `ready` means done. Floored so the value does not
    // churn through 0.7 → 1 → 1.4 → 2.
    const rounded = Math.min(99, Math.floor((loadedSum / totalSum) * 100))
    // Never decrease — a newly-seen file enlarges the denominator and can
    // otherwise nudge the ratio backwards by a hair.
    const next = Math.max(this.#lastPosted, rounded)
    if (next === this.#lastPosted) return null
    this.#lastPosted = next
    return next
  }
}
