/**
 * Where the in-meeting widget sits, as arithmetic.
 *
 * Split out of `Overlay.ts` the way `whisper/paths.ts` is split out of the
 * engine and `capture/nativeModule.ts` out of the tap: the part that decides is
 * a pure function over rectangles, so it can be tested against a laptop
 * unplugged from a second monitor without an Electron binary, a display or a
 * window manager. `Overlay.ts` keeps the part that cannot be — `screen`,
 * `BrowserWindow`, and the store.
 *
 * Everything here is in **screen** coordinates, which on a multi-display desktop
 * are signed: a monitor to the left of the primary one has a negative `x`, and a
 * placement routine that assumes zero is the left edge puts the widget on the
 * wrong screen the first time somebody docks.
 */

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Origin {
  x: number
  y: number
}

/**
 * How far above the bottom of the work area the widget floats by default.
 *
 * The work area already excludes the taskbar and the Dock, so this is breathing
 * room and not clearance. It is the same margin on both axes because the
 * default position is centred horizontally, and a margin that differs per axis
 * reads as a mistake at the one size where it shows.
 */
const MARGIN = 24

/**
 * Bottom centre of the work area.
 *
 * Bottom because that is where a call's own controls are not: Teams, Meet and
 * Zoom all hang their toolbar across the bottom *of their own window*, and the
 * widget floats over the desktop rather than over the window, so the two only
 * collide when the call is full-screen — which is the case the rep can fix by
 * dragging, once, for ever. Centre because the alternatives are worse: a corner
 * is where every OS notification lands, and the right-hand side is where the
 * participant rail lives in all three.
 */
export const defaultOrigin = (size: Size, area: Area): Origin => ({
  x: Math.round(area.x + (area.width - size.width) / 2),
  y: Math.round(area.y + area.height - size.height - MARGIN),
})

/** How much of `rect` lies inside `area`, in square pixels. */
const overlap = (rect: Area, area: Area): number => {
  const width = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x)
  const height = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y)
  return Math.max(0, width) * Math.max(0, height)
}

/**
 * **A saved position is a position on a display that may no longer exist.**
 *
 * This is the whole reason the placement is a module. A rep drags the widget
 * onto their second monitor, closes the laptop lid on a train, and the saved
 * origin now names coordinates no display covers. A frameless, always-on-top,
 * taskbar-less window placed there is not merely off-screen — it is
 * *unrecoverable*, because there is nothing to alt-tab to and no title bar to
 * drag back. The only fix would be deleting a preference the rep cannot see.
 *
 * So a saved origin is honoured only if the window would land mostly on a real
 * display, and « mostly » is measured rather than asserted: the display it
 * overlaps most wins, and if it overlaps none of them by at least a quarter of
 * its own area the answer is the default placement on the primary display. A
 * quarter rather than a pixel, because a widget hanging a corner into the
 * screen is a widget the rep cannot read or drag either.
 *
 * Then it is clamped fully inside that display — which is also what makes
 * *growing* safe: the widget expands when the rep opens it, and a card that
 * grew downward from a pill resting on the bottom margin would push its own
 * controls under the edge of the screen.
 */
export const placeWindow = (
  saved: Origin | null,
  size: Size,
  areas: readonly Area[],
): Origin => {
  const primary = areas[0]
  if (!primary) return saved ?? { x: 0, y: 0 }

  const wanted = saved ?? defaultOrigin(size, primary)
  const rect: Area = { ...wanted, ...size }

  let best = primary
  let bestOverlap = -1
  for (const area of areas) {
    const seen = overlap(rect, area)
    if (seen > bestOverlap) {
      best = area
      bestOverlap = seen
    }
  }

  const enough = size.width * size.height * 0.25
  const target = bestOverlap >= enough ? best : primary
  const origin = bestOverlap >= enough ? wanted : defaultOrigin(size, primary)

  /*
   * `Math.max` last, so a widget larger than the work area — a 200px display
   * scaled to something absurd, a work area of nothing while a full-screen app
   * transitions — lands at the top-left of it rather than at a negative offset
   * computed from a negative range.
   */
  return {
    x: Math.round(Math.max(target.x, Math.min(origin.x, target.x + target.width - size.width))),
    y: Math.round(Math.max(target.y, Math.min(origin.y, target.y + target.height - size.height))),
  }
}

