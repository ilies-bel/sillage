/**
 * What the splash reports (VISION.md §6, screen 0 — *Démarrage*).
 *
 * **The shape is the decision.** DEC-26 says every connector is optional at
 * runtime and DEC-32 names the three that are not: capture, transcription and
 * analysis. Screen 0 goes one step further — it reports only what the app is
 * *opening*, which is the local database, the audio devices and the
 * transcription engine. There is deliberately no field here for the calendar,
 * for VerySwing or for Outlook, so "nothing optional is awaited" is enforced by
 * the type rather than by a reviewer noticing a fourth line creeping in.
 *
 * Analysis (`llm`) is absent for a different reason and it is worth stating: it
 * is resolved from environment variables with no I/O at all, so there is nothing
 * to wait for and a line saying so would be noise on a screen whose whole job is
 * to name slow things honestly.
 *
 * `value` is a French phrase composed in the main process and rendered verbatim.
 * The renderer owns the label (« Base locale ») and never the value — a value
 * assembled on the far side of the bridge would be the renderer guessing at
 * state it does not hold, which is exactly how a splash ends up looking finished
 * while reporting nothing.
 *
 * ## `downloading`
 *
 * DEC-30 makes the first-run model download a real state with a screen. Today
 * the weights ship inside the installer (`scripts/fetch-whisper-model.mjs` runs
 * at build time), so **nothing in the app emits `downloading` yet** — the one
 * place a percentage exists is `LocalWhisperSession`, which reports it from
 * inside a running meeting, long after this screen is gone. The variant is
 * declared because the alternative is a progress bar wired to a timer, and a
 * splash that fakes progress is worse than no splash. When a boot-time fetch
 * lands it publishes `boot:changed` with this variant and the bar is already
 * there.
 */
import { z } from 'zod'

export const BootStepSchema = z.discriminatedUnion('state', [
  /** Not answered yet. The only state that holds the window shut. */
  z.object({ state: z.literal('pending') }),
  z.object({ state: z.literal('ready'), value: z.string().min(1) }),
  /**
   * The one slow case, and the only other state that holds the window. Carries
   * its own French phrase so the renderer never formats a percentage twice.
   */
  z.object({
    state: z.literal('downloading'),
    value: z.string().min(1),
    percent: z.number().int().min(0).max(100),
  }),
  /**
   * Answered, and the answer is bad. It does **not** hold the window: the app
   * opening is not conditional on transcription being available, and the header
   * status control (DEC-32) is where a rep reads about it afterwards. `value`
   * is the reason, verbatim from whoever refused — never « erreur ».
   */
  z.object({ state: z.literal('failed'), value: z.string().min(1) }),
])
export type BootStep = z.infer<typeof BootStepSchema>

export const BootStateSchema = z.object({
  /** SQLite. Open before anything else in `boot()`, or the app exits. */
  store: BootStepSchema,
  /**
   * Whether this machine can capture audio at all.
   *
   * Answered by `CaptureSession.probe()` — a real call across the native ABI —
   * and deliberately **not** by enumerating. Enumeration would light the macOS
   * microphone-in-use indicator at launch with no meeting running, and its
   * count is not the measurement it looks like: `list_input_devices` pushes a
   * synthetic default before it enumerates anything. See `audioBootStep` in
   * `app/main.ts` for the whole argument; the devices themselves are opened
   * when a meeting starts, which is where a real count exists.
   */
  devices: BootStepSchema,
  /** Which engine a meeting would run on right now, or why none would. */
  transcription: BootStepSchema,
  /** Rendered in the footer. `app.getVersion()`. */
  version: z.string().min(1),
})
export type BootState = z.infer<typeof BootStateSchema>

/**
 * The three keys the splash draws, and the rule that decides whether it still
 * holds the window.
 *
 * They live in `bootSteps.ts` because they are **values** and the renderer
 * needs them: importing a value from this file would pull Zod into the renderer
 * bundle, since the schemas above are call expressions no bundler will
 * tree-shake. Re-exported here so the main process still has one import site
 * for the contract. See that file's header.
 */
export {
  BOOT_STEPS,
  bootAnswered,
  isBootPending,
  type BootStepId,
} from './bootSteps.ts'
