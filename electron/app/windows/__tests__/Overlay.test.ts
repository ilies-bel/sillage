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
import {
  APPEARANCE_MS,
  EXIT_FALLBACK_MS,
  FIRST_FRAME_MS,
  FIRST_FRAME_SLACK_MS,
  INITIAL_SIZE,
  Overlay,
  type OverlayHost,
  type WidgetPlacement,
} from '../Overlay.ts'

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
    /**
     * Every call that changes what the rep can see, **in order**.
     *
     * The order is the assertion for the first frame: `showInactive` before any
     * `setBounds` is the clipped card sliding into place, which is what
     * `FIRST_FRAME_MS` exists to end. A counter could not tell those apart.
     */
    seen: [] as string[],
  }
  const window = {
    isDestroyed: () => state.destroyed,
    getPosition: () => [state.x, state.y],
    setBounds: (box: { x: number; y: number; width: number; height: number }) => {
      state.bounds += 1
      state.seen.push(`bounds ${box.width}×${box.height}@${box.x},${box.y}`)
      const moved = box.x !== state.x || box.y !== state.y
      Object.assign(state, box)
      if (moved) for (const fn of handlers.get('moved') ?? []) fn()
    },
    on: (event: string, fn: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return window
    },
    once: (event: string, fn: () => void) => window.on(event, fn),
    showInactive: () => void state.seen.push('show'),
    /*
     * Electron emits `closed` from here, and so does this — a fake that destroyed
     * silently could not reproduce a window the renderer or the OS took away, which is
     * the one path that left the *next* pill inheriting this one's timers.
     */
    destroy: () => {
      state.destroyed = true
      for (const fn of handlers.get('closed') ?? []) fn()
    },
    setIgnoreMouseEvents: (through: boolean, options?: { forward?: boolean }) =>
      void state.mouse.push({ through, forward: options?.forward }),
  }
  /** What Electron does when the renderer has painted for the first time. */
  const paint = () => {
    for (const fn of handlers.get('ready-to-show') ?? []) fn()
  }
  /** What the OS does when the rep drags a frameless window by its pill. */
  const drag = (to: { x: number; y: number }) => {
    Object.assign(state, to)
    for (const fn of handlers.get('moved') ?? []) fn()
  }
  /** Any other lifecycle event Electron would emit on this window. */
  const emit = (event: string) => {
    for (const fn of handlers.get(event) ?? []) fn()
  }
  return { window: window as unknown as BrowserWindow, state, drag, paint, emit }
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

// ── the first frame the rep sees ──────────────────────────────────────────────
//
// `INITIAL_SIZE` is documented as « a starting guess and never the truth », and the
// guess is 232×52 where the shipped renderer asks for **281×78** — measured. So
// `showInactive()` on `ready-to-show` put a card on screen **clipped by 49 px** and
// then slid it: `placeAroundPill` holds the pill's centre, so a 49 px width
// correction moves the window's x by 25, and the renderer asked three times
// (239 → 276 → 281) as Inter loaded and the clock rendered. A card appearing cut off
// and settling in three steps over the face of the person on the call, at the instant
// the rep presses *Enregistrer*, on the one surface drawn over another application.

test('the window is not shown until it knows how big it is', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  assert.deepEqual(staging.window.state.seen, [], 'shown before anything knew its size')

  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })

  /*
   * **The order is the property.** Bounds first, then shown: the first frame the rep
   * sees is already the right size in the right place. Reversed, this is the clipped
   * card sliding, and a counter of `showInactive` calls could not tell the difference.
   */
  assert.deepEqual(staging.window.state.seen, ['bounds 281×78@616,781', 'show'])
})

