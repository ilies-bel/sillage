/**
 * **The in-meeting widget** — the only Sillage surface a rep can see during the
 * call it is recording.
 *
 * ## Why it exists
 *
 * DEC-38 settled that proof of life is the input meter and not a live
 * transcript, and then put the meter in the header of a 1280-pixel window. For
 * the fifty minutes that matter, that window is behind Teams. So the product's
 * answer to « est-ce qu'il m'entend ? » was on a screen nobody is looking at,
 * and the answer to « arrête ça » was three windows away: a rep who wanted to
 * stop a recording — a client asking for the last five minutes off the record
 * is an ordinary thing to ask — had to leave the call to do it.
 *
 * The widget is the meter and the stop control, on top of the call. Nothing on
 * it is new: the bars are the same `audio:level` broadcast the header draws,
 * the stop is the same `session:command`, and the objet is the same row. It is
 * a second *place*, not a second truth.
 *
 * ## What it may never be
 *
 * **Never the document, and never the model's output.** No signal rail, no
 * compte-rendu, no transcript. DEC-14 keeps the model out of the rep's
 * attention during a call, and a floating pane that changed on its own over a
 * client's face is the strongest possible version of the thing that decision
 * forbids. The rep marks; the model does not speak.
 *
 * **Never a gate** (DEC-4). There is one confirmation in this product and it is
 * a screen, reached deliberately, with the document on it. Nothing here
 * confirms anything, and nothing here can reach the CRM.
 *
 * **Never focus-stealing.** It is shown with `showInactive()` and it is never
 * focused by the app: taking focus from a call to raise a pill is taking a
 * rep's keyboard away mid-sentence, and on Windows it also pulls the call out
 * of full screen.
 *
 * **Never there when there is no call.** It is created when a meeting starts
 * recording and destroyed when it stops. An always-present pill is chrome the
 * rep has to close, and something floating over every other application all day
 * is how a notetaker becomes the app people uninstall.
 */
import type { BrowserWindow } from 'electron'
import type { KeyValueStore } from '../../core/contracts/kv.ts'
import {
  opensAbove,
  placeAroundPill,
  placeWindow,
  type Area,
  type Origin,
  type Pill,
  type Size,
} from './overlayPlacement.ts'

/** Where the origin the rep dragged it to is remembered, across restarts. */
export const OVERLAY_ORIGIN_KEY = 'overlay.origin'

/**
 * The size the window is created at.
 *
 * A starting guess and never the truth: the renderer measures its own content
 * and asks for the size it actually needs (`widget:resize`), because the pill's
 * width depends on the elapsed time and on French strings nothing here can
 * measure. It matters only for the first frame — a window created far too large
 * would flash a transparent rectangle over the call.
 */
export const INITIAL_SIZE: Size = { width: 232, height: 52 }

export interface OverlayHost {
  /** `new BrowserWindow(...)`, injected so this file is reachable in a test. */
  create(options: OverlayWindowOptions): BrowserWindow
  /** `screen.getAllDisplays().map((d) => d.workArea)`, primary first. */
  areas(): Area[]
  /** Where the renderer lives, already carrying `?window=widget`. */
  load(window: BrowserWindow): void
  /** Restore, show and focus the main window, and send it to a meeting. */
  focusMain(meetingId: string | null): boolean
  /**
   * `broadcast('widget:placed', …)` — the stacking direction, when the renderer
   * did not ask for it.
   *
   * Injected rather than called directly for the reason every other seam in this
   * file is: `Overlay` is reachable in a test with no Electron binary, and « the
   * renderer was told » is exactly the half of the display-change rescue that a
   * test has to be able to assert.
   */
  placed(placement: WidgetPlacement): void
}

export interface OverlayWindowOptions {
  width: number
  height: number
  x: number
  y: number
}

/** What the renderer measured, and what the main process answers it with. */
export interface WidgetBox {
  width: number
  height: number
  /** The pill's offset inside the frame — the shadow margin is above it. */
  pillTop: number
  pillHeight: number
}

export interface WidgetPlacement {
  ok: boolean
  /** True when the panel must stack above the pill rather than below it. */
  above: boolean
}

