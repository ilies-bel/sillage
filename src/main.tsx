/**
 * The renderer's entry, for both of this product's windows.
 *
 * There is one bundle and one HTML file. The window says which of the two it is
 * with a query string — `?window=widget` for the in-meeting pill
 * (`app/windows/Overlay.ts`), nothing at all for the app. A second Vite input
 * would mean a second build output and a second place to import the design
 * tokens from, for a renderer that shares every contract, every token and the
 * whole IPC bridge with the first one.
 *
 * The widget's window is transparent, and the transparency has to reach the
 * page: `body` carries `--bg-canvas` (`design/index.css`), which over a video
 * call would be an opaque rectangle the size of the window. It is cleared here,
 * on the one route that needs it, rather than by a second stylesheet.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/index.css'
import { App } from './App.tsx'
import { Widget } from './widget/Widget.tsx'
import { TitleBar } from './ui/TitleBar.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable')

const isWidget = new URLSearchParams(window.location.search).get('window') === 'widget'
if (isWidget) {
  document.body.style.background = 'transparent'
  document.documentElement.style.background = 'transparent'
  /*
   * **And `#root`, which is the one that was actually covering the call.**
   *
   * `index.html` paints `html, body, #root` with `--bg-canvas` inline, so the
   * window shows paper instead of white before the stylesheet lands. Two of
   * those three were cleared here and the third was not — and `#root` is the
   * element that fills the window, so the transparency this block exists to
   * deliver stopped one level short of the surface. Measured on the widget
   * route: `body` and `html` transparent, `#root` `rgb(247, 249, 251)`.
   *
   * What a rep saw was the failure the docblock above describes as prevented —
   * « an opaque rectangle the size of the window » over a client's video —
   * extending the full 20px `HALO` on every side of the pill, with the shadow
   * that is supposed to separate the card from the call falling onto it.
   *
   * It survived because nothing ever photographs this window over anything but
   * the app's own paper, where an opaque `#f7f9fb` rectangle is invisible by
   * construction. `widget-sombre` asserts the absence of an opaque ancestor
   * now, which is the property rather than this line.
   */
  root.style.background = 'transparent'
  /*
   * The overlay's palette, on the one route that is not inside the app.
   *
   * `.widget-surface` re-points the surface tokens for this document
   * (`design/index.css`); `tokens.css` carries why a window drawn over another
   * application's video call cannot wear the paper the app is made of. Set on
   * the document element rather than on a component, so the whole tree is on
   * one ground and nothing can render half of itself in the other palette.
   */
  document.documentElement.classList.add('widget-surface')
}

createRoot(root).render(
  <StrictMode>
    {isWidget ? (
      <Widget />
    ) : (
      // The band is the window's, not a screen's: it stays over the splash,
      // first run and every route alike.
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <App />
        </div>
      </div>
    )}
  </StrictMode>,
)
