/**
 * IPC is a contract (ARCHITECTURE.md §5.B).
 *
 * The point of these is that main, preload and the renderer are all generated
 * from one table, so the failures worth testing are the structural ones: a
 * channel with no handler, a payload that does not match its schema, and a
 * response that does not match the contract it claims to satisfy.
 *
 * `ipcMain` is injected, which is why this runs without Electron.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handlers, registerIpc, type IpcDeps, type IpcMainLike } from '../register.ts'
import {
  INVOKE_CHANNEL_NAMES,
  invokeChannels,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from '../../../core/contracts/ipc.ts'
import { Store } from '../../../modules/store/index.ts'
import { ONBOARDING_KEY } from '../../../core/contracts/onboarding.ts'
import { Diagnostics } from '../../../modules/diagnostics/index.ts'
import { Orchestrator } from '../../session/Orchestrator.ts'
import type { DiagEnvironment } from '../../../core/contracts/diagnostics.ts'
import type { ExtractionESN, VerificationReport } from '../../../core/contracts/extraction.ts'
import {
  sampleContext,
  sampleExtraction,
  sampleSegment,
  sampleVerification,
} from '../../../core/contracts/fixtures.ts'
import { providerRows } from '../../../core/domain/providerRows.ts'
import { STT_PROVIDERS } from '../../../modules/transcribe/registry.ts'
import { LLM_PROVIDERS } from '../../../modules/llm/registry.ts'
import { intentIdFor, prefillEdits } from '../../../core/domain/reviewGate.ts'

const environment: DiagEnvironment = {
  appVersion: '3.0.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  electron: '43.1.0',
  node: '24.18.0',
  nativeArch: 'x64',
}

class FakeIpcMain implements IpcMainLike {
  routes = new Map<string, (event: unknown, payload: unknown) => unknown>()
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown) {
    if (this.routes.has(channel)) throw new Error(`canal enregistré deux fois: ${channel}`)
    this.routes.set(channel, listener)
  }
  /** Typed exactly like the preload bridge, so the tests exercise real types. */
  async invoke<C extends InvokeChannel>(
    channel: C,
    payload: InvokeRequest<C>,
  ): Promise<InvokeResponse<C>> {
    const route = this.routes.get(channel)
    if (!route) throw new Error(`canal non enregistré: ${channel}`)
    return (await route(null, payload)) as InvokeResponse<C>
  }
}

/**
 * A rep who is signed into Microsoft.
 *
 * `open()` deliberately leaves `identity` null — that is the build the first
 * demo ships in (DEC-28) and every channel has to answer in it. But an Outlook
 * draft genuinely cannot be created without an account, so a test that expects
 * one has to say the rep has one. It used to not need saying, and the gate
 * offered a draft it could not create.
 */
const signIn = (deps: IpcDeps) => {
  deps.identity = {
    account: () => ({
      homeAccountId: 'a-1',
      username: 'julien.marchand@synapse-it.fr',
      name: 'Julien Marchand',
      tenantId: 't-1',
    }),
    signIn: async () => {
      throw new Error('jamais appelé ici')
    },
    signOut: async () => {},
    token: async () => 'jeton',
  }
}

