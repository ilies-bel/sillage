import test from 'node:test'
import assert from 'node:assert/strict'
import { GraphCalendar, WINDOW_KEY } from '../GraphCalendar.ts'
import { GraphError, graphGet, type FetchLike } from '../graph.ts'
import { applyDelta, needsFullSync, prune, windowFor, MIN_LOOKAHEAD_MS } from '../delta.ts'
import { mapEvent, removedId } from '../mapEvent.ts'
import { zonedToEpoch } from '../time.ts'
import { calendarHealth } from '../index.ts'
import { EMPTY_WINDOW, type CalendarEvent } from '../../../core/contracts/calendar.ts'
import { InteractionRequiredError, type IdentityPort } from '../../../core/contracts/identity.ts'
import { memoryKeyValueStore } from '../../../core/contracts/kv.ts'

/** Inside the fixture's own day — otherwise every sync prunes its own events. */
const NOW = Date.parse('2026-08-05T08:00:00Z')

// ── time ───────────────────────────────────────────────────────────────────

test('a Paris-local time is read as Paris, in both halves of the year', () => {
  // CEST, UTC+2. Getting this wrong arms a meeting an hour early all summer.
  assert.equal(zonedToEpoch('2026-08-05T14:00:00.0000000', 'Europe/Paris'), Date.parse('2026-08-05T12:00:00Z'))
  // CET, UTC+1.
  assert.equal(zonedToEpoch('2026-01-15T14:00:00.0000000', 'Europe/Paris'), Date.parse('2026-01-15T13:00:00Z'))
})

test('a time inside the hour a DST change moves still resolves', () => {
  // 2026-03-29 03:00 Paris is the first wall-clock hour after the spring jump.
  assert.equal(zonedToEpoch('2026-03-29T03:00:00', 'Europe/Paris'), Date.parse('2026-03-29T01:00:00Z'))
})

test('UTC is passed through, and an unreadable date says so', () => {
  assert.equal(zonedToEpoch('2026-08-05T12:00:00.0000000', 'UTC'), Date.parse('2026-08-05T12:00:00Z'))
  assert.ok(Number.isNaN(zonedToEpoch('demain', 'Europe/Paris')))
})

// ── mapEvent ───────────────────────────────────────────────────────────────

const graphEvent = (over: Record<string, unknown> = {}) => ({
  id: 'AAMkAD',
  subject: 'Point Aura',
  bodyPreview: 'Migration DIMOS',
  sensitivity: 'normal',
  isCancelled: false,
  isAllDay: false,
  lastModifiedDateTime: '2026-08-01T09:00:00Z',
  seriesMasterId: null,
  categories: ['Client'],
  start: { dateTime: '2026-08-05T14:00:00.0000000', timeZone: 'Europe/Paris' },
  end: { dateTime: '2026-08-05T15:00:00.0000000', timeZone: 'Europe/Paris' },
  organizer: { emailAddress: { name: 'Claire Fontaine', address: 'claire@shodo.fr' } },
  attendees: [
    {
      type: 'required',
      status: { response: 'accepted' },
      emailAddress: { name: 'Ahmed ZAIOU', address: 'a.zaiou@aura.fr' },
    },
  ],
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
  ...over,
})

test('a Graph event becomes a MeetingContext with its times in epoch ms', () => {
  const mapped = mapEvent(graphEvent(), 'Europe/Paris')
  assert.ok(mapped)
  assert.equal(mapped.context.scheduledStart, Date.parse('2026-08-05T12:00:00Z'))
  assert.equal(mapped.context.attendees[0]?.name, 'Ahmed ZAIOU')
  assert.equal(mapped.context.attendees[0]?.email, 'a.zaiou@aura.fr')
  assert.equal(mapped.context.onlineMeetingJoinUrl, 'https://teams.microsoft.com/l/meetup-join/x')
  assert.equal(mapped.context.agenda, 'Migration DIMOS')
})

test('a private event never becomes anything at all', () => {
  // Not filtered downstream: the subject must not enter the database.
  assert.equal(mapEvent(graphEvent({ sensitivity: 'private' }), 'Europe/Paris'), null)
  assert.equal(mapEvent(graphEvent({ sensitivity: 'confidential' }), 'Europe/Paris'), null)
})

test('an event with no usable start is dropped, not guessed at', () => {
  assert.equal(mapEvent(graphEvent({ start: { dateTime: '', timeZone: '' } }), 'Europe/Paris'), null)
  assert.equal(mapEvent(graphEvent({ id: '' }), 'Europe/Paris'), null)
})

test('a room resource with no address costs the attendee, never the meeting', () => {
  const mapped = mapEvent(
    graphEvent({ attendees: [{ type: 'resource', emailAddress: { name: 'Salle Cassiopée' } }] }),
    'Europe/Paris',
  )
  assert.ok(mapped)
  assert.deepEqual(mapped.context.attendees, [
    { name: 'Salle Cassiopée', email: '', type: 'resource', response: 'none' },
  ])
})

