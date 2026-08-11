/**
 * Screen 0 — *Démarrage* (VISION.md §6, DEC-30).
 *
 * The wordmark, three lines naming what the app is opening, and the version.
 * That is the whole screen, and the restraint is the design: a splash is read
 * for under a second on a good day and for a minute on the day it matters, and
 * only one of those two is worth building for.
 *
 * **The renderer owns the labels; the main process owns the values.** « Base
 * locale » is a word for a rep and belongs here. What is *in* the database,
 * which engine a meeting would run on, why the audio module refused — none of
 * that is knowable on this side of the bridge, and a value assembled here would
 * be the renderer guessing at state it does not hold. That is precisely how a
 * splash ends up looking finished while reporting nothing.
 *
 * The lines come from `BOOT_STEPS`, not from a list retyped here, so the screen
 * cannot quietly grow a fourth one. There is no field on `BootState` for the
 * calendar, VerySwing or Outlook: DEC-26 says they are optional at runtime, and
 * "nothing optional is awaited" is enforced by the contract's shape rather than
 * by this file remembering it.
 *
 * ## On the progress bar
 *
 * It renders only for `downloading`, and `downloading` is emitted by nothing
 * today — the weights ship inside the installer. That is stated in
 * `core/contracts/boot.ts` and it is deliberate: the alternative was a bar
 * wired to a timer, and a splash that fakes progress is worse than no splash.
 * When DEC-30's boot-time fetch lands it publishes the variant and the bar is
 * already here.
 */
import type { BootState, BootStep } from '../../electron/core/contracts/boot.ts'
import { BOOT_STEPS, type BootStepId } from '../../electron/core/contracts/bootSteps.ts'
import { StateDot } from '../ui/index.ts'
import type { StateDotProps } from '../ui/index.ts'

/**
 * French, and the rep's vocabulary rather than the module's. « Audio » and
 * « Transcription » match `CONNECTOR_LABEL` in the header status control and in
 * Réglages on purpose — one subsystem should not have two names depending on
 * which screen a rep is looking at.
 */
const LABEL: Record<BootStepId, string> = {
  store: 'Base locale',
  devices: 'Audio',
  transcription: 'Transcription',
}

/**
 * `none` for `pending`: an unanswered question is not a green light and not a
 * red one. `selected` (brand blue) for the download, because orange has exactly
 * one meaning in this product — armed or recording — and a first-run model
 * fetch is neither.
 */
const TONE: Record<BootStep['state'], StateDotProps['tone']> = {
  pending: 'none',
  ready: 'ok',
  downloading: 'selected',
  failed: 'down',
}

/** Every non-pending state carries its own phrase, composed in main. */
const valueOf = (step: BootStep): string =>
  step.state === 'pending' ? 'en cours…' : step.value

/** Not answered yet, which is what the renderer knows before main replies. */
const PENDING: BootStep = { state: 'pending' }

interface SplashProps {
  /**
   * `null` until `boot:state` answers. Drawn as three pending lines rather than
   * as a blank panel — the screen's whole job is to say what is happening, and
   * "we have not been told" is one of the things that can be happening.
   */
  state: BootState | null
}

export function Splash({ state }: SplashProps) {
  return (
    <div className="bg-canvas grain flex h-full flex-col items-center justify-center px-gutter">
      <div className="flex w-full max-w-sm flex-col items-center">
        {/*
          The wordmark. Fraunces at display size, which is the one place
          `--display-tracking` is a setting rather than a smudge.

          `--brand-900` rather than `--text-strong`: 13.31:1 on white, so it
          gives up nothing legible, and it is the one moment in the product
          where the brand gets to be the brand. Every other heading stays ink.
        */}
        <h1 className="text-brand-900 font-display text-display leading-none">Sillage</h1>

        {/*
          What the app is, for the one second a rep spends here on the day they
          are first shown it. `--brand-700` at 6.28:1; the tracking is what
          makes ten-pixel uppercase readable rather than dense.
        */}
        <p className="text-brand-700 mt-tight text-label font-semibold uppercase tracking-[0.22em]">
          Compte-rendu de réunion
        </p>

        {/* The rule separates the mark from the machinery below it. */}
        <div className="border-card mt-block w-14 border-t" />

        <ul aria-live="polite" className="mt-block w-full space-y-row">
          {BOOT_STEPS.map((id) => {
            const step = state ? state[id] : PENDING
            return (
              <li key={id}>
                <div className="flex items-baseline justify-between gap-inline">
                  <StateDot tone={TONE[step.state]} label={LABEL[id]} />
                  {/*
                    `text-right` and `min-w-0` so a long refusal — « module
                    audio natif indisponible — … » — wraps under itself instead
                    of pushing the label off the line.
                  */}
                  <span className="text-muted min-w-0 text-right text-ui">{valueOf(step)}</span>
                </div>

                {step.state === 'downloading' ? (
                  <>
                    {/*
                      No `.grain` here — the texture is for quiet surfaces, and
                      on a 4px bar it is invisible and pure cost.
                    */}
                    <div className="bg-subtle mt-tight h-1 w-full overflow-hidden rounded-sm">
                      <div
                        role="progressbar"
                        aria-valuenow={step.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={LABEL[id]}
                        className="bg-brand-500 h-full rounded-sm transition-[width]"
                        style={{ width: `${step.percent}%` }}
                      />
                    </div>
                    {/*
                      DEC-30's sentence, and the reason this state has a screen
                      at all: a rep watching several hundred megabytes arrive is
                      owed the fact that it happens once.
                    */}
                    <p className="text-muted mt-tight text-meta">
                      Téléchargement unique — le modèle reste ensuite sur cette machine.
                    </p>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>

        <p className="text-muted mt-gutter text-meta">Version {state?.version ?? '—'}</p>
      </div>
    </div>
  )
}
