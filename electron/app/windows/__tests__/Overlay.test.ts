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
import { EXIT_FALLBACK_MS, Overlay, type OverlayHost, type WidgetPlacement } from '../Overlay.ts'

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
  const state = {
    x,
    y,
    width,
    height,
    destroyed: false,
    bounds: 0,
    /** Every `setIgnoreMouseEvents` this window was given, in order. */
    mouse: [] as { through: boolean; forward: boolean | undefined }[],
  }
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
    setIgnoreMouseEvents: (through: boolean, options?: { forward?: boolean }) =>
      void state.mouse.push({ through, forward: options?.forward }),
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
  /** The windows that were asked to play their exit — `widget:leave`, addressed. */
  const asked: BrowserWindow[] = []
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
    leave: (window) => void asked.push(window),
  }
  const overlay = new Overlay(host, memoryKeyValueStore())
  overlay.show()
  const window = built[0]
  assert.ok(window, 'la fenêtre n’a pas été créée')
  return {
    overlay,
    placed,
    asked,
    built,
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
      leave: () => {},
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

// ── the exit, and the three promises it must not break ───────────────────────
//
// The pill is the one surface in this product drawn over another application,
// and `destroy()` took it off a video call between two frames — at the one
// moment the rep is certainly looking at it, because the ordinary way a
// recording ends is them pressing the pill's own *Terminer*. So it fades.
//
// Everything below is about what a fade must not cost. A window that is being
// animated away is still a live, frameless, always-on-top window, and for a
// fraction of a second it is one this class no longer holds.

test('la fenêtre qui s’en va cesse d’être la nôtre avant de disparaître', () => {
  /*
   * **The second call of the day, taken immediately after the first.**
   *
   * `show()` is idempotent on `#window` — deliberately, so a transcript segment
   * moving the state machine cannot recreate the pill and collapse the rep's open
   * panel. Which means a window still held here while it faded would be *adopted*
   * by the next recording, and then destroyed by its own fallback timer a few
   * hundred milliseconds later: the rep's second call would have nothing over it,
   * with no gesture able to bring it back.
   */
  const staging = staged([LAPTOP])
  const first = staging.window

  staging.overlay.dismiss()
  assert.equal(staging.overlay.window, null, 'la fenêtre est encore tenue')
  assert.equal(first.state.destroyed, false, 'détruite sans laisser le temps de l’animation')

  staging.overlay.show()
  assert.equal(staging.built.length, 2, 'la seconde réunion a repris la fenêtre mourante')
  assert.notEqual(staging.overlay.window, first.window)
})

test('elle ne prend plus la souris, et sans redemander les mouvements', () => {
  /*
   * A card mid-fade is a rectangle the rep has no reason to expect a click to
   * land on — they have finished the call. `{ forward: false }` and not the
   * pass-through the rest of this file is about: that one keeps delivering moves
   * so the renderer can notice the pointer coming back over the card, and a
   * leaving window has no interest in the pointer ever again.
   */
  const staging = staged([LAPTOP])
  staging.window.state.mouse.length = 0

  staging.overlay.dismiss()
  assert.deepEqual(staging.window.state.mouse, [{ through: true, forward: false }])
})

test('un rendu muet perd sa fenêtre quand même', (t) => {
  /*
   * The animation is a courtesy and the reply is not load-bearing: the timer is
   * armed *before* the ask. A pill left on screen over a call that has ended —
   * frameless, no taskbar entry, nothing to alt-tab to — is worse than a pill
   * that pops.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.overlay.dismiss()
  assert.deepEqual(staging.asked, [staging.window.window], 'le rendu n’a pas été prévenu')

  t.mock.timers.tick(EXIT_FALLBACK_MS - 1)
  assert.equal(staging.window.state.destroyed, false, 'détruite avant la fin du délai')
  t.mock.timers.tick(1)
  assert.equal(staging.window.state.destroyed, true, 'restée à l’écran sans réponse')
})

test('la durée annoncée par le rendu est celle qui est attendue, et elle est plafonnée', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  // `--motion`, as the renderer resolves it.
  const normal = staged([LAPTOP])
  normal.overlay.dismiss()
  assert.equal(normal.overlay.left(150), true)
  t.mock.timers.tick(149)
  assert.equal(normal.window.state.destroyed, false, 'détruite pendant son animation')
  t.mock.timers.tick(1)
  assert.equal(normal.window.state.destroyed, true, 'pas détruite après son animation')

  /*
   * And a number that arrived over IPC. `afterMs` is a renderer's claim, so it
   * may shorten the wait this class already promised and may never extend it:
   * nine seconds of a frameless always-on-top window over the rep's screen is
   * not a thing a reply gets to ask for.
   */
  const liar = staged([LAPTOP])
  liar.overlay.dismiss()
  liar.overlay.left(9_000)
  t.mock.timers.tick(EXIT_FALLBACK_MS)
  assert.equal(liar.window.state.destroyed, true, 'une réponse a prolongé la vie de la fenêtre')
})

test('sans mouvement réduit, il n’y a rien à attendre', (t) => {
  /*
   * `prefers-reduced-motion` collapses `--motion` to `0ms`, so the renderer
   * answers zero — and zero must mean « maintenant », not « le délai de secours ».
   * A constant in the main process would have held a static pill on screen for a
   * fifth of a second after the call ended, for precisely the rep who asked for
   * less motion.
   *
   * On the next tick and not synchronously: the reply is being sent from the
   * window that is about to go.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.overlay.dismiss()
  staging.overlay.left(0)
  assert.equal(staging.window.state.destroyed, false, 'détruite pendant sa propre réponse')
  t.mock.timers.tick(0)
  assert.equal(staging.window.state.destroyed, true)
})

test('une fermeture emporte la fenêtre qui s’en allait', (t) => {
  /*
   * **The one that matters most.** `hide()` has two callers and neither can wait
   * on a renderer: `before-quit` calls it one line before `store.close()`, and
   * `mainWindow.on('closed')` calls it because `window-all-closed` does not fire
   * while any window is open and this one has no taskbar entry to come back from.
   *
   * `dismiss()` deliberately leaves a live window behind for a fraction of a
   * second. A quit arriving inside that fraction would leave it: a pill whose
   * `moved` handler writes the saved origin through a database that has been
   * closed, and a process the rep believes they closed with a window still on
   * screen.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.overlay.dismiss()
  staging.overlay.hide()
  assert.equal(staging.window.state.destroyed, true, 'la fenêtre a survécu à la fermeture')

  // And nothing is left armed to fire into a closed store.
  t.mock.timers.tick(EXIT_FALLBACK_MS * 2)
  assert.equal(staging.built.length, 1)
})

test('renvoyer une durée quand rien ne s’en va n’est pas une erreur', () => {
  /*
   * The reply crosses a process boundary, so it can arrive after the fallback has
   * fired or after a quit has taken the window. `false` says « il n’y avait rien »
   * rather than throwing into an IPC handler, which is the DEC-26 shape: the
   * renderer is told a fact about its request, not handed an exception.
   */
  const staging = staged([LAPTOP])
  assert.equal(staging.overlay.left(150), false)

  // And dismissing twice is the same non-event.
  staging.overlay.dismiss()
  staging.overlay.dismiss()
  assert.equal(staging.overlay.window, null)
})