test('an unknown attendee type or response falls back rather than throwing', () => {
  const mapped = mapEvent(
    graphEvent({ attendees: [{ type: 'chair', status: { response: 'maybe' }, emailAddress: { address: 'x@y.fr' } }] }),
    'Europe/Paris',
  )
  assert.equal(mapped?.context.attendees[0]?.type, 'required')
  assert.equal(mapped?.context.attendees[0]?.response, 'none')
})

test('a removal marker is recognised only when Graph sent one', () => {
  assert.equal(removedId({ id: 'AAMkAD', '@removed': { reason: 'deleted' } }), 'AAMkAD')
  assert.equal(removedId(graphEvent()), null)
})

// ── delta ──────────────────────────────────────────────────────────────────

const folded = (items: unknown[], seed: readonly CalendarEvent[] = []) =>
  applyDelta(seed, items, 'Europe/Paris')

test('an update replaces the event it updates', () => {
  const first = folded([graphEvent()])
  const second = folded([graphEvent({ subject: 'Point Aura — reporté' })], first)
  assert.equal(second.length, 1)
  assert.equal(second[0]?.context.subject, 'Point Aura — reporté')
})

test('a cancellation is kept, so the UI can say it was cancelled', () => {
  const events = folded([graphEvent({ isCancelled: true })])
  assert.equal(events.length, 1)
  assert.equal(events[0]?.isCancelled, true)
})

test('an event that turns private is removed from the fold', () => {
  // The quiet removal. Without it the app keeps a copy nothing will ever
  // update again — of exactly the event a human asked it not to touch.
  const before = folded([graphEvent()])
  assert.equal(before.length, 1)
  assert.deepEqual(folded([graphEvent({ sensitivity: 'private' })], before), [])
})

test('a deletion marker removes the event', () => {
  const before = folded([graphEvent()])
  assert.deepEqual(folded([{ id: 'AAMkAD', '@removed': { reason: 'deleted' } }], before), [])
})

test('a cursor whose window has run out is not reused', () => {
  const now = NOW
  const bounds = windowFor(now)
  const fresh = { ...EMPTY_WINDOW, ...bounds, cursor: 'https://graph/delta?token=1' }
  assert.equal(needsFullSync(fresh, now), false)
  // Same cursor, days later: the window it was earned over has nearly expired.
  assert.equal(needsFullSync(fresh, bounds.to - MIN_LOOKAHEAD_MS + 1), true)
  // And a window that never had a cursor always syncs in full.
  assert.equal(needsFullSync(EMPTY_WINDOW, now), true)
})

test('pruning drops what the window no longer covers', () => {
  const events = folded([graphEvent()])
  const inside = { from: Date.parse('2026-08-05T00:00:00Z'), to: Date.parse('2026-08-06T00:00:00Z') }
  const outside = { from: Date.parse('2026-09-01T00:00:00Z'), to: Date.parse('2026-09-08T00:00:00Z') }
  assert.equal(prune(events, inside).length, 1)
  assert.equal(prune(events, outside).length, 0)
})

// ── graphGet ───────────────────────────────────────────────────────────────

const response = (status: number, body: string, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  text: async () => body,
})

test('a 401 is reported as needing a sign-in, not as an outage', async () => {
  const fetch: FetchLike = async () => response(401, '{"error":{"message":"expired"}}')
  await assert.rejects(
    () => graphGet('https://graph/x', { token: 't', fetch }),
    (error: unknown) => error instanceof GraphError && error.needsSignIn && !error.retryable,
  )
})

test('a 429 carries the wait Graph asked for', async () => {
  const fetch: FetchLike = async () => response(429, '', { 'retry-after': '30' })
  await assert.rejects(
    () => graphGet('https://graph/x', { token: 't', fetch }),
    (error: unknown) => error instanceof GraphError && error.retryable && error.retryAfterMs === 30_000,
  )
})

test('a bearer token is sent, and never in the URL', async () => {
  let seen: { url: string; headers: Record<string, string> } | null = null
  const fetch: FetchLike = async (url, init) => {
    seen = { url, headers: (init?.headers ?? {}) as Record<string, string> }
    return response(200, '{"value":[]}')
  }
  await graphGet('https://graph/x', { token: 'secret', fetch })
  assert.equal(seen!.headers.Authorization, 'Bearer secret')
  assert.ok(!seen!.url.includes('secret'))
})

// ── GraphCalendar ──────────────────────────────────────────────────────────

const identity = (token = 'tok'): IdentityPort => ({
  account: () => null,
  signIn: async () => {
    throw new Error('not used')
  },
  signOut: async () => {},
  token: async () => token,
})

