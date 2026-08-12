/**
 * The two things that decide whether loading a model is safe, and the one that
 * decides when.
 *
 * The previous product had a four-way priority semaphore here, arbitrating
 * between Whisper, an embedder, a reranker and an intent classifier. Three of
 * those went with the RAG stack, so the priority half of the gate now arbitrates
 * between nothing. What is left is the part that still bites: **the two channels
 * load the same model at the same moment.** Rep and far end each spawn a worker
 * within milliseconds of each other, and two simultaneous ONNX loads of a
 * 500 MB–1.5 GB checkpoint double the peak resident set at exactly the point in
 * the meeting where a failure is least recoverable. So the gate is now a plain
 * mutex over the *load*, released as soon as the worker says `ready` — the two
 * inferences afterwards run concurrently, which is the whole point of having
 * two workers.
 */
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { modelSizeBytes } from './catalog.ts'

export interface SessionOptions {
  intraOpNumThreads: number
  interOpNumThreads: number
  executionMode: 'sequential' | 'parallel'
  enableCpuMemArena: boolean
  enableMemPattern: boolean
}

const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const boolEnv = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

/**
 * A quarter of the machine per worker.
 *
 * There are two of these — one per channel — so the pair claims about half the
 * cores, leaving the other half to the video call the meeting is happening on.
 * Letting ORT size its own pool is the failure in the other direction: it takes
 * every core, twice.
 *
 * The old value was a flat 1, which is what a four-way gate between Whisper and
 * three RAG models needed and is badly wrong for two Whisper workers. Measured
 * on an M1 Max, ten seconds of French: **5.3 s at one thread, 1.8 s at four.**
 * A single thread is 1.9× realtime with nothing else running, which sounds like
 * enough and is not — Whisper pads every input to a 30-second window, so the
 * cost is per utterance rather than per second, and a meeting produces them
 * faster than one core retires them.
 */
const defaultIntraOpThreads = (): number => {
  const cores = os.availableParallelism?.() ?? os.cpus().length ?? 4
  return Math.max(1, Math.min(4, Math.floor(cores / 4)))
}

/**
 * Thread-bounded session options, a fresh object per call — transformers
 * mutates the object it is handed, so sharing one across two sessions is a
 * cross-session bug waiting to happen.
 *
 * Inter-op stays at 1: the graph is a chain, so a second op-level thread buys
 * nothing and costs a pool. The arena is off because ORT's persistent BFCArena
 * is where the native aborts were observed.
 */
export const boundedSessionOptions = (): SessionOptions => ({
  intraOpNumThreads: intEnv('SILLAGE_ONNX_INTRA_OP_THREADS', defaultIntraOpThreads()),
  interOpNumThreads: intEnv('SILLAGE_ONNX_INTER_OP_THREADS', 1),
  executionMode: 'sequential',
  enableCpuMemArena: boolEnv('SILLAGE_ONNX_ENABLE_CPU_MEM_ARENA', false),
  enableMemPattern: boolEnv('SILLAGE_ONNX_ENABLE_MEM_PATTERN', false),
})

// ── Available memory ──────────────────────────────────────────────────────
//
// `os.freemem()` is the wrong number to gate on. macOS keeps the truly-free
// page list near zero on purpose — idle RAM is file cache, reclaimed on demand —
// so a healthy 32 GB Mac reports a few hundred MB free and a 2 GB floor refuses
// every load, always. What "available" means in Activity Monitor is
// free + reclaimable, and that is what has to be measured.

const CACHE_TTL_MS = 1_000
let cache: { reading: MemoryReading; at: number } | null = null

/** macOS: `vm_stat` → (free + inactive + speculative) × page size. */
const macAvailableGB = (): number | null => {
  // execFileSync, no shell: the argv is a fixed literal, so there is no
  // injection surface.
  const out = execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 1_000 })
  const pageSize = Number.parseInt(out.match(/page size of (\d+) bytes/)?.[1] ?? '4096', 10)
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null
  const pages = (label: string): number => {
    const m = out.match(new RegExp(`${label}:\\s+(\\d+)\\.`))
    return m?.[1] ? Number.parseInt(m[1], 10) : 0
  }
  const total = pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')
  return (total * pageSize) / 1024 ** 3
}

