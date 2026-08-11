/**
 * Loads the Rust audio binary.
 *
 * Rewritten from `electron/audio/nativeModuleLoader.ts` for two reasons, and the
 * first is a bug that would have failed the demo:
 *
 * 1. **The old loader could not load the trimmed binary at all.** It hard-required
 *    `getHardwareId` and `verifyGumroadKey` and used the former as its smoke
 *    test. Both went with `license.rs` in demolition 4/5, so `validateNativeModule`
 *    threw on every candidate path and `loadNativeModule()` returned null —
 *    silently, because the loader is designed to degrade rather than crash. The
 *    symptom would have been "no audio devices, no capture, no error anyone
 *    could act on".
 *
 * 2. Nothing here reaches for Electron or the settings store at import time, so
 *    `modules/capture/` is importable — and therefore testable — in plain
 *    `node`. The old one required `electron` and `services/SettingsManager`
 *    inside the load path, which is why every capture test loaded a compiled
 *    copy out of `dist-electron/` instead of the source.
 */
import path from 'node:path'

export interface AudioDeviceInfo {
  id: string
  name: string
}

export interface NativeCapture {
  getSampleRate(): number
  getNativeSampleRate?: () => number
  start(
    onData: (err: Error | null, chunk: Buffer) => void,
    onSpeechEnded?: (err: Error | null, ended: boolean) => void,
  ): void
  stop(): void
}

/**
 * The audio surface, and nothing else — this mirrors `native-module/src/lib.rs`
 * after the trim. If a name appears here that is not in the crate, the loader
 * will reject every binary; that is the failure mode this file exists to
 * prevent, so keep the two in step.
 */
export interface NativeAudioModule {
  getInputDevices(): AudioDeviceInfo[]
  getOutputDevices(): AudioDeviceInfo[]
  /** Drives the route-change watcher during a meeting. Optional: needs a rebuild. */
  getDefaultOutputDeviceId?: () => string
  /** Pure, HAL-free ABI probe. See `smokeTest` below for why it has to exist. */
  abiProbe?: () => string
  SystemAudioCapture: new (deviceId?: string | null) => NativeCapture
  MicrophoneCapture: new (deviceId?: string | null) => NativeCapture
}

const REQUIRED_METHODS = ['getInputDevices', 'getOutputDevices'] as const
const REQUIRED_CONSTRUCTORS = ['SystemAudioCapture', 'MicrophoneCapture'] as const

export class NativeModuleError extends Error {}

/**
 * Calls one cheap native function for real.
 *
 * The check above only proves the *names* are present, and that is exactly what
 * an asar stub provides: Electron's fs interceptor serves the JS `index.js`
 * shim from inside the sealed archive, which exports every name and can dlopen
 * none of them. Only a real call across the ABI tells the two apart.
 *
 * It has to be `abiProbe`. The obvious candidates all touch the audio
 * subsystem, and this runs before any meeting has started: on macOS,
 * `getInputDevices()` instantiates `cpal::default_host()` and registers the
 * process with the CoreAudio HAL, which lights the orange microphone-in-use
 * indicator in the menu bar for the lifetime of the process. The old loader
 * used `getHardwareId()` for precisely this reason — pure, no HAL — and that
 * function is gone. `abiProbe` replaces it.
 */
const smokeTest = (mod: NativeAudioModule): void => {
  if (typeof mod.abiProbe !== 'function') {
    throw new NativeModuleError(
      'binary predates the audio-surface trim (no abiProbe) — run `npm run build:native`',
    )
  }
  let result: unknown
  try {
    result = mod.abiProbe()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new NativeModuleError(
      `abiProbe threw (${message}) — likely loaded the asar stub instead of the real binary`,
    )
  }
  if (typeof result !== 'string' || result.length === 0) {
    throw new NativeModuleError(
      `abiProbe returned ${typeof result} — likely loaded the asar stub instead of the real binary`,
    )
  }
}

const validate = (mod: unknown): NativeAudioModule => {
  const candidate = mod as Record<string, unknown>
  for (const name of REQUIRED_METHODS) {
    if (typeof candidate?.[name] !== 'function') {
      throw new NativeModuleError(`missing method "${name}" (got ${typeof candidate?.[name]})`)
    }
  }
  for (const name of REQUIRED_CONSTRUCTORS) {
    if (typeof candidate?.[name] !== 'function') {
      throw new NativeModuleError(`missing constructor "${name}" (got ${typeof candidate?.[name]})`)
    }
  }
  const typed = mod as NativeAudioModule
  smokeTest(typed)
  return typed
}

/**
 * Maps platform+arch to the napi-rs binary name, as produced by `napi build`.
 */
