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
  assert.deepEqual(h.enhancement.statusOf(h.id, 'extracting', true), { status: 'running' })

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