test('a renderer that never measures still gets a pill, late and wrong', (t) => {
  /*
   * DEC-26: everything fails open. A widget that does not appear is worse than one
   * that appears at the guess — the rep has no taskbar entry, nothing to alt-tab to,
   * and the pill's largest control is what ends the recording. So the wait has a
   * deadline and the deadline is not a requirement.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  t.mock.timers.tick(FIRST_FRAME_MS - 1)
  assert.deepEqual(staging.window.state.seen, [], 'gave up before the deadline')

  t.mock.timers.tick(1)
  assert.deepEqual(staging.window.state.seen, ['show'], 'no pill at all after the deadline')
  // At the guess, which is the honest degraded answer and the one it used to give
  // immediately.
  assert.equal(staging.window.state.width, INITIAL_SIZE.width)
})

test('and it is shown exactly once, whichever of the three gets there first', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })
  // The deadline still fires, and the renderer goes on resizing for the whole call —
  // every turn of the conversation changes the frame's height.
  t.mock.timers.tick(FIRST_FRAME_MS * 2)
  staging.overlay.resize({ width: 340, height: 402, pillTop: 20, pillHeight: 38 })

  assert.equal(
    staging.window.state.seen.filter((what) => what === 'show').length,
    1,
    `showInactive was called more than once: ${JSON.stringify(staging.window.state.seen)}`,
  )
})

test('a measurement before the first paint does not reveal an unpainted window', (t) => {
  /*
   * The renderer's layout effect runs *before* the browser paints, so the measurement
   * can genuinely arrive first — and `ready-to-show` is Electron's own answer to « is
   * there anything drawn in there ». Both, or neither.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })
  assert.ok(
    !staging.window.state.seen.includes('show'),
    'shown before the renderer had painted anything',
  )
  staging.window.paint()
  assert.ok(staging.window.state.seen.includes('show'))
})

test('a meeting that ends inside the wait leaves no timer behind', (t) => {
  /*
   * `hide()` is called one line before `store.close()`, and a deadline that fired
   * after it would be `showInactive` on a destroyed window. The same for `dismiss()`,
   * which is the ordinary path: a recording can stop while the pill is still waiting
   * to be shown — a call that lasted two seconds, or a capture that failed at t=0.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const teardown of ['hide', 'dismiss'] as const) {
    const staging = staged([LAPTOP])
    staging.window.paint()
    staging.overlay[teardown]()
    t.mock.timers.tick(FIRST_FRAME_MS * 4)
    assert.ok(
      !staging.window.state.seen.includes('show'),
      `${teardown}() left the reveal armed`,
    )
  }
})

// ── the deadline on appearing at all ─────────────────────────────────────────
//
// `FIRST_FRAME_MS` calls itself « a deadline and never a requirement » and was half
// of one: it is armed inside the `ready-to-show` handler, so a renderer that never
// painted had **no timer**. Measured on this class with no paint
// (`scratch/r26-overlay-edges.mjs`): « after 600 ms: ["create w1"] », « active
// timers: 0 ». Four tests below and the first two are the hole; the other two are
// the properties that must survive closing it.

test('un rendu qui ne peint jamais finit quand même par avoir sa pastille', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  // No `paint()`, no `resize()`: a crashed bundle, a `did-fail-load`, a broken
  // install. The old deadline was armed by the paint, so nothing was counting.
  t.mock.timers.tick(APPEARANCE_MS - 1)
  assert.deepEqual(staging.window.state.seen, [], 'montrée avant le plafond')

  t.mock.timers.tick(1)
  assert.deepEqual(
    staging.window.state.seen,
    ['show'],
    'aucune pastille, jamais, pour un rendu qui ne peint pas',
  )
  // At the guess, which is all anybody knows about a renderer that said nothing.
  assert.equal(staging.window.state.width, INITIAL_SIZE.width)
})

test('un rendu qui mesure sans que ready-to-show arrive est borné lui aussi', (t) => {
  /*
   * Electron does not promise `ready-to-show` for a transparent window, and this is
   * the case where that costs everything: the renderer is alive, it has measured
   * itself, the main process has placed the window — and `#show` refused on
   * `#painted`, for ever. The paint stays required *until* the ceiling, because a
   * measurement genuinely can arrive a frame before anything is drawn.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })
  assert.ok(!staging.window.state.seen.includes('show'), 'montrée sans rien de peint')

  t.mock.timers.tick(APPEARANCE_MS)
  assert.ok(
    staging.window.state.seen.includes('show'),
    'la fenêtre n’apparaît jamais alors que le rendu la mesure',
  )
  // And at the size it measured, not at the guess.
  assert.equal(staging.window.state.width, 281)
})

test('le plafond ne montre rien deux fois, et disparaît avec la fenêtre', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const teardown of ['hide', 'dismiss'] as const) {
    const staging = staged([LAPTOP])
    staging.window.paint()
    staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })
    staging.overlay[teardown]()
    t.mock.timers.tick(APPEARANCE_MS * 2)
    assert.equal(
      staging.window.state.seen.filter((what) => what === 'show').length,
      1,
      `${teardown}() a laissé le plafond armé`,
    )
  }
})

test('et une réunion qui s’arrête avant le plafond ne laisse rien derrière elle', (t) => {
  /*
   * `hide()` is called one line before `store.close()`. A ceiling that fired after it
   * would be `showInactive` on a destroyed window — the same property the reveal
   * timer already has, asserted of the second timer because there are now two.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const teardown of ['hide', 'dismiss'] as const) {
    const staging = staged([LAPTOP])
    staging.overlay[teardown]()
    t.mock.timers.tick(APPEARANCE_MS * 2)
    assert.ok(
      !staging.window.state.seen.includes('show'),
      `${teardown}() a laissé le plafond armé`,
    )
  }
})

// ── one pill at a time ───────────────────────────────────────────────────────

test('une nouvelle pastille emporte celle qui s’en allait, au lieu de s’y superposer', (t) => {
  /*
   * `dismiss()` leaves a live window on screen for up to `EXIT_FALLBACK_MS`, and a
   * rep taking the next call inside that window got **two** frameless always-on-top
   * cards at the same saved origin (`scratch/r26-overlay-edges.mjs` B). It got worse
   * the moment the renderer started freezing its content for the exit: the fading
   * card keeps « Enregistrement en cours » and the previous call's elapsed time, so
   * the two cards claim to be recording with two different clocks, one over the
   * other, on the surface drawn over the client's face.
   *
   * The fade exists so a card does not vanish between two frames while the rep is
   * looking at it. A new pill at the same coordinates is a bigger change than the
   * one the fade was smoothing, so it wins.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])
  staging.window.paint()
  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })

  staging.overlay.dismiss()
  assert.equal(staging.asked.length, 1, 'la sortie n’a pas été demandée')
  assert.equal(staging.window.state.destroyed, false, 'détruite sans animation')

  // The next call, inside the fade.
  staging.overlay.show()
  assert.equal(staging.window.state.destroyed, true, 'deux pastilles à la fois')
  const second = staging.built[1]
  assert.ok(second, 'la deuxième pastille n’a pas été créée')
  assert.notEqual(second.window, staging.window.window, 'la pastille sortante a été adoptée')

  // And the timer that was going to destroy the first one is gone with it: no
  // `destroy()` on a window that already has none.
  t.mock.timers.tick(EXIT_FALLBACK_MS * 2)
  assert.equal(staging.overlay.left(150), false, 'une fenêtre sortante est restée en attente')
})

test('the appearance ceiling is a ceiling, including over the measurement wait', (t) => {
  /*
   * `APPEARANCE_MS`'s docblock calls itself « the ceiling on the widget appearing at
   * all », and the measurement wait used to outlive it: `#reveal` is armed by
   * `ready-to-show`, so a paint landing just inside the ceiling pushed the reveal to
   * `ready + FIRST_FRAME_MS`. Measured on the shipped class — paint at +988 ms against a
   * 1 000 ms ceiling, shown at **+1 289 ms**.
   *
   * The worst case is a paint one tick before the ceiling and a renderer that never
   * measures, which is exactly what this drives.
   */
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const staging = staged([LAPTOP])

  t.mock.timers.tick(APPEARANCE_MS - 1)
  staging.window.paint()
  assert.ok(!staging.window.state.seen.includes('show'), 'shown before the ceiling')

  t.mock.timers.tick(1)
  assert.ok(
    staging.window.state.seen.includes('show'),
    'the ceiling passed and the window is still hidden — the measurement wait outlived it',
  )
})

