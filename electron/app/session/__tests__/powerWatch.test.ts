/**
 * **Driven on the shipped watch, against a real `Orchestrator` over
 * `openMemoryStore`.**
 *
 * The rule is proved next door in `core/domain/__tests__/powerEvents.test.ts`;
 * what is proved here is that the shipped subscription reaches it, that the
 * transition lands in the **log** and not merely in a field, and that it lands
 * there **before the handler returns**. That last one cannot be asserted by a
 * test that awaits anything: a `queueMicrotask`ed dispatch and a synchronous one
 * are indistinguishable one tick later, and the deferred one is the bug — a
 * battery that dies asleep or a hibernate image the OS discards never runs it.
 * So every test body here is synchronous, and the suspend test states the
 * property directly: a microtask queued before the emit has still not run when
 * the log is read.
 *
 * `lock-screen` gets its own test for the opposite reason. Being wrong there
 * costs the call rather than the recording — audio keeps flowing on both
 * platforms while the screen is locked, and a rep on a headset call who locks
 * their laptop is having an ordinary call.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Orchestrator } from '../Orchestrator.ts'
import {
  watchPower,
  type NotificationHost,
  type PowerEmitter,
  type SessionEndEmitter,
  type WindowHost,
} from '../PowerWatch.ts'
import {
  POWER_MONITOR_EVENTS,
  WINDOW_POWER_EVENTS,
  type PowerMonitorEvent,
  type WindowPowerEvent,
} from '../../../core/domain/powerEvents.ts'
import { openMemoryStore } from '../../../modules/store/index.ts'
import { recordingRig, quitPath } from './recordingFakes.ts'
import type { DiagInput, DiagRecorder } from '../../../core/contracts/diagnostics.ts'

/** Every notification the watch asked the OS for, and the click it registered. */
interface Notices {
  shown: { title: string; body: string }[]
  clicks: (() => void)[]
}

const notificationHost = (notices: Notices): NotificationHost => {
  class FakeNotification {
    #options: { title: string; body: string }

    constructor(options: { title: string; body: string; silent?: boolean }) {
      this.#options = { title: options.title, body: options.body }
    }

    static isSupported(): boolean {
      return true
    }

    on(_event: 'click', listener: () => void): this {
      notices.clicks.push(listener)
      return this
    }

    show(): void {
      notices.shown.push(this.#options)
    }
  }
  return FakeNotification
}

/**
 * A window, the way Electron hands one over: `session-end` is a `BaseWindow`
 * event and not an `app` one, so the fake is a window and the census below asks
 * which of its events the watch claimed.
 */
interface FakeWindow {
  handle: SessionEndEmitter
  emit: (event: WindowPowerEvent) => void
  subscribed: () => string[]
}

const fakeWindow = (): FakeWindow => {
  const listeners = new Map<string, (() => void)[]>()
  const handle: SessionEndEmitter = {
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return handle
    },
  }
  return {
    handle,
    subscribed: () => [...listeners.keys()],
    emit: (event) => {
      const armed = listeners.get(event) ?? []
      assert.ok(armed.length > 0, `nothing subscribed to \`${event}\` on this window`)
      for (const listener of armed) listener()
    },
  }
}

