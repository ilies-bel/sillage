/**
 * The capture path, tested against the source.
 *
 * These replace five of the tests deferred at demolition
 * (`CaptureRestartRegression`, `CaptureStopAwaitable`,
 * `MicrophoneCapturePreWarmFailed`, `PreWarmGatedAfterTeardown`,
 * `SystemAudioOrphanHandleOnStartFailure`). Those loaded their subject from
 * `dist-electron/`, so they were only ever as current as the last build; these
 * import the `.ts` and run under plain `node`, with a fake binary injected at
 * the one seam the loader exposes.
 *
 * Everything asserted here is in `docs/reference/capture-invariants.md`, and
 * every one of them was a bug before it was an invariant.
 */
import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { CaptureSession } from '../index.ts'
import { MicrophoneCapture, __resetNativeClass as resetMic } from '../MicrophoneCapture.ts'
import { SystemAudioCapture, __resetNativeClass as resetSystem } from '../SystemAudioCapture.ts'
import {
  loadFrom,
  setNativeModuleForTests,
  resetNativeModuleCache,
  type NativeAudioModule,
  type NativeCapture,
} from '../nativeModule.ts'
import type { AudioFrame } from '../index.ts'

/** Lets the deferred `setImmediate` teardown bodies run. */
const settle = () => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)))

interface Trace {
  events: string[]
  constructed: { mic: number; system: number }
  live: FakeCapture[]
  /** Once mic constructions exceed this, the fake constructor throws. */
  failMicConstructAfter: number | null
}

class FakeCapture implements NativeCapture {
  stopped = false
  started = false
  onData: ((err: Error | null, chunk: Buffer) => void) | null = null
  // Written out rather than declared as constructor parameter properties:
  // Node's type stripping is strip-only, so `constructor(private x: T)` — which
  // has runtime meaning — is a syntax error. Same reason there are no enums or
  // namespaces anywhere in this tree.
  trace: Trace
  label: string
  failStart: boolean

  constructor(trace: Trace, label: string, failStart = false) {
    this.trace = trace
    this.label = label
    this.failStart = failStart
    trace.events.push(`${label}:construct`)
    trace.live.push(this)
  }

  getSampleRate() {
    return 16000
  }

  start(onData: (err: Error | null, chunk: Buffer) => void) {
    if (this.failStart) {
      // The Rust constructor has already allocated platform handles by the time
      // start() throws — that is the whole point of the orphan-handle test.
      this.trace.events.push(`${this.label}:start-throw`)
      throw new Error('start failed')
    }
    this.started = true
    this.onData = onData
    this.trace.events.push(`${this.label}:start`)
  }

  stop() {
    this.stopped = true
    this.trace.events.push(`${this.label}:stop`)
  }
}

let trace: Trace

const install = (options: { micFailsStart?: boolean; systemFailsStart?: boolean } = {}) => {
  trace = {
    events: [],
    constructed: { mic: 0, system: 0 },
    live: [],
    failMicConstructAfter: null,
  }
  const module: NativeAudioModule = {
    getInputDevices: () => [],
    getOutputDevices: () => [],
    abiProbe: () => 'fake',
    MicrophoneCapture: class extends FakeCapture {
      constructor() {
        const n = ++trace.constructed.mic
        if (trace.failMicConstructAfter !== null && n > trace.failMicConstructAfter) {
          throw new Error('cpal busy')
        }
        super(trace, 'mic', options.micFailsStart)
      }
    } as unknown as NativeAudioModule['MicrophoneCapture'],
    SystemAudioCapture: class extends FakeCapture {
      constructor() {
        trace.constructed.system++
        super(trace, 'system', options.systemFailsStart)
      }
    } as unknown as NativeAudioModule['SystemAudioCapture'],
  }
  setNativeModuleForTests(module)
  // The capture classes memoise their native class on first start(). Clearing
  // that is what lets each test install a differently-behaved fake.
  resetMic()
  resetSystem()
  return module
}

beforeEach(() => {
  install()
})

// ── The loader ─────────────────────────────────────────────────────────────

