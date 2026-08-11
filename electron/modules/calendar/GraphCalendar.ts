/**
 * `CalendarPort` over `GET /me/calendarView/delta`.
 *
 * `calendarView`, not `events`: it expands recurring series into the individual
 * occurrences a rep actually attends, which is the only form arming can use. A
 * weekly point with a client is one `event` resource and forty occurrences, and
 * the app needs the one happening at 14:00 today.
 *
 * **Delta queries take no `$select`, `$filter`, `$orderby` or `$expand`.** Graph
 * rejects them outright, so filtering and ordering happen here on the folded
 * result. That is also why the window is the only lever on how much comes back.
 */
import type { CalendarPort, CalendarWindow } from '../../core/contracts/calendar.ts'
import { CalendarWindowSchema, EMPTY_WINDOW } from '../../core/contracts/calendar.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { IdentityPort } from '../../core/contracts/identity.ts'
import type { KeyValueStore } from '../../core/contracts/kv.ts'
import { applyDelta, byStart, needsFullSync, prune, windowFor } from './delta.ts'
import { GRAPH_BASE, graphGet, type FetchLike } from './graph.ts'

/** Where the fold and its cursor live, together, as one value. */
export const WINDOW_KEY = 'calendar.window'

/** v1 is French and Paris-time throughout (DEC-22). */
export const DEFAULT_TIME_ZONE = 'Europe/Paris'

/**
 * A hard stop on paging. A week of a busy calendar is a handful of pages; a
 * hundred means something is wrong with the cursor and the alternative to
 * stopping is looping until the process is killed.
 */
export const MAX_PAGES = 40

/** A truncated write, or a value from a build that stored something else. */
const parseOrNull = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export interface GraphCalendarOptions {
  identity: IdentityPort
  /** Persists the window across restarts. Without it, every boot syncs in full. */
  state?: KeyValueStore
  diagnostics?: DiagRecorder
  clock?: () => number
  fetch?: FetchLike
  timeZone?: string
  maxPages?: number
}

export class GraphCalendar implements CalendarPort {
  #identity: IdentityPort
  #state: KeyValueStore | null
  #diagnostics: DiagRecorder
  #clock: () => number
  #fetch: FetchLike
  #timeZone: string
  #maxPages: number
  #window: CalendarWindow | null = null
  #inFlight: Promise<CalendarWindow> | null = null

  constructor(options: GraphCalendarOptions) {
    this.#identity = options.identity
    this.#state = options.state ?? null
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.#timeZone = options.timeZone ?? DEFAULT_TIME_ZONE
    this.#maxPages = options.maxPages ?? MAX_PAGES
  }

  window(): CalendarWindow {
    return (this.#window ??= this.#load())
  }

  /**
   * Single-flight. Arming polls, the UI has a refresh button and a sign-in
   * completing triggers one — three callers that can easily overlap, and two
   * concurrent syncs would fold the same page twice and race on the cursor.
   */
  sync(now: number = this.#clock()): Promise<CalendarWindow> {
    this.#inFlight ??= this.#sync(now).finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  async #sync(now: number): Promise<CalendarWindow> {
    const current = this.window()
    const full = needsFullSync(current, now)
    const bounds = full ? windowFor(now) : { from: current.from, to: current.to }
    const token = await this.#identity.token()

    let url = full ? this.#deltaUrl(bounds) : (current.cursor as string)
    let events = full ? [] : current.events
    let cursor: string | null = null

    for (let page = 0; page < this.#maxPages; page++) {
      const body = await graphGet(url, {
        token,
        fetch: this.#fetch,
        headers: {
          // Every dateTime in the response comes back in this zone rather than
          // UTC, which is what `time.ts` is built to read.
          Prefer: `outlook.timezone="${this.#timeZone}", odata.maxpagesize=50`,
        },
      })

      events = applyDelta(events, Array.isArray(body.value) ? body.value : [], this.#timeZone)

      const next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null
      const delta = typeof body['@odata.deltaLink'] === 'string' ? body['@odata.deltaLink'] : null
      if (delta) {
        cursor = delta
        break
      }
      if (!next) break
      url = next
    }

    if (!cursor) {
      // No delta link means the feed was truncated — the page cap, or Graph not
      // finishing. The events folded so far are still good; the cursor is not,
      // so the next sync starts over rather than resuming from a partial view.
      this.#diagnostics.record({
        severity: 'warn',
        code: 'calendar.delta.incomplete',
        module: 'calendar',
        message: 'synchronisation interrompue avant la fin du flux',
        detail: { pages: this.#maxPages },
      })
    }

    const window: CalendarWindow = {
      cursor,
      syncedAt: now,
      from: bounds.from,
      to: bounds.to,
      events: byStart(prune(events, bounds)),
    }
    this.#persist(window)
    return window
  }

  #deltaUrl(bounds: { from: number; to: number }): string {
    const params = new URLSearchParams({
      startDateTime: new Date(bounds.from).toISOString(),
      endDateTime: new Date(bounds.to).toISOString(),
    })
    return `${GRAPH_BASE}/me/calendarView/delta?${params.toString()}`
  }

  #load(): CalendarWindow {
    const raw = this.#state?.get(WINDOW_KEY)
    if (!raw) return EMPTY_WINDOW
    const parsed = CalendarWindowSchema.safeParse(parseOrNull(raw))
    if (parsed.success) return parsed.data
    // A window written by an older shape. Discarding it costs one full sync;
    // trusting it costs a cursor pointing at a window nobody can describe.
    this.#diagnostics.record({
      severity: 'warn',
      code: 'calendar.window.unreadable',
      module: 'calendar',
      message: 'fenêtre de calendrier illisible, resynchronisation complète',
      detail: {},
    })
    return EMPTY_WINDOW
  }

  #persist(window: CalendarWindow): void {
    this.#window = window
    try {
      this.#state?.set(WINDOW_KEY, JSON.stringify(window))
    } catch (error) {
      // In memory it is correct, which is what this session needs. The cost is
      // a full sync on the next boot.
      this.#diagnostics.record({
        severity: 'warn',
        code: 'calendar.window.notPersisted',
        module: 'calendar',
        message: error instanceof Error ? error.message : String(error),
        detail: {},
      })
    }
  }
}