const harness = (
  options: { withNotifications?: boolean; openBeforeInstall?: boolean } = {},
): {
  store: ReturnType<typeof openMemoryStore>
  orchestrator: Orchestrator
  emit: (event: PowerMonitorEvent) => void
  powerSubscribed: () => string[]
  /** The window that was already open when the watch was installed, if any. */
  booted: FakeWindow | null
  /** A window created later — the widget over the call, or `activate`'s. */
  openWindow: () => FakeWindow
  notices: Notices
  opened: string[]
  records: DiagInput[]
} => {
  const store = openMemoryStore()
  const orchestrator = new Orchestrator(store)
  const records: DiagInput[] = []
  const diagnostics: DiagRecorder = { record: (input) => records.push(input) }
  const notices: Notices = { shown: [], clicks: [] }
  const opened: string[] = []

  const listeners = new Map<PowerMonitorEvent, (() => void)[]>()
  const power: PowerEmitter = {
    on: (event, listener) => {
      const existing = listeners.get(event) ?? []
      existing.push(listener)
      listeners.set(event, existing)
      return power
    },
  }

  const booted = options.openBeforeInstall === true ? fakeWindow() : null
  const open: FakeWindow[] = booted ? [booted] : []
  const created: ((window: SessionEndEmitter) => void)[] = []
  const windows: WindowHost = {
    all: () => open.map((entry) => entry.handle),
    onOpened: (listener) => {
      created.push(listener)
    },
  }

  watchPower({
    power,
    windows,
    orchestrator,
    store,
    diagnostics,
    notification: options.withNotifications === false ? null : notificationHost(notices),
    onOpen: (meetingId) => opened.push(meetingId),
  })

  return {
    store,
    orchestrator,
    notices,
    opened,
    records,
    booted,
    powerSubscribed: () => [...listeners.keys()],
    openWindow: () => {
      const entry = fakeWindow()
      open.push(entry)
      for (const listener of created) listener(entry.handle)
      return entry
    },
    emit: (event) => {
      const armed = listeners.get(event) ?? []
      assert.ok(armed.length > 0, `nothing subscribed to \`${event}\``)
      for (const listener of armed) listener()
    },
  }
}

/** A meeting that is genuinely recording, the way the rep's press leaves it. */
const recording = (orchestrator: Orchestrator, id = 'm-neovia-cadrage'): string => {
  orchestrator.create({ id, title: 'Néovia — cadrage', context: null })
  const outcome = orchestrator.dispatch(id, 'start', 'le commercial a démarré')
  assert.equal(outcome.ok, true)
  return id
}

test('the watch subscribes to every event the rule decides, on the emitter that has it', () => {
  const { store, emit, booted, openWindow, powerSubscribed } = harness({
    openBeforeInstall: true,
  })
  // `emit` asserts a listener exists, so this is the subscription census: an
  // event the rule has a branch for and the watch never hears is a decision
  // nothing reaches.
  for (const event of POWER_MONITOR_EVENTS) emit(event)

  /*
   * And the other emitter. `session-end` is a **window** event in Electron 43
   * (`@platform win32`, on `BaseWindow`/`BrowserWindow`) and `App` declares no
   * such event, so asking `powerMonitor` or `app` for it is a subscription with
   * no emitter: it compiles, never fires, and reads as a fix. Both directions
   * are asserted — it is claimed on the window, and it is *not* claimed on
   * `powerMonitor`.
   */
  assert.ok(booted, 'the harness staged no window')
  for (const event of WINDOW_POWER_EVENTS) booted.emit(event)
  for (const event of WINDOW_POWER_EVENTS) {
    assert.ok(
      !powerSubscribed().includes(event),
      `\`${event}\` was asked of \`powerMonitor\`, which does not emit it`,
    )
  }

  // Every window, because `WM_ENDSESSION` reaches every one of them — and a
  // window created later is the ordinary case: the widget over the call (DEC-49)
  // is created while a meeting is recording.
  for (const event of WINDOW_POWER_EVENTS) openWindow().emit(event)
  store.close()
})

