/**
 * `CapturePort` — what `app/` is allowed to depend on: a thing that produces frames.
 *
 * The devices are one implementation and `FileCapture` is another. Declaring the
 * port is what makes the second one a capture source rather than a cast — the
 * concrete class carries `#private` fields, so a structurally identical replay
 * would not be assignable to it and every call site would need `as never`. That
 * cast was already in the tests; a fixture is a poor reason to spread it.
 *
 * **It is declared here, and not in `modules/capture/index.ts`, because a port
 * declared inside the module that implements it is invisible to
 * `check-ports.mjs`.** That check discovers ports from this directory, so for
 * the whole life of the rule « every method on a port must be called from
 * outside the module that implements it » the two ports it never asked about
 * were capture — the one required subsystem — and mail, which writes the
 * Outlook draft. Measured before the move: a dead `flushDevices()` added to
 * `CapturePort` and implemented on `CaptureSession` passed `npm run check`
 * (twelve gates, exit 0) and `npm test`, while the same shape on `CrmPort` is
 * named by the check within a second. `scripts/check-ports.mjs` now fails on
 * any `export interface …Port` outside this directory, so the hole cannot be
 * dug again by declaring a port next to its implementation.
 *
 * `EventEmitter` is imported **as a type only**: `core/` stays free of I/O and
 * of anything that can fail, and a type erased at compile time is neither.
 *
 * `readonly running: boolean` was declared here and read by nothing outside
 * `modules/capture/` — `Recording.ts` tracks its own lifecycle and never asks.
 * It is gone rather than excused: an `UNWIRED` entry is standing permission,
 * and this one would have said « nobody needs it ». The getters on
 * `CaptureSession` and `FileCapture` stay, because their own tests read them to
 * assert a teardown; what was dead was the *port*'s claim that `app/` may ask.
 * Note the limit this leaves, stated rather than implied: `check-ports.mjs`
 * asks « who calls it » of a **method**, so a property re-added here would be
 * as unmeasured as this one was.
 */
import type { EventEmitter } from 'node:events'

import type { Channel } from './transcript.ts'

export interface CapturePort extends EventEmitter {
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * Peak amplitude per channel since the last call, for the in-call level
   * meter. Optional because it is a cosmetic read: `FileCapture` replays a wav
   * and has no meter to feed, and a replay fixture should not have to grow a
   * method to stay assignable to this port.
   */
  takeLevels?(): Record<Channel, number>
}
