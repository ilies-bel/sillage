/**
 * **What became of this meeting, on the screen the rep is standing on.**
 *
 * `EnhancementNotice` next door exists « so that nothing is the answer to
 * nothing », and it answers for exactly one question: is the compte-rendu being
 * written. That covers `ended` and `extracting`. It does not cover the states
 * where the machine has stopped for good, and three of those drew a screen with
 * no control and no sentence anywhere on it.
 *
 * The worst of the three, and the reason this file exists:
 *
 *     session:changed   recording → aborted
 *                       reason « aucun fournisseur de transcription »
 *     boutons de l’écran de séance:
 *       ‹ Calendrier · Prise de besoin · Libre · Trame · Transcription · Masquer
 *     diagnostics:recent: 2 événements info, rien sur l’abandon
 *     la seule mention dans le produit: « Transcription indisponible › »,
 *       sur le contrôle d’état de l’écran *Calendrier*
 *
 * The rep presses *Démarrer une réunion*, lands here, the recording dies under
 * them, and this screen says nothing at all — they have to navigate back to the
 * calendar to discover that anything happened. On the primary platform (HR-2)
 * that is reachable every time WASAPI loopback fails to open; it is not a
 * developer's path. `Session.tsx` drew a header button for `recording`, `idle`,
 * `armed` and `awaiting_confirmation`, and `null` for everything else.
 *
 * ## Where the cause comes from, and why it is not a guess
 *
 * `session:changed` carries `{ meetingId, state }` and no reason, and the
 * transition's own `reason` lives in the event log where no renderer can reach
 * it. But **every** site that aborts a meeting writes the cause into connector
 * health first, on the line above the dispatch:
 *
 *   · `Orchestrator.#openDevices`  → `transcribe` down, « aucun fournisseur de
 *     transcription disponible », then `abort`
 *   · `Orchestrator.#strandedStart` → `capture` down, the thrown message, then
 *     `abort`
 *   · `startRecording`'s own catch → `capture` down, « capture indisponible —
 *     … », then `abort`
 *
 * So the sentence here is the same producer's, read through `aggregateStatus` —
 * the one function DEC-32 allows to collapse the required connectors — and
 * rendered verbatim, never composed. When health says nothing (a meeting
 * abandoned before this process booted, read back out of *Historique*) the
 * notice states the case without inventing a cause and still offers the route.
 *
 * ## Why a route to Réglages and not a *Réessayer*
 *
 * `aborted` is terminal: the state table accepts nothing from it, so a button
 * that re-armed *this* meeting would be the dead control DEC-26 forbids, and a
 * *Réessayer* over a write is what CLAUDE.md refuses outright. What can still
 * change is the subsystem that failed, and that has a screen. The button goes to
 * the pane where the named connector is configured — which is what the calendar's
 * own status control does with the same aggregate, so the two cannot disagree
 * about where the fix is.
 */
import { useState } from 'react'
import type { MeetingState } from '../../../electron/core/contracts/meeting.ts'
import { STATE_REASON } from '../../../electron/core/contracts/meeting.ts'
import type { HealthSnapshot } from '../../../electron/core/contracts/health.ts'
import { aggregateStatus, type RequiredConnectorId } from '../../../electron/core/contracts/status.ts'
import { useBroadcast, useInvoke } from '../../app/bridge.ts'
import { Button } from '../../ui/index.ts'
import { SECTION_FOR_CONNECTOR, type SectionId } from '../Reglages.tsx'

/**
 * The states that reach this screen with no control of their own and nothing
 * else drawing for them.
 *
 * `idle` and `armed` have *Démarrer*, `recording` has *Terminer* and the pill,
 * `awaiting_confirmation` has *Relire et valider*, and `ended`/`extracting` are
 * `EnhancementNotice`'s — it is the whole of what a rep is waiting on there, and
 * two strips saying different halves of one wait is worse than one.
 *
 * Declared as a table over `MeetingState` rather than an `if`, so a tenth state
 * added to the machine does not compile until somebody has decided which of the
 * two answers it takes.
 */
const SPEAKS_FOR: Record<MeetingState, boolean> = {
  idle: false,
  armed: false,
  recording: false,
  ended: false,
  extracting: false,
  awaiting_confirmation: false,
  pushing: true,
  done: true,
  aborted: true,
}