const open = () => {
  let now = 1000
  const clock = () => now++
  const directory = mkdtempSync(join(tmpdir(), 'ipc-'))
  const store = new Store(':memory:', clock)
  const diagnostics = new Diagnostics(store, { environment, clock })
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const orchestrator = new Orchestrator(store, {
    diagnostics,
    clock,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  })
  const deps: IpcDeps = {
    store,
    orchestrator,
    diagnostics,
    recorder: diagnostics,
    exportDirectory: directory,
    clock,
  }
  const ipc = new FakeIpcMain()
  registerIpc(ipc, deps)
  return {
    ipc,
    deps,
    broadcasts,
    cleanup: () => {
      store.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('every declared channel has a handler and is registered exactly once', () => {
  const { ipc, cleanup } = open()
  assert.deepEqual([...ipc.routes.keys()].sort(), [...INVOKE_CHANNEL_NAMES].sort())
  assert.deepEqual(Object.keys(handlers).sort(), [...INVOKE_CHANNEL_NAMES].sort())
  cleanup()
})

test('a request is parsed at the boundary, defaults and all', async () => {
  const { ipc, deps, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })

  // `limit` defaults to 50 in the contract, so an empty payload is valid.
  const meetings = await ipc.invoke('meeting:list', {})
  assert.equal(meetings.length, 1)

  await assert.rejects(() => Promise.resolve(ipc.invoke('meeting:list', { limit: 10_000 })))
  await assert.rejects(() => Promise.resolve(ipc.invoke('meeting:get', { meetingId: '' })))
  cleanup()
})

/*
 * ── a refusal is not a failure ──────────────────────────────────────────────
 *
 * Every rejection is logged (DEC-27), and every *stated reason* is a rejection:
 * DEC-26 fills this app with sentences composed on purpose for a rep to read,
 * and each crosses the boundary as a thrown `Error` because that is how a
 * promise says no. Logged at `error` they wrote red lines into the diagnostics
 * bundle beside « le module audio natif ne se charge pas », and a bundle where
 * the product working and the product broken look the same is the evidence
 * nobody can read on a support call. The end-to-end run found two on a clean
 * first launch, both of them the app behaving exactly as designed.
 */
test('a stated reason is recorded as one, and still rejects', async () => {
  const { ipc, deps, cleanup } = open()
  await assert.rejects(() => Promise.resolve(ipc.invoke('meeting:get', { meetingId: 'inconnu' })))
  const recent = deps.diagnostics.recent()
  assert.equal(recent[0]?.code, 'ipc.handler.refused')
  assert.equal(recent[0]?.severity, 'info')
  assert.equal(recent[0]?.detail.channel, 'meeting:get')
  cleanup()
})

test('a fault the app did not compose stays an error', async () => {
  const { ipc, deps, cleanup } = open()
  // A payload the contract refuses: nothing in the app wrote this sentence, so
  // it is not a sentence for a rep and the severity has to say so.
  await assert.rejects(() =>
    Promise.resolve(ipc.invoke('meeting:get', { meetingId: 42 } as never)),
  )
  const recent = deps.diagnostics.recent()
  assert.equal(recent[0]?.code, 'ipc.handler.failed')
  assert.equal(recent[0]?.severity, 'error')
  cleanup()
})

test('session:command drives the machine and broadcasts the new state', async () => {
  const { ipc, deps, broadcasts, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })

  const started = await ipc.invoke('session:command', { meetingId: 'm1', command: 'start' })
  assert.deepEqual(started, { ok: true, state: 'recording' })
  assert.deepEqual(broadcasts.at(-1), {
    channel: 'session:changed',
    payload: { meetingId: 'm1', state: 'recording' },
  })

  // A rejected transition is a response, not an exception — the renderer needs
  // to render it, not catch it.
  const illegal = await ipc.invoke('session:command', { meetingId: 'm1', command: 'confirm' })
  assert.equal(illegal.ok, false)
  assert.equal(illegal.state, 'recording')

  // The renderer cannot fabricate a command only a module may report.
  await assert.rejects(() =>
    Promise.resolve(
      // @ts-expect-error `extractionSucceeded` is not in the user subset
      ipc.invoke('session:command', { meetingId: 'm1', command: 'extractionSucceeded' }),
    ),
  )
  cleanup()
})

test('document:save persists a revision and meeting:get reads it back', async () => {
  const { ipc, deps, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme' })

  const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
  assert.deepEqual(await ipc.invoke('document:save', { meetingId: 'm1', revision: 7, doc }), {
    revision: 7,
  })

  const read = await ipc.invoke('meeting:get', { meetingId: 'm1' })
  assert.deepEqual(read.document, doc)
  assert.equal(read.meeting.title, 'Acme')
  cleanup()
})

test('health starts honest: capture ok, every network connector down with a reason', async () => {
  const { ipc, cleanup } = open()
  const snapshot = await ipc.invoke('health:snapshot', {})

  assert.deepEqual(snapshot.capture, { state: 'ok' })
  for (const connector of ['transcribe', 'calendar', 'llm', 'crm', 'mail'] as const) {
    const health = snapshot[connector]
    assert.ok(health && health.state === 'down', `${connector} should start down`)
    // DEC-26: a disabled control always states why. The type makes it mandatory;
    // this checks nobody satisfied the type with an empty string.
    assert.ok(health.reason.length > 0, `${connector} is down without a reason`)
  }
  cleanup()
})

test('health:retry runs the registered retry and broadcasts the result', async () => {
  const { ipc, deps, broadcasts, cleanup } = open()
  deps.orchestrator.registerRetry('crm', async () => ({ state: 'ok' }))

  assert.deepEqual(await ipc.invoke('health:retry', { connector: 'crm' }), { state: 'ok' })
  assert.equal(broadcasts.at(-1)?.channel, 'health:changed')

  deps.orchestrator.registerRetry('mail', async () => {
    throw new Error('jeton expiré')
  })
  const failed = await ipc.invoke('health:retry', { connector: 'mail' })
  assert.ok(failed.state === 'down', 'a throwing retry leaves the connector down')
  // The clause is ours; the throw's own text follows it. A retry that fails
  // against Graph throws Microsoft's English, and this reason is drawn verbatim
  // on the onboarding rows and Réglages' connector cards.
  assert.equal(failed.reason, 'nouvelle tentative échouée — jeton expiré')
  assert.ok(failed.retryable, 'and offers another attempt — never a dead button')
  cleanup()
})

test('every response is validated against the contract on the way out', async () => {
  const { ipc, cleanup } = open()
  // A handler returning the wrong shape must fail here rather than reaching the
  // renderer as an untyped object.
  assert.throws(() => invokeChannels['health:snapshot'].response.parse({ crm: { state: 'nope' } }))
  const snapshot = await ipc.invoke('health:snapshot', {})
  assert.doesNotThrow(() => invokeChannels['health:snapshot'].response.parse(snapshot))
  cleanup()
})

test('diagnostics:export writes a bundle and reports what went into it', async () => {
  const { ipc, deps, cleanup } = open()
  deps.diagnostics.record({ severity: 'info', code: 'a.b', module: 'test', message: 'x' })

  const result = await ipc.invoke('diagnostics:export', { mode: 'redacted' })
  assert.ok(result.path.endsWith('.ndjson'))
  assert.ok(result.events >= 1)
  cleanup()
})

// ── Starting a meeting by hand ──────────────────────────────────────────────
//
// Without an Entra registration there is no calendar, so `meeting:create` is
// not a fallback path — it is the only way a session begins. These check the
// two things that would make it quietly wrong rather than loudly broken.

test('a meeting started by hand has no event id and survives a projection rebuild', async () => {
  const { ipc, deps, cleanup } = open()

  const meeting = await ipc.invoke('meeting:create', {
    title: 'Point Acme',
    clientName: 'Acme SA',
  })

  assert.equal(meeting.title, 'Point Acme')
  assert.equal(meeting.clientName, 'Acme SA')
  assert.equal(meeting.eventId, null)
  assert.equal(meeting.state, 'idle')
  assert.match(meeting.id, /^man-/)

  // The client name has to come back from a fold of the log, not from a row
  // somebody wrote once. A direct write would pass every assertion above and
  // then vanish here.
  deps.store.projections.rebuild()
  assert.equal(deps.store.projections.getMeeting(meeting.id)?.clientName, 'Acme SA')

  cleanup()
})

test('a manual meeting is a real session — it can be started and ended', async () => {
  const { ipc, cleanup } = open()

  const meeting = await ipc.invoke('meeting:create', { title: 'Appel entrant', clientName: null })
  assert.equal(meeting.clientName, null)

  const started = await ipc.invoke('session:command', {
    meetingId: meeting.id,
    command: 'start',
    reason: null,
  })
  assert.equal(started.ok, true)
  assert.equal(started.state, 'recording')

  cleanup()
})

// This used to assert the opposite — that a blank title was refused here. It
// was refused *because* the schema said `min(1)`, and the one caller that could
// not satisfy it was *Démarrer une réunion*, which is the product's whole
// gesture: one click, no form. The requirement did not disappear; it moved to
// the place that can state it instead of only throwing (see the gate below).
test('a blank title is what Démarrer sends, and it is stored blank rather than named', async () => {
  const { ipc, cleanup } = open()
  const meeting = await ipc.invoke('meeting:create', { title: '   ', clientName: null })
  // Blank, not « Réunion sans titre » — a placeholder that is stored is
  // indistinguishable from a title the rep chose.
  assert.equal(meeting.title, '')
  cleanup()
})

// ── The review gate ─────────────────────────────────────────────────────────
//
// The only human confirmation in the product (DEC-4), so these check the four
// things that would make it quietly wrong: surfacing during a call (DEC-23),
// a self-reported confidence (DEC-21), an unchecked intent shipping anyway
// (DEC-20), and the model's original outliving the rep's correction.

const atGate = (
  deps: IpcDeps,
  meetingId: string,
  extraction: ExtractionESN = sampleExtraction,
  verification: VerificationReport = sampleVerification,
): void => {
  deps.orchestrator.create({ id: meetingId, title: 'Acme', context: sampleContext })
  deps.orchestrator.dispatch(meetingId, 'start')
  deps.orchestrator.dispatch(meetingId, 'end')
  deps.orchestrator.dispatch(meetingId, 'extract')
  deps.orchestrator
    .session(meetingId)
    ?.emit({ type: 'extraction.completed', extraction, verification })
  deps.orchestrator.dispatch(meetingId, 'extractionSucceeded')
}

/** Every `push.intent.created` in a meeting's log, in the order it was written. */
const createdIntents = (deps: IpcDeps, meetingId: string) =>
  deps.store.log
    .read(meetingId)
    .map((stored) => stored.event)
    .filter((event) => event.type === 'push.intent.created')
    .map((event) => (event.type === 'push.intent.created' ? event.intent : null))
    .filter((intent) => intent !== null)

const editsFor = async (ipc: FakeIpcMain, meetingId: string) => {
  const snapshot = await ipc.invoke('review:get', { meetingId })
  assert.ok(snapshot.open, 'the gate should be open')
  return snapshot.panel
}

test('DEC-23: nothing from the gate exists while the meeting is recording', async () => {
  const { ipc, deps, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })
  deps.orchestrator.dispatch('m1', 'start')

  const snapshot = await ipc.invoke('review:get', { meetingId: 'm1' })

  assert.equal(snapshot.open, false)
  assert.equal(snapshot.open === false && snapshot.state, 'recording')
  // Not "hidden": there is no panel in the response to hide. A renderer cannot
  // derive a badge, a count or a field name from what it was sent.
  assert.equal('panel' in snapshot, false)
  assert.ok(snapshot.open === false && snapshot.reason.length > 0)

  cleanup()
})

test('DEC-23: confirming mid-call is refused before a single event is written', async () => {
  const { ipc, deps, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })
  deps.orchestrator.dispatch('m1', 'start')
  deps.orchestrator.session('m1')?.emit({
    type: 'extraction.completed',
    extraction: sampleExtraction,
    verification: sampleVerification,
  })

  const before = deps.store.log
    .read('m1')
    .filter((s) => s.event.type !== 'diag')
    .map((s) => s.event.type)
  const confirmed = await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: {
      taskName: 'Acme',
      accountId: 'ACC-1042',
      accountName: 'Acme Industries',
      compteRendu: '# Acme',
      besoin: 'x',
      profils: '',
      modeCollaboration: 'régie',
      tjm: '',
      dateDemarrage: '',
      dureeMission: '',
      contexteTechnique: '',
      objections: '',
      prochainesEtapes: '',
      montant: null,
      devise: 'EUR',
      mailSubject: 'Suite',
      mailBody: 'Bonjour',
    },
    intentIds: [intentIdFor('m1', 'crm.task')],
  })

  assert.equal(confirmed.ok, false)
  assert.equal(confirmed.state, 'recording')
  // Nothing but the rejected transition's diagnostic (DEC-27) was written.
  assert.deepEqual(
    deps.store.log
      .read('m1')
      .filter((s) => s.event.type !== 'diag')
      .map((s) => s.event.type),
    before,
  )
  assert.equal(createdIntents(deps, 'm1').length, 0)
  assert.equal(deps.store.projections.outboxFor('m1').length, 0)

  cleanup()
})

