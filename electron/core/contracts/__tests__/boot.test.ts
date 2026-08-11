/**
 * The boot contract, and the one rule that decides whether screen 0 still holds
 * the window.
 *
 * Two things are checked here and neither is a formality:
 *
 *  · **`failed` does not hold.** It is the invariant a reviewer is most likely
 *    to "fix" — a failed step *looks* like something to wait for — and getting
 *    it wrong means an app that refuses to open because its transcription
 *    engine is missing, which is the opposite of DEC-26.
 *  · **The shape has no room for an optional connector.** "Nothing optional is
 *    awaited" is a property of `BootStateSchema`, so the test that proves it is
 *    a parse, not a code review.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { BootStateSchema, BootStepSchema } from '../boot.ts'
import { BOOT_STEPS, bootAnswered, isBootPending } from '../bootSteps.ts'
import type { BootState, BootStep } from '../boot.ts'

const state = (steps: Partial<Record<(typeof BOOT_STEPS)[number], BootStep>>): BootState => ({
  store: { state: 'ready', value: 'sillage.db · schéma v3' },
  devices: { state: 'ready', value: 'moteur de capture chargé' },
  transcription: { state: 'ready', value: 'Whisper (local)' },
  version: '0.1.0',
  ...steps,
})

describe('the three steps', () => {
  test('they are the three the splash draws, in VISION.md §6 order', () => {
    assert.deepEqual([...BOOT_STEPS], ['store', 'devices', 'transcription'])
  })

  test('there is no field for anything optional (DEC-26)', () => {
    // The calendar, VerySwing and Outlook connect in the background and never
    // hold the window. A fourth line creeping onto this screen would have to
    // start with a fourth key here, and it would not parse.
    const parsed = BootStateSchema.parse({
      ...state({}),
      calendar: { state: 'pending' },
      crm: { state: 'pending' },
    })
    assert.equal('calendar' in parsed, false)
    assert.equal('crm' in parsed, false)
  })

  test('a value is never blank — a step that says nothing is unrepresentable', () => {
    assert.equal(BootStepSchema.safeParse({ state: 'ready', value: '' }).success, false)
    assert.equal(BootStepSchema.safeParse({ state: 'failed', value: '' }).success, false)
  })

  test('a download carries a whole percent within range', () => {
    assert.equal(
      BootStepSchema.safeParse({ state: 'downloading', value: '42 %', percent: 42 }).success,
      true,
    )
    assert.equal(
      BootStepSchema.safeParse({ state: 'downloading', value: '…', percent: 101 }).success,
      false,
    )
    assert.equal(
      BootStepSchema.safeParse({ state: 'downloading', value: '…', percent: 12.5 }).success,
      false,
    )
    // …and never without one, which is what makes a bar wired to a timer
    // unconstructible rather than merely discouraged.
    assert.equal(BootStepSchema.safeParse({ state: 'downloading', value: '…' }).success, false)
  })
})

describe('what holds the window shut', () => {
  test('pending holds it, and it is the state the renderer starts in', () => {
    assert.equal(isBootPending({ state: 'pending' }), true)
    assert.equal(bootAnswered(state({ devices: { state: 'pending' } })), false)
  })

  test('downloading holds it too (DEC-30)', () => {
    // The one case this screen genuinely exists for. A window that opened over
    // a half-finished model fetch is a window with no transcription behind it.
    assert.equal(isBootPending({ state: 'downloading', value: '12 %', percent: 12 }), true)
    assert.equal(
      bootAnswered(state({ transcription: { state: 'downloading', value: '12 %', percent: 12 } })),
      false,
    )
  })

  test('failed does NOT hold it', () => {
    // The invariant. Capture, the notepad and a hand-written compte-rendu all
    // survive a missing transcription engine; refusing to open takes those away
    // to protest the one thing that is wrong.
    assert.equal(isBootPending({ state: 'failed', value: 'aucun moteur disponible' }), false)
    assert.equal(
      bootAnswered(state({ transcription: { state: 'failed', value: 'aucun moteur disponible' } })),
      true,
    )
  })

  test('all three failed still opens the app', () => {
    assert.equal(
      bootAnswered(
        state({
          store: { state: 'failed', value: 'x' },
          devices: { state: 'failed', value: 'y' },
          transcription: { state: 'failed', value: 'z' },
        }),
      ),
      true,
    )
  })

  test('nothing known holds it — "not asked" is not "fine"', () => {
    assert.equal(bootAnswered(null), false)
  })

  test('everything ready opens it', () => {
    assert.equal(bootAnswered(state({})), true)
  })
})