/**
 * What this screen adds to the state's own line, and only where the line alone
 * would leave a rep guessing.
 *
 * `STATE_REASON` is the product's one table of « what is this meeting doing, in
 * one French line » and it is read verbatim — `reviewAvailability` and
 * `MeetingSession.dispatch` are the other two readers, and a third wording of
 * `aborted` would be a third thing for a rep to reconcile. « Réunion
 * abandonnée. » says the state; it does not say that nothing was captured, which
 * is the part the rep is about to act on.
 */
const CONSEQUENCE: Partial<Record<MeetingState, string>> = {
  aborted: 'L’enregistrement s’est arrêté et il n’y aura pas de compte-rendu.',
  pushing: 'Vos notes et le compte-rendu sont enregistrés.',
  done: 'Le compte-rendu a été envoyé ; il n’y a rien d’autre à faire ici.',
}

interface OutcomeNoticeProps {
  /** `null` before the first read lands — nothing to say about nothing. */
  state: MeetingState | null
  /** Réglages, on the pane where the named connector lives. */
  onReglages?: (section?: SectionId) => void
}

export function OutcomeNotice({ state, onReglages }: OutcomeNoticeProps) {
  /*
   * Read on mount and kept current on the broadcast, for `EnhancementNotice`'s
   * reasons exactly: the read answers for a meeting opened out of *Historique*
   * and the broadcast answers for one that dies while this screen is open.
   *
   * **The edge is held separately from the read, and the reason is the whole
   * sequence this notice exists for.** Every other screen writes the broadcast
   * back into the snapshot — `if (snapshot) health.set({ …snapshot, […]: … })` —
   * which silently drops a `health:changed` that lands before the first read
   * has. Here that gap is exactly where the abort lives: the orchestrator
   * publishes the connector *and then* dispatches, both synchronously, and this
   * component is not even mounted until `meeting:get` has answered. Driven in
   * `session-outcome.test.tsx`: a recording that dies moments after the screen
   * opens reached « Réunion abandonnée. » with no cause on it at all, because
   * the one broadcast carrying the cause arrived while the snapshot was still
   * null and was thrown away.
   *
   * So the edge is kept, and it wins: it was published after the read was
   * issued, so it is the newer fact whichever of the two the renderer sees first.
   */
  const health = useInvoke('health:snapshot', {})
  const [edges, setEdges] = useState<Partial<HealthSnapshot>>({})
  useBroadcast('health:changed', (payload) => {
    setEdges((previous) => ({ ...previous, [payload.connector]: payload.health }))
  })
  const read: HealthSnapshot | null = health.state.status === 'ready' ? health.state.value : null
  const snapshot: Partial<HealthSnapshot> | null =
    read === null && Object.keys(edges).length === 0 ? null : { ...read, ...edges }

  if (state === null || !SPEAKS_FOR[state]) return null

  /*
   * The cause, and only for an abort. A `done` meeting on a machine whose model
   * has since been unconfigured is not a meeting with a problem, and hanging the
   * general status off it would make every past call look broken.
   */
  const status = state === 'aborted' && snapshot ? aggregateStatus(snapshot) : null
  const cause = status && status.state !== 'ok' ? status.reason : null
  const worst: RequiredConnectorId | null = status && status.state !== 'ok' ? status.worst : null

  return (
    <div
      /*
        `alert` and not `status`, which is the one place this differs from the
        strip beside it. `EnhancementNotice` reports a wait the rep chose to
        start; this reports the machine stopping under them, on the screen they
        are looking at, while they believe a client is being recorded. It is the
        one thing here that has to interrupt.
      */
      role="alert"
      className="border-subtle bg-card-soft flex shrink-0 items-center gap-inline border-b px-gutter py-snug"
    >
      <p className="text-body min-w-0 flex-1 measure text-ui">
        <span className={state === 'aborted' ? 'text-danger font-semibold' : undefined}>
          {STATE_REASON[state]}
        </span>{' '}
        <span className="text-muted">
          {CONSEQUENCE[state]}
          {cause ? ` ${cause}` : ''}
        </span>
      </p>

      {/*
        The one control, and only where it leads to the thing that failed. No
        connector named means nothing to configure, and a *Réglages* that landed
        on a pane chosen at random is a button whose destination the rep cannot
        predict — which is how the header word that became `LiveAside`'s switch
        was wrong for three rounds.
      */}
      {worst !== null && onReglages ? (
        <div className="ml-auto shrink-0">
          <Button variant="primary" onClick={() => onReglages(SECTION_FOR_CONNECTOR[worst])}>
            Ouvrir les réglages
          </Button>
        </div>
      ) : null}
    </div>
  )
}
