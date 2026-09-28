/**
 * **What the crash-loop sentinel says about a load that did not crash.**
 *
 * `whisper.test.ts` owns the record's own arithmetic — written, read, consumed
 * once, scoped to a model. This file owns the other half, which had none: who
 * takes the record *off* the disk, and what the next launch is told when nobody
 * does.
 *
 * The mechanism's whole premise is stated in `sentinel.ts`: « ONNX Runtime can
 * abort the *process*, natively — no exception, no `exit` event, nothing
 * JavaScript can catch and remember », so « finding one at the next attempt
 * means the previous process died loading that model ». Everything below is a
 * load that JavaScript *did* catch and could have remembered, which is the
 * complement of that premise and therefore not a crash.
 *
 * Two of them, both reachable by a rep on the default path (DEC-30 — local
 * transcription is the default, not the fallback):
 *
 *   · **The worker reported the failure itself.** No model on disk with
 *     `allowRemoteModels: false`, a checkpoint whose files are half-downloaded,
 *     a dtype the machine cannot build a session for. The worker is alive, it
 *     posts `{type: 'error'}` with no `taskId`, `explainLoadFailure` turns it
 *     into the sentence the rep reads, and the meeting carries on without the
 *     offline floor. Measured before the fix: the record stayed, so the *next*
 *     launch was refused as well — and refused with a different sentence, one
 *     saying the previous process had died. The rep loses two launches instead
 *     of one and the second one is a lie about their machine.
 *
 *   · **This process gave the load up.** `#teardown` posts `shutdown`, drops
 *     every listener and terminates — its own docblock names « a meeting that
 *     ends before a cold model has finished loading » as the case it is written
 *     for, and `whisper-small` is tens of seconds cold. Dropping the `exit`
 *     listener is what that teardown *has* to do; it is also what threw away the
 *     one clear the record had.
 *
 * Neither test can be written against the pooled engine a meeting really uses —
 * `acquireEngine` returns an unpooled instance whenever a `spawn` is injected,
 * deliberately, so a fake worker cannot leak into the next test. What they drive
 * is `WhisperEngine`'s own lifecycle, which is where both clears live.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireEngine } from '../whisper/engine.ts'
import type { WorkerLike } from '../LocalWhisperSession.ts'
import { readSentinel, claimLoad } from '../whisper/sentinel.ts'
import { __resetLoadSlotForTests } from '../whisper/onnx.ts'

// The memory gate shells out to `vm_stat`; pin it so these are about the record.
process.env.SILLAGE_ONNX_AVAILABLE_MEM_GB = '64'
// And the sentinel is the subject here, so it must be on whatever ran before.
delete process.env.SILLAGE_ONNX_SENTINEL_DISABLED

const MODEL = 'Xenova/whisper-small'

class FakeWorker extends EventEmitter implements WorkerLike {
  terminated = false
  /*
   * `shutdown` is answered with an `exit`, which is what a real worker does and
   * what keeps this file fast: `#teardown` waits `SHUTDOWN_GRACE_MS` (ten
   * seconds) for that event before reaching for `terminate()`. It cannot clear
   * the record by accident — the teardown drops the `exit` listener that does
   * the clearing before it attaches its own.
   */
  postMessage(message: unknown): void {
    if ((message as { type?: string } | null)?.type === 'shutdown') {
      this.left = true
      setImmediate(() => this.emit('exit', 0))
    }
  }
  terminate(): number {
    this.terminated = true
    return 0
  }
  /** Whether `shutdown` was posted — the polite half of the teardown. */
  left = false
  /** The worker's own report: an error with no `taskId` failed the load. */
  failLoad(message: string): void {
    this.emit('message', { type: 'error', message })
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const loading = async (): Promise<{
  dir: string
  worker: FakeWorker
  engine: ReturnType<typeof acquireEngine>
  done: Promise<void>
}> => {
  __resetLoadSlotForTests()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-sentinel-'))
  const worker = new FakeWorker()
  const engine = acquireEngine({
    model: MODEL,
    modelsDir: '/models',
    workerPath: '/worker.js',
    stateDir: dir,
    spawn: () => worker,
  })
  // Swallowed here: what the holder does with the rejection is its own file's
  // subject (`localWhisper.test.ts`), and an unhandled one would fail the run
  // for a reason that is not this one.
  const done = engine.retain().then(
    () => {},
    () => {},
  )
  await tick()
  // The record exists *while* the load is in flight — that is the mechanism
  // working, and asserting it here is what stops these two tests from passing
  // because nothing was ever written.
  assert.equal(readSentinel(dir)?.modelId, MODEL, 'the load claimed the model')
  return { dir, worker, engine, done }
}

test('a load the worker itself reported as failed is not a crash the next launch pays for', async () => {
  const { dir, worker, done } = await loading()

  worker.failLoad('no file found for Xenova/whisper-small')
  await done
  await tick()

  assert.equal(
    readSentinel(dir),
    null,
    'the worker said so out loud — there is nothing for the next process to discover',
  )
  assert.deepEqual(
    claimLoad(dir, MODEL),
    { ok: true },
    'the next launch is refused over a failure that was already reported',
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a load the app quit on top of is not a crash the next launch pays for', async () => {
  const { dir, engine } = await loading()

  /*
   * What `before-quit` calls, pool-wide. It is reached here on the instance
   * because `acquireEngine` keeps a `spawn` override out of the pool on purpose;
   * that the quit handler really calls it is proved by the end-to-end run, which
   * used to leave a record in `resources/whisper-models/` after every single
   * launch, green ones included.
   */
  engine.abandonLoad()

  assert.equal(readSentinel(dir), null, 'the app said it was leaving — nothing died')
  assert.deepEqual(
    claimLoad(dir, MODEL),
    { ok: true },
    'the next launch is refused over the last one being closed',
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a load this process gave up on is not a crash the next launch pays for', async () => {
  const { dir, engine, worker } = await loading()

  // The meeting ended, or the holder went away, before the model was loaded.
  await engine.release()
  await tick()

  assert.equal(worker.left, true, 'the worker was asked to leave')
  assert.equal(
    readSentinel(dir),
    null,
    'this process stopped loading on purpose — nothing died',
  )
  assert.deepEqual(
    claimLoad(dir, MODEL),
    { ok: true },
    'the next launch is refused over a load nobody was still waiting for',
  )
  fs.rmSync(dir, { recursive: true, force: true })
})