export class Overlay {
  #host: OverlayHost
  #kv: KeyValueStore
  #window: BrowserWindow | null = null
  #size: Size = INITIAL_SIZE
  /**
   * How far down the frame the pill sits, and how tall it is.
   *
   * The window's own origin is not the interesting number: the pill is what the
   * rep is looking at and pressing, and it is drawn inside a frame whose height
   * changes by three hundred pixels when the panel opens. Its *screen* position
   * is never stored — it is read off the window at the moment it is needed, so a
   * drag the app did not hear about cannot make it stale.
   */
  #pillTop = 0
  #pillHeight = INITIAL_SIZE.height
  /**
   * The stacking direction the renderer was last told, so a change can be
   * recognised as one.
   *
   * Held here and nowhere else: `opensAbove` is cheap and could be asked on
   * every `moved`, but *announcing* it on every `moved` would send a message per
   * pixel of a drag, and the renderer re-arms its own measurement when the
   * answer changes. What is wanted is the edge, and an edge needs the previous
   * value.
   */
  #above = false
  /** True while `resize()` is moving the window itself — see the `moved` handler. */
  #moving = false

  constructor(host: OverlayHost, kv: KeyValueStore) {
    this.#host = host
    this.#kv = kv
  }

  /** The live window, or null. Exposed for the broadcast fan-out and tests. */
  get window(): BrowserWindow | null {
    return this.#window
  }

