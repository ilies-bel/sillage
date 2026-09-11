/**
 * `CaptureSession` — both channels, one lifecycle.
 *
 * Speaker attribution is free from the hardware (VISION.md §5): the microphone
 * is the rep, the system loopback is everyone on the far end. There is no
 * diarization in v1 and there does not need to be.
 *
 * **This module has zero network dependencies** (DEC-26). It imports nothing
 * that can fail because a server is down, and nothing downstream may prevent a
 * meeting from being recorded. A rep on a train with no connection loses
 * nothing but timing.
 *
 * The ordering rules below are not stylistic. Each is in
 * `docs/reference/capture-invariants.md` because it was a bug first.
 */
import { EventEmitter } from 'node:events'
import type { Channel } from '../../core/contracts/transcript.ts'
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import { InputLevelWatch, rmsOfInt16, type InputLevel } from '../../core/domain/inputLevel.ts'
import { getDefaultCommunicationsDeviceId, getDefaultOutputDeviceId } from './AudioDevices.ts'
import { MicrophoneCapture } from './MicrophoneCapture.ts'
import { SystemAudioCapture } from './SystemAudioCapture.ts'
import { loadNativeModule } from './nativeModule.ts'
import { SystemAudioHealthClassifier } from './systemAudioHealthClassifier.ts'
import type { HealthEvent } from './systemAudioHealthClassifier.ts'

export { MicrophoneCapture } from './MicrophoneCapture.ts'
export { SystemAudioCapture } from './SystemAudioCapture.ts'
export { FileCapture, readWav, toMono } from './FileCapture.ts'
export type { FileCaptureOptions, FileCaptureSource, WavAudio } from './FileCapture.ts'
export * from './AudioDevices.ts'
export * from './nativeModule.ts'

export interface AudioFrame {
  channel: Channel
  chunk: Buffer
  /** The rate these bytes are at — canonical 16 kHz after the Rust resampler. */
  sampleRate: number
}

/**
 * At or below this, the microphone came off a narrowband link.
 *
 * HFP is 8 kHz, and 16 is the resampler's own target — a device that opens at
 * 16 has nothing left to give the DSP. Anything above it is a real wideband
 * microphone.
 */
const HFP_SAMPLE_RATE = 16_000

export interface CaptureOptions {
  micDeviceId?: string | null
  systemDeviceId?: string | null
  diagnostics?: DiagRecorder
  clock?: () => number
  /**
   * How often the watchdog asks « has this channel produced anything ». Four
   * seconds in production, so the classifier's twelve-second window is reached
   * with room; injectable because the alternative is a test that waits twelve
   * real seconds, and a check nobody runs is a check that does not exist.
   */
  tickMs?: number
  /**
   * The default output route, injected so a test can move it.
   *
   * Defaults to the real `AudioDevices` reader, which answers null on a binary
   * that predates the function — and null means « we cannot tell », which is
   * never reported as a change.
   */
  defaultOutputDeviceId?: () => string | null
  defaultCommunicationsDeviceId?: () => string | null
  /** The microphone's hardware rate, injected so a test needs no headset. */
  nativeSampleRate?: () => number
}

export interface CaptureSessionEvents {
  frame: (frame: AudioFrame) => void
  speechEnded: (channel: Channel) => void
  /**
   * Speech resumed on a channel that had gone quiet — the other half of
   * `speechEnded`, and the half DEC-16 cannot work without.
   *
   * The Rust suppressor only signals the speech→silence edge, so on its own
   * "no `speechEnded` for 75 seconds" is ambiguous: it is equally true of an
   * empty room and of somebody talking without pause. This edge disambiguates
   * it, and it is free — the suppressor already replaces a suppressed frame
   * with a zero-filled keepalive, so a frame that is not all zeros *is* speech.
   */
  speechStarted: (channel: Channel) => void
  /**
   * The channel's input level crossed into or out of the band where capture
   * forwards audio the transcriber will never see. Edges only, never per
   * frame — see `core/domain/inputLevel.ts` for what the band is and why it
   * cannot be entered by a quiet room.
   */
  level: (channel: Channel, level: InputLevel, peak: number) => void
  health: (health: ConnectorHealth) => void
  error: (channel: Channel, error: unknown) => void
}

/**
 * A keepalive frame, emitted by the Rust suppressor to keep a streaming API's
 * clock running through silence. Zero-filled by construction, so this is an
 * exact test rather than a threshold — the level decision was already made in
 * Rust and second-guessing it here would give two VADs that disagree.
 */
