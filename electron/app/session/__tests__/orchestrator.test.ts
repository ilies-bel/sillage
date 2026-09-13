/**
 * **What the process is *doing*, as distinct from what it has looked at.**
 *
 * `Orchestrator` had no test file of its own for twenty-eight rounds. Its transitions
 * are `MeetingSession.test.ts`, its arming is `agenda.test.ts`, its outbox is
 * `outbox.test.ts` — and the two questions only *it* answers, `liveStates()` and
 * `liveIds()`, were asserted nowhere. Those two decide whether an installer may run
 * (`core/domain/updateGate.ts`), whether the onboarding dry run may open a second
 * handle on the microphone, which meeting the widget adopts, and which one
 * `before-quit` ends rather than abandons.
 *
 * They were `#sessions`, and `#sessions` is the **rehydration cache**: `session()`
 * loads a meeting from the log on demand and keeps it, so *asking a question about a
 * meeting made it live for the rest of the process*. The docblock two lines above
 * `liveStates()` stated the property that breaks — « a meeting finished last week sits
 * in the log and blocks nothing » — and it was false of every read path in the
 * product: `meeting:get`, `review:get`, `history:record` and `Agenda`'s own calendar
 * poll all call `stateOf` or `session`.
 *
 * Measured, on a store a previous launch filled: boot answers `[]` and
 * `{ safe: true }`; one read of a call that ended yesterday answers `["ended"]` and
 * « un compte-rendu est en cours de rédaction », for the life of the process. So
 * opening *Historique* on a past call refused every installer for the rest of the
 * session, on the primary platform (HR-2), with a sentence that is false — and on the
 * demo build DEC-28 ships first that is every call ever recorded, because `ended`
 * persists indefinitely with no model (DEC-39). Third instance in this repo of « the
 * app could never install an update again ».
 *
 * Every suite was green throughout, and `agenda.test.ts` could not have caught it by
 * construction: it dispatches into the *same* orchestrator it then questions, so the
 * session is in the acted-on set either way. A fixture that cannot exercise the
 * property it is beside — the first shape on this repo's list.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Orchestrator } from '../Orchestrator.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { updateReadiness } from '../../../core/domain/updateGate.ts'
import type { Store } from '../../../modules/store/index.ts'
import { recordingRig, quitPath } from './recordingFakes.ts'

/** A store carrying one finished call, the way every launch after the first finds one. */
const withAPastCall = (id = 'm-hier'): Store => {
  const store = openMemoryStore()
  const previous = new Orchestrator(store)
  previous.create({ id, title: 'Sodexial — comité de staffing', context: null })
  previous.dispatch(id, 'start', 'le commercial a démarré')
  previous.dispatch(id, 'end', 'le commercial a terminé')
  // The log is what survives; this orchestrator does not.
  assert.deepEqual(previous.liveStates(), ['ended'], 'the previous launch did not record it')
  return store
}

test('reading a past meeting does not make it live, and does not refuse an installer', () => {
  const store = withAPastCall()
  const orchestrator = new Orchestrator(store)

  assert.deepEqual(orchestrator.liveStates(), [], 'a fresh process holds no session')
  assert.equal(updateReadiness(orchestrator.liveStates(), false).safe, true)

  // One read, which is what every screen that draws a past call does.
  assert.equal(orchestrator.stateOf('m-hier'), 'ended', 'the log is still readable')

  assert.deepEqual(
    orchestrator.liveStates(),
    [],
    'reading a finished call made it « live » — every installer is now refused with ' +
      '« un compte-rendu est en cours de rédaction » about a compte-rendu nothing is writing',
  )
  assert.deepEqual(orchestrator.liveIds(), [])
  assert.equal(updateReadiness(orchestrator.liveStates(), false).safe, true)
  store.close()
})

test('and `session()` still answers, because the cache is still a cache', () => {
  /*
   * The other half, and the reason the fix is a second set rather than a smaller
   * cache: a `MeetingSession` is the writer for its own log, so two instances of one
   * meeting would be two objects appending to it. What was wrong was reading the
   * cache as an answer to a different question.
   */
  const store = withAPastCall()
  const orchestrator = new Orchestrator(store)

  const first = orchestrator.session('m-hier')
  const second = orchestrator.session('m-hier')
  assert.ok(first, 'a past meeting must still be reachable')
  assert.equal(first, second, 'the same meeting rehydrated twice would be two writers')
  store.close()
})