test('the open gate pre-fills every field and cites a source for the interpretive ones', async () => {
  const { ipc, deps, cleanup } = open()
  signIn(deps)
  atGate(deps, 'm1')

  const panel = await editsFor(ipc, 'm1')

  // DEC-21: no blanks. The rep always has a starting point.
  assert.equal(panel.edits.accountName, 'Acme Industries')
  assert.equal(panel.edits.besoin, "Renfort de l'équipe plateforme")
  assert.match(panel.edits.profils, /2 × Dev Java/)
  assert.match(panel.edits.tjm, /520/)
  assert.match(panel.edits.compteRendu, /^# /)
  assert.ok(panel.edits.mailSubject.length > 0 && panel.edits.mailBody.length > 0)

  // Every interpretive row offers its span; the two deterministic rows have
  // none because nobody read them off the call (DEC-7).
  for (const field of panel.fields) {
    const deterministic = field.key === 'taskName' || field.key === 'account'
    assert.equal(
      field.span === null,
      deterministic,
      `${field.key} should ${deterministic ? 'not ' : ''}cite a span`,
    )
  }

  assert.deepEqual(panel.mailTo, ['camille.leroy@acme-industries.fr'])
  assert.deepEqual(
    panel.intents.map((i) => i.kind),
    ['crm.task', 'crm.opportunity', 'mail.draft'],
  )
  assert.ok(panel.intents.every((i) => i.available))

  cleanup()
})

test('DEC-21: ⚠ faible on the account is measured, and a resolved account carries none', async () => {
  const { ipc, deps, cleanup } = open()

  atGate(deps, 'strong')
  const strong = await editsFor(ipc, 'strong')
  assert.equal(strong.fields.find((f) => f.key === 'account')?.confidence, 'ok')

  // Weak: entity resolution matched a candidate but is not sure of it, so the
  // name is pre-filled and carries `⚠ faible` — which is the half of DEC-18
  // that survives. `UNRESOLVED_ACCOUNT` (nothing matched at all) is blank; see
  // the boundary test above.
  const unresolved: ExtractionESN = {
    ...sampleExtraction,
    facts: {
      ...sampleExtraction.facts,
      account: { accountId: null, name: 'Acme Holding', confidence: 'faible' },
    },
  }
  atGate(deps, 'weak', unresolved, { fields: { besoin: 'faible' }, overall: 'faible' })
  const weak = await editsFor(ipc, 'weak')

  assert.equal(weak.fields.find((f) => f.key === 'account')?.confidence, 'faible')
  assert.equal(weak.edits.accountName, 'Acme Holding', 'a candidate is pre-filled, marked faible')
  // And the marker really is read off the report, not off the model: `besoin`
  // is `faible` here only because its quote could not be located.
  assert.equal(weak.fields.find((f) => f.key === 'besoin')?.confidence, 'faible')
  assert.equal(weak.fields.find((f) => f.key === 'contexteTechnique')?.confidence, 'ok')

  // DEC-20: no opportunity against an unresolved account, and it says why.
  const opportunity = weak.intents.find((i) => i.kind === 'crm.opportunity')
  assert.equal(opportunity?.available, false)
  assert.ok((opportunity?.reason ?? '').length > 0)

  cleanup()
})

test('DEC-4: one Valider ships everything checked, together', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  const confirmed = await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: panel.edits,
    intentIds: panel.intents.map((i) => i.id),
  })

  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.ok === true && confirmed.state, 'pushing')
  assert.deepEqual(
    createdIntents(deps, 'm1').map((i) => i.kind),
    ['crm.task', 'crm.opportunity', 'mail.draft'],
  )

  // The task waits on the opportunity that carries its reference; the draft is
  // independent and drains whatever the CRM is doing (DEC-20, DEC-26).
  const outbox = deps.store.projections.outboxFor('m1')
  assert.equal(outbox.find((o) => o.kind === 'crm.task')?.state, 'blocked')
  assert.equal(outbox.find((o) => o.kind === 'crm.opportunity')?.state, 'pending')
  assert.equal(outbox.find((o) => o.kind === 'mail.draft')?.state, 'pending')

  // Asked exactly once. A second confirmation is not legal from `pushing`.
  const again = await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: panel.edits,
    intentIds: panel.intents.map((i) => i.id),
  })
  assert.equal(again.ok, false)
  assert.equal(createdIntents(deps, 'm1').length, 3)

  cleanup()
})

test('DEC-20: an unchecked intent is absent from intentIds and never created', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  const opportunityId = intentIdFor('m1', 'crm.opportunity')
  const kept = panel.intents.map((i) => i.id).filter((id) => id !== opportunityId)

  const confirmed = await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: panel.edits,
    intentIds: kept,
  })

  assert.equal(confirmed.ok, true)
  assert.deepEqual(confirmed.ok === true && confirmed.intentIds, kept)

  const created = createdIntents(deps, 'm1')
  assert.deepEqual(
    created.map((i) => i.kind),
    ['crm.task', 'mail.draft'],
  )

  // Recorded, not inferred: the confirmation event carries what was left
  // checked rather than leaving a reader to notice a missing row.
  const recorded = deps.store.log
    .read('m1')
    .map((s) => s.event)
    .find((e) => e.type === 'confirmation.recorded')
  assert.ok(recorded && recorded.type === 'confirmation.recorded')
  assert.deepEqual(recorded.intentIds, kept)
  assert.equal(recorded.intentIds.includes(opportunityId), false)

  // And the task no longer waits on an opportunity nobody is creating — it
  // would sit `blocked` forever otherwise.
  const task = created.find((i) => i.kind === 'crm.task')
  assert.deepEqual(task?.dependsOn, [])
  assert.equal(task?.kind === 'crm.task' && task.payload.opportunityRef, null)
  assert.equal(deps.store.projections.outboxFor('m1').find((o) => o.kind === 'crm.task')?.state, 'pending')

  cleanup()
})

test('an edited field is what gets sent, not the model’s original', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: {
      ...panel.edits,
      taskName: 'Acme — cadrage renfort',
      accountId: 'ACC-9',
      accountName: 'Acme Industries SAS',
      compteRendu: '# Corrigé par le commercial\n',
      besoin: 'Trois développeurs, pas deux',
      montant: 540,
      mailSubject: 'Suite à notre point',
      mailBody: 'Bonjour Camille, comme convenu…',
    },
    intentIds: panel.intents.map((i) => i.id),
  })

  const created = createdIntents(deps, 'm1')
  const task = created.find((i) => i.kind === 'crm.task')
  assert.ok(task && task.kind === 'crm.task')
  assert.equal(task.payload.title, 'Acme — cadrage renfort')
  assert.equal(task.payload.body, '# Corrigé par le commercial\n')
  assert.equal(task.payload.accountId, 'ACC-9')

  const opportunity = created.find((i) => i.kind === 'crm.opportunity')
  assert.ok(opportunity && opportunity.kind === 'crm.opportunity')
  assert.equal(opportunity.payload.amount, 540)
  assert.match(opportunity.payload.description, /Trois développeurs/)

  const mail = created.find((i) => i.kind === 'mail.draft')
  assert.ok(mail && mail.kind === 'mail.draft')
  assert.equal(mail.payload.subject, 'Suite à notre point')
  // HR-8: recipients are deterministic and are not taken from the renderer.
  assert.deepEqual(mail.payload.to, ['camille.leroy@acme-industries.fr'])

  cleanup()
})

// This too used to assert a rejection, on the strength of DEC-18's "never an
// empty account field". What was keeping that literally true was « Client à
// confirmer » pre-filled into the name — a sentence that then travelled into
// `meetings.client_name` and the lexicon's per-client scope as though it were a
// company. `⚠ faible` on the row is the part of DEC-18 that was doing the work,
// and it is untouched. The account gate is `accountId`, which is null exactly
// when nothing was resolved (DEC-20).
test('a blank account name is not a schema error — accountId is the gate, not the label', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: { ...panel.edits, accountName: '   ' },
    intentIds: panel.intents.map((i) => i.id),
  })

  // The rep cleared a label; they did not un-resolve the account. Both intents
  // still ship, against the id they were resolved to.
  const created = createdIntents(deps, 'm1')
  const task = created.find((i) => i.kind === 'crm.task')
  assert.ok(task && task.kind === 'crm.task')
  assert.equal(task.payload.accountId, 'ACC-1042')
  assert.ok(created.some((i) => i.kind === 'crm.opportunity'))

  cleanup()
})

// The other half of the move: the requirement VSA really has — a task needs a
// name — is now stated on the row rather than thrown at the boundary. This is
// the DEC-26 shape every other unavailable intent on this screen already has.
test('no objet: the gate asks for one on the row instead of refusing the confirmation', async () => {
  const { ipc, deps, cleanup } = open()
  const untitled: ExtractionESN = {
    ...sampleExtraction,
    facts: { ...sampleExtraction.facts, taskName: '' },
  }
  atGate(deps, 'm1', untitled)
  const panel = await editsFor(ipc, 'm1')

  const task = panel.intents.find((i) => i.kind === 'crm.task')
  assert.equal(task?.available, false)
  assert.match(task?.reason ?? '', /objet/i)

  // And the opportunity goes with it — VSA has neither without a name — while
  // naming the account first when that is also missing is a separate case.
  assert.equal(panel.intents.find((i) => i.kind === 'crm.opportunity')?.available, false)

  // Confirming anyway is accepted and simply writes no CRM intent. Refusing
  // here would lose the compte-rendu the rep is holding.
  await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: panel.edits,
    intentIds: panel.intents.map((i) => i.id),
  })
  const kinds = createdIntents(deps, 'm1').map((i) => i.kind)
  assert.equal(kinds.includes('crm.task'), false)
  assert.equal(kinds.includes('crm.opportunity'), false)

  cleanup()
})

