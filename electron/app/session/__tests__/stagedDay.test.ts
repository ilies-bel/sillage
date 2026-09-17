import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Agenda } from '../Agenda.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { AD_HOC_DWELL_MS } from '../../../core/domain/adHoc.ts'
import type { CalendarPort, CalendarWindow } from '../../../core/contracts/calendar.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.resolve(HERE, '../../../../scripts/harness/bridge-stub.mjs')

type StagedMeeting = {
  id: string
  title: string
  clientName: string | null
  state: string
  eventId: string | null
  scheduledStart: number | null
  createdAt: number
  startedAt: number | null
}

const loadStub = async (): Promise<(o: { scenario: string; now: number; entra: boolean }) => void> => {
  const url = new URL('../../../../scripts/harness/bridge-stub.mjs', import.meta.url).href
  const mod = (await import(url)) as {
    installAppBridge: (o: { scenario: string; now: number; entra: boolean }) => void
  }
  return mod.installAppBridge
}

/** `main.ts` builds `Agenda` over this in the branch DEC-28 ships first. */
const NULL_CALENDAR = (now: number): CalendarPort => {
  const window = (): CalendarWindow => ({
    cursor: null,
    syncedAt: now,
    from: now - 86_400_000,
    to: now + 604_800_000,
    events: [],
  })
  return { window, sync: async () => window() } as unknown as CalendarPort
}

/**
 * **A staged day must be a day the shipped `Agenda` produces.**
 *
 * `agenda-appel-imprevu` staged one meeting `armed` and the 14:30 the rep had
 * placed `idle`. Driven on that same day, the shipped `Agenda` arms the 14:30 —
 * all four of the stage's facts inverted — because with `eventId: null` the
 * placed slot is an `ownClaims` claimant, `#calendarOffersAt` answers 14:25 and
 * `decideAdHoc` replies « cet appel est au calendrier », so the anonymous row is
 * never minted. Fifteen rounds of detection scores were given against that
 * picture, and it is the picture DEC-28's first demo shows.
 *
 * The check that was supposed to hold this counted armed rows — `armed.length > 1`,
 * `armed && recording` — and never asked *which* meeting a real `Agenda` would
 * arm. It is green with the defect and green without it. Counting is orthogonal
 * to the subject, which is « would the product draw this day ».
 *
 * So this one constructs the shipped class. Rows the stub stages as `armed` are
 * left out of the store: an armed row is detection's **output**, and seeding it
 * would be the fixture answering its own question. Everything else goes in, and
 * the assertion is that nothing the stub photographs as `idle` gets armed.
 *
 * Both microphone premises run, because the arm site's own guard is
 * `signal.running !== null || (signal.inCall !== null && dwelt)`: with the
 * microphone idle that whole branch is skipped and only the calendar can arm, so
 * a rep-placed claimant is reachable under the held premise alone. Neither
 * premise may arm a row the picture shows as idle.
 */
test('no harness scenario photographs a day the shipped Agenda refuses', async () => {
  const source = readFileSync(STUB, 'utf8')
  const scenarios = [
    ...new Set([...source.matchAll(/scenario [!=]== '([^']+)'/g)].map((m) => m[1] as string)),
    '__inconnu__',
  ].sort()
  assert.ok(
    scenarios.length >= 8,
    `l’énumération des scénarios n’en a trouvé que ${scenarios.length} — le stub a changé de ` +
      'forme et ce test ne regarde plus rien',
  )

  const { pinnedNow } = (await import(
    new URL('../../../../scripts/harness/pinnedNow.mjs', import.meta.url).href
  )) as { pinnedNow: () => number }
  const now = pinnedNow()

  const installAppBridge = await loadStub()
  const globals = globalThis as { window?: unknown }
  const before = globals.window

  const dayOf = (scenario: string, entra: boolean): Promise<StagedMeeting[]> => {
    globals.window = { addEventListener: () => {} }
    try {
      installAppBridge({ scenario, now, entra })
      const bridge = (globals.window as { app: { invoke: (c: string, p: unknown) => unknown } }).app
      return bridge.invoke('meeting:list', {}) as Promise<StagedMeeting[]>
    } finally {
      globals.window = before
    }
  }

  const offences: string[] = []
  let everDriven = 0

  for (const scenario of scenarios) {
    for (const entra of [true, false]) {
      const staged = await dayOf(scenario, entra)
      const idleIds = new Set(staged.filter((m) => m.state === 'idle').map((m) => m.id))
      if (idleIds.size === 0) continue

      for (const held of [false, true]) {
        const store = openMemoryStore()
        try {
          const orchestrator = new Orchestrator(store)
          for (const m of staged) {
            if (m.state === 'armed') continue
            orchestrator.create({
              id: m.id,
              title: m.title,
              clientName: m.clientName,
              scheduledStart: m.scheduledStart,
              context: null,
            })
          }
          const agenda = new Agenda({
            calendar: NULL_CALENDAR(now),
            orchestrator,
            ownMeetings: (from: number, to: number) =>
              store.projections.listMeetings(200, { from, to }),
            meetingSignal: () =>
              held ? { running: 'Teams', inCall: 'Teams' } : { running: null, inCall: null },
            clock: () => now,
            onArmed: () => {},
          } as unknown as ConstructorParameters<typeof Agenda>[0])

          // Held continuously across the dwell, the way a real call arrives.
          await agenda.tick({ now: now - 2 * AD_HOC_DWELL_MS })
          await agenda.tick({ now: now - AD_HOC_DWELL_MS })
          await agenda.tick({ now })
          everDriven += 1

          const armed = agenda.snapshot().armed
          if (armed !== null && idleIds.has(armed.meetingId)) {
            const picture = staged.find((m) => m.state === 'armed')
            offences.push(
              `${scenario} (entra: ${entra}, micro ${held ? 'tenu' : 'libre'}) : la capture ` +
                `montre ${picture === undefined ? 'aucune réunion armée' : `« ${picture.title} » armée`} ` +
                `et ${armed.meetingId} au repos, mais l’Agenda expédié arme ${armed.meetingId} ` +
                `« ${armed.subject} »`,
            )
          }
        } finally {
          store.close()
        }
      }
    }
  }

  assert.ok(
    everDriven > 0,
    'aucun scénario n’a pu être rejoué — ce test passerait sans rien conduire',
  )

  assert.deepEqual(
    offences,
    [],
    'une mise en scène photographie une journée que le produit refuse de dessiner : la capture ' +
      'plaide pour un comportement que l’Agenda expédié n’a pas, et c’est sur ces captures que ' +
      'la surface est notée.',
  )
})
