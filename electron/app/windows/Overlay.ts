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
  placeWindow,
  resizePlacement,
  type Area,
  type Origin,
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

export class Overlay {
  #host: OverlayHost
  #kv: KeyValueStore
  #window: BrowserWindow | null = null
  #size: Size = INITIAL_SIZE

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
   * The renderer telling us how big it has become.
   *
   * Returns false when there is no window, which is not an error: the meeting
   * can end between the renderer measuring itself and the message arriving, and
   * the widget is the only thing that can tell whether its request landed.
   */
  resize(width: number, height: number): boolean {
    const window = this.#window
    if (!window || window.isDestroyed()) return false
    const to: Size = { width: Math.round(width), height: Math.round(height) }
    if (to.width === this.#size.width && to.height === this.#size.height) return true

    const [x = 0, y = 0] = window.getPosition()
    const origin = resizePlacement({ x, y }, this.#size, to, this.#host.areas())
    this.#size = to
    // One call, so the move and the resize cannot be observed apart — two
    // calls draw a frame of the new size at the old origin, which over a video
    // call reads as a flinch.
    window.setBounds({ ...origin, ...to })
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