test('confirming starts the drain — the rep is never asked a second time', async () => {
  // DEC-4. One button ships everything checked; whatever fails from there
  // retries in the background and surfaces in the health strip, so the handler
  // must hand off rather than wait.
  const { ipc, deps, cleanup } = open()
  const drained: string[] = []
  deps.drain = (meetingId) => drained.push(meetingId)

  const id = 'm1'
  deps.orchestrator.create({ id, title: 'Acme', context: sampleContext })
  deps.orchestrator.dispatch(id, 'start', null)
  deps.orchestrator.dispatch(id, 'end', null)
  deps.store.append(id, {
    type: 'extraction.completed',
    extraction: sampleExtraction,
    verification: sampleVerification,
  })
  deps.orchestrator.dispatch(id, 'extract', null)
  deps.orchestrator.dispatch(id, 'extractionSucceeded', null)

  const snapshot = await ipc.invoke('review:get', { meetingId: id })
  assert.equal(snapshot.open, true)
  if (!snapshot.open) return

  // Everything drafted is checked by default (DEC-20 drafts all three and lets
  // the rep remove one), so `available` is what "checked" means here.
  const checked = snapshot.panel.intents.filter((i) => i.available).map((i) => i.id)
  const result = await ipc.invoke('review:confirm', {
    meetingId: id,
    edits: snapshot.panel.edits,
    intentIds: checked,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(drained, [id])
  cleanup()
})

test('a refused confirmation does not start a drain', async () => {
  // Mid-call (DEC-23) or already confirmed: nothing was written, so there is
  // nothing to send, and kicking the outbox would be a request against the
  // client's CRM for a meeting that never reached the gate.
  const { ipc, deps, cleanup } = open()
  const drained: string[] = []
  deps.drain = (meetingId) => drained.push(meetingId)

  const id = 'm2'
  deps.orchestrator.create({ id, title: 'Acme', context: sampleContext })
  deps.orchestrator.dispatch(id, 'start', null)

  // A *valid* payload, so the refusal comes from the state machine and not from
  // the schema — otherwise this would pass without ever reaching the handler.
  const result = await ipc.invoke('review:confirm', {
    meetingId: id,
    edits: prefillEdits(sampleExtraction, '# Compte-rendu'),
    intentIds: [],
  })

  assert.equal(result.ok, false)
  assert.deepEqual(drained, [])
  cleanup()
})

// ── Historique (DEC-25) ─────────────────────────────────────────────────────
//
// The screen is a reader over the event log, so these check the two things that
// would make it quietly wrong: a search that misses what it should find, and a
// search that answers by shipping the corpus to the renderer.

/** A meeting with a transcript, typed notes and — optionally — an extraction. */
const captured = (
  deps: IpcDeps,
  id: string,
  spoken: string,
  typed: string,
  withExtraction = false,
  clientName: string | null = null,
): void => {
  deps.orchestrator.create({ id, title: 'Acme', context: sampleContext, clientName })
  deps.orchestrator.dispatch(id, 'start', null)
  deps.orchestrator.session(id)?.emit({
    type: 'transcript.segment',
    segment: { ...sampleSegment, id: `${id}-seg`, text: spoken },
  })
  deps.orchestrator.saveDocument(id, 1, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: typed }] }],
  })
  deps.orchestrator.dispatch(id, 'end', null)
  if (withExtraction) {
    deps.store.append(id, {
      type: 'extraction.completed',
      extraction: sampleExtraction,
      verification: sampleVerification,
    })
  }
}

test('an empty query lists every call, newest first, with no excerpts', async () => {
  const { ipc, deps, cleanup } = open()
  captured(deps, 'm1', 'bonjour', 'note un')
  captured(deps, 'm2', 'au revoir', 'note deux')

  const result = await ipc.invoke('history:search', {})

  assert.equal(result.rows.length, 2)
  assert.equal(result.query, '')
  // No query, no excerpts: the rows are a listing, not a set of results.
  assert.ok(result.rows.every((row) => row.matches.length === 0))
  cleanup()
})

test('search matches the transcript and the rep’s notes, and says which', async () => {
  const { ipc, deps, cleanup } = open()
  captured(deps, 'spoken', 'on part sur un TJM de 520 euros', 'rien de particulier')
  captured(deps, 'typed', 'bonjour à tous', 'penser au TJM avant la relance')
  captured(deps, 'neither', 'rien de tel ici', 'ni ici')

  const result = await ipc.invoke('history:search', { query: 'TJM' })

  assert.deepEqual(
    result.rows.map((row) => row.meeting.id).sort(),
    ['spoken', 'typed'],
    'both surfaces are searched, and only they matched',
  )
  const spoken = result.rows.find((row) => row.meeting.id === 'spoken')
  const typed = result.rows.find((row) => row.meeting.id === 'typed')
  assert.deepEqual(
    spoken?.matches.map((m) => m.where),
    ['transcript'],
  )
  assert.deepEqual(
    typed?.matches.map((m) => m.where),
    ['notes'],
  )
  // The excerpt is the evidence, and it is short: what crosses IPC is a window
  // around the hit, never the surface it was found in.
  assert.match(spoken?.matches[0]?.excerpt ?? '', /TJM de 520/)
  assert.ok((spoken?.matches[0]?.excerpt.length ?? 0) < 120)
  cleanup()
})

test('the compte-rendu is searched too, and accents do not have to be typed', async () => {
  const { ipc, deps, cleanup } = open()
  captured(deps, 'm1', 'rien', 'rien', true)

  // `sampleExtraction`'s compte-rendu says « Renfort de deux profils Java ».
  const accented = await ipc.invoke('history:search', { query: 'Renfort' })
  assert.deepEqual(
    accented.rows[0]?.matches.map((m) => m.where),
    ['compteRendu'],
  )

  // A rep who types `equipe` means `équipe`. The transcript fixture is not
  // involved here — the account subject is, via the rendered compte-rendu.
  const folded = await ipc.invoke('history:search', { query: 'JAVA' })
  assert.equal(folded.rows.length, 1, 'case is folded too')
  cleanup()
})

test('the search happens in the main process: no transcript crosses the boundary', async () => {
  const { ipc, deps, cleanup } = open()
  const tail = 'et Camille reprendra contact la semaine prochaine pour la suite du dossier'
  captured(deps, 'm1', `on part sur un TJM de 520 euros par jour. ${tail}`, 'rien')

  const result = await ipc.invoke('history:search', { query: 'TJM' })

  // `scanned` is the observable proof the main process read the corpus.
  assert.equal(result.scanned, 1)
  // And the response contains no `segments`, no document and no full text —
  // shipping those so the renderer could filter would put every client
  // conversation in a devtools console. What travels is a window around the
  // hit; the rest of what was said stays on this side of the boundary.
  const serialised = JSON.stringify(result)
  assert.equal(serialised.includes(tail), false, 'the tail of the segment did not travel')
  assert.equal(serialised.includes('segments'), false)
  cleanup()
})

/**
 * **A disabled row names the blocker that is actually in the way** (DEC-26).
 *
 * « Aucun destinataire au calendrier. » was the only sentence the Outlook row
 * had, and on the build the first demo ships in (DEC-28) it is a true statement
 * about the wrong thing: there is no Entra registration, so there is no calendar
 * for a meeting to have attendees in *and* no account to draft from. A rep reads
 * it and goes looking for people to add to the invitation — a search that cannot
 * succeed, because adding ten attendees would change nothing.
 *
 * Both causes are real and they have different remedies, so the deeper one is
 * named first.
 */
test('with no Microsoft account the Outlook row says so, not that nobody is invited', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')

  const panel = await editsFor(ipc, 'm1')
  const mail = panel.intents.find((intent) => intent.kind === 'mail.draft')

  assert.equal(mail?.available, false)
  assert.equal(mail?.reason, 'Aucun compte Microsoft connecté.')

  // And the two VerySwing intents are untouched by it — the CRM does not go
  // through Microsoft, and an optional connector never disables another (DEC-26).
  assert.ok(panel.intents.filter((i) => i.kind !== 'mail.draft').every((i) => i.available))
  cleanup()
})

/**
 * First run (`core/contracts/onboarding.ts`).
 *
 * Two properties, and the second is the one worth a test: a preference that
 * cannot be read must not be able to hold the window shut. `JSON.parse` throws
 * before any schema sees the string, so one corrupt row is the whole distance
 * between « show the onboarding again » and « the app does not open ».
 */
test('onboarding is unseen on a fresh install and stays seen once recorded', async () => {
  const { ipc, cleanup } = open()

  assert.deepEqual(await ipc.invoke('onboarding:state', {}), { seen: false })
  assert.deepEqual(await ipc.invoke('onboarding:seen', {}), { seen: true })
  assert.deepEqual(await ipc.invoke('onboarding:state', {}), { seen: true })

  cleanup()
})

test('a corrupt preference shows the onboarding again rather than throwing', async () => {
  const { ipc, deps, cleanup } = open()
  deps.store.appState.set(ONBOARDING_KEY, 'pas du json')

  assert.deepEqual(await ipc.invoke('onboarding:state', {}), { seen: false })

  // And valid JSON of the wrong shape lands in the same place, through the
  // schema rather than through the throw.
  deps.store.appState.set(ONBOARDING_KEY, '{"seen":"oui"}')
  assert.deepEqual(await ipc.invoke('onboarding:state', {}), { seen: false })

  cleanup()
})

test('a row carries the push status of each intent', async () => {
  const { ipc, deps, cleanup } = open()
  // The mail draft is one of the three statuses this row reports, and it is only
  // drafted when there is an account to draft from.
  signIn(deps)
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')
  await ipc.invoke('review:confirm', {
    meetingId: 'm1',
    edits: panel.edits,
    intentIds: panel.intents.filter((i) => i.available).map((i) => i.id),
  })
  deps.store.append('m1', {
    type: 'push.settled',
    result: { ok: false, intentId: intentIdFor('m1', 'mail.draft'), reason: 'jeton expiré', retryable: false },
  })

  const row = (await ipc.invoke('history:search', {})).rows[0]

  assert.deepEqual(
    row?.intents.map((i) => i.kind),
    ['crm.task', 'crm.opportunity', 'mail.draft'],
  )
  const mail = row?.intents.find((i) => i.kind === 'mail.draft')
  assert.equal(mail?.state, 'failed')
  // A failed push without its reason is the dead control DEC-26 forbids.
  assert.equal(mail?.lastError, 'jeton expiré')
  assert.ok((mail?.label ?? '').length > 0)
  cleanup()
})

