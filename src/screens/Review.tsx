/**
 * *Revue* — the review gate. The only human confirmation in the product (DEC-4).
 *
 *   ┌ Compte-rendu ───────────────┬ Prêt à envoyer ──────────────┐
 *   │ the document, editable      │ Client   [Acme SA]  ⚠ faible │
 *   │                             │ Besoin   …        [source ▸] │
 *   │                             │ …                            │
 *   │                             │ ── Email de relance ──       │
 *   │                             │ ☑ tâche ☑ oppor. ☑ brouillon │
 *   │                             │              [ Valider ]     │
 *   └─────────────────────────────┴──────────────────────────────┘
 *
 * Three rules this screen cannot get wrong:
 *
 * **DEC-23 — nothing surfaces while the meeting is `recording`.** Not enforced
 * by a condition here. `review:get` answers with a closed union that carries no
 * panel at all, so there is no field, no count and no badge in this component's
 * hands to leak. `ClosedGate` below is the whole of what exists in that state.
 *
 * **DEC-21 — `⚠ faible` is measured.** Every marker on this screen is
 * `field.confidence`, which the main process reads off the `VerificationReport`
 * after checking the cited quote occurs in the stored transcript. Nothing here
 * computes a confidence and nothing here receives one from a model.
 *
 * **DEC-20 / DEC-4 — three intents, one button.** Each row is uncheckable and
 * the unchecked ids are simply absent from what *Valider* sends; the main
 * process records them rather than inferring them from a missing row. There is
 * exactly one submit control on this screen and there is no second prompt.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ReviewEdits,
  ReviewField,
  ReviewIntent,
  ReviewPanel,
} from '../../electron/core/contracts/review.ts'
import type { MeetingState } from '../../electron/core/contracts/meeting.ts'
import type { RecipeId } from '../../electron/core/contracts/recipes.ts'
import { recipeById } from '../../electron/core/contracts/recipes.ts'
import type { ConnectorHealth, ConnectorId } from '../../electron/core/contracts/health.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { scrollElementBy, scrollElementTo } from '../lib/scroll.ts'
import { formatOffset } from '../app/format.ts'
import {
  Button,
  Centered,
  Chip,
  CopyButton,
  List,
  OverflowMenu,
  PageTurn,
  SectionHeader,
  Segmented,
  unavailable,
} from '../ui/index.ts'
import { copyText } from '../lib/clipboard.ts'
import { scrollToCenter, scrollToTop } from '../lib/scroll.ts'
import { useShortcuts } from '../app/shortcuts.ts'
import { cn } from '../lib/utils.ts'
import {
  CompteRenduDocument,
  CompteRenduMarkersNote,
} from './session/CompteRenduDocument.tsx'
import { AskPanel } from './session/AskPanel.tsx'
import { TranscriptReader, type TranscriptFocus } from './review/TranscriptReader.tsx'
import { RecipeSwitch } from './review/RecipeSwitch.tsx'

/** The one thing a rep must notice without reading (DEC-21). */
const FAIBLE = '⚠ faible'

/**
 * **What the rep has typed at the gate, held across a navigation.**
 *
 * `edits` is component state, so every way off this screen threw it away
 * silently: `Échap` — which is one of exactly two shortcuts deliberately allowed
 * while typing, on the one screen in the product with a fifty-six-line textarea
 * — `Ctrl/⌘ H`, `Ctrl/⌘ ,`, and the « ‹ Calendrier » link. A rep who corrected
 * the objection, glanced at the calendar and came back found the model's
 * sentence again, with nothing having said the correction was gone. There is no
 * warning to add here that is better than not losing it.
 *
 * A module-level map rather than a store write, deliberately: these are *drafts*
 * of a payload, not a confirmed anything (DEC-4), and persisting them would mean
 * a correction typed on Tuesday reappearing on Thursday over a compte-rendu that
 * has since been regenerated. It lives as long as the window, which is exactly
 * as long as the rep's train of thought, and `confirm` clears it — the gate is
 * refused after a confirmation anyway, so a leftover draft would outlive the
 * screen that could show it.
 */
const PENDING_EDITS = new Map<string, ReviewEdits>()

/** The two scrolling columns the guard measures. */
type Column = 'document' | 'rail'

/**
 * How much a column may shrink before what was covered stops counting.
 *
 * Two lines of the decision footer, which reflows on its own as the button
 * arrives — see the note beside it in `read`.
 */
const SHRINK_SLACK = 64

/**
 * How much the *content* of a column may grow before what was covered stops
 * counting.
 *
 * The mirror of `SHRINK_SLACK`: that one notices the window getting smaller,
 * this one notices the document getting bigger, and both mean the same thing —
 * there is more below the fold than there was when the rep read it.
 *
 * A hundred, because *Lecture* and *Modifier* are one view sixty-eight pixels
 * of textarea chrome apart (see `viewOf`), and charging a second traversal for
 * that is the behaviour the coverage set exists to prevent. Anything bigger is
 * content that was not on screen: the case this was written for grew by a
 * thousand, when a « Chargement… » placeholder that fits a 1280×800 column was
 * replaced by the transcript it was standing in for.
 */
const GROWTH_SLACK = 100

/**
 * **How much of a column is what ships.**
 *
 * The guard's promise is that everything leaving the machine has been shown, and
 * one thing in the document column leaves nothing: *Demander*'s answer, which is
 * a read over the record (DEC-25) that writes nothing and confirms nothing. It
 * is still *in* the column — it belongs under the document it is about — so the
 * subtree says so with `data-unmeasured` and the measurement stops where it
 * starts.
 *
 * **And the unmeasured part is not always last, which is what this had to
 * learn.** It took the *offset* of the first marked subtree, which is right for
 * *Demander* — a pane under the document — and wrong for the rail, where
 * `[source ▸]` opens a panel **inline, inside the row it belongs to**. So the
 * rail had no marked subtree at all, and opening five sources — which is the
 * gesture DEC-21 exists to invite — grew its content past `GROWTH_SLACK` and
 * took *Valider* off the screen:
 *
 *     baseline: 7 page turns -> armed
 *       after opening source #4: armed=false  ["Remonter dans ce qui part"]
 *     after closing all five:    armed=false  (the screen is pixel-identical)
 *     re-arming cost: 2 page turns at 1280x800, 5 at 960x600
 *
 * That is the third instance of one shape — *Demander* inside the measurement,
 * then the transcript as a measured view, now the inline source — and all three
 * are the same sentence: **the guard measures what ships, and evidence does not
 * ship.** A provenance panel is the transcript by another route; the rep
 * pressed it, it appeared under their pointer, and it leaves the machine no more
 * than the reader does.
 *
 * So the height is the content **minus** every marked subtree, wherever they
 * sit. Subtracting rather than truncating keeps the arithmetic honest for the
 * scroll range too: an expansion in the middle pushes the rest down by exactly
 * what is subtracted, so a column covered before it opened is still covered.
 *
 * Measured from the rects rather than from `offsetTop`: `offsetTop` is relative
 * to the nearest *positioned* ancestor, which on this screen is not the
 * scroller, so it would answer a number from another coordinate system.
 */
const shippedHeight = (el: HTMLElement): number => {
  let height = el.scrollHeight
  for (const part of el.querySelectorAll<HTMLElement>('[data-unmeasured]')) {
    // A nested mark would be counted twice, and the outer one already covers it.
    if (part.parentElement?.closest('[data-unmeasured]')) continue
    height -= part.getBoundingClientRect().height
  }
  // A subtree with no box yet (a first paint, a hidden pane) measures zero, and
  // a column whose shipped part is « nothing » would arm on an empty read.
  return height > 0 ? height : el.scrollHeight
}

/** A view that has been shown end to end: the box, and what was in it. */
interface Covered {
  /** The narrowest box it has been covered at. */
  client: number
  /** The tallest content it has been covered at. */
  content: number
}

/**
 * How long the *Ce qui sera créé* rows lag the field being typed into.
 *
 * Short enough that the rep never sees the old account name while looking at
 * the new one, long enough that a held key is one round trip and not thirty.
 */
const PREVIEW_DEBOUNCE_MS = 150

interface ReviewProps {
  meetingId: string
  onBack: () => void
  /** Called once the confirmation has been accepted. One gesture, no second prompt. */
  onConfirmed?: () => void
}

/** Which `ReviewEdits` key each form row writes into. */
const EDIT_KEY: Record<ReviewField['key'], keyof ReviewEdits> = {
  taskName: 'taskName',
  account: 'accountName',
  besoin: 'besoin',
  profils: 'profils',
  modeCollaboration: 'modeCollaboration',
  tjm: 'tjm',
  dateDemarrage: 'dateDemarrage',
  dureeMission: 'dureeMission',
  contexteTechnique: 'contexteTechnique',
  objections: 'objections',
  prochainesEtapes: 'prochainesEtapes',
}

/** Rows whose value is prose rather than a word. */
const MULTILINE = new Set<ReviewField['key']>([
  'besoin',
  'profils',
  'contexteTechnique',
  'objections',
  'prochainesEtapes',
])

/**
 * What an empty row says, as a `placeholder` and never as a value.
 *
 * The account used to arrive pre-filled with « Client à confirmer » — a phrase
 * that looked like an answer, sat in a box that looked filled, and was written
 * into `meetings.client_name` the moment the extraction landed. Grey hint text
 * in an empty field is the same information without any of that: it cannot be
 * confirmed by a rep skimming, it cannot be submitted, and it cannot be stored.
 *
 * The interpretive rows have none. An empty *Besoin* means the model found
 * nothing to say about the need, and a hint there would be a prompt to invent
 * one — which is the failure DEC-21 exists to prevent, one field at a time.
 */
const PLACEHOLDER: Partial<Record<ReviewField['key'], string>> = {
  taskName: 'Objet de la réunion — requis par VerySwing',
  /*
   * States the fact, and asks for nothing.
   *
   * It read « — saisissez-le » and that was an instruction the app cannot keep:
   * typing a company name here resolves no account, so the rep spends a
   * keystroke and `accountId` is still null — the opportunity stays undraftable
   * either way (DEC-20), and the task ships with or without it. The one field
   * that really is required says so on the line above; a second row wearing the
   * same urgency teaches the rep to read past both.
   *
   * Blank is a resting state. « non résolu » is also exactly what the
   * compte-rendu prints for it, so the two surfaces agree.
   */
  account: 'Client non résolu',
}

