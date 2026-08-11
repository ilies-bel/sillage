/**
 * DEC-32, as a test.
 *
 * The assertion that carries the decision is the one about VerySwing: an
 * unreachable CRM is **not** an app-level degradation, and the whole point of
 * replacing the six-connector strip was that it said so six times during a
 * client call. Everything else here is the plumbing that keeps that honest —
 * that the required/optional partition covers the enum exactly, and that a
 * subsystem which stopped entirely is the one the header names.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectorIdSchema, type ConnectorHealth } from '../health.ts'
import {
  OPTIONAL_CONNECTORS,
  REQUIRED_CONNECTORS,
  aggregateStatus,
  isRequiredConnector,
} from '../status.ts'

const down = (reason: string): ConnectorHealth => ({
  state: 'down',
  reason,
  since: 1000,
  retryable: true,
})

const degraded = (reason: string): ConnectorHealth => ({
  state: 'degraded',
  reason,
  since: 1000,
  retryable: true,
})

const allOk = () => ({
  capture: { state: 'ok' } as ConnectorHealth,
  transcribe: { state: 'ok' } as ConnectorHealth,
  calendar: { state: 'ok' } as ConnectorHealth,
  llm: { state: 'ok' } as ConnectorHealth,
  crm: { state: 'ok' } as ConnectorHealth,
  mail: { state: 'ok' } as ConnectorHealth,
})

test('every connector is on exactly one side of the line', () => {
  // A seventh `ConnectorId` fails here rather than silently defaulting to
  // optional and never being reported.
  const partitioned = [...REQUIRED_CONNECTORS, ...OPTIONAL_CONNECTORS]
  assert.deepEqual([...partitioned].sort(), [...ConnectorIdSchema.options].sort())
  assert.equal(new Set(partitioned).size, partitioned.length)
})

test('only capture, transcription and analysis are required', () => {
  assert.deepEqual([...REQUIRED_CONNECTORS], ['capture', 'transcribe', 'llm'])
  assert.equal(isRequiredConnector('crm'), false)
  assert.equal(isRequiredConnector('capture'), true)
})

test('all six ok aggregates to ok, with nothing to name', () => {
  assert.deepEqual(aggregateStatus(allOk()), { state: 'ok', worst: null, reason: null })
})

test('a failing required subsystem moves the aggregate', () => {
  const status = aggregateStatus({ ...allOk(), transcribe: down('aucun moteur disponible') })
  assert.deepEqual(status, {
    state: 'down',
    worst: 'transcribe',
    reason: 'aucun moteur disponible',
  })
})

test('an unreachable VerySwing is not an app-level degradation (DEC-32)', () => {
  // The decision in one assertion. VerySwing, Outlook and the calendar are
  // optional by DEC-26; all three can be down at once and the app is still
  // doing the thing it exists to do.
  const status = aggregateStatus({
    ...allOk(),
    crm: down('VerySwing injoignable'),
    mail: down('jeton Outlook expiré'),
    calendar: down('application Entra non configurée'),
  })
  assert.deepEqual(status, { state: 'ok', worst: null, reason: null })
})

test('a down required subsystem outranks a degraded one', () => {
  const status = aggregateStatus({
    ...allOk(),
    capture: degraded('un seul canal audio'),
    llm: down('modèle injoignable'),
  })
  assert.equal(status.worst, 'llm')
  assert.equal(status.state, 'down')
})

test('at equal severity the earliest required subsystem wins', () => {
  // capture before transcribe before llm: capture is the only one whose
  // failure cannot be repaired after the call.
  const status = aggregateStatus({
    ...allOk(),
    capture: down('périphérique introuvable'),
    llm: down('modèle injoignable'),
  })
  assert.equal(status.worst, 'capture')
})

test('a snapshot missing a connector reads as nothing wrong, not as a crash', () => {
  assert.deepEqual(aggregateStatus({}), { state: 'ok', worst: null, reason: null })
})

test('the reason is the connector’s own words, never composed here', () => {
  const status = aggregateStatus({ capture: degraded('micro muet depuis 30 s') })
  assert.equal(status.reason, 'micro muet depuis 30 s')
})