test('an expanded row is the four sections of DEC-25', async () => {
  const { ipc, deps, cleanup } = open()
  captured(deps, 'm1', 'on est plutôt sur un TJM de 520 euros', 'à rappeler jeudi', true)

  const record = await ipc.invoke('history:record', { meetingId: 'm1' })

  // 1. the transcript, with its speaker channel
  assert.equal(record.segments.length, 1)
  assert.equal(record.segments[0]?.channel, 'far')
  // 2. the rep's raw notes, still exactly what was typed (DEC-5)
  assert.equal(record.notes, 'à rappeler jeudi')
  // 3. the enhanced compte-rendu
  assert.match(record.compteRendu ?? '', /Renfort/)
  // 4. the extraction, each interpretive field citing a span (DEC-21)
  const besoin = record.fields.find((f) => f.key === 'besoin')
  assert.equal(besoin?.span?.quote, 'on est plutôt sur un TJM de 520 euros')
  assert.equal(record.fields.find((f) => f.key === 'account')?.span, null)
  cleanup()
})

/*
 * `review:transcript` — the reader behind `source ▸` at the gate (DEC-21).
 *
 * It is the same rows `spanVerification.ts` checked the quote against, which is
 * the whole warrant for the affordance: a citation a rep follows has to land in
 * the text the app verified, not in a second, prettier copy of it.
 */
test('the gate can read the transcript its citations were verified against', async () => {
  const { ipc, deps, cleanup } = open()
  captured(deps, 'm1', 'on est plutôt sur un TJM de 520 euros', 'à rappeler jeudi', true)

  const view = await ipc.invoke('review:transcript', { meetingId: 'm1' })
  const record = await ipc.invoke('history:record', { meetingId: 'm1' })

  // The same segments, and every one of them final — an interim is never
  // persisted and can never be cited.
  assert.deepEqual(view.segments, record.segments)
  assert.ok(view.segments.every((segment) => segment.isFinal))

  // And the citation really occurs in what came back — which is the whole
  // point of the affordance: following `source ▸` lands in the text the app
  // checked the quote in, not in a second, prettier copy of it.
  const quote = record.fields.find((f) => f.key === 'besoin')?.span?.quote
  assert.ok(quote)
  assert.ok(view.segments.some((segment) => segment.text.includes(quote)))
  cleanup()
})

test('a meeting nobody has heard of is refused rather than answered with nothing', async () => {
  const { ipc, cleanup } = open()
  await assert.rejects(() => ipc.invoke('review:transcript', { meetingId: 'nope' }))
  cleanup()
})

test('a call that never reached the gate still opens, with the sections it has', async () => {
  const { ipc, deps, cleanup } = open()
  captured(deps, 'm1', 'bonjour', 'quelques notes')

  // Not an error: the log is the record, and a meeting that was abandoned
  // before extraction is still a meeting somebody may want to read.
  const record = await ipc.invoke('history:record', { meetingId: 'm1' })

  assert.equal(record.compteRendu, null)
  assert.deepEqual(record.fields, [])
  assert.equal(record.notes, 'quelques notes')
  cleanup()
})

// ── The filter chips (DEC-25, DEC-31) ───────────────────────────────────────
//
// The chips are the other half of the same channel, and they are here for the
// same reason the matcher is: a filter the renderer applied would need the
// corpus to apply it to, which is the one thing this channel exists not to
// send. Each test below asks a narrowed question and asserts on what came back
// — including, in the last one, that the rows it eliminated are not in the
// payload under some other name.

/** A held call with a client and a day, but no transcript to fold. */
const held = (
  deps: IpcDeps,
  id: string,
  clientName: string,
  scheduledStart: number,
  end = true,
): void => {
  deps.orchestrator.create({ id, title: `${clientName} — point`, clientName, scheduledStart })
  deps.orchestrator.dispatch(id, 'start', null)
  if (end) deps.orchestrator.dispatch(id, 'end', null)
}

const NOW = Date.parse('2026-08-05T10:00:00Z')
const daysAgo = (days: number): number => NOW - days * 86_400_000

test('the client chip narrows in the main process, and offers its values from there', async () => {
  const { ipc, deps, cleanup } = open()
  deps.clock = () => NOW
  held(deps, 'a1', 'Acme SA', daysAgo(2))
  held(deps, 'n1', 'Nordis', daysAgo(3))
  held(deps, 'n2', 'Nordis', daysAgo(4))

  const all = await ipc.invoke('history:search', {})
  // The chips are facet values, computed here — the renderer cannot know the
  // names in a corpus it does not have.
  assert.deepEqual([...all.clients].sort(), ['Acme SA', 'Nordis'])
  assert.equal(all.rows.length, 3)

  const nordis = await ipc.invoke('history:search', { filter: { client: 'Nordis' } })
  assert.deepEqual(
    nordis.rows.map((row) => row.meeting.id).sort(),
    ['n1', 'n2'],
  )
  // Computed over everything scanned, not over the rows that survived: a facet
  // narrowed by its own filter offers one chip and no way back.
  assert.deepEqual([...nordis.clients].sort(), ['Acme SA', 'Nordis'])
  // And it is echoed, so a late answer to a chip nobody is pressing is dropped.
  assert.equal(nordis.filter.client, 'Nordis')
  cleanup()
})

test('the période chip measures against the day the meeting is drawn on', async () => {
  const { ipc, deps, cleanup } = open()
  deps.clock = () => NOW
  held(deps, 'recent', 'Acme SA', daysAgo(3))
  held(deps, 'old', 'Acme SA', daysAgo(45))

  const week = await ipc.invoke('history:search', { filter: { periode: '7j' } })
  assert.deepEqual(
    week.rows.map((row) => row.meeting.id),
    ['recent'],
  )

  const quarter = await ipc.invoke('history:search', { filter: { periode: '90j' } })
  assert.equal(quarter.rows.length, 2)
  // The corpus was read either way — the chip narrowed the answer, not the scan.
  assert.equal(week.scanned, 2)
  cleanup()
})

test('the statut and intention chips read the machine and the outbox, never the model', async () => {
  const { ipc, deps, cleanup } = open()
  deps.clock = () => NOW
  atGate(deps, 'gate')
  held(deps, 'abandoned', 'Nordis', daysAgo(1), false)
  deps.orchestrator.dispatch('abandoned', 'abort', null)

  const toValidate = await ipc.invoke('history:search', { filter: { statut: 'a-valider' } })
  assert.deepEqual(
    toValidate.rows.map((row) => row.meeting.id),
    ['gate'],
  )

  const dropped = await ipc.invoke('history:search', { filter: { statut: 'abandonnees' } })
  assert.deepEqual(
    dropped.rows.map((row) => row.meeting.id),
    ['abandoned'],
  )

  // Nothing has been confirmed, so nothing has an intent — `intention` reads
  // the outbox projection, which is what actually happened (DEC-20).
  const withTask = await ipc.invoke('history:search', { filter: { intention: 'crm.task' } })
  assert.deepEqual(withTask.rows, [])

  const panel = await editsFor(ipc, 'gate')
  await ipc.invoke('review:confirm', {
    meetingId: 'gate',
    edits: panel.edits,
    intentIds: panel.intents.filter((i) => i.available).map((i) => i.id),
  })
  const after = await ipc.invoke('history:search', { filter: { intention: 'crm.task' } })
  assert.deepEqual(
    after.rows.map((row) => row.meeting.id),
    ['gate'],
  )
  cleanup()
})

test('a chip and a query narrow together, and the eliminated calls do not travel', async () => {
  const { ipc, deps, cleanup } = open()
  deps.clock = () => NOW
  captured(deps, 'acme', 'on part sur un TJM de 520 euros', 'rien', false, 'Acme SA')
  captured(deps, 'nordis', 'le TJM proposé est trop haut', 'rien', false, 'Nordis')

  const both = await ipc.invoke('history:search', {
    query: 'TJM',
    filter: { client: 'Nordis' },
  })

  assert.deepEqual(
    both.rows.map((row) => row.meeting.id),
    ['nordis'],
    'the text match and the chip are ANDed',
  )
  // Two meetings were read to answer, one row came back, and the call that was
  // eliminated left nothing behind. A renderer that received the other row —
  // to narrow it locally — is exactly what this channel refuses to be.
  assert.equal(both.scanned, 2)
  assert.equal(JSON.stringify(both).includes('520 euros'), false)
  assert.equal(JSON.stringify(both).includes('"acme"'), false)
  cleanup()
})