test('a meeting this process is recording is live, and refuses an installer', () => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store)
  orchestrator.create({ id: 'm-live', title: 'Néovia — cadrage', context: null })
  orchestrator.dispatch('m-live', 'start', 'le commercial a démarré')

  assert.deepEqual(orchestrator.liveStates(), ['recording'])
  assert.deepEqual(orchestrator.liveIds(), ['m-live'], 'before-quit could not find the call')
  assert.deepEqual(updateReadiness(orchestrator.liveStates(), false), {
    safe: false,
    reason: 'une réunion est en cours d’enregistrement',
  })
  store.close()
})

test('a recording the previous process never ended blocks once the boot sweep names it', () => {
  /*
   * The case the narrower set must not lose. A meeting found in `recording` at startup
   * has no capture behind it — the device was released when the process died — and the
   * boot sweep ends it. That is a dispatch, so it is work this process is doing and it
   * blocks an installer while the enhancement it triggers runs.
   */
  const store = openMemoryStore()
  const dead = new Orchestrator(store)
  dead.create({ id: 'm-crash', title: 'Groupe Lefort — CV', context: null })
  dead.dispatch('m-crash', 'start', 'le commercial a démarré')

  const boot = new Orchestrator(store)
  assert.deepEqual(boot.liveStates(), [], 'nothing has been asked yet')
  boot.dispatch('m-crash', 'end', 'processus interrompu')
  assert.deepEqual(boot.liveStates(), ['ended'])
  assert.equal(updateReadiness(boot.liveStates(), false).safe, false)
  store.close()
})

test('a command the transition table refuses still counts as this process acting', () => {
  /*
   * `dispatch` is where « one recording at a time » is decided, and it decides it by
   * reading this very set. A refused command that left the meeting untouched would let
   * the next `start` believe nothing else is recording.
   */
  const store = withAPastCall('m-fini')
  const orchestrator = new Orchestrator(store)

  // `arm` is illegal from `ended`: the meeting is over.
  const refused = orchestrator.dispatch('m-fini', 'arm', 'le détecteur a proposé')
  assert.equal(refused.ok, false)
  assert.deepEqual(orchestrator.liveIds(), ['m-fini'])
  store.close()
})

test('one recording at a time survives the narrower set', () => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store)
  orchestrator.create({ id: 'm-a', title: 'Néovia — cadrage', context: null })
  orchestrator.create({ id: 'm-b', title: 'Arkelia — point', context: null })

  assert.equal(orchestrator.dispatch('m-a', 'start', 'le commercial a démarré').ok, true)
  const second = orchestrator.dispatch('m-b', 'start', 'le commercial a démarré')
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'une autre réunion est déjà en cours d’enregistrement')
  assert.deepEqual(orchestrator.liveStates(), ['recording', 'idle'])
  store.close()
})

test('a gate opened on a rehydrated meeting refuses an installer again', () => {
  /*
   * **The half the narrower set lost, and the one `updateGate.ts` spells out.**
   *
   * `awaiting_confirmation` blocks because, in its own words, « the rep is at the one
   * human gate (DEC-4) with edits on screen that have not been confirmed. Restarting
   * discards their corrections — the single thing the review gate exists to preserve. »
   * Nothing dispatches when a gate *opens*: `review:get` reads the projection and asks
   * `stateOf`. So a meeting that reached the gate on a previous launch — which on the
   * demo build DEC-28 ships first is every meeting until somebody validates it — stopped
   * refusing anything. Measured: launch 1 answers « un compte-rendu attend votre
   * validation »; launch 2 opens the same gate and answers `{ safe: true }`, so a rep who
   * records at 17:00, comes back Friday, corrects the compte-rendu and three of the
   * eleven fields, is offered « Installer et redémarrer » — and `PENDING_EDITS` is
   * deliberately in memory.
   *
   * The trigger is `atGate`, not the stored state: `ended`, `extracting` and
   * `awaiting_confirmation` all persist for ever with no model (DEC-39), so blocking on
   * the projection is the permanent false refusal round 28 closed.
   */
  const store = openMemoryStore()
  const first = new Orchestrator(store)
  first.create({ id: 'm-jeudi', title: 'Sodexial — comité', context: null })
  for (const command of ['start', 'end', 'extract', 'extractionSucceeded'] as const) {
    first.dispatch('m-jeudi', command, 'x')
  }
  assert.equal(first.stateOf('m-jeudi'), 'awaiting_confirmation')
  assert.equal(updateReadiness(first.liveStates(), false).safe, false)

  // Friday morning, same database, new process.
  const friday = new Orchestrator(store)
  assert.equal(updateReadiness(friday.liveStates(), false).safe, true, 'blocked before the gate')

  // `review:get` opens the gate on it.
  friday.atGate('m-jeudi')
  assert.deepEqual(updateReadiness(friday.liveStates(), false), {
    safe: false,
    reason: 'un compte-rendu attend votre validation',
  })
  store.close()
})

