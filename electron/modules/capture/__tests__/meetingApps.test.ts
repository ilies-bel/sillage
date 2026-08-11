import test from 'node:test'
import assert from 'node:assert/strict'
import { MeetingApps, listProcesses, matchMeetingApp } from '../MeetingApps.ts'

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

  assert.equal(await apps.refresh(), 'Teams')
  assert.equal(await apps.refresh(), 'Teams')
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
  assert.deepEqual([a, b], ['Teams', 'Teams'])
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
  assert.equal(await apps.refresh(), null)
})

test('the cached reading is readable without spawning anything', async () => {
  const apps = new MeetingApps({ platform: 'darwin', clock: () => 0, runner: async () => 'MSTeams\n' })
  assert.equal(apps.current(), null, 'nothing read yet')
  await apps.refresh()
  assert.equal(apps.current(), 'Teams')
})