test('an unknown client, an empty corpus: an answer, never a throw', async () => {
  const { ipc, deps, cleanup } = open()
  deps.clock = () => NOW

  // Nothing captured at all. The search still answers — a screen that threw
  // here would be a search a rep could not use on their first day.
  const empty = await ipc.invoke('history:search', { query: 'Acme', filter: { periode: '7j' } })
  assert.deepEqual(empty.rows, [])
  assert.deepEqual(empty.clients, [])
  assert.equal(empty.scanned, 0)
  assert.deepEqual(empty.filter, {
    client: null,
    periode: '7j',
    statut: 'tous',
    intention: 'toutes',
  })

  held(deps, 'a1', 'Acme SA', daysAgo(2))
  const unknown = await ipc.invoke('history:search', { filter: { client: 'Société inconnue' } })
  assert.deepEqual(unknown.rows, [])
  assert.deepEqual(unknown.clients, ['Acme SA'], 'the chips still say what there is')
  cleanup()
})

// ── The calendar's range query (DEC-31) ─────────────────────────────────────

test('meeting:list is bounded by the day a meeting belongs on, not by created_at', async () => {
  const { ipc, deps, cleanup } = open()
  // Created now, placed on three different days — which is the case a flat
  // « most recently updated 200 » got wrong: all three have the same
  // `updated_at`, and the grid draws them a year apart.
  held(deps, 'last-year', 'Acme SA', daysAgo(400))
  held(deps, 'last-month', 'Acme SA', daysAgo(40))
  held(deps, 'this-week', 'Acme SA', daysAgo(2))

  const window = await ipc.invoke('meeting:list', {
    from: daysAgo(45),
    to: daysAgo(1),
  })
  assert.deepEqual(
    window.map((m) => m.id).sort(),
    ['last-month', 'this-week'],
  )

  const backThen = await ipc.invoke('meeting:list', { from: daysAgo(410), to: daysAgo(390) })
  assert.deepEqual(
    backThen.map((m) => m.id),
    ['last-year'],
    'a month paged back a year still has its rows',
  )

  // Unbounded is what every caller before the grid existed asked for, and it
  // still means the same thing.
  const all = await ipc.invoke('meeting:list', {})
  assert.equal(all.length, 3)
  cleanup()
})

test('a meeting with no placed day is ranged by when it ran, then by when it was created', async () => {
  const { ipc, deps, cleanup } = open()
  // No `scheduledStart` — the flow that existed before there was a calendar.
  // The store's clock starts at 1000, so this meeting's anchor is ~1000.
  deps.orchestrator.create({ id: 'now', title: 'Point ad hoc' })

  assert.equal((await ipc.invoke('meeting:list', { from: 0, to: 10_000 })).length, 1)
  assert.equal((await ipc.invoke('meeting:list', { from: 20_000, to: null })).length, 0)
  cleanup()
})

// ── Réglages ────────────────────────────────────────────────────────────────

test('every connector is listed with a French label and its live health', async () => {
  const { ipc, cleanup } = open()
  const snapshot = await ipc.invoke('settings:snapshot', {})

  assert.deepEqual(
    snapshot.connectors.map((c) => c.id).sort(),
    ['calendar', 'capture', 'crm', 'llm', 'mail', 'transcribe'],
  )
  assert.ok(snapshot.connectors.every((c) => c.label.length > 0))
  // DEC-26: a connector that is not ok always carries the sentence saying why.
  for (const connector of snapshot.connectors) {
    if (connector.health.state !== 'ok') assert.ok(connector.health.reason.length > 0)
  }
  cleanup()
})

/**
 * DEC-26, DEC-28. The first demo runs with **no Entra app registration** — it
 * lives in a tenant we do not control — so `IpcDeps.identity` is null and every
 * one of these channels has to answer rather than throw. What the renderer
 * needs from them is the difference between *not signed in yet* and *nothing to
 * sign into*, because only the first may draw a live *Se connecter*.
 */
test('with no Entra registration the auth channels answer, and say there is nothing to sign into', async () => {
  const { ipc, cleanup } = open()

  const state = await ipc.invoke('auth:state', {})
  assert.equal(state.status, 'signedOut')
  assert.ok(state.status === 'signedOut' && (state.reason ?? '').length > 0)
  // Written for a rep. An environment variable name on this screen is how a
  // sales rep concludes the product is broken (DEC-34's own reasoning).
  assert.doesNotMatch(state.status === 'signedOut' ? (state.reason ?? '') : '', /SILLAGE_|env/i)

  // Signing out keeps saying it, rather than re-arming a button that cannot work.
  const after = await ipc.invoke('auth:signOut', {})
  assert.deepEqual(after, state)

  // And the same sentence reaches Réglages through the settings snapshot,
  // which is the payload that screen actually reads.
  const settings = await ipc.invoke('settings:snapshot', {})
  assert.deepEqual(settings.auth, state)

  // Nothing about it stops a meeting: the calendar never gates meeting:create.
  const meeting = await ipc.invoke('meeting:create', { title: 'Appel sans calendrier' })
  assert.equal(meeting.title, 'Appel sans calendrier')

  cleanup()
})

test('an identity that exists but holds no account is plainly signed out — the button works', async () => {
  const { ipc, deps, cleanup } = open()
  deps.identity = {
    account: () => null,
    signIn: async () => {
      throw new Error('jamais appelé ici')
    },
    signOut: async () => {},
    token: async () => 'jeton',
  }

  const state = await ipc.invoke('auth:state', {})
  // No reason ⇒ Réglages draws *Se connecter*. The two cases must not collapse.
  assert.deepEqual(state, { status: 'signedOut' })
  cleanup()
})

test('a provider that cannot be used is listed with the reason, never hidden (DEC-33)', async () => {
  const { ipc, deps, cleanup } = open()
  deps.providers = () => ({
    stt: {
      rows: providerRows(STT_PROVIDERS, {
        configured: [],
        selected: null,
        reason: 'aucun moteur de transcription n’est configuré',
      }),
      selected: null,
      reason: 'aucun moteur de transcription n’est configuré',
    },
    llm: { rows: [], selected: null, reason: 'aucun modèle configuré' },
    models: { rows: [], selected: null },
  })

  const snapshot = await ipc.invoke('settings:snapshot', {})
  const unusable = snapshot.stt.rows.find((row) => row.id === 'elevenlabs')

  assert.ok(unusable, 'the unusable provider is in the table, not dropped from it')
  assert.equal(unusable.configured, false)
  assert.equal(unusable.selectable, false)
  assert.match(unusable.reason ?? '', /clé/)
  // It still says where the audio would go, which is the half the screen
  // carries now that the row refuses nothing.
  assert.equal(unusable.residency, 'remote')
  cleanup()
})

test('the response schema refuses an unselectable provider with no reason', () => {
  // The guarantee is in the type, not in a reviewer noticing. A row that says
  // "unavailable" and nothing else cannot cross the boundary at all.
  assert.throws(() =>
    invokeChannels['settings:snapshot'].response.parse({
      stt: {
        rows: [
          {
            id: 'x',
            label: 'X',
            tier: 'cloud',
            residency: 'remote',
            streaming: false,
            cost: 'metered',
            configured: true,
            selected: false,
            selectable: false,
            reason: null,
          },
        ],
        selected: null,
        reason: null,
      },
      llm: { rows: [], selected: null, reason: null },
      connectors: [],
      auth: { status: 'signedOut' },
      probe: null,
      probeReason: 'x',
      retention: { diagnosticsDays: 90, meetingContent: 'never' },
    }),
  )
})

test('a missing probe says why rather than being absent (DEC-24, DEC-26)', async () => {
  const { ipc, deps, cleanup } = open()

  const none = await ipc.invoke('settings:snapshot', {})
  assert.equal(none.probe, null)
  assert.ok((none.probeReason ?? '').length > 0)

  deps.capabilities = () => ({
    report: {
      at: 1000,
      authenticated: true,
      findings: [
        {
          id: 'listCustomers',
          label: 'liste des clients',
          matters: 'sans elle, aucun compte client n’est proposé',
          required: true,
          state: 'missing',
          status: 404,
          detail: 'absente de ce tenant',
        },
      ],
      columnGaps: [],
      ok: false,
      summary: 'une capacité manque sur ce tenant',
    },
    reason: null,
  })

  const probed = await ipc.invoke('settings:snapshot', {})
  assert.equal(probed.probeReason, null, 'exactly one of the two is set')
  assert.equal(probed.probe?.findings[0]?.state, 'missing')
  // The probe reports as data and never throws: the verdict is a list Réglages
  // renders row by row, not an exception somebody has to catch.
  assert.ok((probed.probe?.summary ?? '').length > 0)
  cleanup()
})

// ── DEC-27: the redacted export contains no conversation content ────────────

test('the redacted bundle carries no conversation content — asserted on real content', async () => {
  const { ipc, deps, cleanup } = open()

  // A real error message and a real detail payload, both carrying what a client
  // actually said. This is the input the guarantee has to survive.
  const spoken = 'on est plutôt sur un TJM de 520 euros, mais Camille doit valider'
  deps.diagnostics.record({
    severity: 'error',
    code: 'extract.failed',
    module: 'extract',
    message: `le modèle a refusé « ${spoken} »`,
    detail: {
      transcript: spoken,
      contact: 'camille.leroy@acme-industries.fr',
      segments: 42,
      provider: 'local-whisper',
    },
  })

  const redacted = await ipc.invoke('diagnostics:export', { mode: 'redacted' })
  const written = readFileSync(redacted.path, 'utf8')

  // Not "the mock was called": the file on disk is read back and searched for
  // the words that were spoken.
  assert.equal(written.includes('520 euros'), false)
  assert.equal(written.includes('Camille'), false)
  assert.equal(written.includes('camille.leroy@acme-industries.fr'), false)
  // What survives is the diagnostic part: the code, the module, the counts and
  // the identifier-shaped values.
  assert.ok(written.includes('extract.failed'))
  assert.ok(written.includes('local-whisper'))
  assert.ok(written.includes('42'))

  // And the full bundle is the other half of DEC-27: it does contain it, which
  // is exactly why the control that produces it has to say so.
  const full = await ipc.invoke('diagnostics:export', { mode: 'full' })
  assert.ok(readFileSync(full.path, 'utf8').includes('520 euros'))

  cleanup()
})