test('and a gate that never opened leaves the installer alone', () => {
  /*
   * The other direction, which is the round-28 defect: a meeting sitting in a blocking
   * state from last week must not refuse anything, and `atGate` must be the only way in.
   */
  const store = openMemoryStore()
  const first = new Orchestrator(store)
  first.create({ id: 'm-vieux', title: 'Groupe Lefort — CV', context: null })
  for (const command of ['start', 'end', 'extract', 'extractionSucceeded'] as const) {
    first.dispatch('m-vieux', command, 'x')
  }

  const later = new Orchestrator(store)
  // Every read path a screen takes on a past call.
  later.stateOf('m-vieux')
  later.session('m-vieux')
  assert.equal(updateReadiness(later.liveStates(), false).safe, true)

  // And `atGate` on a meeting the log does not hold is not an error and marks nothing.
  later.atGate('m-inconnu')
  assert.deepEqual(later.liveIds(), [])
  store.close()
})

/*
 * ── The quit path, and the tail it is there to keep ────────────────────────────
 *
 * **Everything below runs through `#enhance`, with `onEnded` injected**, because
 * that is the only configuration `main.ts` ever produces and it is the axis that
 * decided R32-1's outcome. `signalWiring.test.ts` and `app/__tests__/recording.test.ts`
 * both call `stopRecording` on an `Orchestrator` built **without** it, so
 * `#enhance` returns on its first line, nothing has taken the `Recording` away,
 * and the flush those tests measure is the one the product never gets: a fixture
 * simpler than the product, on the one axis that mattered (shape #5). Both
 * configurations are asserted here for that reason — the injected one is the
 * product, the bare one is the shape that used to be the only thing measured, and
 * the tail has to reach the log in both.
 *
 * What the defect was: `dispatch(id, 'end')` fires `void #enhance(id)`, whose body
 * runs synchronously to `await this.stopRecording(id)` — and *evaluating that call*
 * runs `stopRecording`'s body synchronously past `#recordings.delete(meetingId)`.
 * So `before-quit`'s own `await orchestrator.stopRecording(meetingId)`, one line
 * after its `dispatch`, returned at `if (!recording) return`: it waited for
 * nothing, under a docblock saying both providers had flushed. Measured on this
 * class over a real store: **0** tail segments with `onEnded` injected against 1
 * without it, and the flush then landing 20 ms after `store.close()`.
 *
 * The transcriber emits its tail *inside* `stop()`, after a real await, the way
 * `LocalWhisperSession.#shutdown()` drains its queue and every REST provider posts
 * its last chunk. A fake that flushed synchronously could not tell the two
 * outcomes apart.
 */

test('closing the window during a call keeps the tail — with `onEnded`, which is the product', async () => {
  const h = await recordingRig()

  const quit = await quitPath(h.orchestrator)
  assert.equal(quit.deferred, true, 'the quit was not even deferred')
  assert.deepEqual(quit.ended, ['m-neovia-cadrage'])
  assert.equal(quit.settled, true, 'the bounded wait expired on a 5 ms flush')

  assert.equal(
    h.tails(),
    1,
    'the last utterance of the call never reached the log: it is therefore missing from ' +
      'the compte-rendu, from what `[source ▸]` reads, and from what VerySwing receives',
  )
  assert.equal(
    h.transcribe.flushed,
    true,
    'the quit path returned before the transcriber had flushed — `stopRecording` found ' +
      'nothing, because `#enhance` had already taken the Recording',
  )

  // And `store.close()` is the very next thing `before-quit` does.
  h.store.close()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(h.transcribe.refused, null, 'the tail was written into a closed database')
  assert.equal(
    h.records.filter((row) => row.code === 'enhancement.unhandled').length,
    0,
    'the end-of-meeting path failed on the way out',
  )
})

