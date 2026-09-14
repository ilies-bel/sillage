import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MeetingApps,
  PROCESS_TTL_MS,
  listProcesses,
  matchMeetingApp,
  matchMicHolder,
} from '../MeetingApps.ts'
import { ARM_POLL_MS } from '../../../core/domain/arming.ts'
import type { MicApp } from '../nativeModule.ts'

test('Teams is recognised under every name it ships as', () => {
  assert.equal(matchMeetingApp(['ms-teams.exe']), 'Teams')
  assert.equal(matchMeetingApp(['Teams.exe']), 'Teams')
  assert.equal(matchMeetingApp(['MSTeams']), 'Teams')
})

test('a full path is matched on its last segment', () => {
  assert.equal(matchMeetingApp(['/Applications/Zoom.app/Contents/MacOS/zoom.us']), 'Zoom')
  assert.equal(matchMeetingApp(['C:\\Program Files\\Teams\\ms-teams.exe']), 'Teams')
})

test('a browser is never a meeting app', () => {
  // Google Meet runs in a tab; matching Chrome would arm on every event of
  // every day.
  assert.equal(matchMeetingApp(['Google Chrome', 'firefox', 'msedge.exe']), null)
})

test('a process that merely contains the word does not match', () => {
  assert.equal(matchMeetingApp(['teamviewer', 'zoominfo-agent', 'teams-notifier']), null)
})

test('an empty process list is not a meeting', () => {
  assert.equal(matchMeetingApp([]), null)
  assert.equal(matchMeetingApp(['', '   ']), null)
})

test('tasklist CSV is read by its first column', async () => {
  const out = '"ms-teams.exe","4812","Console","1","350 000 Ko"\r\n"explorer.exe","900","Console","1","70 000 Ko"\r\n'
  const names = await listProcesses('win32', async () => out)
  assert.deepEqual(names, ['ms-teams.exe', 'explorer.exe'])
})

test('ps output is read a line at a time', async () => {
  const names = await listProcesses('darwin', async () => '/usr/sbin/cfprefsd\n/Applications/MSTeams.app/Contents/MacOS/MSTeams\n\n')
  assert.equal(matchMeetingApp(names), 'Teams')
})

test('the reading is cached, because arming re-evaluates far more often', async () => {
  let calls = 0
  let now = 0
  const apps = new MeetingApps({
    platform: 'darwin',
    clock: () => now,
    ttlMs: 15_000,
    runner: async () => {
      calls++
      return 'MSTeams\n'
    },
  })

  assert.equal((await apps.refresh()).running, 'Teams')
  assert.equal((await apps.refresh()).running, 'Teams')
  assert.equal(calls, 1)

  now += 15_001
  await apps.refresh()
  assert.equal(calls, 2)
})

test('concurrent refreshes spawn one process, not two', async () => {
  let calls = 0
  const apps = new MeetingApps({
    platform: 'darwin',
    clock: () => 0,
    runner: async () => {
      calls++
      return 'MSTeams\n'
    },
  })
  const [a, b] = await Promise.all([apps.refresh(), apps.refresh()])
  assert.equal(calls, 1)
  assert.deepEqual([a.running, b.running], ['Teams', 'Teams'])
})

test('a machine where ps is unavailable reports no meeting, never throws', async () => {
  // Costs automatic arming and nothing else — the rep can still start by hand,
  // and DEC-26 says nothing downstream may stop a meeting being recorded.
  const apps = new MeetingApps({
    platform: 'darwin',
    clock: () => 0,
    runner: async () => {
      throw new Error('EACCES')
    },
  })
  assert.equal((await apps.refresh()).running, null)
})

test('the cached reading is readable without spawning anything', async () => {
  const apps = new MeetingApps({ platform: 'darwin', clock: () => 0, runner: async () => 'MSTeams\n' })
  assert.deepEqual(apps.current(), { running: null, inCall: null }, 'nothing read yet')
  await apps.refresh()
  assert.equal(apps.current().running, 'Teams')
})

/*
 * ── The microphone signal ────────────────────────────────────────────────────
 *
 * The half that tells a *call* from an *open application*, and the half that
 * makes an unscheduled call detectable. Driven through the shipped
 * `matchMicHolder` and the shipped class, never through a copy of either.
 */

const holder = (over: Partial<MicApp>): MicApp => ({ pid: 1, bundleId: '', name: '', ...over })

test('a bundle id names the app, because a binary name is not stable across versions', () => {
  assert.equal(matchMicHolder([holder({ bundleId: 'com.microsoft.teams2' })]), 'Teams')
  assert.equal(matchMicHolder([holder({ bundleId: 'US.ZOOM.XOS' })]), 'Zoom', 'case-insensitive')
  assert.equal(matchMicHolder([holder({ bundleId: 'us.zoom.xos.helper' })]), null, 'exact, never a prefix')
})

test('an unbundled process is matched on its executable name', () => {
  // `ffmpeg` recording from a terminal is the case that proved a bundle id can
  // be empty — measured on macOS, pid 66118, bundleId "".
  assert.equal(matchMicHolder([holder({ name: '/Applications/Zoom.app/Contents/MacOS/zoom.us' })]), 'Zoom')
  assert.equal(matchMicHolder([holder({ name: 'ms-teams.exe' })]), 'Teams')
  assert.equal(matchMicHolder([holder({ name: 'ffmpeg' })]), null)
})

