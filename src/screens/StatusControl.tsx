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
 * Three things it deliberately does not do:
 *
 *   · **It does not list what is wrong.** It names the single worst required
 *     subsystem and hands the rep the click. The list is the thing DEC-32
 *     collapsed; putting it back in the header would undo the decision.
 *   · **It says nothing before it knows anything.** A flash of *Tout fonctionne*
 *     while the snapshot is still in flight is a claim the app has not yet
 *     earned, so the header holds the space empty instead.
 *   · **And it says nothing when the answer is good**, which is the same gesture
 *     one step further. *Tout fonctionne* was a filled pill in the header of
 *     every screen, permanently — 131.5 × 28.6 px at both smoke sizes, the third
 *     strongest thing on the home screen, above the live client call — and what
 *     it reported was that nothing had happened. Silence makes the degraded case
 *     the only thing that ever appears there, which is the case that matters:
 *     on the primary platform (HR-2), thirty seconds before a client joins.
 *     It does not weaken DEC-45 — what tells a rep that capture *works* is the
 *     meter during the call (DEC-38) and the dry run before it, never a badge.
 *
 * **The two silences are one rendering and two facts**, and `statusDisplay` keeps
 * them apart rather than collapsing both into `return null`: « we have not
 * measured anything yet » and « we measured, and nothing is wrong » look
 * identical to the rep and are different statements about the app, so the code
 * says which and the tests ask for each by name. Nothing is drawn either way —
 * a `because` that reached the DOM would be the pill again, one attribute down.
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

/** The two states that are worth a rep's attention, and therefore the only two drawn. */
type TroubledStatusState = Exclude<AppStatusState, 'ok'>

/** `ok` is absent on purpose: a healthy aggregate draws no dot, because it draws nothing. */
const TONE: Record<TroubledStatusState, StateDotProps['tone']> = {
  degraded: 'warn',
  down: 'down',
}

/**
 * What the header draws, and — when it draws nothing — *why* it draws nothing.
 *
 * The two silences are the whole reason this is a type rather than a boolean:
 * `unmeasured` is « the snapshot has not arrived, or the invoke failed », and
 * `well` is « it arrived and nothing required is in trouble ». Same empty
 * header, two different facts about the app, and a `return null` in two places
 * could not tell a test which one it was looking at.
 */
export type StatusDisplay =
  | { show: false; because: 'unmeasured' | 'well' }
  | { show: true; state: TroubledStatusState; worst: RequiredConnectorId }

/**
 * `null` means the snapshot is not in yet (or never came) — never that the app
 * is well. `aggregateStatus` reads a `Partial`, so an incomplete snapshot is
 * *nothing wrong* rather than a crash; this is the layer above that, which is
 * the one that must not turn « we have not looked » into a claim.
 */
export const statusDisplay = (snapshot: HealthSnapshot | null): StatusDisplay => {
  if (snapshot === null) return { show: false, because: 'unmeasured' }
  const status = aggregateStatus(snapshot)
  // `worst === null` under a non-`ok` state is unreachable through
  // `aggregateStatus` — it narrows the two together — and it is read as *well*
  // rather than drawn nameless: the control names one subsystem or it is absent.
  if (status.state === 'ok' || status.worst === null) return { show: false, because: 'well' }
  return { show: true, state: status.state, worst: status.worst }
}

/**
 * *Indisponible* and *à vérifier* are both invariable, which is why they were
 * picked: *Audio* is masculine and *Transcription* is feminine, and a label
 * built from an adjective would have to agree with a value read at runtime.
 *
 * There is no healthy branch any more: a label for a control that is not drawn
 * would be a string nothing can render, and *Tout fonctionne* is gone from the
 * product rather than merely unreachable.
 */
const label = (state: TroubledStatusState, worst: RequiredConnectorId): string =>
  state === 'down'
    ? `${CONNECTOR_LABEL[worst]} indisponible`
    : `${CONNECTOR_LABEL[worst]} à vérifier`

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

  const display = statusDisplay(health.state.status === 'ready' ? health.state.value : null)
  /*
   * Nothing, and nothing means nothing: no wrapper, no zero-height box holding a
   * margin, no reserved width. Measured on the shipped header at 1280×800 and
   * 960×600, identically at both — the right-hand group goes from three children
   * to two and loses exactly the pill's 131.5 px plus one `gap-inline` (359.1 →
   * 215.6), and the header keeps its shape: 82.3 → **81.6** px tall, the 0.7 px
   * being the chip's own border and padding hanging below the baseline its
   * neighbours sit on. Nothing in the layout was reserving space for this
   * control, so its absence collapses nothing.
   */
  if (!display.show) return null

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
     *
     * **`animate-rise-in`, because this arrives where nothing was.** While the
     * app is well the header is empty, so a degradation is an *insertion* — the
     * textbook change-blindness case, and the same argument `DayPane` makes for
     * the row an arming inserts. `riseIn` is `var(--motion) var(--ease-out)`:
     * 150 ms, opacity plus a 3 px translate, the entering curve at the entering
     * end, and it collapses to nothing under `prefers-reduced-motion` because
     * `--motion` does — no second rule to keep in step (`shot.mjs --motion`).
     * It plays once, on the mount: a `degraded` that worsens to `down` keeps its
     * box and changes its dot and its word, which is the pre-existing
     * behaviour and is not re-announced — replaying it would mean remounting the
     * control, and remounting takes the focus off it while a rep is on their way
     * to pressing it.
     */
    <Button
      variant="text"
      onClick={onReglages}
      className="bg-subtle border-subtle animate-rise-in inline-flex items-center gap-inline rounded-sm border px-snug py-hair"
    >
      {/* `text-inherit` so the label follows the button's own hover, rather
          than sitting at `text-muted` while the chevron beside it lifts. */}
      <StateDot
        tone={TONE[display.state]}
        label={label(display.state, display.worst)}
        className="text-inherit"
      />
      {/*
        The affordance, not a decoration: the control is a link into Réglages
        and has to look like one. Hidden from the accessible name so the button
        reads « Audio à vérifier » and not « Audio à vérifier › ».
      */}
      <span aria-hidden>›</span>
    </Button>
  )
}
