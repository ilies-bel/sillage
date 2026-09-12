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

/**
 * How long a leaving window is given to answer `widget:left` before it is
 * destroyed anyway.
 *
 * A ceiling on a renderer that cannot reply — a crashed one, a wedged one, one
 * whose `webContents` was gone before the message was queued — and *not* the
 * duration of the animation, which only the renderer knows and which it sends
 * back. Half a second is a long time for a fade of `--motion` (150ms) and a
 * short time to have a pill on screen over a call that has ended.
 *
 * It is the cap on the renderer's own number as well: `afterMs` arrives over
 * IPC, so a renderer reporting nine seconds must not be able to leave a
 * frameless always-on-top window over the rep's screen for nine seconds.
 */
export const EXIT_FALLBACK_MS = 500

/**
 * How long the window waits to be told its real size before showing itself anyway.
 *
 * `INITIAL_SIZE` is a guess and the guess is **49 px narrow and 26 px short** —
 * measured on the shipped renderer, which asks for 281×78 where this file guesses
 * 232×52. So `showInactive()` on `ready-to-show` put a *clipped* card on screen and
 * then slid it: `placeAroundPill` holds the pill's centre, so a 49 px width
 * correction moves the window's x by 25 px, and the renderer asks three times
 * (239 → 276 → 281) as Inter loads and the elapsed time renders. That is a card
 * appearing cut off and settling in three steps over the face of the person on the
 * call, at the instant the rep presses *Enregistrer*.
 *
 * So the first show waits for the renderer's own measurement, and this is the
 * deadline on that wait — never a requirement, because DEC-26 says everything fails
 * open and a widget that does not appear is worse than one that appears wrong. A
 * font that never loads costs the rep this long and then the guess, which is exactly
 * what they used to get immediately.
 *
 * It is armed by the **first paint**, deliberately: before that there is nothing
 * worth showing, and counting from `load()` would spend the budget on the renderer
 * booting and reveal the guess on a slow machine, which is the machine this matters
 * on. Which leaves a renderer that never paints with no deadline at all — that one
 * is `APPEARANCE_MS` below, and it is a different promise.
 *
 * **300 and not 200, because the renderer has two waits of its own and this one has
 * to outlast both.** `MEASURE_DEADLINE_MS` in `src/widget/Widget.tsx` is the pill
 * refusing to report a size measured in the fallback face or drawn before
 * `widget:state` answered; that answer is two SQLite reads over a preload hop, and
 * the harness fixture gives the channel 150 ms so a stage can catch the placeholder
 * mid-flight. At 200 here and 120 there, *this* deadline won — and what it reveals
 * when it wins is `INITIAL_SIZE`, which is 49 px narrower than the pill, so the side
 * with the worse answer was deciding. The renderer answers by ~216 ms; this leaves
 * it 84 ms of margin and costs a mute renderer 100 ms more before it gets the guess.
 */
export const FIRST_FRAME_MS = 300

/**
 * What the hop costs, once the two waits share an origin — see `Overlay.measuring`.
 *
 * `FIRST_FRAME_MS` is 300 against the renderer's 200 and the hundred between them was
 * doing two jobs: covering one IPC round trip, and covering the unmeasured gap between
 * `ready-to-show` in this process and the React mount in the other (81 ms and 47 ms,
 * measured). Once the renderer states its deadline from its own mount only the first
 * job is left, and forty milliseconds is an order of magnitude more than a preload hop
 * on the machine this was measured on. It stays a number here rather than becoming
 * zero because it is a real cost and pretending otherwise is how a margin becomes a
 * race.
 */
export const FIRST_FRAME_SLACK_MS = 40