test('and with no `onEnded`, which is the only shape the older fixtures could see', async () => {
  /*
   * The control. `signalWiring.test.ts` and `app/__tests__/recording.test.ts` build
   * the orchestrator this way, so `#enhance` returns on its first line and nothing
   * has raced `stopRecording` for the `Recording`. Green before the fix and after
   * it — which is the point: this row alone proves nothing, and for a dozen rounds
   * it was the only row anybody had.
   */
  const h = await recordingRig({ onEnded: false })
  const quit = await quitPath(h.orchestrator)
  assert.equal(quit.deferred, true)
  assert.equal(h.tails(), 1)
  h.store.close()
})

test('one flush per recording: two callers await the same one', async () => {
  /*
   * The memo, asked directly. `#enhance` and `before-quit` both call
   * `stopRecording` on the same meeting within one line of each other, and the
   * provider is stopped **once** — `Recording.stop()` is sticky, so a second
   * `stop()` would be absorbed there, but a second *caller* used to be handed
   * `undefined` and no wait at all.
   */
  const h = await recordingRig()
  let stops = 0
  const spy = h.transcribe.stop.bind(h.transcribe)
  h.transcribe.stop = async () => {
    stops += 1
    await spy()
  }

  h.orchestrator.dispatch('m-neovia-cadrage', 'end', 'le commercial a terminé')
  assert.equal(
    h.orchestrator.flushing(),
    true,
    '`before-quit` runs one line later and has to be able to see this flush',
  )
  await h.orchestrator.stopRecording('m-neovia-cadrage')
  assert.equal(h.transcribe.flushed, true, 'the second caller did not await the first flush')
  assert.equal(stops, 1, 'the provider was stopped twice')
  assert.equal(h.tails(), 1)
  assert.equal(h.orchestrator.flushing(), false, 'the memo outlived its own flush')
  h.store.close()
})

test('a retry on a meeting that stopped minutes ago is still a no-op', async () => {
  /*
   * The path the memo must not break. `enhance()` — a retry, or a first attempt once
   * a model finally exists — goes through `#enhance`, which calls `stopRecording` on
   * a meeting whose devices were released long ago and expects nothing to happen.
   * A memo kept for the life of the process would hand it a settled promise for
   * ever, and a *rejected* one if that flush had failed.
   */
  const h = await recordingRig()
  await quitPath(h.orchestrator)
  assert.equal(h.orchestrator.flushing(), false)

  let stops = 0
  h.transcribe.stop = async () => {
    stops += 1
  }
  await h.orchestrator.enhance('m-neovia-cadrage')
  assert.equal(stops, 0, 'a retry stopped a provider that had already been stopped')
  assert.equal(h.tails(), 1, 'the retry lost the tail the first pass had stored')
  h.store.close()
})

test('the wait for a flush is bounded, or a rep who pressed close never gets their window back', async () => {
  /*
   * The other direction, and the one that would be this fix's own next round: the
   * providers' `stop()` is bounded (30 s local, an 8 s safety net over REST), and
   * an unbounded wait here would be a process the rep kills — which loses the tail
   * as well and looks broken doing it. `settleRecordings` answers `false` and
   * `before-quit` says so in the log rather than quitting silently (DEC-26).
   */
  const h = await recordingRig()
  h.transcribe.hangs = true
  h.orchestrator.dispatch('m-neovia-cadrage', 'end', 'le commercial a terminé')
  assert.equal(h.orchestrator.flushing(), true)

  const started = Date.now()
  const settled = await h.orchestrator.settleRecordings(40)
  assert.equal(settled, false, 'a provider that never answers held the quit for ever')
  assert.ok(Date.now() - started < 1_000, 'the bound did not bound anything')
  h.store.close()
})

test('nothing in flight means nothing to wait for, and the quit is not deferred', async () => {
  /*
   * `flushing()` must be false in the ordinary case or every quit is deferred for
   * ever — the shape of a control that is present and does nothing, one layer down.
   */
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store, { onEnded: async () => {} })
  assert.equal(orchestrator.flushing(), false)
  assert.equal(await orchestrator.settleRecordings(0), true, 'an empty wait still waited')
  const quit = await quitPath(orchestrator)
  assert.equal(quit.deferred, false)
  store.close()
})
