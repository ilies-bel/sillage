/**
 * Step 1's acceptance criterion: a fake session can be driven through every
 * transition, the events land in SQLite, and replaying the log reconstructs the
 * state.
 *
 * The coverage assertion at the bottom is the one that keeps this honest — it
 * walks the transition table itself, so an edge added later without a test
 * fails here rather than shipping unexercised.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MeetingSession, TRANSITIONS, nextState, replayState } from '../MeetingSession.ts'
import { Store } from '../../../modules/store/index.ts'
import type { MeetingState, SessionCommand } from '../../../core/contracts/meeting.ts'
import type { PushIntent } from '../../../core/contracts/push.ts'
import { sampleContext, sampleExtraction, sampleVerification } from '../../../core/contracts/fixtures.ts'

let now = 1000
const clock = () => now++

const exercised = new Set<string>()
const edge = (from: MeetingState, command: SessionCommand) => `${from}--${command}`

const open = (id = 'm1') => {
  const store = new Store(':memory:', clock)
  const session = MeetingSession.create(store, { id, title: 'Acme', context: sampleContext }, { clock })
  return { store, session }
}

/** Wraps dispatch so the coverage set records what the tests actually drove. */
const drive = (session: MeetingSession, command: SessionCommand, reason: string | null = null) => {
  const from = session.state
  const outcome = session.dispatch(command, reason)
  if (outcome.ok) exercised.add(edge(from, command))
  return outcome
}

const intent = (id: string, kind: PushIntent['kind'], dependsOn: string[] = []): PushIntent => {
  const base = { id, meetingId: 'm1', dependsOn }
  if (kind === 'mail.draft') {
    return { ...base, kind, payload: { subject: 's', body: 'b', to: ['a@b.fr'] } }
  }
  if (kind === 'crm.opportunity') {
    return {
      ...base,
      kind,
      payload: {
        title: 't',
        description: 'd',
        accountId: 'ACC-1',
        amount: 1,
        currency: 'EUR',
        closingDate: 0,
        contextDescription: '',
        technicalEnvDescription: '',
        profileDescription: '',
        startingDate: null,
      },
    }
  }
  return {
    ...base,
    kind,
    payload: {
      title: 't',
      body: 'b',
      accountId: 'ACC-1',
      opportunityRef: null,
      contactIds: [],
      dueAt: 0,
      endsAt: 0,
    },
  }
}

test('the happy path: armed → recording → ended → extracting → confirmation → pushing → done', () => {
  const { store, session } = open()
  assert.equal(session.state, 'idle')

  drive(session, 'arm', 'event.start − 5 min')
  assert.equal(session.state, 'armed')

  drive(session, 'start')
  assert.equal(session.state, 'recording')

  drive(session, 'end', 'silence + grâce')
  assert.equal(session.state, 'ended')

  // Enhancement fires automatically on end-of-meeting; nothing is surfaced to
  // the rep while the session was recording (DEC-23).
  drive(session, 'extract')
  assert.equal(session.state, 'extracting')

  session.emit({
    type: 'extraction.completed',
    extraction: sampleExtraction,
    verification: sampleVerification,
  })
  drive(session, 'extractionSucceeded')
  assert.equal(session.state, 'awaiting_confirmation')

  session.emit({ type: 'push.intent.created', intent: intent('i-mail', 'mail.draft') })
  session.emit({ type: 'confirmation.recorded', intentIds: ['i-mail'], at: clock() })
  drive(session, 'confirm')
  assert.equal(session.state, 'pushing')

  session.emit({
    type: 'push.settled',
    result: { ok: true, intentId: 'i-mail', remoteId: 'AAMk-1' },
  })
  drive(session, 'pushSettled')
  assert.equal(session.state, 'done')

  // Terminal means terminal: a late module reporting in is rejected, loudly.
  const late = session.dispatch('pushSettled')
  assert.equal(late.ok, false)
  store.close()
})

test('pushing stays pushing until every intent is settled', () => {
  const { store, session } = open()
  drive(session, 'start')
  drive(session, 'end')
  drive(session, 'extract')
  drive(session, 'extractionSucceeded')
  session.emit({ type: 'push.intent.created', intent: intent('i-oppy', 'crm.opportunity') })
  session.emit({ type: 'push.intent.created', intent: intent('i-task', 'crm.task', ['i-oppy']) })
  drive(session, 'confirm')

  session.emit({
    type: 'push.settled',
    result: { ok: true, intentId: 'i-oppy', remoteId: 'OPP-1' },
  })
  drive(session, 'pushSettled')
  assert.equal(session.state, 'pushing', 'the task has not landed yet')

  session.emit({
    type: 'push.settled',
    result: { ok: false, intentId: 'i-task', reason: 'VSA 503', retryable: false },
  })
  drive(session, 'pushSettled')
  // Terminal, not successful: `failed` counts as settled so the session stops
  // spinning, and the row stays visibly failed and retryable in the outbox.
  assert.equal(session.state, 'done')
  store.close()
})

