/**
 * **The widget's rescue, driven on the shipped class.**
 *
 * `overlayPlacement.test.ts` beside this proves the arithmetic, and it was green
 * throughout the defect this file exists for — because the arithmetic was right
 * and *nothing called it*. `placeWindow`'s quarter-overlap rule is the defence
 * its own docblock calls « the whole reason the placement is a module »: this
 * window is frameless, always on top and absent from the taskbar, so coordinates
 * no display covers are *unrecoverable*. And it ran in exactly two places — the
 * creation path, and the reply to a `widget:resize`.
 *
 * Which made the rescue depend on the **renderer re-rendering**: a turn of the
 * call arriving. It therefore could not happen on the one failure the pill is up
 * to report. What kept it working at all was a missing dependency array in
 * `Frame`'s layout effect, which re-armed the duplicate-suppressing key on every
 * render and sent a byte-identical measurement — under a comment arguing that the
 * duplicate was free and could not matter. So the property to prove is stated
 * negatively and it is the whole point of this file: **a display going away
 * rescues the pill with no renderer involvement whatsoever.**
 *
 * `Overlay` is reachable here because every Electron-shaped thing it touches is
 * injected: `create`, `areas`, `load`, `focusMain` and `placed`. What is faked is
 * the window — the object Electron would hand back — and it is faked as a
 * *position*, because the position is what the whole file is about.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserWindow } from 'electron'
import { memoryKeyValueStore } from '../../../core/contracts/kv.ts'
import { Overlay, type OverlayHost, type WidgetPlacement } from '../Overlay.ts'

/** A 1512×877 laptop work area — a MacBook with its menu bar and Dock taken off. */
const LAPTOP = { x: 0, y: 0, width: 1512, height: 877 }
/** A second monitor **below** it, which is how a laptop on a desk is arranged. */
const BELOW = { x: 0, y: 877, width: 1920, height: 1080 }

/**
 * The window, as a rectangle that remembers being moved.
 *
 * `moved` is emitted from `setBounds` because Electron emits it from there too,
 * which is the whole reason `Overlay` carries a `#moving` flag — a rescue that
 * re-saved its own repositioning as the rep's preference would walk the stored
 * origin up the display over a working day.
 */
const fakeWindow = (x: number, y: number, width: number, height: number) => {
  const handlers = new Map<string, (() => void)[]>()
  const state = { x, y, width, height, destroyed: false, bounds: 0 }
  const window = {
    isDestroyed: () => state.destroyed,
    getPosition: () => [state.x, state.y],
    setBounds: (box: { x: number; y: number; width: number; height: number }) => {
      state.bounds += 1
      const moved = box.x !== state.x || box.y !== state.y
      Object.assign(state, box)
      if (moved) for (const fn of handlers.get('moved') ?? []) fn()
    },
    on: (event: string, fn: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return window
    },
    once: (event: string, fn: () => void) => window.on(event, fn),
    showInactive: () => {},
    destroy: () => void (state.destroyed = true),
    setIgnoreMouseEvents: () => {},
  }
  /** What the OS does when the rep drags a frameless window by its pill. */
  const drag = (to: { x: number; y: number }) => {
    Object.assign(state, to)
    for (const fn of handlers.get('moved') ?? []) fn()
  }
  return { window: window as unknown as BrowserWindow, state, drag }
}

type Fake = ReturnType<typeof fakeWindow>

const staged = (areas: { x: number; y: number; width: number; height: number }[]) => {
  let live = areas
  const built: Fake[] = []
  const placed: WidgetPlacement[] = []
  const host: OverlayHost = {
    create: (options) => {
      const made = fakeWindow(options.x, options.y, options.width, options.height)
      built.push(made)
      return made.window
    },
    areas: () => live,
    load: () => {},
    focusMain: () => true,
    placed: (placement) => void placed.push(placement),
  }
  const overlay = new Overlay(host, memoryKeyValueStore())
  overlay.show()
  const window = built[0]
  assert.ok(window, 'la fenêtre n’a pas été créée')
  return {
    overlay,
    placed,
    window,
    /** Unplug a monitor, or plug one in. Primary stays first, as `main.ts` sends it. */
    displays: (next: typeof areas) => {
      live = next
    },
  }
}

/** The pill's top edge, in screen coordinates — the number that must not move. */
const pillTop = (state: { y: number }, offset: number) => state.y + offset

// ── the rescue, with no renderer involvement at all ──────────────────────────

test('a display going away puts the pill back on screen with no widget:resize', () => {
  const staging = staged([LAPTOP, BELOW])

  // The renderer measures itself once, as it does on its first paint.
  staging.overlay.resize({ width: 380, height: 92, pillTop: 20, pillHeight: 52 })

  // The rep drags the pill down onto the second monitor, near its bottom.
  staging.window.drag({ x: 600, y: 1900 })
  assert.equal(pillTop(staging.window.state, 20), 1920)

  // The monitor goes. Nothing else happens — no turn arrives, so the renderer
  // does not re-render and sends nothing. This is the case that used to be
  // unrecoverable: there is no taskbar entry, nothing to alt-tab to and no
  // title bar to drag it back with.
  const sent = staging.window.state.bounds
  staging.displays([LAPTOP])
  staging.overlay.displaysChanged()

  const top = pillTop(staging.window.state, 20)
  assert.ok(
    top >= LAPTOP.y && top < LAPTOP.y + LAPTOP.height,
    `la pastille est hors écran : y=${top}, la zone de travail s’arrête à ${LAPTOP.y + LAPTOP.height}`,
  )
  assert.ok(staging.window.state.bounds > sent, 'la fenêtre n’a pas été déplacée')
})