// ── and the two deadlines were armed from two different clocks ────────────────
//
// `FIRST_FRAME_MS` is 300 and the renderer's `MEASURE_DEADLINE_MS` is 200, which reads
// like a hundred milliseconds of margin and is not: this side arms at `ready-to-show`
// and the renderer arms at its React mount, so the real figure is a hundred *minus the
// gap between those two events* — 81 ms and 47 ms, measured on two launches of the
// packaged app, leaving 19 and 53. And it is spent on the critical path of
// `startRecording`, with two audio devices opening and a transcriber booting, for a rep
// on a Windows laptop (HR-2). Lose the race and the side with the *worse* answer wins:
// what this deadline reveals is `INITIAL_SIZE`, forty-nine pixels narrower than the
// pill, carrying « Aucun enregistrement » over a live call.
//
// `harnessFixture.test.ts` holds those constants in order and cannot see any of this,
// because an order between constants is not an order between expiries once the origins
// differ. `widget:measuring` makes them share one.

test('the renderer’s own clock is what the first-frame deadline runs on', (t) => {
  // `Date` too: the origin this channel moves is an instant in wall time, so a test
  // that froze only the timers would be measuring nothing.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  // The gap this whole channel is about: the renderer mounts 100 ms after
  // `ready-to-show`, which is longer than the two constants' difference.
  t.mock.timers.tick(100)
  assert.equal(staging.overlay.measuring(200), true)

  // The old arming would have fired here — `ready-to-show + 300` — and revealed the
  // guess while the renderer still had 100 ms of its own deadline left to run.
  t.mock.timers.tick(FIRST_FRAME_MS - 100)
  assert.deepEqual(staging.window.state.seen, [], 'revealed the guess on the old clock')

  // The renderer speaks inside its own deadline and is what decides the first frame.
  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })
  assert.deepEqual(staging.window.state.seen, ['bounds 281×78@616,781', 'show'])
  assert.equal(staging.window.state.width, 281)
})

