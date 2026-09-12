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