/**
 * The ceiling on the widget appearing **at all**, armed at creation.
 *
 * `FIRST_FRAME_MS` above calls itself « a deadline and never a requirement »,
 * and for as long as it existed it was half of one: it was armed *inside* the
 * `ready-to-show` handler, so a renderer that never painted had no timer at all.
 * Measured on the shipped class with no paint (`scratch/r26-overlay-edges.mjs`):
 * « after 600 ms: ["create w1"] », « active timers: 0 ». There was no path to a
 * visible pill, ever, and `#show` refuses on `#painted` — so a renderer that is
 * alive and *measuring* while `ready-to-show` never fires (which Electron does
 * not promise for a transparent window) was in the same hole: the main process
 * had its size, had placed it, and would not show it.
 *
 * So `#painted` stops being a requirement once this has passed. It is not a
 * measurement wait and must not be confused with one — it is « the rep asked for
 * a recording and something has to be on screen », which is DEC-26's reading of
 * the same trade `FIRST_FRAME_MS` states. A second, because the packaged app
 * creates the window and reveals it **146 ms** later on this machine
 * (`scratch/r26-e2e-widget-visible.cjs`: created at +335 ms invisible, shown at
 * +481 ms at 276×78), so an ordinary launch is nowhere near it and only a broken
 * one gets here. What it then shows may be an empty transparent window — which is
 * the honest state of a renderer that has drawn nothing, and is strictly better
 * than a window that can never be shown again: `#shown` is what a later paint
 * arrives into.
 */
