/**
 * **The one sentence this window says when the product is failing — and the
 * guarantee that a rep wrote it, not an orchestrator.**
 *
 * `Widget.tsx` renders `aggregateStatus(connectors).reason` into the card's
 * health slot. `reason` is a free `string` on `ConnectorHealth` and it is
 * composed at **sixteen** sites across `modules/capture`, `modules/transcribe`,
 * `app/main.ts`, `app/session/Orchestrator.ts`, `app/session/Recording.ts`,
 * `core/domain/capturePermission.ts` and `core/contracts/essai.ts` — counted by
 * `healthSentence.test.ts`, which scans for them rather than trusting this
 * sentence. They are not one grade of sentence. **Six** are written for a rep:
 * they open on a capital, they name the side, they end on a remedy and a full
 * stop:
 *
 *     « La sortie audio de l’ordinateur a changé pendant l’appel — le son du
 *       client peut ne plus être capté. Terminez et redémarrez l’enregistrement
 *       pour le reprendre. »
 *
 * The other **ten** are a state machine talking to itself, and until this file
 * they reached a rep's eyes unchanged, over a client call, on a window that is
 * over everything the rep is sharing:
 *
 *     « aucun fournisseur de transcription disponible »    Orchestrator.ts:482
 *     « capture indisponible — ${err.message} »            Orchestrator.ts:731
 *     « micro indisponible — ${message(error)} »           capture/index.ts:647
 *     « transcription du micro dégradée — ${message} »     transcribe/index.ts:406
 *     « nouvelle tentative échouée — ${err.message} »      Orchestrator.ts:1156
 *
 * Lowercase, unterminated, no remedy, and five of the ten ending in a JS
 * `Error`'s own words — one of them, `Recording.ts:176`, *being* one, forwarded
 * with no prefix of ours at all. `Recording.ts` already classifies the same string as
 * `origin: 'foreign'` when it writes it to diagnostics — the product has decided
 * what that string is; it had simply never decided what to do with it here.
 *
 * ## Why this is not `check-reasons.mjs`'s job
 *
 * That check is real and it passes: it fails a `reason` that is *only* a remote's
 * words, so every literal above opens with something we wrote. « Opens with our
 * words » is not « is a sentence a rep can act on », and the gap between the two
 * is the whole of this defect. Tightening `check-reasons` to demand a sentence
 * would be the right fix at the producer — and it is a `checks`-lane change over
 * forty-nine literals in six modules, which is not this story.
 *
 * ## Why the mapping is here and not in `core/`
 *
 * Three reasons, in order of weight.
 *
 * 1. **The import rule leaves nowhere else that is reachable.** `src/*` imports
 *    `core/contracts/` and nothing else. A table in `core/domain/` would have to
 *    travel over a new IPC channel to get here — a second source of truth for a
 *    derivation over a snapshot the renderer already holds, free to disagree
 *    with it. That is the argument `status.ts`'s own header makes for keeping
 *    `aggregateStatus` in `contracts/`, and it applies unchanged.
 * 2. **`core/contracts/*` is shared and was not opened this round.** A story that
 *    needs a contract says so before the fan-out; this one did not, so the
 *    behaviour ships as one exported function in the lane's own file.
 * 3. **The substitution is a property of this surface, not of the product.** The
 *    card is 340 px wide and two lines deep, drawn over a live call.
 *    *Réglages → Requis* renders the same `reason` at full width beside a
 *    *Réessayer* and a timestamp, where « micro indisponible — Error: … » is
 *    diagnostic information a rep can copy into a ticket. Hoisting this table
 *    into `core/` would impose the widget's 340 px on every reader of health.
 *
 * ## What the predicate can and cannot tell apart — and where it lives now
 *
 * `isWrittenSentence` is an allowlist over shapes and it is **no longer in this
 * file**: it moved to `core/contracts/health.ts`, where its three conditions and
 * their limits are argued. It is re-exported below so this file's callers and
 * its corpus are unchanged.
 *
 * It moved because of where it was. The renderer may import `core/contracts/`
 * only, so nothing under `src/` could drive a producer in `core/domain/`
 * through the predicate — and the corpus in `healthSentence.test.ts` therefore
 * hand-wrote samples of what it believed `capturePermission.ts` says. All three
 * were fiction, and underneath them the shipped `degraded` sentences opened on
 * a lowercase channel name and were being replaced, twelve status pairs of
 * them, on the state DEC-32 reserves for « one channel is missing » — the case
 * whose whole point is that the sentence names which side. The table stays
 * here; the predicate belongs to the type.
 */
import { isWrittenSentence, type ConnectorHealth } from '../../electron/core/contracts/health.ts'
import { aggregateStatus } from '../../electron/core/contracts/status.ts'

/**
 * The two the *window* collects. `llm` is a required connector and
 * `aggregateStatus` will rank it, but DEC-14 keeps it off this surface and the
 * window never puts it in front of the aggregate — see `Widget.tsx`.
 */
export type LiveConnector = 'capture' | 'transcribe'

/**
 * Re-exported, not redefined. The predicate moved to `core/contracts/health.ts`
 * so a test could drive a `core/domain/` producer through it — the renderer may
 * import `core/contracts/` only, and that rule is why this file's corpus had to
 * hand-write samples of sentences the product could not emit. The table below
 * stays here, because it *is* a property of a 340px card.
 */
export { isWrittenSentence }

/** The two non-`ok` states a `ConnectorHealth` can be in. */
export type TroubledState = 'degraded' | 'down'

export interface HealthLine {
  /** What the slot draws. Always a sentence. */
  text: string
  /**
   * Who wrote it. `'connector'` is the producer's own sentence, rendered
   * verbatim because it names the *channel* — « Rien n'arrive depuis le micro »
   * — which nothing derivable from `AppStatus` can. `'widget'` is this file's,
   * substituted for a fragment.
   */
  written: 'connector' | 'widget'
}

