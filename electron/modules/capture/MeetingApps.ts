/**
 * The process half of arming — and, now, the half that can tell a *call* from an
 * *open application*.
 *
 * VISION.md §210 calls this `MeetingDetector`: "calendar signal × process
 * signal". It lives in `modules/capture/` because this is the module that owns
 * what the machine's audio is doing, and a second module for one `ps` call would
 * buy a boundary and nothing else.
 *
 * ## Two signals, and they answer different questions
 *
 * **`running`** is the old one: a conferencing application exists in the process
 * list. Its weakness was stated in this docblock from the day it was written —
 * *"Teams starts with Windows and stays open all day"* — and the twenty-third
 * review round priced it: for a rep with Teams open, the conjunction with the
 * calendar is *effectively the calendar alone*. It is still worth having,
 * because it is the only signal available **before** a call starts, and
 * `ARM_LEAD_MS` exists to put the offer on screen five minutes early.
 *
 * **`inCall`** is new and is the signal Granola has: a conferencing application
 * is *holding a microphone*. `native-module/src/mic_apps.rs` answers it from
 * `kAudioHardwarePropertyProcessObjectList` on macOS and
 * `IAudioSessionManager2` on Windows — no new dependency, no permission prompt,
 * and measured not to light the macOS microphone indicator. This is what
 * finally closes the gap the old docblock left open: *"The refinement — the
 * loopback actually carrying sound — waits on an always-on level probe that
 * does not exist yet."* It turned out not to need a level probe. Asking the OS
 * which process holds the microphone is both cheaper and far more specific than
 * measuring whether sound is arriving, because it comes with an application
 * name attached.
 *
 * ## What the strong signal unlocks that the weak one could not
 *
 * An app that is *always running* can never be in `MEETING_APPS` as a process
 * match — it would arm every day, all day. But an app that is always running
 * and is *holding a microphone* is almost certainly in a call. So `micOnly`
 * entries exist: browsers (Google Meet lives in a tab, and round 23 noted that
 * a rep whose client uses Meet therefore produced no signal at all), Slack
 * huddles, Aircall — which for a French sales organisation is not an edge case
 * but the telephone — and FaceTime. None of them may be matched by name in the
 * process list; all of them are decisive when they hold the microphone.
 *
 * A browser holding the *microphone* is not a rep watching YouTube: playback
 * takes an output stream, and `mic_apps.rs` reports input only.
 */
import { execFile } from 'node:child_process'
import { ARM_POLL_MS } from '../../core/domain/arming.ts'
import type { MicApp } from './nativeModule.ts'

export interface MeetingApp {
  /** Shown to the rep: *Teams émet du son*. Their word for it, not a binary name. */
  label: string
  /** Matched against a process name, case-insensitively. */
  pattern: RegExp
  /**
   * macOS bundle ids, matched exactly and case-insensitively. A bundle id is a
   * stronger match than an executable name — `Microsoft Teams` ships helper
   * processes whose names change between versions, and the bundle id does not.
   */
  bundles?: readonly string[]
  /**
   * This app may **only** be recognised by holding a microphone, never by being
   * in the process list.
   *
   * Every entry carrying this is an application a rep leaves open all day. Its
   * presence says nothing; its microphone says everything.
   */
  micOnly?: boolean
}

/**
 * Ordered by how much a match means. Teams first — DEC-3 says Teams and
 * calendar meetings are the whole of v1 — and the rest are here so that a rep
 * whose client insists on Zoom is not silently unsupported.
 */