test('a window already on a display is left exactly where it is', () => {
  // Idempotence is what makes it safe to call on every `display-metrics-changed`,
  // including the ones fired for a display the pill is not on.
  const staging = staged([LAPTOP, BELOW])
  staging.overlay.resize({ width: 380, height: 92, pillTop: 20, pillHeight: 52 })
  staging.window.drag({ x: 400, y: 300 })

  const before = { ...staging.window.state }
  staging.overlay.displaysChanged()
  staging.overlay.displaysChanged()
  assert.deepEqual(
    { x: staging.window.state.x, y: staging.window.state.y },
    { x: before.x, y: before.y },
  )
})

test('the rescue is not stored as a placement the rep asked for', () => {
  /*
   * `setBounds` emits `moved`, so a rescue that let the save through would write
   * a position the rep never chose over the one they did — and the saved origin
   * is the only record of where they want the pill. `#moving` is what stops it,
   * and this is the caller that would otherwise trip it.
   */
  const kv = memoryKeyValueStore()
  let live = [LAPTOP, BELOW]
  const built: Fake[] = []
  const overlay = new Overlay(
    {
      create: (options) => {
        const made = fakeWindow(options.x, options.y, options.width, options.height)
        built.push(made)
        return made.window
      },
      areas: () => live,
      load: () => {},
      focusMain: () => true,
      placed: () => {},
    },
    kv,
  )
  overlay.show()
  const staging = built[0]
  assert.ok(staging, 'la fenêtre n’a pas été créée')
  overlay.resize({ width: 380, height: 92, pillTop: 20, pillHeight: 52 })
  staging.drag({ x: 600, y: 1900 })
  const chosen = kv.get('overlay.origin')

  live = [LAPTOP]
  overlay.displaysChanged()
  assert.equal(kv.get('overlay.origin'), chosen, 'le sauvetage a écrasé la position choisie')
})

test('with no window there is nothing to place, and that is not an error', () => {
  // Most of the time. `display-metrics-changed` fires while no meeting is
  // recording far more often than during one.
  const staging = staged([LAPTOP])
  staging.overlay.hide()
  staging.overlay.displaysChanged()
  assert.deepEqual(staging.placed, [])
})

// ── the stacking direction, when the renderer did not ask ────────────────────

test('dragging the pill across the midline tells the renderer which way to open', () => {
  /*
   * `opensAbove` had one caller — the `return` of `resize()` — reached only when
   * `${w}×${h}×${pillTop}` changed in the renderer. `pillTop` is a *consequence*
   * of `above`, so it cannot change until `above` already has: the answer was
   * structurally unable to be recomputed by the only thing that asked for it.
   * A drag from the bottom half of the display to the top left the renderer
   * stacking the panel upward, off the top of the screen, for the rest of the
   * call — and a drag resizes nothing, so there was no reply to carry it.
   */
  const staging = staged([LAPTOP])
  const low = staging.overlay.resize({ width: 380, height: 92, pillTop: 20, pillHeight: 52 })
  assert.equal(low.above, true, 'la pastille est dans la moitié basse')
  assert.deepEqual(staging.placed, [], 'le renderer venait de demander : rien à diffuser')

  staging.window.drag({ x: 600, y: 40 })
  assert.deepEqual(staging.placed, [{ ok: true, above: false }])
})

test('a drag that stays in the same half says nothing', () => {
  // macOS emits one `moved` per pixel of a drag. What is wanted is the edge.
  const staging = staged([LAPTOP])
  staging.overlay.resize({ width: 380, height: 92, pillTop: 20, pillHeight: 52 })
  for (let y = 800; y > 600; y -= 4) staging.window.drag({ x: 600, y })
  assert.deepEqual(staging.placed, [], `moitié basse tout du long, ${staging.placed.length} messages`)
})

test('a rescue that changes the half says so too', () => {
  /*
   * The two halves of this file meeting: the pill was near the bottom of a tall
   * second monitor, the monitor goes, and the default placement on the laptop is
   * *also* in a bottom half — so nothing is announced there. Put it near the top
   * of the monitor that goes away and the clamp lands it in the laptop's bottom
   * half, which is a flip the renderer has to hear about.
   */
  const staging = staged([LAPTOP, { x: 1512, y: 0, width: 1920, height: 1080 }])
  staging.overlay.resize({ width: 380, height: 92, pillTop: 20, pillHeight: 52 })
  staging.window.drag({ x: 1900, y: 60 })
  staging.placed.length = 0

  staging.displays([LAPTOP])
  staging.overlay.displaysChanged()
  assert.deepEqual(staging.placed, [{ ok: true, above: true }])
})
