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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  ReviewEdits,
  ReviewField,
  ReviewIntent,
  ReviewPanel,
} from '../../electron/core/contracts/review.ts'
import type { MeetingState } from '../../electron/core/contracts/meeting.ts'
import type { ConnectorHealth, ConnectorId } from '../../electron/core/contracts/health.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { formatOffset } from '../app/format.ts'
import {
  Button,
  Centered,
  Chip,
  CopyButton,
  List,
  SectionHeader,
  Segmented,
  unavailable,
} from '../ui/index.ts'
import { scrollToCenter, scrollToTop } from '../lib/scroll.ts'
import { useShortcuts } from '../app/shortcuts.ts'
import { cn } from '../lib/utils.ts'
import {
  CompteRenduDocument,
  CompteRenduMarkersNote,
} from './session/CompteRenduDocument.tsx'
import { AskPanel } from './session/AskPanel.tsx'
import { TranscriptReader, type TranscriptFocus } from './review/TranscriptReader.tsx'

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
  const [edits, setEdits] = useState<ReviewEdits | null>(null)
  const [checked, setChecked] = useState<string[] | null>(null)
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
   * Which citation the transcript is opened on, or null for the top of the call.
   *
   * Held here rather than in the reader because the gesture that sets it
   * happens in the *other* column: a rep presses « voir dans la transcription »
   * on a field in the rail, and the document column answers. That is the whole
   * point — the evidence and the value it justifies are side by side, and
   * neither has to be remembered while the other is found.
   */
  const [focus, setFocus] = useState<TranscriptFocus | null>(null)
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
   * The range above is a union of the viewports the column has shown, and a
   * *smooth* programmatic scroll shows every intermediate one — so the gate's
   * own jump to the first `⚠ faible` row filled the union from 0 to the target
   * on its way past, and the guard came up satisfied for a band no human eye was
   * over. That is the same failure as the old boolean, one layer subtler: the
   * measurement was of the scroller, and what it has to be of is the *rep*.
   *
   * While this is set, a measurement replaces the range instead of extending it,
   * so what survives an app-initiated jump is exactly where it landed — which is
   * the honest record of what is on screen when the rep first looks.
   *
   * Cleared on a timer rather than on `scrollend`: that event is Chromium 114+
   * and Electron ships it, but the fallback in a plain browser would be silence,
   * and silence here means the range never extends again.
   */
  const jumping = useRef(false)

  /**
   * Which columns have been shown end to end, once and for good.
   *
   * See `read` for why this is a latch: the columns grow as a rep types, and a
   * guard that re-armed on their own keystrokes would take the button away over
   * the sentence they are correcting.
   */
  const covered = useRef<Record<Column, boolean>>({ document: false, rail: false })

  /**
   * **What was covered, and of what.**
   *
   * The latch above froze an answer about *pixels*: a range recorded against one
   * content, compared to `scrollHeight` of whatever is in the column now. Two
   * ordinary gestures walked straight through it.
   *
   * **The Transcription tab.** A rep checking a quote — the DEC-21 gesture this
   * product is proudest of — opens the transcript, scrolls it to the end, and
   * comes back to *Lecture*. The transcript is short, so the column was covered;
   * the latch held; and *Valider* went live with **1700 of the compte-rendu's
   * 2447 pixels never drawn**, the entire « EMAIL DE RELANCE » block among them
   * — the subject, the recipients and the body of the mail that goes to the
   * client. On a real call the transcript is many times the document's height,
   * so this fires hardest on a *short* call, which is the one a rep reads
   * fastest.
   *
   * **A window that shrinks.** Opened on a display where both columns fit, the
   * guard is satisfied and correctly so. Shrink the window and the latch keeps
   * saying so, with seventeen hundred pixels below the fold.
   *
   * So the latch is stamped with what it was a statement about: which document
   * the column was showing, and how tall the box was. A stamp that no longer
   * matches is not a lie to be corrected — it is a measurement of something
   * else, and it is discarded.
   */
  const coveredOf = useRef<Record<Column, { content: string; height: number } | null>>({
    document: null,
    rail: null,
  })

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
      // landed on, and nothing it animated past.
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
    extend('document', docRef.current)
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
      if (!el || el.clientHeight === 0) return covered.current[column] || true

      /*
       * The stamp, checked before the latch is believed. `content` names what
       * the column is showing — the left one swaps between the document, the
       * editable copy and the transcript — and `height` is the box the range was
       * measured in. A shorter box has more below the fold than the one that was
       * covered; a taller one only ever has less, so growth is not invalidating.
       */
      const stamp = { content: column === 'document' ? mode : 'rail', height: el.clientHeight }
      const was = coveredOf.current[column]
      if (covered.current[column]) {
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
         */
        if (was && was.content === stamp.content && stamp.height >= was.height - SHRINK_SLACK) {
          return true
        }
        // Something else is in the column, or there is more of it below the fold
        // than there was. Neither is a thing the rep has read.
        covered.current[column] = false
        coveredOf.current[column] = null
        seen.current[column] = { from: el.scrollTop, to: el.scrollTop + el.clientHeight }
      }
      const range = seen.current[column]
      if (!range) return true
      const done = range.from <= 8 && range.to >= el.scrollHeight - 8
      if (done) {
        covered.current[column] = true
        coveredOf.current[column] = stamp
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
    // `mode` is read by the stamp above: the left column shows a different
    // document in each of the three, and a range measured over one of them says
    // nothing about another.
  }, [mode])

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

  const panel: ReviewPanel | null =
    loaded.state.status === 'ready' && loaded.state.value.open ? loaded.state.value.panel : null

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
    if (docRef.current) observer.observe(docRef.current)
    if (railRef.current) observer.observe(railRef.current)
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
     * Marked, so the measurement records where this lands rather than
     * everything it animates past — see `jumping`. 700ms covers Chromium's
     * smooth scroll with room; a rep's own scroll during it is at worst counted
     * as a landing, which under-credits them and never over-credits.
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
    // What the rep had typed, if they left and came back; otherwise the
    // server's pre-fill. See `PENDING_EDITS`.
    setEdits((previous) => previous ?? PENDING_EDITS.get(meetingId) ?? panel.edits)
    setChecked((previous) =>
      previous ?? panel.intents.filter((i) => i.available).map((i) => i.id),
    )
    availableBefore.current ??= new Set(
      panel.intents.filter((i) => i.available).map((i) => i.id),
    )
  }, [panel])

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
  /*
   * `Ctrl/⌘ Entrée`, and **only when the button is already armed**
   * (`app/shortcuts.ts`).
   *
   * The guard is the same one the button carries — `below === null`, meaning
   * nothing that is about to leave is still under a fold — and it is expressed
   * as the absence of a handler rather than as a handler that declines. A
   * shortcut that could confirm while *Valider* was still refusing would be a
   * second gate (DEC-4), and one that fired while the reveal control was on
   * screen would confirm something the rep has not been shown.
   */
  useShortcuts(below === null && !busy ? { valider: () => void confirm() } : {})

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
   * Which way the unread band lies, for the control's own words.
   *
   * « Lire la suite » is a lie when what has not been seen is *above* — which is
   * the ordinary case at this gate, because it opens by jumping the rail to the
   * first `⚠ faible` row. A rep told to read « la suite » and sent upwards
   * learns that the button lies about itself, on the screen whose entire claim
   * is that nothing is withheld.
   */
  const unreadIsAbove = useCallback((column: Column): boolean => {
    const range = seen.current[column]
    return range !== null && range.from > 8
  }, [])

  const turn = useCallback((column: Column) => {
    const el = column === 'document' ? docRef.current : railRef.current
    if (!el) return
    const range = seen.current[column]
    const step = Math.max(el.clientHeight - 64, 120)
    const up = range !== null && range.from > 8
    el.scrollBy({ top: up ? -step : step, behavior: 'smooth' })
  }, [])

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
        onBack={onBack}
      />
    )
  }

  if (!panel || !edits || checked === null) return <Centered>Chargement…</Centered>

  // The server's draft until the first preview lands, so the rows are never
  // blank — then what the form currently says.
  const intents = live ?? panel.intents

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
        The screen names itself (`5.3 Revue`). It used to open with the meeting
        title and nothing else, which left the one irreversible screen in the
        product looking like a second view of the meeting — a rep who arrives
        here from a broadcast has to be told, in a word, that this is the gate.
        The meeting is the line under it, where the design puts it.
      */}
      <header className="border-subtle flex shrink-0 items-center gap-inline border-b px-gutter py-3">
        <Button variant="nav" onClick={onBack}>
          ‹ Calendrier
        </Button>
        <span aria-hidden className="border-subtle h-4 shrink-0 border-l" />
        <h1 className="font-display text-strong shrink-0 text-display leading-none">Revue</h1>
        {/*
          The client, unless the title already says it.

          « Néovia Santé — cadrage renfort data · Néovia Santé » is the account
          name printed twice on one line, which is how a rep learns to stop
          reading the end of it. Meeting titles in this trade almost always open
          with the client, so the common case is the redundant one.
        */}
        <p className="text-muted min-w-0 flex-1 truncate text-ui">
          {panel.meeting.title}
          {edits.accountName && !panel.meeting.title.includes(edits.accountName)
            ? ` · ${edits.accountName}`
            : ''}
        </p>
        {/*
          The count, and a way to reach it.

          It read « Certains champs n'ont pas pu être vérifiés » — no number, no
          control, and the field it was about a thousand pixels down a scrolling
          column. « Certains » is the vaguest possible statement of a measured
          quantity: the app knows exactly how many and exactly which. A rep who
          reads this has one question, and the banner now answers it and then
          takes them there.
        */}
        {faible.length > 0 ? (
          /*
            `hover:text-warn` on purpose. `Button`'s `link` variant carries
            `hover:text-body`, so the one warning on the irreversible screen
            turned slate grey under the cursor — the gesture that precedes the
            click removed the colour that made it a warning. And it wears the
            same `⚠` as the rows it counts, so the banner and the field it jumps
            to are recognisably the same fact.
          */
          <Button
            variant="link"
            className="text-warn hover:text-warn shrink-0"
            onClick={focusFirstFaible}
          >
            {faible.length === 1
              ? `${FAIBLE} — 1 champ non vérifié dans la transcription`
              : `${FAIBLE} — ${faible.length} champs non vérifiés dans la transcription`}
          </Button>
        ) : null}
      </header>

      {failure ? (
        <p role="alert" className="text-danger border-subtle border-b px-gutter py-1.5 text-ui">
          {failure}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
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
            <div className="mb-3 flex items-center gap-inline">
              <SectionHeader className="mb-0 min-w-0 flex-1">
                {mode === 'transcription' ? 'Transcription' : 'Compte-rendu'}
              </SectionHeader>
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
              {mode === 'transcription' ? null : (
                <CopyButton text={edits.compteRendu} what="le compte-rendu" />
              )}
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
            </div>

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
                <CompteRenduDocument text={edits.compteRendu} />
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
            <AskPanel
              meetingId={meetingId}
              interlocuteurs={panel.interlocuteurs}
              onLocate={(quote, label) => locate({ quote, label, from: 'answer' })}
              className="border-subtle mt-block border-t pt-row"
            />

            {/*
              The turn for *this* column, at the end of it. Only when this column
              is the one still holding something under its fold — the other one
              carries its own, and two would be a screen asking a rep to guess
              which of them the guard is about.
            */}
            {below === 'document' && !busy ? (
              <PageTurn
                what={
                  unreadIsAbove('document')
                    ? 'Remonter dans le compte-rendu'
                    : 'Lire la suite du compte-rendu'
                }
                onTurn={() => turn('document')}
              />
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
            <p className="text-warn mb-2 text-ui">
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
            {below === null ? (
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
            ) : null}
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
            */}
            <p
              className={cn(
                // `.measure`, because this line is ninety-seven characters and
                // was the one `line-length` finding on the screen — on the
                // sentence a rep reads under time pressure.
                'measure mx-auto mt-1.5 text-center text-meta',
                faible.length > 0 && below === null && !busy ? 'text-warn' : 'text-muted',
              )}
            >
              {below !== null && !busy
                ? below === 'document'
                  ? 'Tout ce qui part doit avoir été affiché avant d’être validé — il reste du compte-rendu, à gauche.'
                  : unreadIsAbove('rail')
                    ? 'Tout ce qui part doit avoir été affiché avant d’être validé — il reste des champs, plus haut.'
                    : 'Tout ce qui part doit avoir été affiché avant d’être validé — il reste des champs, plus bas.'
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

/**
 * **The page turn, at the foot of the column it turns.**
 *
 * It used to live in the pinned decision slot and swap to *Valider* the instant
 * the last screenful landed — the same DOM node, the same rectangle, sixty-three
 * milliseconds apart. A double-click on the fourth turn shipped to the CRM
 * without the rep ever seeing the word; five Enters on the retained focus did
 * the same; and the first frame of every gate painted the ship's fill under the
 * turn's label, because the shared `transition` animated one into the other.
 * `POST /v1/crm/tasks` has no idempotency key, so none of the three has an undo.
 *
 * Here it is in the flow instead, after the last thing to read, which is where a
 * rep who has just finished a screenful is already looking. It is not the
 * decision's slot, it is not the decision's shape, and the two never occupy one
 * rectangle — which is the property that makes the gesture a decision rather
 * than a repetition.
 *
 * **One screenful, not the whole column.** The scroll used to jump to
 * `scrollHeight`, so the guard could be satisfied by two presses of a button the
 * rep never took their eyes off — a EULA checkbox with better copy. Arming is
 * measured from the scroll either way (`atEnd` fires from this, never from the
 * click), but a measurement of a single teleport measures *revealing*. `- 64`
 * overlaps two lines across the turn so nothing falls into the seam.
 */
function PageTurn({
  what,
  onTurn,
  ground,
}: {
  what: string
  onTurn: () => void
  /** The colour the column is painted, for the gradient the button sits on. */
  ground?: string
}) {
  return (
    /*
      **Sticky, because a control at the end of the content is a control nobody
      reaches.**

      The first version sat after the last paragraph. Measured on the document
      column at 1280×800 — 2508px of content in a 747px box — it was fully
      visible for sixteen pixels of a 1761-pixel scroll: **nine-tenths of one per
      cent**, and inside that window the scroll it performs is a no-op because
      the column is already at its end. Wheel-scrolled from the top in 200px
      steps it never entered the viewport once. The harness only ever clicked it
      because Playwright scrolls a target into view first, and the keyboard only
      because focus does — which is precisely the « a teleport measures
      *revealing* » failure this control exists to prevent.

      Pinned to the bottom of its own scroller instead: reachable at every scroll
      position, in the column whose text it turns, and never in the decision's
      rectangle. `pointer-events-none` on the row and `auto` on the button so the
      band it floats over stays scrollable and selectable.
    */
    <div
      className="turn-ground pointer-events-none sticky bottom-0 z-10 flex justify-center pb-2 pt-8"
      {...(ground ? { style: { ['--turn-ground' as string]: ground } } : {})}
    >
      <Button variant="bordered" className="pointer-events-auto shadow-sm" onClick={onTurn}>
        {what}
      </Button>
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
          rows={Math.min(6, Math.max(2, value.split('\n').length))}
          onChange={(event) => onChange(event.target.value)}
          readOnly={inert !== null}
          className={cn(
            'text-strong border-subtle mt-1 w-full resize-none rounded-sm border px-2 py-1 text-ui',
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
        <div className="mt-1">
          <p className="text-muted text-meta italic">
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
                onLocate({ quote: field.span?.quote ?? '', label: field.label })
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
        <SectionHeader as="h3" className="mb-0 min-w-0 flex-1">
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
      <p className="text-muted mb-1 text-meta">
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
        className="text-body bg-inner border-subtle mt-1 w-full resize-none rounded-sm border px-2 py-1 text-ui leading-relaxed [field-sizing:content]"
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
        */}
        <span className="text-muted line-clamp-2 block text-meta">
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
  onBack,
}: {
  state: MeetingState
  reason: string
  onBack: () => void
}) {
  return (
    <Centered>
      <p className="text-body text-copy">{reason}</p>
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