export const MEETING_APPS: readonly MeetingApp[] = Object.freeze([
  // New Teams is `ms-teams.exe` / `MSTeams`; classic is `Teams.exe`.
  {
    label: 'Teams',
    pattern: /^(ms-?teams|teams)(\.exe)?$/i,
    bundles: ['com.microsoft.teams', 'com.microsoft.teams2'],
  },
  { label: 'Zoom', pattern: /^(zoom\.us|zoom|cpthost)(\.exe)?$/i, bundles: ['us.zoom.xos'] },
  {
    label: 'Webex',
    pattern: /^(webex|webexmta|ciscocollabhost)(\.exe)?$/i,
    bundles: ['cisco-systems.spark', 'com.cisco.webexmeetingsapp'],
  },
  { label: 'Google Meet', pattern: /^meet(\.exe)?$/i },

  /*
   * Microphone-only from here down. Each of these is running on a rep's machine
   * at all times, so a process match would arm on every calendar event of every
   * day — which is exactly why browsers were excluded outright before there was
   * a way to ask about the microphone.
   */
  {
    label: 'Aircall',
    pattern: /^aircall(\.exe)?$/i,
    bundles: ['com.aircall.electron'],
    micOnly: true,
  },
  {
    label: 'Slack',
    pattern: /^slack(\.exe)?$/i,
    bundles: ['com.tinyspeck.slackmacgap'],
    micOnly: true,
  },
  { label: 'FaceTime', pattern: /^facetime$/i, bundles: ['com.apple.facetime'], micOnly: true },
  {
    // A tab holding the microphone. Chrome puts its capture in a renderer or a
    // utility process, so the name is matched loosely and the bundle id of the
    // browser itself is matched too.
    /*
     * A name, not a sentence, because this string lands in two places that want
     * opposite things. It is a *reason* — « Navigateur émet du son », beside
     * « Teams émet du son » — and it is also the *title* of the meeting it
     * creates, which reaches Historique and the VerySwing task. The first draft
     * read « un appel dans le navigateur », which is good French in the reason
     * and gives « Appel non planifié — un appel dans le navigateur » as a title:
     * the word « appel » twice, in the name of a client's call. Every other entry
     * here is a proper noun and works in both positions; this one has to be too.
     */
    label: 'Navigateur',
    pattern: /^(google chrome|chrome|msedge|microsoft edge|firefox|brave|chromium)( helper.*)?(\.exe)?$/i,
    bundles: [
      'com.google.chrome',
      'com.microsoft.edgemac',
      'org.mozilla.firefox',
      'com.brave.browser',
      'org.chromium.chromium',
    ],
    micOnly: true,
  },
])

/**
 * Pure: process names in, the app to name in, or null.
 *
 * `micOnly` entries are skipped. That is the whole of what makes this signal
 * usable: without the skip, the browser row alone would match on every machine
 * every minute of the day.
 */
export const matchMeetingApp = (processNames: readonly string[]): string | null => {
  const names = processNames.map((name) => basename(name)).filter(Boolean)
  for (const app of MEETING_APPS) {
    if (app.micOnly === true) continue
    if (names.some((name) => app.pattern.test(name))) return app.label
  }
  return null
}

/**
 * Pure: the processes holding a microphone in, the conferencing app to name, or
 * null.
 *
 * Bundle id is tried before the executable name because it is the stable
 * identifier — `Microsoft Teams` renamed its binary between versions and kept
 * its bundle id — and because a bundle id is an exact match where a name is a
 * pattern. Both are tried for every app, since Windows supplies no bundle id at
 * all and an unbundled macOS binary supplies none either.
 */
