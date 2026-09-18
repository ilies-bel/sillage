import { useState } from 'react'
import {
  ESSAI_MEETING_ID,
  ESSAI_SECONDS,
  essaiLines,
  essaiSummary,
  type EssaiResult,
} from '../../../electron/core/contracts/essai.ts'
import type { CapturePermission } from '../../../electron/core/contracts/permissions.ts'
import { invoke, useInvoke } from '../../app/bridge.ts'
import { Button, StateDot, unavailable } from '../../ui/index.ts'
import { LevelMeter } from '../session/LevelMeter.tsx'

/**
 * Whether the row for this channel has a consent to fix — and whether this host
 * has anywhere to fix it.
 *
 * `EssaiLine.channel` is the two sides of the call; `CapturePermission.channel`
 * is the two OS permissions behind them. They line up one to one, and `both` is
 * both — the mapping is written out rather than inferred so that a row can never
 * offer the remedy for the *other* side of the call.
 */
const PERMISSION_CHANNEL = { rep: 'microphone', far: 'screen' } as const

const paneFixes = (consent: CapturePermission | null, channel: 'rep' | 'far'): boolean => {
  if (!consent || !consent.canOpenSettings) return false
  // `ready` is nothing to grant and `blocked` is a managed device: neither is
  // repaired by a pane, and `permissions.ts` says so in as many words.
  if (consent.state !== 'to-grant' && consent.state !== 'denied') return false
  return consent.channel === 'both' || consent.channel === PERMISSION_CHANNEL[channel]
}

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
   * **What consent this host actually has — because for one round this card
   * asked for none and offered the remedy anyway.**
   *
   * The row drew *Autoriser* on `!line.heard` and nothing else, calling
   * `health:retry('capture')`. On a machine where the permissions are granted —
   * which is *every* Windows machine, the primary platform (HR-2), where there
   * is no screen-recording permission to hold at all — that retry probes the
   * native module, finds `actionFor(status) === 'nothing'` for both channels,
   * calls no OS API whatever, republishes `ok`, and re-runs the identical twenty
   * seconds. A rep whose output is routed to a headset the tap cannot see, which
   * is the failure `essai.ts` names in the sentence directly above the button,
   * could press it for ever.
   *
   * That is the dead control DEC-26 forbids, and the product already has the
   * whole apparatus against it: `Orchestrator.#truthful` strips `retryable` from
   * a connector with no registered retry so no screen draws one, and
   * `contracts/permissions.ts` says outright that « a screen that offers
   * *Autoriser* on a refusal draws a control that can never do anything ». This
   * card consulted neither — it never read `capture:permission` at all.
   *
   * So it reads it, per channel, and offers the pane only where a pane is the
   * remedy. Where consent is not the problem the row carries its sentence and no
   * button: *Recommencer* at the top of the card is the honest re-run, after the
   * rep has changed something.
   */
  const permission = useInvoke('capture:permission', {})
  const consent: CapturePermission | null =
    permission.state.status === 'ready' ? permission.state.value : null
  /*
   * A pane that would not open is said out loud, exactly as the onboarding row
   * says it: `canOpenSettings` is measured before the press and whether the OS
   * took the URL is only known after.
   */
  const [paneRefused, setPaneRefused] = useState(false)

  /*
   * The pane, then the trial again. Re-measuring is the whole point — a grant
   * that changed nothing and a grant that fixed it look identical until
   * something listens.
   */
  const grant = async () => {
    setGranting(true)
    try {
      const { opened } = await invoke('capture:permission:open', {})
      setPaneRefused(!opened)
    } catch {
      setPaneRefused(true)
    } finally {
      setGranting(false)
      permission.reload()
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
    <section className="mb-gutter mt-gutter">
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
                <p className="text-muted measure mt-hair text-ui leading-relaxed">{line.sentence}</p>
                {/*
                  **The remedy, on the row that just proved it is needed — and
                  only where there is one.**

                  A silent channel has two causes and they take different
                  remedies: a permission this host is holding back, which the
                  privacy pane lifts, and a muted microphone or an output route
                  the tap cannot see, which nothing on this screen can touch. The
                  pane is offered for the first and withheld for the second,
                  because a control that cannot change the thing it names is the
                  dead end this whole card exists to remove, one level down.
                */}
                {/* An empty strip is not « no control »: it is a gap under the
                    sentence that reads as something failing to load. */}
                {!line.heard && (paneFixes(consent, line.channel) || onReglages) ? (
                  <div className="mt-tight flex items-baseline gap-inline">
                    {paneFixes(consent, line.channel) ? (
                      <Button
                        onClick={() => void grant()}
                        {...unavailable(granting, 'Ouverture…')}
                      >
                        {granting ? 'Ouverture…' : 'Ouvrir les réglages'}
                      </Button>
                    ) : null}
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
                {!line.heard && paneRefused && paneFixes(consent, line.channel) ? (
                  <p className="text-muted measure mt-hair text-ui leading-relaxed">
                    Les réglages de confidentialité ne se sont pas ouverts. Ouvrez-les vous-même :
                    l’autorisation de Sillage s’y trouve avec celles des autres applications.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