export function Review({ meetingId, onBack, onConfirmed }: ReviewProps) {
  const loaded = useInvoke('review:get', { meetingId })
  /*
   * Derived here rather than beside its first use, because the arming guard is
   * built above the form and keys on what this last brought in — see `sent`.
   */
  const panel: ReviewPanel | null =
    loaded.state.status === 'ready' && loaded.state.value.open ? loaded.state.value.panel : null
  const [edits, setEdits] = useState<ReviewEdits | null>(null)
  const [checked, setChecked] = useState<string[] | null>(null)
  /*
   * What is about to be sent, as one string. The arming guard keys its coverage
   * set on it (see `read` below) and a set of ids is compared by value rather
   * than by array identity: `setChecked` runs on every render that recomputes
   * the possible intents, and disarming the guard because a `useMemo` missed
   * would be a page turn a rep is asked for and cannot explain.
   */
  const payload = useMemo(() => [...(checked ?? [])].sort().join(','), [checked])

  /*
   * **What the main process last sent, as one string.**
   *
   * The coverage key was `mode` and the checked set, and neither describes what
   * is *in* the column. The panel is re-read on `session:changed` — deliberately;
   * the gate follows the machine — so a reload that brought different fields or
   * different intents would have landed under a latch still saying the column
   * had been shown. Forced through a harness intercept: the rail went from 1023
   * to 1405 pixels, 349 below the fold, with *Valider* armed.
   *
   * Taken from the **panel**, never from `edits` or from the DOM. The rep's own
   * typing changes what the column contains and must not disarm anything — that
   * is the latch's whole reason — and only text they did not write is new to
   * them. `panel.edits.compteRendu` is the server's original, which is why it is
   * read here rather than the live copy the rep edits in « Modifier ».
   */
  const sent = useMemo(() => {
    if (!panel) return ''
    const fields = panel.fields.map((f) => `${f.key}:${f.confidence}:${f.span ? 1 : 0}`).join('|')
    const intents = panel.intents.map((i) => `${i.id}:${i.available}:${i.reason ?? ''}`).join('|')
    const filled = Object.values(panel.edits)
      .map((v) => (typeof v === 'string' ? v.length : 0))
      .join(',')
    return `${fields}#${intents}#${filled}`
  }, [panel])

  /**
   * **The document the rep's corrections were made against, as an identity.**
   *
   * `sent` is what the arming guard keys on and it carries the *lengths* of the
   * pre-filled values, which is right for « is there text here nobody has seen »
   * and not strong enough for « is this the same document ». A rewrite that
   * produced a compte-rendu of the same length with different words would be
   * invisible to it, and this is the comparison that decides whether a
   * correction still applies to what is on screen — so it is the document
   * itself, beside the rest of the panel. Same length *and* same words means the
   * corrections still land where they were typed.
   */
  const against = useMemo(() => (panel ? `${panel.edits.compteRendu} ${sent}` : ''), [panel, sent])

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  /*
   * How the compte-rendu is drawn: typeset for reading, or the raw textarea.
   *
   * *Lecture* is the default because the gate's job is to be read and
   * confirmed; correcting it is the exception. It used to open on a borderless
   * textarea on the pane's own white, which is indistinguishable from a preview
   * — the eyebrow said « · modifiable » to make up for it, which is a caption
   * doing a control's work. A two-word switch says it instead, and says it
   * where the rep is looking.
   *
   * Both halves show every marker. `CompteRenduDocument` hangs the `#` and the
   * `- ` in a gutter rather than hiding them, so *Lecture* is the same string
   * VerySwing receives (DEC-44) — set as prose instead of dumped as a log.
   */
  const [mode, setMode] = useState<'lecture' | 'modifier' | 'transcription'>('lecture')
  /*
   * The clipboard's answer, since the control that used to give it is now a menu
   * item and a menu item disappears the moment it is chosen.
   *
   * `CopyButton` swaps its own label to « Copié » under the rep's cursor, which
   * is the whole argument for a label change over a toast (`ui/CopyButton.tsx`).
   * Behind an overflow there is no label left to swap, so the answer is said
   * once, beside the glyph that was pressed, and taken away by itself — and a
   * refusal says so rather than lying by omission, because a rep who pastes a
   * stale clipboard into a client's mail has been told nothing went wrong.
   */
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )
  const copyCompteRendu = async (text: string) => {
    const ok = await copyText(text)
    setCopied(ok ? 'done' : 'failed')
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied('idle'), 1_600)
  }
  /*
   * Which citation the transcript is opened on, or null for the top of the call.
   *
   * Held here rather than in the reader because the gesture that sets it
   * happens in the *other* column: a rep presses « voir dans la transcription »
   * on a field in the rail, and the document column answers. That is the whole
   * point — the evidence and the value it justifies are side by side, and
   * neither has to be remembered while the other is found.
   */
  const [focus, setFocus] = useState<TranscriptFocus | null>(null)
  /**
   * **Which compte-rendu this meeting is set to produce** (DEC-43).
   *
   * Read from `meeting:get`, which is the one channel that answers it, and it is
   * the *meeting's* choice rather than the stored document's — the two differ
   * exactly while a rewrite is in flight, and in that window the chip has to show
   * what the rep just pressed.
   *
   * It is not on `review:get`, and adding it there would be a shared-contract
   * change. The cost of reading it here is one extra invoke per gate open, whose
   * answer carries the stored segments as well — `review:transcript` exists
   * precisely so a fifty-minute call is not shipped to a screen most reps confirm
   * without opening a source, so this read is paid once, on mount, and never
   * again: a rewrite the rep asks for answers with its own recipe, and there is
   * no second window that could change it behind this one.
   *
   * **Nothing on this screen waits for it.** A failure leaves `chosen` null, the
   * chip absent and the gate exactly as it was (DEC-26) — a picker is worth less
   * than the one confirmation in the product.
   */
  const meetingRead = useInvoke('meeting:get', { meetingId })
  /** What the rep pressed, which outranks what the read answered. */
  const [chosen, setChosen] = useState<RecipeId | null>(null)
  const recipe: RecipeId | null =
    chosen ?? (meetingRead.state.status === 'ready' ? meetingRead.state.value.recipe : null)
  /**
   * **A rewrite the rep asked for, and the document it is replacing.**
   *
   * `from` is `against` at the moment of the press: the panel is re-read on
   * `session:changed` and the gate closes to `extracting` and back, so the way
   * to know the new document has arrived is that the panel is no longer the one
   * the corrections were made against. Held as state and not a ref because the
   * closed gate draws a sentence from it — a rep who presses a control and
   * watches the screen they were confirming on disappear is owed the reason.
   *
   * ## `started`, and why the open gate could not learn it
   *
   * `was` is the recipe the document on screen was written with, and `started`
   * is whether the run the press asked for actually began: `null` until the
   * answer is in, `true` for a run in flight, `false` for one that never
   * started.
   *
   * **That third case is the whole of R33-1 and nothing on the open gate could
   * see it.** `register.ts` answers `changed: true` and fires `runEnhancement`
   * without awaiting it; on a machine with no model — the demo build DEC-28
   * ships first, and any machine whose key has expired — `Enhancement.run`
   * finds no recipe, records `enhancement.deferred` and returns *without moving
   * the machine*, so the gate stays open and no document ever arrives. The
   * sentence this screen had for that case was drawn in the `!open` branch and
   * gated on `state === 'extracting'`, which is precisely the branch a deferred
   * rewrite never reaches. Measured on the shipped renderer, both smoke sizes,
   * on a gate the rep had read to the end:
   *
   *     avant : valider=true   puce « Modèle : Prise de besoin commercial ▸ »
   *     après : valider=false  remède « Lire la suite du compte-rendu »
   *             phrases sur la réécriture : []
   *     ré-armé après 5 tours de page (8 à 960×600) : valider=true
   *             puce « Modèle : Compte-rendu libre ▸ »
   *             document : « # Néovia Santé — cadrage renfort data / ## Résumé »
   *
   * One press, five to eight page turns, and DEC-4's one irreversible control
   * back over the document the screen had just said was being replaced, under a
   * chip naming the recipe that did not run. `POST /v1/crm/tasks` has no
   * idempotency key.
   *
   * **The signal is `enhancement:status`, and the answer `meeting:recipe`
   * carried was not one.** That response used to ship a `state` field, added so
   * the renderer could tell the two apart; driven against the real
   * `Orchestrator` and the real `Enhancement` wired the way `main.ts` wires them
   * it answered `awaiting_confirmation` in **both** cases, because the handler
   * reads `stateOf` synchronously and `Enhancement`'s decision sits two
   * microtasks away behind `await stopRecording`. It could not have worked, and
   * `check:surfaces` could not see that nobody read it — its reader-join is
   * `\bstate\b`, which this file matches ten times over. The field is gone.
   * `enhancement:status` is the one function in the product that answers « what
   * is this compte-rendu doing », it is read here the way `EnhancementNotice`
   * reads it, and it is asked **once, after the press**: measured, the decision
   * is already taken by the time the press's own answer crosses the bridge —
   * `{"status":"running"}` for a run in flight, `{"status":"idle"}` for the
   * deferral.
   */
  const [rewriting, setRewriting] = useState<{
    to: RecipeId
    from: string
    was: RecipeId | null
    started: boolean | null
  } | null>(null)
  /**
   * **A rewrite that will not happen has to give the gate back, at no cost.**
   *
   * `started === false` means nothing on screen changed and nothing is coming:
   * the compte-rendu is the one the rep read, their corrections are intact, and
   * *Valider* ships exactly what is in front of them. Withholding it any longer
   * would make DEC-4's one confirmation unreachable because a model is missing,
   * which is the harm `review-garde-mort` exists to refuse, one cause further
   * back. So the gate arms again **immediately** — nought page turns, not five —
   * and the screen states the fact instead.
   */
  const stalled = rewriting !== null && rewriting.started === false
  /** A rewrite asked for whose document has not landed. *Valider* waits. */
  const pending = rewriting !== null && rewriting.started !== false
  /**
   * **One press, one run — and a ref because React batches.**
   *
   * A `useState` flag is set for the *next* render, so two clicks delivered in
   * one batch (a double-click, `Enter` held on a focused button) both read it as
   * false and both reach `meeting:recipe`: measured, two calls, two
   * `meeting.recipe.chosen` events and two `Orchestrator.enhance` runs for one
   * conversation. The same shape as `Overlay`'s timer handles — a value that
   * answers a question about *now* cannot live in render state.
   */
  const pressing = useRef(false)
  const [recipeFailure, setRecipeFailure] = useState<string | null>(null)
  /*
   * Has the rail been read to the end?
   *
   * *Valider* is the one irreversible control in the product and it was live
   * from first paint. On a 1280×800 laptop the rail shows six of eleven fields,
   * so a rep could push a compte-rendu, an opportunity and a follow-up into the
   * client's CRM having never seen the `⚠ faible` row — the exact field DEC-21
   * exists to make them look at.
   *
   * This is **not a second gate** (DEC-4). There is still one button, one
   * gesture and no confirmation prompt; the button simply refuses until what it
   * ships has been on screen. When the panel fits — a short extraction, a tall
   * window — `atEnd` is true on the first measurement and nothing is different.
   */
  const [below, setBelow] = useState<'document' | 'rail' | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<HTMLElement>(null)
  /*
   * Once, and then it stays read.
   *
   * The rail grows as the rep types into a multiline field, so a measurement
   * taken again after they had already reached the bottom would find fresh
   * content below the fold and refuse the button again — mid-keystroke, on the
   * text they are looking at. Reaching the end is a fact about the rep, not
   * about the current scroll position.
   *
   * ## What is actually recorded, and why it is a *range*
   *
   * It used to be a boolean per column, set the moment the scroller reached its
   * end — « has the bottom been touched ». And the gate opens by scrolling the
   * rail to the first `⚠ faible` row (DEC-21), which on the ESN fixture lands it
   * at exactly `scrollHeight − clientHeight`. So the flag was true on the first
   * measurement, before the rep had done anything, and scrolling the *document*
   * alone then armed « Valider malgré 1 champ non vérifié » with **seven of the
   * eleven fields never drawn** at 1280×800 — Objet, Client, Besoin, Profils,
   * Mode, TJM, Démarrage — under a caption reading « Tout ce qui part doit avoir
   * été affiché avant d'être validé ». *Client* is the field that decides which
   * VerySwing account gets the opportunity.
   *
   * The guard was inverted by its own good behaviour: the jump only happens when
   * there *is* something unverified, so it stood down exactly when there was
   * something to check.
   *
   * So what is recorded is the union of the viewports the column has actually
   * shown — one contiguous range, because scrolling is continuous and a rep
   * cannot skip a band without passing over it. A column is read when that range
   * covers it end to end. Contiguity is what makes one pair of numbers enough,
   * and `extend` is where it is enforced.
   */
  const seen = useRef<Record<Column, { from: number; to: number } | null>>({
    document: null,
    rail: null,
  })

  /**
   * **A scroll the app performed, in flight.**
   *
   * The range above is a union of the viewports the column has shown, and the
   * gate's own jump to the first `⚠ faible` row used to *animate* there — every
   * intermediate viewport unioned in on the way past, so the union filled from 0
   * to the target and the guard came up satisfied for a band no human eye was
   * over. That is the same failure as the old boolean, one layer subtler: the
   * measurement was of the scroller, and what it has to be of is the *rep*.
   *
   * While this is set, a measurement replaces the range instead of extending it,
   * so what survives an app-initiated jump is exactly where it landed — which is
   * the honest record of what is on screen when the rep first looks.
   *
   * **The jump is instant now (`src/lib/scroll.ts`) and this flag is not
   * redundant.** Instant kills the *sweep*, which is what `extend`'s contiguity
   * rule could never have caught — consecutive animation frames always abut, so
   * an animated jump is always credited end to end however far it travels. What
   * is left is the landing itself: the `⚠ faible` row is 555px down a rail whose
   * viewport is taller than that, so the landing band is *contiguous* with the
   * band the gate opened on and `extend` would union the two, crediting the rep
   * with a band they were moved across in one frame. This flag is what says
   * « the app moved this, not the rep » regardless of distance.
   *
   * Cleared on a timer rather than on `scrollend`: that event is Chromium 114+
   * and Electron ships it, but the fallback in a plain browser would be silence,
   * and silence here means the range never extends again.
   */
  const jumping = useRef(false)

  /**
   * **Every view of a column that has been shown end to end, and how tall it was
   * when it was.**
   *
   * This started as one boolean per column — « it has been covered » — and the
   * boolean froze an answer about *pixels*: a range recorded against one content,
   * compared to `scrollHeight` of whatever is in the column now. Two ordinary
   * gestures walked straight through it.
   *
   * **The Transcription tab.** A rep checking a quote — the DEC-21 gesture this
   * product is proudest of — opens the transcript, scrolls it to the end, and
   * comes back to *Lecture*. The transcript is short, so the column was covered;
   * the latch held; and *Valider* went live with **1700 of the compte-rendu's
   * 2447 pixels never drawn**, the entire « EMAIL DE RELANCE » block among them
   * — the subject, the recipients and the body of the mail that goes to the
   * client. On a real call the transcript is many times the document's height,
   * so this fires hardest on a *short* call, which is the one a rep reads fastest.
   *
   * **A window that shrinks.** Opened on a display where both columns fit, the
   * guard is satisfied and correctly so. Shrink the window and the latch keeps
   * saying so, with seventeen hundred pixels below the fold.
   *
   * Stamping the boolean closed both, and **charged the rep for going back**. A
   * single stamp remembers only the last view, so returning to one already read
   * is indistinguishable from arriving at it for the first time. Measured at
   * 1280×800: reading the compte-rendu takes seven page turns, and *fixing one
   * word* — « Modifier », then « Lecture » to check the fix reads right — cost
   * six more, all of them re-showing text the rep had just read. That is the
   * behaviour the latch was introduced to prevent, reintroduced one level down.
   *
   * So coverage is a **set**, keyed by what the column was showing. A view never
   * shown stays unread; going back to one already shown is free. The value is the
   * height it was covered at, because a box that has since shrunk has more below
   * the fold than the one that was read (`SHRINK_SLACK`) — **and the height of
   * the content it was covering**, because content that has since *grown* has
   * more below the fold too, and that half was missing.
   *
   * It was missing in the way that matters. `TranscriptReader` fetches its own
   * record and draws « Chargement… » until it lands; that placeholder is six
   * hundred and fifty-nine pixels tall, which at 1280×800 **fits the column
   * entirely**. So one click on *Transcription* covered the view before the
   * transcript existed, the latch held when seventeen hundred pixels of record
   * replaced it, and four rail presses later *Valider* shipped to the CRM with
   * the compte-rendu at `scrollTop` 0. At 960×600 the placeholder does not fit,
   * so the guard held — the defect was on the **larger** window, which is the
   * one every screenshot review and every gate stage runs at.
   */
  const covered = useRef<Record<Column, Map<string, Covered>>>({
    document: new Map(),
    rail: new Map(),
  })

  /**
   * What the current `seen` range was measured over.
   *
   * `seen` is in scroll coordinates, so a range unioned across a content swap is
   * a measurement of two different documents added together. This is how the
   * swap is noticed at all — the coverage set above only says whether a view has
   * *finished*, and the range has to be dropped the moment a different one
   * arrives, covered or not.
   */
  const shownAs = useRef<Record<Column, { view: string; height: number } | null>>({
    document: null,
    rail: null,
  })

  /**
   * **What a column is showing, as a key.** The coverage set above is keyed by
   * it, so two things it calls the same are read once between them.
   *
   * The left column has three tabs and **two** views. *Lecture* typesets the
   * compte-rendu and *Modifier* puts the same string in a textarea — same words,
   * same order, sixty-eight pixels of chrome between them — so a rep who read one
   * has read the other, and charging them a second traversal to fix a typo (and a
   * third to check the fix reads right) is the guard punishing the correction it
   * exists to invite. *Transcription* is a different document and keeps its own
   * key: that is the seam a rep walked through to arm the button on seventeen
   * hundred pixels they had never seen.
   *
   * The rail's view is **the payload**. Unchecking « Opportunité » turns nine
   * rows read-only and inserts a warn paragraph at the top saying their
   * corrections will not travel; a rep sitting at the bottom sees neither. The
   * guard is about what is about to be sent and the rep has just changed that, so
   * that payload is unread until it has been shown — and putting the tick back
   * returns to a payload already read, which is free.
   */
  /**
   * Whether the transcript reader has its record yet.
   *
   * Part of the view key, because a column drawing « Chargement… » is not
   * showing the transcript — and the placeholder is short enough to be covered
   * in one glance on any ordinary laptop. See `covered` above: this is the
   * precise half of that fix, and the `GROWTH_SLACK` rule is the general net
   * behind it.
   */
  /*
   * **The placeholder latch is gone with the view it guarded.**
   *
   * `TranscriptReader` draws « Chargement… » filling the column, so the view was
   * covered the instant it painted — which is why the key used to say
   * « chargement » until the record landed. The transcript is no longer a view
   * this guard measures at all, so there is nothing here for a placeholder to
   * cover. `GROWTH_SLACK` and the `firstElementChild` observer stay: they are
   * the general net, and the compte-rendu column has its own arrivals.
   */
  /*
   * And it is forgotten on the way out of the tab.
   *
   * The reader is mounted by the tab and unmounted by leaving it, so every
   * return fetches again and paints the placeholder again. A flag latched once
   * would make the *second* visit stamp « transcription » over a column showing
   * « Chargement… », which is the defect this exists to prevent, one visit later.
   */
  const viewOf = useCallback(
    (column: Column) => (column === 'rail' ? `rail:${payload}:${sent}` : `compte-rendu:${sent}`),
    [payload, sent],
  )

  /**
   * **Which way the page turn must go — from where the column *is*, not from where the
   * recorded band says it was.**
   *
   * Both this and `turn` read `seen.current[column].from > 8` and nothing else, and that
   * is a statement about the *band*, not about the scroller. `extend` deliberately keeps
   * the old band when a new viewport is not contiguous with it — a jump is not reading —
   * and `jumping.current` only covers scrolls **the app** performs. A scroll the browser
   * performs (focus, `scrollIntoView` on a pressed control) or the rep performs with the
   * scrollbar *thumb* takes that branch too, so the band is left describing a region the
   * column is no longer anywhere near, and the direction derived from it aims into a
   * clamp.
   *
   * Measured on the shipped gate at 1280×800 and again at 960×600:
   *
   *   · drag the compte-rendu's thumb to the bottom — band stays `{0, 747}`, the control
   *     reads « Lire la suite du compte-rendu », and `scrollTop` is 1802 of 1802: three
   *     presses, eighty presses, nothing moves and *Valider* never appears.
   *   · press `source ▸` on a row above the fold — the rail jumps 555 → 0, the band stays
   *     `{555, 1023}`, the control reads « Remonter dans ce qui part » at `scrollTop 0`,
   *     under a caption saying « il reste des champs, plus haut ». Dead.
   *
   * Both gestures are the most ordinary ones on the screen, and the second is DEC-21's
   * flagship affordance on the rows the gate's own opening jump puts above the fold. The
   * cost is that the compte-rendu never reaches VerySwing and no Outlook draft is
   * created, for that meeting, in that window — DEC-4's one confirmation gate, unreachable,
   * with the only control in the primary slot doing nothing and the sentence beside it
   * false in the one direction the rep could act on. `Tab` into the rail does it too, on a
   * product VISION §6 calls keyboard-first.
   *
   * So the question asked is « where is the nearest band this column has not shown,
   * relative to the viewport it is in now », and the answer can be **neither**: a
   * direction the scroller cannot move in is never returned, which is what makes the
   * control impossible to kill. The guard itself is untouched — a jump still contributes
   * no coverage, because a rep who drags a thumb past four hundred pixels has not read
   * them — and the control now takes them back to those pixels instead of into a clamp.
   *
   * One function for the gesture *and* the label, because two readings of « which way »
   * is how a button comes to lie about itself.
   */
  const unread = useCallback((column: Column): -1 | 0 | 1 => {
    /*
     * **And nothing in this column can be turned towards while the transcript is in it.**
     *
     * Round 30's rule above — « from where the column *is*, not from where the recorded
     * band says it was » — is a statement about a scroller and a band that describe the
     * same document. In the *Transcription* tab they describe two: `docRef` is then the
     * transcript's scroller, and `seen.current.document` is a band in the compte-rendu's
     * coordinates that `measure` deliberately stops updating. So this function answered
     * about the transcript using the compte-rendu's covered edge, `turn` aimed at that
     * edge inside a document sixteen thousand pixels long, fell back to a page when it was
     * already there, and came straight back.
     *
     * Measured on the shipped renderer, entering the tab by `source ▸` → « Voir dans la
     * transcription › » on a gate nothing had been read on yet: **757 ↔ 1427 of 16 972**
     * for twenty-six presses at 1280×800 and **547 ↔ 1030 of 17 172** at 960×600, with
     * *Valider* never appearing and the sentence under the slot reading « il reste du
     * compte-rendu, à gauche » throughout. Not a near miss — the compte-rendu was
     * unarmable **by construction** for as long as that tab was open, reached by the one
     * gesture this product has over a general-purpose notetaker (DEC-21), on the screen
     * that is DEC-4's single confirmation gate.
     *
     * `0` is the honest answer and it is not a refusal: the transcript is measured by
     * nothing (it does not ship), so there is no band of *it* the guard is waiting on, and
     * no scroll of it could contribute coverage. What the rep is owed instead is the way
     * back to the document that is blocking, which is what the foot of the column offers —
     * a control that leaves this tab, not one that moves inside it. « A control that moves
     * and achieves nothing is the dead one with extra steps », one tab over.
     */
    if (column === 'document' && mode === 'transcription') return 0
    const el = column === 'document' ? docRef.current : railRef.current
    if (!el || el.clientHeight === 0) return 1
    const furthest = el.scrollHeight - el.clientHeight
    // Nothing to scroll: the column shows all of itself and there is no turn to take.
    if (furthest <= 8) return 0
    const canUp = el.scrollTop > 8
    const canDown = el.scrollTop < furthest - 8
    const range = seen.current[column]
    if (range === null) return canDown ? 1 : -1
    const above = range.from > 8
    const below = range.to < el.scrollHeight - 8
    // The unread side the scroller can actually reach, then whatever it can reach at all
    // — because a control that names a direction it cannot move in is the dead one.
    if (above && canUp) return -1
    if (below && canDown) return 1
    if (canDown) return 1
    return canUp ? -1 : 0
  }, [mode])

  /** What `unread` last answered per column, so the label re-renders when it changes. */
  const [ways, setWays] = useState<Record<Column, -1 | 0 | 1>>({ document: 1, rail: 1 })

  const measure = useCallback(() => {
    /*
     * 8px of slack: a fractional `scrollHeight` on a HiDPI display leaves a
     * sub-pixel gap that never closes, and a button that stays refused at the
     * very bottom of its own scroller is worse than no guard at all.
     *
     * The unmeasurable case stays the permissive one. A guard whose *default* is
     * "refuse" fails closed in every environment that cannot lay out — jsdom,
     * where every box measures zero — so the one button in the product would be
     * dead in the renderer's own tests for a reason that has nothing to do with
     * the product.
     */
    const extend = (column: Column, el: HTMLElement | null) => {
      if (!el || el.clientHeight === 0) return
      const from = el.scrollTop
      const to = el.scrollTop + el.clientHeight
      const before = seen.current[column]
      // A jump the app made is not reading. What it leaves behind is the band it
      // landed on, and nothing of the span it crossed to get there.
      if (jumping.current || !before) {
        seen.current[column] = { from, to }
        return
      }
      // Union, and it stays contiguous: a rep cannot skip a band without
      // scrolling over it, so a gap means something else moved the column.
      seen.current[column] =
        from > before.to + 8 || to < before.from - 8
          ? before
          : { from: Math.min(before.from, from), to: Math.max(before.to, to) }
    }
    // **Not while the transcript is showing.** It is another document in the same
    // box, so unioning its scroll positions into this column's range would say
    // the compte-rendu had been shown when what moved was the transcript.
    if (mode !== 'transcription') extend('document', docRef.current)
    extend('rail', railRef.current)

    /*
     * **Covered once is covered.**
     *
     * The range is in scroll coordinates and the columns *grow*: a rep typing
     * into « Objections » adds lines under the caret, and `scrollHeight` with
     * them. Without a latch the guard would come back on mid-keystroke, take
     * *Valider* off the screen over the text they are looking at, and demand
     * they scroll through a column they have already read — which is the exact
     * behaviour the old boolean latch existed to prevent and which was never
     * the bug. The bug was *what* was latched: « the bottom has been touched »
     * instead of « all of it has been shown ».
     *
     * So the union is the measurement and this is the memory of it.
     */
    const read = (column: Column, el: HTMLElement | null): boolean => {
      // The unmeasurable case is the permissive one, always: see above.
      if (!el || el.clientHeight === 0) return true

      /*
       * **Following a citation costs nothing, and it never armed anything
       * either.**
       *
       * The transcript is not a view of this column — it is a second document
       * shown in the same box, reached by `source ▸`, and it does **not ship**:
       * `attachTranscript` is in `check-ports.mjs`'s `UNWIRED` list, so the
       * caption above — « tout ce qui part doit avoir été affiché » — is about
       * the compte-rendu and the rail, and nothing else. Making it a *view* that
       * must be covered charged a fifty-minute call **fifty page turns** for
       * following one citation, under a sentence naming the wrong document and
       * an escape (one click on « Lecture ») that nothing on screen mentioned.
       * The one feature this product has over a general-purpose notetaker was
       * the only thing on the screen being punished for being used — twice now,
       * the first time inside the measurement (`data-unmeasured`, *Demander*).
       *
       * And the attack that made it a view is still refused, because it was
       * never about the transcript: opening this tab without having read the
       * compte-rendu leaves `compte-rendu:<sent>` uncovered, which is what is
       * asked here. The transcript simply neither stamps it nor is asked for.
       */
      if (column === 'document' && mode === 'transcription') {
        return covered.current.document.has(`compte-rendu:${sent}`)
      }

      const view = viewOf(column)
      const mark = shownAs.current[column]
      if (!mark || mark.view !== view || el.clientHeight < mark.height - SHRINK_SLACK) {
        /*
         * A different view is in the column, or the box shrank under the one
         * that is: either way the range belongs to a layout that is gone. A box
         * that *grew* keeps its range and moves its mark — growth reflows less
         * below the fold, never more.
         */
        shownAs.current[column] = { view, height: el.clientHeight }
        seen.current[column] = { from: el.scrollTop, to: el.scrollTop + el.clientHeight }
      } else if (el.clientHeight > mark.height) {
        mark.height = el.clientHeight
      }

      const at = covered.current[column].get(view)
      if (at !== undefined) {
        /*
         * **Content that grew is content nobody has seen.**
         *
         * The box-shrink rule below says the same thing about the *window*; this
         * says it about what is in it. The two are one property — « is there
         * more below the fold than there was when this was read » — and only
         * half of it was written.
         *
         * `GROWTH_SLACK` is what keeps *Modifier* free. It is the same view as
         * *Lecture* (the same string, a textarea's chrome apart) and the chrome
         * is about sixty-eight pixels, so a growth allowance under that would
         * charge a rep a second traversal to fix a typo — the behaviour this
         * whole set exists to prevent. A hundred is two lines of it. Anything
         * larger is content that was not there, and the case this caught was a
         * thousand.
         *
         * **And a hundred is nine lines of typing, which is a paragraph.**
         *
         * The rule cannot tell content that *arrived* from content the rep
         * *wrote*, and a follow-up mail body is a thing a rep writes paragraphs
         * in. Measured: eight added lines kept *Valider*, nine took it off the
         * screen, and recovering it cost six page turns at 1280×800 and nine to
         * eleven at 960×600 — re-showing a column already read, to look at text
         * the rep had just typed and was staring at. Fifty lines up, this file
         * states that exact behaviour as the thing the latch exists to prevent.
         *
         * The distinction the rule was missing is *who wrote it*, and the
         * column knows: the caret is in it. Growth under the rep's own cursor
         * pushes content they have already seen further down — it adds nothing
         * unseen — so the coverage is **restamped at the new height** rather
         * than deleted, and a later arrival is measured from there.
         */
        if (el.contains(document.activeElement) && shippedHeight(el) > at.content) {
          at.content = shippedHeight(el)
          at.client = Math.min(at.client, el.clientHeight)
          return true
        }
        if (shippedHeight(el) > at.content + GROWTH_SLACK) {
          covered.current[column].delete(view)
          shownAs.current[column] = { view, height: el.clientHeight }
          seen.current[column] = { from: el.scrollTop, to: el.scrollTop + el.clientHeight }
          return false
        }
        /*
         * `SHRINK_SLACK`, and it is not a fudge.
         *
         * The pinned decision footer reflows on its own: the sub-line under it
         * wraps to two lines while it says what is left to read and to one once
         * the button is there, which changes the rail's box by about thirty
         * pixels. That is the app's chrome moving, not the window, and treating
         * it as a resize made the guard oscillate — arm, reflow, shrink,
         * invalidate, disarm, reflow, arm — so the honest reader could never
         * finish. Sixty-four pixels is two lines of chrome and a long way from
         * the two thousand a real resize takes.
         *
         * A taller box only ever has *less* below the fold than the one that was
         * read, so growth is never invalidating.
         */
        if (el.clientHeight >= at.client - SHRINK_SLACK) return true
        /*
         * The window shrank under a view that had been read: the text reflowed,
         * there is more below the fold than there was, and that part is unread.
         *
         * **The record is kept, not deleted.** Deleting it threw away the height
         * the view was covered at, so a window put *back* could not be
         * recognised — read both columns at 1280×800, shrink to 1280×500, then
         * restore the geometry that was read, and the guard charged five page
         * turns for six pixels. It was asymmetric, which is what made it a bug
         * rather than a policy: growing to 1400 and back was already free.
         * Undocking a laptop does this, and so does a Windows DPI change.
         */
      }

      const range = seen.current[column]
      if (!range) return true
      const done = range.from <= 8 && range.to >= shippedHeight(el) - 8
      /*
       * The **narrowest** box it has ever been covered at. Covering at a smaller
       * height is the stronger statement — the same content, more scrolling — so
       * a rep who read the column in a cramped window has read it in every
       * roomier one, and `Math.min` is what carries that forward.
       */
      if (done) {
        covered.current[column].set(view, {
          client: Math.min(at?.client ?? Infinity, el.clientHeight),
          // The **tallest** content it has been covered at, for the mirror of
          // the reason the box keeps its narrowest: covering taller content is
          // the stronger statement, so it is the one to carry forward.
          content: Math.max(at?.content ?? 0, shippedHeight(el)),
        })
      }
      return done
    }
    const readToEnd = {
      current: { document: read('document', docRef.current), rail: read('rail', railRef.current) },
    }

    /*
     * « There is something above » and « there is something below », written
     * straight onto the element.
     *
     * Not React state: they are purely visual properties of the scroll
     * position, they change on every scroll tick, and routing them through
     * `useState` would re-render two long columns to move a mask.
     *
     * **`data-below` used to be the arming state, and that was the wrong fact.**
     * It was written as `below === 'rail'` — *which column is still blocking
     * Valider* — so the rail carried no bottom fade while the document was the
     * one blocking, even with five hundred pixels below its own fold; and the
     * document's fade switched off the moment the rep reached its end, because
     * `readToEnd` sticks, leaving no cue when they scrolled back up. The mask
     * answers « is there more in this direction », which is a question about
     * this scroller and nothing else. The button keeps its own state.
     */
    for (const el of [docRef.current, railRef.current]) {
      if (!el) continue
      el.dataset.above = String(el.scrollTop > 8)
      el.dataset.below = String(el.scrollTop + el.clientHeight < el.scrollHeight - 8)
    }
    /*
     * **Both columns, and this is the whole of the guard's honesty.**
     *
     * It measured the rail alone. The rail holds the eleven typed fields — and
     * the two strings that actually leave the machine, the compte-rendu and the
     * body of the mail, are in the *other* column. So a rep could scroll the
     * rail, watch *Valider* arm, and ship a CRM task and an Outlook draft
     * having read one paragraph of a fifteen-line follow-up, under a caption
     * asserting that everything that leaves had been shown to them.
     *
     * The document first, because it is the column a rep reads first and the
     * one whose content they own.
     */
    setBelow(
      !readToEnd.current.document ? 'document' : !readToEnd.current.rail ? 'rail' : null,
    )
    // The label's direction, from the same reading as the gesture — see `ways`.
    const next = { document: unread('document'), rail: unread('rail') }
    setWays((before) =>
      before.document === next.document && before.rail === next.rail ? before : next,
    )
    // `viewOf` is what the coverage set is keyed by, so `measure` is rebuilt
    // when either half of it moves — and `mode` alongside it, because the
    // transcript is read here directly rather than through the key: a stale
    // `mode` would leave the guard answering about the tab a rep just left.
  }, [viewOf, mode, sent, unread])

  /*
   * Measure before paint, and again whenever the rail changes size.
   *
   * `onScroll` alone never fires on a panel that already fits, and a plain
   * `useEffect` would let one frame of the enabled button through. The observer
   * covers the window being resized and the rows growing as the rep types into
   * a multiline field.
   */
  const locate = (next: TranscriptFocus) => {
    setFocus(next)
    setMode('transcription')
  }
  /** The intents as they stand now. Null until the first preview answers. */
  const [live, setLive] = useState<ReviewIntent[] | null>(null)
  /** Which intents were draftable last time, so a newly possible one is noticed. */
  const availableBefore = useRef<Set<string> | null>(null)

  // Enhancement finishes in the background, so the gate opens on a broadcast
  // rather than on a poll — and closes again the moment the machine moves.
  useBroadcast('session:changed', (payload) => {
    if (payload.meetingId === meetingId) loaded.reload()
  })

  /*
   * Connector health, so an intent whose destination is unreachable says so
   * *before* the rep presses the one button (DEC-26). Read here rather than
   * folded into `review:get` because it changes independently of the panel —
   * VSA can come back while this screen is open, and it should stop saying it
   * is down without a reload.
   */
  const healthState = useInvoke('health:snapshot', {})
  useBroadcast('health:changed', (payload) => {
    if (healthState.state.status !== 'ready') return
    healthState.set({ ...healthState.state.value, [payload.connector]: payload.health })
  })
  const health = healthState.state.status === 'ready' ? healthState.state.value : null

  const retry = useCallback(
    (connector: ConnectorId) => {
      void invoke('health:retry', { connector }).then((result) => {
        if (healthState.state.status !== 'ready') return
        healthState.set({ ...healthState.state.value, [connector]: result })
      })
    },
    [healthState],
  )

  /*
   * Attached once the columns exist, and not again on every render.
   *
   * It used to run with no dependency array, which built and tore down a
   * `ResizeObserver` — and forced a synchronous layout read — on every
   * keystroke in the compte-rendu. The observer already covers everything a
   * re-render could change: the textareas grow with their content
   * (`field-sizing`), the window resizes, the rows grow as the rep types. What
   * it cannot see is the columns *appearing*, so `staged` is the dependency:
   * the gate renders a spinner until the panel and the pre-fill have both
   * landed, and only then are there elements to observe.
   */
  const staged = panel !== null && edits !== null
  useLayoutEffect(() => {
    if (!staged) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    /*
     * **The box and what is in it, because they are different sizes.**
     *
     * A scroller is a fixed-height flex child: its own box does not change when
     * its content grows, so an observer on the column alone never fires for the
     * thing the guard is actually about. That is not theoretical — it is how a
     * transcript arriving *after* its placeholder had been counted as read went
     * unnoticed: the view was stamped, the content tripled, nothing re-measured,
     * and `Valider` stayed armed on a column at `scrollTop` 0.
     *
     * `onScroll` cannot cover it either: nobody scrolls when content appears.
     */
    for (const el of [docRef.current, railRef.current]) {
      if (!el) continue
      observer.observe(el)
      if (el.firstElementChild) observer.observe(el.firstElementChild)
    }
    return () => observer.disconnect()
  }, [measure, staged])

  /*
   * The gate opens on the doubt.
   *
   * The header says « ⚠ faible — 1 champ non vérifié dans la transcription »,
   * and on a 1280×800 laptop the field it means was six rows below the fold:
   * six of eleven fields visible, and the only untrustworthy one not among
   * them. The screen was flagging something and then hiding it — which is the
   * whole confidence machinery (DEC-21) surfacing a finding and burying it in
   * the same breath.
   *
   * Scrolled to, not focused: this is a screen a rep arrives at to *read*, and
   * a caret that lands in a text field on load steals the first keystroke and
   * the first Tab. The banner is still there to jump back to, and it focuses.
   *
   * Once per field, so a `session:changed` broadcast reloading the panel does
   * not yank the column back while the rep is somewhere else in it.
   */
  const firstFaible = panel?.fields.find((field) => field.confidence === 'faible')?.key ?? null
  const openedOn = useRef<string | null>(null)
  useEffect(() => {
    if (firstFaible === null || openedOn.current === firstFaible) return
    /*
     * Only once it is actually there. The panel arrives one render before the
     * fields do — `edits` is seeded from it in the effect above, and the form
     * is not drawn until it exists — so the first pass finds nothing, and
     * marking the jump done there meant it never happened at all.
     */
    // The *row*, not the field: scrolling the input to the top leaves its own
    // label and its `⚠ faible` above the fold, which is the finding hidden
    // again one line higher up.
    const target = document.getElementById(`row-${firstFaible}`)
    if (!target) return
    openedOn.current = firstFaible
    /*
     * Marked, so the measurement records where this lands rather than the band
     * it was moved across — see `jumping`.
     *
     * **700ms is no longer « Chromium's smooth scroll with room », and it stays
     * anyway.** The jump is instant (`src/lib/scroll.ts`), so what the window
     * has to cover is the scroll event and the `measure` it triggers, which is a
     * frame or two. Shortening it to that is a number chosen rather than
     * measured, and the two ways of being wrong are not comparable: too long
     * counts a rep's own scroll inside the window as a landing, which
     * **under**-credits them and at worst costs one page turn; too short lets
     * `extend` union the jump's landing with the band the gate opened on — the
     * `⚠ faible` row is 555px down a rail whose viewport is taller than that, so
     * the two *are* contiguous — and arms *Valider* over a band nobody looked at,
     * which is a write into the client's CRM with no idempotency key.
     */
    jumping.current = true
    scrollToTop(target)
    window.setTimeout(() => {
      jumping.current = false
      measure()
    }, 700)
  })

  // The form is seeded once from the server's pre-fill. Re-seeding on every
  // render of the panel would throw away what the rep is in the middle of
  // typing the first time a broadcast lands.
  useEffect(() => {
    if (!panel) return
    const available = panel.intents.filter((i) => i.available).map((i) => i.id)
    /*
     * **A rewrite the rep asked for is the one case that must *not* keep what is
     * held.**
     *
     * `previous ?? …` is what makes a correction survive a broadcast, and it is
     * exactly wrong here: the document those corrections were made against has
     * been replaced, and keeping them would leave the **old** compte-rendu in
     * `edits.compteRendu` — which is the string *Valider* puts in the VerySwing
     * task. Measured on the shipped gate before this existed, at both smoke
     * sizes: a fresh extraction landing while the gate was open dropped the rail
     * from eleven rows to two and left the document at « # Néovia Santé —
     * cadrage renfort data » instead of the one that had just been written. A
     * rep who switched recipes would have shipped the document they asked to
     * replace.
     *
     * So the seed is replaced, once, when the panel stops being the one the
     * corrections were against — and `PENDING_EDITS` is cleared with it, because
     * a draft that outlived its document would come back on the next mount.
     * Nothing is discarded silently: `RecipeSwitch` says it, with the count, one
     * press earlier.
     */
    if (rewriting !== null) {
      if (rewriting.from === against) return
      setRewriting(null)
      PENDING_EDITS.delete(meetingId)
      setEdits(panel.edits)
      setChecked(available)
      availableBefore.current = new Set(available)
      /*
       * **And both columns stop being read — here, where the content changed,
       * and no longer at the press.**
       *
       * Coverage is keyed by what a column is *showing*, and this is the line
       * where what it shows stops being the thing the rep read: a new document,
       * eleven recomposed rows, a new draft. Clearing it at the press instead
       * charged for a rewrite that may never happen — measured at five page
       * turns at 1280×800 and eight at 960×600 to get back to a screen that had
       * not changed by one pixel, on the build DEC-28 ships first, where the run
       * cannot start at all.
       *
       * `measure()` is called rather than left to the observer: `viewOf` reads
       * the *lengths* of the pre-filled values, so a new document of the same
       * length leaves the key — and therefore `measure`'s own identity, and
       * therefore the layout effect that re-runs it — untouched. That is the
       * case this clear exists for, so it may not depend on it.
       */
      covered.current.document.clear()
      covered.current.rail.clear()
      shownAs.current = { document: null, rail: null }
      seen.current = { document: null, rail: null }
      measure()
      return
    }
    // What the rep had typed, if they left and came back; otherwise the
    // server's pre-fill. See `PENDING_EDITS`.
    setEdits((previous) => previous ?? PENDING_EDITS.get(meetingId) ?? panel.edits)
    setChecked((previous) => previous ?? available)
    availableBefore.current ??= new Set(available)
  }, [against, measure, meetingId, panel, rewriting])

  /*
   * *Ce qui sera créé*, kept honest while the rep types.
   *
   * `panel.intents` is drafted from the **pre-fill** and never changes again, so
   * on its own this list describes what would have been created before the rep
   * touched anything — on the one screen whose entire promise is that what they
   * read is what the CRM receives. Recomputed through `review:preview`, which
   * runs the same `draftIntents` as `review:confirm` rather than a second copy
   * of the rule in here (`src/` may not import `core/domain/`, and a screen
   * showing its own idea of what will be created is the failure this fixes).
   *
   * Debounced because it fires per keystroke, and `stale` because the responses
   * are promises: without it a slow early reply can land after a fast later one
   * and put the pre-edit summary back on screen.
   */
  useEffect(() => {
    if (!edits || checked === null) return
    let stale = false
    const timer = setTimeout(() => {
      void invoke('review:preview', { meetingId, edits, intentIds: checked })
        .then((result) => {
          if (!stale) setLive(result.intents)
        })
        // Keep the last good draft. This runs while the rep is typing, so an
        // error banner here would cover a screen that is working.
        .catch(() => undefined)
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [checked, edits, meetingId])

  /*
   * An intent that has just become possible is checked, because nothing is ever
   * pre-unchecked (DEC-20) and the rep cannot have unchecked this one — it was
   * disabled until a moment ago. This is the other half of DEC-18 mitigation
   * *a*: picking a candidate account resolves `accountId`, which makes the
   * opportunity draftable, and it now both says so and ships.
   */
  useEffect(() => {
    if (live === null) return
    const nowAvailable = new Set(live.filter((i) => i.available).map((i) => i.id))
    const before = availableBefore.current
    availableBefore.current = nowAvailable
    if (!before) return
    const appeared = [...nowAvailable].filter((id) => !before.has(id))
    if (appeared.length === 0) return
    setChecked((previous) =>
      previous === null ? previous : [...previous, ...appeared.filter((id) => !previous.includes(id))],
    )
  }, [live])

  const set = useCallback(
    (key: keyof ReviewEdits, value: string | number | null) => {
      setEdits((previous) => {
        if (!previous) return previous
        const next = { ...previous, [key]: value }
        // Held across a navigation, see `PENDING_EDITS`.
        PENDING_EDITS.set(meetingId, next)
        return next
      })
    },
    [meetingId],
  )

  const toggle = useCallback((id: string) => {
    setChecked((previous) =>
      previous === null
        ? previous
        : previous.includes(id)
          ? previous.filter((other) => other !== id)
          : [...previous, id],
    )
  }, [])

  const confirm = useCallback(async () => {
    if (!edits || checked === null || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await invoke('review:confirm', { meetingId, edits, intentIds: checked })
      if (outcome.ok) {
        // Confirmed: there is no draft left to restore, and the gate refuses
        // this meeting from here on.
        PENDING_EDITS.delete(meetingId)
        onConfirmed?.()
      } else setFailure(outcome.reason)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'validation impossible')
    } finally {
      setBusy(false)
    }
  }, [busy, checked, edits, meetingId, onConfirmed])

  /**
   * **Rewrite this compte-rendu with another declared recipe** (DEC-43, US-8).
   *
   * One channel, `meeting:recipe`, which records the choice as an event and then
   * fires `runEnhancement` — `Orchestrator.enhance`, the same path the end of a
   * meeting takes. That is the whole reason this does not dispatch `extract` or
   * reach for `enhancement:retry`: `#enhance` gathers the transcript, the context
   * and the rep's notes the same way whichever way the run is reached, so a
   * re-extraction **can never analyse less material than the attempt it
   * replaces**. A second copy of that gathering here would be a second place for
   * it to quietly analyse less.
   *
   * Three things happen on `regenerating`, and only the first is about the
   * picker.
   *
   * **The drafts go, and they were named before the press.** See the seed effect
   * — `RecipeSwitch` states the count first, because a correction discarded
   * silently is the one thing this screen exists to prevent.
   *
   * **Both columns stop being read.** Coverage is keyed by what a column is
   * showing, and a rewrite replaces the compte-rendu, the eleven rows and the
   * draft — so *nothing* in either column is a thing the rep has seen.
   *
   * Driven on the real gate at both smoke sizes, this is worth exactly two things
   * and the second is the one that will outlive this story. **The window between
   * the press and the new document**: without these five lines *Valider* stays on
   * screen with no page turn offered (`armed at the press: true, remedy: null`),
   * over a compte-rendu the rep has just asked to replace, and `confirm` is legal
   * from `awaiting_confirmation` — so that press ships the superseded document into
   * VerySwing, where `POST /v1/crm/tasks` has no idempotency key. And **the
   * rewrite the coverage key cannot see**: `viewOf` reads `sent`, which carries the
   * *lengths* of the pre-filled values, so a new document of the same length with
   * the same field verdicts leaves the key identical — measured, `armed on the new:
   * true` and « re-armed after 0 page turns », a document nobody has read with the
   * one irreversible control live over it. The two declared recipes differ in their
   * field count so `sent` does move today; that is a property of `RECIPES`, not of
   * this guard, and « the key happened to change » is not the statement « this has
   * not been read ». The guard's whole history is of those two coming apart.
   *
   * **And the honest answer is re-measured rather than asserted.** `measure` is
   * what decides whether a column still has something under its fold, and it
   * reads the boxes: forcing `below` here would draw a page turn on a column with
   * no page to turn where the document happens to fit. In jsdom every box is zero
   * and the guard therefore fails open, which is why this half is driven against
   * real layout and not asserted here.
   *
   * `regenerating: false` means the recorded choice matched the stored
   * document's, so there is nothing to replace and nothing of the rep's to lose.
   */
  const rewrite = useCallback(
    async (next: RecipeId) => {
      if (pressing.current || busy) return
      pressing.current = true
      setRecipeFailure(null)
      try {
        const outcome = await invoke('meeting:recipe', { meetingId, recipe: next })
        setChosen(outcome.recipe)
        if (!outcome.regenerating) return
        /*
         * Withheld on the press and not on the measurement, which is the half
         * that could not fail. The coverage clear used to live here; it is in the
         * seed effect now, where the content actually changes — see there. What
         * closes this window is the marker itself, so it no longer depends on the
         * coverage key happening to move: `viewOf` reads the *lengths* of the
         * pre-filled values, and this file already recorded that a new document
         * of the same length leaves the key identical and re-arms over prose
         * nobody has read.
         */
        setRewriting((held) => ({
          to: outcome.recipe,
          from: against,
          /*
           * The **document's** recipe, and sticky across a second press. `recipe`
           * is `chosen ?? meeting:get`, so once a press has landed it names the
           * pending choice; reading it again on the retry would make the chip
           * claim the document is the thing that did not get written — and with
           * the chip on `libre`, `RecipeSwitch`'s `others` no longer offers
           * « Réécrire avec « Compte-rendu libre » », so the retry the rep needs
           * once a model exists would not be on the screen at all.
           */
          was: held?.was ?? recipe,
          started: null,
        }))
        /*
         * And then the one question the press's own answer cannot hold: did the
         * run start? Asked once, here, because by the time this line runs the
         * decision has been taken — `void runEnhancement?.(…)` reached
         * `Enhancement.run` before the handler's answer crossed the bridge.
         *
         * Only the *read* may report `false`. A broadcast may not, and that is
         * deliberate: `statusOf` answers `idle` for every meeting past `ended`,
         * so the `enhancement:status` that fires when a **successful** run
         * finishes also carries `idle` — a broadcast allowed to set `started`
         * would draw « la réécriture n'a pas démarré » in the frame before the
         * new document arrives, which is the lying sentence this whole fix is
         * about, one instant earlier.
         */
        const status = await invoke('enhancement:status', { meetingId }).catch(() => null)
        setRewriting((held) =>
          held === null || held.from !== against || held.started !== null
            ? held
            : { ...held, started: status !== null && status.status === 'running' },
        )
      } catch (error) {
        // Stated, never swallowed. Nothing was recorded, so the chip goes on
        // naming the recipe that is still in force, which is the truth.
        setRecipeFailure(
          error instanceof Error ? error.message : 'Le modèle n’a pas pu être enregistré.',
        )
      } finally {
        pressing.current = false
      }
    },
    [against, busy, meetingId, recipe],
  )
  /*
   * `Ctrl/⌘ Entrée`, and **only when the button is already armed**
   * (`app/shortcuts.ts`).
   *
   * The guard is the same one the button carries — `armed`, which is `below ===
   * null` (nothing that is about to leave is still under a fold) **and** no
   * rewrite waiting to land — and it is expressed as the absence of a handler
   * rather than as a handler that declines. A shortcut that could confirm while
   * *Valider* was still refusing would be a second gate (DEC-4), and one that
   * fired while the reveal control was on screen would confirm something the rep
   * has not been shown.
   *
   * It is one expression and not two because the two have come apart before: the
   * accelerator is the path with nothing on screen to look at, so a condition
   * the button gains and this does not is a confirmation with no rectangle.
   */
  const armed = below === null && !pending
  useShortcuts(armed && !busy ? { valider: () => void confirm() } : {})

  /**
   * The two sentences a rewrite owes the rep, composed once so the narrowing is
   * done in one place.
   *
   * `pendingLine` goes under the slot the button left. `stalledNote` goes beside
   * the chip that was pressed, because that is where the rep is looking and
   * because it is the sentence that corrects `RecipeSwitch`'s own promise —
   * « La validation reprendra dès que le nouveau compte-rendu sera prêt », which
   * is true of a run that starts and false of one that cannot.
   *
   * It says what was measured and no more. `enhancement:status` answers `idle`
   * for every meeting past `ended`, so « the run did not start » is the whole of
   * what this screen knows; « aucun modèle n'est configuré » is the likeliest
   * cause and is not in the answer, so Réglages is named as the place to look
   * rather than as the diagnosis (DEC-26).
   */
  const pendingLine =
    rewriting !== null && rewriting.started !== false
      ? `Réécriture avec « ${recipeById(rewriting.to).title} » demandée — la validation reprendra dès que le nouveau compte-rendu sera prêt.`
      : null
  const stalledNote =
    rewriting !== null && rewriting.started === false
      ? `La réécriture avec « ${recipeById(rewriting.to).title} » n’a pas démarré. Le compte-rendu ci-dessous est toujours celui de « ${recipeById(rewriting.was ?? rewriting.to).title} » et vos corrections sont intactes. Vérifiez le modèle dans Réglages, puis réessayez ici.`
      : null

  /** One screenful of whichever column still has something under its fold. */
  /**
   * One screenful **towards whatever has not been seen**.
   *
   * It always went down, which was right while « read » meant « the bottom has
   * been touched ». It does not any more: the gate opens by jumping the rail to
   * the first `⚠ faible` row, so the unread band is usually *above* the fold,
   * and a control that only scrolls down could never reach it. The direction is
   * read off the same range the guard is (`seen`), so the button and the
   * measurement cannot disagree about which way the work is.
   *
   * `- 64` overlaps two lines across the turn so nothing falls into the seam,
   * and the arming is measured from the scroll this causes — never from the
   * click, which would make a teleport count as reading.
   */
  /**
   * The direction the label shows, kept current by `measure` rather than recomputed at
   * render time.
   *
   * `unread` reads refs, so it does not re-render anything; `below` only changes when a
   * column crosses from unread to read. So the label could be a press behind the
   * scroller: measured at 960×600, « Remonter dans ce qui part » on a rail that had just
   * reached `scrollTop 0`, whose next press correctly went *down*. A button that names
   * the direction it is not about to take is the thing `unreadIsAbove`'s own docblock
   * exists to prevent, one instant later.
   */
  const unreadIsAbove = useCallback(
    (column: Column): boolean => ways[column] === -1,
    [ways],
  )

  /**
   * **A page turn lands where the unread band begins, not a fixed step away.**
   *
   * A constant step is right for a rep reading straight down and wrong the moment they
   * are *beyond* what they have read: from the bottom of a 2 549-pixel document whose
   * covered band ends at 747, one page up lands at 1 119 — three hundred and seventy-two
   * pixels clear of the band, so `extend`'s contiguity rule discards it, and the next
   * turn goes back down. Measured after the direction was fixed and before this was:
   * twenty presses oscillating between 1 126 and 1 787, coverage never growing,
   * *Valider* never arming. A control that moves and achieves nothing is the dead one
   * with extra steps.
   *
   * So the target is the edge of the covered band: going down, the first pixel it does
   * not hold (`range.to`) goes to the top of the viewport; going up, the last one
   * (`range.from`) goes to the bottom. Either way the new viewport *abuts* the band, the
   * union grows by a full page, and the number of presses is the number of pages — which
   * is what the caption promises. Clamped by the scroller, so the last turn of a document
   * lands on its end.
   */
  const turn = useCallback(
    (column: Column) => {
      const el = column === 'document' ? docRef.current : railRef.current
      if (!el) return
      const way = unread(column)
      if (way === 0) return
      const range = seen.current[column]
      const step = Math.max(el.clientHeight - 64, 120)
      if (range === null) {
        scrollElementBy(el, { top: way * step })
        return
      }
      const to =
        way === 1
          ? Math.min(el.scrollHeight - el.clientHeight, range.to)
          : Math.max(0, range.from - el.clientHeight)
      // A target the column is already at would be a press that does nothing; fall back
      // to a page, which is what a rep pressing again expects either way.
      if (Math.abs(to - el.scrollTop) < 8) {
        scrollElementBy(el, { top: way * step })
        return
      }
      scrollElementTo(el, { top: to })
    },
    [unread],
  )

  if (loaded.state.status === 'loading') return <Centered>Chargement…</Centered>

  if (loaded.state.status === 'failed') {
    return (
      <Centered>
        <p className="text-danger text-copy">{loaded.state.reason}</p>
        <BackLink onBack={onBack} />
      </Centered>
    )
  }

  // DEC-23. The closed arm of the union carries a state and a reason and
  // nothing else, so this branch has nothing it *could* render from the gate.
  if (!loaded.state.value.open) {
    return (
      <ClosedGate
        state={loaded.state.value.state}
        reason={loaded.state.value.reason}
        /*
          **The rep pressed a control and the screen they were confirming on
          disappeared.**

          `STATE_REASON.extracting` is « Analyse en cours… », which is the right
          bland sentence for a meeting the rep never touched and is not an answer
          to « I pressed *Réécrire avec « Compte-rendu libre »* and the gate went
          away ». Named only while the state really is `extracting`: a run that
          fails lands back in `ended`, and a sentence claiming a rewrite is under
          way would then be false (DEC-26).
        */
        note={
          rewriting !== null && loaded.state.value.state === 'extracting'
            ? `Le compte-rendu est en cours de réécriture avec « ${recipeById(rewriting.to).title} ». La validation reprendra dès qu’il sera prêt.`
            : null
        }
        onBack={onBack}
      />
    )
  }

  if (!panel || !edits || checked === null) return <Centered>Chargement…</Centered>

  // The server's draft until the first preview lands, so the rows are never
  // blank — then what the form currently says.
  const intents = live ?? panel.intents

  /*
   * **How many of the rep's corrections a rewrite would discard — counted.**
   *
   * Against `panel.edits`, which is what the main process pre-filled, so a
   * « correction » is a field whose value the rep changed and nothing else. The
   * sentence `RecipeSwitch` prints before the press is this number, so a
   * plausible-sounding « vos corrections seront perdues » over a screen nobody
   * has touched, or over one they have rewritten end to end, is not something
   * this screen can say.
   */
  const edited = (Object.keys(panel.edits) as (keyof ReviewEdits)[]).filter(
    (key) => edits[key] !== panel.edits[key],
  ).length

  /*
   * **Whether a correction typed in the rail can reach anything.**
   *
   * `draftIntents` composes the nine interpretive fields into the opportunity's
   * `description` and into nothing else — the CRM task carries the compte-rendu
   * and the mail carries its own body. So there are two ways for those nine
   * rows to be live controls over a payload that will never exist: the account
   * the CRM could not match (the opportunity refuses without one), and the rep
   * unchecking it.
   *
   * Both were silent. The rows stayed editable, kept their `⚠ faible`, and
   * still named themselves on the button — « Valider malgré 1 champ non
   * vérifié » — over a field whose correction reached nothing.
   *
   * Null when they ship, which is the ordinary case.
   */
  const opportunity = intents.find((intent) => intent.kind === 'crm.opportunity')
  const typedInert =
    opportunity === undefined
      ? null
      : !opportunity.available
        ? (opportunity.reason ?? 'L’opportunité ne peut pas être créée.')
        : !checked.includes(opportunity.id)
          ? 'L’opportunité n’est pas cochée.'
          : null

  /*
   * The unverified fields, in the order they are drawn — so the banner can name
   * how many there are and the jump lands on the first one a rep would meet
   * scrolling, not on whichever the extractor happened to emit first.
   */
  /*
   * Why *Valider* is refusing, in French, beside itself (DEC-26).
   *
   * `null` when it is not refusing — `unavailable` takes the boolean and the
   * reason separately, and `Button` throws on a blank one, so the two are
   * computed together here rather than left to agree by accident.
   */
  /*
   * « la relance est créée en brouillon » is a promise, and it was printed
   * whether or not a brouillon was going to be created.
   *
   * On the build the first demo ships in (DEC-28) there is no Microsoft account,
   * so the Outlook intent is unavailable and unchecked with « Aucun destinataire
   * au calendrier. » on its own row — and three lines under it the screen still
   * reassured the rep about a draft that will not exist. A false reassurance on
   * the one screen whose entire job is being believed.
   *
   * What is always true is the half that matters: nothing reaches the client.
   */
  const draftingMail = intents.some(
    (intent) => intent.kind === 'mail.draft' && intent.available && checked.includes(intent.id),
  )
  const reassurance = draftingMail
    ? 'Rien n’est envoyé au client : la relance est créée en brouillon.'
    : 'Rien n’est envoyé au client : aucun brouillon ne sera créé.'

  const faible = panel.fields.filter((field) => field.confidence === 'faible')
  const focusFirstFaible = () => {
    const first = faible[0]
    if (!first) return
    scrollToTop(document.getElementById(`row-${first.key}`))
    // Focus, not just scroll: the rep's next gesture is to correct the value,
    // and a screen reader gets the label read out instead of a silent jump.
    document.getElementById(`field-${first.key}`)?.focus({ preventScroll: true })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        **What says this is the gate is what the gate does, not its name.**

        `5.3 Revue` had the screen name itself, and for a round it did: « Revue »
        in 28px serif, because a rep arriving from a broadcast had to be told in a
        word that this is the confirmation. Everything else on the screen now says
        it louder than the word did — « Prêt à envoyer » over the rail, « Ce qui
        sera créé » over the three intents, the reassurance line naming what does
        and does not reach the client, and a primary reading « Valider ». What the
        header owes is the call, so that is what it carries.
      */}
      <header className="border-subtle flex shrink-0 items-center gap-inline border-b px-gutter py-3">
        <Button variant="nav" onClick={onBack}>
          ‹ Calendrier
        </Button>
        <span aria-hidden className="border-subtle h-4 shrink-0 border-l" />
        {/*
          **The title is the call, not the word « Revue ».**

          It was a 28px serif `<h1>Revue</h1>` — the largest thing on the screen,
          naming the furniture — with « Néovia Santé — cadrage renfort data » in
          muted 12px beside it. The rep arrived here by pressing *Relire et
          valider* on that call thirty seconds ago; what they need the strongest
          ink for is which call this is, because the one press on this screen
          writes into that client's CRM. The back link still names a destination
          and the primary still names the act, so nothing is lost by the screen
          not saying its own name.

          The account, unless the title already says it: « Néovia Santé — cadrage
          renfort data · Néovia Santé » is the account printed twice on one line,
          which is how a rep learns to stop reading the end of it. Meeting titles
          in this trade almost always open with the client, so the common case is
          the redundant one.

          `text-copy` and not `text-display`: at 960 — the width `main.ts`
          declares as the minimum — a 28px setting of this objet truncates to
          « Néovia Santé — cadrage… » beside a `⚠ faible` banner that is itself
          load-bearing, and a title that hides the objet to be large is the
          echo it replaced with a different word missing.
        */}
        <h1 className="text-strong min-w-0 flex-1 truncate text-copy font-semibold">
          {panel.meeting.title}
          {edits.accountName && !panel.meeting.title.includes(edits.accountName)
            ? ` · ${edits.accountName}`
            : ''}
        </h1>
        {/*
          **The count, and a way to reach it — and no second `⚠` in the bar.**

          It read « ⚠ faible — 1 champ non vérifié dans la transcription », which
          made the mark the loudest thing in the title bar and the *third*
          statement of one fact: the row itself wears it, and *Valider*'s own
          label already says « Valider malgré 1 champ non vérifié ». A mark
          repeated three times on one screen is a mark a rep stops reading, which
          is the failure DEC-21 exists to prevent, at the top of the screen where
          it costs the most.

          What the bar owes is the **measurement**, quietly: how many fields there
          are and how many were checked. That is the number this product makes
          about itself and it is worth stating whether or not it is bad — a screen
          that speaks up only when something failed teaches a rep that silence
          means nothing was measured.

          It is still the way in: pressing it jumps the rail to the first
          unverified row and focuses it, which is « the gate opens on the doubt »
          (DEC-4, DEC-21). It stays a control while there is a doubt to reach and
          becomes a plain line when there is none, because a control that goes
          nowhere is the dead button DEC-26 refuses.

          **It stays in this row rather than moving over the rail it counts, and
          that is measured rather than preferred.** Taking a `min-h-[24px]`
          control out of this header gives both scrollers about eleven pixels, and
          `review-modele-differe` — the staging that asserts a deferred rewrite
          gives *Valider* back at **zero** page turns — went from six passes in six
          to three in six at 1280×800, in both directions: the gate withheld, and
          a page turn oscillating between the two columns. The guard is knife-edge
          on that fixture and this row is part of what holds it there.
        */}
        {faible.length === 0 ? (
          <span className="text-muted shrink-0 text-meta">
            {panel.fields.length} champs · tous vérifiés
          </span>
        ) : (
          <Button variant="link" className="text-muted shrink-0" onClick={focusFirstFaible}>
            {`${panel.fields.length} champs · ${panel.fields.length - faible.length} vérifiés`}
          </Button>
        )}
      </header>

      {failure ? (
        <p role="alert" className="text-danger border-subtle border-b px-gutter py-1.5 text-ui">
          {failure}
        </p>
      ) : null}

      {/*
        **The two columns are bounded, because the pair is the point.**

        The rail is capped at 560px and the document column took whatever was
        left, with the prose centred inside it at its own measure. Measured: at
        1920 that put **424px of nothing** between the last word of the
        compte-rendu and the field it is being checked against, and at 2560, 744.
        The whole argument of this layout is that the document and the eleven
        typed values are read *together* — « Objections ⚠ faible » beside the
        sentence it came from — and a rep whose eye travels seven hundred pixels
        between them is reading them one after the other.

        Capped at 1440, which is the size this screen was designed against, so a
        wider window gets the 1440 reading with the slack outside the pair rather
        than driven between its halves. `mx-auto`, so it is a margin and not a
        column that ran out.
      */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1">
        <main
          ref={docRef}
          onScroll={measure}
          className="fade-below bg-inner min-h-0 min-w-0 flex-1 overflow-y-auto px-gutter py-row"
        >
          {/*
            The measure. This column is whatever is left of the window after the
            440px rail — on a 16:9 laptop that is a thousand pixels, and the
            document was set across all of it at a hundred and thirty characters
            a line. The rep's one job here is to *read* it; a line that long is
            read by nobody, and the fault is invisible in a screenshot because
            nothing is clipped or overlapping.

            `mx-auto` rather than left-aligned: the eyebrow, the switch and the
            text then share one optical column instead of leaving a slab of
            white down the right of the pane.
          */}
          <div className="measure mx-auto">
            {/*
              **No caption over this column.**

              It read « COMPTE-RENDU », or « TRANSCRIPTION » in the third tab —
              over a document whose own first line is `# <objet>`, two inches
              under a segmented control whose current option says which of the
              three is showing, so « Transcription » was drawn twice on one
              screen. A pane is named by its content (`ui/SectionHeader.tsx`):
              this one opens on its own heading and the switch beside it says
              which view it is.

              `justify-end` and not a spacer: the row is the two controls, and
              they keep the right edge of the measure they used to share with the
              eyebrow.

              It recovers **no vertical space and that is the honest number**:
              the eyebrow sat on this row beside two controls taller than itself,
              so the column is within 4 px of where it was at both smoke sizes
              (747 → 751 at 1280×800, 547 → 551 at 960×600 — and those 4 px are
              the header above, not this row). The arming guard is therefore
              undisturbed: *Valider* still costs seven page turns at 1280×800 and
              nine at 960×600, driven, with no press that fails to move a
              scroller.
            */}
            <div className="mb-3 flex items-center justify-end gap-inline">
              {/*
                The way out of the app.

                Not every follow-up goes through Outlook and not every rep has a
                Microsoft account — the demo build has none at all (DEC-28) —
                and the compte-rendu's real second destination is a paste: into
                a mail client the app holds no token for, into Teams, into a
                proposal. `Modifier` selects inside a textarea and `Lecture`
                does not, which left the reading half of the switch with no way
                to take the text at all.

                It copies `edits.compteRendu` — what the rep has in front of
                them, corrections included, and the same string VerySwing will
                receive (DEC-44).
              */}
              <Segmented
                label="Affichage du compte-rendu"
                options={[
                  { id: 'lecture', label: 'Lecture' },
                  { id: 'modifier', label: 'Modifier' },
                  { id: 'transcription', label: 'Transcription' },
                ]}
                current={mode}
                onSelect={(next) => {
                  // Leaving the transcript forgets which citation it was opened
                  // on, so coming back cold opens at the top of the call rather
                  // than on a field the rep has since stopped thinking about.
                  if (next !== 'transcription') setFocus(null)
                  setMode(next)
                }}
              />
              {/*
                **The way out of the app, behind one glyph** — and drawn in every
                view, which the bare *Copier* it replaces was not.

                Not every follow-up goes through Outlook and not every rep has a
                Microsoft account — the demo build has none at all (DEC-28) — and
                the compte-rendu's real second destination is a paste: into a mail
                client the app holds no token for, into Teams, into a proposal.
                `Modifier` selects inside a textarea and `Lecture` does not, which
                left the reading half of the switch with no way to take the text;
                *Transcription* was given none at all, so the only tab where the
                rep is looking *away* from the document was also the only one that
                could not copy it.

                It went behind the overflow because a toolbar is a claim about
                what happens on a screen, and copying is not a third of what
                happens here — the compte-rendu is read and *Valider* is pressed
                (DEC-4). Same string either way: `edits.compteRendu`, what the rep
                has in front of them, corrections included, and byte for byte what
                VerySwing receives (DEC-44).
              */}
              {copied === 'idle' ? null : (
                <span key={copied} role="status" className="text-muted animate-fade-in text-meta">
                  {copied === 'done' ? 'Compte-rendu copié' : 'Copie impossible'}
                </span>
              )}
              <OverflowMenu
                what="le compte-rendu"
                items={[
                  {
                    id: 'copier',
                    label: 'Copier le compte-rendu',
                    onSelect: () => void copyCompteRendu(edits.compteRendu),
                  },
                ]}
              />
            </div>

            {/*
              **Which compte-rendu this is, under the document's own title, and
              one press from the other shape** (DEC-43).

              `data-unmeasured` on the wrapper, for the reason *Demander* and the
              inline `source ▸` panel carry it: the arming guard's promise is that
              everything *leaving the machine* has been shown, and a picker is not
              content. `shippedHeight` **subtracts** the marked subtree wherever it
              sits, so the panel opening in the middle of a column already read
              changes the measured height by nothing, and the chip arriving one
              invoke after the document changes it by nothing either — measured at
              both smoke sizes, **+230 px of scroll range and +0.0 px measured**.

              What the mark buys here is *not* the arming, and saying otherwise
              would be the prose this file keeps catching. Unmarked, opening the
              panel is forgiven anyway: the press is inside this column and holds
              the caret, and `read()` credits growth under the rep's own cursor —
              driven, *Valider* survives either way. What it buys is that the
              coverage keeps the **document's** content height (2 375 px) rather
              than the document plus a control (2 630 px), so the next arrival of
              real unseen prose is measured against the document instead of against
              254 px of slack a control bought.

              Absent in *Transcription*: the column then holds the record, and a
              chip naming the shape of a document that is not in the box would be
              the same defect as the sentence that used to point « à gauche » at
              it.

              Not drawn while a confirmation is in flight, either. `busy` means
              *Valider* is on the wire; offering to rewrite what is being sent is
              two writes racing for one meeting.
            */}
            {mode === 'transcription' || busy ? null : (
              <div data-unmeasured>
                {/*
                  **The chip names the document, not the choice that did not
                  run.** `recipe` is `chosen ?? meeting:get`, so the press moves it
                  immediately — which is right while a run is in flight and wrong
                  the moment the run never started: the document beside it is
                  still the old one. It also decides what `RecipeSwitch` offers,
                  and `others` excludes the current value, so a chip stuck on
                  « Compte-rendu libre » takes « Réécrire avec « Compte-rendu
                  libre » » off the screen — the retry, on the one screen where
                  the rep has just been told it did not happen.
                */}
                <RecipeSwitch
                  current={stalled ? (rewriting?.was ?? recipe) : recipe}
                  edited={edited}
                  failure={recipeFailure}
                  onRewrite={(next) => void rewrite(next)}
                />
                {/*
                  Inside `data-unmeasured` with the panel, for the same reason:
                  this is a statement about a control, not a line of the document
                  that leaves the machine, and charging the arming guard for it
                  would be charging page turns for the sentence explaining why the
                  last press cost none.
                */}
                {stalledNote !== null ? (
                  <p role="status" className="text-warn measure mb-3 text-meta font-semibold">
                    {stalledNote}
                  </p>
                ) : null}
              </div>
            )}

            {mode === 'transcription' ? (
              <TranscriptReader
                meetingId={meetingId}
                focus={focus}
                interlocuteurs={panel.interlocuteurs}
              />
            ) : mode === 'lecture' ? (
              /*
                Typeset, with every `#` and every `- ` still on screen in the
                gutter (DEC-44). `pl-6` is the gutter they hang in.
              */
              <>
                {/*
                  **Above the document, not after it.**

                  It was under the compte-rendu — which on the real document is
                  about a thousand pixels below the fold, inside a scroller, after
                  everything it exists to explain. A legend a reader reaches only
                  once they have stopped needing it is decoration.

                  The gutter is the first thing the eye lands on in this column,
                  so the sentence that accounts for it goes where the eye already
                  is: one muted line between the toolbar and the first heading.
                */}
                <CompteRenduMarkersNote className="text-muted border-subtle mb-3 border-b pb-2 text-meta" />
                {/*
                  **The two halves of this screen are two documents, and only
                  one of them is edited here.**

                  The CRM task carries `edits.compteRendu` — this text. The
                  opportunity carries the typed fields from the rail beside it.
                  Both go out on the same press, and nothing reconciles them: a
                  rep who corrects « Objections » on the right has corrected the
                  opportunity and not this paragraph, and if the extraction
                  flagged that field, the `⚠ faible` written into this string
                  (DEC-21 — the marker is in the document on purpose, so a reader
                  who never opens the form still sees it) is now stale.

                  There is no clever reconciliation to build. Regenerating the
                  prose from an edited field would put AI writing back into text
                  the rep has already corrected; propagating the edit as a string
                  replacement would be a find-and-replace inside a paragraph
                  nobody asked us to touch. What the screen owes is the sentence,
                  once, where the confusion happens.
                */}
                {faible.length > 0 ? (
                  <p className="text-muted measure mb-3 text-meta">
                    {/* Conditional, because the first half was a false statement
                        on exactly the gate where it mattered: it asserted that
                        corrections « vont dans l'opportunité » two inches above
                        an opportunity row reading « Indisponible ». */}
                    {typedInert === null
                      ? 'Les corrections faites à droite vont dans l’opportunité. '
                      : 'L’opportunité ne part pas, donc les valeurs de droite non plus. '}
                    Ce texte-ci part dans la tâche VerySwing tel qu’il est affiché — s’il porte
                    un <span className="text-warn">{FAIBLE}</span> que vous avez levé,
                    corrigez-le dans « Modifier ».
                  </p>
                ) : null}
                {/*
                  Every fragment the model quoted opens the record on it — the
                  same reader `source ▸` opens, and the same one that says
                  « introuvable » and seeds its search when the quote is not
                  there. The prose is what VerySwing receives; until now it was
                  the only claim on this screen with no way to check it.
                */}
                <CompteRenduDocument
                  text={edits.compteRendu}
                  onQuote={(quote) => locate({ quote, label: 'compte-rendu', from: 'answer' })}
                  sources={panel.sources}
                />
              </>
            ) : (
              /*
                Not `font-mono`. The compte-rendu is a document the rep reads and
                edits, and the monospace read as a log dump of something the
                machine had produced rather than as prose they own (`5.3 Revue`
                sets it in the body face at 13/1.5).

                Bordered, unlike the borderless field it replaced: this is the
                editing half of a switch, and a box is what says the switch
                landed. `min-h` rather than a height computed off the pane, so it
                grows with the document instead of scrolling inside a scroller.
              */
              <textarea
                aria-label="Compte-rendu"
                value={edits.compteRendu}
                onChange={(event) => set('compteRendu', event.target.value)}
                rows={Math.max(20, edits.compteRendu.split('\n').length + 2)}
                className="text-body border-subtle bg-inner w-full resize-none rounded-sm border p-3 text-copy leading-relaxed [field-sizing:content]"
              />
            )}

            {/*
              The follow-up, under the document it summarises.

              It lived in the rail, which is where every *typed* value lives —
              and it is not one. It is five paragraphs of French prose the rep is
              about to send to a client, and a 500px column made it the thing
              that pushed eleven fields and the decision itself out of the
              window. Here it has the same measure as the compte-rendu, reads at
              the same size, and sits under the text it was written from, which
              is the order a rep checks them in.

              Drawn in every mode, including *Transcription*: a rep who went to
              the record to settle one field is still about to send this, and
              hiding it behind a tab they did not choose would be a draft that
              disappears.
            */}
            <MailDraft
              subject={edits.mailSubject}
              body={edits.mailBody}
              to={panel.mailTo}
              onSubject={(value) => set('mailSubject', value)}
              onBody={(value) => set('mailBody', value)}
            />

            {/*
              *Demander*, under everything it can be asked about — and here its
              citations are **followable**, because the transcript is one tab
              away in this very column.

              That is the version of this feature that beats a general-purpose
              notetaker's ask box outright: theirs answers from a document the
              model itself wrote, so a mistake in the summary becomes a mistake
              in the answer with nothing left to check it against. Here a rep
              reads the answer, presses the quote under it, and lands on the
              second of the recording it came from — and a quote the app could
              not find says so instead of being quietly dropped (DEC-21).

              It writes nothing and confirms nothing (DEC-4, DEC-5). The one
              button on this screen is still the one button.
            */}
            {/*
              **Not part of what ships, and marked so the guard knows.**

              `data-unmeasured` is read by `read()`: the arming guard's promise
              is that everything *that leaves the machine* has been shown, and an
              answer leaves nothing — it is a read over the record, like
              *Historique* (DEC-25). Left inside the measurement it cost the rep
              seven page turns at 1280×800 and ten at 960×600 for asking one
              question, because a 216-pixel answer is content that appeared after
              the column was read. Following a citation — the same evidence, one
              tab away — costs nothing, because the transcript is its own view.
              The one feature this product has over a general-purpose
              notetaker's chat box was the only thing on the screen being
              punished.
            */}
            <div data-unmeasured>
              <AskPanel
                meetingId={meetingId}
                interlocuteurs={panel.interlocuteurs}
                onLocate={(quote, label) => locate({ quote, label, from: 'answer' })}
                className="border-subtle mt-block border-t pt-row"
              />
            </div>

            {/*
              The turn for *this* column, at the end of it. Only when this column
              is the one still holding something under its fold — the other one
              carries its own, and two would be a screen asking a rep to guess
              which of them the guard is about.
            */}
            {below === 'document' && !busy ? (
              mode === 'transcription' ? (
                /*
                  **The escape, as the control — because there is no page of *this*
                  document left to turn here.**

                  What the guard is waiting on is the compte-rendu, and in this tab the
                  compte-rendu is not in the column: the box holds the transcript, which
                  ships nothing and is measured by nothing. So the only control that can
                  reach the unread pixels is the one that *leaves this tab*, and the
                  previous version offered a page turn instead — which moved the
                  transcript, forever, under a sentence naming the compte-rendu (see
                  `unread` for the two measurements).

                  It was labelled « Lire la suite de la transcription », which was the
                  round before this one's fix: the label had been the compte-rendu's on
                  both tabs, so it was made to name what was in the column. Naming it
                  correctly is what made it possible to see that it should not be there —
                  the honest label described a control that could not do the job the slot
                  is for.

                  The escape already existed — one click on « Lecture », two inches up —
                  and nothing on screen named it, which is the whole cost this closes:
                  minutes and trust, not a lost compte-rendu. It is a live control and not
                  a sentence, because « while it is withheld the primary slot holds the
                  control that *shows* the rest » (DEC-4, DEC-21), and this is that
                  control: one press and the blocking document is on screen, at the
                  position the rep left it, with its own page turn under it.

                  It confirms nothing, it contributes no coverage, and it is not in
                  *Valider*'s rectangle — the two pair with `review-garde-citation`, which
                  asks that following a citation stay free, and `review-garde-tapis`, which
                  asks that the way back exist.

                  `setFocus(null)` for the reason the *Segmented* handler does it: leaving
                  the transcript forgets which citation it was opened on, so coming back
                  cold opens at the top of the call rather than on a field the rep has
                  since stopped thinking about.
                */
                <PageTurn
                  what="Revenir au compte-rendu"
                  onTurn={() => {
                    setFocus(null)
                    setMode('lecture')
                  }}
                />
              ) : (
                <PageTurn
                  what={
                    unreadIsAbove('document')
                      ? 'Remonter dans le compte-rendu'
                      : 'Lire la suite du compte-rendu'
                  }
                  onTurn={() => turn('document')}
                />
              )
            ) : null}
          </div>
        </main>

        {/*
          Floor and ceiling rather than a bare `flex-[2]`, for the reason the
          session panes carry one: this column holds every editable field on the
          screen, and a two-word label wrapping to three lines on a laptop is how
          a rep misses the `⚠ faible` beside it.

          The ceiling was 440px, chosen to leave the compte-rendu the larger
          half. That was the wrong way round. The document is 560px of prose and
          reads at a measure; the rail is eleven fields, a group chip list, a
          two-paragraph mail draft and the decision — and it was the half being
          squeezed, so every intent summary clipped mid-word and the mail body
          scrolled inside the page's other scroller. The document keeps its
          measure and gives the rest back.
        */}
        <aside className="border-subtle bg-card-soft flex w-[42%] min-w-[380px] max-w-[560px] shrink-0 flex-col border-l">
          {/*
            The rail scrolls; the gate does not.

            Everything a rep confirms — eleven fields, the account candidates,
            the interlocutors, a two-paragraph mail draft — used to sit in one
            scroller *above* « Ce qui sera créé » and the single button. At
            1440×900 the one irreversible control in the product was some nine
            hundred pixels below the fold, and the three lines that say what it
            will do went with it. A rep who never scrolled saw a form and no
            way out of it.

            So the rail is a column: fields scroll, the decision is pinned. That
            is not a second gate (DEC-4) — it is the same one button, kept where
            it can be read together with the rows it ships.
          */}
          <div
            ref={railRef}
            data-rail
            onScroll={measure}
            /*
              `pb-block` on top of `py-row`, and it is not decoration.

              Two things sit at the bottom of this scroller — the group chips and
              « Interlocuteurs : … », the list of people the Outlook draft goes to
              — and the pinned « Ce qui sera créé » panel begins at the scroller's
              bottom edge to the pixel. The detector measured the recipients line
              at `top: 503.30` and the panel at `top: 503.30`: at the scroll
              position the gate opens on, the names of the people about to be
              mailed were exactly one hundred per cent hidden, on the screen whose
              only job is to show a rep what they are about to send.

              Trailing space also lets the *last* rows reach the top of the
              column, which is what the `⚠ faible` jump needs: without it the
              scroller hits its maximum before the target row gets there and the
              rep lands on a value box whose label has been sheared off above it.
            */
            className="fade-below min-h-0 flex-1 overflow-y-auto px-row pb-block pt-row"
          >

          <SectionHeader>Prêt à envoyer</SectionHeader>

          {/*
            **The sentence, once, above the rows it applies to.**

            Nine of the eleven rows are the opportunity's columns; the other two
            — the objet and the account — are the CRM task's. So when the
            opportunity is not shipping, nine rows on this rail lead nowhere,
            and saying it nine times would be a wall. Said once, above them,
            with the reason the opportunity is not shipping and the place that
            still is.
          */}
          {typedInert ? (
            <p className="measure text-warn mb-2 text-ui">
              {typedInert} Les valeurs ci-dessous ne partiront pas : corrigez le compte-rendu à
              gauche, c’est lui qui part dans la tâche VerySwing.
            </p>
          ) : null}

          <List as="div" className="bg-card">
            {panel.fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={String(edits[EDIT_KEY[field.key]] ?? '')}
                onChange={(value) => set(EDIT_KEY[field.key], value)}
                onLocate={locate}
                inert={INTERPRETIVE.has(field.key) ? typedInert : null}
              />
            ))}
          </List>

          {panel.accountCandidates.length > 0 ? (
            <div className="mt-2">
              {/*
                The label states the *verb*, not the category.

                « Autres sociétés du même groupe : » followed by two chips names
                what they are and never what pressing one does — which is the
                same defect as a pane toggle labelled « Volets »: a control whose
                effect has to be guessed, on the screen where the guess writes to
                a client's CRM. The account is a row above with a value in it, so
                what a chip does is *replace* that value, and the sentence says
                so.
              */}
              <p className="text-muted text-meta">
                Rattacher plutôt à une autre société du groupe :
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {panel.accountCandidates.map((candidate) => (
                  <li key={candidate.accountId ?? candidate.name}>
                    <Chip
                      variant="choice"
                      onClick={() => {
                        set('accountId', candidate.accountId)
                        set('accountName', candidate.name)
                      }}
                    >
                      {candidate.name}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-muted mt-3 text-ui">
            <span className="text-body">Interlocuteurs</span> :{' '}
            {panel.interlocuteurs.length === 0
              ? 'aucun au calendrier'
              : panel.interlocuteurs.map((a) => a.name || a.email).join(', ')}
          </p>

          {below === 'rail' && !busy ? (
            <PageTurn
              // The rail's own ground, so the gradient ends in the colour the
              // column is actually painted.
              ground="var(--bg-card-soft)"
              what={
                unreadIsAbove('rail')
                  ? 'Remonter dans ce qui part'
                  : 'Voir la suite de ce qui part'
              }
              onTurn={() => turn('rail')}
            />
          ) : null}

          </div>

          <div className="border-subtle bg-card shrink-0 border-t px-row py-row">
            <fieldset>
              <SectionHeader as="legend" className="mb-2">
                Ce qui sera créé
              </SectionHeader>
              {intents.map((intent) => (
                <IntentRow
                  key={intent.id}
                  intent={intent}
                  checked={checked.includes(intent.id)}
                  onToggle={() => toggle(intent.id)}
                  connector={connectorFor(intent.kind, health)}
                  onRetry={retry}
                />
              ))}
            </fieldset>

            {/*
              One button (DEC-4). It ships everything still checked, together, and
              the rep is never asked again — `confirm` is legal from
              `awaiting_confirmation` and nowhere else, so a second press is
              refused by the machine rather than by a flag here.
            */}
            {/*
              **The confirmation is never in the rectangle the rep just pressed.**

              The page turn used to live here, in this exact slot, and swap to
              *Valider* the instant the last screenful landed. Colour was not the
              problem: React reused the same `<button>` at the same tree position,
              so the two were **the same DOM node in the same 505×37 rectangle**,
              and the swap took sixty-three milliseconds. Three ways in, all of
              them reproduced: a double-click on the fourth turn shipped to the
              CRM without the rep ever seeing the word *Valider*; a keyboard rep
              pressing Enter five times on the retained focus shipped on the
              fifth; and the first frame of every gate painted the ship's fill
              under the page turn's label, because the base `transition` animated
              one into the other. `POST /v1/crm/tasks` has no idempotency key —
              there is no undo for any of them.

              So the page turn is not here any more. It is at the foot of the
              column it turns (`PageTurn`, below), which is where a rep who has
              just finished a screenful is already looking — and this slot holds
              the decision, or nothing. Nothing is not a greyed *Valider*: the
              sub-line under it says what is left to read, and the control that
              does it is at the end of the text being read.
            */}
            {/*
              **The slot is the same height whether or not the button is in it.**

              Measured at 960×600 on the `review` fixture: arming the gate put
              34.6px of button and 16px of margin into this footer, and the rail's
              scroller lost exactly those 51px — against a `SHRINK_SLACK` of 64
              that was sized when the withheld sub-line wrapped to three lines and
              the move was sixteen. Shortening that sentence to one line made the
              move fifty-one, and `review-modele-differe` went from five passes in
              five to one in five: arm, reflow, shrink, invalidate, disarm. So the
              button's rectangle is reserved while it is withheld — empty, not
              greyed (DEC-26) — and the sub-line sits where it will sit once the
              button is there.
            */}
            {armed ? (
              <Button
                /*
                  **The one measurement this product makes about itself reaches
                  the one button it makes** (DEC-21).

                  A gate with an unverified field drew a *Valider* pixel-identical
                  to a gate where every citation had been found: same mid-blue,
                  same word. The `⚠` sat in a banner above and in a row below, and
                  the control between them ignored both — so the marker degraded
                  into decoration on the only screen where it costs anything.

                  Still one button, one gesture, nothing withheld (DEC-4). It
                  says what it is about to do, and it looks like what it is about
                  to do.
                */
                variant={faible.length > 0 && !busy ? 'caution' : 'primary'}
                block
                className="mt-4 py-2"
                onClick={() => void confirm()}
                {...unavailable(busy, 'Envoi en cours. Ne fermez pas la fenêtre.')}
              >
                {busy
                  ? 'Envoi…'
                  : faible.length === 0
                    ? 'Valider'
                    : faible.length === 1
                      ? 'Valider malgré 1 champ non vérifié'
                      : `Valider malgré ${faible.length} champs non vérifiés`}
              </Button>
            ) : (
              <div aria-hidden className="mt-4 min-h-[35px]" />
            )}
            {/*
              The sub-line, and while there is no button above it, it is the
              whole of the slot.

              That is not a greyed *Valider*, which is what this screen refuses:
              it names what is left and where the control that does it is — at
              the foot of the column being read, which is where the rep's eyes
              already are. When a citation failed it names the field, because
              « 1 champ non vérifié » on the button is a count and the rep's next
              question is *which*; otherwise it is the reassurance about Outlook,
              which is only worth the line when there is nothing louder to say.

              **And a rewrite waiting to land comes first, because it is the one
              case where nothing under the fold is what the slot is empty for.**
              With the coverage no longer cleared at the press, a rep who had read
              both columns has `below === null` — so the old ladder fell straight
              through to the reassurance about Outlook, under a slot whose button
              had just vanished, which is the silence R33-1 is. It is stated here
              and not only beside the chip because this is where the control was.
            */}
            <p
              className={cn(
                // `.measure`, because this line used to be ninety-seven
                // characters and was the one `line-length` finding on the screen
                // — on the sentence a rep reads under time pressure.
                //
                // **It is one line now, and the clause that went is the
                // justification, not the fact.** « Tout ce qui part doit avoir
                // été affiché avant d’être validé — il reste du compte-rendu, à
                // gauche. » is ninety-seven characters at `--type-meta` inside a
                // 58ch measure: three wrapped lines under an empty primary slot,
                // of which the rep needs the last eight words. What is left says
                // *what* is unread and *where*, which is the pair the control at
                // the foot of that column acts on; the rule it used to recite is
                // already said by that control's own label and by the
                // « Ce qui sera créé » list above the slot.
                'measure mx-auto mt-1.5 text-center text-meta',
                (faible.length > 0 && armed && !busy) || stalled ? 'text-warn' : 'text-muted',
              )}
            >
              {pendingLine !== null && !busy
                ? pendingLine
                : below !== null && !busy
                ? below === 'document'
                  ? // « à gauche » is where the compte-rendu is in two of the three tabs.
                    // In *Transcription* it is not in the column at all, and the sentence
                    // pointing at a box holding another document is the half of this
                    // defect the rep could read: it named the compte-rendu while the only
                    // control offered moved the transcript. It names the way back now,
                    // which is also what the control at the foot of that column does.
                    mode === 'transcription'
                    ? 'Il reste du compte-rendu à lire, sous « Lecture ».'
                    : 'Il reste du compte-rendu à lire, à gauche.'
                  : unreadIsAbove('rail')
                    ? 'Il reste des champs à lire, plus haut.'
                    : 'Il reste des champs à lire, plus bas.'
                : stalled && !busy
                  ? `La réécriture n’a pas démarré : ce que « Valider » envoie est le compte-rendu affiché à gauche, avec vos corrections.`
                  : faible.length > 0 && !busy
                    ? `${faible.map((field) => field.label).join(', ')} — introuvable dans la transcription.`
                    : reassurance}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}


interface FieldRowProps {
  field: ReviewField
  value: string
  onChange: (value: string) => void
  /** Open the transcript on this field's citation, in the other column. */
  onLocate: (focus: TranscriptFocus) => void
  /**
   * **Why editing this row would change nothing** — or `null`, the ordinary case.
   *
   * The nine interpretive fields are the *opportunity's* columns and nothing
   * else's: the CRM task carries the compte-rendu and the mail carries its own
   * body. So when the opportunity is not shipping — an account the CRM could
   * not match, or the rep unchecked it — a correction typed here reaches
   * nothing at all, and the row was pixel-identical to one that ships. Nine
   * live textareas whose edits go nowhere is the dead control DEC-26 forbids,
   * in its purest form: the rep corrects the objection this screen is
   * architected around, presses *Valider*, and VerySwing gets the model's
   * uncorrected text.
   *
   * Read-only and *stated*, rather than hidden: the value, its citation and its
   * `⚠ faible` are still worth reading — checking is what this screen is for —
   * and the sentence names the place that does still ship, which is the
   * compte-rendu in the other column.
   */
  inert: string | null
}

/**
 * The nine rows the model interpreted, and therefore the nine the opportunity
 * carries. The other two — the objet and the account — are the CRM task's, and
 * ship whatever the opportunity does.
 */
const INTERPRETIVE: ReadonlySet<ReviewField['key']> = new Set([
  'besoin',
  'profils',
  'modeCollaboration',
  'tjm',
  'dateDemarrage',
  'dureeMission',
  'contexteTechnique',
  'objections',
  'prochainesEtapes',
])

/**
 * One editable row with its `[source ▸]`.
 *
 * The affordance is on every row, including the two that were never
 * interpreted — it is the answer to "where did this come from?", and
 * « du calendrier, jamais de la transcription » is exactly the answer for those
 * two (DEC-7). A row that simply had no button would read as an oversight.
 */
function FieldRow({ field, value, onChange, onLocate, inert }: FieldRowProps) {
  const [open, setOpen] = useState(false)
  const multiline = MULTILINE.has(field.key)

  return (
    /*
      `scroll-mt-10`: the gate scrolls to the first unverified row on open, and
      `block: 'center'` in a 500px column put the *previous* row's value box at
      the top with its label sheared off above it. The row is brought to the top
      of the scroller with a row's worth of margin over it, so what a rep lands
      on is a whole field.
    */
    <div id={`row-${field.key}`} className="scroll-mt-10 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <label className="text-muted w-28 shrink-0 text-meta" htmlFor={`field-${field.key}`}>
          {field.label}
        </label>
        {/*
          The verdict, on every row (DEC-21).

          `⚠ faible` used to be the only marker on the screen, so a field the
          app had checked against the transcript and a field it had never looked
          at rendered as the same pixel: nothing. Confidence is *measured* here —
          showing only the failures throws the measurement away and leaves the
          rep to assume the silence means yes.

          Three states, and the data already distinguishes all three: a verified
          quote and where in the call it was said; a citation the transcript does
          not contain; and a value that was never interpreted at all, which is
          the correct answer for the two deterministic rows (DEC-7) and is not a
          weaker version of the first.
        */}
        {field.confidence === 'faible' ? (
          /*
            **`font-semibold`, because the colour is not a difference.**

            `--warn` and `--text-muted` have relative luminances of 0.158 and
            0.157: measured, the contrast between « ⚠ faible » and « vérifié ·
            6:36 » — same size, same weight, adjacent columns — is **1.0 to 1**.
            On a greyscale print, through a projector, or to a deuteranope, the
            one measurement this product makes about itself was invisible, and
            the 11px `⚠` glyph was carrying it alone.

            Weight is the cheapest non-chromatic difference there is, and it is
            the one the document already uses for the same token.
          */
          <span className="text-warn shrink-0 text-meta font-semibold">{FAIBLE}</span>
        ) : field.span === null ? (
          <span className="text-muted shrink-0 text-meta">hors transcription</span>
        ) : (
          <span className="text-muted shrink-0 text-meta tabular-nums">
            {/* A batch provider reports no acoustic time (DEC-41), so a verified
                span can legitimately have no offset. It still verified. */}
            {field.span.startMs === null ? 'vérifié' : `vérifié · ${formatOffset(field.span.startMs)}`}
          </span>
        )}
        {/*
          `min-h-[24px]` and centred, not more padding: this sits on the row's
          baseline beside the label and the verdict, and growing the box
          downward would push all three apart on eleven rows. Seventeen pixels
          tall is a control a trackpad misses, and the row below it is a field
          nobody meant to touch (WCAG 2.2 target size — `shot.mjs --targets`).
        */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-muted hover:text-body -my-1 ml-auto inline-flex min-h-[24px] shrink-0 items-center text-meta"
        >
          {`source ${open ? '▾' : '▸'}`}
        </button>
      </div>

      {/*
        `readOnly`, not `disabled`: the text stays selectable and readable at
        full contrast, which is the whole reason the row is still drawn. A
        disabled field greys its own value, and the value is the thing being
        checked.
      */}
      {multiline ? (
        <textarea
          id={`field-${field.key}`}
          value={value}
          /*
            **The same defect as the mail body, on eleven rows instead of one,
            and this time under the caption that makes the claim.**
            `rows` counts *newlines*; a rep reads *wrapped* lines. And the
            `min(6, …)` cap made it worse than the draft's: a nine-line
            « Prochaines étapes » drew six rows and put three lines behind a
            scrollbar **at every width**, 1280×800 included. At 960×600 — which
            is not hypothetical, it is the `minWidth`/`minHeight` `main.ts`
            enforces — three fields hid text at once, « Point de calage la
            semaine suivante » among them, a commitment that goes into the
            VerySwing task.
            The arming guard cannot see any of it. It measures the two columns
            and these are eleven scrollers *inside* one of them, so the button
            armed over text never drawn, under « Tout ce qui part doit avoir été
            affiché avant d'être validé ». `field-sizing: content` is the
            engine's own measurement of wrapped height and there is no ceiling:
            a field with more to say makes the column longer, which the guard
            *does* measure and does charge a page turn for.
          */
          rows={Math.max(2, value.split('\n').length)}
          onChange={(event) => onChange(event.target.value)}
          readOnly={inert !== null}
          className={cn(
            // `.measure` here rather than on a wrapper: `ch` resolves at the
            // element's own size, and these are `--type-ui` inside a rail sized
            // for `--type-copy` — 78 characters a line at 1440 and above.
            'measure text-strong border-subtle mt-1 w-full resize-none rounded-sm border px-2 py-1 text-ui [field-sizing:content]',
            inert === null ? 'bg-inner' : 'bg-subtle',
          )}
        />
      ) : (
        <input
          id={`field-${field.key}`}
          value={value}
          {...(PLACEHOLDER[field.key] ? { placeholder: PLACEHOLDER[field.key] } : {})}
          onChange={(event) => onChange(event.target.value)}
          readOnly={inert !== null}
          className={cn(
            'text-strong placeholder:text-muted border-subtle mt-1 w-full rounded-sm border px-2 py-1 text-ui',
            inert === null ? 'bg-inner' : 'bg-subtle',
          )}
        />
      )}

      {open ? (
        /*
          `data-unmeasured`: this is provenance, and provenance does not ship.

          The guard's caption says « tout ce qui part doit avoir été affiché »,
          and what leaves here is the field above — never the quote under it,
          which is the transcript by another route (DEC-25, `attachTranscript`
          is `UNWIRED`). Inside the measurement it was 200-odd pixels of content
          arriving after the column had been read, so opening five sources — the
          gesture DEC-21 exists to invite — deleted the coverage and took
          *Valider* off a screen that was otherwise pixel-identical to the armed
          one. Closing them again did not give it back.

          The same mark *Demander* carries, for the same reason, in the other
          column.
        */
        <div data-unmeasured className="mt-1">
          {/*
            `.measure` on the paragraph: it holds the quote itself, which is the longest
            prose on the row — 88 characters a line at `--type-meta`, measured on
            `review-transcription-introuvable`. The wrapper above is sized for
            `--type-copy` and `ch` resolves against the element's own size.
          */}
          <p className="text-muted measure text-meta italic">
            {field.span
              ? `« ${field.span.quote} »${
                  field.span.startMs === null ? ' — introuvable dans la transcription' : ` — ${formatOffset(field.span.startMs)}`
                }`
              : 'Du calendrier Outlook et de VerySwing — jamais lu sur la transcription.'}
          </p>
          {/*
            The quote, in the conversation it was said in.
            
            A fragment with no context is evidence a rep cannot weigh: « TJM
            2025 jugé trop haut par les achats » is a sentence somebody is about
            to send to a CRM under their own name, and until now the only thing
            behind it was forty characters and nowhere to go. This opens the
            record in the column next door, on that line.

            Drawn only where there is a citation to follow. The two
            deterministic rows never had one (DEC-7) and their disclosure says
            so in a sentence; a jump there would be a control that lands nowhere.
          */}
          {field.span ? (
            <Button
              variant="link"
              className="mt-0.5 text-meta"
              onClick={() =>
                onLocate({
                  quote: field.span?.quote ?? '',
                  label: field.label,
                  channel: field.span?.channel ?? null,
                })
              }
            >
              Voir dans la transcription ›
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

interface MailDraftProps {
  subject: string
  body: string
  to: readonly string[]
  onSubject: (value: string) => void
  onBody: (value: string) => void
}

/**
 * Previewed inline and editable (VISION.md §6). A draft, never a send (HR-8).
 *
 * With no Microsoft account there are no recipients — they are deterministic
 * and come from the Graph event (DEC-7) — so `mail.draft` is not draftable and
 * nothing here will be created. *Ce qui sera créé* says so, but it says so
 * **below** this section, which is a rep editing a follow-up for two minutes
 * and only then reading that it goes nowhere. The consequence therefore appears
 * on the line the rep reads first.
 *
 * The fields stay editable on purpose rather than being disabled: without
 * Outlook this text is the one thing a rep can select and paste into their own
 * mail client, and a read-only textarea would take that away to make a point.
 */
function MailDraft({ subject, body, to, onSubject, onBody }: MailDraftProps) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center gap-inline">
        {/*
          « (brouillon) » is a promise about what will be created, so it is only
          made when one will be. With no Microsoft account the Outlook intent is
          refused two rows down and this text is the one thing a rep can take —
          which is what the recipient line says, and what the eyebrow now says
          with it instead of against it.
        */}
        {/*
          `h2`, not `h3`. It was a level under the « COMPTE-RENDU » eyebrow that
          used to head this column; that eyebrow named furniture and is gone, and
          `--a11y` caught the hole it left on the first run — « niveau de titre
          sauté (h1 → h3) », at both sizes. This is now the first section heading
          in the column and sits at the same level as « Prêt à envoyer » beside
          it, which is what it always was: a second document on the screen.
        */}
        <SectionHeader className="mb-0 min-w-0 flex-1">
          {to.length === 0 ? 'Email de relance — à copier' : 'Email de relance (brouillon)'}
        </SectionHeader>
        {/*
          Subject and body together, in the shape a mail client expects — the
          rep pastes one thing, not two. This is the control the sentence above
          (« le texte reste copiable ») was promising with no Outlook token, and
          it is the whole follow-up path in the build the first demo ships in.
        */}
        <CopyButton text={`${subject}\n\n${body}`} what="le brouillon de relance" />
      </div>
      {/*
        `.measure` on the paragraph and not only on the wrapper around it: `ch` resolves
        against the element's *own* size, so a wrapper wearing the class at `--type-copy`
        leaves this `--type-meta` line unconstrained. It measured **90 characters** —
        which is the wrapper-versus-element failure this rule already records at eighty,
        on the same screen, one press before the VerySwing task and the Outlook draft.
      */}
      <p className="text-muted measure mb-1 text-meta">
        À :{' '}
        {to.length === 0
          ? 'aucun destinataire — aucun brouillon ne sera créé, le texte reste copiable'
          : to.join(', ')}
      </p>
      <input
        aria-label="Objet du brouillon"
        value={subject}
        onChange={(event) => onSubject(event.target.value)}
        className="text-strong bg-inner border-subtle w-full rounded-sm border px-2 py-1 text-ui"
      />
      {/*
        Sized to the draft, not to a guess. `rows={8}` clipped a fourteen-line
        follow-up inside a 215px scroller *inside* the rail's scroller, so the
        rep approved a mail whose sign-off they had never seen — two nested
        scrollbars on the one screen where nothing may be missed.
      */}
      <textarea
        aria-label="Corps du brouillon"
        value={body}
        /*
          `rows` counts *newlines*, and the lines a rep reads are wrapped ones:
          a nine-line draft in a 600px column is fourteen, so the box scrolled
          inside a column that scrolls inside a screen and the sign-off was
          behind two scrollbars. `field-sizing: content` is the measurement,
          done by the engine — Chromium-only, which here is every target
          (`MeetingTitle` leans on the same fact), and `rows` stays as the floor
          for anything that does not have it.
        */
        rows={Math.max(6, body.split('\n').length + 1)}
        onChange={(event) => onBody(event.target.value)}
        /*
          `.measure` **on the textarea itself**, and that is the whole of the
          fix. The class caps at `58ch` and `ch` resolves against the *element's*
          own font size — so a wrapper wearing it at `--type-copy` leaves a child
          at `--type-ui` completely unconstrained, which is how the follow-up
          draft rendered **eighty** characters a line while `--prose` reported
          the screen green. CLAUDE.md's own invariant names this draft as one of
          the surfaces sharing the measure. It never has.
        */
        className="measure text-body bg-inner border-subtle mt-1 w-full resize-none rounded-sm border px-2 py-1 text-ui leading-relaxed [field-sizing:content]"
      />
    </section>
  )
}

/** Which connector each intent needs. */
const CONNECTOR_OF: Record<ReviewIntent['kind'], ConnectorId> = {
  'crm.task': 'crm',
  'crm.opportunity': 'crm',
  'mail.draft': 'mail',
}

/**
 * A connector that is not `ok`. Narrowed here, once, so the row below reads as
 * the rule rather than as a chain of optional checks — and so `reason` and
 * `retryable` are simply present, which is the whole point of the contract
 * making them mandatory off `ok`.
 */
type Trouble = { id: ConnectorId; health: Exclude<ConnectorHealth, { state: 'ok' }> }

const connectorFor = (
  kind: ReviewIntent['kind'],
  health: Partial<Record<ConnectorId, ConnectorHealth>> | null,
): Trouble | null => {
  const id = CONNECTOR_OF[kind]
  const value = health?.[id]
  return value && value.state !== 'ok' ? { id, health: value } : null
}

interface IntentRowProps {
  intent: ReviewIntent
  checked: boolean
  onToggle: () => void
  /** Non-null when the connector this intent needs is degraded or down. */
  connector: Trouble | null
  onRetry: (connector: ConnectorId) => void
}

/**
 * DEC-26, and the one place its wording is easy to get backwards.
 *
 * A down connector greys the row and states the reason inline, with a retry —
 * but it does **not** disable the checkbox. The outbox drains what it cannot
 * send yet, so an intent confirmed while VSA is unreachable is queued, not
 * lost. Disabling it would send the rep away to come back later, which is
 * exactly the second prompt DEC-4 exists to prevent — and would silently turn
 * an outage into a dropped compte-rendu.
 *
 * `available: false` is a different thing and still disables: it means there is
 * nothing to send at all (no opportunity in the extraction, no recipient for a
 * draft), which no amount of reconnecting fixes.
 */
function IntentRow({ intent, checked, onToggle, connector, onRetry }: IntentRowProps) {
  const trouble = connector
  const degraded = trouble !== null

  return (
    <div
      className={`flex items-start gap-2 py-1 text-ui ${
        intent.available && !degraded ? 'text-body' : 'text-muted'
      }`}
    >
      <input
        id={intent.id}
        type="checkbox"
        checked={checked && intent.available}
        disabled={!intent.available}
        onChange={onToggle}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        {/*
          The label *is* the target — it is `for`-linked, so clicking it toggles
          the box, and a 13×13 checkbox is not something a trackpad hits.
          `min-h-[24px]` on the label rather than a chunky checkbox: the thing a
          rep aims at is the sentence, and WCAG 2.2 measures what they aim at.
        */}
        <label htmlFor={intent.id} className="flex min-h-[24px] items-center">
          {intent.label}
        </label>
        {/*
          DEC-26: a disabled control always states why, inline.

          Wrapped, not truncated. This line is the last statement of what is
          about to be written into the client's CRM, and `truncate` ended it
          mid-word — « … — Renforcer l'équipe plateforme pour la » — with no
          ellipsis and nowhere else on the screen to read the rest. Two lines,
          then an ellipsis: a summary that runs to a paragraph is still bounded,
          but the bound is no longer four words in.

          **And `block` beside it made the clamp do nothing.** Tailwind's
          `line-clamp-2` is `display: -webkit-box` plus `-webkit-line-clamp: 2`,
          and the `block` utility overwrote the display it needs — so the
          declaration resolved, the class name was right, and the element drew
          **nine lines**. The pinned footer has no ceiling of its own, so it grew
          from 313 to 432px of an 800px window on a long « besoin » and crushed
          the eleven-field rail from 434px to 315. Third of the family CLAUDE.md
          already names — `bg-muted/30`, `ring-card` — and the shape is always
          the same: a class that is spelled correctly and silently inert.
        */}
        <span className="measure text-muted line-clamp-2 text-meta">
          {intent.available ? intent.summary : intent.reason}
        </span>
        {intent.available && trouble ? (
          <span className="text-warn block text-meta">
            {trouble.health.reason} — sera envoyé dès le rétablissement.{' '}
            {trouble.health.retryable ? (
              <Button variant="link" onClick={() => onRetry(trouble.id)}>
                Réessayer
              </Button>
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * Everything the gate is while it is closed (DEC-23).
 *
 * A reason and a way back. No field names, no counts, no "3 éléments prêts" —
 * the response this renders does not contain any of that, which is the point.
 */
function ClosedGate({
  state,
  reason,
  note,
  onBack,
}: {
  state: MeetingState
  reason: string
  /**
   * What this screen knows and the state does not — today, that the rep asked
   * for the compte-rendu to be rewritten and that is why the gate closed under
   * them. Null everywhere else, because `STATE_REASON` is already the answer.
   */
  note?: string | null
  onBack: () => void
}) {
  return (
    <Centered>
      <p className="text-body text-copy">{reason}</p>
      {note ? <p className="text-body measure mt-1.5 text-ui">{note}</p> : null}
      {state === 'recording' ? (
        <p className="text-muted mt-1.5 text-ui">
          Le compte-rendu sera prêt à la fin de la réunion.
        </p>
      ) : null}
      <BackLink onBack={onBack} />
    </Centered>
  )
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="link" onClick={onBack} className="mt-3">
      Retour
    </Button>
  )
}
