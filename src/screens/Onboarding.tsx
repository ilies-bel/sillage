/**
 * First run — three steps and one way in.
 *
 * The V2 design dropped the footer this screen used to end on (a version line
 * and a row of links); what a rep needs on the first screen is what the app is
 * about to do to their machine and the one thing that is not settled yet. So:
 * three numbered steps, one of which carries state, and a single filled
 * control.
 *
 * ## Step 2 is the whole screen
 *
 * « Le micro et l'audio de votre ordinateur » is the only step that can be in
 * more than one state, and it has five — three on macOS, two on Windows. **The
 * renderer knows none of that.** It reads `permissions:capture`, which answers
 * with rows that are already platform-neutral: a verdict folded by
 * `captureVerdict`, a scope to open or `null`, and refusal sentences composed
 * where the refusal was read. Nothing here branches on an OS, because this file
 * is written on a Mac and shipped to Windows (HR-2) and a mac-shaped sentence
 * on a Windows screen is a defect nobody here would ever see.
 *
 * The five states, and what each draws:
 *
 * | verdict | a pane to open | dot | sentence | control |
 * |---|---|---|---|---|
 * | `toGrant` | yes | `selected` | what will be asked for | *Ouvrir les réglages* |
 * | `denied` | yes | `down` | the refusal, naming its pane | *Ouvrir les réglages* |
 * | `ready` | — | `ok` | what is already allowed | none |
 *
 * Windows produces two of those three (`toGrant` never has a screen-recording
 * row to raise, and a refused microphone is `denied` with the Windows pane
 * behind the same button), and macOS all three. The renderer draws the table,
 * not the platforms.
 *
 * ## Why a button and never a prompt
 *
 * macOS shows its TCC sheet once per binary. Every later `askForMediaAccess`
 * resolves false with nothing on screen, so a « Autoriser » button on a machine
 * that has already refused is a dead control — exactly what DEC-26 forbids. The
 * port has no `ask` verb at all; a refusal leads to the pane.
 *
 * ## Why it re-reads on focus
 *
 * The rep leaves for System Settings, flips a switch and comes back. Nothing in
 * that sequence produces an event we can subscribe to, and a screen still
 * saying « refusé » thirty seconds after they allowed it is the failure this
 * screen exists to avoid. So the window regaining focus is the signal.
 */
import { useEffect } from 'react'
import type { CapturePermissions } from '../../electron/core/contracts/permissions.ts'
import {
  captureVerdict,
  refusalReasons,
  scopeToOpen,
  type CaptureVerdict,
} from '../../electron/core/contracts/permissionRows.ts'
import { invoke, useInvoke } from '../app/bridge.ts'
import { Button, StateDot } from '../ui/index.ts'
import type { StateDotProps } from '../ui/index.ts'

/**
 * The three steps, in the order a rep meets them. Steps 1 and 3 are statements
 * — they carry no control, because there is nothing on this screen for a rep to
 * decide about either of them.
 */
const STEPS = [
  {
    title: 'Sillage ne rejoint jamais la réunion',
    body: 'Aucun robot dans l’appel, aucun invité en plus : Sillage écoute l’audio de cet ordinateur pendant que vous parlez, et vous seul le voyez.',
  },
  {
    title: 'Le micro et l’audio de votre ordinateur',
    body: 'Les deux côtés de la conversation : votre voix par le micro, votre interlocuteur par la sortie audio de la machine.',
  },
  {
    title: 'Vous relisez avant tout envoi',
    body: 'Le compte-rendu s’écrit à la fin de l’appel. Rien ne part vers VerySwing ni vers Outlook avant que vous l’ayez relu et validé.',
  },
] as const

/** `selected` for « pas encore demandé » — brand blue, never the orange that
 *  VISION.md §6 reserves for « cette réunion est armée ». */
const TONE: Record<CaptureVerdict, StateDotProps['tone']> = {
  ready: 'ok',
  toGrant: 'selected',
  denied: 'down',
}

/** The word beside the dot. The whole of what the dot means, in one French word. */
const DOT_LABEL: Record<CaptureVerdict, string> = {
  ready: 'Prêt',
  toGrant: 'À autoriser',
  denied: 'Refusé',
}

/**
 * What a rep reads under the step title.
 *
 * `denied` has no entry: its sentences come from the main process, which is the
 * only side that knows *which* pane refused. A default written here would be a
 * guess, and the guess would name the wrong pane on the platform this repo is
 * not written on.
 */