test('a suspend ends the live recording, and the end is in the log before the handler returns', () => {
  const { store, orchestrator, emit, records } = harness()
  const id = recording(orchestrator)
  assert.equal(store.projections.getMeeting(id)?.state, 'recording')

  /*
   * The whole property, stated so it cannot be satisfied by a deferred dispatch:
   * this microtask is queued *before* the emit and must still not have run when
   * the log is read below. A `void queueMicrotask`, a `setTimeout` or an `await`
   * inside the handler would flip it.
   */
  let ticked = false
  queueMicrotask(() => {
    ticked = true
  })

  emit('suspend')

  assert.equal(ticked, false, 'a tick has passed — the read below cannot prove anything')
  assert.equal(
    store.projections.getMeeting(id)?.state,
    'ended',
    'the machine may never come back: the transition has to be in the log already',
  )
  assert.equal(orchestrator.stateOf(id), 'ended')

  const ended = records.filter((row) => row.code === 'session.powerEnded')
  assert.equal(ended.length, 1, 'said once, or the log reads as two sleeps')
  assert.equal(ended[0]?.message, 'mise en veille de l’ordinateur')
  assert.equal(ended[0]?.origin, 'authored')
  assert.equal(ended[0]?.meetingId, id)
  store.close()
})

test('a shutdown ends it too, because `before-quit` is not promised to run first', () => {
  const { store, orchestrator, emit } = harness()
  const id = recording(orchestrator)
  emit('shutdown')
  assert.equal(store.projections.getMeeting(id)?.state, 'ended')
  store.close()
})

test('« j’ai éteint le PC » — a Windows session end ends it, in the log before the handler returns', () => {
  /*
   * US-2, and the one of these two branches a rep on Windows can actually reach:
   * `powerMonitor`'s `shutdown` is `@platform linux,darwin`. Same synchronous
   * property as `suspend`, for a sharper reason — `WM_ENDSESSION` means the
   * session is ending with no way to prevent it, so there is no later tick.
   */
  const { store, orchestrator, records, openWindow } = harness()
  const id = recording(orchestrator)
  const window = openWindow()
  assert.equal(store.projections.getMeeting(id)?.state, 'recording')

  let ticked = false
  queueMicrotask(() => {
    ticked = true
  })

  window.emit('session-end')

  assert.equal(ticked, false, 'a tick has passed — the read below cannot prove anything')
  assert.equal(
    store.projections.getMeeting(id)?.state,
    'ended',
    'the session is ending and cannot be stopped: the transition has to be in the log already',
  )
  assert.equal(orchestrator.stateOf(id), 'ended')

  const ended = records.filter((row) => row.code === 'session.powerEnded')
  assert.equal(ended.length, 1)
  assert.equal(ended[0]?.message, 'fermeture de la session Windows')
  assert.equal(ended[0]?.origin, 'authored')
  assert.equal(ended[0]?.meetingId, id)
  store.close()
})

