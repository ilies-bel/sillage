import { useState } from 'react'
import {
  ESSAI_MEETING_ID,
  ESSAI_SECONDS,
  essaiLines,
  essaiSummary,
  type EssaiResult,
} from '../../../electron/core/contracts/essai.ts'
import { invoke } from '../../app/bridge.ts'
import { Button, StateDot, unavailable } from '../../ui/index.ts'
import { LevelMeter } from '../session/LevelMeter.tsx'

/**
 * **Twenty seconds of real capture, and the two screens that offer it.**
 *
 * It lived inside `Onboarding.tsx` and was reachable from first run and from
 * nowhere else — and from there only through « Revoir la présentation › » in
 * the *empty-day* panel, so a rep whose headset changed, whose Bluetooth output
 * moved or whose grant a Windows update revoked had three calls on the day they
 * needed it and no way in. The placement was keyed on « the day is empty » when
 * the need is « capture is suspect ».
 *
 * So it is a component of its own, mounted twice: on first run, where it is the
 * proof before the first client, and in *Réglages › Connecteurs › Requis*, where
 * it sits under a row that says « Audio · connecté » — a device that opened,
 * which is not a sound that arrived (DEC-45).
 */
export function EssaiAudio({ onReglages }: { onReglages?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [granting, setGranting] = useState(false)
  const [result, setResult] = useState<EssaiResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /*
   * The same retry the permission row makes, from the screen that measured the
   * failure. It re-runs the trial afterwards, because a grant that changed
   * nothing and a grant that fixed it look identical until something listens.
   */
  const grant = async () => {
    setGranting(true)
    try {
      await invoke('health:retry', { connector: 'capture' })
    } catch {
      // The row already carries its own sentence; a failed retry repeats it.
    } finally {
      setGranting(false)
    }
    await run()
  }

  const run = async () => {
    setBusy(true)
    setFailure(null)
    setResult(null)
    try {
      setResult(await invoke('capture:essai', {}))
    } catch (error) {
      // The main process's own sentence — « une réunion est en cours »,
      // « module audio natif indisponible » — never a generic failure (DEC-26).
      setFailure(error instanceof Error ? error.message : 'essai impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-card bg-card mb-block rounded-sm border px-row py-inline">
      <div className="flex items-baseline gap-inline">
        <h3 className="text-strong min-w-0 flex-1 text-copy font-semibold">
          {busy ? 'À vous — parlez, ou lancez une vidéo' : 'Vérifier que tout est capté'}
        </h3>
        <Button
          variant={result === null ? 'primary' : 'bordered'}
          className="shrink-0"
          onClick={() => void run()}
          {...unavailable(busy, 'Essai en cours…')}
        >
          {busy ? 'À l’écoute…' : result === null ? `Essai de ${ESSAI_SECONDS} s` : 'Recommencer'}
        </Button>
      </div>

      <p className="text-muted measure mt-hair text-ui leading-relaxed">
        {busy
          ? 'Sillage écoute les deux côtés pendant vingt secondes. Rien n’est enregistré ni conservé.'
          : // No « avant le premier client »: it is true on first run and false
            // in Réglages, where a rep comes back after their headset changed.
            // The screen around it supplies the occasion; this says what it does.
            'Vingt secondes, pour savoir si votre micro et l’audio de votre ordinateur arrivent bien tous les deux — « connecté » veut dire qu’un périphérique s’est ouvert, pas qu’un son est arrivé.'}
      </p>

      {busy ? (
        <div className="mt-inline flex items-center gap-inline">
          {/*
            The meeting meter, on the trial's reserved id. Both channels,
            mirrored about a baseline — the rep above, the machine below —
            because « personne n’est entendu » and « le client n’est pas
            entendu » have opposite fixes (DEC-38).
          */}
          <LevelMeter meetingId={ESSAI_MEETING_ID} />
          <p className="text-muted text-meta" role="status">
            Dites une phrase, et jouez n’importe quel son sur votre ordinateur.
          </p>
        </div>
      ) : null}

      {failure ? (
        <p role="alert" className="text-danger measure mt-snug text-ui">
          {failure}
        </p>
      ) : null}

      {result ? (
        <div className="mt-inline">
          <p
            className={`measure text-ui ${
              result.rep.heard && result.far.heard ? 'text-body' : 'text-warn'
            }`}
          >
            {essaiSummary(result)}
          </p>
          {/*
            The same shape as step 2's rows — name, then the measured state on
            the right, then the sentence under both. Two screens that report a
            subsystem's state should not report it in two different orders.
          */}
          <ul className="mt-snug space-y-row">
            {essaiLines(result).map((line) => (
              <li key={line.channel}>
                <div className="flex items-baseline gap-inline">
                  <h4 className="text-strong min-w-0 flex-1 text-ui font-semibold">{line.title}</h4>
                  <span className="shrink-0">
                    <StateDot
                      tone={line.heard ? 'ok' : 'warn'}
                      label={line.heard ? 'entendu' : 'rien entendu'}
                    />
                  </span>
                </div>
                <p className="text-muted measure mt-0.5 text-ui leading-relaxed">{line.sentence}</p>
                {/*
                  **The remedy, on the row that just proved it is needed.**

                  The card offered *Recommencer* and nothing else — so the one
                  screen in the product that has just *established* that the far
                  end is dead was the one screen with nothing to press, and
                  running it again would fail identically. `health:retry` on
                  `capture` is the same call step 2's *Autoriser* makes: it asks
                  the OS, or opens the privacy pane when the OS has stopped
                  asking (`core/domain/capturePermission.ts`).
                */}
                {!line.heard ? (
                  <div className="mt-tight flex items-baseline gap-inline">
                    <Button
                      onClick={() => void grant()}
                      {...unavailable(granting, 'Vérification…')}
                    >
                      {granting ? 'Vérification…' : 'Autoriser'}
                    </Button>
                    {/* Only where there is somewhere to go: in Réglages the
                        rep is already on that screen, and a link back to it
                        would be a control that changes nothing (DEC-26). */}
                    {onReglages ? (
                      <Button variant="nav" onClick={onReglages}>
                        Réglages ›
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