test('and a renderer that reports and then goes quiet still gets its pill', (t) => {
  /*
   * DEC-26 again, and the reason the new deadline is a deadline: moving the origin must
   * not turn a bounded wait into an unbounded one.
   */
  // `Date` too: the origin this channel moves is an instant in wall time, so a test
  // that froze only the timers would be measuring nothing.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  t.mock.timers.tick(100)
  staging.overlay.measuring(200)

  t.mock.timers.tick(100 + 200 + FIRST_FRAME_SLACK_MS - 1 - 100)
  assert.deepEqual(staging.window.state.seen, [], 'gave up before its own deadline')
  t.mock.timers.tick(1)
  assert.deepEqual(staging.window.state.seen, ['show'])
  assert.equal(staging.window.state.width, INITIAL_SIZE.width)
})

test('a report that would shorten the wait is refused, and says so', (t) => {
  /*
   * The dangerous direction, and the reason `measuring` is a `Math.max` and not an
   * assignment. A renderer that mounts almost immediately and asks for a *shorter*
   * deadline than the one already running would move the reveal **in** and put
   * `INITIAL_SIZE` on screen sooner than the `ready-to-show` arming would have — a fix
   * for a race that loses the race faster. It refuses, and answers `false` rather than
   * silently doing nothing, which is the DEC-26 shape: the renderer is told a fact
   * about its request.
   */
  // `Date` too: the origin this channel moves is an instant in wall time, so a test
  // that froze only the timers would be measuring nothing.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  t.mock.timers.tick(10)
  assert.equal(staging.overlay.measuring(100), false, 'accepted a shorter wait')

  t.mock.timers.tick(FIRST_FRAME_MS - 10 - 1)
  assert.deepEqual(staging.window.state.seen, [], 'revealed the guess early')
  t.mock.timers.tick(1)
  assert.deepEqual(staging.window.state.seen, ['show'], 'lost the deadline it already had')
})

