/**
 * **« Cette machine uniquement », enforced where the choice is made** (DEC-37).
 *
 * DEC-37 withdrew every jurisdiction claim and kept exactly one rule that still
 * refuses: `offlineOnly` — the rep asking, in the product, for this meeting's
 * audio to stay on the machine. Both registries honoured it in their *ranking*
 * functions, `selectProvider` and `selectLlm`, and the ranking is not where the
 * decision ends:
 *
 *     const providerId = chosen(preferences.provider('stt'), configured, ranked)
 *
 * `chosen` returns the rep's explicit pick whenever it is in `configured`, and
 * `configured` is « has a key and could run ». So a rep who had once pressed
 * *Utiliser* on a cloud engine and then asked for offline-only got the cloud
 * engine: the ranking refused it, and the choice put it straight back. The
 * guarantee was bypassable by the most ordinary sequence of two settings.
 *
 * The fix is to apply the constraint to the **candidate set** rather than to
 * the ranking, so every downstream path — the ranking, the explicit choice, and
 * anything added later — can only ever see providers the constraint allows.
 * That is the same shape as `deterministicLeaks.ts`: a rule enforced on the way
 * out rather than trusted at each call site.
 *
 * It is deliberately *not* a filter on « would this be nice ». A provider is
 * dropped only for `residency: 'remote'`, which is the one fact DEC-37 still
 * lets this product assert — the vendor said where it runs — and never for a
 * jurisdiction, a flag or a badge.
 */

export interface HasResidency {
  id: string
  capabilities: { residency: 'local' | 'remote' }
}

/**
 * The configured ids this constraint allows, in the order they arrived.
 *
 * An id with no row in the registry is **kept**: this function's job is to
 * remove what it knows is remote, not to decide what is configured, and a
 * silent drop here would be a provider disappearing from the settings screen
 * for a reason nothing on it explains.
 */
export const allowedByResidency = (
  configured: readonly string[],
  registry: readonly HasResidency[],
  offlineOnly: boolean,
): string[] => {
  if (!offlineOnly) return [...configured]
  const remote = new Set(
    registry.filter((row) => row.capabilities.residency === 'remote').map((row) => row.id),
  )
  return configured.filter((id) => !remote.has(id))
}
