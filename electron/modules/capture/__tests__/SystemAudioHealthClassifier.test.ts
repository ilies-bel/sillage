import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioHealthClassifier, peakToPeakInt16LE } from '../systemAudioHealthClassifier.ts';
import type { HealthOutcome } from '../systemAudioHealthClassifier.ts';

function zeroChunk(bytes = 1920) {
  return Buffer.alloc(bytes);
}

function rampChunk(samples = 960) {
  const chunk = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = i % 2 === 0 ? -1000 : 1000;
    chunk.writeInt16LE(value, i * 2);
  }
  return chunk;
}

function assertNoUserWarning(decision: HealthOutcome): void {
  assert.notEqual(decision.type, 'warn-user', `expected no user warning, got ${JSON.stringify(decision)}`);
}

test('no chunks after watchdog tick is log-only and never a user warning', () => {
  const health = new SystemAudioHealthClassifier({ watchdogMs: 12_000 });
  assertNoUserWarning(health.handle({ kind: 'capture-started', nowMs: 0 }));

  const decision = health.handle({ kind: 'watchdog-tick', nowMs: 12_000 });

  assert.equal(decision.type, 'log');
  assert.equal('reason' in decision ? decision.reason : null, 'initial-silence-no-chunks');
});

test('sustained zero-valued chunks are treated as silence, not permission failure', () => {
  const health = new SystemAudioHealthClassifier({ zeroObservationMs: 12_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decisions: HealthOutcome[] = [];
  for (let nowMs = 0; nowMs <= 13_000; nowMs += 1000) {
    const decision = health.handle({ kind: 'chunk', nowMs, chunk: zeroChunk() });
    assertNoUserWarning(decision);
    decisions.push(decision);
  }

  const silenceLog = decisions.find((decision) => ('reason' in decision ? decision.reason : '') === 'sustained-zero-valued-silence');
  assert.equal(silenceLog?.type, 'log');
});

test('transcript absence cannot influence system-audio health classification', () => {
  const health = new SystemAudioHealthClassifier();
  health.handle({ kind: 'capture-started', nowMs: 0 });

  const decision = health.handle({ kind: 'watchdog-tick', nowMs: 45_000 });

  assertNoUserWarning(decision);
  assert.equal(
    SystemAudioHealthClassifier.supportedEventKinds.includes('transcript-missing'),
    false,
    'classifier API must not accept transcript absence as a system-audio failure signal',
  );
});


test('inter-chunk gaps are diagnostics only', () => {
  const health = new SystemAudioHealthClassifier({ interChunkGapLogMs: 2_000 });
  health.handle({ kind: 'capture-started', nowMs: 0 });
  assertNoUserWarning(health.handle({ kind: 'chunk', nowMs: 0, chunk: rampChunk() }));

  const decision = health.handle({ kind: 'chunk', nowMs: 3_000, chunk: rampChunk() });

  assert.equal(decision.type, 'log');
  assert.equal(decision.reason, 'inter-chunk-gap');
});

/**
 * **A full-scale signal must never measure as flat.**
 *
 * The stride was `(length >> 5) & ~1` *bytes* — ten samples on a 640-byte frame,
 * and ten is even — so every sample it looked at had the same parity. A waveform
 * that alternates sign each sample came back `min === max`, peak-to-peak zero,
 * from a signal at full scale: the detector whose one job is to tell zero from
 * not-zero could be told silence by a periodic signal whose period divides its
 * own step.
 */
test('a signal that alternates every sample is not measured as silence', () => {
  const alternating = Buffer.alloc(640)
  for (let i = 0; i < 320; i += 1) alternating.writeInt16LE(i % 2 === 0 ? 6_000 : -6_000, i * 2)
  assert.equal(peakToPeakInt16LE(alternating), 12_000)

  // Every period a stride could plausibly land on, at frame sizes the tap
  // actually delivers — none of them may read flat.
  for (const period of [2, 4, 8, 16, 32, 64]) {
    for (const bytes of [320, 640, 1_280, 3_840]) {
      const wave = Buffer.alloc(bytes)
      for (let i = 0; i < bytes / 2; i += 1) {
        wave.writeInt16LE(i % period < period / 2 ? 8_000 : -8_000, i * 2)
      }
      assert.ok(
        peakToPeakInt16LE(wave) > 0,
        `période ${period} à ${bytes} octets mesurée comme silencieuse`,
      )
    }
  }

  // And silence is still silence.
  assert.equal(peakToPeakInt16LE(Buffer.alloc(640)), 0)
})
