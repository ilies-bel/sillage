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
 * ## What the predicate can and cannot tell apart — stated, because it is a limit
 *
 * `isWrittenSentence` is an **allowlist over shapes**, which is the idiom this
 * repo already uses for a foreign payload (`detail` on a diagnostic). Three
 * conditions, each of which every one of the six written sentences meets and none
 * of the ten fragments does — asserted over all sixteen, in both directions, by
 * `healthSentence.test.ts`:
 *
 *   · it opens on an uppercase letter
 *   · it closes on `.`, `!`, `?` or `…`
 *   · it carries at least one character ASCII does not have
 *
 * The third is not decoration. Every user-facing string in this repo is French
 * with the typographic apostrophe U+2019 (`npm run check:french` enforces it), so
 * a sentence the product wrote carries `’`, `—`, `«` or an accent. A JavaScript
 * `Error`'s message does not.
 *
 * **What it stops measuring.** A foreign message that is capitalised, terminated
 * *and* non-ASCII passes as ours: Microsoft Graph's French-locale errors would,
 * if one ever reached these two connectors (today none does — Graph feeds
 * `calendar` and `mail`, which this window does not collect). Closing that hole
 * needs a field on `ConnectorHealth` saying who wrote the string — a `code`, or
 * `written: true` — and `core/contracts/health.ts` is coordinator-owned and was
 * not opened this round. Symmetrically, a sentence of ours that is pure ASCII
 * would be replaced by the table's; that direction is safe, and no literal in
 * the tree is in it — `healthSentence.test.ts` asserts both halves over every
 * `reason` the six producer files can emit, read out of their source.
 */
import type { ConnectorHealth } from '../../electron/core/contracts/health.ts'
import { aggregateStatus } from '../../electron/core/contracts/status.ts'

/**
 * The two the *window* collects. `llm` is a required connector and
 * `aggregateStatus` will rank it, but DEC-14 keeps it off this surface and the
 * window never puts it in front of the aggregate — see `Widget.tsx`.
 */
export type LiveConnector = 'capture' | 'transcribe'

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

/** Opens on a capital: every fragment in the tree opens lowercase. */
const OPENS = /^\p{Lu}/u
/** Closes on a terminal mark: a fragment stops, a sentence ends. */
const CLOSES = /[.!?…]$/u
/**
 * Carries a character ASCII does not — `’`, `—`, `«`, or an accent. Every
 * user-facing string in this repo is French with U+2019 (`check:french`); a raw
 * `Error.message` is not. See the header for what this does not catch.
 */
const FRENCH = /[^\u0000-\u007F]/u

/**
 * Is this `reason` a sentence the product wrote for a rep, or a fragment it
 * wrote for itself?
 *
 * Exported because the check that binds this asks it of every `reason` literal
 * in the six producer files, and a predicate a test cannot reach is a predicate
 * nothing holds to the tree.
 */
export const isWrittenSentence = (reason: string | null | undefined): boolean => {
  if (typeof reason !== 'string') return false
  const text = reason.trim()
  if (text === '') return false
  return OPENS.test(text) && CLOSES.test(text) && FRENCH.test(text)
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