/** Linux: `MemAvailable` from /proc/meminfo, already the right metric. */
const linuxAvailableGB = (): number | null => {
  const meminfo = fs.readFileSync('/proc/meminfo', 'utf8')
  const raw = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m)?.[1]
  const kb = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(kb) ? (kb * 1024) / 1024 ** 3 : null
}

/**
 * What was measured, and whether it means anything.
 *
 * `probe` is a real available-memory reading — `vm_stat` on macOS,
 * `MemAvailable` on Linux, or a development override. `freemem` is the
 * fallback, and it is **not the same question**: `os.freemem()` counts pages on
 * the free list, which every modern OS keeps near zero on purpose. Measured on
 * a 64 GB Mac with 18.9 GB genuinely available, `os.freemem()` reported
 * 2.69 GB. A gate that cannot tell the two apart will refuse a machine that has
 * room and blame the machine.
 */
export interface MemoryReading {
  gb: number
  source: 'probe' | 'freemem'
  /** Why the probe was not used. Null when it was. */
  note: string | null
}

export const measureAvailableMemory = (): MemoryReading => {
  const override = Number.parseFloat(process.env.SILLAGE_ONNX_AVAILABLE_MEM_GB ?? '')
  if (Number.isFinite(override) && override >= 0) {
    return { gb: override, source: 'probe', note: null }
  }

  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.reading

  let gb: number | null = null
  let note: string | null = null
  try {
    if (process.platform === 'darwin') gb = macAvailableGB()
    else if (process.platform === 'linux') gb = linuxAvailableGB()
    else note = `pas de sonde mémoire sur ${process.platform}`
    if (gb !== null && !Number.isFinite(gb)) {
      gb = null
      note = 'sonde mémoire illisible'
    }
  } catch (error) {
    // Swallowed silently before, which made a failed probe and a real reading
    // produce the same number with nothing to tell them apart.
    gb = null
    note = error instanceof Error && error.message ? error.message : 'sonde mémoire en échec'
  }

  const reading: MemoryReading =
    gb === null
      ? { gb: os.freemem() / 1024 ** 3, source: 'freemem', note: note ?? 'sonde mémoire indisponible' }
      : { gb, source: 'probe', note: null }

  cache = { reading, at: now }
  return reading
}

export const availableMemoryGB = (): number => measureAvailableMemory().gb

/**
 * The runtime's own baseline, in GB — ORT, the tokenizer, the feature
 * extractor and the 30-second input window, none of which shrink with the
 * checkpoint. It is what the smallest models are dominated by: Tiny is 74 MB
 * of weights, so scaling alone would claim it loads in 180 MB.
 */
const RUNTIME_BASELINE_GB = 0.5

/**
 * Peak resident bytes per byte of checkpoint, during the load.
 *
 * One measurement, and it is the only one this rests on: two concurrent loads
 * of Small — 466 MB of weights — peaked at 2.1 GB (see `prewarmLocalEngine` in
 * `app/main.ts`), so a single load costs about 1.05 GB, or 2.3× the file.
 * Rounded up.
 */
const LOAD_FACTOR = 2.5

/**
 * How much *available* RAM loading this checkpoint needs.
 *
 * It was a flat 2.0 GB for every model, which was wrong in both directions and
 * only ever complained about in one. Whisper Tiny is 74 MB and loads in a few
 * hundred MB; the flat floor refused it on any machine that could not also have
 * run Medium, and told the rep « moins de 2 Go disponibles » with no way to say
 * *of what* — a real one read it as disk space and went to check a drive with
 * 400 GB free on it. The quiet half is worse: Medium is 1530 MB of weights and
 * wants something closer to 3.7 GB, which the flat floor waved through at 2.0 —
 * and an ONNX session that cannot allocate does not fail politely, it takes the
 * process with it.
 *
 * An unknown id keeps the old flat 2.0: a checkpoint this file has never heard
 * of is exactly where a guess should be conservative.
 */
