/**
 * DEC-5 in one sentence: gray AI text enters the document **exactly once**, at
 * meeting end. `Enhancement` is the "exactly once" — these check the edge that
 * triggers it, the states it refuses, and that a failure costs the enhancement
 * and nothing else.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../../../modules/store/index.ts'
import { Orchestrator } from '../Orchestrator.ts'
import { Enhancement, type ExtractionRunner } from '../Enhancement.ts'
import { Diagnostics } from '../../../modules/diagnostics/index.ts'
import {
  sampleContext,
  sampleExtraction,
  sampleVerification,
} from '../../../core/contracts/fixtures.ts'
import type { DiagEnvironment } from '../../../core/contracts/diagnostics.ts'

const environment: DiagEnvironment = {
  appVersion: '3.0.0',
  platform: 'darwin',
  arch: 'arm64',
  osRelease: '25.5.0',
  electron: '43.1.0',
  node: '24.18.0',
  nativeArch: 'arm64',
}

/*
 * The real fixtures, not a hand-rolled shape. `store.append` validates every
 * event against its zod schema, so a cast-to-`ExtractionESN` stub is rejected
 * at the boundary — which the failure path then reports as a failed
 * extraction, and the test passes for the wrong reason or fails for a
 * confusing one. (It failed for a confusing one.)
 */
const runner = (
  behaviour: 'ok' | 'throw' = 'ok',
): ExtractionRunner & { calls: number } => {
  const stub = {
    calls: 0,
    async run() {
      stub.calls += 1
      if (behaviour === 'throw') throw new Error('le modèle a refusé la réponse')
      return {
        extraction: sampleExtraction,
        verification: sampleVerification,
        compteRendu: '# Compte-rendu',
      }
    },
  }
  return stub
}

const open = (recipe: ExtractionRunner | null, repEmail: string | null = 'moi@esn.fr') => {
  const store = new Store(':memory:')
  const diagnostics = new Diagnostics(store, { environment })
  const states: string[] = []
  const outcomes: Array<unknown | null> = []
  const statuses: string[] = []
  // Mutable, because `recipe` is asked per run in production for exactly this
  // reason: a rep can configure a provider between a meeting ending and the
  // compte-rendu being written, and a recipe captured once could not see it.
  let current = recipe
  const enhancement = new Enhancement({
    recipe: () => current,
    repEmail: () => repEmail,
    diagnostics,
    onOutcome: (error) => outcomes.push(error),
    onStatus: (meetingId) => statuses.push(meetingId),
    dispatch: (meetingId, command, reason) => orchestrator.dispatch(meetingId, command, reason),
  })

  const orchestrator: Orchestrator = new Orchestrator(store, {
    diagnostics,
    broadcast: (channel, payload) => {
      if (channel === 'session:changed') states.push((payload as { state: string }).state)
    },
    onEnded: async (meetingId) => {
      const session = orchestrator.session(meetingId)
      if (!session) return
      await enhancement.run({
        session,
        context: sampleContext,
        transcript: store.projections.segments(meetingId),
        notes: '',
      })
    },
  })

  const id = 'm1'
  orchestrator.create({ id, title: 'Point Acme', context: sampleContext })
  orchestrator.dispatch(id, 'start', null)
  store.append(id, {
    type: 'transcript.segment',
    segment: {
      id: 's1',
      channel: 'far',
      text: 'on est sur un TJM de 520 euros',
      startMs: 0,
      endMs: 2000,
      isFinal: true,
      provider: 'test',
      receivedAt: 1,
    },
  })

  return {
    store,
    orchestrator,
    enhancement,
    states,
    outcomes,
    statuses,
    id,
    /** Stands in for a provider being configured in Réglages mid-session. */
    setRecipe: (next: ExtractionRunner | null) => {
      current = next
    },
    cleanup: () => store.close(),
  }
}

/**
 * `dispatch` fires enhancement without awaiting it, by design — so a test has
 * to give the chain (stopRecording → onEnded → recipe → dispatch) room to run.
 * Several turns, because each `await` in that chain is one.
 */
