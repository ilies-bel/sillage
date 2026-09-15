/**
 * The window's title band, drawn by the renderer.
 *
 * `main.ts` hides the frame's own title bar (`titleBarStyle: 'hidden'`) and
 * paints the OS controls over this band — traffic lights on macOS, the
 * Windows controls overlay — in the same `--brand-700`, so the top of the
 * window is one blue rectangle on both platforms rather than the host's grey.
 *
 * It is `.drag-region`, because a hidden title bar is a window nobody can
 * move otherwise. The height is `env(titlebar-area-height)` where the host
 * declares one and 36px where it does not (the harness, macOS), which is the
 * number `main.ts` passes to the overlay. The left padding clears the
 * traffic lights; on Windows the controls are on the right and the overlay's
 * own width keeps them off the text.
 */
import logo from '../assets/logo.png'

export function TitleBar() {
  return (
    <div
      role="presentation"
      className="drag-region bg-brand-700 flex shrink-0 items-center pr-[140px]"
      // Windows declares `titlebar-area-x` (0: controls are on the right), so
      // the text sits at 14px; macOS and the harness do not, so it clears the
      // traffic lights.
      style={{
        height: 'env(titlebar-area-height, 36px)',
        paddingLeft: 'max(14px, env(titlebar-area-x, 78px))',
      }}
    >
      <img src={logo} alt="" aria-hidden className="h-[18px] w-[18px] rounded-sm" />
    </div>
  )
}