const pages = (bodies: unknown[]): { fetch: FetchLike; urls: string[]; headers: Record<string, string>[] } => {
  const urls: string[] = []
  const headers: Record<string, string>[] = []
  let index = 0
  const fetch: FetchLike = async (url, init) => {
    urls.push(url)
    headers.push((init?.headers ?? {}) as Record<string, string>)
    return response(200, JSON.stringify(bodies[index++] ?? {}))
  }
  return { fetch, urls, headers }
}

test('a first sync walks every page and keeps the delta link', async () => {
  const { fetch, urls, headers } = pages([
    { value: [graphEvent()], '@odata.nextLink': 'https://graph/page2' },
    { value: [graphEvent({ id: 'BBB', subject: 'Kickoff' })], '@odata.deltaLink': 'https://graph/delta?token=1' },
  ])
  const calendar = new GraphCalendar({ identity: identity(), fetch, clock: () => NOW })

  const window = await calendar.sync()
  assert.equal(window.events.length, 2)
  assert.equal(window.cursor, 'https://graph/delta?token=1')
  assert.equal(urls.length, 2)
  assert.equal(urls[1], 'https://graph/page2')
  // No $select/$filter/$orderby/$expand — Graph rejects them on a delta query.
  assert.ok(!urls[0]?.includes('$'), urls[0])
  assert.match(headers[0]?.Prefer ?? '', /outlook\.timezone="Europe\/Paris"/)
})

test('the second sync resumes from the cursor instead of asking again', async () => {
  const state = memoryKeyValueStore()
  const now = NOW
  const first = pages([{ value: [graphEvent()], '@odata.deltaLink': 'https://graph/delta?token=1' }])
  await new GraphCalendar({ identity: identity(), fetch: first.fetch, state, clock: () => now }).sync()

  const second = pages([
    { value: [{ id: 'AAMkAD', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': 'https://graph/delta?token=2' },
  ])
  // A fresh instance: this is the restart case, which is the whole reason the
  // cursor is persisted at all.
  const calendar = new GraphCalendar({ identity: identity(), fetch: second.fetch, state, clock: () => now + 60_000 })
  const window = await calendar.sync()

  assert.equal(second.urls[0], 'https://graph/delta?token=1')
  assert.deepEqual(window.events, [])
  assert.equal(window.cursor, 'https://graph/delta?token=2')
})

test('concurrent syncs make one request, not two', async () => {
  const { fetch, urls } = pages([{ value: [graphEvent()], '@odata.deltaLink': 'https://graph/delta?token=1' }])
  const calendar = new GraphCalendar({ identity: identity(), fetch, clock: () => NOW })
  const [a, b] = await Promise.all([calendar.sync(), calendar.sync()])
  assert.equal(urls.length, 1)
  assert.deepEqual(a, b)
})

test('a window written by an older build is discarded, not trusted', async () => {
  const state = memoryKeyValueStore()
  state.set(WINDOW_KEY, '{"cursor":"https://graph/stale"}')
  const { fetch, urls } = pages([{ value: [], '@odata.deltaLink': 'https://graph/delta?token=1' }])
  await new GraphCalendar({ identity: identity(), fetch, state, clock: () => NOW }).sync()
  // A full delta query, not the cursor that could not be validated.
  assert.match(urls[0] ?? '', /calendarView\/delta\?startDateTime=/)
})

test('the last fold is readable without touching the network', async () => {
  const { fetch } = pages([{ value: [graphEvent()], '@odata.deltaLink': 'https://graph/delta?token=1' }])
  const calendar = new GraphCalendar({ identity: identity(), fetch, clock: () => NOW })
  assert.deepEqual(calendar.window(), EMPTY_WINDOW)
  await calendar.sync()
  assert.equal(calendar.window().events.length, 1)
})

// ── health ─────────────────────────────────────────────────────────────────

test('a throttled calendar is degraded, an expired session is down', () => {
  const throttled = calendarHealth(new GraphError({ status: 429, message: 'slow down', retryable: true, retryAfterMs: 30_000 }), 1)
  assert.equal(throttled.state, 'degraded')
  assert.match(throttled.state === 'degraded' ? throttled.reason : '', /30 s/)

  const expired = calendarHealth(new InteractionRequiredError(), 1)
  assert.equal(expired.state, 'down')
  assert.equal(expired.state === 'down' ? expired.retryable : false, true)
})

test('a missing permission offers no retry button, because retrying cannot fix it', () => {
  const denied = calendarHealth(new GraphError({ status: 403, message: 'Access denied', retryable: false }), 1)
  assert.equal(denied.state, 'down')
  assert.equal(denied.state === 'down' ? denied.retryable : true, false)
  assert.match(denied.state === 'down' ? denied.reason : '', /Calendars\.Read/)
})