export const binaryName = (platform = process.platform, arch = process.arch): string => {
  const map: Record<string, Record<string, string>> = {
    win32: {
      x64: 'index.win32-x64-msvc.node',
      ia32: 'index.win32-ia32-msvc.node',
      arm64: 'index.win32-arm64-msvc.node',
    },
    darwin: { x64: 'index.darwin-x64.node', arm64: 'index.darwin-arm64.node' },
    linux: { x64: 'index.linux-x64-gnu.node', arm64: 'index.linux-arm64-gnu.node' },
  }
  return map[platform]?.[arch] ?? `index.${platform}-${arch}.node`
}

export interface LoadEnvironment {
  appPath: string
  /** `process.resourcesPath`. Null when not packaged. */
  resourcesPath: string | null
  isDev: boolean
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  /** Injected so a test can supply a fake binary without a filesystem. */
  load?: (filePath: string) => unknown
  onAttempt?: (filePath: string, error: string) => void
}

/**
 * Candidate order matters and is not symmetric.
 *
 * Packaged: `app.asar.unpacked` **must** come first. `app.getAppPath()` returns
 * the sealed archive there, and requiring a path inside it gets you the stub.
 * Dev: the unpacked path never exists, and trying it first prints a
 * "Cannot find module" stack on every boot — alarming and meaningless.
 */
export const candidatePaths = (env: LoadEnvironment): string[] => {
  const binary = binaryName(env.platform ?? process.platform, env.arch ?? process.arch)
  const packaged = env.resourcesPath
    ? [path.join(env.resourcesPath, 'app.asar.unpacked', 'native-module', binary)]
    : []
  const dev = [
    path.join(env.appPath, 'native-module', binary),
    path.join(env.appPath, '..', 'native-module', binary),
  ]
  return env.isDev ? [...dev, ...packaged] : [...packaged, ...dev]
}

/**
 * Returns the module, or a stated reason it could not be loaded.
 *
 * Never throws and never returns a bare null: the caller publishes the reason as
 * `ConnectorHealth`, and DEC-26 requires that a disabled control always say why.
 */
export type LoadResult =
  | { ok: true; module: NativeAudioModule; path: string }
  | { ok: false; reason: string; attempts: Array<{ path: string; error: string }> }

export const loadFrom = (env: LoadEnvironment): LoadResult => {
  const load = env.load ?? ((filePath: string) => require(filePath))
  const attempts: Array<{ path: string; error: string }> = []

  for (const filePath of candidatePaths(env)) {
    try {
      const module = validate(load(filePath))
      return { ok: true, module, path: filePath }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      attempts.push({ path: filePath, error })
      env.onAttempt?.(filePath, error)
    }
  }

  // The last attempt is the most informative one: the earlier candidates
  // usually failed because the file is not there, while the last tends to carry
  // the real reason (wrong arch, asar stub, missing abiProbe).
  const last = attempts.at(-1)
  return {
    ok: false,
    reason: last ? `${last.error} (${attempts.length} paths tried)` : 'no candidate paths',
    attempts,
  }
}

let cached: LoadResult | null = null

/**
 * Process-wide, memoised. Resolves the Electron paths on first call rather than
 * at import, so importing `modules/capture/` costs nothing and needs no
 * Electron — the old loader ran on the static import chain, which is why the
 * capture tests could only ever run against a compiled bundle.
 */
export const loadNativeModule = (): LoadResult => {
  if (cached) return cached

  let appPath: string
  let isDev = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    appPath = app.getAppPath()
    isDev = process.env.NODE_ENV === 'development' && !app.isPackaged
  } catch (e) {
    cached = {
      ok: false,
      reason: `electron indisponible: ${e instanceof Error ? e.message : String(e)}`,
      attempts: [],
    }
    return cached
  }

  cached = loadFrom({
    appPath,
    resourcesPath: process.resourcesPath ?? null,
    isDev,
  })
  return cached
}

/** Tests only. The cache is process-wide and deliberately sticky otherwise. */
export const resetNativeModuleCache = (): void => {
  cached = null
}

/**
 * Tests only: installs a fake binary.
 *
 * This is the seam that lets the capture path be tested at all. The classes it
 * feeds — `MicrophoneCapture`, `SystemAudioCapture` — are the two files the
 * whole rebuild stayed in this repo for, and their invariants are ordering
 * rules that only show up under a real start/stop sequence. Testing them
 * against a compiled bundle, as the old suite did, meant they were only ever as
 * tested as the last `npm run build:electron`.
 */
export const setNativeModuleForTests = (module: NativeAudioModule): void => {
  cached = { ok: true, module, path: '<test>' }
}