const settle = async (turns = 6) => {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('ending a meeting produces a compte-rendu and opens the review gate', async () => {
  const recipe = runner()
  const h = open(recipe)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  assert.equal(recipe.calls, 1)
  assert.equal(h.orchestrator.stateOf(h.id), 'awaiting_confirmation')
  assert.ok(h.states.includes('ended'))
  assert.ok(h.states.includes('extracting'))
  assert.ok(h.states.includes('awaiting_confirmation'))

  const stored = h.store.projections.extraction(h.id)
  assert.ok(stored, 'the extraction should be persisted, not just held in memory')

  h.cleanup()
})

test('a failed extraction returns to ended — the retry costs the enhancement only', async () => {
  const recipe = runner('throw')
  const h = open(recipe)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  assert.equal(h.orchestrator.stateOf(h.id), 'ended')
  // The transcript is untouched: it was persisted as it arrived and nothing in
  // the failure path goes near it.
  assert.equal(h.store.projections.segments(h.id).length, 1)

  h.cleanup()
})

test('no model configured leaves the meeting ended, with its transcript intact', async () => {
  // DEC-26. Not a failure and deliberately not a state change.
  const h = open(null)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  assert.equal(h.orchestrator.stateOf(h.id), 'ended')
  assert.equal(h.store.projections.segments(h.id).length, 1)

  h.cleanup()
})

test('no model configured says so, rather than leaving the screen blank', async () => {
  const h = open(null)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  // The meeting is remembered as waiting, and the status is a sentence the
  // session screen can draw. Both halves matter: the first is what makes the
  // drain possible, the second is what stops « rien ne s'est passé » being the
  // whole of the rep's experience.
  assert.deepEqual(h.enhancement.deferred(), [h.id])
  assert.deepEqual(h.enhancement.statusOf(h.id, 'ended', false), { status: 'waitingForModel' })
  assert.equal(h.statuses.filter((id) => id === h.id).length, 1)

  h.cleanup()
})

test('a model appearing later drains the meeting that was waiting for one', async () => {
  // The promise the notice makes — « il sera rédigé dès qu'un modèle sera
  // disponible » — is this test. Réglages calls the drain on every write.
  const recipe = runner()
  const h = open(null)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()
  assert.equal(recipe.calls, 0)

  h.setRecipe(recipe)
  for (const meetingId of h.enhancement.deferred()) await h.orchestrator.enhance(meetingId)
  await settle()

  assert.equal(recipe.calls, 1)
  assert.equal(h.orchestrator.stateOf(h.id), 'awaiting_confirmation')
  // No longer waiting on anything: the review gate is what speaks from here.
  assert.deepEqual(h.enhancement.deferred(), [])

  h.cleanup()
})

test('no Microsoft account still produces a compte-rendu', async () => {
  /*
   * This used to return early, which made an Entra sign-in a prerequisite of
   * the one thing the product is for: every meeting on a machine without one
   * was recorded, transcribed, and then silently left un-analysed. The address
   * names the rep on the document header and subtracts them from
   * `interlocuteurs` — a compte-rendu without it is missing a line, not missing
   * its point (DEC-26 makes Microsoft optional; this is what that costs).
   */
  const recipe = runner()
  const h = open(recipe, null)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  assert.equal(recipe.calls, 1)
  assert.equal(h.orchestrator.stateOf(h.id), 'awaiting_confirmation')

  h.cleanup()
})

test('a failed attempt reports its reason, so the retry button can state it', async () => {
  const h = open(runner('throw'))

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  assert.deepEqual(h.enhancement.statusOf(h.id, 'ended', true), {
    status: 'failed',
    reason: 'le modèle a refusé la réponse',
  })
  // Not deferred: a model exists, so nothing will drain this on its own and the
  // rep is owed a button rather than a promise.
  assert.deepEqual(h.enhancement.deferred(), [])

  h.cleanup()
})

test('a meeting that is not ended is owed no notice at all', async () => {
  const h = open(runner())

  // `idle` for everything before the question and everything past it — the
  // strip must not appear over a live notepad, and must not linger once the
  // review gate has opened.
  for (const state of ['idle', 'armed', 'recording', 'awaiting_confirmation', 'done'] as const) {
    assert.deepEqual(h.enhancement.statusOf(h.id, state, false), { status: 'idle' })
  }
  assert.deepEqual(h.enhancement.statusOf(h.id, 'extracting', true), { status: 'running', since: null })

  h.cleanup()
})

test('ending twice runs the recipe once', async () => {
  // `end` from `ended` is refused by the state machine, but the guard in
  // `Enhancement` is what stops a second in-flight run from a race.
  const recipe = runner()
  const h = open(recipe)

  h.orchestrator.dispatch(h.id, 'end', null)
  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()

  assert.equal(recipe.calls, 1)
  h.cleanup()
})

test('an aborted meeting is never enhanced', async () => {
  const recipe = runner()
  const h = open(recipe)

  h.orchestrator.dispatch(h.id, 'abort', 'le commercial a annulé')
  await settle()

  assert.equal(recipe.calls, 0)
  assert.equal(h.orchestrator.stateOf(h.id), 'aborted')

  h.cleanup()
})

test('enhancement does not block the caller — dispatch returns before the model does', async () => {
  // The renderer is waiting on `session:command`. Holding it for the length of
  // an LLM call would freeze the button the rep just pressed.
  // An array, not a `let`: the assignment happens inside a closure and
  // TypeScript narrows the variable to `null` at the call site.
  const releases: Array<() => void> = []
  const slow: ExtractionRunner = {
    async run() {
      await new Promise<void>((resolve) => {
        releases.push(resolve)
      })
      return {
        extraction: sampleExtraction,
        verification: sampleVerification,
        compteRendu: '',
      }
    },
  }
  const h = open(slow)

  const outcome = h.orchestrator.dispatch(h.id, 'end', null)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok && outcome.to, 'ended')

  await settle()
  assert.equal(releases.length, 1, 'the recipe should have started')
  // Let it finish before closing the store, or the write lands on a closed
  // database after the test has returned.
  releases[0]!()
  await settle()

  h.cleanup()
})