test('a window already on screen is not re-armed by a late report', (t) => {
  // `Date` too: the origin this channel moves is an instant in wall time, so a test
  // that froze only the timers would be measuring nothing.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  staging.overlay.resize({ width: 281, height: 78, pillTop: 20, pillHeight: 38 })
  assert.ok(staging.window.state.seen.includes('show'))

  // Nothing left to promise: the question is settled and `#reveal` is disarmed.
  assert.equal(staging.overlay.measuring(200), false)
  t.mock.timers.tick(APPEARANCE_MS * 2)
  assert.equal(staging.window.state.seen.filter((what) => what === 'show').length, 1)
})

test('the appearance ceiling still outranks the renderer’s clock', (t) => {
  /*
   * `APPEARANCE_MS` is « the ceiling on the widget appearing at all » and a renderer
   * that reports an honest deadline must not be able to push past it. A report at
   * 900 ms asking for another 200 would land at 1 140; the ceiling fires at 1 000 and
   * `#forced` makes the paint and the measurement both optional.
   */
  // `Date` too: the origin this channel moves is an instant in wall time, so a test
  // that froze only the timers would be measuring nothing.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  t.mock.timers.tick(APPEARANCE_MS - 100)
  staging.overlay.measuring(200)

  t.mock.timers.tick(100)
  assert.deepEqual(staging.window.state.seen, ['show'], 'the ceiling did not fire')
})

test('a measurement deadline that has already elapsed is not started again by the paint', (t) => {
  /*
   * **A fired timer is `null`, and so is one that was never armed.**
   *
   * `ready-to-show` arms `#reveal` when it finds `null`, so a renderer that reported its
   * deadline *before* painting had that deadline fire against an unpainted window,
   * refuse, clear itself — and then get a **fresh** `FIRST_FRAME_MS` out of the paint.
   * Measured on the shipped class (`scratch/r28-overlay-measuring.mjs`): a mute renderer
   * shown at **+589 ms** instead of +300, still at `INITIAL_SIZE`. Electron does not
   * promise `ready-to-show` for a transparent window — which is the whole reason
   * `APPEARANCE_MS` exists — so a paint arriving after the renderer has spoken is
   * precisely the case this has to be right about. It fails open either way; what it
   * costs is twice the wait, on the surface drawn over a client's face.
   */
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  // The renderer's layout effect runs before the browser paints, so this order is real.
  assert.equal(staging.overlay.measuring(200), true)
  t.mock.timers.tick(200 + FIRST_FRAME_SLACK_MS)
  assert.deepEqual(staging.window.state.seen, [], 'shown before anything had painted')

  staging.window.paint()
  assert.deepEqual(
    staging.window.state.seen,
    ['show'],
    'the paint started the deadline over instead of satisfying the one that had passed',
  )
})

test('a second pill gets its own deadline, not the ceiling the first one left behind', (t) => {
  /*
   * **Every other field is reset when a window is created; the two timers were not.**
   *
   * A window replaced without `dismiss()` or `hide()` — the renderer crashed, or the OS
   * closed it, which `on('closed')` handles by setting `#window = null` and nothing else
   * — left `#reveal` running. The new window's `ready-to-show` then found it non-null and
   * armed nothing, the stale timer fired against a destroyed window and did nothing, and
   * the only thing left to reveal the live pill was `APPEARANCE_MS`. Measured
   * (`scratch/r28-overlay-second-window.mjs`): **+1 351 ms** against its own 300 ms
   * deadline, at `INITIAL_SIZE` — 232×52, forty-nine pixels narrower than the pill,
   * carrying « Aucun enregistrement » over a live call. Two calls back to back is the
   * ordinary shape of a sales rep's afternoon.
   */
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const staging = staged([LAPTOP])

  staging.window.paint()
  // The first pill is waiting on its measurement when its renderer dies.
  staging.window.window.destroy()
  assert.equal(staging.overlay.window, null, 'closed did not release the window')

  staging.overlay.show()
  const second = staging.built[1]
  assert.ok(second, 'a second window was not created')
  second.paint()
  assert.deepEqual(second.state.seen, [], 'shown before it knew its size')

  t.mock.timers.tick(FIRST_FRAME_MS)
  assert.deepEqual(
    second.state.seen,
    ['show'],
    'the second pill inherited the first one’s timer and waited for the appearance ceiling',
  )
})
