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
