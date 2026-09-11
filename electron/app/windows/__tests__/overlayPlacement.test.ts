/**
 * Where the in-meeting widget lands, and the one failure that has no recovery.
 *
 * The widget is frameless, always on top, and absent from the taskbar. That
 * makes one mistake unrecoverable in a way an ordinary window's is not: put it
 * at coordinates no display covers and there is nothing to alt-tab to, no title
 * bar to drag, and no preference a rep can see to clear. A rep drags it onto a
 * second monitor, closes the lid on a train, and the widget is gone for ever.
 *
 * So the saved position is a *request*, never an instruction, and these are the
 * shapes that request can arrive in.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultOrigin, placeWindow, resizePlacement } from '../overlayPlacement.ts'

const SIZE = { width: 200, height: 50 }
/** A 1920×1080 laptop with a 40px taskbar, which is what `workArea` reports. */
const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 }
/** A second monitor to the **left**, so its coordinates are negative. */
const LEFT = { x: -1920, y: 0, width: 1920, height: 1080 }

test('with nothing saved it sits bottom centre of the primary display', () => {
  assert.deepEqual(placeWindow(null, SIZE, [LAPTOP]), defaultOrigin(SIZE, LAPTOP))
  assert.deepEqual(defaultOrigin(SIZE, LAPTOP), { x: 860, y: 966 })
})

test('a saved position on a display that is still there is honoured', () => {
  assert.deepEqual(placeWindow({ x: 40, y: 40 }, SIZE, [LAPTOP]), { x: 40, y: 40 })
})

test('a display to the left of the primary one is a real place to be', () => {
  // Negative coordinates are the normal case on a docked laptop, and a clamp
  // that assumes zero is the left edge drags the widget back to the primary
  // display every launch.
  assert.deepEqual(placeWindow({ x: -1800, y: 200 }, SIZE, [LAPTOP, LEFT]), { x: -1800, y: 200 })
})

test('a position on a display that has been unplugged falls back to the default', () => {
  const saved = { x: -1800, y: 200 }
  assert.deepEqual(placeWindow(saved, SIZE, [LAPTOP]), defaultOrigin(SIZE, LAPTOP))
})

test('a widget hanging a corner into the screen is not « mostly on a display »', () => {
  // Ten pixels of a 200×50 window, which is a widget the rep can neither read
  // nor grab. The quarter-area rule is what makes this the same answer as
  // « nowhere at all ».
  assert.deepEqual(placeWindow({ x: 1910, y: 1035 }, SIZE, [LAPTOP]), defaultOrigin(SIZE, LAPTOP))
})

test('a position mostly on a display is pulled fully onto it', () => {
  const origin = placeWindow({ x: 1850, y: 500 }, SIZE, [LAPTOP])
  assert.deepEqual(origin, { x: 1720, y: 500 })
})

test('growing from the bottom half keeps the bottom edge still', () => {
  // The pill is at the bottom; opening the panel must not slide the control the
  // rep just pressed out from under their pointer.
  const from = { width: 200, height: 50 }
  const to = { width: 340, height: 300 }
  const origin = resizePlacement({ x: 860, y: 966 }, from, to, [LAPTOP])
  assert.equal(origin.y + to.height, 966 + from.height)
  // And it grows about its own centre horizontally, because the pill is centred
  // in the card.
  assert.equal(origin.x + to.width / 2, 860 + from.width / 2)
})

test('growing from the top half keeps the top edge still', () => {
  const from = { width: 200, height: 50 }
  const to = { width: 340, height: 300 }
  const origin = resizePlacement({ x: 860, y: 40 }, from, to, [LAPTOP])
  assert.equal(origin.y, 40)
})

test('growing into a display with no room below it is clamped, not pushed off', () => {
  const tiny = { x: 0, y: 0, width: 800, height: 300 }
  const origin = resizePlacement({ x: 300, y: 40 }, { width: 200, height: 50 }, { width: 340, height: 280 }, [tiny])
  assert.equal(origin.y, 20)
  assert.ok(origin.y + 280 <= tiny.y + tiny.height)
})

test('a display smaller than the widget puts it at the top left rather than off it', () => {
  // `Math.max` last in the clamp. A work area of nothing is reachable while a
  // full-screen application transitions, and a negative range computed the
  // other way round puts the window at a negative offset.
  const nothing = { x: 0, y: 0, width: 100, height: 20 }
  assert.deepEqual(placeWindow({ x: 500, y: 500 }, SIZE, [nothing]), { x: 0, y: 0 })
})
