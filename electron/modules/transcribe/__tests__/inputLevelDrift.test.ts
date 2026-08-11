/**
 * One number, two files, and a test that will not let them disagree.
 *
 * `core/domain/inputLevel.ts` decides whether the microphone is too quiet to be
 * transcribed, and the whole rule turns on where *this* VAD draws the line
 * between speech and silence. `core/` may import nothing but `core/`, so that
 * threshold is duplicated there rather than imported. A duplicate nobody checks
 * is a duplicate that drifts: retune the VAD alone and the warning keeps citing
 * the old bar, which makes it wrong in exactly the case it exists to catch.
 *
 * This test is the check. It lives here because `modules/X` may import `core/`
 * and the reverse is forbidden — so this is the only side that can see both.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SPEECH_FLOOR } from '../../../core/domain/inputLevel.ts'
import { RMS_THRESHOLD } from '../whisper/vad.ts'

test('the input-level detector uses the threshold this VAD actually applies', () => {
  assert.equal(
    SPEECH_FLOOR,
    RMS_THRESHOLD,
    'retune one and retune the other — see core/domain/inputLevel.ts',
  )
})
