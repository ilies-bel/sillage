/**
 * The process half of arming: is a conferencing application running right now?
 *
 * VISION.md §210 calls this `MeetingDetector` — "calendar signal × process
 * signal". It lives in `modules/capture/` because this is the module that owns
 * what the machine's audio is doing, and a second module for one `ps` call would
 * buy a boundary and nothing else.
 *
 * **What this signal is, exactly.** It says a conferencing app is *running*, not
 * that a call is in progress: Teams starts with Windows and stays open all day.
 * On its own it would arm for everything. It is only ever the second half of a
 * conjunction whose first half is a five-minute calendar window around a real
 * event with real attendees (`core/domain/arming.ts`), and arming is an offer a
 * human still accepts (HR-7). The refinement — the loopback actually carrying
 * sound — waits on an always-on level probe that does not exist yet.
 */
import { execFile } from 'node:child_process'

export interface MeetingApp {
  /** Shown to the rep: *Teams émet du son*. Their word for it, not a binary name. */
  label: string
  /** Matched against a process name, case-insensitively. */
  pattern: RegExp
}

/**
 * Ordered by how much a match means. Teams first — DEC-3 says Teams and
 * calendar meetings are the whole of v1 — and the rest are here so that a rep
 * whose client insists on Zoom is not silently unsupported.
 *
 * Deliberately absent: browsers. Google Meet runs in a tab, and matching Chrome
 * would arm on every calendar event of every day.
 */
export const MEETING_APPS: readonly MeetingApp[] = Object.freeze([
  // New Teams is `ms-teams.exe` / `MSTeams`; classic is `Teams.exe`.
  { label: 'Teams', pattern: /^(ms-?teams|teams)(\.exe)?$/i },
  { label: 'Zoom', pattern: /^(zoom\.us|zoom|cpthost)(\.exe)?$/i },
  { label: 'Webex', pattern: /^(webex|webexmta|ciscocollabhost)(\.exe)?$/i },
  { label: 'Google Meet', pattern: /^meet(\.exe)?$/i },
])

/** Pure: process names in, the app to name in, or null. */
export const matchMeetingApp = (processNames: readonly string[]): string | null => {
  const names = processNames.map((name) => basename(name)).filter(Boolean)
  for (const app of MEETING_APPS) {
    if (names.some((name) => app.pattern.test(name))) return app.label
  }
  return null
}

/** `/Applications/Zoom.app/Contents/MacOS/zoom.us` → `zoom.us`. */
const basename = (raw: string): string => {
  const trimmed = raw.trim()
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

export type Runner = (command: string, args: readonly string[]) => Promise<string>

const run: Runner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: 4_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

/** `tasklist` on Windows, `ps` everywhere else. */
export const listProcesses = async (platform: string, runner: Runner = run): Promise<string[]> => {
  if (platform === 'win32') {
    // CSV with no header: "ms-teams.exe","1234","Console",…
    const out = await runner('tasklist', ['/FO', 'CSV', '/NH'])
    return out
      .split('\n')
      .map((line) => /^"([^"]+)"/.exec(line.trim())?.[1] ?? '')
      .filter(Boolean)
  }
  const out = await runner('ps', ['-Ao', 'comm='])
  return out.split('\n').map((line) => line.trim()).filter(Boolean)
}

export interface MeetingAppsOptions {
  platform?: string
  runner?: Runner
  clock?: () => number
  /** How long a reading stays good. Arming re-evaluates far more often than this. */
  ttlMs?: number
}

/**
 * Cached, because arming re-evaluates on every calendar tick and on every audio
 * event, and shelling out to `ps` on each one is a process spawn per second for
 * an answer that changes on the scale of minutes.
 */
export class MeetingApps {
  #platform: string
  #runner: Runner
  #clock: () => number
  #ttl: number
  #value: string | null = null
  #readAt = -Infinity
  #inFlight: Promise<string | null> | null = null

  constructor(options: MeetingAppsOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#runner = options.runner ?? run
    this.#clock = options.clock ?? Date.now
    this.#ttl = options.ttlMs ?? 15_000
  }

  /** The last reading, without spawning anything. */
  current(): string | null {
    return this.#value
  }

  async refresh(): Promise<string | null> {
    if (this.#clock() - this.#readAt < this.#ttl) return this.#value
    this.#inFlight ??= this.#read().finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  async #read(): Promise<string | null> {
    try {
      this.#value = matchMeetingApp(await listProcesses(this.#platform, this.#runner))
    } catch {
      // A locked-down machine where `ps` is unavailable, or a timeout. Reporting
      // "no meeting app" costs automatic arming and nothing else — the rep can
      // still start a meeting by hand, and DEC-26 says nothing downstream may
      // stop a meeting being recorded.
      this.#value = null
    }
    this.#readAt = this.#clock()
    return this.#value
  }
}
