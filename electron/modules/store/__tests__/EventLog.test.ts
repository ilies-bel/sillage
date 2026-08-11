/**
 * The append-only log (DEC-12).
 *
 * Runs on plain `node` — no Electron, no rebuilt native module. That is a
 * property of choosing `node:sqlite` over `better-sqlite3` and it is worth
 * keeping: a store you cannot test without a packaged app is a store nobody
 * tests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EventLog } from '../EventLog.ts'
import { Store, SCHEMA_VERSION } from '../index.ts'
import { APP_SCOPE } from '../../../core/contracts/events.ts'
import { sampleSegment } from '../../../core/contracts/fixtures.ts'

const at = (n: number) => () => n

test('seq is allocated per meeting, densely, from 1', () => {
  const log = new EventLog(':memory:', at(1000))
  log.append('m1', { type: 'meeting.created', title: 'A', context: null })
  log.append('m1', { type: 'transcript.segment', segment: sampleSegment })
  log.append('m2', { type: 'meeting.created', title: 'B', context: null })

  assert.deepEqual(
    log.read('m1').map((e) => e.seq),
    [1, 2],
  )
  assert.deepEqual(
    log.read('m2').map((e) => e.seq),
    [1],
  )
  assert.equal(log.lastSeq('m1'), 2)
  log.close()
})

test('afterSeq tails a live meeting', () => {
  const log = new EventLog(':memory:', at(1000))
  for (let i = 0; i < 5; i++) {
    log.append('m1', { type: 'transcript.segment', segment: { ...sampleSegment, id: `s${i}` } })
  }
  const tail = log.read('m1', { afterSeq: 3 })
  assert.deepEqual(
    tail.map((e) => e.seq),
    [4, 5],
  )
  log.close()
})

test('an event that fails its schema never reaches the log', () => {
  const log = new EventLog(':memory:', at(1000))
  assert.throws(() =>
    // @ts-expect-error deliberately malformed — this is the point of the test
    log.append('m1', { type: 'transcript.segment', segment: { id: 'x' } }),
  )
  assert.equal(log.read('m1').length, 0)
  log.close()
})

test('transactions roll back, and nest without clobbering the outer unit', () => {
  const log = new EventLog(':memory:', at(1000))
  log.append('m1', { type: 'meeting.created', title: 'A', context: null })

  assert.throws(() =>
    log.transaction(() => {
      log.append('m1', { type: 'extraction.started', attempt: 1 })
      throw new Error('boom')
    }),
  )
  assert.equal(log.read('m1').length, 1, 'the failed unit left nothing behind')

  log.transaction(() => {
    log.append('m1', { type: 'extraction.started', attempt: 1 })
    assert.throws(() =>
      log.transaction(() => {
        log.append('m1', { type: 'extraction.failed', reason: 'x' })
        throw new Error('inner')
      }),
    )
  })
  assert.deepEqual(
    log.read('m1').map((e) => e.event.type),
    ['meeting.created', 'extraction.started'],
    'the inner failure rolled back to its savepoint and no further',
  )
  log.close()
})

test('the purge reaches diagnostics and nothing else', () => {
  const log = new EventLog(':memory:', at(0))
  const diag = (ts: number, id: string) =>
    log.append(
      APP_SCOPE,
      {
        type: 'diag',
        event: {
          id,
          ts,
          severity: 'warn',
          code: 'x.y',
          module: 'test',
          message: 'm',
          detail: {},
          meetingId: null,
        },
      },
      ts,
    )

  diag(100, 'old')
  diag(900, 'new')
  log.append('m1', { type: 'meeting.created', title: 'A', context: null }, 100)
  log.append('m1', { type: 'transcript.segment', segment: sampleSegment }, 100)

  assert.equal(log.purgeDiagnosticsBefore(500), 1)
  assert.deepEqual(
    log.readDiagnostics().map((e) => e.id),
    ['new'],
  )
  assert.equal(log.read('m1').length, 2, 'meeting content never auto-expires')
  log.close()
})

test('diagnostics come back newest first', () => {
  const log = new EventLog(':memory:', at(0))
  for (const ts of [10, 30, 20]) {
    log.append(
      APP_SCOPE,
      {
        type: 'diag',
        event: {
          id: `d${ts}`,
          ts,
          severity: 'info',
          code: 'a.b',
          module: 'test',
          message: '',
          detail: {},
          meetingId: null,
        },
      },
      ts,
    )
  }
  assert.deepEqual(
    log.readDiagnostics({ limit: 2 }).map((e) => e.id),
    ['d30', 'd20'],
  )
  log.close()
})

test('opening a database with a foreign schema fails at the open, not at the query', () => {
  // The real bug this comes from: the old product left `natively.db` in
  // userData with its own `meetings` table, `CREATE TABLE IF NOT EXISTS` did
  // nothing, and the app booted and then failed with "no such column".
  const directory = mkdtempSync(join(tmpdir(), 'store-'))
  const path = join(directory, 'foreign.db')
  try {
    const first = new EventLog(path, at(1000))
    first.append('m1', { type: 'meeting.created', title: 'A', context: null })
    first.db.exec("UPDATE schema_meta SET value = '99' WHERE key = 'version'")
    first.close()

    assert.throws(() => new EventLog(path, at(1000)), /version 99/)

    // Put the stamp back the way a migration would — outside EventLog, since
    // EventLog now refuses to open it — and the data is still there.
    const raw = new DatabaseSync(path)
    raw.exec(`UPDATE schema_meta SET value = '${SCHEMA_VERSION}' WHERE key = 'version'`)
    raw.close()

    const reopened = new EventLog(path, at(1000))
    assert.equal(reopened.read('m1').length, 1)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

/**
 * DEC-31. A meeting the rep placed on another day has to still be on that day
 * after a restart — a value only the renderer knew would put it back in today's
 * cell the moment the app reopened.
 */