export const matchMicHolder = (apps: readonly MicApp[]): string | null => {
  for (const app of MEETING_APPS) {
    for (const holder of apps) {
      const bundle = holder.bundleId.trim().toLowerCase()
      if (bundle !== '' && app.bundles?.some((id) => id.toLowerCase() === bundle) === true) {
        return app.label
      }
      const name = basename(holder.name)
      if (name !== '' && app.pattern.test(name)) return app.label
    }
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

/**
 * How long a **process-list** reading stays good, and why it is derived rather
 * than chosen.
 *
 * It used to be a bare `15_000` against an `ARM_POLL_MS` of `20_000`, and this
 * class's own docblock claimed the cache "damps" the poll. It cannot: 20 000 is
 * greater than 15 000, so **every single poll missed**, and the twenty-third
 * review round measured the consequence over a simulated eleven-hour day —
 * *874 ticks, 874 process-list spawns, 0 cache hits*. On Windows that is
 * `tasklist` plus a conhost spawn, 100–400 ms each, every twenty seconds,
 * defeating timer coalescing on a laptop.
 *
 * Two numbers that must hold a relationship, written independently in two
 * files, drifted the moment one of them moved. So the relationship is the
 * declaration now: a multiple of the interval this is *asked* at, which cannot
 * be wrong by arithmetic. Three is the smallest multiple that makes the cache
 * do anything at all, and « is a conferencing app installed and open » changes
 * on the scale of a rep's morning, not of a poll.
 */
export const PROCESS_TTL_MS = 3 * ARM_POLL_MS

export interface MeetingAppsOptions {
  platform?: string
  runner?: Runner
  clock?: () => number
  /** How long a process-list reading stays good. Defaults to `PROCESS_TTL_MS`. */
  ttlMs?: number
  /**
   * Reads which processes hold a microphone. Injected rather than imported so
   * this class never loads the native module — and so a test can drive the
   * strong signal without one.
   *
   * `undefined` (an older binary, or a platform with no implementation) means
   * the strong signal is simply unavailable, and everything degrades to the
   * process list exactly as it behaved before this existed.
   */
  micHolders?: () => MicApp[]
}

/** What the two questions answer, sampled together. */
export interface MeetingSignal {
  /** A conferencing application is running. Weak: it may have been open all day. */
  running: string | null
  /**
   * A conferencing application is holding a microphone — a call is happening
   * now. `null` also covers « we could not ask », which is why nothing reports
   * its absence as a fault (DEC-45).
   */
  inCall: string | null
}

const NOTHING: MeetingSignal = Object.freeze({ running: null, inCall: null })

/**
 * Cached, because arming re-evaluates on every calendar tick and shelling out to
 * `ps` on each one is a process spawn for an answer that changes on the scale of
 * minutes.
 *
 * The microphone reading is **not** cached. It is an in-process property read —
 * measured at 3.4 ms against 8.6 ms for a `ps` spawn on the same machine, and
 * the `ps` figure is understated because those spawns were concurrent — and it
 * is the half that changes from second to second. Caching the signal that has
 * to be fresh, to save a third of a millisecond, would be the wrong half.
 */
export class MeetingApps {
  #platform: string
  #runner: Runner
  #clock: () => number
  #ttl: number
  #micHolders: (() => MicApp[]) | null
  #running: string | null = null
  #inCall: string | null = null
  #readAt = -Infinity
  #inFlight: Promise<string | null> | null = null

  constructor(options: MeetingAppsOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#runner = options.runner ?? run
    this.#clock = options.clock ?? Date.now
    this.#ttl = options.ttlMs ?? PROCESS_TTL_MS
    this.#micHolders = options.micHolders ?? null
  }

  /** The last reading, without spawning anything. */
  current(): MeetingSignal {
    return { running: this.#running, inCall: this.#inCall }
  }

  /**
   * Sample both signals.
   *
   * `processList: false` skips the **weak** half entirely, and that is a cost
   * decision rather than an optimisation. The process list is only ever the
   * second half of a conjunction whose first half is a calendar event, so with no
   * event in the window it is a `ps` — on Windows a `tasklist` plus a conhost
   * spawn, 100–400 ms — for an answer nothing can read. That is exactly the
   * configuration of the demo build DEC-28 calls the first deliverable, which now
   * runs an arming loop where it used to run none: without this, detecting
   * unscheduled calls would have *added* a process spawn a minute, all day, to
   * the one build that has no calendar to justify it.
   *
   * The microphone half is always read. It is the half that answers on its own.
   */
  async refresh(options: { processList?: boolean } = {}): Promise<MeetingSignal> {
    this.#inCall = this.#readMicHolders()
    if (options.processList === false) return this.current()
    if (this.#clock() - this.#readAt >= this.#ttl) {
      this.#inFlight ??= this.#read().finally(() => {
        this.#inFlight = null
      })
      await this.#inFlight
    }
    return this.current()
  }

  #readMicHolders(): string | null {
    if (!this.#micHolders) return null
    try {
      return matchMicHolder(this.#micHolders())
    } catch {
      // A binary without the export, or a HAL that refused. The weak signal
      // still stands and a rep can still start a meeting by hand (DEC-26).
      return null
    }
  }

  async #read(): Promise<string | null> {
    try {
      this.#running = matchMeetingApp(await listProcesses(this.#platform, this.#runner))
    } catch {
      // A locked-down machine where `ps` is unavailable, or a timeout. Reporting
      // "no meeting app" costs automatic arming and nothing else — the rep can
      // still start a meeting by hand, and DEC-26 says nothing downstream may
      // stop a meeting being recorded.
      this.#running = null
    }
    this.#readAt = this.#clock()
    return this.#running
  }
}

export { NOTHING as NO_MEETING_SIGNAL }