test('the shipped registries all declare a tier and survive the row builder', () => {
  // `core/domain/__tests__/providerRows.test.ts` tests the rule against
  // fixtures, because `core/` may not import `modules/`. This is the other
  // half: the *real* tables, which is where a provider added in a hurry lands.
  for (const descriptors of [STT_PROVIDERS, LLM_PROVIDERS]) {
    for (const row of providerRows(descriptors, {
      configured: descriptors.map((d) => d.id),
      selected: null,
      reason: null,
    })) {
      assert.ok(['local', 'self-hosted', 'cloud'].includes(row.tier), `${row.id} has no tier`)
      if (!row.selectable) {
        assert.ok((row.reason ?? '').length > 0, `${row.id} is unselectable with no reason`)
      }
    }
  }

  // And it is data, not a branch: every row carries to the screen whether it
  // runs on this machine, including the hosted ones, which is what makes the
  // choice informed now that it is no longer made here.
  const rows = providerRows(STT_PROVIDERS, {
    configured: ['elevenlabs'],
    selected: 'elevenlabs',
    reason: null,
  })
  const cloud = rows.find((row) => row.id === 'elevenlabs')
  assert.equal(cloud?.residency, 'remote')
  assert.equal(cloud?.selectable, true, 'a configured provider is one someone chose')
  assert.ok(
    rows.every((row) => ['local', 'remote'].includes(row.residency)),
    'every row states where the audio would go',
  )
})

// ── review:preview ──────────────────────────────────────────────────────────
//
// The channel exists because `review:get` drafts the intents from the pre-fill
// and the rep then edits the form for as long as they like. Without it the
// panel describes what *would have been* created, on the one screen whose whole
// promise is that what the rep read is what the CRM receives.

test('review:preview renames what will be created when the rep corrects a field', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  const before = panel.intents.find((i) => i.kind === 'crm.task')
  const after = await ipc.invoke('review:preview', {
    meetingId: 'm1',
    edits: { ...panel.edits, accountName: 'Acme France', taskName: 'CR — cadrage' },
    intentIds: panel.intents.map((i) => i.id),
  })

  const task = after.intents.find((i) => i.kind === 'crm.task')
  assert.equal(task?.summary, 'CR — cadrage — Acme France')
  assert.notEqual(task?.summary, before?.summary)

  cleanup()
})

test('review:preview makes the opportunity draftable once the account resolves', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  // DEC-20: no opportunity against an unresolved account — and DEC-18's
  // candidate chips exist precisely so the rep can resolve it here. Before this
  // channel the row stayed disabled however many chips they clicked.
  const unresolved = await ipc.invoke('review:preview', {
    meetingId: 'm1',
    edits: { ...panel.edits, accountId: null },
    intentIds: [],
  })
  const blocked = unresolved.intents.find((i) => i.kind === 'crm.opportunity')
  assert.equal(blocked?.available, false)
  assert.ok(blocked?.reason && blocked.reason.length > 0)

  const resolved = await ipc.invoke('review:preview', {
    meetingId: 'm1',
    edits: { ...panel.edits, accountId: 'ACC-2087' },
    intentIds: [],
  })
  const draftable = resolved.intents.find((i) => i.kind === 'crm.opportunity')
  assert.equal(draftable?.available, true)
  assert.equal(draftable?.reason, null)

  cleanup()
})

test('review:preview writes nothing — it is a draft, not a confirmation', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  const before = deps.store.log.read('m1').map((s) => s.event.type)
  await ipc.invoke('review:preview', {
    meetingId: 'm1',
    edits: { ...panel.edits, accountName: 'Acme France' },
    intentIds: panel.intents.map((i) => i.id),
  })
  const after = deps.store.log.read('m1').map((s) => s.event.type)

  // It runs on every keystroke. An event here would fill the log with the
  // rep's typing, and `confirmation.recorded` must stay the one gesture.
  assert.deepEqual(after, before)
  assert.equal(deps.orchestrator.stateOf('m1'), 'awaiting_confirmation')

  cleanup()
})

test('review:preview answers an unknown meeting with no intents rather than throwing', async () => {
  const { ipc, deps, cleanup } = open()
  atGate(deps, 'm1')
  const panel = await editsFor(ipc, 'm1')

  // It runs while the rep is typing, so a rejected promise would surface as an
  // error banner over a screen that is working.
  const result = await ipc.invoke('review:preview', {
    meetingId: 'inconnue',
    edits: panel.edits,
    intentIds: [],
  })
  assert.deepEqual(result.intents, [])

  cleanup()
})

/*
 * The recipe picker's channel (DEC-43).
 *
 * Two behaviours in one handler, and only one of them is unconditional. The
 * choice is *always* recorded, because that is what the next run reads and what
 * survives a restart. The regeneration only happens when there is a document to
 * replace and the choice actually changes it — the failure this guards against
 * is a rep clicking the pill they are already on and spending a model call.
 */
test('meeting:recipe records the choice, and a meeting with no compte-rendu runs nothing', async () => {
  const { ipc, deps, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })

  let runs = 0
  deps.runEnhancement = async () => {
    runs++
  }

  const before = await ipc.invoke('meeting:get', { meetingId: 'm1' })
  assert.equal(before.recipe, 'besoin-commercial')

  const chosen = await ipc.invoke('meeting:recipe', { meetingId: 'm1', recipe: 'libre' })
  assert.equal(chosen.recipe, 'libre')
  assert.equal(chosen.regenerating, false)
  assert.equal(runs, 0)

  // Read back through the fold, which is what a restart would do.
  const after = await ipc.invoke('meeting:get', { meetingId: 'm1' })
  assert.equal(after.recipe, 'libre')

  cleanup()
})

test('switching after a compte-rendu exists regenerates it', async () => {
  const { ipc, deps, cleanup } = open()
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })
  const session = deps.orchestrator.session('m1')
  session?.emit({
    type: 'extraction.completed',
    extraction: sampleExtraction,
    verification: sampleVerification,
  })

  let runs = 0
  deps.runEnhancement = async () => {
    runs++
  }

  const switched = await ipc.invoke('meeting:recipe', { meetingId: 'm1', recipe: 'libre' })
  assert.equal(switched.regenerating, true)
  assert.equal(runs, 1)

  // Choosing the recipe the stored document already has spends nothing. The
  // renderer sends what the rep clicked, and a rep can click what is already on.
  const again = await ipc.invoke('meeting:recipe', {
    meetingId: 'm1',
    recipe: 'besoin-commercial',
  })
  assert.equal(again.regenerating, false)
  assert.equal(runs, 1)

  cleanup()
})

test('a model download is refused while a meeting is recording, with the reason', async () => {
  /*
   * `ModelDownloads.start` posts `init` straight to its own worker, bypassing
   * `acquireLoadSlot` and `memoryVerdict` — the two guards `engine.ts` describes
   * as the reason an ONNX session that cannot allocate « does not fail politely,
   * it takes the process with it ». So *Télécharger* mid-call built a second
   * ONNX session beside the meeting's, on a laptop already running a recording,
   * a transcriber and Teams.
   *
   * The app already refuses a ten-second installer while a call is live
   * (`updateReadiness`); a multi-gigabyte download that spawns a model runtime is
   * the same question with a bigger answer. Stated, never silent (DEC-26).
   */
  const h = open()
  let started = 0
  h.deps.models = {
    start: async () => {
      started += 1
    },
    cancel: async () => {},
    section: () => ({ rows: [], selected: null }),
  }
  const meetingId = 'm-live'
  h.deps.orchestrator.create({ id: meetingId, title: 'Appel', context: null })
  h.deps.orchestrator.dispatch(meetingId, 'start', null)

  await assert.rejects(
    () => h.ipc.invoke('models:download', { modelId: 'Xenova/whisper-small' }),
    /réunion est en cours/,
  )
  assert.equal(started, 0, 'rien ne doit avoir été lancé')

  // And it is a refusal, not a wall: once the call is over the download runs.
  h.deps.orchestrator.dispatch(meetingId, 'end', null)
  await h.ipc.invoke('models:download', { modelId: 'Xenova/whisper-small' })
  assert.equal(started, 1)
  h.cleanup()
})

/**
 * The rep marking a moment of their own call (`core/contracts/marks.ts`).
 *
 * Two windows can press this — the session screen and the widget floating over
 * Teams — so the id and the instant are minted here rather than in either of
 * them. The refusal is the interesting half: « ce moment » has no referent once
 * the call is over.
 */
