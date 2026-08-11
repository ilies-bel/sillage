/**
 * Where the app is. The five screens of VISION.md §6.
 *
 * A plain discriminated union rather than a router: there are no URLs here, no
 * deep links, no back button, and one window (HR-10). React Router would be
 * ~15kB and a second mental model to hold, in exchange for nothing this app
 * does.
 *
 * `review` is reachable from a session that has reached the gate and from
 * nowhere else — there is no deep link to build one from a meeting that is
 * still recording (DEC-23), and the screen itself would render a closed gate if
 * there were.
 *
 * `reglages` carries no parameter: it opens on its own state, and it is reached
 * from the calendar, which is the only place in the product that is not inside a
 * call.
 *
 * `historique` carries the search that opened it (DEC-25, VISION.md §6). It is
 * not a destination and there is no link to it: it is the expanded form of the
 * calendar's query, so the query is part of where the app is. Opening it on an
 * empty box when the rep had just typed a client's name would make them type it
 * a second time to see the record they were already looking at.
 */
import type { HistoryFilter } from '../../electron/core/contracts/history.ts'
import type { MeetingId } from '../../electron/core/contracts/meeting.ts'

export type Route =
  | { screen: 'agenda' }
  | { screen: 'session'; meetingId: MeetingId }
  | { screen: 'review'; meetingId: MeetingId }
  | { screen: 'historique'; query: string; filter: HistoryFilter }
  | { screen: 'reglages' }

export const AGENDA: Route = { screen: 'agenda' }
export const REGLAGES: Route = { screen: 'reglages' }

/** The one way into *Historique*: from a query, never from a nav item. */
export const historiqueOf = (query: string, filter: HistoryFilter): Route => ({
  screen: 'historique',
  query,
  filter,
})