export const requiredMemoryGB = (modelId?: string): number => {
  const override = Number.parseFloat(process.env.SILLAGE_ONNX_MIN_FREE_GB ?? '')
  if (Number.isFinite(override) && override >= 0) return override

  const bytes = modelId ? modelSizeBytes(modelId) : 0
  if (bytes <= 0) return 2.0
  const scaled = (bytes * LOAD_FACTOR) / 1024 ** 3
  return Math.max(RUNTIME_BASELINE_GB, Math.round(scaled * 10) / 10)
}

export interface MemoryVerdict {
  ok: boolean
  requiredGB: number
  totalGB: number
  reading: MemoryReading
}

/**
 * Whether this checkpoint may be loaded, and everything the answer rested on.
 *
 * ## The fallback is not allowed to refuse
 *
 * When there is no probe, the old code compared `os.freemem()` against the
 * floor and refused on the result, reasoning that under-reporting "errs toward
 * refusing, which is the safe direction". It is not the safe direction. This
 * gate protects the *default* transcription path (DEC-30) — the one DEC-26
 * leans on precisely because it needs nothing but the machine. Refusing it on a
 * number the code itself documents as wrong turns a laptop with 30 GB free into
 * a laptop that cannot transcribe, and says « moins de 2 Go disponibles » while
 * doing it.
 *
 * **Windows reaches this path on every single launch** — there is no probe for
 * it, and it is the primary platform (HR-2). So the fallback answers the only
 * question `os.freemem()` can support: not "is the machine busy right now",
 * which it cannot see, but "could this machine ever hold this model", which
 * `os.totalmem()` answers exactly. A transient free-page count never refuses;
 * a 4 GB laptop asked for Whisper Medium still does.
 *
 * Fails *open* when the measurement itself throws: refusing to transcribe
 * because `vm_stat` was unavailable would be a failure caused entirely by the
 * safety check.
 */
/**
 * The rule itself, with nothing to measure — so it is testable on a host whose
 * platform and free pages are whatever they happen to be.
 */
export const memoryDecision = (
  reading: MemoryReading,
  requiredGB: number,
  totalGB: number,
): boolean =>
  reading.source === 'probe'
    ? reading.gb >= requiredGB
    : totalGB >= requiredGB + RUNTIME_BASELINE_GB

export const memoryVerdict = (modelId?: string): MemoryVerdict => {
  const requiredGB = requiredMemoryGB(modelId)
  const totalGB = os.totalmem() / 1024 ** 3
  let reading: MemoryReading
  try {
    reading = measureAvailableMemory()
  } catch {
    return { ok: true, requiredGB, totalGB, reading: { gb: totalGB, source: 'freemem', note: null } }
  }
  return { ok: memoryDecision(reading, requiredGB, totalGB), requiredGB, totalGB, reading }
}

export const hasEnoughMemory = (modelId?: string): boolean => memoryVerdict(modelId).ok

// ── The load mutex ────────────────────────────────────────────────────────

let held = false
const waiting: Array<() => void> = []

/**
 * Serialises model loads process-wide. Returns the release function, which is
 * idempotent — it is called from `ready`, from `error` and from `exit`, and at
 * most one of those is the real one.
 */
export const acquireLoadSlot = async (): Promise<() => void> => {
  while (held) await new Promise<void>((resolve) => waiting.push(resolve))
  held = true

  let released = false
  return () => {
    if (released) return
    released = true
    held = false
    waiting.shift()?.()
  }
}

/** Tests only. The mutex is process-wide and deliberately sticky otherwise. */
export const __resetLoadSlotForTests = (): void => {
  held = false
  waiting.length = 0
}
