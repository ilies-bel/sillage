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
let cache: { gb: number; at: number } | null = null

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

export const availableMemoryGB = (): number => {
  const override = Number.parseFloat(process.env.SILLAGE_ONNX_AVAILABLE_MEM_GB ?? '')
  if (Number.isFinite(override) && override >= 0) return override

  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.gb

  let gb: number | null = null
  try {
    if (process.platform === 'darwin') gb = macAvailableGB()
    else if (process.platform === 'linux') gb = linuxAvailableGB()
  } catch {
    gb = null
  }
  // Windows' `os.freemem()` is already close to "available"; elsewhere this is
  // only reached when the real probe failed, and it under-reports — so the gate
  // errs toward refusing, which is the safe direction.
  if (gb === null || !Number.isFinite(gb)) gb = os.freemem() / 1024 ** 3

  cache = { gb, at: now }
  return gb
}

export const minFreeGB = (): number => {
  const n = Number.parseFloat(process.env.SILLAGE_ONNX_MIN_FREE_GB ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 2.0
}

/**
 * Fails *open* when the measurement itself throws. Refusing to transcribe
 * because `vm_stat` was unavailable would be a failure caused entirely by the
 * safety check.
 */
export const hasEnoughMemory = (): boolean => {
  try {
    return availableMemoryGB() >= minFreeGB()
  } catch {
    return true
  }
}

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