test('a browser holding the microphone is a call; a browser merely running is not', () => {
  // The whole point of `micOnly`. `matchMeetingApp` must never name a browser —
  // it is open all day, so it would arm on every calendar event of every day —
  // and `matchMicHolder` must, because a tab holding the *microphone* is a call.
  // Playback takes an output stream, and `mic_apps.rs` reports input only.
  assert.equal(matchMeetingApp(['Google Chrome', 'firefox', 'msedge.exe']), null)
  assert.equal(matchMicHolder([holder({ name: 'Google Chrome' })]), 'Navigateur')
  assert.equal(matchMicHolder([holder({ bundleId: 'com.google.chrome' })]), 'Navigateur')
})

test('Slack and Aircall are microphone-only for the same reason', () => {
  assert.equal(matchMeetingApp(['slack.exe', 'aircall']), null)
  assert.equal(matchMicHolder([holder({ bundleId: 'com.tinyspeck.slackmacgap' })]), 'Slack')
  assert.equal(matchMicHolder([holder({ name: 'aircall.exe' })]), 'Aircall')
})

test('no holders, and a holder that is nothing, name nothing', () => {
  assert.equal(matchMicHolder([]), null)
  assert.equal(matchMicHolder([holder({})]), null)
  assert.equal(matchMicHolder([holder({ bundleId: '   ', name: '  ' })]), null)
})

test('the microphone reading is not cached, because it is the half that changes', async () => {
  let held: MicApp[] = []
  let reads = 0
  const apps = new MeetingApps({
    platform: 'darwin',
    clock: () => 0,
    runner: async () => 'MSTeams\n',
    micHolders: () => {
      reads++
      return held
    },
  })

  assert.equal((await apps.refresh()).inCall, null)
  held = [holder({ bundleId: 'com.microsoft.teams2' })]
  // The clock has not moved, so the process list is served from cache. The
  // microphone must not be: a call starting is exactly this transition.
  assert.equal((await apps.refresh()).inCall, 'Teams')
  held = []
  assert.equal((await apps.refresh()).inCall, null, 'and it goes away again')
  assert.equal(reads, 3)
})

test('a native module without the export degrades to the process signal alone', async () => {
  const apps = new MeetingApps({ platform: 'darwin', clock: () => 0, runner: async () => 'MSTeams\n' })
  const signal = await apps.refresh()
  assert.equal(signal.running, 'Teams')
  assert.equal(signal.inCall, null, 'absent is « we did not measure it », never a fault')
})

test('a microphone read that throws costs the strong signal and nothing else', async () => {
  const apps = new MeetingApps({
    platform: 'darwin',
    clock: () => 0,
    runner: async () => 'MSTeams\n',
    micHolders: () => {
      throw new Error('HAL refused')
    },
  })
  const signal = await apps.refresh()
  assert.equal(signal.inCall, null)
  assert.equal(signal.running, 'Teams', 'the weak signal still stands (DEC-26)')
})

test('the process TTL is a multiple of the interval it is asked at, not a second number', () => {
  /*
   * The assertion round 23 said nothing made. `ARM_POLL_MS` was 20 000 against a
   * hard-coded `ttlMs` of 15 000, so **every poll missed the cache** — measured
   * at 874 spawns and 0 hits over a simulated eleven-hour day — while this
   * class's docblock claimed the cache damped the poll. Deriving it is what makes
   * that arithmetic impossible rather than merely currently-true.
   */
  assert.ok(
    PROCESS_TTL_MS >= ARM_POLL_MS,
    `a TTL of ${PROCESS_TTL_MS} under a poll of ${ARM_POLL_MS} can never hit`,
  )
  assert.equal(PROCESS_TTL_MS % ARM_POLL_MS, 0, 'derived, not chosen')
})

test('the default TTL actually damps the default poll, driven not reasoned', async () => {
  let calls = 0
  let now = 0
  const apps = new MeetingApps({ platform: 'darwin', clock: () => now, runner: async () => {
    calls++
    return 'MSTeams\n'
  } })
  // Eleven hours of arming polls, the way round 23 measured it.
  const ticks = Math.floor((11 * 60 * 60_000) / ARM_POLL_MS)
  for (let i = 0; i < ticks; i++) {
    await apps.refresh()
    now += ARM_POLL_MS
  }
  assert.ok(calls < ticks, `${calls} spawns over ${ticks} polls — the cache must hit at all`)
  assert.equal(calls, Math.ceil((ticks * ARM_POLL_MS) / PROCESS_TTL_MS))
})

test('an empty calendar pays no process spawn for a signal nothing can read', async () => {
  /*
   * The demo build's every day. `Agenda` now runs an arming loop where it used to
   * run none, so without this the build DEC-28 calls the first deliverable would
   * have *gained* a `ps` — on Windows a `tasklist` plus a conhost spawn — every
   * minute, all day, for the second half of a conjunction whose first half does
   * not exist.
   */
  let spawns = 0
  let held: MicApp[] = []
  const apps = new MeetingApps({
    platform: 'darwin',
    clock: () => 0,
    runner: async () => {
      spawns++
      return 'MSTeams\n'
    },
    micHolders: () => held,
  })

  for (let i = 0; i < 50; i++) await apps.refresh({ processList: false })
  assert.equal(spawns, 0, 'not one spawn in fifty polls')

  // And the microphone half is still read every time — it is the half that
  // answers on its own, and skipping it would delete the feature.
  held = [holder({ bundleId: 'com.microsoft.teams2' })]
  assert.equal((await apps.refresh({ processList: false })).inCall, 'Teams')
  assert.equal(spawns, 0)

  // Asking for it does spawn, so the skip is a decision and not a breakage.
  await apps.refresh()
  assert.equal(spawns, 1)
})