test('a binary without abiProbe is rejected with an actionable reason', () => {
  const result = loadFrom({
    appPath: '/app',
    resourcesPath: null,
    isDev: true,
    load: () => ({
      getInputDevices: () => [],
      getOutputDevices: () => [],
      MicrophoneCapture: class {},
      SystemAudioCapture: class {},
    }),
  })
  assert.equal(result.ok, false)
  // The exact failure the audio-surface trim introduced: the old loader
  // hard-required getHardwareId, which no longer exists in the crate.
  assert.match(result.reason, /abiProbe/)
  assert.match(result.reason, /build:native/)
})

test('a stub that exports the names but cannot dlopen is rejected', () => {
  const result = loadFrom({
    appPath: '/app',
    resourcesPath: null,
    isDev: true,
    load: () => ({
      getInputDevices: () => [],
      getOutputDevices: () => [],
      MicrophoneCapture: class {},
      SystemAudioCapture: class {},
      abiProbe: () => {
        throw new Error('dlopen failed')
      },
    }),
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /asar stub/)
})

test('packaged looks in app.asar.unpacked first; dev looks there last', () => {
  const packaged = loadFrom({
    appPath: '/Applications/x.app/Contents/Resources/app.asar',
    resourcesPath: '/Applications/x.app/Contents/Resources',
    isDev: false,
    load: (p) => {
      throw new Error(p)
    },
  })
  assert.equal(packaged.ok, false)
  assert.match(packaged.attempts[0]?.path ?? '', /app\.asar\.unpacked/)

  const dev = loadFrom({
    appPath: '/repo',
    resourcesPath: '/resources',
    isDev: true,
    load: (p) => {
      throw new Error(p)
    },
  })
  assert.equal(dev.ok, false)
  assert.doesNotMatch(dev.attempts[0]?.path ?? '', /app\.asar\.unpacked/)
})

test('the loader reports every path it tried, so a failure is diagnosable', () => {
  const result = loadFrom({
    appPath: '/repo',
    resourcesPath: '/resources',
    isDev: false,
    load: (p) => {
      throw new Error(`nope: ${p}`)
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.attempts.length, 3)
  resetNativeModuleCache()
  install()
})

// ── Ordering ───────────────────────────────────────────────────────────────

test('the microphone opens before the system tap, and closes after it', async () => {
  const session = new CaptureSession()
  await session.start()

  assert.deepEqual(trace.events, ['mic:construct', 'mic:start', 'system:construct', 'system:start'])

  await session.stop()
  await settle()

  // Bluetooth: opening the mic negotiates HFP. Doing it while the output tap is
  // already bound collapses the *output* to 8 kHz narrowband for the whole
  // meeting, so the mic is first in and last out on every path.
  const order = trace.events.filter((e) => e.endsWith(':stop'))
  assert.deepEqual(order, ['system:stop', 'mic:stop'])
})

test('stop() resolves only once the platform handles are released', async () => {
  const session = new CaptureSession()
  await session.start()

  const live = trace.live.slice()
  await session.stop()

  // Not "the JS object says it stopped" — the native stop is deferred to
  // setImmediate, and awaiting stop() has to mean the handle is gone.
  for (const capture of live) assert.equal(capture.stopped, true)
  assert.equal(session.running, false)
})

test('stop() is idempotent and a second call joins the first', async () => {
  const session = new CaptureSession()
  await session.start()
  await Promise.all([session.stop(), session.stop(), session.stop()])
  await settle()
  assert.equal(trace.events.filter((e) => e === 'mic:stop').length, 1)
})

// ── Restart ────────────────────────────────────────────────────────────────

test('a restart constructs fresh native monitors, never reusing the stopped ones', async () => {
  const session = new CaptureSession()
  await session.start()
  await session.stop()
  await settle()

  const second = new CaptureSession()
  await second.start()

  // The second-meeting deadlock: the Rust stop() tears down the CoreAudio Tap,
  // and start()ing the same instance afterwards leaves it half-initialised —
  // "produced 0 chunks in 8s", then an STT handshake timeout.
  assert.equal(trace.constructed.system, 2)
  assert.ok(trace.constructed.mic >= 2)
  await second.stop()
  await settle()
})

test('a start that is superseded mid-flight does not leave devices open', async () => {
  const session = new CaptureSession()
  await session.start()

  const restarting = session.start()
  await session.stop()
  await restarting
  await settle()

  // The generation check is what makes this true: every step that resumes after
  // an await re-reads it, so work belonging to a superseded start stops there.
  assert.equal(session.running, false)
  for (const capture of trace.live) assert.equal(capture.stopped, true)
})

// ── Failure paths ──────────────────────────────────────────────────────────

test('a microphone that will not start is fatal, and leaves nothing running', async () => {
  install({ micFailsStart: true })
  const session = new CaptureSession()

  await assert.rejects(() => session.start())
  assert.equal(session.running, false)
  // The system tap was never opened: the rep's own half of the conversation is
  // the half the compte-rendu is written from.
  assert.equal(trace.constructed.system, 0)
})

test('a failed start stops the orphaned native handle rather than waiting for GC', async () => {
  install({ systemFailsStart: true })
  const capture = new SystemAudioCapture(null)
  const errors: unknown[] = []
  capture.on('error', (e: unknown) => errors.push(e))

  capture.start()
  await settle()

  // monitor.start() can throw after the Rust constructor has allocated the
  // CoreAudio Tap and spun up its DSP thread. Nulling the field and waiting for
  // GC leaves those handles held for seconds; the next start then races the
  // dying instance for the HAL property-listener lock and produces
  // "0 chunks in 8s".
  assert.equal(errors.length, 1)
  const orphan = trace.live.at(-1)
  assert.equal(orphan?.started, false)
  assert.equal(orphan?.stopped, true, 'the orphan was stopped, not left to GC')
})

test('pre-warm is gated: it never runs for a wrapper that never started', async () => {
  const mic = new MicrophoneCapture(null)
  await mic.stop()
  await settle()
  // Nothing was ever started, so there is no evidence the user will need a warm
  // instance — and re-opening the mic between meetings would light the macOS
  // indicator for nothing.
  assert.equal(trace.constructed.mic, 0)
})

test('destroy() disables pre-warm before tearing down', async () => {
  const mic = new MicrophoneCapture(null)
  mic.on('error', () => {})
  mic.start()
  const afterStart = trace.constructed.mic

  await mic.destroy()
  await settle()

  // Without the gate, the teardown promise's .then() reconstructs a fresh
  // native handle immediately after stop() — on app quit that means grabbing
  // the OS microphone for a process about to die.
  assert.equal(trace.constructed.mic, afterStart)
})

test('a pre-warm failure is emitted, not swallowed', async () => {
  const mic = new MicrophoneCapture(null)
  mic.on('error', () => {})
  mic.start()

  let failure: unknown = null
  mic.on('pre_warm_failed', (e: unknown) => {
    failure = e
  })

  // Break only the construction that the pre-warm attempts, not the one start()
  // already made.
  trace.failMicConstructAfter = trace.constructed.mic

  await mic.stop()
  await settle()

  // Buried in console output, this is invisible; as an event, the orchestrator
  // can say why the next start stalled the main thread on cpal init.
  assert.ok(failure instanceof Error)
  assert.match((failure as Error).message, /cpal busy/)
})

// ── Frames ─────────────────────────────────────────────────────────────────

test('frames carry the channel the hardware already knows', async () => {
  const session = new CaptureSession()
  const frames: AudioFrame[] = []
  session.on('frame', (f: AudioFrame) => frames.push(f))
  await session.start()

  for (const capture of trace.live) capture.onData?.(null, Buffer.from([1, 2, 3]))

  assert.deepEqual(
    frames.map((f) => f.channel),
    ['rep', 'far'],
  )
  assert.equal(frames[0]?.sampleRate, 16000)
  await session.stop()
  await settle()
})

test('a frame arriving after stop is dropped', async () => {
  const session = new CaptureSession()
  const frames: AudioFrame[] = []
  session.on('frame', (f: AudioFrame) => frames.push(f))
  await session.start()
  const live = trace.live.slice()

  await session.stop()
  // The native DSP thread outlives the JS-side stop by a tick. A late chunk
  // must not reach the transcript, or finalize() cannot see a clean audio-end.
  for (const capture of live) capture.onData?.(null, Buffer.from([9]))
  assert.deepEqual(frames, [])
})
