/**
 * Crash-loop protection for the model load.
 *
 * ONNX Runtime can abort the *process*, natively, while loading a checkpoint —
 * no exception, no `exit` event, nothing JavaScript can catch and remember. The
 * app relaunches, loads the same model, and aborts again. That is the failure
 * mode this file exists for, and it is worth the disk write precisely because
 * it is the one class of failure that no in-memory handler can survive.
 *
 * A file is written before the worker is spawned and removed when it says
 * `ready`. Finding one at the next attempt means the previous process died
 * loading that model, so it is refused *once* and the record cleared — crashes
 * forever becomes crashes at most once. The TTL is short and the record is a
 * cooldown, not a ban: a force-quit mid-load is indistinguishable from a real
 * abort, and permanently disabling the offline floor over an ambiguous signal
 * would be the worse error.
 *
 * Every operation fails open. A read-only directory costs one launch's worth of
 * protection; it must never cost the ability to transcribe.
 */
import fs from 'node:fs'
import path from 'node:path'

export const SENTINEL_TTL_MS = 5 * 60 * 1000

export interface LoadSentinel {
  modelId: string
  startedAt: number
  attempt: number
}

const enabled = (): boolean => process.env.SILLAGE_ONNX_SENTINEL_DISABLED !== '1'

const sentinelPath = (dir: string): string => path.join(dir, 'whisper-load-sentinel.json')

export const readSentinel = (dir: string): LoadSentinel | null => {
  if (!enabled()) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(sentinelPath(dir), 'utf-8')) as Partial<LoadSentinel>
    if (
      typeof parsed.modelId === 'string' &&
      parsed.modelId.length > 0 &&
      typeof parsed.startedAt === 'number' &&
      typeof parsed.attempt === 'number'
    ) {
      return {
        modelId: parsed.modelId,
        startedAt: parsed.startedAt,
        attempt: Math.max(1, Math.floor(parsed.attempt)),
      }
    }
  } catch {
    // Absent, corrupt or unreadable are all "no record".
  }
  return null
}

/**
 * Written synchronously before `new Worker(...)`, so that a native abort during
 * load leaves the record behind. Atomic (tmp + rename) — a process killed
 * mid-write must not leave half a JSON document, which would read as corrupt
 * and therefore as no record at all, defeating the whole mechanism.
 */
export const writeSentinel = (dir: string, modelId: string, now: number = Date.now()): void => {
  if (!enabled()) return
  try {
    const previous = readSentinel(dir)
    const next: LoadSentinel = {
      modelId,
      startedAt: now,
      attempt: previous && previous.modelId === modelId ? previous.attempt + 1 : 1,
    }
    fs.mkdirSync(dir, { recursive: true })
    const target = sentinelPath(dir)
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(next), 'utf-8')
    fs.renameSync(`${target}.tmp`, target)
  } catch {
    // Fail open. See the header.
  }
}

/**
 * Cleared on `ready` and on a clean exit. Passing `modelId` makes it a no-op
 * when the record on disk belongs to a different model — the two channels load
 * concurrently, and the rep's worker becoming ready must not erase the record
 * of the far channel's still-in-progress load.
 */
export const clearSentinel = (dir: string, modelId?: string): void => {
  if (!enabled()) return
  try {
    if (modelId) {
      const current = readSentinel(dir)
      if (current && current.modelId !== modelId) return
    }
    fs.unlinkSync(sentinelPath(dir))
  } catch {
    // Absence is the desired state.
  }
}

export const isWithinTtl = (sentinel: LoadSentinel, now: number = Date.now()): boolean =>
  now - sentinel.startedAt < SENTINEL_TTL_MS

/**
 * Take the load, or say why not.
 *
 * `{ ok: false }` means the previous process died loading this exact model
 * recently. The record is consumed on the way out, so the next attempt is
 * allowed through: the point is to survive the loop, not to give up on the
 * model.
 */
export const claimLoad = (
  dir: string,
  modelId: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: string } => {
  const previous = readSentinel(dir)
  if (previous && previous.modelId === modelId && isWithinTtl(previous, now)) {
    clearSentinel(dir)
    return {
      ok: false,
      reason:
        `le chargement du modèle local ${modelId} a fait échouer le processus précédent — ` +
        `chargement refusé une fois par sécurité, réessayez ou choisissez un autre modèle`,
    }
  }
  writeSentinel(dir, modelId, now)
  return { ok: true }
}
