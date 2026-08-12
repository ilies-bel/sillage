/**
 * What happened after « Terminer » — the strip that exists so that nothing is
 * the answer to nothing.
 *
 * A meeting that ends goes to `ended`, and `ended` draws no control: no
 * *Démarrer*, no *Terminer*, and the review gate stays shut until the
 * extraction has produced something to review. When the extraction runs that
 * lasts a few seconds and nobody notices. When it *cannot* run — no model
 * configured, or an attempt that failed — the rep watched a recording finish
 * and then watched the screen do nothing at all, with the reason sitting in a
 * diagnostics log they have no cause to open. A meeting recorded, transcribed,
 * and apparently discarded.
 *
 * So the three cases say themselves, and two of them carry the way out:
 *
 *   · `running`          — it is being written, sit tight
 *   · `waitingForModel`  — no model, and a promise: dès qu'un modèle existe
 *   · `failed`           — what went wrong, and a button that tries again
 *
 * **The promise is real, not a phrasing.** `Enhancement` remembers the meeting,
 * every write in Réglages calls the drain, and a model appearing there starts
 * the run without the rep coming back here. The button is the impatient path,
 * not the only one.
 *
 * `role="status"` and not `alert`: none of this is an error the rep caused, and
 * the two that are recoverable are recoverable in their own time. The transcript
 * and the notes are already on disk in every one of these states — which is the
 * thing the copy has to convey before it conveys anything else.
 */
import { useCallback, useEffect, useState } from 'react'
import type { EnhancementStatus } from '../../../electron/core/contracts/extraction.ts'
import { invoke, useBroadcast } from '../../app/bridge.ts'
import { formatElapsed } from '../../app/format.ts'
import { Button } from '../../ui/index.ts'

/**
 * How long the rep has been waiting, ticking, beside the sentence that says
 * what for.
 *
 * The run is bounded — 60 s for the notes pass, 180 s for the extraction — but
 * three minutes of an unchanging line of text reads as a hang, and that reading
 * is the reason this component exists. A number that moves separates *slow*
 * from *dead* without the app having to claim a progress it cannot measure: the
 * model returns once, so there is no honest percentage to draw, and a bar that
 * crawls to 90 % and waits is a worse lie than a clock.
 *
 * `since` null is a run this process did not start, so there is no start to
 * count from and nothing is drawn — the sentence alone is still the truth.
 *
 * Its own component for the reason `Elapsed` is: it re-renders every second,
 * and the screen it sits on holds a live ProseMirror view with the rep's caret
 * in it.
 */
function RunClock({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (since === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])

  if (since === null) return null

  return (
    <span className="text-muted tabular-nums text-ui"> · {formatElapsed(Math.max(0, now - since))}</span>
  )
}

interface EnhancementNoticeProps {
  meetingId: string
  /** Opens Réglages, where the missing model is configured. */
  onReglages?: () => void
}

export function EnhancementNotice({ meetingId, onReglages }: EnhancementNoticeProps) {
  const [status, setStatus] = useState<EnhancementStatus>({ status: 'idle' })
  const [retrying, setRetrying] = useState(false)

  /*
   * Read once on mount *and* subscribed to the broadcast, because neither alone
   * is enough. The broadcast only fires on a change, so a rep who opens this
   * meeting from Historique an hour later would see nothing; the read only
   * answers for the instant it ran, so a meeting that ends while this screen is
   * open would never update. Two sources, one shape — `enhancement:status` is
   * computed by one function in the main process for exactly this reason.
   */
  useEffect(() => {
    let live = true
    void invoke('enhancement:status', { meetingId })
      .then((next) => {
        if (live) setStatus(next)
      })
      .catch(() => {
        // A status that cannot be read is not worth an error strip of its own:
        // the meeting is intact either way, and the next broadcast corrects it.
      })
    return () => {
      live = false
    }
  }, [meetingId])

  useBroadcast('enhancement:status', (payload) => {
    if (payload.meetingId === meetingId) setStatus(payload.status)
  })

  const retry = useCallback(async () => {
    setRetrying(true)
    try {
      setStatus(await invoke('enhancement:retry', { meetingId }))
    } catch {
      // The handler answers with a status rather than throwing, so this is a
      // dead channel or a closed window. Leaving the previous status is the
      // honest outcome — the button did not work, and it still says so.
    } finally {
      setRetrying(false)
    }
  }, [meetingId])

  if (status.status === 'idle') return null

  return (
    <div
      role="status"
      className="border-subtle bg-card-soft flex shrink-0 items-center gap-inline border-b px-gutter py-2"
    >
      {status.status === 'running' ? (
        <p className="text-body min-w-0 flex-1 max-w-[74ch] text-ui">
          Rédaction du compte-rendu…{' '}
          <span className="text-muted">
            Deux à trois minutes selon la longueur de la réunion. Vos notes et la transcription sont
            déjà enregistrées ; vous pouvez continuer à écrire.
          </span>
          <RunClock since={status.since} />
        </p>
      ) : status.status === 'waitingForModel' ? (
        <>
          {/*
            `max-w-[74ch]` and not the full strip. At 1440 this sentence ran to
            206 characters on one line — long enough that the eye loses the
            start on the way back, on the one line of prose in the product that
            has to be read rather than scanned. Two shorter lines beat one that
            spans a laptop.
          */}
          <p className="text-body min-w-0 flex-1 max-w-[74ch] text-ui">
            Compte-rendu en attente — aucun modèle d’analyse n’est configuré.{' '}
            <span className="text-muted">
              La transcription et vos notes sont enregistrées ; le compte-rendu sera rédigé dès
              qu’un modèle sera disponible.
            </span>
          </p>
          {/*
            `ml-auto`, so the action sits where every other action on this
            screen sits — the right edge. Capping the sentence at 74ch left the
            button floating in the middle of the strip, which reads as part of
            the paragraph rather than as the way out of it.
          */}
          {onReglages ? (
            <div className="ml-auto shrink-0">
              <Button variant="primary" onClick={onReglages}>
                Choisir un modèle
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-body min-w-0 max-w-[74ch] flex-1 text-ui">
            {status.reason === null
              ? 'Le compte-rendu n’a pas encore été rédigé.'
              : `Le compte-rendu n’a pas pu être rédigé : ${status.reason}`}{' '}
            <span className="text-muted">La transcription et vos notes sont intactes.</span>
          </p>
          {/*
            The disabled branch carries its reason because `Button` will not
            accept one without it — a control that greys out and says nothing is
            the same dead end this whole strip exists to remove, one level down.
          */}
          <div className="ml-auto shrink-0">
            {retrying ? (
              <Button variant="primary" disabled disabledReason="rédaction en cours">
                Rédaction…
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void retry()}>
                Rédiger le compte-rendu
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