test('a failed extraction is not retried forever', async () => {
  // Regression. `extractionFailed` lands the machine back on `ended`, so an
  // orchestrator that triggers on the *state* `ended` rather than on the edge
  // `recording → ended` re-runs the recipe immediately, fails again, and loops
  // — spending model calls with nobody watching and no way to stop it.
  const recipe = runner('throw')
  const h = open(recipe)

  h.orchestrator.dispatch(h.id, 'end', null)
  await settle(20)

  assert.equal(recipe.calls, 1)
  assert.equal(h.orchestrator.stateOf(h.id), 'ended')

  h.cleanup()
})

/*
 * The health strip after boot.
 *
 * Boot asks "is a model configured" once and, before this, never asked again —
 * so a key that expired at 14h and a provider returning 503s both left the
 * strip reading `ok` while every compte-rendu silently failed. DEC-26 names
 * "LLM down" as a state the rep has to be able to see.
 */
test('a successful run reports the model healthy', async () => {
  const h = open(runner('ok'))
  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()
  assert.deepEqual(h.outcomes, [null])
  h.cleanup()
})

test('a failed run reports the error that caused it, not a generic failure', async () => {
  const h = open(runner('throw'))
  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()
  assert.equal(h.outcomes.length, 1)
  assert.match((h.outcomes[0] as Error).message, /le modèle a refusé la réponse/)
  h.cleanup()
})