test('the day a meeting was placed on survives a rebuild', () => {
  const store = new Store(':memory:', at(1234))
  const thursday = Date.UTC(2026, 7, 13, 7, 0)

  store.append('man-1', {
    type: 'meeting.created',
    title: 'Point Acme',
    context: null,
    clientName: 'Acme SA',
    scheduledStart: thursday,
  })
  // Created for right now — the third case, and the one every caller before
  // the calendar existed produced.
  store.append('man-2', { type: 'meeting.created', title: 'Appel entrant', context: null })

  assert.equal(store.projections.getMeeting('man-1')?.scheduledStart, thursday)
  assert.equal(store.projections.getMeeting('man-2')?.scheduledStart, null)

  store.projections.rebuild()
  assert.equal(store.projections.getMeeting('man-1')?.scheduledStart, thursday)
  assert.equal(store.projections.getMeeting('man-2')?.scheduledStart, null)
  store.close()
})

/**
 * The 3 → 4 upgrade, which added a column to a *projection*.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot complete that, and the failure mode is
 * the one the version stamp exists to prevent: the app boots and then fails on
 * the first query with "no such column". The migration is to drop the
 * projection and fold the log back into it, which is only sound because a
 * projection is derived — so this checks the row comes back, and comes back
 * with the new column filled from the log.
 */
test('a database whose projections predate a column is refolded, not refused', () => {
  const directory = mkdtempSync(join(tmpdir(), 'store-'))
  const path = join(directory, 'v3.db')
  try {
    const first = new Store(path, at(1000))
    first.append('m1', {
      type: 'meeting.created',
      title: 'Acme',
      context: null,
      clientName: 'Acme SA',
      scheduledStart: 55_000,
    })
    assert.equal(first.log.refolded, false, 'a fresh file has nothing to refold')
    first.close()

    // Put the file back the way version 3 left it: the column gone, the stamp
    // one behind. The log itself is untouched, which is the whole premise.
    const raw = new DatabaseSync(path)
    raw.exec('ALTER TABLE meetings DROP COLUMN scheduled_start')
    raw.exec("UPDATE schema_meta SET value = '3' WHERE key = 'version'")
    raw.close()

    const reopened = new Store(path, at(2000))
    assert.equal(reopened.log.refolded, true)
    const meeting = reopened.projections.getMeeting('m1')
    assert.equal(meeting?.title, 'Acme')
    assert.equal(meeting?.clientName, 'Acme SA')
    assert.equal(meeting?.scheduledStart, 55_000)
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

/**
 * The refold above drops `outbox` as well as `meetings`, and `outbox` is the one
 * projection where being wrong is not a display bug.
 *
 * `POST /v1/crm/tasks` has no idempotency key. A drained intent that came back
 * from the refold as `pending` would be re-posted on the next drain, and the
 * client would find two identical compte-rendus against the same account with
 * nothing in the app admitting why. The reason it does not happen is structural
 * — `push.settled` carries the remote id, so the id is in the *log* and the
 * outbox row is only ever a fold of it — but "structural" is a property of
 * today's event shape, and this is the test that notices when someone changes
 * it.
 */
test('a drained intent survives the refold drained, with its remote id', () => {
  const directory = mkdtempSync(join(tmpdir(), 'store-'))
  const path = join(directory, 'v3-outbox.db')
  try {
    const first = new Store(path, at(1000))
    first.append('m1', { type: 'meeting.created', title: 'Acme', context: null })
    first.append('m1', {
      type: 'push.intent.created',
      intent: {
        id: 'i-task',
        meetingId: 'm1',
        kind: 'crm.task',
        dependsOn: [],
        payload: {
          title: 'Compte-rendu Acme',
          body: '## Contexte',
          accountId: 'ACC-1042',
          opportunityRef: null,
          contactIds: [],
          dueAt: 1_760_000_000_000,
          endsAt: 1_760_003_600_000,
        },
      },
    })
    first.append('m1', { type: 'push.attempted', intentId: 'i-task', attempt: 1 })
    first.append('m1', {
      type: 'push.settled',
      result: { ok: true, intentId: 'i-task', remoteId: 'VSA-77123' },
    })
    assert.deepEqual(first.projections.drainable(), [], 'drained, so nothing left to post')
    first.close()

    const raw = new DatabaseSync(path)
    raw.exec('ALTER TABLE meetings DROP COLUMN scheduled_start')
    raw.exec("UPDATE schema_meta SET value = '3' WHERE key = 'version'")
    raw.close()

    const reopened = new Store(path, at(2000))
    assert.equal(reopened.log.refolded, true)
    const entry = reopened.projections.outboxFor('m1').find((e) => e.intentId === 'i-task')
    assert.equal(entry?.state, 'drained')
    assert.equal(entry?.remoteId, 'VSA-77123')
    // The one that would actually cost the client money.
    assert.deepEqual(
      reopened.projections.drainable(),
      [],
      'a refolded drained intent must never be offered for posting again',
    )
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Store.append folds into the projection in the same transaction', () => {
  const store = new Store(':memory:', at(1234))
  store.append('m1', { type: 'meeting.created', title: 'Acme', context: null })

  const meeting = store.projections.getMeeting('m1')
  assert.equal(meeting?.title, 'Acme')
  assert.equal(meeting?.state, 'idle')
  assert.equal(meeting?.createdAt, 1234)
  store.close()
})