  /**
   * Idempotent, and deliberately: `session:changed` fires for transitions that
   * are not `recording`→anything, and the caller is a fan-out over every
   * meeting. Showing an already-shown widget must not recreate it, or the rep's
   * expanded card would collapse every time a transcript segment moved the
   * state machine.
   */
  show(): void {
    if (this.#window && !this.#window.isDestroyed()) return

    this.#size = INITIAL_SIZE
    this.#pillTop = 0
    this.#pillHeight = INITIAL_SIZE.height
    this.#above = false
    const origin = placeWindow(this.#saved(), this.#size, this.#host.areas())
    const window = this.#host.create({ ...this.#size, ...origin })
    this.#window = window

    /*
     * **What is remembered is where the *pill* was, not where the window was.**
     *
     * The window's origin is the top-left of the *frame*, and with the panel
     * open that is the top of the panel — three hundred and seventy pixels above
     * the pill. A rep who dragged the widget with the panel open found the
     * collapsed pill, on the next call, where the panel's corner had been:
     * measured, dropped at pill y=964 and restored at 592.
     *
     * The origin is still what is stored, because that is what `placeWindow`
     * takes — but the one stored is the origin the *collapsed* window would have
     * had, which is the pill's own position. One addition, at the moment the
     * fact is known.
     *
     * And **only for a move the rep made**: `setBounds` in `resize()` emits
     * `moved` too, so re-saving from inside our own repositioning walked the
     * saved origin twenty pixels up the display on every panel open — a widget
     * that creeps off the top of the screen over a working day.
     *
     * Remembered on every move rather than on close, because the ordinary way
     * this window ends is the process exiting with a call still on screen, and
     * `moved` is the only event certain to have fired by then.
     */
    window.on('moved', () => {
      if (window.isDestroyed() || this.#moving) return
      const [x = 0, y = 0] = window.getPosition()
      /*
       * **The pill's centre, not the frame's left edge** — the other half of
       * the same fix as `y + pillTop`.
       *
       * The frame's x is a function of the card's *width*, and the card is 232
       * collapsed and 340 open. So a rep who dragged the widget with the panel
       * open had the collapsed pill come back 54 pixels to the right of where
       * they left it, every launch, for the same reason the y was wrong: the
       * stored number described the window rather than the thing the rep was
       * looking at. Storing the centre makes it size-independent, which is what
       * it has to be — the two states are different widths by design.
       */
      this.#kv.set(
        OVERLAY_ORIGIN_KEY,
        JSON.stringify({ cx: Math.round(x + this.#size.width / 2), y: y + this.#pillTop }),
      )
      /*
       * **And the drag can change which way the panel opens, with nothing to
       * reply to.**
       *
       * `opensAbove` had exactly one caller — the `return` of `resize()` — so the
       * answer was only ever recomputed when `${w}×${h}×${pillTop}` changed in
       * the renderer. `pillTop` is a *consequence* of `above`, so it cannot
       * change until `above` already has: dragging the pill from the bottom half
       * of the display to the top left the renderer stacking the panel upward,
       * off the top of the screen, for the rest of the call. Measured on the
       * shipped `Overlay`: pill dragged from y=801 to y=60 and `above` stayed
       * `true`, with nothing sent.
       *
       * Announced on the edge, never on every `moved` — macOS emits one per
       * pixel of the drag.
       */
      this.#settle({ x, y })
    })
    window.on('closed', () => {
      if (this.#window === window) this.#window = null
    })

    this.#host.load(window)
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return
      // `showInactive`, never `show`. See the note above: this window must not
      // take the keyboard away from the call it is floating over.
      window.showInactive()
    })
  }

  hide(): void {
    const window = this.#window
    this.#window = null
    if (window && !window.isDestroyed()) window.destroy()
  }

  /**
   * The renderer telling us how big it has become, and where its pill is.
   *
   * Answers `above`, which is the direction the panel must stack — decided here
   * because only the main process knows which display the pill is on and where
   * in it. The renderer needs it *before* it lays the panel out, so it is a
   * reply and not a broadcast.
   *
   * `ok: false` when there is no window, which is not an error: the meeting can
   * end between the renderer measuring itself and the message arriving, and the
   * widget is the only thing that can tell whether its request landed.
   */
  resize(box: WidgetBox): WidgetPlacement {
    const window = this.#window
    if (!window || window.isDestroyed()) return { ok: false, above: false }

    const to: Size = { width: Math.round(box.width), height: Math.round(box.height) }
    const areas = this.#host.areas()
    const [x = 0, y = 0] = window.getPosition()
    const pill: Pill = {
      /*
       * **Read from the window now, never remembered.**
       *
       * This was cached and refreshed on `moved`, which is a promise about an
       * event: the pill is dragged by an `-webkit-app-region` region, so the
       * window is moved by the OS, and a cache that misses one of those events
       * teleports the widget back to where the pill *used* to be the next time a
       * turn of the call changes its height. The window's own position is the
       * fact, it costs one call, and it cannot be stale.
       */
      screenTop: y + this.#pillTop,
      screenCentreX: x + this.#size.width / 2,
      offsetTop: Math.round(box.pillTop),
      // The renderer's number when it sent one, else the last one it sent — a
      // measurement of zero comes back from a frame laid out before fonts have
      // settled, and a pill of no height is in no half of any display.
      height: Math.round(box.pillHeight) || this.#pillHeight,
    }

    const origin = placeAroundPill(pill, to, areas, this.#size)
    this.#size = to
    this.#pillTop = pill.offsetTop
    this.#pillHeight = pill.height

    // One call, so the move and the resize cannot be observed apart — two calls
    // draw a frame of the new size at the old origin, which over a video call
    // reads as a flinch.
    this.#moving = true
    try {
      window.setBounds({ ...origin, ...to })
    } finally {
      this.#moving = false
    }
    /*
     * **The pass-through survives a resize, and that took a bug to learn.**
     *
     * This used to reset it — `setIgnoreMouseEvents(false)` on every resize, on
     * the reasoning that the pointer is not where the renderer last saw it once
     * the window has moved under it. The renderer caches what it last asked for,
     * so it would not ask again until the pointer crossed the card's edge — and
     * the widget resizes *every time a turn of the call arrives*. A rep with the
     * pointer resting over the halo had it silently reclaimed a few seconds
     * later, and every click in that band stopped reaching Teams.
     *
     * The state belongs to where the pointer is, which only the renderer knows,
     * and it re-asserts on the next `pointermove` either way. Leaving it alone is
     * both simpler and correct.
     */

    // Recorded, not only returned: `#settle` reports an *edge*, and a reply the
    // renderer has already acted on is the previous value that edge is measured
    // against. Returned as well, because the renderer needs it before it lays
    // the panel out and a broadcast is one tick too late for that.
    this.#above = opensAbove({ ...pill, screenTop: origin.y + pill.offsetTop }, areas)
    return { ok: true, above: this.#above }
  }

  /**
   * **The displays changed, and nothing in the renderer knows or should have to.**
   *
   * `placeWindow`'s quarter-overlap rule is the defence its own docblock calls
   * « the whole reason the placement is a module »: a frameless, always-on-top,
   * taskbar-less window at coordinates no display covers is *unrecoverable*,
   * because there is nothing to alt-tab to, no title bar to drag and no
   * preference the rep can see to clear. And for as long as the widget existed
   * that rule ran in exactly two places — the creation path, and the reply to a
   * `widget:resize`.
   *
   * So the rescue depended on the *renderer re-rendering*, which is to say on a
   * turn of the call arriving — and it therefore failed precisely when
   * transcription is the thing that has died, which is one of the two readings
   * the pill exists for. It survived review because a missing dependency array
   * in `Frame`'s layout effect re-armed the duplicate-suppressing key on every
   * render and sent a byte-identical `widget:resize` (two measured in Chromium on
   * first paint alone); the comment beside it argued that the duplicate was free
   * and could not matter. It was the only thing keeping the pill on the screen.
   *
   * Measured on the shipped `Overlay` with the external display removed and no
   * renderer involvement at all: pill at y=1920, work area ending at 877, and
   * `displaysChanged()` moving it back to y=801.
   *
   * The current *window* position is what is re-placed, never the saved origin:
   * the saved origin is the pill's, it may name the display that just went away,
   * and the rep's own drag on the remaining display is a placement to keep. It
   * is idempotent — a window already fully on a display is left exactly where it
   * is — which is what makes it safe to call on every `display-metrics-changed`,
   * including the one a resolution change fires for the display the pill is not
   * on.
   *
   * The `moved` this emits is our own, so `#moving` suppresses the re-save: a
   * rescue is not a placement the rep made, and the saved origin stays the one
   * they chose. `placeWindow` runs again on the next launch either way.
   */
  displaysChanged(): void {
    const window = this.#window
    if (!window || window.isDestroyed()) return

    const areas = this.#host.areas()
    const [x = 0, y = 0] = window.getPosition()
    const origin = placeWindow({ x, y }, this.#size, areas)
    if (origin.x !== x || origin.y !== y) {
      this.#moving = true
      try {
        window.setBounds({ ...origin, ...this.#size })
      } finally {
        this.#moving = false
      }
    }
    this.#settle(origin)
  }

  /**
   * Which way the panel stacks from an origin, told to the renderer only when it
   * is not what the renderer already believes.
   *
   * The pill's *offset* inside the frame is the renderer's measurement and is
   * unchanged by any of this — a window that moved did not relayout — so the
   * pill's screen position is the origin plus that offset, which is the same
   * arithmetic `resize()` does.
   */
  #settle(origin: Origin): void {
    const above = opensAbove(
      {
        screenTop: origin.y + this.#pillTop,
        screenCentreX: origin.x + this.#size.width / 2,
        offsetTop: this.#pillTop,
        height: this.#pillHeight,
      },
      this.#host.areas(),
    )
    if (above === this.#above) return
    this.#above = above
    this.#host.placed({ ok: true, above })
  }

  /**
   * **The halo is not the widget.**
   *
   * The card draws a shadow, and a shadow needs pixels outside the card to land
   * on — but this window is transparent and always on top, so those pixels are
   * pixels of the call underneath that the rep cannot click. Electron's own
   * answer is `setIgnoreMouseEvents(true, { forward: true })`: the window stops
   * taking clicks and still receives mouse *moves*, which is what lets the
   * renderer notice the pointer coming back over the card and switch it off
   * again. Windows and macOS both support the forwarding, which is both of this
   * product's platforms.
   */
  passThrough(through: boolean): boolean {
    const window = this.#window
    if (!window || window.isDestroyed()) return false
    window.setIgnoreMouseEvents(through, { forward: true })
    return true
  }

  focusMain(meetingId: string | null): boolean {
    return this.#host.focusMain(meetingId)
  }

  /**
   * The origin a window of `INITIAL_SIZE` would have had with its pill where the
   * rep left it.
   *
   * `{ cx, y }` is what is written — the pill's centre and its top — and `{ x, y }`
   * is what every install written before that change holds. Both are read: a
   * preference the rep cannot see and cannot clear must not become a widget
   * that opens in the wrong place for ever, and the old shape is still a
   * perfectly good answer for a widget that was dragged while collapsed.
   */
  #saved(): Origin | null {
    const raw = this.#kv.get(OVERLAY_ORIGIN_KEY)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as { x?: unknown; cx?: unknown; y?: unknown }
      if (typeof parsed !== 'object' || parsed === null || !Number.isFinite(parsed.y)) return null
      const y = parsed.y as number
      if (Number.isFinite(parsed.cx)) {
        return { x: Math.round((parsed.cx as number) - INITIAL_SIZE.width / 2), y }
      }
      if (Number.isFinite(parsed.x)) return { x: parsed.x as number, y }
    } catch {
      // A corrupt preference is one the rep cannot see and cannot clear, and
      // the widget is the one window with no way back if it opens nowhere. The
      // default placement is always a correct answer, so take it and say
      // nothing.
    }
    return null
  }
}