/**
 * **What this window says when the producer did not say it in French sentences.**
 *
 * Four cells, one per `(connector, state)`, and the record is exhaustive at
 * compile time — a third state on `ConnectorHealth` does not build until
 * somebody has written what the widget says about it.
 *
 * Each names the subsystem and a remedy a rep can reach from this card:
 * *Ouvrir Sillage* is a control 40 px below the slot.
 *
 * **What they cannot name is the channel.** « Une partie du son » is as precise
 * as this gets, where the producer's own sentence says « depuis le micro » or
 * « depuis le son du client ». `AppStatus` carries a connector and a state and
 * no channel, so this is the floor, not a choice — and it is why the producer's
 * sentence is passed through whenever it is one rather than always replaced.
 */
export const WIDGET_SENTENCES: Record<LiveConnector, Record<TroubledState, string>> = {
  capture: {
    degraded:
      'Le son de l’appel n’est plus capté normalement — une partie de la réunion ' +
      'peut manquer au compte-rendu. Ouvrez Sillage pour le détail.',
    down:
      'Le son de l’appel ne parvient plus à Sillage — plus rien n’est enregistré. ' +
      'Ouvrez Sillage pour voir pourquoi.',
  },
  transcribe: {
    degraded:
      'La transcription de l’appel est dégradée — une partie de ce qui se dit peut ' +
      'manquer au compte-rendu. Ouvrez Sillage pour le détail.',
    down:
      'Plus aucun moteur de transcription ne répond — le compte-rendu ne pourra pas ' +
      'être écrit. Ouvrez Sillage pour en choisir un.',
  },
}

/**
 * The health slot's line, from the two connectors the window holds — or `null`
 * when there is nothing to say.
 *
 * `aggregateStatus` decides *which* connector speaks: it is the repo's one
 * ranking of these states and round 23 put it here for that reason. This decides
 * *how* it speaks, which is the half that was left.
 *
 * It takes the connector map rather than an `AppStatus` on purpose: the aggregate
 * can only name a key it was handed, so passing the window's own two makes
 * « every state this slot can hold » total by construction, with no row for a
 * connector this surface does not collect.
 */
export const healthLine = (
  connectors: Partial<Record<LiveConnector, ConnectorHealth>>,
): HealthLine | null => {
  const status = aggregateStatus(connectors)
  if (status.state === 'ok' || status.worst === null) return null
  /*
   * A narrowing, and an honest answer rather than an unreachable one: the
   * aggregate ranks all three required connectors, this window hands it two, and
   * a window that does not collect `llm` has nothing to say about it. If a later
   * round puts a third connector in front of the aggregate here, the slot goes
   * quiet rather than printing a string nobody wrote — and `healthSentence.test`
   * says so out loud.
   */
  if (status.worst !== 'capture' && status.worst !== 'transcribe') return null
  const reason = status.reason
  if (reason !== null && isWrittenSentence(reason)) {
    return { text: reason.trim(), written: 'connector' }
  }
  return { text: WIDGET_SENTENCES[status.worst][status.state], written: 'widget' }
}

/**
 * **The short form, for the one element that is always on screen.**
 *
 * `healthLine` above is what the *panel* draws, and the panel is mounted by a
 * press on the pill. `Widget.tsx` said so in as many words beside that slot —
 * « a rep who never opens the panel is told nothing, sighted or not. That is a
 * larger change — the pill would have to carry a mark ». This is that mark's
 * half of it. **Marked closed here rather than left standing in the present
 * tense over there.**
 *
 * It is a *phrase* and never a sentence, because it is read out as the tail of
 * one: « Enregistrement en cours — son de l’appel dégradé ». Lowercase, no
 * terminal mark, no remedy — the remedy is the panel, one press away, and a
 * pill that recited a two-line remedy every time a screen reader passed over it
 * would be the interruption DEC-49 exists to prevent.
 *
 * **And it never carries the producer's own sentence.** `healthLine` passes
 * one through when it is written for a rep, which is right for a 340px card and
 * wrong here: those sentences run to two lines and end on « Ouvrez Sillage »,
 * and this is the element a rep hears on the way to every other control on the
 * pill. Four cells, exhaustive at compile time, and they say which side —
 * which is the whole reason a mark on the pill beats no mark at all.
 */
export const WIDGET_MARKS: Record<LiveConnector, Record<TroubledState, string>> = {
  capture: {
    degraded: 'son de l’appel dégradé',
    down: 'son de l’appel interrompu',
  },
  transcribe: {
    degraded: 'transcription dégradée',
    down: 'transcription interrompue',
  },
}

export interface HealthMark {
  /** The tail of the pill's spoken name. A phrase, never a sentence. */
  short: string
  /** Which side, so a caller can say it without re-deriving it. */
  connector: LiveConnector
  state: TroubledState
}

/**
 * The pill's mark, from the two connectors the window holds — or `null` when
 * there is nothing wrong.
 *
 * Deliberately the same ranking as `healthLine`: `aggregateStatus` is the
 * repo's one ordering of these states, so the pill and the panel are never
 * marking different channels about the same call. The two functions differ in
 * *register*, not in what they are about — which is why this reads the same
 * narrowing and returns `null` in the same place.
 */
export const healthMark = (
  connectors: Partial<Record<LiveConnector, ConnectorHealth>>,
): HealthMark | null => {
  const status = aggregateStatus(connectors)
  if (status.state === 'ok' || status.worst === null) return null
  if (status.worst !== 'capture' && status.worst !== 'transcribe') return null
  return {
    short: WIDGET_MARKS[status.worst][status.state],
    connector: status.worst,
    state: status.state,
  }
}
