/**
 * The one general status (DEC-32). One control, in the header, and its
 * destination is *Réglages → Connecteurs*.
 *
 * It replaces the six-connector footer strip, which said six things at once
 * during a client call and was therefore read as noise. What moves it is settled
 * in `core/contracts/status.ts` and not here: only **capture, transcription and
 * analysis** — the subsystems without which a meeting cannot be recorded.
 * VerySwing, Outlook and the calendar keep publishing `ConnectorHealth` and keep
 * their inline reason and retry in Réglages (DEC-26 is untouched); they simply
 * never render as an app-level degradation.
 *
 * Two things it deliberately does not do:
 *
 *   · **It does not list what is wrong.** It names the single worst required
 *     subsystem and hands the rep the click. The list is the thing DEC-32
 *     collapsed; putting it back in the header would undo the decision.
 *   · **It says nothing before it knows anything.** A flash of *Tout fonctionne*
 *     while the snapshot is still in flight is a claim the app has not yet
 *     earned, so the header holds the space empty instead.
 *
 * Where the orange is matters and is not a choice made here: `StateDot` owns the
 * dot and its label together, so the colour is on the dot and the word beside it
 * is `--text-muted` at 5.09:1. A bare coloured dot is unconstructible.
 */
import type { HealthSnapshot } from '../../electron/core/contracts/health.ts'
import {
  aggregateStatus,
  type AppStatusState,
  type RequiredConnectorId,
} from '../../electron/core/contracts/status.ts'
import { useBroadcast, useInvoke } from '../app/bridge.ts'
import { Button, StateDot } from '../ui/index.ts'
import type { StateDotProps } from '../ui/index.ts'

/** French, and the rep's vocabulary rather than the module's. */
const CONNECTOR_LABEL: Record<RequiredConnectorId, string> = {
  capture: 'Audio',
  transcribe: 'Transcription',
  llm: 'Analyse',
}

const TONE: Record<AppStatusState, StateDotProps['tone']> = {
  ok: 'ok',
  degraded: 'warn',
  down: 'down',
}

/**
 * *Indisponible* and *à vérifier* are both invariable, which is why they were
 * picked: *Audio* is masculine and *Transcription* is feminine, and a label
 * built from an adjective would have to agree with a value read at runtime.
 */
const label = (state: AppStatusState, worst: RequiredConnectorId | null): string => {
  if (state === 'ok' || worst === null) return 'Tout fonctionne'
  return state === 'down'
    ? `${CONNECTOR_LABEL[worst]} indisponible`
    : `${CONNECTOR_LABEL[worst]} à vérifier`
}

interface StatusControlProps {
  /** The one destination (DEC-32). There is no second thing this can open. */
  onReglages: () => void
}

export function StatusControl({ onReglages }: StatusControlProps) {
  const health = useInvoke('health:snapshot', {})

  useBroadcast('health:changed', (payload) => {
    if (health.state.status !== 'ready') return
    health.set({ ...health.state.value, [payload.connector]: payload.health })
  })

  if (health.state.status !== 'ready') return null

  const snapshot: HealthSnapshot = health.state.value
  const status = aggregateStatus(snapshot)

  return (
    /*
     * A chip, not a bare line of text (`5.1 Aujourd'hui — Canonical`). The
     * control is the one thing in this header a rep is meant to find without
     * looking for it, and an unbounded dot-plus-word beside two other words was
     * not findable.
     *
     * The design tints the chip by state — a green wash when everything is up.
     * That is not built here, and deliberately: VISION.md §6 has no token for a
     * state-tinted surface, the ratios of one have not been measured, and
     * `check-tokens.mjs` would reject the hex. `StateDot` already carries the
     * state in the one place the palette approves for it, so the container
     * stays neutral and the dot does the work.
     */
    <Button
      variant="text"
      onClick={onReglages}
      className="bg-subtle border-subtle inline-flex items-center gap-tight rounded-sm border px-2 py-1"
    >
      {/* `text-inherit` so the label follows the button's own hover, rather
          than sitting at `text-muted` while the chevron beside it lifts. */}
      <StateDot
        tone={TONE[status.state]}
        label={label(status.state, status.worst)}
        className="text-inherit"
      />
      {/*
        The affordance, not a decoration: the control is a link into Réglages
        and has to look like one. Hidden from the accessible name so the button
        reads « Tout fonctionne » and not « Tout fonctionne › ».
      */}
      <span aria-hidden>›</span>
    </Button>
  )
}
