/**
 * `session:pause` — a verb on the recording, never on the machine.
 *
 * Three things are asserted, each the half of the feature a rep would notice
 * missing: the transcriber hears nothing while paused and everything again
 * after; the meeting is still `recording` the whole time, so every guard that
 * keys on that state (one recording at a time, the crash sweep, the widget's
 * existence) is untouched; and the change is broadcast once per edge, never
 * per press.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { recordingRig } from './recordingFakes.ts'

test('a paused recording drops frames before the transcriber and stays recording', async () => {
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const rig = await recordingRig({
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  })
  let writes = 0
  rig.transcribe.write = () => {
    writes += 1
  }
  const frame = { channel: 'rep', chunk: new Int16Array(160), sampleRate: 16_000 }

  rig.capture.emit('frame', frame)
  assert.equal(writes, 1)

  assert.equal(rig.orchestrator.setPaused(rig.meetingId, true), true)
  assert.equal(rig.orchestrator.isPaused(rig.meetingId), true)
  assert.equal(rig.orchestrator.stateOf(rig.meetingId), 'recording')
  rig.capture.emit('frame', frame)
  rig.capture.emit('frame', frame)
  assert.equal(writes, 1, 'frames reached the transcriber while paused')

  // Idempotent, and silent the second time.
  assert.equal(rig.orchestrator.setPaused(rig.meetingId, true), true)

  assert.equal(rig.orchestrator.setPaused(rig.meetingId, false), false)
  rig.capture.emit('frame', frame)
  assert.equal(writes, 2)

  const paused = broadcasts.filter((b) => b.channel === 'recording:paused')
  assert.deepEqual(
    paused.map((b) => b.payload),
    [
      { meetingId: rig.meetingId, paused: true },
      { meetingId: rig.meetingId, paused: false },
    ],
  )
  assert.deepEqual(
    rig.records.filter((r) => r.code.startsWith('recording.')).map((r) => r.code),
    ['recording.paused', 'recording.resumed'],
  )

  await rig.orchestrator.stopRecording(rig.meetingId)
})

test('a meeting that is not recording answers false', async () => {
  const rig = await recordingRig()
  assert.equal(rig.orchestrator.setPaused('m-absent', true), false)
  assert.equal(rig.orchestrator.isPaused('m-absent'), false)
  await rig.orchestrator.stopRecording(rig.meetingId)
})
