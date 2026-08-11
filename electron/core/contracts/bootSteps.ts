/**
 * The renderer's half of `boot.ts` — the three keys, and the one rule that
 * decides whether the splash still holds the window.
 *
 * ## Why this is a separate file from `boot.ts`
 *
 * Exactly the reason `status.ts` is separate from `health.ts`, and it is worth
 * restating because it is invisible until it is broken. `boot.ts` builds Zod
 * schemas at module scope. Every import the renderer makes from `electron/`
 * today is `import type`, so not one byte of `core/` reaches the renderer
 * bundle — but `BOOT_STEPS` is a **value**, and importing a value from
 * `boot.ts` would drag Zod across the boundary for the sake of three string
 * literals. `z.discriminatedUnion(...)` is a call expression, so no bundler
 * tree-shakes it away.
 *
 * So the values live here, the schemas stay there, and `boot.ts` re-exports
 * these so the main process still has one import site for the contract. The
 * `import type` below is erased at build time; at runtime the dependency goes
 * one way only, `boot.ts` → `bootSteps.ts`.
 */
import type { BootState, BootStep } from './boot.ts'

/**
 * The three keys the splash draws, in the order VISION.md §6 lists them.
 *
 * Exported so the renderer iterates the contract rather than retyping it — and
 * so adding an optional subsystem to this screen would mean editing this line,
 * under the comment in `boot.ts` that says why there are three and not six.
 */
export const BOOT_STEPS = ['store', 'devices', 'transcription'] as const
export type BootStepId = (typeof BOOT_STEPS)[number]

/**
 * Is this step still an open question?
 *
 * `downloading` counts, and that is the whole reason this is a function rather
 * than `state === 'pending'` at two call sites: DEC-30's first-run model fetch
 * is the one case the splash genuinely exists for, and a window that opened
 * over a half-finished download would be a window with no transcription behind
 * it.
 */
export const isBootPending = (step: BootStep): boolean =>
  step.state === 'pending' || step.state === 'downloading'

/**
 * Every required step answered — and **`failed` is answered.**
 *
 * The app opening is not conditional on transcription being available. A rep
 * whose weights are missing still has capture, still has a notepad, and still
 * has a compte-rendu to write by hand; holding the window shut would take all
 * of that away to protest one of them. What they get instead is the line saying
 * so on the way past, and the header status control (DEC-32) afterwards.
 *
 * `null` — the renderer has not been told yet — holds, because "we have not
 * asked" and "the answer is fine" are not the same thing and only one of them
 * is knowable here.
 */
export const bootAnswered = (state: BootState | null): boolean =>
  state !== null && BOOT_STEPS.every((id) => !isBootPending(state[id]))