test('and it is ended once, whichever of `session-end` and the quit path arrives first', async () => {
  /*
   * **The double-end question, driven in both orders and on every window.**
   * `WM_ENDSESSION` reaches every top-level window of the process — the main one
   * and the widget over the call (DEC-49) — and `before-quit` may well follow it
   * on the same shutdown. What must hold is one transition in the *log*: a second
   * `dispatch(id, 'end')` on an `ended` meeting is refused, which is safe, but a
   * refusal counted as an interruption would write a second `session.powerEnded`
   * and a second sentence for the rep.
   *
   * Two guards hold it and either is enough on its own, which is worth saying
   * because it changes what reverting proves: measured, weakening only the
   * `recording` filter or only `outcome.ok` leaves this green, and weakening both
   * gives « actual: 2, expected: 1 » here. A deferred dispatch fails it too — the
   * quit path then finds the recording still live — which is the useful direction,
   * since that is the shape a well-meaning `queueMicrotask` would take.
   *
   * `before-quit` is modelled by its own filter rather than by booting `main.ts`
   * — `liveIds().filter(stateOf === 'recording')`, which is the line it uses, and
   * the one this file's `endRecordings` uses too.
   *
   * **And for a dozen rounds that model stopped one line too early, which is why
   * nothing here could see R32-1.** `before-quit` does not only dispatch: it then
   * awaits `stopRecording` so the transcriber flushes the tail, and it asks a
   * *second* predicate — `orchestrator.flushing()` — because this file's handler
   * moves the meeting out of `recording` synchronously and therefore empties the
   * first one. What was written down here was « the quit path finds nothing », with
   * a comment calling that the useful direction; finding nothing was the defect.
   * Measured, before the fix: `session-end` left `defers the quit? false`, the
   * store closed a few microtasks later, and the tail arrived at « database is not
   * open » inside the provider's own `stop()`.
   *
   * So the model carries both predicates and the flush. `deferred` is what
   * `before-quit` would do with it, `ended` is what it dispatched itself — still
   * empty after a `session-end`, which is the property the double-end test below
   * is about and is unchanged.
   *
   * `quitPath` is imported rather than written here: two copies of that handler is how
   * one of them came to stop at the dispatch.
   */

  const ends = (store: ReturnType<typeof openMemoryStore>, id: string): number =>
    store.log
      .read(id)
      .filter((row) => row.event.type === 'session.transition' && row.event.to === 'ended').length

  // Session end first, then the quit — the ordinary Windows shutdown.
  {
    const { store, orchestrator, records, notices, openWindow, emit } = harness()
    const id = recording(orchestrator)
    const main = openWindow()
    const widget = openWindow()

    main.emit('session-end')
    widget.emit('session-end')
    const quit = await quitPath(orchestrator)
    assert.deepEqual(quit.ended, [], 'the quit path ended a meeting the watch had already ended')

    assert.equal(store.projections.getMeeting(id)?.state, 'ended')
    assert.equal(ends(store, id), 1, 'the log carries the end twice')
    assert.equal(
      records.filter((row) => row.code === 'session.powerEnded').length,
      1,
      'two windows, two rows — the rep reads one shutdown as two',
    )
    // And nothing is owed on the way back: the sentence names the sleep, and a
    // session end is not one. A later sleep must not publish this meeting.
    emit('suspend')
    emit('resume')
    assert.equal(notices.shown.length, 0, 'a stale sleep notice about a call already dealt with')
    store.close()
  }

  // The quit first — `review:confirm` fires a drain without awaiting it, and on
  // Windows closing the window quits, so this order is reachable too.
  {
    const { store, orchestrator, records, openWindow } = harness()
    const id = recording(orchestrator)
    const main = openWindow()

    assert.deepEqual((await quitPath(orchestrator)).ended, [id])
    main.emit('session-end')

    assert.equal(store.projections.getMeeting(id)?.state, 'ended')
    assert.equal(ends(store, id), 1)
    assert.equal(
      records.filter((row) => row.code === 'session.powerEnded').length,
      0,
      'the watch claimed an end the quit path had already made',
    )
    store.close()
  }
})

test('locking the screen ends nothing — the call is still going', () => {
  const { store, orchestrator, emit, notices } = harness()
  const id = recording(orchestrator)

  emit('lock-screen')
  assert.equal(
    store.projections.getMeeting(id)?.state,
    'recording',
    'a rep on a headset call who locked their laptop just lost the recording',
  )

  emit('unlock-screen')
  assert.equal(store.projections.getMeeting(id)?.state, 'recording')

  // And nothing to read afterwards about a recording that never stopped.
  emit('resume')
  assert.equal(notices.shown.length, 0)

  // On battery, on mains: neither is a statement about the call.
  emit('on-battery')
  emit('on-ac')
  assert.equal(store.projections.getMeeting(id)?.state, 'recording')
  store.close()
})

test('the rep is told once when they open the lid, and the notice names the objet', () => {
  const { store, orchestrator, emit, notices, opened } = harness()
  const id = recording(orchestrator)

  emit('suspend')
  assert.equal(notices.shown.length, 0, 'the screen was off — nothing is raised during the sleep')

  emit('resume')
  assert.equal(notices.shown.length, 1)
  assert.equal(notices.shown[0]?.title, 'Néovia — cadrage')
  assert.match(notices.shown[0]?.body ?? '', /veille/)

  // Its click is the arming notification's: forward, on that meeting (DEC-46).
  notices.clicks[0]?.()
  assert.deepEqual(opened, [id])

  // Exactly once per sleep. A second resume with no sleep between them is a
  // stale sentence about a call that has since been dealt with.
  emit('resume')
  assert.equal(notices.shown.length, 1)
  store.close()
})

