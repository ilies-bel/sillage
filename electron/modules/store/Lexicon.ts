/**
 * Persistence for the curated half of the lexicon (DEC-17).
 *
 * Rows in, rows out. No ranking, no budget, no capability — all of that is
 * `core/domain/lexicon/boost.ts`, which is pure and testable without a
 * database. This file's only opinions are about storage.
 *
 * The table is neither the log nor a projection. It cannot be rebuilt by
 * folding events, so `Projections.rebuild()` must leave it alone: dropping it
 * would lose everything the app has learned about how a client's people and
 * projects are spelled, which is the part no dictionary can give back.
 */
import type { EventLog } from './EventLog.ts'
import type { StoredLexiconTerm, TermCategory } from '../../core/contracts/lexicon.ts'

export type StorableScope = 'account' | 'client'

interface Row {
  term: string
  scope: string
  scope_key: string
  category: string
  variants: string
  hits: number
  created_at: number
}

const toTerm = (row: Row): StoredLexiconTerm => ({
  term: row.term,
  category: row.category as TermCategory,
  // A row written by a future version, or by hand, must not take the app down
  // mid-meeting over a malformed array.
  variants: parseVariants(row.variants),
  scope: row.scope as StorableScope,
  scopeKey: row.scope_key,
  hits: row.hits,
  createdAt: row.created_at,
})

const parseVariants = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export interface AddTermInput {
  term: string
  category: TermCategory
  scope: StorableScope
  /** Ignored for `account`, which is always keyed ''. */
  scopeKey?: string
  variants?: readonly string[]
}

export class Lexicon {
  #log: EventLog

  constructor(log: EventLog) {
    this.#log = log
  }

  /**
   * Adds a term, or merges into the one already there.
   *
   * Merging rather than replacing is what makes enrichment safe to run
   * repeatedly: the same client seen in ten meetings adds its surnames once,
   * and a variant observed in the tenth is kept alongside the nine before it.
   * `INSERT … ON CONFLICT DO UPDATE` keeps that atomic, so two calls racing on
   * the same term cannot lose one of them.
   */
  add(input: AddTermInput): void {
    const term = input.term.trim()
    if (!term) return
    const scopeKey = input.scope === 'account' ? '' : (input.scopeKey ?? '').trim()

    const existing = this.#log.get<Row>(
      'SELECT * FROM lexicon WHERE scope = ? AND scope_key = ? AND term = ?',
      input.scope,
      scopeKey,
      term,
    )
    const merged = [...new Set([...(existing ? parseVariants(existing.variants) : []), ...(input.variants ?? [])])]

    this.#log.run(
      `INSERT INTO lexicon (term, scope, scope_key, category, variants, hits, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (scope, scope_key, term) DO UPDATE SET
         category = excluded.category,
         variants = excluded.variants`,
      term,
      input.scope,
      scopeKey,
      input.category,
      JSON.stringify(merged),
      Date.now(),
    )
  }

  /** Bulk add, in one transaction. Enrichment always arrives as a set. */
  addAll(inputs: readonly AddTermInput[]): void {
    if (inputs.length === 0) return
    this.#log.transaction(() => {
      for (const input of inputs) this.add(input)
    })
  }

  remove(scope: StorableScope, scopeKey: string, term: string): void {
    this.#log.run(
      'DELETE FROM lexicon WHERE scope = ? AND scope_key = ? AND term = ?',
      scope,
      scope === 'account' ? '' : scopeKey,
      term,
    )
  }

  /** Account-wide terms, plus this client's if one is named. */
  forClient(clientName: string | null): StoredLexiconTerm[] {
    const rows = clientName
      ? this.#log.all<Row>(
          `SELECT * FROM lexicon WHERE (scope = 'account' AND scope_key = '') OR (scope = 'client' AND scope_key = ?)
           ORDER BY scope DESC, hits DESC, created_at ASC`,
          clientName.trim(),
        )
      : this.#log.all<Row>(
          `SELECT * FROM lexicon WHERE scope = 'account' AND scope_key = ''
           ORDER BY hits DESC, created_at ASC`,
        )
    // `scope DESC` puts 'client' ahead of 'account' alphabetically, which is
    // the ranking `boost.ts` expects and is worth stating rather than relying on.
    return rows.map(toTerm)
  }

  all(): StoredLexiconTerm[] {
    return this.#log
      .all<Row>('SELECT * FROM lexicon ORDER BY scope, scope_key, term')
      .map(toTerm)
  }

  /**
   * Records that a term was actually heard. Ordering signal only — a term that
   * keeps turning up in real calls should survive truncation ahead of one that
   * was added once and never spoken.
   */
  observe(scope: StorableScope, scopeKey: string, term: string): void {
    this.#log.run(
      'UPDATE lexicon SET hits = hits + 1 WHERE scope = ? AND scope_key = ? AND term = ?',
      scope,
      scope === 'account' ? '' : scopeKey,
      term,
    )
  }
}
