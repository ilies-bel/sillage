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
import { Logo, StateDot } from '../ui/index.ts'
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
 * `pending` for `pending`: an unanswered question is not a green light and not
 * a red one — but it is not *nothing* either. `none` draws no dot at all, so on
 * a splash whose two other rows have one, the row still being waited on read as
 * a rendering fault. An outline is the slot, present and empty. `selected` (brand blue) for the download, because orange has exactly
 * one meaning in this product — armed or recording — and a first-run model
 * fetch is neither.
 */
const TONE: Record<BootStep['state'], StateDotProps['tone']> = {
  pending: 'pending',
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
    <div className="bg-canvas grain relative flex h-full flex-col items-center justify-center px-gutter">
      {/*
        The blur. Two brand washes, blurred past recognition, behind a panel
        that blurs what is behind it — the one screen where the product is
        allowed to be a mood rather than a table. `aria-hidden` and
        `pointer-events-none`: it is paint, not content.

        **`overflow-clip`, and the exact word matters.** Both washes are pushed
        outside this box on purpose — `-translate-x-1/3` and `translate-x-1/4`
        of a 24rem and a 28rem circle — and with nothing clipping them they
        enlarged the *document* instead of bleeding off it: measured, the splash
        rendered 1392×949 CSS in a 1280×800 window, 112px wider and 149px
        taller, which is `translate-x-1/4` of 448px and `translate-y-1/3` of
        448px exactly. The window gained two scrollbars and a bare strip down
        the right of the product's **first frame**, and no check could see it —
        `--scrollers`, `--geometry` and `--prose` all measure boxes *inside* a
        screen, and this was the screen outgrowing the window. It was found by
        noticing that every other stage's PNG came out at exactly twice its
        viewport and this one did not.

        `overflow-hidden` fixes the growth and buys a false finding with it: a
        hidden box is a **scroll container**, so `--scrollers` then reports « 1
        boîte cache du contenu » on four stagings — correctly, by its own rule,
        because content that overflows a scrollable box is content a rep cannot
        see. `overflow-clip` is not a scroll container: there is no scrollable
        overflow region to hide anything in, and the check skips it for the same
        reason it skips `visible`. The right primitive rather than an exemption
        — `data-scrolls` would have silenced it, but that marker means « this box
        is supposed to hold more than it shows », and a paint layer is not
        supposed to hold anything at all.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-clip">
        <div className="bg-brand-300 absolute left-0 top-0 h-96 w-96 -translate-x-1/3 -translate-y-1/3 rounded-full opacity-70 blur-3xl" />
        <div className="bg-brand-100 absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/4 translate-y-1/3 rounded-full blur-3xl" />
      </div>
      <div className="border-card relative flex w-full max-w-sm flex-col items-center rounded-lg border bg-scrim px-8 py-10 backdrop-blur-xl">
        {/*
          The mark, drawn rather than loaded. It carried the archived
          predecessor's circled monogram at 1.04:1 — white artwork on
          transparency, so what a rep actually saw here was `shadow-card`
          outlining an empty rounded square. `ui/Logo.tsx` has the measurement.

          No `rounded shadow-card` around it any more: the box and the lift were
          there to make a raster read as an app icon. A mark stands on its own,
          and VISION §6's « shadows barely there » is about panes.
        */}
        <Logo className="mb-4 h-16 w-16" />
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

                    The download says its size and its remaining time, and that
                    sentence is too long for a right-hand column on a 384px
                    panel: it wrapped to « environ 1 / min », which is a number
                    split from its unit on the one screen a rep stares at while
                    waiting. It goes under the bar instead, where there is a
                    line's width for it and where the bar it describes is.
                  */}
                  <span className="text-muted min-w-0 text-right text-ui">
                    {step.state === 'downloading' ? `${step.percent} %` : valueOf(step)}
                  </span>
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
                      {step.value}
                    </p>
                    <p className="text-muted text-meta">
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
