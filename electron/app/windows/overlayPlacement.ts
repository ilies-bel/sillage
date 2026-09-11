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
 * Where the window goes when its own content changes size.
 *
 * The widget has two shapes — a pill, and a card with the controls and the
 * marks in it — and the rep opens one into the other with a press. Resizing a
 * frameless window from its top-left corner would make that press *move* the
 * thing being pressed, which is the defect DEC-4 states at the review gate for
 * a worse reason: the one control that ships must never be the rectangle the
 * rep just pressed. Here nothing ships, but the pill sliding out from under a
 * finger mid-call is still the app moving while it is being used.
 *
 * So the press holds an edge still, and which edge is decided by where the
 * widget is — the same rule a menu follows. In the bottom half of the display
 * the card grows upward, in the top half downward, and horizontally it always
 * grows about its own centre because the pill is centred in the card. The
 * clamp in `placeWindow` then does the rest, which is what covers the case the
 * anchor cannot: a widget dragged half off the bottom expands into a display
 * that has no room below it.
 */
export const resizePlacement = (
  current: Origin,
  from: Size,
  to: Size,
  areas: readonly Area[],
): Origin => {
  const rect: Area = { ...current, ...from }
  let best = areas[0] ?? { x: current.x, y: current.y, width: from.width, height: from.height }
  let bestOverlap = -1
  for (const area of areas) {
    const seen = overlap(rect, area)
    if (seen > bestOverlap) {
      best = area
      bestOverlap = seen
    }
  }

  const centre = current.y + from.height / 2
  const inTopHalf = centre < best.y + best.height / 2
  const anchored: Origin = {
    x: Math.round(current.x + (from.width - to.width) / 2),
    y: inTopHalf ? current.y : Math.round(current.y + from.height - to.height),
  }
  return placeWindow(anchored, to, areas)
}
