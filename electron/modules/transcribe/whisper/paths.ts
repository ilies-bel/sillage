/**
 * Where the weights live and where the worker file is.
 *
 * Split the same way `modules/capture/nativeModule.ts` is, and for the same
 * reason: the candidate lists are pure functions so the packaging rules can be
 * tested without Electron, and the only impure part — asking Electron for
 * `userData` — happens on first call rather than at import. A module that
 * touches `app` on its import chain cannot be unit-tested at all, which is how
 * the previous transcription code ended up only testable against a build.
 */
import path from 'node:path'
import fs from 'node:fs'

export interface PathEnvironment {
  /** `app.getAppPath()`. The repo root in dev, the asar in a packaged build. */
  appPath: string
  /** `app.getPath('userData')`. */
  userData: string
  /** `process.resourcesPath`. Null when not packaged. */
  resourcesPath: string | null
  /** Injected so a test can decide what exists. */
  exists?: (candidate: string) => boolean
}

/**
 * Either the resolved paths, or a way to get them.
 *
 * The thunk form exists so an override can win *without* Electron being touched
 * at all: `electronPaths()` throws outside Electron, and both resolvers below
 * are reachable from `scripts/replay.mjs`, which runs in plain Node on purpose.
 * Passing `electronPaths` itself as the argument is the intended call.
 */
export type PathSource = PathEnvironment | (() => PathEnvironment)

const resolved = (source: PathSource): PathEnvironment =>
  typeof source === 'function' ? source() : source

const WORKER_RELATIVE = ['dist-electron', 'electron', 'modules', 'transcribe', 'whisper', 'worker.js']

/**
 * Unpacked first when packaged.
 *
 * `worker_threads` reads the entry file through Electron's patched `fs`, which
 * does see inside the asar — but a build that unpacks the worker (because it
 * pulled a native dependency along with it) leaves a stub in the archive, and a
 * stub loads without error and then does nothing. Preferring the unpacked copy
 * costs one `existsSync` and removes the ambiguity.
 */
export const workerCandidates = (env: PathEnvironment): string[] => {
  const packaged = env.resourcesPath
    ? [path.join(env.resourcesPath, 'app.asar.unpacked', ...WORKER_RELATIVE)]
    : []
  return [...packaged, path.join(env.appPath, ...WORKER_RELATIVE)]
}

/**
 * The first candidate that exists, or the last one.
 *
 * Returning the last rather than null is deliberate: `new Worker(path)` then
 * fails with the path in the message, which is the thing someone debugging this
 * actually needs. Returning null would surface as "worker introuvable" with no
 * indication of where it was looked for.
 */
export const resolveWorkerPath = (source: PathSource): string => {
  const override = process.env.SILLAGE_WHISPER_WORKER?.trim()
  if (override) return override

  const env = resolved(source)
  const exists = env.exists ?? fs.existsSync
  const candidates = workerCandidates(env)
  return candidates.find(exists) ?? candidates[candidates.length - 1] ?? ''
}

const MODELS_DIRNAME = 'whisper-models'

/**
 * Where a bundled checkpoint sits, in preference order.
 *
 * The default model ships **inside the installer** — the deployment this is
 * built for sits behind a VPN that may block huggingface.co outright, and a
 * local engine that needs the network to start is not a local engine. Packaged,
 * that is `resources/whisper-models/`; in dev it is the same directory in the
 * repo, filled by `scripts/fetch-whisper-model.mjs`.
 *
 * `userData` stays last and stays writable: it is where a model fetched *after*
 * install would land, and where a machine that already has one keeps it.
 */
export const modelsDirCandidates = (env: PathEnvironment): string[] => {
  const packaged = env.resourcesPath ? [path.join(env.resourcesPath, MODELS_DIRNAME)] : []
  return [...packaged, path.join(env.appPath, 'resources', MODELS_DIRNAME), path.join(env.userData, MODELS_DIRNAME)]
}

/**
 * The first candidate that holds **the checkpoint asked for**, else the writable one.
 *
 * This used to test « holds anything », and the docblock explaining why named
 * the exact hazard it then failed to avoid: « not point at an empty bundled
 * directory when the real cache is in `userData` ». In a packaged build the
 * bundled directory is never empty — it ships the default model — so it always
 * won, and a model downloaded *after* install landed in `userData` where nothing
 * ever looked. With `allowRemoteModels: false` the load then failed and told the
 * rep to download the thing they had just downloaded.
 *
 * `holds` is supplied by the caller rather than imported, so this file stays
 * free of the catalog and the dtype: the caller is the one that knows which
 * checkpoint it wants and at which quantization, and `isModelCached` already
 * answers that question properly. With no predicate it degrades to the old
 * « holds anything », which is right for a caller that has no model in hand.
 *
 * The fallback stays the **writable** candidate, so a download lands where the
 * next resolve will look for it.
 */
export const resolveModelsDir = (
  source: PathSource,
  holds?: (dir: string) => boolean,
): string => {
  const override = process.env.SILLAGE_WHISPER_MODELS_DIR?.trim()
  if (override) return override

  const env = resolved(source)
  const exists = env.exists ?? fs.existsSync
  const candidates = modelsDirCandidates(env)
  const writable = candidates[candidates.length - 1] ?? path.join(env.userData, MODELS_DIRNAME)
  /*
   * With a checkpoint in hand the fallback is the **writable** directory and not
   * « the first that exists »: falling back to the latter is the old rule, which
   * is what pointed the engine at a packaged `resources/` that has some *other*
   * model in it. « Nobody has it » and « put it here » are the same answer.
   */
  if (holds) return candidates.find((dir) => exists(dir) && holds(dir)) ?? writable
  return candidates.find(exists) ?? writable
}

let cached: PathEnvironment | null = null

/**
 * Resolves the Electron paths once, on first use. Throws with a stated reason
 * rather than returning a half-answer — every caller is inside `start()`, where
 * the failure becomes `ConnectorHealth` with a message the rep can act on.
 */
export const electronPaths = (): PathEnvironment => {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron')
  cached = {
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    resourcesPath: process.resourcesPath ?? null,
  }
  return cached
}

/** Tests only. */
export const __resetPathCacheForTests = (): void => {
  cached = null
}