test('reporting is never a dependency — a throwing health board still leaves the gate open', async () => {
  const store = new Store(':memory:')
  const diagnostics = new Diagnostics(store, { environment })
  const enhancement = new Enhancement({
    recipe: () => runner('ok'),
    repEmail: () => 'moi@esn.fr',
    diagnostics,
    onOutcome: () => {
      throw new Error('le bandeau de santé est cassé')
    },
    dispatch: (meetingId, command, reason) => orchestrator.dispatch(meetingId, command, reason),
  })
  const orchestrator: Orchestrator = new Orchestrator(store, {
    diagnostics,
    broadcast: () => {},
    onEnded: async (meetingId) => {
      const session = orchestrator.session(meetingId)
      if (!session) return
      await enhancement.run({
        session,
        context: sampleContext,
        transcript: store.projections.segments(meetingId),
        notes: '',
      })
    },
  })

  orchestrator.create({ id: 'm1', title: 'Point Acme', context: sampleContext })
  orchestrator.dispatch('m1', 'start', null)
  orchestrator.dispatch('m1', 'end', null)
  await settle()

  // A readout that breaks must not cost the compte-rendu it was reporting on.
  assert.equal(orchestrator.stateOf('m1'), 'awaiting_confirmation')
  store.close()
})

/**
 * A recipe that never answers, so a meeting can be caught mid-run — which is
 * the only way to reach the state these last tests are about.
 */
const hangingRunner = (): ExtractionRunner => ({
  run: () => new Promise(() => {}),
})

/**
 * The same wiring `main.ts` builds, over a store that already has a history.
 *
 * This *is* the relaunch: the event log is what survives a quit and the two
 * objects are what do not, so constructing a fresh pair over an existing store
 * reproduces the next launch exactly — including `MeetingSession.load` replaying
 * a meeting straight back into whatever state it was last recorded in.
 */
const relaunch = (store: Store) => {
  const diagnostics = new Diagnostics(store, { environment })
  const recipe = runner()
  const enhancement = new Enhancement({
    recipe: () => recipe,
    repEmail: () => 'moi@esn.fr',
    diagnostics,
    // Pinned, so the elapsed clock the notice draws is assertable rather than
    // "some number near now".
    clock: () => 1_700_000_000_000,
    dispatch: (meetingId, command, reason) => orchestrator.dispatch(meetingId, command, reason),
  })
  const orchestrator: Orchestrator = new Orchestrator(store, {
    diagnostics,
    broadcast: () => {},
    onEnding: (meetingId) => enhancement.begin(meetingId),
    onEnded: async (meetingId) => {
      const session = orchestrator.session(meetingId)
      if (!session) return
      await enhancement.run({
        session,
        context: sampleContext,
        transcript: store.projections.segments(meetingId),
        notes: '',
      })
    },
  })
  const stateOf = (id: string) => store.projections.getMeeting(id)?.state ?? 'idle'
  return {
    enhancement,
    orchestrator,
    recipe,
    stateOf,
    /** What `main.ts` does at boot, on the meetings the last run left behind. */
    reconcileAll: () =>
      store.projections
        .listMeetings(500)
        .filter((meeting) => enhancement.reconcile(meeting.id, meeting.state)).length,
    /** What `main.ts`'s `runEnhancement` does — free it first, then run. */
    retry: async (id: string) => {
      enhancement.reconcile(id, stateOf(id))
      await orchestrator.enhance(id)
    },
  }
}

/** A meeting caught in `extracting`, with the run that put it there abandoned. */
const strandedInExtracting = async () => {
  const store = new Store(':memory:')
  const diagnostics = new Diagnostics(store, { environment })
  const enhancement = new Enhancement({
    recipe: () => hangingRunner(),
    repEmail: () => 'moi@esn.fr',
    diagnostics,
    dispatch: (meetingId, command, reason) => orchestrator.dispatch(meetingId, command, reason),
  })
  const orchestrator: Orchestrator = new Orchestrator(store, {
    diagnostics,
    broadcast: () => {},
    onEnded: async (meetingId) => {
      const session = orchestrator.session(meetingId)
      if (!session) return
      await enhancement.run({
        session,
        context: sampleContext,
        transcript: store.projections.segments(meetingId),
        notes: '',
      })
    },
  })

  const id = 'm1'
  orchestrator.create({ id, title: 'Point Acme', context: sampleContext })
  orchestrator.dispatch(id, 'start', null)
  store.append(id, {
    type: 'transcript.segment',
    segment: {
      id: 's1',
      channel: 'far',
      text: 'on est sur un TJM de 520 euros',
      startMs: 0,
      endMs: 2000,
      isFinal: true,
      provider: 'test',
      receivedAt: 1,
    },
  })
  orchestrator.dispatch(id, 'end', null)
  await settle()

  assert.equal(store.projections.getMeeting(id)?.state, 'extracting')
  return { store, id }
}