const isKeepalive = (chunk: Buffer): boolean => {
  for (let i = 0; i < chunk.length; i += 1) if (chunk[i] !== 0) return false
  return true
}

/**
 * What `app/` is allowed to depend on: a thing that produces frames.
 *
 * The devices are one implementation and `FileCapture` is another. Declaring the
 * port is what makes the second one a capture source rather than a cast — the
 * concrete class carries `#private` fields, so a structurally identical replay
 * would not be assignable to it and every call site would need `as never`. That
 * cast was already in the tests; a fixture is a poor reason to spread it.
 */
export interface CapturePort extends EventEmitter {
  readonly running: boolean
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * Peak amplitude per channel since the last call, for the in-call level
   * meter. Optional because it is a cosmetic read: `FileCapture` replays a wav
   * and has no meter to feed, and a replay fixture should not have to grow a
   * method to stay assignable to this port.
   */
  takeLevels?(): Record<Channel, number>
}

/**
 * Owns one meeting's audio. Constructed per meeting and never reused: the Rust
 * monitors tear down their platform handles on stop, and starting the same
 * instance again leaves the CoreAudio Tap half-initialised — the "second
 * meeting produces 0 chunks in 8s" failure.
 */
export class CaptureSession extends EventEmitter {
  #mic: MicrophoneCapture | null = null
  #system: SystemAudioCapture | null = null
  #options: CaptureOptions
  #diagnostics: DiagRecorder
  #clock: () => number
  #running = false
  /**
   * A stop in flight. Every entry point awaits it before starting, so a restart
   * that races a teardown cannot open a second handle on the same device.
   */
  #teardown: Promise<void> | null = null
  /**
   * Invalidates work that resumes after an await. Every step that yields
   * re-checks it — a start that was superseded while awaiting the previous
   * teardown must not go on to open devices for a meeting that already ended.
   */
  #generation = 0

  constructor(options: CaptureOptions = {}) {
    super()
    this.#options = options
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
  }

  /**
   * Per channel: is speech in progress? Absent until the first frame, which is
   * what makes the very first word emit an edge rather than being swallowed as
   * "already speaking".
   */
  #speaking = new Map<Channel, boolean>()

  /** Per channel: is the level high enough to be transcribed? */
  #levels = new Map<Channel, InputLevelWatch>()
  /** One per channel — see `#watch`. The two have opposite failures (DEC-45). */
  #health = new Map<Channel, SystemAudioHealthClassifier>()
  /** Feeds `watchdog-tick`, which is how a channel that produced *nothing* is noticed. */
  #tick: ReturnType<typeof setInterval> | null = null
  /** The default output route when the tap was opened, or null if unknowable. */
  #routeAtStart: string | null = null
  #routeChangeReported = false
  #reported = new Map<Channel, InputLevel>()

  /**
   * The silence→speech edge, emitted once per stretch rather than per frame,
   * and the input-level measurement that rides along with it.
   *
   * Deliberately does no work beyond arithmetic on a buffer already in hand:
   * this sits on the capture path, which may not acquire a dependency, an
   * allocation per frame, or a reason to fail (DEC-26). The amplitude is none
   * of those three — it is eighty multiply-adds over bytes that are already
   * here, which is the same argument that admits the zero test above it.
   */
  #onFrame(channel: Channel, chunk: Buffer, sampleRate: number): void {
    /*
     * The watchdog is fed **before** the keepalive guard, and that ordering is
     * the point. A keepalive is the tap saying « I am alive and there was
     * nothing » — which is exactly the state this is here to notice, and the
     * early return below is why `#measure` never ran for a channel that
     * produced no audio at all.
     */
    this.#watch(channel, { kind: 'chunk', chunk, nowMs: this.#clock() })

    if (isKeepalive(chunk)) return

    this.#measure(channel, chunk, sampleRate)

    if (this.#speaking.get(channel) === true) return
    this.#speaking.set(channel, true)
    this.emit('speechStarted', channel)
  }

  /**
   * Reports the *edges* of the verdict and nothing else.
   *
   * A meeting is thousands of frames and the answer changes at most twice, so
   * emitting per frame would put a rule about noticing something on the path
   * DEC-26 protects. The diagnostic quotes the measurement rather than a
   * grade: « niveau d'entrée très faible » with a number beside it is
   * actionable; « micro faible » sends someone to read this file.
   */
  #measure(channel: Channel, chunk: Buffer, sampleRate: number): void {
    let watch = this.#levels.get(channel)
    if (!watch) {
      watch = new InputLevelWatch()
      this.#levels.set(channel, watch)
    }