test('a failed extraction returns to ended, so the retry costs the enhancement only', () => {
  const { store, session } = open()
  drive(session, 'start')
  drive(session, 'end')
  drive(session, 'extract')
  drive(session, 'extractionFailed')
  assert.equal(session.state, 'ended', 'DEC-26 — the LLM being down loses nothing')

  drive(session, 'extract')
  drive(session, 'extractionSucceeded')
  assert.equal(session.state, 'awaiting_confirmation')

  // User-initiated regeneration, with the rep's edits as context (DEC-5).
  drive(session, 'extract')
  assert.equal(session.state, 'extracting')
  store.close()
})

test('disarm, manual start, and abort from every non-terminal state', () => {
  {
    const { store, session } = open('m-disarm')
    drive(session, 'arm')
    drive(session, 'disarm')
    assert.equal(session.state, 'idle')
    // Manual start, for a call with no calendar entry.
    drive(session, 'start')
    assert.equal(session.state, 'recording')
    store.close()
  }

  const paths: Array<[string, SessionCommand[]]> = [
    ['m-a1', []],
    ['m-a2', ['arm']],
    ['m-a3', ['start']],
    ['m-a4', ['start', 'end']],
    ['m-a5', ['start', 'end', 'extract']],
    ['m-a6', ['start', 'end', 'extract', 'extractionSucceeded']],
  ]

  for (const [id, prefix] of paths) {
    const { store, session } = open(id)
    for (const command of prefix) drive(session, command)
    drive(session, 'abort', 'fermeture de la fenêtre')
    assert.equal(session.state, 'aborted', `abort from ${session.state}`)
    assert.equal(session.dispatch('start').ok, false, 'aborted is terminal')
    store.close()
  }
})

test('an illegal command is rejected, recorded, and changes nothing', () => {
  const store = new Store(':memory:', clock)
  const recorded: string[] = []
  const session = MeetingSession.create(
    store,
    { id: 'm1', title: 'Acme' },
    { clock, diagnostics: { record: (e) => recorded.push(e.code) } },
  )

  const outcome = session.dispatch('confirm')
  assert.equal(outcome.ok, false)
  assert.equal(session.state, 'idle')
  assert.deepEqual(recorded, ['session.transition.rejected'])
  assert.equal(
    store.log.read('m1').filter((e) => e.event.type === 'session.transition').length,
    0,
    'a rejected command writes no transition',
  )
  store.close()
})

test('replaying the log reconstructs the state', () => {
  const { store, session } = open()
  for (const command of ['arm', 'start', 'end', 'extract', 'extractionSucceeded'] as const) {
    drive(session, command)
  }
  assert.equal(session.state, 'awaiting_confirmation')

  const reloaded = MeetingSession.load(store, 'm1', { clock })
  assert.equal(reloaded?.state, 'awaiting_confirmation')
  assert.equal(replayState(store.log.read('m1')), 'awaiting_confirmation')

  // And it survives a process restart: the projection agrees with the fold.
  assert.equal(store.projections.getMeeting('m1')?.state, 'awaiting_confirmation')
  assert.equal(MeetingSession.load(store, 'inconnu'), null)
  store.close()
})

test('the guard is the only thing that can make one command mean two states', () => {
  assert.equal(nextState('pushing', 'pushSettled', { allIntentsSettled: false }), 'pushing')
  assert.equal(nextState('pushing', 'pushSettled', { allIntentsSettled: true }), 'done')
  assert.equal(nextState('idle', 'confirm', { allIntentsSettled: true }), null)
})

test('every edge in the transition table is exercised above', () => {
  const declared: string[] = []
  for (const [from, commands] of Object.entries(TRANSITIONS)) {
    for (const command of Object.keys(commands)) declared.push(edge(from as MeetingState, command as SessionCommand))
  }
  const missing = declared.filter((e) => !exercised.has(e))
  assert.deepEqual(missing, [], `untested transitions: ${missing.join(', ')}`)
})