const SAYS: Record<'ready' | 'toGrant', string> = {
  ready: 'Cet ordinateur autorise Sillage à écouter les deux côtés de l’appel.',
  toGrant:
    'macOS et Windows demandent votre accord avant qu’une application écoute. Ouvrez les réglages pour l’accorder.',
}

interface OnboardingProps {
  /** *Commencer* — the one filled control on the screen. */
  onDone: () => void
}

export function Onboarding({ onDone }: OnboardingProps) {
  const permissions = useInvoke('permissions:capture', {})
  const { reload } = permissions

  useEffect(() => {
    // The rep comes back from System Settings. See the header.
    const onFocus = () => reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  /*
   * A channel that has not answered yet, or one that rejected, is not a grant.
   * `toGrant` with no openable scope draws the step with its dot and its
   * sentence and no button — which is the honest rendering of « we have not
   * been told », and never a control that cannot work.
   */
  const state: CapturePermissions | null =
    permissions.state.status === 'ready' ? permissions.state.value : null
  const verdict: CaptureVerdict = state ? captureVerdict(state) : 'toGrant'
  const scope = state ? scopeToOpen(state) : null
  const refusals = state ? refusalReasons(state) : []

  const open = async () => {
    if (scope === null) return
    const result = await invoke('permissions:openSettings', { scope })
    // Opening the pane changes nothing by itself — the rep does. The focus
    // listener above is what picks up what they did.
    if (!result.opened) permissions.reload()
  }

  return (
    /*
      `overflow-y-auto` and a vertical gutter rather than a hard centre: at the
      960×600 the window declares as its minimum, the refused state carries two
      more lines than the ready one, and a centred column with nowhere to scroll
      loses *Commencer* off the bottom edge.
    */
    <div className="bg-canvas grain flex h-full flex-col items-center justify-center overflow-y-auto px-gutter py-gutter">
      <div className="flex w-full max-w-lg flex-col">
        <h1 className="text-brand-900 font-display text-display leading-none">Sillage</h1>
        <p className="text-brand-700 mt-tight text-label font-semibold uppercase tracking-[0.22em]">
          Compte-rendu de réunion
        </p>

        <div className="border-card mt-block w-14 border-t" />

        <ol className="mt-block space-y-block">
          {STEPS.map((step, index) => {
            const isPermission = index === 1
            return (
              <li key={step.title} className="flex gap-inline">
                {/*
                  The step number, not a bullet: this is an order, and the
                  middle one is the only one a rep acts on. 24×24 so it lines up
                  with every other mark in the product that has a hit area.
                */}
                <span
                  aria-hidden
                  className="border-card text-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-meta"
                >
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-inline">
                    <h2 className="text-strong text-ui font-semibold">{step.title}</h2>
                    {isPermission ? (
                      <StateDot tone={TONE[verdict]} label={DOT_LABEL[verdict]} />
                    ) : null}
                  </div>

                  <p className="text-muted mt-tight text-ui">{step.body}</p>

                  {isPermission ? (
                    <>
                      {verdict === 'denied' ? (
                        // Every refusal, in scope order: both can be refused at
                        // once, and printing only the first sends the rep to one
                        // pane and leaves the call half-deaf.
                        refusals.map((reason) => (
                          <p key={reason} className="text-danger mt-tight text-ui">
                            {reason}
                          </p>
                        ))
                      ) : (
                        <p className="text-muted mt-tight text-ui">{SAYS[verdict]}</p>
                      )}

                      {/*
                        Bordered, never filled: *Commencer* is the one filled
                        control on this screen. And it is absent — not disabled —
                        where the machine has no pane to open, because there is
                        nothing for it to do there.
                      */}
                      {scope !== null ? (
                        <Button className="mt-tight" onClick={open}>
                          Ouvrir les réglages
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>

        {/*
          The one filled control. Live in every state, including a refusal: the
          app records the side it is allowed to hear (« one missing channel is
          `degraded`, never `down` »), and a first screen that held a rep
          hostage to a toggle would be worse than a call recorded on one
          channel. What is missing is stated above it, not enforced here.
        */}
        <Button variant="primary" className="mt-gutter self-start" onClick={onDone}>
          Commencer
        </Button>
      </div>
    </div>
  )
}