export const APPEARANCE_MS = 1_000

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
  /**
   * `window.webContents.send('widget:leave', {})` — tell *this* window to play
   * its exit.
   *
   * Takes the window rather than reading `#window`, because by the time it is
   * called the window is no longer the current one: `dismiss()` releases it
   * first, so a recording starting in the same second gets a fresh pill instead
   * of adopting the one that is fading out. And it is addressed rather than
   * broadcast for the same reason — see `widget:leave` in `contracts/ipc.ts`.
   */
  leave(window: BrowserWindow): void
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
  /**
   * The three facts the first `showInactive()` waits on — see `FIRST_FRAME_MS`.
   *
   * `#painted` is `ready-to-show`, which is the renderer having drawn once and is
   * the condition Electron itself documents. `#measured` is the renderer having told
   * us how big it really is. Both, because showing on the measurement alone can
   * reveal a window that has not painted, and showing on the paint alone is the
   * clipped card this exists to end.
   *
   * And **the measurement is worth waiting for on the renderer's side too**: it
   * reports nothing until the type has settled *and* the read it draws has landed,
   * so a measurement arriving here is a measurement of the real pill rather than of
   * « Aucun enregistrement » — see `MEASURE_DEADLINE_MS` in `src/widget/Widget.tsx`.
   * Neither wait is unbounded in either process: `#forced` is this side's ceiling.
   */
  #painted = false
  #measured = false
  #shown = false
  #reveal: ReturnType<typeof setTimeout> | null = null
  /**
   * When `#reveal` is due, so `measuring()` can refuse to bring it forward — a
   * `setTimeout` handle does not answer that and a deadline that can move *in* is a
   * deadline that reveals `INITIAL_SIZE` sooner than the one it replaced.
   */
  #revealAt: number | null = null
  /**
   * True once the first-frame deadline has actually elapsed.
   *
   * A fired timer is `null`, which is indistinguishable from one that was never armed —
   * and `ready-to-show` arms on `null`. So a renderer that reported its measurement
   * deadline *before* painting had the deadline fire against an unpainted window, refuse,
   * clear itself, and then get a **fresh** `FIRST_FRAME_MS` from the paint: measured
   * (`scratch/r28-overlay-measuring.mjs`), a mute renderer shown at **+589 ms** instead
   * of +300, still at `INITIAL_SIZE`. Electron does not promise `ready-to-show` for a
   * transparent window — which is what `APPEARANCE_MS` is for — so a paint arriving after
   * the renderer has spoken is the case this has to be right about. An elapsed deadline
   * is elapsed: the paint is the only thing still waited on, and it shows at once.
   */
  #revealDue = false
  /**
   * The ceiling on appearing at all — see `APPEARANCE_MS`. Armed at creation,
   * which is the half `#reveal` cannot be: it is armed by the first paint, so it
   * has nothing to say about a renderer that never paints.
   */
  #ceiling: ReturnType<typeof setTimeout> | null = null
  /** True once `APPEARANCE_MS` has passed: the paint stops being required. */
  #forced = false
  /**
   * Windows playing their exit, with the timer that will destroy each one.
   *
   * A set rather than one, and adopted by `hide()`, because the two are
   * different promises and the dangerous one must still be able to keep its own.
   * `dismiss()` leaves a live window on screen for a moment after it has stopped
   * being `#window`; `hide()` is called from `before-quit` **immediately before
   * `store.close()`**, and from `mainWindow.on('closed')`, where an open window
   * is the difference between `window-all-closed` firing and a process the rep
   * cannot get back into. A dying widget that outlived either would be a `moved`
   * handler writing the saved origin through a closed database, and a quit that
   * silently did not happen.
   */
  #leaving = new Map<BrowserWindow, ReturnType<typeof setTimeout>>()

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

    /*
     * **A new pill reaps the old one rather than joining it.**
     *
     * `dismiss()` deliberately leaves a live window on screen for up to
     * `EXIT_FALLBACK_MS`, and a rep taking the next call inside that window got
     * *two* frameless always-on-top cards at the same saved origin — measured on
     * this class (`scratch/r26-overlay-edges.mjs` B: create w1, show, leave→w1,
     * create w2, show). The comment on `left()` argues that settling a leaving
     * window early is harmless, and it is; what is not harmless is the overlap,
     * and it got worse the moment the renderer started **freezing its content**
     * for the exit (see `leaving` in `src/widget/Widget.tsx`): the fading card
     * keeps « Enregistrement en cours » and call A's elapsed time, so the rep
     * would see two cards claiming to be recording, with two different clocks,
     * one on top of the other. That is the « three statements about one meeting,
     * two of them false » shape, over a client's face.
     *
     * The fade exists so a card does not vanish between two frames while the rep
     * is looking at it. A new pill arriving at the same coordinates is a larger
     * change than the one the fade was smoothing, so it wins — and the previous
     * card's renderer has already sent its `widget:left`, which nothing was
     * waiting on.
     */
    this.#settleLeaving()

    this.#size = INITIAL_SIZE
    this.#pillTop = 0
    this.#pillHeight = INITIAL_SIZE.height
    this.#above = false
    this.#painted = false
    this.#measured = false
    this.#shown = false
    this.#forced = false
    this.#revealAt = null
    this.#revealDue = false
    /*
     * **And the previous window's timers go with it.**
     *
     * Every other field is reset here and the two timers were not, so a window replaced
     * without `dismiss()` or `hide()` — a renderer that crashed, a window the OS closed,
     * which `on('closed')` handles by setting `#window = null` and nothing else — left
     * its `#reveal` and `#ceiling` running. The new window's `ready-to-show` then found
     * `#reveal` non-null and armed nothing, the stale timer fired against a destroyed
     * window and did nothing, and the *only* thing left to reveal the live pill was the
     * appearance ceiling: measured (`scratch/r28-overlay-measuring.mjs`), the second
     * window shown at **+1 063 ms** at `INITIAL_SIZE` — 232×52, forty-nine pixels
     * narrower than the pill, carrying « Aucun enregistrement » over a live call. Two
     * calls back to back is the ordinary shape of a sales rep's afternoon.
     */
    this.#disarm()
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

    /*
     * Armed here and not in `ready-to-show`: this is the deadline on the widget
     * *appearing*, and the thing it has to survive is a renderer that never
     * paints — see `APPEARANCE_MS`.
     */
    this.#ceiling = setTimeout(() => {
      this.#ceiling = null
      this.#forced = true
      this.#show(window)
    }, APPEARANCE_MS)

    this.#host.load(window)
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return
      this.#painted = true
      /*
       * The deadline is armed here rather than at creation: before the first paint
       * there is nothing worth showing, so counting from `load()` would spend the
       * budget on the renderer booting and reveal the guess on a slow machine —
       * which is the machine this matters on. See `FIRST_FRAME_MS`.
       */
      if (this.#reveal === null && !this.#revealDue) {
        this.#revealAt = Date.now() + FIRST_FRAME_MS
        this.#reveal = setTimeout(() => {
          /*
           * Cleared **before** the call, not by it: `#show` treats a live timer as « the
           * wait is still running » and would refuse the very deadline that fired it. An
           * expired timer holds a reference that is no longer a promise about anything.
           */
          this.#reveal = null
          this.#revealDue = true
          this.#show(window)
        }, FIRST_FRAME_MS)
      }
      this.#show(window)
    })
  }

  /**
   * **The renderer says when its own clock started, and this deadline moves onto it.**
   *
   * `#reveal` is armed by `ready-to-show` and the renderer's `MEASURE_DEADLINE_MS` by
   * its React mount, so the hundred milliseconds between the two constants was a
   * hundred *minus the gap between those two events* — measured on this Mac at 81 ms
   * and 47 ms across two launches, so 19 and 53 of real margin, on the critical path
   * of `startRecording` where two audio devices are opening and a transcriber is
   * booting. Lose it and the side with the worse answer decides: what this timer
   * reveals is `INITIAL_SIZE`, 232×52, forty-nine pixels narrower than the pill and
   * carrying « Aucun enregistrement » over a live call. `harnessFixture.test.ts` holds
   * the four constants in order and cannot see it, because an order between constants
   * is not an order between expiries when the origins differ.
   *
   * `withinMs` is the renderer's own number, sent one IPC hop ago, so re-arming from
   * *now* makes the two waits share an origin — the renderer's mount — and the
   * ordering true by construction. `FIRST_FRAME_SLACK_MS` is what the hop and the
   * reply cost, and it is deliberately smaller than the 100 ms it replaces: that
   * figure was carrying an unmeasured gap as well as the hop.
   *
   * Three things it must not become. It never *shortens* the wait — `Math.max` against
   * what is already pending — because a renderer reporting a deadline it has nearly
   * spent must not bring the reveal forward onto the guess. It is ignored once the
   * window has been shown or the ceiling has fired, because at that point the question
   * is settled and re-arming would be a promise about a window already on screen. And
   * it is **not** load-bearing: a renderer that never sends it keeps the
   * `ready-to-show` deadline, and `APPEARANCE_MS` is above both (DEC-26).
   */
  measuring(withinMs: number): boolean {
    const window = this.#window
    if (!window || window.isDestroyed()) return false
    if (this.#shown || this.#forced) return false
    const at = Date.now() + withinMs + FIRST_FRAME_SLACK_MS
    // Never earlier than what is already pending: an origin that moved the deadline
    // *in* would reveal the guess sooner than the current one would have.
    if (this.#revealAt !== null && at <= this.#revealAt) return false
    if (this.#reveal !== null) clearTimeout(this.#reveal)
    this.#revealAt = at
    this.#reveal = setTimeout(() => {
      // Cleared before the call, for the reason the `ready-to-show` arming states.
      this.#reveal = null
      this.#revealDue = true
      this.#show(window)
    }, at - Date.now())
    return true
  }

  /**
   * Gone now, and gone for the two reasons a widget must be able to vanish
   * without asking anybody.
   *
   * `before-quit` calls this one line before `store.close()`, and
   * `mainWindow.on('closed')` calls it because `window-all-closed` does not fire
   * while any window is open and this one has no taskbar entry to come back
   * from. Neither can afford to wait on a renderer, so neither does — and both
   * take the leaving windows with them, which is the half that is easy to
   * forget: `dismiss()` deliberately leaves a live window behind for a fraction
   * of a second, and a quit arriving inside that fraction would leave it.
   */
  hide(): void {
    const window = this.#window
    this.#window = null
    this.#disarm()
    this.#settleLeaving()
    if (window && !window.isDestroyed()) window.destroy()
  }

  /**
   * **The call ended: fade, then go.**
   *
   * The ordinary way this window closes, and the only one that can afford a
   * frame of animation — see `hide()` for the two that cannot. What it buys is
   * stated in `widget:leave`'s contract: this is the single surface in the
   * product drawn over another application, and `destroy()` took it off a video
   * call between two frames at the one moment the rep was certainly looking at
   * it.
   *
   * Three things happen in this order and the order is the whole of it.
   *
   * **The window stops being ours first.** `show()` is idempotent on `#window`,
   * so a window still held here would be *adopted* by the next recording — and
   * the next recording can begin in the same second, because a rep taking two
   * calls back to back is ordinary. The rep would get a pill already fading out,
   * which then destroys itself on the fallback timer, leaving nothing over a
   * live call.
   *
   * **It stops taking the mouse.** A card mid-fade is still a frameless
   * always-on-top window, and it is one the rep has no reason to expect a click
   * to land on: they have finished the call. `{ forward: false }` and not the
   * pass-through elsewhere in this file — that one keeps moves so the renderer
   * can notice the pointer coming back over the card, and a leaving window has
   * no interest in the pointer ever again.
   *
   * **Then it is asked.** The timer is armed before the ask and not after the
   * reply, so a renderer that never replies still loses its window: the animation
   * is a courtesy and the pill outliving the call is not a trade worth making.
   */
  dismiss(): void {
    const window = this.#window
    if (!window || window.isDestroyed()) {
      this.#window = null
      return
    }
    this.#window = null
    this.#disarm()

    try {
      window.setIgnoreMouseEvents(true, { forward: false })
    } catch {
      // A window whose native side is already gone. It is being destroyed
      // either way; there is nothing here worth failing a teardown over.
    }
    this.#leaving.set(
      window,
      setTimeout(() => this.#reap(window), EXIT_FALLBACK_MS),
    )
    this.#host.leave(window)
  }

  /**
   * The renderer answering: it has armed its exit and this is what it will take.
   *
   * Clamped to `EXIT_FALLBACK_MS` — the number arrives over IPC from a renderer,
   * and no reply may extend a frameless always-on-top window's life beyond what
   * `dismiss()` already promised. `0` — which is what `prefers-reduced-motion`
   * resolves to — destroys on the next tick rather than synchronously, so the
   * reply can be sent before the window carrying it is gone.
   *
   * **Every leaving window, not one**, and that is a choice rather than an
   * oversight: the handlers get no sender, and a window in `#leaving` is one this
   * class has *already decided* to destroy. Settling an older one early costs a
   * few milliseconds of an animation nobody is looking at any more, where
   * guessing wrong the other way would leave a pill on the screen.
   *
   * `false` when nothing was leaving, which is not an error: the fallback may
   * have fired first, or the quit path may have taken the window already.
   */
  left(afterMs: number): boolean {
    if (this.#leaving.size === 0) return false
    const wait = Math.min(Math.max(0, Math.round(afterMs)), EXIT_FALLBACK_MS)
    for (const [window, timer] of this.#leaving) {
      clearTimeout(timer)
      this.#leaving.set(window, setTimeout(() => this.#reap(window), wait))
    }
    return true
  }

  /**
   * Show the window once, and only when there is something right to show.
   *
   * `showInactive`, never `show`: this window must not take the keyboard away from
   * the call it is floating over — and on Windows `show()` would also pull the call
   * out of full screen. Idempotent, because three things can call it: the paint, the
   * first measurement, and the deadline.
   */
  #show(window: BrowserWindow): void {
    if (this.#shown || window.isDestroyed()) return
    // `#forced` is `APPEARANCE_MS` having passed, which is the only thing that
    // makes the paint optional — see the constant.
    if (!this.#painted && !this.#forced) return
    /*
     * **`#forced` outranks the measurement wait too, and it did not.**
     *
     * `APPEARANCE_MS`'s docblock calls itself « the ceiling on the widget appearing at
     * all », and this line let the *other* wait outlive it: `#reveal` is armed by
     * `ready-to-show`, so a paint landing just before the ceiling pushed the reveal to
     * `ready + FIRST_FRAME_MS`. Measured on the shipped class — paint at +988 ms
     * against a 1 000 ms ceiling, window shown at **+1 289 ms**. A constant whose
     * docblock states a promise the code does not keep, in the file where that shape
     * has already been found twice.
     */
    if (!this.#measured && this.#reveal !== null && !this.#forced) return
    this.#shown = true
    this.#disarm()
    window.showInactive()
  }

  /** Both waits, dropped: the window has been shown, or it has gone. */
  #disarm(): void {
    if (this.#reveal !== null) {
      clearTimeout(this.#reveal)
      this.#reveal = null
    }
    this.#revealAt = null
    if (this.#ceiling !== null) {
      clearTimeout(this.#ceiling)
      this.#ceiling = null
    }
  }

  /**
   * Every window playing its exit, destroyed now.
   *
   * Shared by `hide()` — a quit, one line before `store.close()` — and by
   * `show()`, where the reason is different and is argued there.
   */
  #settleLeaving(): void {
    for (const [leaving, timer] of this.#leaving) {
      clearTimeout(timer)
      if (!leaving.isDestroyed()) leaving.destroy()
    }
    this.#leaving.clear()
  }

  #reap(window: BrowserWindow): void {
    const timer = this.#leaving.get(window)
    if (timer !== undefined) clearTimeout(timer)
    this.#leaving.delete(window)
    if (!window.isDestroyed()) window.destroy()
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

    /*
     * **The first measurement is also the cue to become visible** — see
     * `FIRST_FRAME_MS`. Placed after `setBounds` so the frame the rep first sees is
     * already the right size in the right place, rather than the guess sliding into
     * it.
     */
    this.#measured = true
    this.#show(window)

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
