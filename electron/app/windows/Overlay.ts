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
    const origin = placeWindow(this.#saved(), this.#size, this.#host.areas())
    const window = this.#host.create({ ...this.#size, ...origin })
    this.#window = window

    /*
     * The position is remembered on every move rather than on close, because
     * the ordinary way this window ends is the process exiting with a call
     * still on screen, and `moved` is the only event that is certain to have
     * fired by then.
     */
    window.on('moved', () => {
      if (window.isDestroyed()) return
      const [x = 0, y = 0] = window.getPosition()
      this.#kv.set(OVERLAY_ORIGIN_KEY, JSON.stringify({ x, y }))
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

    const origin = placeAroundPill(pill, to, areas)
    this.#size = to
    this.#pillTop = pill.offsetTop
    this.#pillHeight = pill.height

    // One call, so the move and the resize cannot be observed apart — two calls
    // draw a frame of the new size at the old origin, which over a video call
    // reads as a flinch.
    window.setBounds({ ...origin, ...to })
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

    return {
      ok: true,
      above: opensAbove({ ...pill, screenTop: origin.y + pill.offsetTop }, areas),
    }
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

  #saved(): Origin | null {
    const raw = this.#kv.get(OVERLAY_ORIGIN_KEY)
    if (raw === null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Number.isFinite((parsed as Origin).x) &&
        Number.isFinite((parsed as Origin).y)
      ) {
        return { x: (parsed as Origin).x, y: (parsed as Origin).y }
      }
    } catch {
      // A corrupt preference is one the rep cannot see and cannot clear, and
      // the widget is the one window with no way back if it opens nowhere. The
      // default placement is always a correct answer, so take it and say
      // nothing.
    }
    return null
  }
}
