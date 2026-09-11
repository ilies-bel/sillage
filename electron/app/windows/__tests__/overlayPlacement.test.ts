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
import { defaultOrigin, opensAbove, placeAroundPill, placeWindow } from '../overlayPlacement.ts'

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

/**
 * **The pill is the anchor, and the first version anchored a window edge.**
 *
 * The pill is drawn at the *top* of the content and the panel opens under it,
 * so « keep the bottom edge still » moved the control the rep had just pressed
 * by the entire height of the panel — 333 pixels on the default placement,
 * which is where every widget starts. The test that was here asserted the old
 * rule faithfully and could not see the defect, because it measured rectangles
 * and never asked what is drawn at the top of one. These measure the pill.
 */
const pillAt = (screenTop: number, offsetTop = 16, height = 44) => ({
  screenTop,
  screenCentreX: 960,
  offsetTop,
  height,
})

/**
 * The renderer, in three lines.
 *
 * `opensAbove` decides the stacking and the renderer lays out accordingly, so
 * the pill's offset inside the frame is a *consequence* of that answer. Modelled
 * here rather than asserted in isolation, because the property that matters —
 * the pill does not move — is a property of the two halves together, and either
 * one alone can be right while the pair is wrong. That is exactly how the first
 * version passed its own test and moved the pill 333 pixels.
 */
const MARGIN = 16
const PILL_H = 44
const laidOut = (screenTop: number, height: number, areas: readonly { x: number; y: number; width: number; height: number }[]) => {
  const collapsed = pillAt(screenTop)
  const above = opensAbove(collapsed, areas)
  const offsetTop = above ? height - MARGIN - PILL_H : MARGIN
  const pill = { ...collapsed, offsetTop }
  return { pill, origin: placeAroundPill(pill, { width: 340, height }, areas), above }
}

test('opening the panel leaves the pill exactly where it was, either way up', () => {
  // Bottom half: the panel stacks above, so the pill keeps its screen position.
  const low = laidOut(900, 380, [LAPTOP])
  assert.equal(low.above, true)
  assert.equal(low.origin.y + low.pill.offsetTop, 900)
  // And centred on it, because the pill is centred in the card.
  assert.equal(low.origin.x + 340 / 2, low.pill.screenCentreX)

  // Top half: the panel stacks below, and the pill still does not move.
  const high = laidOut(60, 380, [LAPTOP])
  assert.equal(high.above, false)
  assert.equal(high.origin.y + high.pill.offsetTop, 60)
})

test('the pill does not move at any height the rep can drag it to', () => {
  // The whole travel of the display, every twenty pixels. The defect this
  // replaces was invisible at one position and 333 pixels at another.
  /*
   * From one halo's width inside the top edge to one inside the bottom. The
   * shadow margin is part of the window, so a pill pressed against the very
   * edge of a display is a window whose halo would hang off it — the clamp
   * moves it back by those sixteen pixels, correctly, and that is the only
   * place in the travel where the pill shifts at all.
   */
  for (let top = LAPTOP.y + MARGIN; top < LAPTOP.y + LAPTOP.height - PILL_H - MARGIN; top += 20) {
    const { pill, origin } = laidOut(top, 380, [LAPTOP])
    assert.equal(
      origin.y + pill.offsetTop,
      top,
      `la pastille a bougé depuis ${top}`,
    )
  }
})

test('collapsing it leaves the pill where it was too', () => {
  const pill = pillAt(900)
  const origin = placeAroundPill(pill, { width: 232, height: 76 }, [LAPTOP])
  assert.equal(origin.y + pill.offsetTop, 900)
})

test('the pill only moves when the panel cannot fit on the display at all', () => {
  // Hard against the top, with a panel taller than the room above and below.
  const origin = placeAroundPill(pillAt(4), { width: 340, height: 1200 }, [LAPTOP])
  assert.equal(origin.y, LAPTOP.y)
})

test('the panel opens upward from the bottom half and downward from the top', () => {
  assert.equal(opensAbove(pillAt(900), [LAPTOP]), true)
  assert.equal(opensAbove(pillAt(40), [LAPTOP]), false)
})

test('the half is the pill’s own display, not the primary one', () => {
  // On the left-hand monitor, near its bottom. Measuring against the primary
  // display's height would answer for a screen the pill is not on.
  const pill = { screenTop: 1000, screenCentreX: -960, offsetTop: 16, height: 44 }
  assert.equal(opensAbove(pill, [LAPTOP, LEFT]), true)
  assert.equal(opensAbove({ ...pill, screenTop: 40 }, [LAPTOP, LEFT]), false)
})

test('a pill on no display at all still answers, rather than throwing', () => {
  // Reachable for the frame between a monitor being unplugged and the clamp
  // moving the window back — `placeAroundPill` is what fixes it, and this must
  // not be the thing that throws in between.
  assert.equal(opensAbove(pillAt(9_000), [LAPTOP]), true)
})

// ── a placement the rep made with their own hand ────────────────────────────

test('a turn arriving never moves the widget sideways', () => {
  /*
   * **The rep tucked the pill against the right edge and it slid back.**
   *
   * `placeAroundPill` clamped the card fully inside the display on *every*
   * resize, and a resize is what happens each time a turn of the call changes
   * the frame's height. Measured: dropped at x 1780 on a 1920 display, back at
   * 1639 one turn later — a hundred and forty-one pixels over the video, with
   * nobody touching anything. The stored preference kept an x the app would
   * never honour, so it happened again on the next launch.
   */
  const display = { x: 0, y: 0, width: 1920, height: 1080 }
  const pill = { screenTop: 900, screenCentreX: 1780 + 281 / 2, offsetTop: 20, height: 52 }
  const from = { width: 281, height: 78 }

  const same = placeAroundPill(pill, { width: 281, height: 96 }, [display], from)
  assert.equal(same.x, 1780, 'la largeur n’a pas changé : le x du commercial est gardé')

  // And growth still clamps: a card that widens has to fit, or the controls the
  // rep just asked for are drawn off the display.
  const grown = placeAroundPill(pill, { width: 380, height: 431 }, [display], from)
  assert.ok(grown.x + 380 <= display.width, `un panneau plus large reste à l’écran (x=${grown.x})`)

  // With no `from` at all — the creation path — the old behaviour stands.
  const created = placeAroundPill(pill, { width: 281, height: 96 }, [display])
  assert.equal(created.x, 1920 - 281)
})