test('a compte-rendu interrupted by a quit is freed at the next launch', async () => {
  const { store, id } = await strandedInExtracting()

  // The launch that used to strand it. `extracting` replays out of the log,
  // nothing is running behind it, and every way out is shut: the notice draws a
  // spinner with no control, the gate is closed with *Analyse en cours…*, and
  // `extract` is not legal from `extracting` so the retry is refused before it
  // does anything.
  const next = relaunch(store)
  assert.equal(next.stateOf(id), 'extracting')
  assert.deepEqual(next.enhancement.statusOf(id, 'extracting', true), { status: 'running', since: null })

  assert.equal(next.reconcileAll(), 1)

  // Back where a model timing out would have left it: `ended`, with the reason
  // on screen and the retry legal again.
  assert.equal(next.stateOf(id), 'ended')
  assert.deepEqual(next.enhancement.statusOf(id, next.stateOf(id), true), {
    status: 'failed',
    reason: 'l’application s’est arrêtée pendant la rédaction',
  })
  store.close()
})

test('the transcript and the notes survive the meeting being freed', async () => {
  const { store, id } = await strandedInExtracting()
  const before = store.projections.segments(id)
  assert.ok(before.length > 0)

  const next = relaunch(store)
  next.reconcileAll()

  // Freeing it costs the enhancement and nothing else — the same promise the
  // ordinary failure path makes.
  assert.deepEqual(store.projections.segments(id), before)
  store.close()
})

test('a meeting nothing interrupted is left exactly as it is', async () => {
  const h = open(runner())
  h.orchestrator.dispatch(h.id, 'end', null)
  await settle()
  assert.equal(h.orchestrator.stateOf(h.id), 'awaiting_confirmation')

  // `reconcile` answers about one combination only. A meeting past the gate, or
  // recording, or waiting on a model, must not be touched by a boot sweep.
  for (const state of ['awaiting_confirmation', 'ended', 'recording', 'done'] as const) {
    assert.equal(h.enhancement.reconcile(h.id, state), false)
  }
  assert.equal(h.orchestrator.stateOf(h.id), 'awaiting_confirmation')
  h.cleanup()
})

test('the retry writes the compte-rendu the interrupted run never did', async () => {
  const { store, id } = await strandedInExtracting()
  const next = relaunch(store)

  // Straight to the retry, without a boot sweep — the meeting whose run
  // vanished during *this* session takes this path, and it has to work on its
  // own. Before the fix this called the model zero times and moved nothing.
  await next.retry(id)
  await settle()

  assert.equal(next.recipe.calls, 1)
  assert.equal(next.stateOf(id), 'awaiting_confirmation')
  store.close()
})

test('the status says « en cours » from the end of the meeting, not from the model call', async () => {
  const store = new Store(':memory:')
  const next = relaunch(store)
  const id = 'm1'
  next.orchestrator.create({ id, title: 'Point Acme', context: sampleContext })
  next.orchestrator.dispatch(id, 'start', null)

  // The window `onEnding` exists for: the meeting is `ended`, the transcriber is
  // still being flushed, and no run has started. `statusOf` used to answer
  // `failed` here — a rep who reloaded, or who opened the meeting from
  // Historique at that moment, was told the compte-rendu had not been written
  // and offered a button to write it, while the run was already on its way.
  next.enhancement.begin(id)
  // And it carries the moment the rep pressed *Terminer*, not the moment the
  // model was finally reached: the clock in the notice counts the whole wait,
  // which is the wait the rep is actually having.
  assert.deepEqual(next.enhancement.statusOf(id, 'ended', true), {
    status: 'running',
    since: 1_700_000_000_000,
  })

  next.orchestrator.dispatch(id, 'end', null)
  await settle()
  assert.equal(next.stateOf(id), 'awaiting_confirmation')
  store.close()
})
