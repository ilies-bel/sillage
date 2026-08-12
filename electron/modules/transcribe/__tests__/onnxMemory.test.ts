/**
 * The memory floor that decides whether a checkpoint may be loaded at all.
 *
 * This is a gate that fails *closed*: when it says no, the local engine — the
 * default transcription path (DEC-30), and the one DEC-26 leans on because it
 * needs no network — does not start. So both directions of a wrong answer cost
 * something real, and both were wrong before these tests existed:
 *
 *  - too strict, loudly: a flat 2.0 GB refused Whisper Tiny, 74 MB of weights,
 *    on any machine that could not also have run Medium;
 *  - too lax, silently: the same 2.0 GB waved Medium through, and an ONNX
 *    session that cannot allocate takes the process with it.
 *
 * Both env vars used here are development overrides (DEC-34) and exist for
 * exactly this: making the gate answerable without owning the machine.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import {
  availableMemoryGB,
  hasEnoughMemory,
  measureAvailableMemory,
  memoryDecision,
  memoryVerdict,
  requiredMemoryGB,
} from '../whisper/onnx.ts'
import type { MemoryReading } from '../whisper/onnx.ts'
import { MODELS, DEFAULT_MODEL_ID } from '../whisper/catalog.ts'

const AVAILABLE = 'SILLAGE_ONNX_AVAILABLE_MEM_GB'
const FLOOR = 'SILLAGE_ONNX_MIN_FREE_GB'

/** Runs `body` with the two overrides set, and puts the environment back. */
const withMemory = (env: Record<string, string | undefined>, body: () => void): void => {
  const before = { [AVAILABLE]: process.env[AVAILABLE], [FLOOR]: process.env[FLOOR] }
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    body()
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const clean = (body: () => void): void => withMemory({ [AVAILABLE]: undefined, [FLOOR]: undefined }, body)

test('the requirement scales with the checkpoint instead of being one number', () => {
  clean(() => {
    const required = MODELS.map((m) => ({ label: m.label, mb: m.sizeMb, gb: requiredMemoryGB(m.id) }))

    // Monotonic: a bigger checkpoint never asks for less than a smaller one.
    for (let i = 1; i < required.length; i++) {
      const prev = required[i - 1]!
      const here = required[i]!
      if (here.mb <= prev.mb) continue
      assert.ok(here.gb >= prev.gb, `${here.label} (${here.mb} Mo) asks less than ${prev.label}`)
    }

    // And the spread is the whole point — one number cannot serve both ends.
    const smallest = Math.min(...required.map((r) => r.gb))
    const largest = Math.max(...required.map((r) => r.gb))
    assert.ok(largest >= smallest * 3, `spread too flat: ${smallest} … ${largest} GB`)
  })
})

test('the runtime baseline floors the small checkpoints', () => {
  clean(() => {
    // 74 MB of weights scaled alone would claim 0.2 GB, which is not a number
    // any ONNX runtime has ever loaded a model in.
    assert.equal(requiredMemoryGB('Xenova/whisper-tiny'), 0.5)
    assert.equal(requiredMemoryGB('Xenova/whisper-base'), 0.5)
  })
})

test('the default checkpoint asks for about a gigabyte, not two', () => {
  clean(() => {
    const gb = requiredMemoryGB(DEFAULT_MODEL_ID)
    // Measured: two concurrent loads of Small peaked at 2.1 GB, so one is ~1.05.
    assert.ok(gb > 0.9 && gb < 1.4, `Small asks ${gb} GB`)
    // The regression this exists for: it used to be refused below 2.0.
    assert.ok(gb < 2.0)
  })
})

test('a checkpoint nobody has heard of keeps the conservative flat floor', () => {
  clean(() => {
    assert.equal(requiredMemoryGB('some-org/not-in-the-catalog'), 2.0)
    assert.equal(requiredMemoryGB(undefined), 2.0)
  })
})

test('the development override still wins, for every model', () => {
  withMemory({ [FLOOR]: '0' }, () => {
    for (const model of MODELS) assert.equal(requiredMemoryGB(model.id), 0)
  })
})

test('a laptop with 1.5 GB free runs Tiny and is refused Medium', () => {
  withMemory({ [AVAILABLE]: '1.5', [FLOOR]: undefined }, () => {
    assert.equal(availableMemoryGB(), 1.5)
    // Under the flat 2.0 GB floor every one of these was a refusal, which is
    // the report that produced this test.
    assert.equal(hasEnoughMemory('Xenova/whisper-tiny'), true)
    assert.equal(hasEnoughMemory('Xenova/whisper-base'), true)
    assert.equal(hasEnoughMemory(DEFAULT_MODEL_ID), true)
    // Still refused, and rightly: 1530 MB of weights does not fit in 1.5 GB.
    assert.equal(hasEnoughMemory('Xenova/whisper-medium'), false)
  })
})

test('the quiet half — Medium is refused at exactly the old floor', () => {
  withMemory({ [AVAILABLE]: '2.0', [FLOOR]: undefined }, () => {
    // The flat floor admitted this one, and an ONNX session that cannot
    // allocate does not throw — it aborts the process, mid-meeting.
    assert.equal(hasEnoughMemory('Xenova/whisper-medium'), false)
    assert.equal(hasEnoughMemory('onnx-community/whisper-large-v3-turbo-ONNX'), false)
  })
})

test('a machine with room loads everything in the catalog', () => {
  withMemory({ [AVAILABLE]: '8', [FLOOR]: undefined }, () => {
    for (const model of MODELS) {
      assert.equal(hasEnoughMemory(model.id), true, `${model.label} refused at 8 GB free`)
    }
  })
})

// ── The fallback ──────────────────────────────────────────────────────────
//
// Windows takes this path on every launch: there is no available-memory probe
// for it, and it is the primary platform (HR-2). These pin the rule directly,
// so they hold on whatever host runs the suite.

const probe = (gb: number): MemoryReading => ({ gb, source: 'probe', note: null })
const freemem = (gb: number): MemoryReading => ({ gb, source: 'freemem', note: 'pas de sonde' })

test('a free-page count never refuses a machine that has the RAM', () => {
  const need = requiredMemoryGB(DEFAULT_MODEL_ID)
  /*
   * The exact shape of the bug. Measured on a 64 GB Mac with 18.9 GB genuinely
   * available, `os.freemem()` reported 2.69 GB — every modern OS keeps the free
   * list near zero and calls the rest cache. Windows had no probe, so this
   * number *was* the answer, and 1.4 GB of free pages on a 16 GB laptop refused
   * the default model with « moins de 2 Go disponibles ».
   */
  assert.equal(memoryDecision(freemem(1.4), need, 16), true, '16 GB machine refused')
  assert.equal(memoryDecision(freemem(0.2), need, 32), true, '32 GB machine refused')
})

test('the fallback still refuses a machine that could never hold the model', () => {
  // The one claim os.totalmem() does support. Medium wants 3.7 GB.
  const medium = requiredMemoryGB('Xenova/whisper-medium')
  assert.equal(memoryDecision(freemem(3), medium, 4), false, '4 GB laptop admitted Medium')
  assert.equal(memoryDecision(freemem(0.1), medium, 16), true, '16 GB laptop refused Medium')
})

test('a real probe is still trusted in both directions', () => {
  const need = requiredMemoryGB(DEFAULT_MODEL_ID)
  // A probe knows the machine is busy, and that is a real reason to wait.
  assert.equal(memoryDecision(probe(0.4), need, 64), false)
  assert.equal(memoryDecision(probe(need), need, 64), true)
})

test('a reading says whether it measured anything, and why not', () => {
  clean(() => {
    const reading = measureAvailableMemory()
    assert.ok(reading.source === 'probe' || reading.source === 'freemem')
    // A fallback must carry its reason: the failure used to be swallowed, which
    // made a broken probe and a real measurement indistinguishable.
    if (reading.source === 'freemem') assert.ok(reading.note, 'fallback with no reason')
    else assert.equal(reading.note, null)
    assert.ok(Number.isFinite(reading.gb) && reading.gb >= 0)
  })
})

test('the verdict carries the numbers it decided on', () => {
  withMemory({ [AVAILABLE]: '0.1', [FLOOR]: undefined }, () => {
    const verdict = memoryVerdict(DEFAULT_MODEL_ID)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.reading.gb, 0.1)
    assert.equal(verdict.requiredGB, requiredMemoryGB(DEFAULT_MODEL_ID))
    assert.ok(verdict.totalGB > 0)
    assert.equal(verdict.totalGB, os.totalmem() / 1024 ** 3)
  })
})