test('and nothing at all when the sleep ended no recording', () => {
  const { store, orchestrator, emit, notices, records } = harness()

  // A morning with no call: the machine sleeps and wakes twice.
  emit('suspend')
  emit('resume')
  emit('suspend')
  emit('resume')
  assert.equal(notices.shown.length, 0)
  assert.equal(records.length, 0, 'a sleep that cost nothing wrote a line about a call')

  // And a call that is over is not a call: `end` is refused from `ended`, so
  // there is nothing to report on the way back either.
  const id = recording(orchestrator)
  orchestrator.dispatch(id, 'end', 'le commercial a terminé')
  emit('suspend')
  emit('resume')
  assert.equal(notices.shown.length, 0)
  assert.equal(
    records.filter((row) => row.code === 'session.powerEnded').length,
    0,
    'a refused dispatch was counted as an interrupted recording',
  )
  store.close()
})

test('a machine with no notifications still ends the recording', () => {
  // DEC-26's other half: the notice is a readout, never a dependency.
  const { store, orchestrator, emit } = harness({ withNotifications: false })
  const id = recording(orchestrator)
  emit('suspend')
  emit('resume')
  assert.equal(store.projections.getMeeting(id)?.state, 'ended')
  store.close()
})

test('`main.ts` calls it — a watch nobody installs is the shape this repo keeps producing', () => {
  /*
   * Source as evidence, the `preloadUnwrap.test.ts` shape. Nothing else in the
   * repo can see this wiring: `scripts/check-surfaces.mjs` scans `export class`
   * in this folder and this is a function, and no unit test boots `main.ts`. The
   * whole behaviour is one `powerMonitor` subscription — dropping the call leaves
   * every test above green and the product exactly as it was.
   */
  const main = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8')
  assert.match(main, /watchPower\(\{/, '`main.ts` no longer installs the power watch')
  assert.match(main, /powerMonitor/, '`main.ts` no longer passes Electron’s own emitter')
  /*
   * And the Windows half, which `tsc` can only half-hold: `windows` is required,
   * so a missing dep is a compile error, but `{ all: () => [], onOpened: () => {} }`
   * type-checks and hears nothing. These two strings are what makes it a real
   * emitter, and neither appears anywhere else in `main.ts`.
   */
  assert.match(
    main,
    /'browser-window-created'/,
    '`main.ts` no longer hears windows opened after boot — the widget over the call is one',
  )
  assert.match(
    main,
    /all: \(\) => BrowserWindow\.getAllWindows\(\)/,
    '`main.ts` no longer passes the windows that are already open',
  )
})

test('one meeting that will not end does not cost the next one its end, nor the process', () => {
  /*
   * The guard `endRecordings` carries, driven. This runs inside an OS event
   * handler at the most awkward instant there is: an exception escaping it is an
   * unhandled one in the main process — the argument `Orchestrator`'s broadcast
   * wrapper already makes about a timer — and the second recording would never be
   * reached. A stub orchestrator here rather than the real one, deliberately: the
   * properties above are proved against a real `Orchestrator` over
   * `openMemoryStore`, and a real `dispatch` has no way to be asked to throw.
   */
  const store = openMemoryStore()
  const records: DiagInput[] = []
  const dispatched: string[] = []
  const listeners = new Map<PowerMonitorEvent, (() => void)[]>()

  watchPower({
    power: {
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return null
      },
    },
    windows: { all: () => [], onOpened: () => {} },
    orchestrator: {
      liveIds: () => ['m-casse', 'm-bonne'],
      stateOf: () => 'recording',
      dispatch: (meetingId) => {
        if (meetingId === 'm-casse') throw new Error('log closed')
        dispatched.push(meetingId)
        return { ok: true, from: 'recording', to: 'ended' }
      },
    },
    store,
    diagnostics: { record: (input) => records.push(input) },
    notification: null,
  })

  for (const listener of listeners.get('suspend') ?? []) listener()

  assert.deepEqual(dispatched, ['m-bonne'], 'the second recording was never reached')
  assert.deepEqual(
    records.map((row) => row.code),
    ['session.powerEndFailed', 'session.powerEnded'],
    'a failure that says nothing is a recording lost in silence',
  )
  assert.equal(records[0]?.origin, 'foreign', 'the message is the thrower’s, not ours')
  store.close()
})

test('« Se déconnecter » keeps the tail: the flush it starts is what the quit waits for', async () => {
  /*
   * **R32-1's second half, and the one US-1/US-2 made worse rather than missed.**
   *
   * This watch ends the recording synchronously inside the OS handler — it must,
   * the machine may never come back — and that dispatch is what starts the flush.
   * `before-quit` then filtered on « is a meeting *recording* », which this handler
   * has just made false, so on `session-end` (a Windows shutdown, « Se
   * déconnecter » — the one power branch a rep on the primary platform can reach)
   * the quit was **not even deferred**: `store.close()` landed a few microtasks
   * later and the tail arrived at « database is not open », inside the provider's
   * own `stop()`, where nothing records it. Measured on this file's own watch over
   * a real `Orchestrator`:
   *
   *     WITHOUT PowerWatch (pre-b2cc981)  state: recording   defers the quit? true
   *     WITH PowerWatch (before the fix)  state: ended       defers the quit? false
   *
   * Strictly worse than before this file existed, on the primary platform, on the
   * thing this file exists to protect.
   *
   * Every other test here uses `harness()`, whose orchestrator opens no device, so
   * none of them could have seen it: there is no `Recording` to flush and no
   * `onEnded` to race it. This one holds a real one — `recordingFakes.ts` says why
   * both halves of that matter — and the watch is installed **on it** rather than
   * on a second orchestrator, because the question is what the quit inherits from
   * this handler.
   */
  const windowListeners: (() => void)[] = []
  const handle: SessionEndEmitter = {
    on: (_event, listener) => {
      windowListeners.push(listener)
      return handle
    },
  }
  const rig = await recordingRig({
    // A long-enough flush that a quit which does not wait cannot accidentally pass:
    // `before-quit` runs in the same turn as the handler, so a 5 ms tail would be
    // decided by the scheduler rather than by the code.
    delayMs: 40,
    install: (orchestrator, store, records) => {
      watchPower({
        power: { on: () => null },
        windows: { all: () => [handle], onOpened: () => {} },
        orchestrator,
        store,
        diagnostics: { record: (input) => records.push(input) },
        notification: null,
      })
    },
  })

  // `WM_ENDSESSION`, delivered to the window.
  assert.ok(windowListeners.length > 0, 'the watch claimed nothing on the window')
  for (const listener of windowListeners) listener()

  assert.equal(
    rig.orchestrator.stateOf(rig.meetingId),
    'ended',
    'the transition has to be in the log before the handler returns',
  )
  assert.equal(rig.transcribe.flushed, false, 'the flush cannot already be over — see delayMs')

  const quit = await quitPath(rig.orchestrator)
  assert.deepEqual(quit.ended, [], 'the quit path ended a meeting the watch had already ended')
  assert.equal(
    quit.deferred,
    true,
    'the quit was not deferred, so `store.close()` lands under a live flush: this is the ' +
      'measurement above, « defers the quit? false »',
  )
  assert.equal(quit.settled, true)
  assert.equal(
    rig.tails(),
    1,
    'the last utterance of the call was lost to the shutdown — the case this file is for',
  )

  // `overlay.hide(); store.close()` is what `before-quit` does next.
  rig.store.close()
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(rig.transcribe.refused, null, 'the tail was written into a closed database')
})
