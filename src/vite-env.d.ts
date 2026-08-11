/// <reference types="vite/client" />

// The renderer's only view of the main process. `AppBridge` comes from
// `core/contracts/ipc.ts` — the same file `preload.ts` and `app/ipc/register.ts`
// are built from — so the three cannot drift (ARCHITECTURE.md §5.B).
//
// `core/contracts/` is also the only thing `src/` is allowed to import
// (ARCHITECTURE.md §4), which `scripts/check-boundaries.mjs` enforces.
import type { AppBridge } from '../electron/core/contracts/ipc.ts'

declare global {
  interface Window {
    app: AppBridge
  }
}

export {}