test('meeting:mark records a moment, and refuses one outside a recording', async () => {
  const { ipc, deps, cleanup } = open()
  const marked: Array<{ meetingId: string; mark: unknown }> = []
  deps.broadcastMark = (meetingId, mark) => marked.push({ meetingId, mark })
  deps.orchestrator.create({ id: 'm1', title: 'Acme', context: sampleContext })

  // Before the recording starts there is no moment to mark, and the answer is a
  // sentence rather than an exception nobody composed (DEC-26).
  await assert.rejects(
    () => ipc.invoke('meeting:mark', { meetingId: 'm1', note: 'trop tôt', segmentId: null }),
    /Aucun enregistrement en cours/,
  )

  await ipc.invoke('session:command', { meetingId: 'm1', command: 'start' })
  const mark = await ipc.invoke('meeting:mark', {
    meetingId: 'm1',
    note: 'plafond achats',
    segmentId: null,
  })
  assert.equal(mark.note, 'plafond achats')
  assert.equal(mark.segmentId, null)
  assert.ok(mark.id.length > 0)

  // In the log, and therefore in every reader that folds it.
  assert.deepEqual(deps.store.projections.marks('m1'), [mark])
  // And on its way to the other window: a rep who marks from the widget and
  // then opens the app must not find a list one short.
  assert.deepEqual(marked, [{ meetingId: 'm1', mark }])

  // A mark made *on a turn* keeps the turn, because the rep pointed at it.
  const pinned = await ipc.invoke('meeting:mark', {
    meetingId: 'm1',
    note: '',
    segmentId: 'far-3',
  })
  assert.equal(pinned.segmentId, 'far-3')

  // The transcript view carries them, which is what the two readers draw.
  const view = await ipc.invoke('review:transcript', { meetingId: 'm1' })
  assert.deepEqual(view.marks.map((m) => m.id), [mark.id, pinned.id])

  await ipc.invoke('session:command', { meetingId: 'm1', command: 'end' })
  await assert.rejects(
    () => ipc.invoke('meeting:mark', { meetingId: 'm1', note: 'trop tard', segmentId: null }),
    /Aucun enregistrement en cours/,
  )
  cleanup()
})

/**
 * What the widget reads on open.
 *
 * The live orchestrator and not the projection, and that distinction is the
 * whole test: a meeting the projection still calls `recording` after a crash is
 * the stranded row `main.ts`'s boot sweep ends, and a widget drawn over one
 * would be a pill floating over somebody's screen announcing a recording that
 * no device is behind.
 */
test('widget:state answers the meeting that is really recording, or null', async () => {
  const { ipc, deps, cleanup } = open()
  assert.deepEqual(await ipc.invoke('widget:state', {}), { meeting: null })

  deps.orchestrator.create({ id: 'm1', title: 'Néovia Santé — cadrage', context: sampleContext })
  assert.deepEqual(await ipc.invoke('widget:state', {}), { meeting: null })

  await ipc.invoke('session:command', { meetingId: 'm1', command: 'start' })
  await ipc.invoke('meeting:mark', { meetingId: 'm1', note: 'noté', segmentId: null })
  const live = await ipc.invoke('widget:state', {})
  assert.equal(live.meeting?.meetingId, 'm1')
  assert.equal(live.meeting?.title, 'Néovia Santé — cadrage')
  assert.equal(live.meeting?.marks.length, 1)

  await ipc.invoke('session:command', { meetingId: 'm1', command: 'end' })
  assert.deepEqual(await ipc.invoke('widget:state', {}), { meeting: null })
  cleanup()
})

/**
 * The two window gestures, with no window.
 *
 * `IpcDeps.widget` is absent in every test and in any run without an overlay,
 * and the channels answer `{ ok: false }` rather than throwing — which is what
 * lets the widget treat « the window would not move » as a fact it can say out
 * loud instead of an exception it has to swallow (DEC-26).
 */
test('the widget’s window gestures answer false when there is no window', async () => {
  const { ipc, deps, cleanup } = open()
  assert.deepEqual(await ipc.invoke('widget:resize', { width: 340, height: 300 }), {
    ok: false,
    above: false,
  })
  assert.deepEqual(await ipc.invoke('window:focus', { meetingId: null }), { ok: false })
  assert.deepEqual(await ipc.invoke('widget:passThrough', { through: true }), { ok: false })

  const asked: unknown[] = []
  const focused: Array<string | null> = []
  let through: boolean | null = null
  deps.widget = {
    resize: (box) => {
      asked.push(box)
      return { ok: true, above: true }
    },
    passThrough: (value) => {
      through = value
      return true
    },
    focusMain: (meetingId) => {
      focused.push(meetingId)
      return true
    },
  }
  // The pill's offset travels with the size — it is what lets the main process
  // leave the pill where it was instead of anchoring a window edge.
  assert.deepEqual(await ipc.invoke('widget:resize', { width: 340, height: 300, pillTop: 16, pillHeight: 44 }), {
    ok: true,
    above: true,
  })
  assert.deepEqual(asked, [{ width: 340, height: 300, pillTop: 16, pillHeight: 44 }])

  // « Ouvrir Sillage » reaches the window, with the meeting it is open on.
  assert.deepEqual(await ipc.invoke('window:focus', { meetingId: 'm1' }), { ok: true })
  assert.deepEqual(focused, ['m1'])

  assert.deepEqual(await ipc.invoke('widget:passThrough', { through: true }), { ok: true })
  assert.equal(through, true)
  cleanup()
})

/**
 * **« Cette machine uniquement » had no way to be asked for, and was
 * bypassable once it was** (DEC-37).
 *
 * DEC-37 withdrew every jurisdiction claim and kept exactly one rule that still
 * refuses. Both registries honoured it in their *ranking* — and the ranking is
 * not where the decision ends. `main.ts` takes the rep's explicit provider
 * choice whenever it is configured, so « paste an OpenAI key, press *Utiliser*,
 * then ask for this machine only » left the audio going to OpenAI. The
 * constraint is applied to the candidate set now
 * (`core/domain/residency.ts`), which is the only place every downstream path
 * has to pass through.
 *
 * Here: the channel exists, it writes, and the snapshot the screen redraws from
 * says what a meeting would actually do.
 */
test('settings:setOfflineOnly is written and read back on the snapshot', async () => {
  const { ipc, deps, cleanup } = open()
  let stored: boolean | null = null
  deps.preferences = {
    selectProvider: async () => {},
    selectModel: async () => {},
    setField: async () => {},
    setOfflineOnly: async (value) => {
      stored = value
    },
  }
  deps.offlineOnly = () => stored ?? false
  let resettled = 0
  deps.onSettingsChanged = () => {
    resettled += 1
  }

  const before = await ipc.invoke('settings:snapshot', {})
  assert.equal(before.offlineOnly, false)

  const after = await ipc.invoke('settings:setOfflineOnly', { value: true })
  assert.equal(stored, true)
  assert.equal(after.offlineOnly, true)
  /*
   * Every settings write drains what is waiting, because any of them can be the
   * piece that makes — or unmakes — a usable model, and a meeting sitting in
   * `ended` is waiting on exactly that promise (DEC-39). This one can unmake
   * one, which is the direction that was never considered.
   */
  assert.equal(resettled, 1)

  // And off again: returning to the default has to be reachable, or the first
  // time a rep asks for this it is permanent.
  const off = await ipc.invoke('settings:setOfflineOnly', { value: false })
  assert.equal(stored, false)
  assert.equal(off.offlineOnly, false)
  cleanup()
})

test('settings:setOfflineOnly refuses with a sentence when preferences are absent', async () => {
  // The build with no settings backend behind it — the channel answers a stated
  // refusal rather than throwing something nobody composed (DEC-26).
  const { ipc, cleanup } = open()
  await assert.rejects(
    () => ipc.invoke('settings:setOfflineOnly', { value: true }),
    /préférences ne sont pas disponibles/,
  )
  cleanup()
})

/**
 * **Why there is no updater, when the reason is the thing that matters.**
 *
 * « mise à jour automatique indisponible dans cette build » is true of a
 * portable install and misleading about an unsigned Windows one, where the fact
 * a rep needs is that nothing could have checked the download before running it
 * (`core/domain/updateTrust.ts`). One string for both would have made the
 * decision to disable auto-update on unsigned builds invisible on the screen
 * built to explain it.
 */
test('update:status carries the stated reason there is no updater', async () => {
  const { ipc, deps, cleanup } = open()

  const generic = await ipc.invoke('update:status', {})
  assert.equal(generic.phase, 'disabled')
  assert.match(generic.reason ?? '', /indisponible dans cette build/)

  deps.noUpdaterReason =
    'mise à jour automatique désactivée : cette version n’est pas signée, rien ne pourrait ' +
    'vérifier que la mise à jour vient bien de l’éditeur. Les nouvelles versions sont à ' +
    'installer à la main.'
  const stated = await ipc.invoke('update:status', {})
  assert.match(stated.reason ?? '', /n’est pas signée/)
  // Still not installable, which is the point: there is nothing to install.
  assert.equal(stated.installable, false)
  cleanup()
})
