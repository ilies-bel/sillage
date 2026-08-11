/**
 * The four bugs the deleted `LocalModelDownloadService` documented.
 *
 * Its header listed them and its code fixed them; the code is gone and the
 * failures are not, because every one of them is the natural thing to write.
 * These tests are the fixes, restated as behaviour:
 *
 *  1. progress must not be bound to whoever asked for the download
 *  2. the in-flight set must not leak when a download ends any other way
 *  3. the state must be answerable after a panel remount
 *  4. `ready` must be a re-count of the disk, never the worker's word
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelDownloads, type DownloadWorkerLike } from '../ModelDownloads.ts'
import type { WorkerOut } from '../whisper/protocol.ts'

/** A worker whose messages the test fires by hand. */
class FakeWorker implements DownloadWorkerLike {
  messages: unknown[] = []
  terminated = 0
  #listeners = new Map<string, ((value: never) => void)[]>()

  on(event: 'message' | 'error' | 'exit', listener: (value: never) => void): void {
    const list = this.#listeners.get(event) ?? []
    list.push(listener)
    this.#listeners.set(event, list)
  }
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  terminate(): void {
    this.terminated += 1
  }

  emit(event: 'message' | 'error' | 'exit', value: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) (listener as (v: unknown) => void)(value)
  }
  say(message: WorkerOut): void {
    this.emit('message', message)
  }
}

const build = (cached: () => boolean) => {
  const changes: Array<{ id: string; status: string; progress: number }> = []
  let worker: FakeWorker | null = null
  const downloads = new ModelDownloads({
    modelsDir: '/tmp/models',
    dtype: 'q8',
    executionProviders: ['cpu'],
    spawn: () => (worker = new FakeWorker()),
    onChange: (id, activity) =>
      changes.push({ id, status: activity.status, progress: activity.progress }),
    cached,
  })
  return { downloads, changes, live: () => worker! }
}

test('the download starts a worker and asks it for the network (DEC-35b)', async () => {
  const { downloads, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')

  const init = live().messages[0] as { type: string; allowRemoteModels: boolean; cacheDir: string }
  assert.equal(init.type, 'init')
  // The one place in the product where this is true. Everywhere else — the
  // meeting path above all — it is false, because DEC-26 says a recording must
  // never turn into a download.
  assert.equal(init.allowRemoteModels, true)
  assert.equal(init.cacheDir, '/tmp/models')
})

test('a model already on disk is not downloaded again', async () => {
  const { downloads, changes } = build(() => true)
  await downloads.start('Xenova/whisper-medium')
  assert.deepEqual(changes.at(-1), {
    id: 'Xenova/whisper-medium',
    status: 'ready',
    progress: 100,
  })
})

test('bug 4: the worker saying ready is not enough — the disk is re-counted', async () => {
  // The shipped failure. `ready` arrives, the disk is short a file, and the old
  // implementation set "fully downloaded" anyway. ONNX Runtime then aborts at
  // load with a `file_size` error, mid-meeting, on the engine that exists to be
  // the one that cannot fail.
  const { downloads, changes, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')
  live().say({ type: 'ready' })

  const statuses = changes.map((change) => change.status)
  assert.ok(statuses.includes('verifying'), 'the disk check is never skipped')
  assert.equal(changes.at(-1)?.status, 'error')
})

test('the disk agreeing is what produces ready', async () => {
  let onDisk = false
  const { downloads, changes, live } = build(() => onDisk)
  await downloads.start('Xenova/whisper-medium')
  onDisk = true
  live().say({ type: 'ready' })

  assert.deepEqual(changes.at(-1), {
    id: 'Xenova/whisper-medium',
    status: 'ready',
    progress: 100,
  })
})

test('bug 2: a failed download can be started again', async () => {
  const { downloads, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')
  const first = live()
  first.emit('error', new Error('réseau injoignable'))

  // The old guard returned before the in-flight set could be cleared, so this
  // second call was a no-op until the app was relaunched.
  await downloads.start('Xenova/whisper-medium')
  assert.notEqual(live(), first, 'a second worker was spawned')
})

test('bug 3: the state is answerable at any moment, including mid-download', async () => {
  const { downloads, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')
  live().say({ type: 'progress', modelId: 'Xenova/whisper-medium', progress: 40 })

  // What a remounted settings panel asks for. Without it the old panel started
  // from empty state and showed a 0 % bar forever while bytes kept arriving.
  const state = downloads.state()['Xenova/whisper-medium']
  assert.equal(state?.status, 'downloading')
  assert.ok((state?.progress ?? 0) > 0)
})

test('cancelling stops the worker and does not report a failure', async () => {
  const { downloads, changes, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')
  const worker = live()
  await downloads.cancel('Xenova/whisper-medium')

  assert.equal(worker.terminated, 1)
  assert.equal(changes.at(-1)?.status, 'cancelled')

  // Terminating mid-fetch makes the worker's own request fail. Reporting that
  // as « échec du téléchargement » on a row the rep just cancelled is a lie
  // that sends them looking for a problem they created on purpose.
  worker.emit('error', new Error('aborted'))
  assert.equal(changes.at(-1)?.status, 'cancelled')
})

test('a worker that dies silently is a failure, not a success', async () => {
  const { downloads, changes, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')
  live().emit('exit', 1)
  assert.equal(changes.at(-1)?.status, 'error')
})

test('a restart turns an in-flight download into `interrupted`, not `error`', () => {
  const { downloads } = build(() => false)
  downloads.rehydrate({
    'Xenova/whisper-medium': { status: 'downloading', progress: 55, reason: null },
  })
  // Nothing went wrong, so the sentence the rep reads must not say it did.
  assert.equal(downloads.state()['Xenova/whisper-medium']?.status, 'interrupted')
})

test('a restart with the bytes on disk resolves to ready', () => {
  const { downloads } = build(() => true)
  downloads.rehydrate({
    'Xenova/whisper-medium': { status: 'downloading', progress: 55, reason: null },
  })
  assert.equal(downloads.state()['Xenova/whisper-medium']?.status, 'ready')
})

test('starting twice does not spawn two workers into one cache directory', async () => {
  const { downloads, live } = build(() => false)
  await downloads.start('Xenova/whisper-medium')
  const first = live()
  await downloads.start('Xenova/whisper-medium')
  // Two workers writing the same directory is how a torn checkpoint is made,
  // and a double click is not a mistake worth an error dialog.
  assert.equal(live(), first)
})