    const rate = sampleRate > 0 ? sampleRate : 16_000
    watch.push(rmsOfInt16(chunk), ((chunk.byteLength >> 1) / rate) * 1_000)

    const verdict = watch.verdict
    if (verdict === 'unknown' || this.#reported.get(channel) === verdict) return
    this.#reported.set(channel, verdict)

    this.emit('level', channel, verdict, watch.peak)
    this.#diagnostics.record({
      severity: verdict === 'tooQuiet' ? 'warn' : 'info',
      code: verdict === 'tooQuiet' ? 'capture.level.tooQuiet' : 'capture.level.ok',
      module: 'capture',
      origin: 'authored',
      message:
        verdict === 'tooQuiet'
          ? `niveau d’entrée trop faible pour être transcrit (crête ${watch.peak.toFixed(4)})`
          : `niveau d’entrée suffisant (crête ${watch.peak.toFixed(4)})`,
      detail: { channel, peak: Number(watch.peak.toFixed(4)) },
    })
  }

  /**
   * Peak amplitude per channel since the last call — the level meter's whole
   * data source, and deliberately a *pull*.
   *
   * A channel that has produced nothing since the last read returns 0, which is
   * the honest answer for both a silent room and a dead device. Telling those
   * two apart is what `verdict` is for; this is the sub-second needle.
   */
  takeLevels(): Record<Channel, number> {
    return {
      rep: this.#levels.get('rep')?.takeRecentPeak() ?? 0,
      far: this.#levels.get('far')?.takeRecentPeak() ?? 0,
    }
  }

  #onSpeechEnded(channel: Channel): void {
    this.#speaking.set(channel, false)
    this.emit('speechEnded', channel)
  }

  get running(): boolean {
    return this.#running
  }

  /** Whether the binary is loadable at all, with the reason when it is not. */
  static probe(): ConnectorHealth {
    const result = loadNativeModule()
    if (result.ok) return { state: 'ok' }
    return {
      state: 'down',
      reason: `module audio natif indisponible — ${result.reason}`,
      since: Date.now(),
      retryable: false,
    }
  }

  /**
   * Starts both channels, **microphone first, on every path**.
   *
   * The order is the invariant, not an accident. Opening the system loopback
   * first and the microphone second lets a Bluetooth headset negotiate HFP
   * "call mode" after the output tap is already bound, which collapses the
   * *output* to 8 kHz narrowband for the whole meeting. Mic first means the
   * profile is settled before the tap attaches.
   */
  async start(): Promise<void> {
    const generation = ++this.#generation

    if (this.#teardown) await this.#teardown
    // Re-checked after the await: the caller may have ended the meeting while
    // the previous teardown was draining.
    if (generation !== this.#generation) return
    if (this.#running) return

    this.#running = true

    /*
     * The watchdog tick, which is the **only** way a channel that produced
     * nothing at all is ever noticed: every other signal in this file is
     * derived from a frame, and a channel with no frames emits none. Four
     * seconds, so the classifier's twelve-second window is reached with room;
     * `unref` so it can never hold the process open (DEC-26 — nothing here may
     * outlive a meeting).
     */
    this.#health.clear()
    /*
     * The route the system tap was opened on, so a change can be noticed.
     *
     * `getDefaultOutputDeviceId` has existed, with a docblock saying « polled
     * during a meeting: when it changes, the system capture has to be rebuilt or
     * the tap keeps recording the old device — which is silence, not an error »,
     * and **nothing polled it**. Plugging in a headset mid-call, or Teams moving
     * itself to the communications device, silences the far channel for the rest
     * of the meeting.
     *
     * What this does is *say so*, not rebuild the tap. The watchdog below
     * already notices the silence four seconds later and reports it; what it
     * cannot do is say why, and « rien n'arrive de l'audio de votre ordinateur »
     * and « la sortie audio a changé pendant l'appel » lead a rep to two very
     * different actions. Restarting a live capture is a bigger promise than
     * this can keep on a platform it cannot be tested on from here.
     *
     * `null` where the binary predates the function, and the whole check is
     * then skipped — « we cannot tell » is not « it changed » (DEC-45).
     */
    this.#routeAtStart = this.#defaultOutputDeviceId()
    this.#routeChangeReported = false
    this.#tick = setInterval(() => {
      const nowMs = this.#clock()
      this.#checkOutputRoute()
      for (const channel of ['rep', 'far'] as const) this.#watch(channel, { kind: 'watchdog-tick', nowMs })
    }, this.#options.tickMs ?? 4_000)
    this.#tick.unref?.()

    const mic = new MicrophoneCapture(this.#options.micDeviceId ?? null)
    this.#mic = mic
    mic.on('data', (chunk: Buffer) => {
      const sampleRate = mic.getSampleRate()
      this.#onFrame('rep', chunk, sampleRate)
      this.emit('frame', { channel: 'rep', chunk, sampleRate })
    })
    mic.on('speech_ended', () => this.#onSpeechEnded('rep'))
    mic.on('error', (error: unknown) => this.#onError('rep', error))
    mic.on('pre_warm_failed', (error: unknown) =>
      this.#record('warn', 'capture.mic.preWarmFailed', error),
    )

    try {
      mic.start()
    } catch (error) {
      // A microphone that will not open is fatal to the meeting — the rep's own
      // half of the conversation is the half the compte-rendu is written from.
      this.#running = false
      this.#mic = null
      this.#onError('rep', error)
      throw error
    }

    /*
     * **The microphone's own hardware rate, which nothing had ever asked for.**
     *
     * `get_native_sample_rate` was written for this — « for diagnostics and
     * HFP/Bluetooth-degradation detection », in its own docblock — exposed as
     * `#[napi]`, wrapped in both TS capture classes, and called by nobody. So
     * nothing in the product detected the degradation it was written to detect.
     *
     * A Bluetooth headset that negotiates HFP « call mode » drops the microphone
     * to 8 kHz narrowband for the length of the meeting. The audio still
     * arrives, the meter still moves, and the transcript comes back materially
     * worse — a failure with no symptom a rep can see, which is the shape this
     * whole file exists to end. It is `degraded` and never `down` (DEC-32): the
     * meeting records and half of it is fine.
     *
     * `0` is « we could not tell » — an older binary, a device that answers
     * nothing — and is never reported (DEC-45). The threshold is the rate
     * itself: HFP is 8 kHz or 16, and the resampler's target is 16, so anything
     * at or below that came off a narrowband link.
     */
    const native = this.#nativeRateOf(mic)
    if (native > 0 && native <= HFP_SAMPLE_RATE) {
      this.emit('health', {
        state: 'degraded',
        reason:
          `Votre micro est en mode « communication » (${Math.round(native / 1000)}\u00a0kHz) — ` +
          'la transcription sera moins précise. Un casque Bluetooth fait cela ; un micro filaire ou ' +
          'les haut-parleurs l’évitent.',
        since: this.#clock(),
        retryable: true,
      } satisfies ConnectorHealth)
      this.#diagnostics.record({
        severity: 'warn',
        code: 'capture.rep.narrowband',
        module: 'capture',
        origin: 'authored',
        message: `micro ouvert à ${native}\u00a0Hz — lien bande étroite (HFP)`,
        detail: { nativeSampleRate: native },
      })
    }

    if (generation !== this.#generation) {
      await this.stop()
      return
    }

    const system = new SystemAudioCapture(this.#options.systemDeviceId ?? null)
    this.#system = system
    system.on('data', (chunk: Buffer) => {
      const sampleRate = system.getSampleRate()
      this.#onFrame('far', chunk, sampleRate)
      this.emit('frame', { channel: 'far', chunk, sampleRate })
    })
    system.on('speech_ended', () => this.#onSpeechEnded('far'))
    // The system channel degrades rather than throws: losing the far end costs
    // the prospect's words, and recording the rep alone is still worth having.
    system.on('error', (error: unknown) => this.#onError('far', error))
    system.start()

    this.emit('health', { state: 'ok' })
  }

  /**
   * Stops both channels and resolves once the platform handles are genuinely
   * released — not when the JS objects say they are stopped.
   *
   * The fields are nulled synchronously and the awaiting is threaded through
   * `#teardown`, so a `start()` arriving mid-stop joins the same teardown
   * instead of racing it for the device.
   */
  async stop(): Promise<void> {
    this.#generation++
    if (!this.#running && !this.#teardown) return this.#teardown ?? undefined
    this.#running = false

    if (this.#tick) clearInterval(this.#tick)
    this.#tick = null
    for (const classifier of this.#health.values()) {
      classifier.handle({ kind: 'capture-stopped' })
    }

    const mic = this.#mic
    const system = this.#system
    this.#mic = null
    this.#system = null

    const teardown = (async () => {
      // The rep's channel goes last, mirroring the start order: the system tap
      // must not outlive the mic and re-trigger the HFP negotiation on the way
      // out.
      await system?.destroy()
      mic?.disablePreWarm()
      await mic?.destroy()
    })()

    this.#teardown = teardown
    try {
      await teardown
    } finally {
      if (this.#teardown === teardown) this.#teardown = null
    }
    return undefined
  }

  /**
   * **Has this channel produced any audio at all?**
   *
   * `SystemAudioHealthClassifier` is 137 lines written for exactly this — a
   * 12-second no-chunk watchdog and a sustained-zero detector — and it was
   * constructed **only in its own test file**. Nothing in the product asked it
   * anything, so the one failure this whole product is built around could happen
   * in silence: on Windows the loopback taps the *multimedia* default while
   * Teams routes to the communications default (`speaker/windows.rs` documents
   * that hole itself), a route change mid-call leaves the tap on an endpoint
   * that is no longer playing, a mic is muted in hardware — and in every case
   * the channel yields nothing, `#measure` is never reached because `#onFrame`
   * returns early on keepalives, no `InputLevelWatch` is ever created, and
   * `capture.level.tooQuiet` can never fire. The header said « Tout fonctionne »
   * for the length of the call and the compte-rendu described a monologue.
   *
   * CLAUDE.md states this failure in the macOS-permission case and
   * `Onboarding.tsx` exists to prevent it. This is the same outcome on the
   * *primary* platform (HR-2), reachable through a Sound Settings checkbox
   * rather than a permission prompt.
   *
   * **Per channel, because the two have opposite fixes** (DEC-45): nothing on
   * `rep` is a microphone, nothing on `far` is the system tap, and the rep is
   * the only one who can tell which.
   *
   * `degraded`, never `down`: the meeting is being recorded and half of it is
   * arriving. DEC-32 reserves an app-level status change for a subsystem that
   * stops a meeting, and this one has not.
   */
  /**
   * Injected so a test can move the route without an audio device, and so the
   * native call is made lazily — `AudioDevices` documents why nothing in this
   * module may touch the native host at import time.
   */
  /** Injected so a test can move the rate without a Bluetooth headset. */
  #nativeRateOf(mic: MicrophoneCapture): number {
    const read = this.#options.nativeSampleRate
    try {
      return read ? read() : mic.getNativeSampleRate()
    } catch {
      return 0
    }
  }

  #defaultOutputDeviceId(): string | null {
    const read = this.#options.defaultOutputDeviceId ?? getDefaultOutputDeviceId
    try {
      return read()
    } catch {
      return null
    }
  }

  /**
   * **Why the system tap is hearing nothing, when it is this.**
   *
   * The loopback binds the *console* default and a call application renders to
   * the *communications* default, which Windows lets a rep set separately in one
   * checkbox. When they differ the tap records an endpoint nothing is playing to
   * and produces no chunks at all — which the watchdog already reports as « rien
   * n'arrive ». That sentence sends a rep to look at their microphone. This one
   * sends them to the checkbox that fixes it.
   *
   * Only ever *added* to a silence already being reported, and only when the two
   * ids are both known and differ: « we did not measure it » is never a finding
   * (DEC-45), and on macOS — which has no such role — the answer is always null.
   */
  #routeSplit(): boolean {
    const read = this.#options.defaultCommunicationsDeviceId ?? getDefaultCommunicationsDeviceId
    let communications: string | null
    try {
      communications = read()
    } catch {
      return false
    }
    const console_ = this.#defaultOutputDeviceId()
    return communications !== null && console_ !== null && communications !== console_
  }

  /**
   * The default output route changed while the tap was open.
   *
   * Said once per meeting: a rep who switches to headphones and back would
   * otherwise get the sentence twice, and the second one says nothing the first
   * did not. `degraded`, never `down` — the microphone is still arriving and the
   * meeting is still being recorded (DEC-32) — and it names the side, because
   * this one is only ever the system tap (DEC-45).
   */
  #checkOutputRoute(): void {
    if (this.#routeAtStart === null || this.#routeChangeReported) return
    const now = this.#defaultOutputDeviceId()
    if (now === null || now === this.#routeAtStart) return
    this.#routeChangeReported = true
    this.#diagnostics.record({
      severity: 'warn',
      code: 'capture.far.routeChanged',
      module: 'capture',
      message: 'la sortie audio par défaut a changé pendant que la capture système était ouverte',
      detail: {},
    })
    this.emit('health', {
      state: 'degraded',
      reason:
        'La sortie audio de l’ordinateur a changé pendant l’appel — le son du client peut ne plus être capté. Terminez et redémarrez l’enregistrement pour le reprendre.',
      since: this.#clock(),
      retryable: true,
    } satisfies ConnectorHealth)
  }

  #watch(channel: Channel, event: HealthEvent): void {
    let classifier = this.#health.get(channel)
    if (!classifier) {
      classifier = new SystemAudioHealthClassifier()
      classifier.handle({ kind: 'capture-started', nowMs: this.#clock() })
      this.#health.set(channel, classifier)
    }
    const outcome = classifier.handle(event)
    if (outcome.type === 'none') return

    const side = channel === 'rep' ? 'votre micro' : 'l’audio de votre ordinateur'
    // The same two, as the subject of a sentence rather than its object.
    const sideCap = channel === 'rep' ? 'Votre micro' : 'L’audio de votre ordinateur'
    if (outcome.type === 'log') {
      this.#diagnostics.record({
        severity: outcome.level,
        code: `capture.${channel}.${outcome.reason ?? 'silence'}`,
        module: 'capture',
        origin: 'authored',
        message: outcome.message,
        detail: { channel },
      })
      /*
       * A channel that has produced nothing at all is the case a rep has to be
       * told about while the call is still running, not after it — **and so is a
       * channel producing nothing but zeros.**
       *
       * The second was a log line and no more. Frames arrive, the tap is alive,
       * every sample is exactly zero: that is a microphone muted in hardware —
       * the switch on a headset, the OS mute — or a tap bound to a dead
       * endpoint. It is *not* a quiet room, which carries room tone, and the
       * meter cannot tell the rep apart from one: both draw a flat line. Two
       * minutes of it is a meeting being half recorded with nothing saying so,
       * which is the failure this whole file exists to end.
       */
      /*
       * **And the third: a channel that was arriving and stopped.**
       *
       * The watchdog used to be disarmed by the first chunk, so the case the
       * classifier's own header claims — a route change mid-call leaving the tap
       * on an endpoint no longer playing — was reported by nothing. A rep who
       * unplugs a USB headset twenty minutes into a call loses the far side for
       * the rest of it; on Windows there is no error channel from
       * `SystemAudioCapture` to say so either, so the silence *is* the signal.
       */
      if (
        outcome.reason === 'initial-silence-no-chunks' ||
        outcome.reason === 'sustained-zero-valued-silence' ||
        outcome.reason === 'stalled-mid-capture'
      ) {
        this.emit('health', {
          state: 'degraded',
          reason:
            outcome.reason === 'initial-silence-no-chunks'
              ? `Rien n’arrive depuis ${side} — ce côté de l’appel ne sera pas transcrit.${
                  channel === 'far' && this.#routeSplit()
                    ? ' Votre application d’appel utilise un autre périphérique de sortie que Windows : alignez les deux dans les paramètres de son.'
                    : ''
                }`
              : outcome.reason === 'sustained-zero-valued-silence'
                ? `${sideCap} est coupé : le signal est à zéro depuis le début de l’appel. Vérifiez le bouton « muet ».`
                : `${sideCap} s’est interrompu pendant l’appel — plus rien n’arrive. Vérifiez le périphérique audio.`,
          since: this.#clock(),
          retryable: true,
        } satisfies ConnectorHealth)
      }
      return
    }
  }

  #onError(channel: Channel, error: unknown): void {
    this.#record('error', `capture.${channel}.error`, error)
    this.emit('error', channel, error)
    this.emit('health', {
      state: 'degraded',
      reason:
        channel === 'rep'
          ? `micro indisponible — ${message(error)}`
          : `audio système indisponible — ${message(error)}`,
      since: (this.#options.clock ?? Date.now)(),
      retryable: true,
    })
  }

  #record(severity: 'warn' | 'error', code: string, error: unknown): void {
    this.#diagnostics.record({
      severity,
      code,
      module: 'capture',
      origin: 'foreign',
      message: message(error),
      detail: {},
    })
  }
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
