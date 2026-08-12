#!/usr/bin/env node
/**
 * Expire the development logs in `scratch/`.
 *
 *   node scripts/prune-logs.mjs
 *
 * Runs automatically before `npm run app:dev` (the `preapp:dev` hook), so the
 * directory maintains itself and nobody has to remember.
 *
 * **Why this exists.** `scratch/` is gitignored, so a stale log never reaches a
 * commit and the pressure to clean it up never arrives. The app's own
 * diagnostics already expire — `Diagnostics.purge()` runs at boot against
 * `DEFAULT_RETENTION.diagnosticsDays` (90) — but that covers the SQLite event
 * log, not the console capture a developer redirects to a file. Those are the
 * ones that accumulate silently.
 *
 * **Why age *and* count.** Age alone leaves a hundred files from one debugging
 * afternoon; count alone lets a single ancient log outlive its usefulness. The
 * pair bounds both dimensions.
 *
 * Retention is deliberately short. A dev log is worth something for as long as
 * you remember what you were doing when it was written, which is days, not
 * months — and unlike a meeting transcript (DEC-12, never retained; meeting
 * content, never auto-expired) nothing here is a record anyone relies on.
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = path.join(ROOT, 'scratch')

/**
 * Development overrides, not settings. DEC-34 forbids an env var being
 * *required* to run the app; this is a knob on a dev-only chore with a working
 * default, which is the case `process.env` is still for.
 */
const MAX_AGE_DAYS = Number(process.env.SILLAGE_DEV_LOG_DAYS ?? 7)
const MAX_FILES = Number(process.env.SILLAGE_DEV_LOG_KEEP ?? 20)
const DAY_MS = 86_400_000

/** How recently a log must have been written to be treated as still in use. */
const GRACE_MS = Number(process.env.SILLAGE_DEV_LOG_GRACE_MIN ?? 60) * 60_000

/** Only ever `*.log`, only ever directly inside `scratch/`. */
const isLog = (name) => name.endsWith('.log')

const prune = async () => {
  let names
  try {
    names = await readdir(SCRATCH)
  } catch (error) {
    // No scratch/ yet is the normal state of a fresh clone, not a failure.
    if (error.code === 'ENOENT') return
    throw error
  }

  const logs = []
  for (const name of names.filter(isLog)) {
    const file = path.join(SCRATCH, name)
    // Resolve before touching anything: a symlink pointing out of scratch/ is
    // the one way this could reach a file it has no business deleting.
    if (path.dirname(path.resolve(file)) !== SCRATCH) continue
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) continue
    logs.push({ file, name, mtimeMs: info.mtimeMs, size: info.size })
  }

  const now = Date.now()
  const cutoff = now - MAX_AGE_DAYS * DAY_MS
  logs.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest first

  /*
   * A log that is open and being appended to must survive both rules, and
   * "it is the newest file, so the count rule cannot reach it" is false: a dev
   * server that has been quiet for ten minutes ranks below anything written
   * since. Deleting it does not stop the writer — the fd stays valid — it just
   * unlinks the inode, so the process logs into a file nobody can find, which
   * is worse than not pruning at all. Anything touched inside the grace window
   * is therefore exempt from the count rule. The age rule needs no such guard:
   * a file younger than MAX_AGE_DAYS is never old enough to match it.
   */
  const active = now - GRACE_MS
  const doomed = logs.filter(
    (log, index) => log.mtimeMs < cutoff || (index >= MAX_FILES && log.mtimeMs < active),
  )
  if (doomed.length === 0) return

  let bytes = 0
  for (const log of doomed) {
    await unlink(log.file).catch(() => null)
    bytes += log.size
  }

  /*
   * Report what is left, not what the limit is: the grace window means a run
   * can legitimately finish above MAX_FILES, and a line claiming otherwise
   * would send the next reader looking for a bug that is not there.
   */
  const kept = logs.length - doomed.length
  const mb = (bytes / 1_048_576).toFixed(1)
  const over = kept > MAX_FILES ? ` (${kept - MAX_FILES} still in use, trimmed once idle)` : ''
  console.log(
    `[prune-logs] removed ${doomed.length} log(s), ${mb} MB — ${kept} kept${over}; ` +
      `expiring after ${MAX_AGE_DAYS} days or ${MAX_FILES} files`,
  )
}

prune().catch((error) => {
  // Never fail a dev server start over housekeeping.
  console.warn(`[prune-logs] skipped: ${error.message}`)
})