/**
 * **Where the window goes when its content changes size — measured from the
 * pill, which is the thing that must not move.**
 *
 * The first version of this anchored an *edge*: bottom edge in the bottom half
 * of the display, top edge in the top half, like a menu. The docblock argued it
 * well and the test asserted it faithfully, and it was aimed at the wrong
 * thing. The pill is drawn at the **top** of the content and the panel opens
 * under it, so holding the bottom edge still moves the pill — the control the
 * rep just pressed — by the entire height of the panel. Measured on the default
 * placement, which is where every widget starts: **333 pixels, on the first
 * press of the first call.** A test over rectangles could not see it, because
 * rectangles do not know what is drawn at the top of one.
 *
 * So the anchor is the pill itself, reported by the renderer as its offset
 * inside the frame (`pillTop`) — measured rather than shared as a constant,
 * because the shadow margin around the card is the renderer's business and a
 * number agreed by two files is a number that will disagree.
 *
 * The direction the panel opens is decided here and *returned* to the renderer,
 * rather than being read off the layout afterwards: the renderer has to know
 * which way to stack **before** it lays the panel out, or the first frame draws
 * in the wrong place. It is decided from the pill's own position — bottom half
 * of the display, the panel opens upward — and the pill's position does not
 * change when the panel opens, so the answer is stable across the press.
 */
export interface Pill {
  /** The pill's top edge, in screen coordinates. What must not move. */
  screenTop: number
  /** The pill's horizontal centre, in screen coordinates. */
  screenCentreX: number
  /** The pill's offset inside the frame, as the renderer has just laid it out. */
  offsetTop: number
  height: number
}

export const placeAroundPill = (
  pill: Pill,
  to: Size,
  areas: readonly Area[],
  /**
   * **The width the window already has**, so a resize that does not change it
   * cannot move the window sideways.
   *
   * Clamping is right when the card *grows*: a pill dragged against the bottom
   * with a panel that fits neither above nor below has to move, and the
   * alternative is a card half off the display. It is wrong on a height change,
   * and a height change is what happens **every time a turn of the call
   * arrives**. A rep who tucked the pill against the right edge — which is the
   * ordinary way to keep it off a shared screen — had it slide a hundred and
   * forty-one pixels back over the video seconds later, with nobody touching
   * anything, and the stored preference kept an x the app would never honour,
   * so it happened again on the next launch.
   *
   * A placement the rep made with their own hand is not a saved origin from a
   * monitor that may have been unplugged. Horizontally it is honoured until the
   * card's width changes, and `placeWindow` still clamps at creation, which is
   * the case that is genuinely unrecoverable.
   */
  from?: Size,
): Origin => {
  const wanted: Origin = {
    x: Math.round(pill.screenCentreX - to.width / 2),
    y: Math.round(pill.screenTop - pill.offsetTop),
  }
  const placed = placeWindow(wanted, to, areas)
  return from && from.width === to.width ? { x: wanted.x, y: placed.y } : placed
}

/**
 * Which way the panel opens.
 *
 * The pill's own half of the display, not the window's: they are the same thing
 * while the widget is collapsed and they stop being the same the moment it is
 * not, which is precisely when this is asked.
 */
export const opensAbove = (pill: Pill, areas: readonly Area[]): boolean => {
  const point = { x: pill.screenCentreX, y: pill.screenTop + pill.height / 2 }
  const area =
    areas.find(
      (candidate) =>
        point.x >= candidate.x &&
        point.x < candidate.x + candidate.width &&
        point.y >= candidate.y &&
        point.y < candidate.y + candidate.height,
    ) ?? areas[0]
  if (!area) return false
  return point.y > area.y + area.height / 2
}
