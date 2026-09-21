/**
 * **The in-meeting widget** — the product, on top of the call.
 *
 * For fifty minutes the Sillage window is behind Teams, and everything this
 * app knows about the call it is recording was on the other side of it. That is
 * the whole gap this screen closes. It is a second *window*, never a second
 * product: every reading on it is a broadcast the main window already
 * subscribes to, and every control is a channel the main window already calls.
 *
 * ## The four things on it, and what each is for
 *
 * **The meter** (DEC-38). Collapsed or open, the bars are always on screen —
 * they are the proof of life, and they are the one thing here that must never
 * be behind a press. `variant="pill"` is the same instrument at the size the
 * pill has: same scale, same floor, same two channels mirrored about a
 * baseline, without the two-word key a 232-pixel pill cannot afford.
 *
 * **The live transcript**, and this is the one that needs an argument, because
 * DEC-38 removed a live transcript pane and this repo's rules say not to
 * reintroduce one *to prove the tool is working*. That clause is the whole of
 * it. The transcript is bad at proving the tool works — seconds late, blank
 * through every pause, identical whether the room is quiet or the microphone is
 * dead — and this product now has an instrument for that job, which is exactly
 * what frees the transcript to do the job it is *good* at: showing the rep what
 * was just said. A number the client gave thirty seconds ago, a name, the end
 * of a sentence the rep missed while typing. It is opened by a press, it is
 * never on the pill, and the meter is on screen either way — so at no point is
 * a rep watching text to find out whether they are being heard.
 *
 * **It is collected by this component and not by the panel**, which is the
 * difference between the feature working and not. The panel is mounted by a
 * press and unmounted by the next one, so a transcript held there began at the
 * press and was destroyed by the one that closed it — a rep who opened the
 * widget to check a number, closed it off the client's face, and opened it
 * again had an empty box, on the exact use case the paragraph above describes.
 * The subscription lives here, for the life of the window, whether anybody is
 * looking or not.
 *
 * **The mark** (`core/contracts/marks.ts`). One press — on the pill for a
 * moment, on a line for that turn — with an optional note. It is the only thing
 * the rep can put into the record from here, and it goes into the *log*, never
 * into their document (DEC-5) and never into a prompt (DEC-7).
 *
 * **Telling the client** (`mention.ts`, US-11). One press that puts the French
 * sentence on the clipboard and draws it, so the rep pastes it into the Teams
 * chat or reads it out. It is the whole of this product's answer to « est-ce que
 * j’ai le droit d’enregistrer ce client ? », and it is deliberately the smallest
 * possible one: Granola runs a native messaging host, a socket per user, a
 * browser extension and a cross-machine arbitration to post the same sentence
 * into the meeting chat, and DEC-49 says this product never joins the call. So
 * the rep stays the one who speaks. It **sends nothing**, it is **never a gate**
 * — a rep who does not press it records exactly as before — and it claims only
 * that the sentence was handed over, never that anybody agreed.
 *
 * **The two ways out**: *Ouvrir Sillage*, which raises the main window on this
 * meeting, and *Terminer*, which ends the recording — behind a second press,
 * for the reason stated where it is drawn.
 *
 * ## What is deliberately not here
 *
 * No compte-rendu, no signal rail, no confidence, no CRM, nothing the model
 * wrote. DEC-14 keeps the model's output away from the rep during the call, and
 * a panel that changed by itself over a client's face is the loudest possible
 * version of what that decision forbids. DEC-4 keeps the one confirmation on a
 * screen the rep goes to deliberately, with the document in front of them —
 * nothing here can reach a client's CRM, and nothing here confirms anything.
 *
 * And **no provisional text**. An early draft drew interim results muted, with
 * an ellipsis, and claimed that as a difference over Granola's widget: every
 * shipped provider is batch — `LocalWhisperSession` and `RestSttSession` both
 * emit `isFinal: true` and every row in `STT_PROVIDERS` declares
 * `streaming: false` — so `isFinal: false` cannot occur, and what was written
 * was a rendering no run of this product could produce, proved by a test that
 * fed it a fixture. A non-final segment is dropped here rather than drawn, in
 * one line, so the day a streaming provider ships the widget shows the record
 * and not a guess until somebody decides otherwise.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, EyeOff } from 'lucide-react'
import type { TranscriptSegment } from '../../electron/core/contracts/transcript.ts'
import { speakerLabel } from '../../electron/core/contracts/transcript.ts'
import type { ConnectorHealth } from '../../electron/core/contracts/health.ts'
/*
 * **Which channel speaks, and in whose words.** `healthSentence.ts` wraps
 * `aggregateStatus` — the repo's one ranking of connector states, imported
 * there as the only *value* the widget takes out of `core/contracts/` — and
 * answers the second half the ranking does not: whether the `reason` it carries
 * is a sentence the product wrote for a rep or a fragment it wrote for itself.
 * Ten of the sixteen producers emit the latter, five of them ending in a JS
 * `Error`'s own words, and this surface renders over a live client call. See
 * that file's header for why the table is in the renderer and what its
 * predicate cannot tell apart.
 */
import { healthLine, type HealthLine, type LiveConnector } from './healthSentence.ts'
import {
  MARK_NOTE_MAX,
  interleaveMarks,
  type MomentMark,
} from '../../electron/core/contracts/marks.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { useDeparture } from '../app/useDismiss.ts'
import { formatElapsed } from '../app/format.ts'
import { LevelMeter } from '../screens/session/LevelMeter.tsx'
import { Button, unavailable } from '../ui/index.ts'
import {
  MENTION_COPY_STATE,
  MENTION_LABEL,
  MENTION_NOTE,
  MENTION_NOT_LOGGED,
} from './mention.ts'

/**
 * Said the same way by every control the pause withdraws.
 *
 * One sentence in one place, because three controls say it — the pill's mark
 * button, the panel's note field and its *Marquer* — and a reason typed three
 * times is a reason that will stop agreeing with itself.
 */
const PAUSED_NO_MARK = 'En pause : rien n’est enregistré à marquer.'

/**
 * How many turns the widget keeps.
 *
 * A ceiling and not a window onto the record: this is a glance at what was just
 * said, the whole transcript is two clicks away in the app, and an unbounded
 * list in a window that lives for fifty minutes is a leak with a scrollbar.
 */
const KEPT_TURNS = 60

/** Both windows' idea of « rien n'a encore été dit ». */
const NOTHING_YET = 'Rien n’a encore été transcrit.'

/**
 * **The two channels this window reports on**, and it is a narrower list than
 * `REQUIRED_CONNECTORS` on purpose.
 *
 * `llm` is the third required connector app-wide (DEC-32) and it is deliberately
 * not here: no model runs during the call (DEC-14, DEC-5), so an analysis
 * failure over a client's face is a sentence about work that has not started,
 * on the one surface where every pixel is a pixel of Teams the rep cannot click.
 * The header control says it, in the window the rep goes to afterwards.
 *
 * Written as a literal union rather than derived from `RequiredConnectorId`,
 * because the runtime guard on `health:changed` names the same two literals: a
 * type that widened on its own would stop agreeing with the filter under it.
 *
 * It is declared in `healthSentence.ts` and imported, not restated: that file's
 * table of what this window says is keyed by it, and two copies of the list
 * would let the sentence table and the broadcast filter drift apart — which is
 * how the slot came to hold a string nobody had written a row for.
 */

/**
 * **The clipboard, and the fact that it is allowed to say no.**
 *
 * This is the whole transport US-11 has, and the window it runs in is the least
 * favourable one in the product for it: frameless, transparent, always on top,
 * shown with `showInactive()` and never focused by the app. Chromium refuses
 * `writeText` from a document that is not focused — a click on the pill does focus
 * this window (`focusable: true`), which is why it works, and that is a property
 * of another process's window options rather than something this file can assert.
 *
 * So a refusal is an ordinary outcome and not an error: the story's own first
 * route is the rep *reading the sentence out*, which costs a clipboard nothing.
 * `false` is reported upward, the card says « lisez-la à voix haute » instead of
 * « collez-la », and the log records the weaker of the two facts (`MENTION_NOTE`).
 * Nothing here throws and nothing here is retried — a rep mid-sentence over a
 * client's face is not going to read a stack trace.
 *
 * jsdom has no `navigator.clipboard` at all, which is the same branch and is how
 * the renderer's tests reach it.
 */
const copyText = async (text: string): Promise<boolean> => {
  try {
    const clipboard = navigator.clipboard
    if (!clipboard || typeof clipboard.writeText !== 'function') return false
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * **What the one card over the call is showing** — a refusal, or the sentence.
 *
 * A union and not two states, because « a refusal the rep has not dismissed
 * outranks a mention card » has to be true by construction: two independent
 * states drawn from one slot put the precedence in the JSX, and the writer sixty
 * lines above then deleted the refusal before the guard could ever read it (see
 * `card` in `Widget`). One state means exactly one of these can be on screen, and
 * the only place a precedence can be *applied* is where the state is written.
 *
 * A string-literal discriminant and never an `enum`: Node's type stripping is
 * strip-only, so an `enum` has runtime meaning and would not survive it.
 */
type WidgetCard =
  /**
   * A write the rep believes happened and did not — a mark `meeting:mark`
   * refused, or a mark it would not take back.
   */
  | { kind: 'refus'; text: string }
  /**
   * The sentence the rep just took, and what became of it (US-11). Three facts,
   * because each leads to a different next move: the sentence itself, so it can be
   * read out; whether the clipboard took it, because « collez-la » and
   * « lisez-la » are different instructions; and whether the log took it, because
   * « did I tell them » is answered from the log and a write that failed silently
   * would leave the rep believing it was answered.
   *
   * `sentence` is the sentence **as it was when the press happened**, not as it is
   * now: this window re-reads `widget:state` whenever `session:changed` fires, so a
   * card bound to the live value would rewrite itself out from under a rep who is
   * in the middle of reading it aloud. A card is a record of a press; the field in
   * Réglages is a setting. `logged: null` is « the write is on the wire » — the card
   * is drawn on the copy, before the log answers, because the sentence is the
   * urgent half and must not wait on SQLite behind a preload hop.
   */
  | { kind: 'mention'; sentence: string; copied: boolean; logged: boolean | null }

/**
 * **The class list the one card wears while it is arriving or leaving**, so the
 * two cards cannot drift apart on the half of the motion neither of them had.
 *
 * `index.css` carries the argument for the rules themselves. What is here is the
 * mutual exclusion, and it is load-bearing rather than tidy: `widget-arrive` is
 * an `animation … both`, and a filled animation beats a transition on the same
 * property in the cascade — so a card still wearing the arrival while `.leaving`
 * asks for `opacity: 0` would hold at `opacity: 1` for the whole of its exit and
 * then vanish between two frames, which is the defect this is here to remove,
 * reintroduced by the fix for it. Measured before it was written: with both
 * classes on the element the departure never paints.
 *
 * `data-above` rather than a second class, because that is the attribute
 * `.widget-panel-arrive` already reads for the same question — which edge of the
 * pill this box grows out of.
 */
const CARD_MOTION = (leaving: boolean): string =>
  leaving ? 'widget-card-leaving' : 'widget-card-arrive'

/**
 * **The seam between the pill and the card, on the side the card is actually
 * on** — because for one round it was a margin on the top edge whichever edge
 * faced the pill.
 *
 * Both notice cards wore `mt-tight` — 6 px — while the pill's own two halves
 * stand `gap-inline` apart, 12. Painted at both smoke sizes, `--rhythm` reads it
 * « 12px dedans contre 6px autour » on `widget-refus` and « 11.78px dedans contre
 * 6.36px autour » on `widget-carte-sortie`, plus « 6px dedans contre 6px autour »
 * for the card's own `gap-tight`, which ties with it exactly. So separation
 * *shrank* going up the hierarchy: two rectangles, each with looser internal
 * rhythm than the space parting them, read as one stack.
 *
 * `--space-row`, 16, is the first rung above the pill's 12 — `inline` would tie
 * with it and the check would be right to keep saying so.
 *
 * **And then it was spent on the wrong edge half the time.** The frame is
 * `flex-col-reverse` when this card is `above`, which reverses the *paint* and
 * not the box model: `margin-top` is still the card's geometric top, so above
 * the pill it opened a gap against the top of the window and left the seam at
 * **zero**. Driven on the shipped renderer through `shot.mjs --no-png`,
 * pill border box to card border box, identical at 1280×800 and at 960×600:
 *
 *   `widget-refus`         card below the pill   16.00 px
 *   `widget-pause-refus`   card **above** it      0.00 px
 *
 * Zero is not « tight »: both boxes carry `--shadow-overlay`, whose first layer
 * is a `0 0 0 1px var(--widget-rim)` spread — `rgb(255 255 255 / 70%)`, read off
 * the computed style — so at a 0 px box gap the two rims occupy the same 2 px
 * band and overlap, and the two 14 px radii meet at a tangent with one white
 * line through them. On a real desktop the pill sits low and
 * `above` is the common case, so the direction left at zero is the one a rep
 * sees: a refused *Pause* — the only privacy control on this window — read as
 * the pill growing rather than as a message about it.
 *
 * **One value, and the measurement says the same one both ways.** The two
 * directions paint the same pair of boxes: same `rounded-lg`, same
 * `border-card`, same `shadow-overlay` whose blur is offset `0 4px` *downward*,
 * so the upper box's shadow falls into the seam whichever box is upper. There is
 * no asymmetry to pay for, and moving the margin to the facing edge costs no
 * height at all — the window is the size of its own content (DEC-49), and above
 * the pill the frame measured **142.09 px before and 142.09 px after**: the same
 * sixteen pixels, moved off the outside of the stack and into the seam, so
 * `widget:resize` publishes exactly what it published before.
 *
 * Branching on `above` and not on a second class, for `CARD_MOTION`'s reason:
 * `above` is the prop both cards already carry and already render as
 * `data-above`, and it is `above && open` — the same expression the frame's
 * `flex-col-reverse` reads — so the margin can never land on the edge the paint
 * did not reverse.
 */
const CARD_SEAM = (above: boolean): string => (above ? 'mb-row' : 'mt-row')

export function Widget() {
  const state = useInvoke('widget:state', {})
  /*
   * **The window is going away, and from here on it draws the call it recorded.**
   *
   * `widget:leave` is the only warning this window gets, and it used to be heard
   * one component down, in `Frame`, where it moved a class and nothing else.
   * Everything else went on running: `session:changed` fires for the very
   * transition that is dismissing us, this component's handler reloads
   * `widget:state`, the meeting is `null` by then — and the card dropped the
   * `LevelMeter`, the elapsed time and the mark counter **17 ms into a 150 ms
   * fade, at opacity 0.998**, measured in the packaged app
   * (`scratch/r26-e2e-widget-last-frame.cjs`: 241 px « … | 00:00:03 | 1 | ▴ » at
   * +23 ms, 200 px « … | Aucun enregistrement | ▾ » at +54 ms). The last thing a
   * rep sees of a call they just recorded was this product saying there was no
   * recording — and the previous round's `--ease-in` fix, correct on its own
   * terms, multiplied the exposure of that false statement by **8.6×**
   * (`∫opacity·dt` over the wrong card 12.5 → 107.6; above 0.05 opacity for
   * 53 ms → 131 ms, `scratch/r26-curve.mjs`). A fix that produces the next
   * round's finding, with a number.
   *
   * The reordering candidate — `syncOverlay()` before the `session:changed`
   * broadcast in `main.ts` — was rejected, and the reason is worth keeping.
   * `useInvoke.reload()` holds its previous value until the new one lands, so
   * the reload that blanks the card is already **in flight** when `widget:leave`
   * arrives; winning the race changes when `leaving` becomes true, not whether
   * the answer lands. And it would make a property of this window depend on the
   * order of two sends in another process, for one channel, when the card can
   * also be changed by `transcript:appended`, `moment:marked`,
   * `moment:forgotten`, `health:changed` and `widget:placed` — each of which can
   * arrive during the fade, and one of which (`health:changed`) grows the frame
   * and asks for a `widget:resize` that `Overlay` now refuses, which is the
   * ~20 px slide in the same measurement.
   *
   * So the rule is the one that is true of every channel and every order: **a
   * window that has been told to go away stops taking state.** It keeps drawing
   * what it last drew, because the recording did happen.
   *
   * **A latch and not only a state**, and that took a failing test to learn. React
   * batches: two broadcasts arriving in one task are both handled before anything
   * re-renders, so a handler guarded on the *state* reads `false` for the message
   * that arrives beside `widget:leave` — which is exactly the pair this is about,
   * since `main.ts` sends `session:changed` and `widget:leave` from the same
   * function. The ref is the fact, read at the moment it is needed; the state is
   * what re-renders the shell so the fade can start. One latch, two readers.
   */
  const gone = useRef(false)
  const [leaving, setLeaving] = useState(false)
  useBroadcast('widget:leave', () => {
    gone.current = true
    setLeaving(true)
  })

  const live = state.state.status === 'ready' ? state.state.value.meeting : null
  /*
   * Whether frames are being dropped before the transcriber. Seeded by the
   * answer to `widget:state`, moved by `recording:paused` — never by the press:
   * the pill draws what the main process says is true, and a press whose
   * answer differs is a press that changed nothing.
   */
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (live) setPaused(live.paused)
  }, [live])
  useBroadcast('recording:paused', (payload) => {
    if (gone.current) return
    if (live && payload.meetingId === live.meetingId) setPaused(payload.paused)
  })
  /*
   * The last meeting this window *rendered*, which is what makes the freeze cover
   * a read that was already on the wire. Written during render and only while the
   * window is staying: that is the definition of « what is on screen », and there
   * is no commit after `leaving` in which it could be captured instead.
   */
  const drawn = useRef(live)
  if (!gone.current) drawn.current = live
  const meeting = drawn.current
  const meetingId = meeting?.meetingId ?? null
  /**
   * The sentence the ESN configured, as it stood when this window last read state
   * (US-19, `core/contracts/mention.ts`).
   *
   * Not frozen with `drawn`, because it is not a property of the meeting: it comes
   * down on **every** `widget:state` answer including `{ meeting: null }`, which is
   * what makes it present at the one measurement the window is held off screen for.
   * Null only before that answer arrives, which is the same instant the control is
   * not drawn — so this file holds no default of its own, and a default written in
   * two places cannot start disagreeing with itself.
   */
  const sentence = state.state.status === 'ready' ? state.state.value.mentionSentence : null

  const [open, setOpen] = useState(false)

  /*
   * **Everything live is collected here, not in the panel.**
   *
   * The panel is mounted by a press. State held there begins at that press and
   * is destroyed by the one that closes it — which for the transcript is the
   * feature not working, and for the marks is a rep's own presses disappearing
   * from a list they are looking at. `widget:state` is read once, at window
   * creation, and nothing re-reads it during a recording: `session:changed`
   * fires on transitions and a recording has none.
   */
  const [turns, setTurns] = useState<TranscriptSegment[]>([])
  const [marks, setMarks] = useState<MomentMark[]>([])
  /**
   * **The one card this window draws over the call, and the reason there is one
   * state for it rather than two.**
   *
   * There were two — a refusal and a mention — drawn from one slot by a `&&` in
   * the JSX, under a comment stating the precedence correctly: « a refusal
   * outranks it … the mention is one press away from being asked for again, so
   * it is the half that yields ». The render implemented that faithfully and the
   * *writer* undid it: `announce()` opened with `setSaid(null)`, so the guard
   * could never fire for a refusal that existed before the press, because the
   * press deleted it first. Measured on the shipped renderer at 1280×800 and
   * 960×600 — « refus visible : oui » before a press on a control 32 px away,
   * « refus visible : NON » after it. A rep marks a moment at minute 40, the
   * write is refused, the card says so, and their next press on a *different*
   * button deletes the only thing that said the moment they were marking is not
   * in the record. Verbatim the harm `Refus` was added to end.
   *
   * So the two are one discriminated union in one state: two cards cannot
   * coexist by construction rather than by two components agreeing, and the
   * precedence lives where it can actually be applied — at the write, in
   * `announce`, which yields. `setSaid(null)`'s own job survives it: a refusal
   * *is* replaced by whatever the next press on that control produces, because
   * that is the same gesture with the rep looking at it; what it may not do is
   * evaporate under a press that has nothing to do with it.
   *
   * A mark that *worked* is not a card at all — the receipt is the counter on the
   * pill moving, and « Moment marqué. » painted over a client's face would be a
   * second one — so it rides `announced` below and never this slot. Which is also
   * why a successful mark does not remove a mention card the rep may be halfway
   * through reading aloud.
   */
  const [card, setCard] = useState<WidgetCard | null>(null)

  /**
   * **The card is held on screen long enough to leave, and it is the world that
   * takes it away as often as the rep.**
   *
   * Three of the four ways this slot empties are not a press on the card: a
   * successful *Pause* clears a stale refusal, so does a successful
   * *Retirer*, and `announce()` yields to one. `useDismiss` cannot serve those —
   * there is no gesture on this element to intercept — and `useLeaving` cannot,
   * because a slot of one keyed on a constant reports its departure out of a ref
   * its effect only refreshes when the *keys* change, so a slot going
   * `refus → mention → null` would fade out wearing the sentence from two states
   * ago. `useDeparture` is the hook written for exactly this and, until this
   * commit, had no caller under `src/widget/` at all.
   *
   * `drawnCard` is the last non-null card, held in a ref, because the state is
   * already `null` for the whole of the fade: rendering `card` would render
   * nothing and the hold would buy an empty box. It is written during render and
   * read in the same render, which is safe for the reason `useDeparture`'s own
   * docblock gives about its `was` ref — the write is idempotent and guarded by
   * the value it feeds.
   */
  const { shown: cardShown, leaving: cardLeaving } = useDeparture(card !== null)
  /**
   * The panel, held the same way — it is the largest thing on this window and it
   * left between two frames.
   *
   * **The condition is not the press.** It shipped as `useDeparture(open)` with
   * `meetingId !== null` ANDed at the render site, *outside* the hold — so the
   * chevron faded and the meeting ending tore the panel off on the frame
   * `widget:state` answered `{ meeting: null }`. Driven with the same sampler
   * `shot.mjs` uses, at 1280×800: the chevron gives « 11 images, entre les deux
   * 5, dernière 0.000 », the meeting ending gave « 9 images, entre les deux 0,
   * dernière 1.000 » and no exit class at all. `EndOfMeetingWatch` ends a call
   * on every meeting that runs past its grace, so that is the route a rep meets
   * on nearly every call, and the object being torn away at full opacity is
   * 340×205 over the client's face.
   *
   * The docblock this replaces also named « the footer's *Replier* » as one of
   * four routes. There is no such control: `onClose` has one caller in this
   * file, inside « Arrêter définitivement ». Three routes, and the hold now
   * takes the two that are a state rather than a gesture.
   */
  const { shown: panelShown, leaving: panelLeaving } = useDeparture(open && meetingId !== null)
  /**
   * Held for the fade, exactly as `drawnCard` is and for the same reason: the
   * meeting is already `null` for the whole of the departure, so reading it
   * would render an empty panel and the hold would buy nothing.
   */
  const lastMeetingId = useRef<string | null>(null)
  if (meetingId !== null) lastMeetingId.current = meetingId
  const drawnMeetingId = meetingId ?? lastMeetingId.current
  const lastCard = useRef<WidgetCard | null>(null)
  if (card !== null) lastCard.current = card
  const drawnCard = card ?? lastCard.current

  /**
   * What worked, for a screen reader and for nobody else.
   *
   * `meeting:mark` refuses whenever the meeting is not `recording`, which
   * `EndOfMeetingWatch` can make true with the pill still up, and on any store
   * failure — so a refusal is drawn (see `card`). A success is announced politely
   * and drawn nowhere: one live region either way and never two, because
   * `role="alert"` is itself a live region and announcing both would read the same
   * event twice to the one rep who cannot see either of them.
   */
  const [announced, setAnnounced] = useState('')

  /**
   * **The sentence this window has already handed to this meeting's log** (US-11),
   * and whether that write has landed.
   *
   * Two presses of the mention control for one sentence wrote **two** rows into
   * the meeting's event log — measured on the shipped renderer at both smoke
   * sizes, « écritures meeting:mark : 2 » — and reported the first press's refusal
   * nowhere, because press 2's card replaced press 1's and the token guard then
   * discarded press 1's answer. `meeting:mark` has no idempotency key and the row
   * is read back at the gate in a list of the rep's own notes, so the duplicate is
   * theirs to find and take back (DEC-27).
   *
   * The rule is one sentence: **the log write belongs to the act, not to the
   * press.** While this window is holding a sentence it has already recorded — or
   * is still recording — a further press re-copies it and records nothing; a press
   * whose write was *refused* clears the entry, so the next one is a retry and the
   * log ends with one row rather than none. Dismissing the card ends the act, and
   * a change of meeting clears it with everything else.
   *
   * `landed: false` is « on the wire », which is why the card can say `logged: null`
   * for a repeat press and still be answered: the answer updates whatever mention
   * card is on screen for that sentence, and there is only ever one.
   */
  const handed = useRef<{ sentence: string; landed: boolean } | null>(null)

  /**
   * **The marks the meeting already had, applied during the render that gets
   * measured** (R33-5).
   *
   * It was a `useEffect`, which runs *after* `Frame`'s measurement
   * `useLayoutEffect` in the same commit — child effects before parent effects —
   * so the pill the main process sized the window to carried a mark button with no
   * count on it. Measured on the shipped renderer at 1280×800 and at 960×600:
   * `308×78` revealed, `313×78` a hundred and sixty milliseconds later, which is
   * 2.5 px of sideways drift over the face of the person on the call, because
   * `placeAroundPill` holds the pill's *centre*. With no marks there was exactly
   * one ask, so CLAUDE.md's « 3 asks → 1, at the right size » was true only of a
   * meeting that had none — which the crash-recovered and rehydrated cases are not.
   *
   * A render-phase update and not a layout effect, because a layout effect *here*
   * is still the parent's and still runs after the child's: the only place the
   * count can be in the DOM before `Frame` measures it is the same commit. React
   * re-runs this component before the browser sees anything, so this costs one
   * render and no frame — and it waits on nothing, so the entrance handshake is
   * untouched (DEC-26: a widget that does not appear is worse than one that
   * appears wrong).
   *
   * Keyed on the **meeting** rather than on « the list is empty »: the seed is the
   * one fact about a change of meeting this window has, so a second recording in
   * one window gets its own marks instead of keeping the first call's, and
   * `handed` is cleared with them. A later `widget:state` for the same meeting
   * does not re-seed — the broadcast is the only thing that changes the list after
   * that, which is the rule stated on `moment:marked` below.
   */
  const seeded = useRef<string | null>(null)
  const loadedMarks = meeting?.marks
  if (meetingId !== null && loadedMarks !== undefined && seeded.current !== meetingId) {
    seeded.current = meetingId
    handed.current = null
    if (loadedMarks.length > 0 || marks.length > 0) setMarks([...loadedMarks])
  }

  /*
   * And nothing is *asked* either. `session:changed` is the broadcast that
   * carries the very transition dismissing this window, so the reload it fires is
   * work done to redraw a card that is fading out — see `leaving` above.
   */
  useBroadcast('session:changed', () => {
    if (gone.current) return
    state.reload()
  })

  /*
   * **The health of the two required channels, collected by the *window*.**
   *
   * It lived in `Panel` — state mounted by a press and destroyed by the next
   * one — while `health:changed` is an **edge** broadcast. So a channel that
   * died while the panel was shut, which is most of a call, was never reported:
   * the rep opened the widget at minute 20 to check and it said nothing was
   * wrong. That is the same defect as the transcript's, in the same file, under
   * a header that states the rule — and it was worse here, because this is the
   * one reading that says the product is failing.
   *
   * Seeded from the snapshot as well as the edge, which every other health
   * surface in the app already does (`StatusControl`, the gate, the onboarding):
   * an edge that fired before this window existed is an edge nobody heard, and
   * a widget is created *during* a meeting.
   *
   * **What is held is the two channels, not the sentence** — and that is the
   * correction. A `string | null` written by two handlers is two answers to one
   * question, and they were different questions: the snapshot took the *first*
   * non-`ok` of `['capture', 'transcribe']` under a variable called `worst`, the
   * edge took the *latest* whatever it said. Both connectors report
   * independently for the length of a call — `Recording.ts` wires
   * `capture.on('health')` and `transcribe.on('health')` to the same `onHealth`,
   * and `health:retry` on the capture row in Réglages publishes `capture: ok`
   * mid-call — so a capture blip that recovered while the local engine was still
   * dead erased the transcription warning and the window reported nothing wrong
   * for the rest of the call. Driven on the shipped renderer at **both** smoke
   * sizes, reading every `.text-warn` on the card: « La sortie audio de
   * l’ordinateur a changé … » → « aucun fournisseur de transcription
   * disponible » → **`[]`**, over a rep who believed notes were being taken.
   * `Widget.test.tsx` holds all four cases now; before this commit
   * `grep -c 'health:changed\|health:snapshot'` over that file returned 0, and
   * the strip was fed by one stage emitting one connector from a static table.
   *
   * `aggregateStatus` decides *which* channel speaks, rather than a second
   * ranking written here: it is the repo's one ordering of these states (`down`
   * outranks `degraded`, ties to the earlier connector — capture first, because
   * it is the one that cannot be repaired after the call) and it reads a
   * `Partial`, so a snapshot missing a key is *nothing known* rather than
   * nothing wrong. Only the two channels a recording needs are put in front of
   * it: `llm` does not run during the call and DEC-14 keeps it off this surface.
   * One sentence still, because the strip is one sentence — the one being held
   * back comes forward the moment the worse one clears, which is what makes
   * « the worst » honest rather than lossy.
   *
   * **It does not decide how that channel speaks, and for one round it was read
   * as though it did.** `aggregateStatus` returns the connector's `reason`
   * verbatim — that is its contract, and Réglages wants exactly that — so this
   * slot held whatever string the producer happened to have. Six of the sixteen
   * producers write a sentence for a rep; ten write a fragment for themselves,
   * and `widget-deux-pannes` put « aucun fournisseur de transcription
   * disponible » — lowercase, unterminated, no remedy — on a card drawn over a
   * client's face. `healthLine` is the second half: the producer's sentence when
   * it is one, this window's own when it is not.
   *
   * **The edge wins a late snapshot**, which the spread says and an effect that
   * overwrote could not: the read is one preload hop issued at mount and the
   * edges are a stream, so an answer that lands after an edge is a reading that
   * was already stale when it was taken. Nothing reloads this channel, so the
   * seed happens once.
   */
  const [connectors, setConnectors] = useState<Partial<Record<LiveConnector, ConnectorHealth>>>({})
  const health = useInvoke('health:snapshot', {})
  useEffect(() => {
    if (health.state.status !== 'ready') return
    const snapshot = health.state.value
    setConnectors((was) => ({
      capture: snapshot.capture,
      transcribe: snapshot.transcribe,
      ...was,
    }))
  }, [health.state])
  useBroadcast('health:changed', ({ connector, health: next }) => {
    if (gone.current) return
    if (connector !== 'capture' && connector !== 'transcribe') return
    setConnectors((was) => ({ ...was, [connector]: next }))
  })
  const trouble = healthLine(connectors)

  /*
   * The turns arrive on the broadcast nothing had ever subscribed to.
   *
   * `transcript:appended` has been emitted for every segment of every meeting
   * since the orchestrator was written, and was read by no window — the session
   * screen draws the meter instead (DEC-38) and the gate reads the stored
   * record. A broadcast with no subscriber is a promise the product is not
   * keeping; this is the surface that keeps it.
   */
  useBroadcast('transcript:appended', (payload) => {
    if (gone.current) return
    if (payload.meetingId !== meetingId) return
    // Batch providers only, today — see the header. A provisional result is
    // dropped rather than drawn: this surface shows the record.
    if (!payload.segment.isFinal) return
    setTurns((was) => [...was, payload.segment].slice(-KEPT_TURNS))
  })

  /*
   * **The broadcast is the only way this list changes.**
   *
   * Not an optimistic insert from what `meeting:mark` returned, which is what
   * this did: that draws a mark whose write may not have happened, and it
   * leaves the broadcast doing nothing at all — the shape
   * `scripts/check-surfaces.mjs` now fails the build on. One path, so the row
   * on screen is the row in the log.
   */
  useBroadcast('moment:marked', (payload) => {
    if (gone.current) return
    if (payload.meetingId !== meetingId) return
    setMarks((was) =>
      was.some((mark) => mark.id === payload.mark.id) ? was : [...was, payload.mark],
    )
  })

  useBroadcast('moment:forgotten', (payload) => {
    if (gone.current) return
    if (payload.meetingId !== meetingId) return
    setMarks((was) => was.filter((mark) => mark.id !== payload.markId))
  })

  const mark = useCallback(
    async (segmentId: string | null, text: string) => {
      if (meetingId === null) return
      /*
       * **Nothing is being kept, so there is no moment to mark.**
       *
       * `session:pause` drops frames before the transcriber, and a mark is a
       * timestamp into the transcript — so a mark taken here points at audio
       * that does not exist. The product already accepted this argument once, in
       * the same state, about a quieter element: the pill *removes* its clock
       * while paused because elapsed time stops meaning « how long this call has
       * been written down ». Seven controls went on writing into the same gap.
       *
       * Guarded here as well as disabled below, because the guard is the fact
       * and the disabled attribute is how it is shown. A control that looks
       * available and does nothing is the inert primary this repo refuses.
       */
      if (paused) return
      try {
        await invoke('meeting:mark', { meetingId, note: text, segmentId })
        setAnnounced(text === '' ? 'Moment marqué.' : `Moment marqué : ${text}`)
        /*
         * A refusal *is* spent by a press on the control it refused: same gesture,
         * same rep, looking at the card. What it is not spent by is a press on
         * something else — see `card`, and the mention's yield below. A mention card
         * is deliberately untouched here: it holds a sentence the rep may be halfway
         * through reading to a client.
         */
        setCard((was) => (was?.kind === 'refus' ? null : was))
      } catch (error) {
        setCard({
          kind: 'refus',
          text: error instanceof Error ? error.message : 'Impossible de marquer ce moment.',
        })
        /*
         * **And the pill stops claiming a recording it has just been told is
         * not happening.**
         *
         * `meeting:mark` refuses when the meeting is not `recording`, and
         * `widget:state` answers `{ meeting: null }` in exactly that case — so a
         * refusal is proof this window's copy is stale. It is reachable in the
         * ordinary way: `EndOfMeetingWatch` can end the call with the pill still
         * floating over it, and the rep's press lands in the gap before
         * `session:changed` arrives.
         *
         * What that gap drew, measured six pixels apart at the same instant: a
         * filled `--accent` dot, `data-graphic="enregistrement en cours"`, a
         * clock still counting, and an `sr-only` « Enregistrement en cours » —
         * beside a `role="alert"` reading « Aucun enregistrement en cours ». A
         * screen reader is read both. On the one surface whose whole job is to
         * tell a rep across a desk whether the client is being written down, the
         * loud half said yes while the quiet half said no.
         *
         * The reload rather than a flag read off the message: the main process
         * is the authority on what is recording, this is the channel that asks
         * it, and `session:changed` already drives the same call. Parsing the
         * refusal's French would put a second, weaker copy of the rule in the
         * renderer — and it would repair only this sentence, where a re-read
         * repairs whatever else has gone stale in the same gap.
         */
        state.reload()
      }
    },
    [meetingId, paused, state.reload],
  )

  /**
   * **The press that tells the client** (US-11, `mention.ts`).
   *
   * Two effects and no third. It copies the sentence, and it writes down that it
   * did. There is no transport: nothing is posted into the meeting, nothing is
   * mailed, nothing touches the Outlook event body — DEC-10, which mails every
   * attendee and destroys the Teams join blob, is the reason that last one is
   * named rather than merely absent. `Widget.test.tsx` asserts the *set* of
   * channels this press reaches, because « it sends nothing » is a claim about
   * everything that is not here and a docblock cannot hold it.
   *
   * **It is not a gate.** It returns nothing, it sets no flag any other control
   * reads, and the recording is untouched whether it is pressed, refused or never
   * found. Refusing to record a client call because a sentence was not copied is
   * not this product's decision to make.
   *
   * **`meeting:mark` is the log, and reusing it is a decision with a cost worth
   * stating.** It is the only channel that appends to a meeting's event log from
   * this window, so the alternative is a new event type, a new channel and a new
   * fold in three files the coordinator owns — for a row that would be drawn in
   * exactly the same place, by `interleaveMarks`, at the gate and in *Historique*.
   * What it costs is that `MomentMarkSchema.note` documents itself as « the rep's
   * own words » and this note is the product's: the row the rep reads back at the
   * gate says « Phrase d’information sur la transcription copiée. » in a list of
   * their own notes, and the pill's counter moves by one. Both are true — a
   * moment in the call was marked, by the rep, on purpose — and the counter moving
   * is the second receipt the press gets. If a dedicated event is ever declared,
   * this call is the one line that changes.
   *
   * **Nothing is announced politely.** A success in `announced` would read
   * « Moment marqué » to a screen reader for a press that was not a mark, and the
   * card below is already a live region: two would read the same event twice.
   *
   * **And it yields, in both directions.** A refusal the rep has not dismissed
   * keeps the one card slot — `card`'s docblock has the measurement — and the log
   * write happens at most once per sentence handed over, which `handed` states.
   * What the press always does is copy: that is the half a refused mark has no
   * opinion about.
   */
  const announce = useCallback(async () => {
    /*
     * `sentence` is null only before `widget:state` answers (US-19), which is the
     * same instant `meetingId` is null and the control is not drawn — so this is the
     * belt to the braces above rather than a reachable refusal. It is here because a
     * press that copied the empty string would put a rep in front of a client with a
     * blank card, and that is the one failure this surface must not have.
     */
    if (meetingId === null || sentence === null || gone.current) return
    const copied = await copyText(sentence)
    /*
     * Read *after* the await, because the press that matters most for this is the
     * one that happens while the clipboard is still deciding — a rep double-pressing
     * a 24-pixel control over a client's face.
     */
    const prior = handed.current
    const already = prior !== null && prior.sentence === sentence
    /*
     * **A window that has been told to go away stops taking state**, and this is
     * the one path in this component that crosses an `await` before its first
     * write. `copyText` is an async permission check on the clipboard, so
     * « press the pill's control, press *Terminer* » — or the meeting ending under
     * the rep, which is what `EndOfMeetingWatch` does — can land `widget:leave`
     * in between. Drawing the card then is a 145-pixel box arriving *during* the
     * fade, which grows the frame and asks for a `widget:resize` that `Overlay`
     * refuses: the ~20 px slide measured in
     * `scratch/r26-e2e-widget-last-frame.cjs`, reintroduced by a new card.
     * The write to the log is still worth making — it happened — so only the
     * drawing is dropped.
     */
    if (gone.current) {
      if (!already) {
        handed.current = { sentence, landed: false }
        void invoke('meeting:mark', {
          meetingId,
          note: MENTION_NOTE(copied),
          segmentId: null,
        }).catch(() => undefined)
      }
      return
    }
    /*
     * **The yield, and it is one line because there is one state.** A refusal the
     * rep has not dismissed keeps the slot; this press has still copied the
     * sentence, and it is one press away from being asked for again.
     */
    setCard((was) =>
      was?.kind === 'refus'
        ? was
        : {
            kind: 'mention',
            sentence,
            copied,
            logged: already && prior.landed ? true : null,
          },
    )
    // Already recorded, or still being recorded: the act is one act. See `handed`.
    if (already) return
    handed.current = { sentence, landed: false }
    /*
     * **The answer updates the card on screen for this sentence, and never mints
     * one.** That is what keeps a dismissed card from coming back on its own — a
     * card that returns over a client's face with nobody having pressed anything is
     * the one thing DEC-14 forbids of this window — and it is what lets a second
     * press inherit the first write's answer, which is the whole of the fix for the
     * duplicate row. It replaced a press token, which could only say « not mine »
     * and therefore threw the refusal away.
     */
    const answer = (logged: boolean): void => {
      if (gone.current) return
      setCard((was) =>
        was?.kind === 'mention' && was.sentence === sentence ? { ...was, logged } : was,
      )
    }
    try {
      await invoke('meeting:mark', {
        meetingId,
        /*
          **The product's act, said so.** This records that the disclosure was
          read out (US-11) and the rep pressed a button to do it — but the mark
          is not theirs, and until `by` existed it was indistinguishable from
          one. See `MomentMark.by` for the three rules that broke.
        */
        by: 'product',
        note: MENTION_NOTE(copied),
        segmentId: null,
      })
      if (handed.current?.sentence === sentence) handed.current = { sentence, landed: true }
      answer(true)
    } catch {
      // Nothing landed, so the act is not spent: the next press is a retry and the
      // log ends with one row rather than none.
      if (handed.current?.sentence === sentence) handed.current = null
      answer(false)
    }
  }, [meetingId, sentence])

  const forget = useCallback(
    (markId: string) => {
      if (meetingId === null) return
      void invoke('meeting:forget', { meetingId, markId })
        .then(() => {
          setAnnounced('Moment retiré.')
          setCard((was) => (was?.kind === 'refus' ? null : was))
        })
        .catch(() => setCard({ kind: 'refus', text: 'Impossible de retirer ce moment.' }))
    },
    [meetingId],
  )

  /**
   * **The privacy control answers like the one beside it, and not into a 1x1 box.**
   *
   * *Pause* is the only control on this surface a rep presses because something
   * that must not be recorded has just started. `setPaused` returns `false` when
   * the orchestrator holds no recording for this meeting — reachable in the
   * ordinary way, the `EndOfMeetingWatch` gap, the same gap `meeting:mark`'s
   * refusal names. Measured before this change, on a press that did not take: the
   * label still read « Pause », the clock still counted, the pill still drew the
   * `--accent` dot and said « Enregistrement en cours », and the whole receipt was
   * one sentence inside the window's `sr-only` paragraph — a 1x1 box with
   * `clip: rect(0,0,0,0)`. A rep looking at the surface saw a recording they
   * believed they had stopped.
   *
   * So it takes `meeting:mark`'s two halves, fourteen lines up: a `role="alert"`
   * card the rep can see, and a `widget:state` re-read, because a refusal is proof
   * this window's copy is stale and the pill must stop claiming a recording the
   * main process has already said is not happening.
   *
   * It lives here and not in `Panel` for the reason `mark` and `forget` do: the
   * parent owns the channel, the card and the reload, and a presentational panel
   * that reached for any of the three would be a second copy of the rule.
   */
  const pause = useCallback(
    (next: boolean) => {
      if (meetingId === null) return
      const refusal = next
        ? 'La pause n’a pas pu être prise.'
        : 'L’enregistrement n’a pas pu reprendre.'
      const refuse = () => {
        setCard({ kind: 'refus', text: refusal })
        state.reload()
      }
      void invoke('session:pause', { meetingId, paused: next })
        .then(({ ok, paused: now }) => {
          /*
            **`ok`, and not only the comparison.** `setPaused` used to answer the
            state afterwards and nothing else, so `false` meant « resumed » and
            « there is no recording here » at once — and for `next === false` the
            two collapsed: the comparison below found what it asked for and drew
            a success. Driven against the answer the main process really gives, a
            refused *Reprendre* produced zero refusal cards, the label still
            « Reprendre » and the pill still « enregistrement en pause », for as
            long as the rep kept pressing. The sentence fourteen lines up was
            unreachable code. The comparison stays as the belt: the two facts can
            disagree in the other direction too.
          */
          if (!ok || now !== next) {
            refuse()
            return
          }
          /*
            Nothing announced: the receipt for a pause that worked is the label
            flipping to « Reprendre » and the row below it saying « En pause »,
            both of which a screen reader reads already. A polite sentence on top
            would read the same event twice — the rule `mark` states above. A
            stale refusal does yield, the way it does there.
          */
          setCard((was) => (was?.kind === 'refus' ? null : was))
        })
        .catch(refuse)
    },
    [meetingId, state.reload],
  )

  return (
    <Frame
      open={open}
      leaving={leaving}
      gone={gone}
      settled={state.state.status !== 'loading'}
    >
      {(above, placed) => (
        <>
          <Pill
            title={meeting?.clientName ?? (meeting?.title || null)}
            startedAt={meeting?.startedAt ?? null}
            meetingId={meetingId}
            /*
              **The rep's own, which is what the number claims to be.**

              It was `marks.length`, and « Prévenir le client » writes a mark —
              so the count a rep glances at to decide whether they caught
              anything went up on a press that marked nothing, over-reporting by
              the number of times they made the disclosure.
            */
            marks={marks.filter((mark) => mark.by === 'rep').length}
            open={open}
            above={above}
            placed={placed}
            paused={paused}
            onToggle={() => setOpen((was) => !was)}
            onMark={() => void mark(null, '')}
            onMention={() => void announce()}
          />
          {/*
            The one card, where the press was.

            Between the pill and the panel in the DOM, which puts it against the
            pill whichever way the card stacks — `flex-col-reverse` reverses the
            paint and not the order, so it is directly under the pill when the
            panel opens downward and directly over it when the panel opens up.
            Never *inside* the panel: the press it answers is most often the one
            on the pill, with no panel open at all, which is the case that had
            nowhere to appear.

            Two cards stacked over a video call is twice the window for one press,
            and the two can genuinely coincide: a mark refused at minute 40 and a
            mention pressed at minute 41. That is a `switch` on one state now and
            not a conjunction of two — the precedence between them is applied where
            they are *written*, because a render can only ever read what the writer
            left it. See `card`, which carries the measurement.
          */}
          {!cardShown || drawnCard === null ? null : drawnCard.kind === 'refus' ? (
            <Refus
              text={drawnCard.text}
              leaving={cardLeaving}
              above={above && open}
              onDismiss={() => setCard(null)}
            />
          ) : (
            <Mention
              sentence={drawnCard.sentence}
              copied={drawnCard.copied}
              logged={drawnCard.logged}
              leaving={cardLeaving}
              above={above && open}
              /*
                Dismissing ends the act as well as the card: the next press on the
                control is a new telling and writes its own row. See `handed`.
              */
              onDismiss={() => {
                handed.current = null
                setCard(null)
              }}
            />
          )}
          {panelShown && drawnMeetingId !== null ? (
            <Panel
              meetingId={drawnMeetingId}
              above={above}
              leaving={panelLeaving}
              heading={meeting?.clientName ?? meeting?.title ?? ''}
              turns={turns}
              marks={marks}
              trouble={trouble}
              onMark={mark}
              onForget={forget}
              onClose={() => setOpen(false)}
              onPause={pause}
              paused={paused}
            />
          ) : null}
          {/*
            And what worked, for a screen reader only.

            The receipt a sighted rep gets for a mark that landed is the counter
            on the pill moving, which is what that counter is for — a card
            painted over a client's face to say « Moment marqué. » would be a
            second one, on the surface whose whole rule is that every pixel of it
            is a pixel of Teams the rep cannot click. A refusal is the opposite
            case and is drawn: see `Refus` above.

            A refusal is left out of *this* region rather than repeated in it.
            `role="alert"` is itself a live region, so announcing both would read
            the same sentence twice to the one rep who cannot see either of them.
          */}
          <p aria-live="polite" className="sr-only">
            {announced}
          </p>
        </>
      )}
    </Frame>
  )
}

/**
 * The halo, and the measurement.
 *
 * Two jobs, and they are the same job. The window is transparent and always on
 * top, so it is exactly as big as the renderer says it is — and
 * `getBoundingClientRect` does not include a `box-shadow`, so the first version
 * reported the card's own box and the shadow was clipped to nothing. The
 * shadow is the only thing separating a pale card from the video call
 * underneath (`--shadow-overlay` says so in `tokens.css`), so on a real call
 * the rep got a white rectangle cut into the picture, while every harness
 * screenshot showed the shadow beautifully against five hundred pixels of the
 * app's own paper. Same blind spot as `--expand` hiding clipped textareas for
 * thirteen rounds: the instrument was measuring the wrong box.
 *
 * So the frame reserves the shadow's own extent, and those pixels are given
 * back: `widget:passThrough` turns the window's mouse off while the pointer is
 * over the halo (`setIgnoreMouseEvents(…, { forward: true })`, which still
 * delivers moves so it can be turned on again), so the halo is a place the rep
 * can click *through* into Teams rather than a hole punched in the call.
 *
 * `ResizeObserver` and not an effect on the state that opened it: the content
 * also changes height when a turn arrives, when a mark is made and when the
 * health line appears, and an effect per cause is a list that will be one
 * short.
 */
const HALO = 20

/**
 * How long the frame waits before reporting a size it is not happy with.
 *
 * The main process does not show this window until the renderer has said how big it
 * is (`FIRST_FRAME_MS` in `Overlay.ts`), which is what stopped a card appearing
 * clipped and sliding into place. The measurement itself then has to be worth
 * waiting for, and there are **two** ways it is not.
 *
 * **The wrong face.** Measured on the shipped renderer: the first frame is laid out
 * in the *fallback* face, so the pill reported 239 px, Inter then loaded and it
 * became 276, and `placeAroundPill` holds the pill's *centre*, so those 37 px moved
 * the window sideways by eighteen. Before the window was deferred that jump was the
 * third of three; after, it would have been the only one left, and the one still
 * visible.
 *
 * **The wrong content, which is worse and was the entrance's own version of the
 * exit's defect.** The gate was on the font and never on what the pill was
 * *drawing*: `widget:state` is a preload hop and two SQLite reads, and until it
 * answers `Pill` draws « Aucun enregistrement » with no meter, no clock and no mark
 * button. So the measurement the main process was holding the window off screen for
 * could be a measurement of a pill saying the recording is not happening — and the
 * window was then *revealed* carrying it. Measured on the shipped renderer with one
 * line of latency on that one channel (`scratch/r26-widget-first-frame-shot.mjs`,
 * 120 ms): « the window is created/shown at 240×78 », pill text
 * « Enregistrement en cours / Aucun enregistrement / ▴ », settling at 281×78 — 41 px
 * clipped and a 21 px slide, arriving with the opposite of what it means. In real
 * Electron on the machine this is typed on, `widget:state` took 17 ms and the reveal
 * *was* correct (`scratch/r26-e2e-widget-first-frame.cjs`: 619 ms placeholder,
 * 636 ms the real pill; the main process shows at 276×78), so the whole defence was
 * ~104 ms of unguarded margin at the instant `startRecording` is opening two audio
 * devices and booting a transcriber — on a Mac, where the primary platform is
 * Windows (HR-2). Correct by construction, not by margin.
 *
 * One number for both waits, and it is the **deadline** on each rather than a
 * requirement: silence here is a pill that does not appear until the main process
 * gives up on us, so the renderer must always answer first, with a worse number if
 * that is all it has (DEC-26). It is measured from the **mount** and not from each
 * arming of the effect — the content arriving re-arms the measurement, and a font
 * deadline that restarted there would land past the moment the main process stops
 * waiting.
 *
 * **And it has to be longer than the read it is waiting for, which is what made the
 * first attempt at this useless.** At 120 ms it fired before `widget:state` answered
 * and the placeholder was measured anyway — measured on the built bundle with the
 * harness's own fixture, whose `LATENCY` table gives that channel 150 ms precisely so
 * a stage can catch the pill mid-flight: « t=+181ms 240×78 « … | Aucun
 * enregistrement | ▾ » », then the real pill at 221 ms
 * (`scratch/r26b-prod-first-frame.mjs`). A deadline shorter than the answer is a
 * deadline that decides every time, so the wait it guards never happens. 200 ms
 * covers that read with room, and `FIRST_FRAME_MS` was raised to 300 so the main
 * process still gives up **after** this side does — a handshake whose two deadlines
 * are in the wrong order is decided by the wrong process, and what the main process
 * reveals when it gives up is the *guess*, which is 49 px narrower than the pill.
 *
 * Inter is bundled (`src/font/`) and `widget:state` is two SQLite reads over a
 * preload hop, so on an ordinary launch both waits are already over and this costs
 * nothing: measured in the packaged app, the placeholder is in the DOM for **10 ms**
 * (456 ms → 466 ms) and the window is revealed at 737 ms
 * (`scratch/r26b-e2e-visible-text.cjs`).
 */
const MEASURE_DEADLINE_MS = 200

/**
 * How long this element's own transition will take, in milliseconds — read off
 * the resolved style and never written down twice.
 *
 * `.widget-leaving` names `var(--motion)`, and `--motion` is `0ms` under
 * `prefers-reduced-motion`. A constant here would be a second copy of a number
 * `tokens.css` owns, and it would be the *wrong* copy for exactly the rep who
 * asked for less motion: they would get a static pill held on screen for a fifth
 * of a second after their call ended, which is the opposite of what the setting
 * asks for.
 *
 * `duration + delay`, per property, taking the longest — the two lists are
 * index-matched by the spec, and a shorthand `transition` with no delay resolves
 * to `0s` rather than to nothing. A style engine that answers neither — jsdom
 * does not — gives `0`, which is a correct answer: there is nothing to wait for.
 */
const transitionMs = (element: Element): number => {
  const style = getComputedStyle(element)
  const seconds = (raw: string): number[] =>
    (raw || '').split(',').map((part) => {
      const text = part.trim()
      const value = Number.parseFloat(text)
      if (!Number.isFinite(value)) return 0
      return text.endsWith('ms') ? value : value * 1000
    })
  const durations = seconds(style.transitionDuration)
  const delays = seconds(style.transitionDelay)
  return Math.max(0, ...durations.map((ms, index) => ms + (delays[index] ?? 0)))
}

interface FrameProps {
  open: boolean
  /**
   * The window has been asked to play its exit — see `leaving` in `Widget`.
   *
   * `leaving` re-renders the shell so the fade can start; `gone` is the same latch
   * read synchronously, because React batches and a broadcast arriving beside
   * `widget:leave` must not be allowed to see `false`.
   */
  leaving: boolean
  gone: React.RefObject<boolean>
  /**
   * Whether the read the pill cannot draw without has landed.
   *
   * Settled either way, and that is the honest condition rather than « there is a
   * meeting »: a `widget:state` that answers `{ meeting: null }` is an answer, and
   * a window held off screen until a meeting appears would never appear at all on
   * the one race where it does not. See `MEASURE_DEADLINE_MS`.
   */
  settled: boolean
  /**
   * `above` — which way the panel stacks — and `placed`, whether the main process
   * has put this window on screen at a size it measured. See `reveal` below: the
   * second is what releases the arrival (DEC-50), and the pill's own class is the
   * only thing that reads it.
   */
  children: (above: boolean, placed: boolean) => React.ReactNode
}

function Frame({ open, leaving, gone, settled, children }: FrameProps) {
  const box = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)

  /**
   * **The window is on screen, which is the one cue the arrival may start on**
   * (DEC-50, `.widget-arrive` in `index.css`).
   *
   * The pill is held at `scale(0.92)` and `opacity: 0` by a *paused* animation
   * until this flips, and the reason is arithmetic rather than taste:
   * `getBoundingClientRect` **includes transforms**, so a pill that is mid-scale
   * when `send()` below reads it reports a box 8% small — and the main process
   * sizes a frameless always-on-top window to exactly that number. That is the
   * clipped first frame `MEASURE_DEADLINE_MS`, `FIRST_FRAME_MS` and
   * `APPEARANCE_MS` exist to end, reintroduced by the polish that was supposed to
   * follow them. The invariant that closes it is one sentence: **the pill is
   * measurable exactly while it is not moving**, and `paused` is both halves of
   * that at once.
   *
   * **DEC-50 names `widget:measuring` and that is the wrong channel, measured.**
   * That message is the renderer stating its own *deadline*, sent from a layout
   * effect with no dependencies — one IPC hop from mount, before anything has
   * been measured at all. Gating on its reply releases the animation while the
   * font wait and the `widget:state` wait are both still outstanding, so the
   * measurement the main process is holding the window off screen for is taken
   * off a scaling pill: exactly the defect the bound was written to prevent. On
   * the harness fixture that gap is ~150ms of a 150ms animation. So the gate is
   * `widget:resize` — the message that *carries* the measurement, and whose reply
   * `Overlay.resize` only sends after `setBounds` and `showInactive`. It is
   * strictly later and it is the earliest instant this side can know the window
   * is visible; starting sooner would show a fully drawn pill for an IPC hop and
   * then snap it back to 92% to grow again, which is a flinch rather than an
   * arrival.
   *
   * **Any settlement, including a refusal.** `ok: false` is « we did not place
   * you » and normally means the meeting ended under us — but a pill that is
   * never painted is worse than one painted early (DEC-26), and this window has
   * no taskbar entry to come back from. Same reason the two paths out of the
   * measurement effect that cannot measure at all release it before returning.
   */
  const [placed, setPlaced] = useState(false)

  /*
   * **The placement the renderer did not ask for.**
   *
   * `widget:resize` answers `above` on the reply, which covers every change this
   * component *caused*. Two changes it does not cause, and the main process is
   * the only thing that can see either: a display going away — the rescue that
   * keeps this window recoverable at all — and a drag across the display's
   * midline, which flips the stacking without changing the frame's size by a
   * pixel. Both used to depend on a `widget:resize` being sent, and both are a
   * broadcast now.
   */
  useBroadcast('widget:placed', ({ above: next }) => {
    // A window that has been let go of does not relayout — `leaving` in `Widget`
    // states the rule, and this is the one channel that would move the *card*
    // rather than its content: `above` flips `flex-col` to `flex-col-reverse`.
    if (gone.current) return
    setAbove(next)
  })

  /*
   * **The window is about to be destroyed and this is the only warning it gets.**
   *
   * `Overlay.dismiss()` asks, this fades, and the reply says how long the fade
   * takes so the main process can destroy the window after it rather than
   * during it. Nothing about the widget's *content* changes — the pill keeps its
   * elapsed time and its counter to the last frame, because the recording did
   * happen and a card that blanked its own numbers on the way out would be
   * saying something about the call that is not true. That sentence was written
   * here as a property and the product did the opposite for as long as it was
   * written down; what makes it true is the freeze in `Widget`, which is why
   * `leaving` arrives as a prop rather than being heard in this component.
   *
   * The reply is not load-bearing: `Overlay` armed a fallback timer before it
   * asked, so a renderer that is wedged, crashed or simply slower than half a
   * second loses its window anyway. A pill that outlives the call it reports is
   * worse than a pill that pops.
   */
  const shell = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!leaving) return
    /*
     * A layout effect, so the answer is sent *before* the first animated frame
     * is painted rather than after it. The main process counts from the reply, so
     * measuring early can only make the window outlive the animation — measuring
     * late would clip its own tail, which is the failure this whole handshake
     * exists to avoid.
     */
    const element = shell.current
    void invoke('widget:left', { afterMs: element ? transitionMs(element) : 0 }).catch(
      () => undefined,
    )
  }, [leaving])

  /**
   * The last measurement that was sent, **outside the effect**.
   *
   * It was a `let` in the effect's closure, which is a duplicate guard that only
   * guards within one arming of the effect — and the effect had no dependency
   * array at all, so it re-armed on every render and the guard was reset every
   * time. A ref is the same guard over the lifetime of the window, which is the
   * scope the question « have I already told the main process this » actually
   * has. It also absorbs `StrictMode`'s development double-mount, which is two
   * byte-identical sends on every first paint and nothing to do with the product.
   */
  const last = useRef('')

  /**
   * Whether the box being measured is drawn in the face it will keep.
   *
   * A ref and not state: flipping it must not re-render, and it has to survive the
   * effect re-arming on `above` — the question « has this window ever been legible »
   * belongs to the window, like `last` beside it.
   */
  const legible = useRef(false)

  /**
   * When this frame first armed its measurement, so both deadlines are measured
   * from the mount rather than from the arming that happens to be current — see
   * `MEASURE_DEADLINE_MS`.
   */
  const armed = useRef(0)

  /**
   * The content wait, as state rather than a ref, because it is the one of the two
   * that has to *re-arm the effect*: a size observer cannot see the placeholder
   * being replaced by a pill of a different width until after the fact, and the
   * whole point is to speak once, afterwards.
   *
   * `settled || waited` and never `settled` alone: a `widget:state` that never
   * answers must still produce a pill (DEC-26). What that costs is the placeholder
   * being measured, which is exactly what the rep used to get immediately.
   */
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), MEASURE_DEADLINE_MS)
    return () => clearTimeout(timer)
  }, [])

  /**
   * **Tell the main process when this clock started, because its deadline was armed
   * from a different one.**
   *
   * `Overlay` arms `FIRST_FRAME_MS` (300) inside its `ready-to-show` handler; every
   * wait in this file is absolute from *this* mount. So the hundred milliseconds
   * between the two constants was a hundred minus the gap between those two events —
   * measured at 81 ms and 47 ms on the machine this is written on, leaving 19 and 53,
   * on the critical path of `startRecording` where two audio devices are opening and a
   * transcriber is booting, for a rep on a Windows laptop (HR-2). Lose that race and
   * the main process reveals `INITIAL_SIZE`: a card forty-nine pixels narrower than
   * the pill, saying « Aucun enregistrement », over a live call.
   *
   * Sent in a layout effect with no dependencies, before the measurement effect can
   * possibly report — one message per window, at the earliest instant this side exists.
   * It carries `MEASURE_DEADLINE_MS` rather than agreeing it, for the reason `pillTop`
   * is measured and `widget:left` carries `afterMs`: a number two files have to keep
   * equal is a number that will stop being equal.
   *
   * Failing here costs nothing by design (DEC-26): the main process keeps the deadline
   * it has today, `APPEARANCE_MS` is above both, and a widget that does not appear is
   * worse than one that appears wrong.
   */
  useLayoutEffect(() => {
    void invoke('widget:measuring', { withinMs: MEASURE_DEADLINE_MS }).catch(() => undefined)
  }, [])
  const drawable = settled || waited

  useLayoutEffect(() => {
    const element = box.current
    /*
     * Nothing can be measured here, so nothing is going to release the arrival —
     * and an unreleased arrival is an invisible pill (DEC-26). This is the same
     * « every path out ends in a `send()` » contract `speak()` below keeps, one
     * level up: the two environments that reach it are a frame with no box and a
     * renderer with no `ResizeObserver`, which is jsdom.
     */
    if (!element || typeof ResizeObserver === 'undefined') {
      setPlaced(true)
      return
    }
    if (armed.current === 0) armed.current = Date.now()
    /**
     * Is the pill in the middle of its own arrival?
     *
     * The one question that keeps « the pill is measurable exactly while it is not
     * moving » true. A *paused* animation — the pill before the window is placed —
     * answers `paused`, not `running`, so the first measurement goes out normally;
     * and under `prefers-reduced-motion` the duration is `0ms` and the animation is
     * `finished` before it is ever played, so this is never true and no branch is
     * needed for that rep.
     *
     * `getAnimations` guarded because jsdom does not implement it: an environment
     * that cannot say answers « not moving », which is the permissive direction and
     * the one where a measurement is better than none.
     */
    const moving = (el: Element): boolean =>
      typeof el.getAnimations === 'function' &&
      el.getAnimations().some((animation) => animation.playState === 'running')
    const send = (): void => {
      /*
       * **And a leaving window asks for nothing more.**
       *
       * `Overlay` released it before it sent `widget:leave`, so a `widget:resize`
       * from here is answered `{ ok: false }` — which is not merely wasted work: the
       * reply carries `above: false`, and writing that in relaid the card out
       * mid-fade. The reply is guarded on `ok` below as well, because the same
       * refusal happens for a measurement that was already on the wire.
       */
      if (gone.current) return
      // Nothing is reported in the fallback face, and nothing is reported of a pill
      // that is still waiting for the read it draws — see `MEASURE_DEADLINE_MS`. The
      // observer fires on the initial observe too, so the guards have to be here and
      // not only on the first call.
      if (!legible.current || !drawable) return
      const pill = element.querySelector('[data-pill]')
      /*
       * **And nothing is reported of a pill that is scaling** (DEC-50).
       *
       * `getBoundingClientRect` includes transforms, so a rect read here while the
       * arrival is playing reports the pill 8% short — 35px on a 38px card — and
       * `Overlay.resize` sizes the window to it and holds *that* as `pillTop` and
       * `pillHeight` for every later placement. The measurement is not lost, it is
       * deferred: `animationend` below asks again, and the key then decides whether
       * anything has actually changed, so an arrival with no size change beside it
       * is silent rather than byte-identical. See `placed` for why the two can
       * never overlap on the *first* measurement, which is the one the window is
       * held off screen for.
       */
      if (pill && moving(pill)) return
      const frame = element.getBoundingClientRect()
      /*
       * The pill, found in the DOM rather than held in a ref.
       *
       * It was a ref on a wrapper carrying `display: contents` — which has no
       * box at all, so every measurement came back zero and the anchor the
       * whole placement is built on was « the top of the frame », silently. A
       * `data-` attribute on the element that actually paints cannot be wrong
       * in that way.
       */
      const anchor = pill?.getBoundingClientRect()
      const width = Math.ceil(frame.width)
      const height = Math.ceil(frame.height)
      // Where the pill is inside the frame, which is what lets the main process
      // leave *the pill* where it was rather than a window edge.
      const pillTop = Math.max(0, Math.round((anchor?.top ?? frame.top) - frame.top))
      /*
       * **The pill's width, published so the cards that hang from it can match.**
       *
       * `Refus` and `Mention` were `w-[260px]`, a number that matches one state
       * of the pill approximately and the other not at all: measured, the pill
       * is 272.28 recording and 189.56 idle, so the notice overhung by 1.14 px a
       * side in one state and sat 35.2 px inside in the other. Four widths on one
       * floating stack, none derived from another, scored on every review since
       * the surface got its own.
       *
       * A custom property and not React state, deliberately: this is already the
       * effect that measures the pill, a DOM write cannot re-enter the render
       * that scheduled it, and the alternative — state set from a
       * `ResizeObserver` — is exactly the loop that took the renderer suite to
       * « heap out of memory » one round ago.
       */
      if (anchor) element.style.setProperty('--pill-w', `${Math.round(anchor.width)}px`)
      /*
       * **`pillTop` is part of the key, and leaving it out was a 382-pixel
       * jump.**
       *
       * It is a function of the stacking direction, not of the size: `flex-col`
       * puts the pill at `HALO`, `flex-col-reverse` at `height − pillH − HALO`.
       * So dragging the widget across the display's midline with the panel open
       * flips `above`, moves the pill by the panel's whole height — and left the
       * frame exactly `width × height`. No message, and the main process went on
       * holding a `pillTop` of 402 for a pill painted at 20, so the next
       * legitimate resize placed the window as if the pill were where it no
       * longer was.
       */
      const key = `${width}×${height}×${pillTop}`
      // The observer fires on every sub-pixel change; the window may only be
      // moved for a real one, or a resize animates against itself.
      if (width === 0 || height === 0 || key === last.current) {
        // A frame with no box will never produce a measurement, so nothing here
        // would ever release the arrival — see `placed`. Fail open.
        if (width === 0 || height === 0) setPlaced(true)
        return
      }
      last.current = key
      void invoke('widget:resize', {
        width,
        height,
        pillTop,
        pillHeight: Math.round(anchor?.height ?? height),
      })
        /*
         * **`ok: false` is « we did not place you », never « you open downward ».**
         *
         * `Overlay.resize` answers that whenever there is no window — the meeting
         * ended between this measurement and its arrival, which its own docblock
         * names as the ordinary case — and `above` is then a default rather than an
         * answer. Writing it in flipped the chevron and relaid the card out during
         * the exit, which is half of the ~20 px slide measured in
         * `scratch/r26-e2e-widget-last-frame.cjs` (« ▴ » → « ▾ » at +54 ms).
         */
        .then((placement) => {
          if (placement.ok) setAbove(placement.above)
        })
        .catch(() => undefined)
        /*
         * The measurement has been answered, whatever the answer was: the window
         * has been placed at this size and shown, or there is no window. Either way
         * the pill may now be drawn and may now move — see `placed`.
         */
        .finally(() => setPlaced(true))
    }
    const observer = new ResizeObserver(send)
    observer.observe(element)
    /*
     * **And the pill, because the frame stopped being able to report it.**
     *
     * `--pill-w` is published from the pill's rect so the notices that hang from
     * it can match its width. The notices are *sized by* that variable, so once
     * one mounts it pins the frame's width — and then the pill shrinking inside
     * it (recording 285.55 → idle 199.56) changes no border box the observer is
     * watching. The variable kept the recording value and the refusal card
     * overhung the idle pill by 43 px a side: worse than the `w-[260px]`
     * constant it replaced, in the state `Refus` exists for.
     *
     * A consumer that pins the thing being measured is a measurement that stops
     * arriving. Observing the pill itself is what makes the published number a
     * reading rather than a memory.
     */
    const pillElement = element.querySelector('[data-pill]')
    if (pillElement) observer.observe(pillElement)

    /*
     * **The deferred measurement, asked again the instant the pill stops moving.**
     *
     * `animationend` and not a timer: the duration lives in `--motion`, it is `0ms`
     * under `prefers-reduced-motion`, and a constant here would be the second copy
     * of a number `tokens.css` owns — which is the mistake `widget:left` exists to
     * avoid on the other end of the same window. It bubbles, so one listener on the
     * frame covers the pill's arrival and the panel's; the panel's costs a rect read
     * and the key then finds nothing to say.
     */
    element.addEventListener('animationend', send)

    /*
     * **Speak once the type is settled, and always speak.** Both halves matter: the
     * main process is holding the window off screen until we do, so every path out of
     * here ends in a `send()` — a font that never arrives costs the rep a worse
     * measurement, never a missing pill (DEC-26).
     */
    let deadline: ReturnType<typeof setTimeout> | null = null
    const speak = (): void => {
      if (legible.current) return
      legible.current = true
      if (deadline !== null) clearTimeout(deadline)
      deadline = null
      send()
    }
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    if (legible.current) send()
    else if (!fonts) speak()
    else {
      /*
       * **Three of this API's four obvious answers are wrong here**, and each was
       * measured before being discarded — the whole point of this fix is that the
       * numbers are the argument.
       *
       * `fonts.status === 'loaded'` is true whenever nothing is *pending*, and a
       * bundled face no box has asked for yet is not pending: the first attempt took
       * that path, reported **239 px** in the fallback face and swapped to 281 exactly
       * as before. `fonts.ready` has the same shape — it resolves when the current set
       * of loads is done, which at this instant can be none. And `fonts.check(…)` on
       * the computed shorthand answers **true**, correctly and uselessly: the question
       * it asks is whether the text can be rendered with the *list*, and
       * `-apple-system` at the end of that list always can.
       *
       * So the face has to be asked for by name — the family's first entry, read off
       * the element rather than written down here — and then the set awaited, because
       * `load('1em Inter')` triggers the family while the pill draws two weights of it
       * (measured: two `Inter` faces, one `loaded` and one `unloaded`) and only
       * `ready` covers the second.
       *
       * `speak` on rejection as well: a face that fails is a measurement in the
       * fallback, which is the honest answer and never a reason to withhold the
       * window (DEC-26).
       */
      const primary = getComputedStyle(element).fontFamily.split(',')[0]?.trim()
      if (!primary) speak()
      else {
        void fonts
          .load(`1em ${primary}`)
          .then(() => fonts.ready)
          /*
           * One frame after the set settles, because `ready` resolves before the
           * layout it caused has run: measured, the first report was 276 px and the
           * box was 281 a frame later. Five pixels is two and a half of window x —
           * `placeAroundPill` holds the pill's centre — which is not much, and it is
           * the difference between a card that appears and one that appears and then
           * twitches.
           */
          .then(
            () =>
              new Promise<void>((settled) => {
                requestAnimationFrame(() => settled())
              }),
          )
          .then(speak, speak)
        // From the mount, not from this arming — see `MEASURE_DEADLINE_MS`.
        deadline = setTimeout(
          speak,
          Math.max(0, MEASURE_DEADLINE_MS - (Date.now() - armed.current)),
        )
      }
    }

    return () => {
      if (deadline !== null) clearTimeout(deadline)
      element.removeEventListener('animationend', send)
      observer.disconnect()
    }
    /*
     * **`[above]`, and the missing array was the only thing keeping this window
     * on the screen.**
     *
     * There was no dependency array at all. So the cleanup ran and the effect
     * re-armed on *every* render of the frame, `last` — then a `let` in this
     * closure — went back to `''`, and a byte-identical `widget:resize` went out:
     * two measured in Chromium on the first paint alone, three with
     * `StrictMode`'s development double-mount. The comment here argued that was
     * free: « `send` is idempotent — the key stops a duplicate — so asking on
     * every render of the frame costs one rect read. » The key does stop a
     * duplicate; re-arming the effect destroyed the key. The key is a ref now, so
     * the two halves of that sentence are finally about the same thing.
     *
     * And the duplicate was **load-bearing**, which is why adding the array is
     * not the fix. `placeWindow`'s quarter-overlap rule — the defence against the
     * one unrecoverable window in this product — ran nowhere but on the reply to
     * this call, so a pill dragged onto a monitor that was then unplugged came
     * back only because a re-render re-sent an unchanged measurement. Which means
     * it came back only when a transcript segment arrived: it failed exactly when
     * transcription is what has died, which is one of the two readings this pill
     * is up to give. Driven against the shipped `Overlay`: pill at y=1920 with
     * the work area ending at 877, rescued by a message the renderer had no
     * reason to send. That rescue is `Overlay.displaysChanged()` now, on
     * `display-removed` and `display-metrics-changed`, with no renderer
     * involvement at all.
     *
     * What is left for the array to carry is the one thing a *size* observer
     * genuinely cannot see. `above` flips `flex-col` to `flex-col-reverse`: the
     * pill moves by the panel's whole height and the frame stays exactly
     * `width × height`, so `ResizeObserver` never fires and the main process goes
     * on holding a `pillTop` of 402 for a pill painted at 20. Re-arming on that
     * one state — which a `requestAnimationFrame` per render used to do by
     * accident, and only because there was no array — asks again with the new
     * offset, and the ref then decides whether there is anything to say: a flip
     * while the panel is *shut* moves the pill by nothing, because a single-child
     * `flex-col-reverse` puts it at `HALO` exactly as `flex-col` does, and that
     * one is now silent rather than byte-identical.
     *
     * `drawable` is the second entry and it is there for the same reason as the
     * first: **it is the moment there is something worth measuring, and no size
     * change announces it.** The placeholder pill and the real one are different
     * widths, so the observer *would* fire — but a frame later, after the main
     * process had already been told the placeholder's size and had shown the
     * window at it. Re-arming here asks again on the transition itself, and the
     * key then decides whether there is anything to say: a `widget:state` that
     * answered before the first paint leaves the two measurements identical and
     * this one silent. It flips at most once per window.
     */
  }, [above, drawable])

  /*
   * The pointer over the halo hands the mouse back to whatever is underneath.
   *
   * On `pointermove` rather than `mouseenter`/`mouseleave` on two elements: once
   * the window is ignoring the mouse it receives *moves* and nothing else, so a
   * `mouseenter` on the card would never arrive and the widget would be
   * unclickable until it resized. One handler, one question — is the pointer
   * over the card — asked on every move.
   */
  const through = useRef<boolean | null>(null)
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const cards = box.current?.querySelectorAll('[data-card]')
    if (!cards || cards.length === 0) return
    // Any card, not one: the pill and the panel are two rounded rectangles with
    // a gap between them, and the gap is halo like any other edge.
    const inside = [...cards].some((card) => {
      const rect = card.getBoundingClientRect()
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      )
    })
    if (through.current === !inside) return
    through.current = !inside
    void invoke('widget:passThrough', { through: !inside }).catch(() => undefined)
  }

  return (
    <div
      ref={shell}
      /*
       * The exit rides on the *outer* div and never on `box`. `box` is the
       * measured element: `ResizeObserver` watches its border box, which a
       * transform does not change, and `pillTop` is a difference of two rects
       * that a transform shifts equally — so the fade sends no `widget:resize`
       * from either half. Putting the class on the measured element would have
       * been correct by that same arithmetic and one refactor away from not
       * being.
       */
      className={`flex h-full w-full items-start justify-center bg-transparent${
        leaving ? ' widget-leaving' : ''
      }`}
      onPointerMove={onPointerMove}
    >
      {/*
        `w-max`: the frame is measured, so it must be exactly as wide as its
        content and never as wide as the window it is in — otherwise the first
        measurement reports the window's own size back to the window and it
        never shrinks again.

        `flex-col-reverse` when the panel opens upward. The DOM order never
        changes, so the tab order is always pill first, and only the paint
        flips.
      */}
      <div
        ref={box}
        style={{ padding: `${HALO}px` }}
        className={`flex w-max ${above && open ? 'flex-col-reverse' : 'flex-col'}`}
      >
        {children(above, placed)}
      </div>
    </div>
  )
}

/**
 * **A refused mark, where a sighted rep can see it.**
 *
 * `meeting:mark` refuses whenever the meeting is not `recording` — which
 * `EndOfMeetingWatch` can make true with the pill still floating over the call —
 * and on any store failure. The sentence used to go into the `sr-only`
 * paragraph at the bottom of this window: a 1×1 box with `clip: rect(0,0,0,0)`,
 * measured, on a window with no `role="alert"` anywhere in it. The pill's
 * counter — the only receipt a press without a note has — correctly did not
 * move, because nothing was written. So the screen's answer to a refusal and its
 * answer to a success were **the same screen**, and the second one is the one a
 * rep would assume: they pressed, nothing changed, and the moment they were
 * marking is the one they will look for at the gate. A mark is typed one-handed
 * over a client's face precisely because a rep who is talking is not looking for
 * a button; they are not going to look twice either.
 *
 * Three constraints from DEC-49, and each rules something out:
 *
 *  · **It must not take focus.** It is not a dialog, it has no autofocus and it
 *    traps nothing — a rep is mid-sentence on a call, and the keyboard is
 *    theirs. `role="alert"` announces without moving the caret; that is what the
 *    role is.
 *  · **It must not cover the call.** It is the width of the pill's own card and
 *    two lines at most, adjacent to the control that was pressed, and the window
 *    resizes to exactly it (`widget:resize`) rather than reserving room for it.
 *  · **It must carry `data-card`.** Everything in this window that is not a card
 *    is halo, and halo is handed to Teams with
 *    `setIgnoreMouseEvents(…, { forward: true })` — so a notice that forgot the
 *    attribute would draw a dismiss button the pointer goes straight through.
 *
 * Dismissed rather than timed out. A message that removes itself after four
 * seconds is the `sr-only` paragraph again for a rep who was looking at the
 * client: the whole failure here is a rep not looking at this window at the
 * moment it had something to say. It cannot stack either, because there is one
 * card state and not two (`WidgetCard`) — and « replaced by whatever the next
 * press produces » is narrower than it sounds and had to be: a press on the
 * control this refused replaces it, and a press on the one 32 px away does not.
 * That sentence used to be the whole rule, and the mention control read it
 * literally and deleted a refusal that had nothing to do with it.
 */
function Refus({
  text,
  leaving,
  above,
  onDismiss,
}: {
  text: string
  /** On its way out — see `CARD_MOTION`. */
  leaving: boolean
  /**
   * Painted *above* the pill, which is `above && open` and not `above` — the
   * column only reverses when the panel is out, and this card is most often
   * drawn with no panel at all. Measured on the shipped stub, which answers
   * `above: true`: taking `above` alone gave the refusal a
   * `transform-origin` of `50% 100%` while it was hanging *below* the pill, so
   * it grew out of its own far edge.
   */
  above: boolean
  onDismiss: () => void
}) {
  return (
    <div
      data-card
      data-above={above}
      /* The width of the pill it hangs from — see `--pill-w`. */
      style={{ width: 'var(--pill-w, 260px)' }}
      className={`bg-card border-card shadow-overlay ${CARD_SEAM(above)} flex items-start gap-tight self-center rounded-lg border px-snug py-tight ${CARD_MOTION(leaving)}`}
    >
      {/*
        `--warn` and `font-semibold` together, never colour alone: `--warn`
        against `--text-muted` is 1.0:1 in luminance, so a deuteranope and a
        greyscale screenshot both read this as ordinary prose if the weight is
        not carrying it too. Same rule as `⚠ faible` at the gate.
      */}
      <p role="alert" className="text-warn min-w-0 flex-1 text-meta font-semibold">
        {text}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Masquer ce message"
        className="no-drag text-muted hover:text-strong inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm transition"
      >
        <span aria-hidden className="text-ui leading-none">
          ×
        </span>
      </button>
    </div>
  )
}

/**
 * **The sentence, where the rep can read it out** (US-11, `mention.ts`).
 *
 * The clipboard is invisible. A press that only wrote to it would be the
 * `sr-only` paragraph `Refus` exists to replace: nothing on screen changes, and
 * the rep — who is mid-sentence on a call and did not press this to admire it —
 * has no way to tell it worked. Drawing the sentence is also the *other* route the
 * story names first, and the one a rep uses more: « or reads it out, which is what
 * a rep does anyway ». So this card is not a receipt, it is the feature's second
 * half.
 *
 * Four properties, each ruling something out:
 *
 *  · **`data-card`.** Everything on this window that is not a card is halo, and
 *    halo is handed to Teams with `setIgnoreMouseEvents(…, { forward: true })` — a
 *    card that forgot the attribute would draw a dismiss button the pointer goes
 *    straight through. Same rule, same sentence, as `Refus`.
 *  · **`role="status"`, not `alert`.** Nothing has gone wrong. It is announced
 *    politely, it takes no focus and it traps nothing: a rep is talking to a
 *    client, and the keyboard is theirs.
 *  · **Dismissed, never timed out.** The whole failure mode on this window is a
 *    rep not looking at it at the moment it had something to say, and a sentence
 *    they are about to read aloud is the last thing to remove on a four-second
 *    timer. It is replaced by the next press rather than stacked — and it **yields**
 *    to a refusal the rep has not dismissed, which is `WidgetCard`'s whole reason
 *    for being one state: a mark that was refused is a write the rep believes
 *    happened, and this sentence is one press away from being asked for again.
 *  · **It states the clipboard and the log separately, and claims nothing about
 *    the client.** There is no « le client a été informé » on this card and no
 *    string anywhere that could become one: the product knows what it handed over
 *    and nothing about what was said.
 *
 * `measure` on the sentence because it is prose and `.measure` is where prose
 * lives in this product — `ch` resolves against the element's own size, so the
 * class goes on the element holding the text and not on a wrapper. At 260 px the
 * cap is not what is binding, which is exactly why it costs nothing to be right.
 */
function Mention({
  sentence,
  copied,
  logged,
  leaving,
  above,
  onDismiss,
}: {
  /** What was copied, carried from the press rather than re-read (US-19). */
  sentence: string
  copied: boolean
  /** `null` while the log write is on the wire — see `mention` in `Widget`. */
  logged: boolean | null
  /** On its way out — see `CARD_MOTION`. */
  leaving: boolean
  /** Painted above the pill — `above && open`, see `Refus`. */
  above: boolean
  onDismiss: () => void
}) {
  return (
    <div
      data-card
      data-above={above}
      /* The width of the pill it hangs from — see `--pill-w`. */
      style={{ width: 'var(--pill-w, 260px)' }}
      className={`bg-card border-card shadow-overlay ${CARD_SEAM(above)} flex items-start gap-tight self-center rounded-lg border px-snug py-tight ${CARD_MOTION(leaving)}`}
    >
      <div role="status" className="min-w-0 flex-1">
        <p className="text-strong measure text-ui">{sentence}</p>
        {/*
          `--warn` never alone: it is 1.0:1 against `--text-muted` in luminance, so
          a deuteranope and a greyscale screenshot both read it as ordinary prose
          unless the weight carries it too. Same rule as `⚠ faible` at the gate.
        */}
        <p
          className={`mt-hair text-meta ${copied ? 'text-muted' : 'text-warn font-semibold'}`}
        >
          {MENTION_COPY_STATE(copied)}
        </p>
        {logged === false ? (
          <p className="text-warn mt-hair text-meta font-semibold">{MENTION_NOT_LOGGED}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Masquer cette phrase"
        className="no-drag text-muted hover:text-strong inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm transition"
      >
        <span aria-hidden className="text-ui leading-none">
          ×
        </span>
      </button>
    </div>
  )
}

interface PillProps {
  title: string | null
  startedAt: number | null
  meetingId: string | null
  marks: number
  paused: boolean
  open: boolean
  above: boolean
  /**
   * Whether the main process has placed this window and shown it — see `placed` in
   * `Frame`, which is the only thing that decides it. Until then the pill is
   * *laid out* and not *drawn*, which is what makes the first measurement a
   * measurement of an untransformed box (DEC-50).
   */
  placed: boolean
  onToggle: () => void
  onMark: () => void
  /** US-11 — one press, the sentence on the clipboard and on screen. */
  onMention: () => void
}

/**
 * The collapsed state, and the part that is always on screen.
 *
 * **The whole pill is the drag handle** (`drag-region` in `index.css`), which
 * is what a frameless window has instead of a titlebar, and every control on it
 * opts back out with `no-drag`. The two cannot be the same rectangle: a region
 * Electron has claimed for dragging never delivers a click, so a pill that was
 * also a button would be a control that works about half the time — and « half
 * the time » is the worst version of the dead control DEC-26 forbids, because
 * the rep cannot even tell it is broken.
 */
function Pill({
  title,
  startedAt,
  meetingId,
  marks,
  paused,
  open,
  above,
  placed,
  onToggle,
  onMark,
  onMention,
}: PillProps) {
  return (
    <div
      data-pill
      data-card
      /*
        `self-center`, and it is not cosmetic.

        The frame is a `flex-col` whose `align-items` defaulted to `stretch`, so
        opening the panel stretched the pill from its own 240 px to the panel's
        340 and left its content packed at the left — a hundred pixels of blank
        card to the right of the chevron. And the card's *centre* is what
        `placeAroundPill` holds fixed, so a card that grows by a hundred grows
        fifty each way: every control on the pill moved **50 px left, under the
        pointer, on the press that opened the panel**. The chevron's before and
        after rectangles were disjoint, so the reflex second press landed on
        bare pill — which is `drag-region`, and Electron delivers no click from
        one, so it did nothing at all.

        Centred and its own width, the pill is invariant under the panel opening:
        the centre does not move, so neither does anything measured from it.
        `widget-ouvert` measures the chevron across the press.
      */
      /*
        **The arrival** (DEC-50, `.widget-arriving` / `.widget-arrived` in
        `index.css`). Two states and never both: until the window has been placed
        this card is laid out and transparent — *untransformed*, which is what
        makes the size the main process is waiting for a measurement of the real
        pill — and `placed` swaps it for the animation. `placed` is the reply to
        the `widget:resize` that carried that measurement, so the measurement and
        the transform cannot overlap. That is not a nicety:
        `getBoundingClientRect` includes transforms, and the first draft of this
        held the pill at `scale(0.92)` before the swap and reported
        `pillHeight: 35` for a 38px card.

        No `transform-origin` here on purpose. The pill is its own anchor —
        `placeAroundPill` holds its centre-x — so the CSS initial centre is
        already right, and restating it would be a declaration that changes
        nothing. The *panel* is the one that has to follow `above`.
      */
      /*
        **Two groups at one interval, which is to say no groups at all.**
        Measured on the shipped pill: six children, five gaps, `[8, 8, 8, 8, 8]`
        — the dot sat as far from the meter as the mark button sat from the
        chevron, so three *readings* and three *controls* read as one
        undifferentiated row of six. Grouped now: `gap-tight` inside each half,
        `gap-inline` between them, so the seam a rep's eye needs is twice the
        one it must ignore.

        And `px-snug` rather than `pl-2.5 pr-tight`: the inset was **10 left, 6
        right** — measured ink 11 px from the left edge against 7 from the
        right, undocumented, on the one card that is always up. 8 and 8 is the
        same sixteen pixels of horizontal padding, so the pill's width is
        unchanged by the symmetry.
      */
      className={`drag-region bg-card border-card shadow-overlay flex shrink-0 items-center gap-inline self-center rounded-lg border px-snug py-tight ${
        placed ? 'widget-arrived' : 'widget-arriving'
      }`}
    >
      {/*
        Recording, said the way the rest of the product says it: orange, which
        VISION.md §6 gives exactly one meaning — armed or recording — and a
        word, because colour is never the only carrier of a state here.

        **And it has to be conditional, which for two rounds it was not.** Both
        the dot and its `sr-only` word were drawn unconditionally, so with no
        meeting the pill showed « Aucun enregistrement » beside a `--accent` dot
        — sampled `rgb(255,133,0)`, byte-identical to the recording state two
        lines of code away — while announcing « Enregistrement en cours » to a
        screen reader. On the one surface built to be read across a desk, over
        everything the rep shares, the loud element said the same thing whether
        a client was being recorded or not, and the spoken one was simply false.
        The comment above asserted the rule the code broke.

        Idle takes `StateDot`'s `pending` ring — « the slot is here and it is
        empty », which is exactly the state and commits to no semantic colour.
        Not a second fill: a grey dot would be a third thing to tell apart at a
        glance, and the whole point is that there are two.
      */}
      {/*
        **The readings, as one group.** The dot, the meter and the clock all
        answer « what is this window doing right now »; the three controls after
        them answer « what can I do about it ». This span is the first half, and
        it already existed to hold the dot beside its spoken twin — the meter
        and the clock moved into it rather than a third wrapper being added.
      */}
      <span className="flex shrink-0 items-center gap-tight">
        <span
          aria-hidden
          /*
            `data-graphic`, and this is the surface that most needed it. The
            check is opt-in — 1.4.11 covers a graphic *required to understand
            the content*, and only the author knows which — and exactly one
            element in the renderer had opted in, so « graphiques 3:1 » printed
            green on all eight widget stages having measured nothing.

            This one qualifies where a `StateDot` does not. `StateDot` refuses
            to render without a *visible* label beside it, so the dot is a
            second carrier of something already written down. Here the pill's
            words are a clock and a meter; the spoken twin is `sr-only`. For a
            rep reading this across a desk, over a client's video, the dot is
            the whole signal.
          */
          data-graphic={
            meetingId === null
              ? 'aucun enregistrement'
              : paused
                ? 'enregistrement en pause'
                : 'enregistrement en cours'
          }
          className={
            meetingId === null
              ? 'h-2 w-2 shrink-0 rounded-full bg-transparent ring-1 ring-inset ring-muted'
              : paused
                ? /*
                    **Paused is a shape, because hollow was already spent.**
                    It was `bg-transparent ring-1 ring-inset ring-accent` — the
                    same 8px circle with a 1px annulus that *idle* draws, one
                    hue apart. On the one surface in this product meant to be
                    read from a metre away, over somebody else's video, two of
                    the three states were the same glyph and the difference was
                    orange-versus-grey at eight pixels.

                    That is round 4's finding — a mark that says the same thing
                    in two states, the reason this surface got a reviewer of its
                    own — one state over. Subtraction cannot carry it: an
                    emptied circle already means « there is nothing here ». Two
                    bars is a shape idle cannot also be, it is what every
                    transport control a rep has ever used means by pause, and it
                    keeps the hue that says the call is still armed.
                  */
                  'border-accent h-2 w-2 shrink-0 border-x-2 border-y-0 bg-transparent'
                : /*
                  No ring. The mark wore a `--warn` boundary for one commit,
                  because `--accent` on the pill's old `--bg-card` ground was
                  2.41:1 and under 1.4.11's 3:1. The ground moved (`--widget-bg`
                  in tokens.css) and the same dot on the same hue is **5.11:1**
                  there, so the boundary has nothing left to do and a second
                  orange inside an 8px circle is only mud.
                */
                'bg-accent h-2 w-2 shrink-0 rounded-full'
          }
        />
        {/*
          Only when there is something to say that is not already on screen.
          Recording, the pill's words are a clock and a meter — neither of which
          names the state — so the dot needs a spoken twin. Idle, « Aucun
          enregistrement » is already *visible* two elements along, and a second
          copy here is the same sentence twice to a screen reader and a strict
          -mode collision for any stage that looks the string up.
        */}
        {meetingId === null ? null : (
          <span className="sr-only">
            {paused ? 'Enregistrement en pause' : 'Enregistrement en cours'}
          </span>
        )}

        {meetingId === null ? (
          <span className="text-muted px-hair text-ui">Aucun enregistrement</span>
        ) : (
          <LevelMeter meetingId={meetingId} variant="pill" paused={paused} />
        )}

        {/*
          The clock, or the word. A pause is the one state in which elapsed time
          stops meaning « how long this call has been written down », so the word
          takes its rectangle rather than sitting beside a counter that lies.
        */}
        {paused ? (
          <span className="text-muted shrink-0 text-ui">En pause</span>
        ) : (
          <Elapsed since={startedAt} />
        )}
      </span>

      {/*
        **The controls, as the other group.** Three presses — tell the client,
        mark the moment, open the panel — at `gap-tight` inside, `gap-inline`
        away from the readings. The wrapper is unconditional and its contents
        are not: before `widget:state` answers there is only the chevron in it,
        which is the placeholder the window is held off screen for.
      */}
      <span className="flex shrink-0 items-center gap-tight">
      {/*
        **Telling the client, in one press** (US-11, `mention.ts`).

        On the pill and not in the panel, and that is the whole shape of the
        feature: the moment it is wanted is the first thirty seconds of a call,
        when the rep is greeting somebody and has not opened anything. A control
        behind a 340-pixel card over the client's face is a control that gets
        pressed after the interesting part of the conversation, or not at all.

        It costs 30 px of pill — 24 of button, measured on the shipped stage, and
        the control group's own 6 of gap. It was 32 while that gap was the row's
        flat 8; grouping the pill gave the 2 back. Every one of them is a pixel of
        Teams the rep cannot click.
        That is the price of the one thing on this list with a procurement
        consequence, and it is paid in the state that is always up rather than in a
        surface that only exists while the rep is looking at it.

        Drawn exactly when the mark button is: `meetingId === null` is the pill
        before `widget:state` answers, which is the placeholder the main process
        must never be shown measuring (see `MEASURE_DEADLINE_MS`). So this control
        arrives with the real pill, inside the one measurement the window is held
        off screen for, and adds no settling step of its own.
      */}
      {meetingId === null ? null : (
        <button
          type="button"
          onClick={onMention}
          aria-label={MENTION_LABEL}
          className="no-drag text-muted hover:bg-subtle hover:text-brand-700 inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm px-hair transition"
        >
          <Speech />
        </button>
      )}

      {/*
        **Marking, without opening anything.**

        Three files described this button before it existed, which is the defect
        this repo has now been caught committing more than once: the contract
        says « null is the other press — the button on the pill », and the pill
        had exactly one control on it, the chevron. A rep who wanted to mark a
        moment had to open a 340-pixel card over the client's face first, which
        is the opposite of what a one-press bookmark is for.

        The count beside it is the receipt. A press with no note produces no
        visible change anywhere — the panel may be closed, and is — so without
        it the rep would have pressed a button that, as far as the screen is
        concerned, did nothing.
      */}
      {meetingId === null ? null : (
        <button
          type="button"
          onClick={onMark}
          /*
            Unavailable *with a stated reason*, which is the only other case this
            product allows (`ui/Button.tsx`). While frames are being dropped a
            mark would point at audio that was never kept — see `mark`.
          */
          disabled={paused}
          title={paused ? PAUSED_NO_MARK : undefined}
          aria-label={
            paused
              ? 'Marquer ce moment — indisponible en pause'
              : marks === 0
                ? 'Marquer ce moment'
                : `Marquer ce moment (${marks} déjà marqués)`
          }
          className="no-drag text-muted hover:bg-subtle hover:text-brand-700 disabled:hover:bg-transparent disabled:hover:text-muted inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center gap-hair rounded-sm px-hair transition disabled:opacity-60"
        >
          <Bookmark />
          {marks > 0 ? (
            <span aria-hidden className="tabular-nums text-meta leading-none">
              {marks}
            </span>
          ) : null}
        </button>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        /*
          Named, not decorated. « ▸ » is a shape and a screen reader reads it as
          nothing; the check that measures every control's accessible name is
          what caught the last one of these in this product.

          The arrow points where the panel will go, which is the direction the
          main process answered with — a chevron that always pointed up while
          the card opened downward would be the widget lying about itself.
        */
        aria-label={open ? 'Replier le panneau' : `Ouvrir le panneau${title ? ` — ${title}` : ''}`}
        className="no-drag text-muted hover:bg-subtle hover:text-strong inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm transition"
      >
        {/*
          **Drawn, not typed.** This was « ▾ »/« ▴ » — U+25BE and U+25B4, set in
          the body font. Measured on the shipped stylesheet: Inter 4.1 does not
          carry either, so the mark was painted by whatever the operating system
          substituted — a mac fallback here, Segoe UI Symbol on **Windows**,
          which is where this ships first (HR-2). It also painted at
          **5.67×12** beside the card's 10×12 bookmark and 12×12 bubble, because
          a character's ink is a fraction of its em while an icon's is its box.
          Lucide at 12 puts it on the one icon weight the census holds, in a font
          this app ships, at the size of the marks beside it.

          The direction still says where the panel will go, and the test still
          reads it — off `data-arrow`, which is the attribute that replaced a
          `textContent` assertion on a character.
        */}
        {open === above ? (
          <ChevronDown aria-hidden data-arrow="down" size={12} strokeWidth={2} />
        ) : (
          <ChevronUp aria-hidden data-arrow="up" size={12} strokeWidth={2} />
        )}
      </button>
      </span>
    </div>
  )
}

/** The running length of the call. Its own subscription, like the meter's. */
function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  if (since === null) return null
  return (
    <span
      /*
        The one number a rep glances at without stopping the conversation, so it
        takes the same rung as the heading rather than the body's 12px. The pill
        is content-sized, so it widens once and never moves again.
      */
      className="text-strong shrink-0 tabular-nums text-prose"
      aria-label="Durée d’enregistrement"
    >
      {formatElapsed(now - since)}
    </span>
  )
}

interface PanelProps {
  meetingId: string
  /**
   * Which way this panel stacks, answered by `Overlay.resize` because only the
   * main process knows which half of which display the pill is in.
   *
   * It decides the paint order in `Frame` and, here, the `transform-origin` the
   * opening grows from: DEC-50's « origin-aware from the pill rather than from the
   * card's centre ». Measured on the real window before it was: `transform-origin:
   * 170px 102.594px` — dead centre, the CSS initial, whichever way it stacked.
   */
  above: boolean
  /** On its way out — held one `--motion` by `useDeparture` in `Widget`. */
  leaving: boolean
  /** The client, else the objet, else nothing — never an invented name. */
  heading: string
  turns: readonly TranscriptSegment[]
  marks: readonly MomentMark[]
  /**
   * Collected *and worded* by the window, never here — see the note on the
   * state itself, and `healthSentence.ts` for who wrote the sentence.
   */
  trouble: HealthLine | null
  onMark: (segmentId: string | null, note: string) => void
  onForget: (markId: string) => void
  onClose: () => void
  /**
   * The panel asks; the window answers. It owns the channel, the `role="alert"`
   * card and the `widget:state` re-read a refusal needs — see `pause` there, and
   * `mark` above it for the same split.
   */
  onPause: (paused: boolean) => void
  paused: boolean
}

function Panel({
  meetingId,
  above,
  leaving,
  heading,
  turns,
  marks,
  trouble,
  onMark,
  onForget,
  onClose,
  onPause,
  paused,
}: PanelProps) {
  const [note, setNote] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)

  /*
   * Everything said, in order, with the rep's own marks in place — one helper
   * in `core/contracts/marks.ts`, shared with the two readers in the app, so
   * the widget and the gate cannot disagree about where a mark sits.
   */
  const rows = useMemo(() => interleaveMarks(turns, marks), [turns, marks])

  /*
   * Follow the conversation, unless the rep has scrolled up.
   *
   * Sticking to the bottom unconditionally is how a reader takes a line away
   * from somebody who is reading it — which on this surface means taking it
   * away mid-call, when they cannot get it back without scrolling past
   * everything that has arrived since.
   */
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)

  /*
   * **A log that holds more than its box has to say so, at the edge it is
   * hiding it behind.**
   *
   * `data-scrolls` declares that this box is *allowed* to overflow — it is a
   * log, it sticks to the bottom, and holding more than it shows is the point.
   * What the attribute does not do, and what it quietly bought an exemption
   * from, is put anything **on screen** saying so. The result was a hard rule
   * across the first visible line: « chacun. » sliced through its x-height by
   * the panel's own border, on the one surface a rep looks at for fifty
   * minutes. That is the *Historique* finding again — « a hard rule under the
   * last visible line read as the end of a four-paragraph document » — arriving
   * at the top edge instead of the bottom, on a pane the declaration had made
   * invisible to `--scrollers`.
   *
   * A `ReadingColumn` is the wrong instrument here: it is prose with a page
   * turn, and this is a log that moves under the reader. What a log needs is the
   * cue every chat surface uses — the content receding rather than being cut —
   * and it is conditional on both sides, which is the half that makes it read as
   * a finish rather than as a permanent grey band. Nothing above: no top fade,
   * so the first line of a short call is at full strength. Scrolled up to read
   * back: the bottom fades too, which is the only thing on screen saying that
   * newer turns have arrived below.
   */
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measure = (element: HTMLDivElement) => {
    const above = element.scrollTop > 2
    const below = element.scrollHeight - element.scrollTop - element.clientHeight > 2
    setEdges((was) => (was.top === above && was.bottom === below ? was : { top: above, bottom: below }))
  }

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    if (stuck.current) element.scrollTop = element.scrollHeight
    measure(element)
  }, [rows.length])

  return (
    <div
      data-card
      /*
        **The opening** (DEC-50). Mounted by a press, so the animation runs from
        the mount and needs no gate — and it needs none for the measurement
        either: a transform on this card changes neither the frame's border box
        (a descendant's transform is not layout) nor the pill's rect, so
        `widget:resize` reads the same numbers whether this is scaling or at rest.
        The pill's arrival is the one that has to be held, and it is.

        `data-above` rather than an inline `transform-origin`: the value is a
        judgement about which edge the panel belongs to and it lives in the
        stylesheet with the reasoning, not spread over two files as a string.
      */
      data-above={above ? 'true' : 'false'}
      className={`bg-card border-card shadow-overlay my-tight w-[340px] rounded-lg border ${
        leaving ? 'widget-panel-leaving' : 'widget-panel-arrive'
      }`}
    >
      {/*
        Which call this is.

        The pill deliberately does not carry it — a name floating over a video
        call is the one thing on this window that would be read by everybody in
        the room if the rep is sharing their screen, and the pill is the state
        that is always up. Here it is behind a press the rep made, and the
        window is excluded from screen capture entirely
        (`setContentProtection`), which is what makes putting it here defensible
        at all.

        `Réunion en cours` is the honest fallback. The objet is typed during or
        after the call (DEC-31), so at minute two there is often nothing to
        print, and inventing one from the calendar would be the app naming a
        meeting the rep has not named.
      */}
      {/*
        **And under it, the one fact that makes the line above defensible.**

        The heading is the client's name, floating over a video call the rep may
        well be sharing. It is here only because the window carries
        `setContentProtection(true)` — it is excluded from the screen capture —
        and that guarantee was documented in this file and stated nowhere a rep
        could read it. A rep who does not know it will not put the panel up
        during a share, which is every moment the panel is worth having.

        11px, muted, and `aria-hidden` on the glyph: it is a caption on a title,
        not a control, and it is the same sentence in all three open states
        because it is the same guarantee.
      */}
      {/*
        **The chrome zones group by fill; the content zone is the card itself.**

        This card carried a rule above the transcript, a rule above the composer
        and a rule above the footer — three lines to say « these three bands are
        not the conversation ». A fill says it once per band and says it without
        drawing anything, which is what `--widget-soft` was raised to 1.54:1 to
        make possible: until then a fill here was invisible and a line was the
        only tool.

        **One filled zone, not two — which took a round and a regression to
        learn.** The first version of this put the fill on the header *and* the
        tray, and a reviewer scored the card down for it: 51px of filled bar
        holding the title above 83px of filled bar holding controls is 38% of the
        card's height, and it reads as a title bar over a toolbar. On the one
        surface whose invariant is « it is not an open app ». Trading a stroke for
        a band is the same mistake one level up — the rubric's 10 is « no band, no
        stroke doing a ground's job ».

        So the tray keeps the fill, because it is chrome and it groups four
        controls that would otherwise float. Everything above it — the title, the
        capture-trouble line, the transcript — is the card's own ground, and what
        separates them is space. Two zones, no internal rules, and the only lines
        left on the card are its own edge and the quotation gutters.
      */}
      <div className="px-inline py-tight">
        <div className="flex items-baseline gap-snug">
          <h1
            /*
              **The top of the ladder, and it is three steps away from the body
              now rather than one.**

              It was `text-ui font-semibold` — 12px — and the client's
              transcribed words are `text-ui` at 12px too, on a surface that
              pointed `--text-strong` and `--text-body` at the same value. So the
              card's title and the sentence the client had just spoken were
              identical in size *and* colour, separated by weight alone, and the
              whole window held two sizes: 1.09:1.

              A size rung was the first repair and it left the colour collapse in
              place — the paragraph above this one said so and worked around it.
              `--widget-ink-body` is the missing step, so this line is now a size,
              a weight **and** a colour away from the prose under it, which is
              what the axis asks of a rung.

              `--type-subhead` and not `--type-prose`: 15px is the elapsed clock
              on the pill, and a title that is the same size as a running number
              two centimetres above it is not a level. 16 is the next rung the
              document ladder already declares, it puts the top of this window at
              1.45:1 over the floor, and it is the one line that says whose call
              this is on a surface meant to be read from a metre away.
            */
            className="text-strong min-w-0 flex-1 truncate font-sans text-subhead font-semibold">
            {heading.trim() === '' ? 'Réunion en cours' : heading}
          </h1>
        </div>
        {/*
          `mt-hair` and not `mt-0.5`: 2 px is not a step of this product's scale
          and `--space-hair` is declared for exactly this case — « a caption
          under its line » (`tokens.css`). Measured glyph to glyph it takes the
          gap under the title from 3.8 px to 5.8 px, against the 12 px that
          separates this pair from the next band, so the group still reads as
          one at better than 2:1.
        */}
        <p className="text-muted mt-hair flex items-center gap-tight text-meta leading-tight">
          <EyeOff aria-hidden size={11} strokeWidth={2} className="shrink-0" />
          Invisible en partage d’écran
        </p>
      </div>

      {/*
        **The capture-trouble line, and the claim above it that it falsified.**

        This carried `border-subtle border-b` six lines under a comment reading
        « Three zones, no internal rules » — so the card had a fourth zone and an
        internal rule in exactly the state it exists for, with a fill change on
        one edge and a stroke on the other: two separator idioms on one element.
        Nothing could have caught it. `grep -c 'capture:health'` over the harness
        stub returned **0**: no stage stages a troubled capture, so the claim had
        never been photographed in the state that falsifies it, on the surface
        whose whole purpose is reporting capture health. `widget-ennui` stages it
        now, which is the half of this fix that keeps.

        **And the sentence is no longer shouted.** `font-semibold` on a whole
        line of gold is not a mark, it is three lines of emphasis that emphasise
        nothing inside themselves. This repo's rule is that `⚠ faible` is a
        *mark* — a short token, semibold as well as coloured — and a health
        reason is a sentence, composed by `capturePermission.ts` and sometimes
        two lines long. The mark here is the colour: nothing else on this card is
        gold. No glyph either, deliberately — the card already carries one
        2px-stroked outline among eight solid glyphs, and a second would widen a
        split rather than close it.

        The other three `text-warn` sites in the app are whole sentences in
        semibold too. They are not fixed here; this is the one on the surface the
        round is about, and the rest wants its own pass.
      */}
      {/*
        **A live region, and it is mounted whether or not it has anything to
        say.**

        It had neither a `role` nor an `aria-live`, on the one reading in this
        product that says a client call is not being recorded — a rep using a
        screen reader got the sentence only by arrowing onto it, and nothing on
        this card invites that.

        `role="status"` and not `role="alert"`, which is the opposite of the two
        other live regions on this surface and is the one decision here worth
        arguing. `Refus` is `alert` because it is a *transient* answer to a press
        the rep just made, and it is dismissed; `OutcomeNotice` is `alert`
        because the meeting has ended under the rep and there is nothing after
        it. This is neither. It is a **condition** that lasts for the rest of the
        call, and it changes hands while it lasts: driven on the shipped renderer
        in `widget-deux-pannes`, the slot reads capture → transcribe →
        transcribe → capture over four `health:changed` edges in one call.
        `alert` is assertive, so each of those would cut across a rep who is
        mid-sentence with a client — four interruptions, one of which says
        nothing new, on a window whose whole rule (DEC-49) is that it must not
        take the call. `status` is polite: it is read at the next pause, which
        is when a rep can do anything about it anyway.

        And it is mounted unconditionally, with `text` empty when there is
        nothing wrong, because a polite region that is *inserted* along with its
        content is announced by no assistive technology reliably — the region has
        to be in the accessibility tree before the text changes. An empty `<p>`
        with its padding dropped generates no line box, so this costs the card
        nothing, and that is a measurement and not a guess: the panel card is
        **354.55 px** tall with everything well, at 1280×800 and at 960×600,
        with this region mounted and empty — the same 354.55 px it was before
        the region existed. With the route-change sentence in it the card is
        395.78 px and the region 59.83.

        `aria-atomic`, because the sentence is replaced whole when the worst
        channel changes and half of a swapped sentence is not a sentence.

        **What this still does not fix**: the slot lives in `Panel`, which is
        mounted by a press on the pill. A rep who never opens the panel is told
        nothing, sighted or not. That is a larger change — the pill would have to
        carry a mark — and it is stated here rather than quietly left.
      */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        /*
          `data-health` because this is the **second** `role="status"` on the
          surface — the mention card is the first — and a test that asked the
          page for « the status » would have got whichever one React rendered
          first. `spacing.test.tsx` was measuring the mention card's seam
          through exactly that query.
        */
        data-health
        /* Whose words: `connector` for the producer's sentence, `widget` for
           this window's. Read by `widget-deux-pannes`, which cannot otherwise
           tell « the fragment was replaced » from « the slot went quiet ». */
        data-written={trouble === null ? undefined : trouble.written}
        className={
          trouble === null ? 'text-warn text-meta' : 'text-warn px-inline py-tight text-meta'
        }>
        {trouble === null ? '' : trouble.text}
      </p>

      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
          measure(element)
        }}
        /*
          The mask is built here rather than as a class because it has four
          states and three of them are a different gradient, not a different
          colour. `FADE_PX` is the one number and it is measured against this
          log's own line box — see the note on it, and `shot.mjs --fade`, which
          is what holds the two to each other now.
        */
        style={{ maskImage: logMask(edges), WebkitMaskImage: logMask(edges) }}
        /*
          `data-scrolls`: declared, which is what the attribute means. A live
          transcript is a log — it sticks to the bottom, the rep scrolls up to
          read back, and it is *supposed* to hold more than its box. It is not
          the « clipped and looks short » failure `--scrollers` is about.
        */
        data-scrolls
        /*
          **`py-tight` and not `py-snug`, because a band seam is a sum.**
          Nothing on this card declares the distance between two bands: each
          band pads itself and the seam a rep sees is the two paddings added.
          Measured on the shipped panel those sums were **12, 14.2 and 13.7 px**
          — three separations within 2.2 px of one another, produced by three
          different pairs, none of them a step of the scale but the first. With
          every band on `py-tight` they are 12, 12 and 11.75, against the 6 px
          `space-y-tight` puts between two turns *inside* this log: one
          separation between groups, half of it inside one.

          The box does not move. `max-h-[220px]` is the log's height in every
          state a rep reaches with a call running, so the four pixels come off
          the padding and go to the transcript, not to the window.
        */
        className="max-h-[220px] overflow-y-auto px-inline py-tight"
      >
        {rows.length === 0 ? (
          <p className="text-muted text-ui">{NOTHING_YET}</p>
        ) : (
          <ul className="space-y-tight">
            {rows.map((row) =>
              row.kind === 'mark' ? (
                <MarkRow key={row.key} mark={row.mark} onForget={onForget} />
              ) : (
                <TurnRow
                  key={row.key}
                  segment={row.segment}
                  onMark={() => onMark(row.segment.id, '')}
                  paused={paused}
                />
              ),
            )}
          </ul>
        )}
      </div>

      {/*
        **Paused, this row is unavailable — and the note survives.**

        `mark()` refuses while frames are being dropped, correctly. Both routes
        into it cleared the field *first*: driven on the shipped renderer, a rep
        typing one-handed over a client's face and pressing the card's one accent
        control got an empty field, zero `meeting:mark` calls, no card, no alert
        and nothing in the live region. The guard turned a refusal into silent
        data loss, on the only control here that had anything to lose — which is
        worse than the defect it was added to fix.

        `setNote('')` moves after the call, so nothing is cleared unless
        something was written, and both the field and *Marquer* now say they are
        unavailable with the same sentence the pill's control carries.
      */}
      {/*
        **No rule here any more — the field's own fill is the boundary.**

        This row carried a `border-t` *and* held a bordered input, so the
        composer was a box inside a box inside a bordered card: three boundaries
        for one grouping, on a 340px surface, and the reason was upstream rather
        than here. `--widget-soft` was 1.18:1 against the card — not a surface a
        rep can see — so nothing on this window could group by fill and every
        group became a line. It is 1.54:1 now (`tokens.css` has the argument),
        which is enough to say « a different surface » without one.
      */}
      <div className="bg-inner rounded-b-lg">
      {/*
        **Paused, the row says so instead of crippling itself — and it took a
        measurement to see that it had been.**

        `unavailable()` stacks its sentence under the control inside a
        `inline-flex flex-col` wrapper, on the argument (`Button.tsx`) that the
        wrapper « occupies the space the bare button did ». In a *header* row
        that is true. Here the sibling is `flex-1` and the sentence is 43
        characters, so the wrapper's intrinsic width won: measured on the
        shipped renderer, pressing *Pause* took the note field **252.1 → 89.5
        px** and the card **355.6 → 376 px**.

        What that costs is the rep's own words. A rep pauses because something
        they should not record just started, which is the one moment they are
        mid-sentence; `MARK_NOTE_MAX` is 280 and a 51-character note rendered
        **13** characters, `text-overflow: clip`, in a field that is `disabled`
        so the caret cannot move and nothing on screen says there is more. They
        could not read it, finish it, or tell whether it survived. And the 20.4
        px is a `widget:resize` — a frameless always-on-top surface re-placing
        itself over the client's face — which is verbatim the harm the note
        below this one congratulates itself for having ended on the *other* row
        of this same tray.

        So the paused row draws the sentence and nothing else. The note is held
        in state and comes back untouched on *Reprendre*, and the sentence says
        so, because « is my note still there » was the question the crippled
        field left unanswered. One line either way, one width either way:
        `widget-pause` now asserts the card measures the same across the press,
        the assertion `widget-arret` makes for *Terminer* and that nobody had
        made for this row.

        Nothing is drawn disabled, so `unavailable()` is not needed and the
        dead-control rule (DEC-26) is satisfied the way it prefers — by the
        control not being there, with the reason in its place.
      */}
      {paused ? (
        <div className="flex h-[38px] items-center px-inline">
          <p role="status" className="text-muted min-w-0 text-meta">
            {note.trim() === '' ? PAUSED_NO_MARK : `${PAUSED_NO_MARK} Votre note est conservée.`}
          </p>
        </div>
      ) : (
      <div className="flex h-[38px] items-center gap-tight px-inline">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const text = note.trim()
            onMark(null, text)
            setNote('')
          }}
          maxLength={MARK_NOTE_MAX}
          aria-label="Noter ce moment"
          placeholder="Noter ce moment…"
          /* `bg-inner` and no border — see the note above the row. */
          /*
            `disabled:cursor-not-allowed` because `Button`'s base carries it and
            this field sits 4px from one: two controls withdrawn by one rule
            were answering the pointer two ways, the button with the product's
            cursor and the input with the browser's default. The *opacity* pair
            is not the same kind of difference and is left alone — a blue control
            says it is unavailable by going muted (`nav`), and a control that is
            already muted has to say it by going faint.
          */
          className="text-strong placeholder:text-muted bg-card no-drag min-h-[24px] min-w-0 flex-1 rounded-sm px-snug py-hair text-ui disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Button
          variant="nav"
          className="no-drag font-medium px-hair"
          onClick={() => {
            const text = note.trim()
            onMark(null, text)
            setNote('')
          }}
        >
          Marquer
        </Button>
      </div>
      )}

      {/*
        **And the row reserves its own tallest state, so the window cannot move
        under the finger.**

        `danger` is the only filled variant here and it is 32.59 px against the
        footer's 24 px text controls, so pressing *Terminer* grew the card 356 →
        365 px. In the shipped window that is a `widget:resize`: a frameless,
        always-on-top surface re-placing itself over the client's face at the
        instant the rep is deciding whether to end a recording that cannot be
        resumed. It also slid the row, which is how *Annuler* came to miss the
        top 4.3 px — 18 % — of the rectangle it is supposed to cover.

        The fix is the argument `Button.tsx` already makes one paragraph up
        about width — « Reserving the width makes the two families one height
        without changing a single colour » — applied to height, and the cheapest
        form of it is to stop the filled variant being taller in the first
        place: `py-0` on the danger button, with `Button`'s own `min-h-[24px]`
        keeping the target floor. Both states of this row are 24 px now, so it
        measures the same before and after the press. `widget-arret` asserts it.
      */}
      {/*
        **A fixed height, so the surface can have a control ladder again.**

        The stop confirmation grew this row 8.6px when it swapped in the filled
        danger button, which moved a frameless always-on-top window under the
        rep's finger at the instant of an irreversible decision. The fix was
        `py-0` on that button — correct for the reflow, and it flattened the last
        height difference on the surface: ten controls at exactly 24px, so
        nothing on this card could be told apart by shape, and the one act that
        cannot be undone was the same rectangle as the disclosure icon.

        Reserving the row is the other way to buy the same property, and it buys
        the ladder back: `h-10` is what the row already measured at rest
        (24px + `py-snug` both sides), so the resting card does not change — and
        a 28px control now fits inside it without moving anything.
        `widget-arret` asserts the card measures the same before and after the
        press, which is the property, and it is unchanged by this.
      */}
      <div className="flex h-10 items-center justify-between gap-snug px-inline">
        {/*
          **The row asks one question at a time, and it has to fit.**

          « Ouvrir Sillage » + « Arrêter l'enregistrement » + « Annuler » is
          wider than the card, and this row has no `min-w-0`, so the two
          confirmation controls were laid out *past the card's right edge* —
          over the halo, which is exactly the band `widget:passThrough` hands
          back to Teams. The most dangerous button in the product was painted
          on the part of the window that is not supposed to be clickable.

          It also moved the right edge, which is what broke the rule below:
          right-aligned controls can only line up with each other if the row
          they are in does not reflow.
        */}
        {/*
          **The consequence is in the label, because the row has no room for a
          sentence.**

          « Arrêter l'enregistrement | Annuler » asked nothing and stated
          nothing: no question, and no word about what is lost, on the one act
          on this surface that cannot be undone. The obvious repair — a line of
          prose where *Ouvrir Sillage* and *Pause* were a moment ago — was tried
          and measured: at 340 px the card holds « Arrêter l'enregistrement »,
          « Annuler » and nothing else on that line, so even « Sans reprise. »
          wrapped and grew the card **355.9 → 369.1 px**, which is the defect
          above by another route.

          « définitivement » costs no width — it is the same label length — and
          it says the thing the rep cannot know: `end` is terminal.
          `session:command` has no `resume`, and recording again would be a
          second meeting. A confirmation that asks whether you meant it adds a
          press; one that names what you did not know adds a fact.
        */}
        {confirmEnd ? (
          <span />
        ) : (
          /*
            `gap-tight`, the same six the confirmation cluster below already
            uses and the same six the pill's own two halves use. It was
            `gap-inline` — twelve — inside a `gap-snug` row, so the pair that is
            one group was spaced *wider* than the floor separating it from the
            group at the other end of the footer. The row is `justify-between`
            and the card is a fixed 340px, so nothing moves but the six pixels
            between these two words.
          */
          <span className="flex items-center gap-tight">
            <Button
              variant="nav"
              className="no-drag font-medium px-hair"
              onClick={() => void invoke('window:focus', { meetingId }).catch(() => undefined)}
            >
              Ouvrir Sillage
            </Button>

            {/*
              **Pause is a capture verb** (`session:pause`), not a meeting state:
              the transcriber stops hearing frames and the silence clock is held,
              while the machine stays in `recording` and the meter keeps moving
              (DEC-38). The label is the next act, and it changes only when the
              main process says the state did — see `paused` on the window.
            */}
            <Button
              variant="text"
              className="no-drag font-medium px-hair"
              onClick={() => onPause(!paused)}
            >
              {paused ? 'Reprendre' : 'Pause'}
            </Button>
          </span>
        )}

        {/*
          **Two presses, and the second one is a different rectangle.**

          Ending a recording cannot be undone: the state machine has no way back
          from `ended`, and the minutes that follow a stray click are audio this
          product never retains (DEC-12) and so can never recover. This control
          floats over a video call, under a pointer the rep is using for
          something else. One click is the wrong number of clicks for that.

          It is the same reasoning DEC-4 states at the review gate — the one
          control that ships is never the rectangle the rep just pressed.

          **And it was stated here and done backwards.** Both clusters are
          right-aligned in a `justify-between` row, so the 160-px danger button
          grew *leftward* and swallowed the whole 59×24 « Terminer » box:

              Terminer                 x 738  w  59
              Arrêter l’enregistrement x 637  w 160   -> fully contains it

          One double-click on « Terminer » — or two impatient clicks on a
          control floating over a live call — ended the recording. There is no
          way back from `ended` and the audio was never retained (DEC-12), so
          the rest of the meeting is gone. The confirmation was theatre, and the
          docblock claiming otherwise is how it survived.

          So the **escape** takes that rectangle, not the danger. `Annuler` is
          last in the row, right-aligned like the trigger, and wide enough to
          cover it — a second click at the same pixel cancels, which is the
          idempotent, harmless half. The danger button sits to its left, where
          nothing was a moment ago, and reaching it is a deliberate movement.
          `widget-terminer` measures both rectangles.
        */}
        {confirmEnd ? (
          <span className="flex items-center gap-tight">
            <Button
              variant="danger"
              /*
                **The one control on this surface allowed to be taller**, now
                that the row reserves its height and cannot be grown by it.
                28px against the footer's 24: the only act here that cannot be
                undone is the only one with a different shape, which is the
                distinction ten identical rectangles could not make.
              */
              className="no-drag font-medium min-h-[28px] py-0"
              onClick={() => {
                setConfirmEnd(false)
                onClose()
                void invoke('session:command', {
                  meetingId,
                  command: 'end',
                  reason: 'terminée depuis le widget',
                }).catch(() => undefined)
              }}
            >
              Arrêter définitivement
            </Button>
            <Button
              variant="text"
              className="no-drag font-medium min-w-[5rem] px-hair"
              onClick={() => setConfirmEnd(false)}
            >
              Annuler
            </Button>
          </span>
        ) : (
          <Button
            variant="text"
            /*
              `hover:text-danger-strong`, and it used to be `hover:text-danger`
              — the rest colour, pinned, cancelling the `text` variant's own
              `hover:text-body`. This was the only per-instance hover override on
              the surface, so it was the only control whose hover no sibling
              covered, and it is the word that stops the recording: everything
              else on the card brightened under the pointer, including « Annuler »
              four pixels away. Inside `.widget-surface` the token resolves to
              `--widget-danger-strong` #f9b0b0 — 6.36:1 on the tray against 4.67
              at rest, a step of 1.363.
            */
            className="no-drag text-danger hover:text-danger-strong font-medium px-hair"
            onClick={() => setConfirmEnd(true)}
          >
            Terminer
          </Button>
        )}
      </div>
      </div>
    </div>
  )
}

/**
 * The mark, drawn rather than typed.
 *
 * A glyph would have been one character and it was wrong twice over: `⌁` is not
 * in Inter, so it fell through to whatever the system had and rendered as an
 * arrow — a shape that means *go* on a control that means *remember this* — and
 * a fallback is invisible to every check in this repo, because the accessible
 * name and the box are both correct. Sixteen pixels of path has no fallback.
 */
function Bookmark() {
  return (
    <svg aria-hidden width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
      <path d="M1 0h8a1 1 0 0 1 1 1v10.2a.5.5 0 0 1-.77.42L5 8.9l-4.23 2.72A.5.5 0 0 1 0 11.2V1a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

/**
 * Something said out loud, drawn rather than typed.
 *
 * Sixteen pixels of path for the same reason `Bookmark` is: `💬` and `🗣` are
 * emoji, `⌨` and `☞` are not in Inter, and a glyph that falls through to whatever
 * the system has is **invisible to every check in this repo** — the accessible
 * name is correct, the box is correct, and the shape is whatever the font stack
 * happened to land on. `Bookmark`'s own docblock records that failing once, with
 * `⌁` rendering as an arrow: *go* on a control that meant *remember this*.
 *
 * A speech bubble and not a megaphone: the rep says a sentence to one person on a
 * call, they do not broadcast it. Distinct from `Bookmark` in silhouette at 12 px,
 * which is the only size either is ever drawn at.
 */
function Speech() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M1.4 0h9.2A1.4 1.4 0 0 1 12 1.4v5.3a1.4 1.4 0 0 1-1.4 1.4H5l-2.8 2.2a.5.5 0 0 1-.81-.4V8.1H1.4A1.4 1.4 0 0 1 0 6.7V1.4A1.4 1.4 0 0 1 1.4 0Z" />
    </svg>
  )
}

/**
 * One spoken turn, and the control that marks it.
 *
 * `paused` reaches here because the guard has to. `mark()` refusing at the
 * source is the fact and it shipped a round ago; disabling the *pill's* control
 * shipped with it — and these five did not, so on the same card, in the same
 * state, five identical 24px buttons accepted a press and silently did nothing
 * while « Retirer ce moment marqué » beside them still worked. A control that
 * looks available and changes nothing is the inert primary this repo refuses,
 * and it was worse here than a missing guard: the rep got the affordance of
 * marking a turn whose audio was never kept.
 */
function TurnRow({
  segment,
  onMark,
  paused,
}: {
  segment: TranscriptSegment
  onMark: () => void
  paused: boolean
}) {
  return (
    /*
      **`items-baseline`, because the two columns are two type sizes.**

      The speaker's side is `text-meta` (11px) and the turn is `text-ui` (12px),
      both `leading-relaxed` — so their line boxes are 17.875 and 19.5 and,
      top-aligned, their baselines were **2.1px apart** on every row of the log
      (12.4 against 14.5 from the row top, measured on `widget-ouvert`). « Client »
      floated above the sentence it names, five times down a 340px column, on the
      one surface a rep reads for the length of a call. Baseline-aligned they are
      0.1px apart and no row is any taller — the flex line's cross size is
      unchanged at 58.5/39/24.

      Not applied to `MarkRow` below: its left column is a glyph, not text, and a
      flex box with no text in it has no baseline to align to — it would fall back
      to its bottom margin edge, which is a different rule wearing the same word.
    */
    <li className="group flex items-baseline gap-snug">
      <span className="text-muted w-12 shrink-0 text-meta leading-relaxed">
        {/*
          No interlocutor list here, so this says « Client » — correctly. The
          widget reads a live broadcast and the calendar's attendees arrive with
          the extraction, which does not exist during the call; `speakerLabel`'s
          rule is that a name is printed only when the record settles it, and
          here it does not (DEC-47).
        */}
        {speakerLabel(segment.channel, [])}
      </span>
      <span className="text-body measure min-w-0 flex-1 text-ui leading-relaxed">{segment.text}</span>
      <button
        type="button"
        onClick={onMark}
        disabled={paused}
        title={paused ? PAUSED_NO_MARK : undefined}
        aria-label={
          paused
            ? 'Marquer cette prise de parole — indisponible en pause'
            : 'Marquer cette prise de parole'
        }
        /*
          Always in the layout, only *visible* on hover and focus: an affordance
          that appears on hover changes the width of every line under the
          pointer, and a transcript that reflows while it is being read during a
          call is the flicker DEC-14 forbids. Opacity, never `display`, so the
          keyboard can still reach it — `focus-visible:opacity-100` is what
          makes that true rather than merely intended.

          **`self-start`, because the row it sits in is a flex box.**
          `align-items` defaults to `stretch`, so `min-h-[24px]` was a floor on
          a control that had no ceiling: measured on `widget-ouvert`, the five
          of these on that panel were drawn **24×58.5** and their bookmark sat
          **29.3px** from the row top — vertically centred on the whole turn,
          a line and a half below the sentence it marks and below the speaker
          label opposite it. The neighbouring « Retirer ce moment marqué » put
          its glyph at 12 or 19.5 depending on how long the note was, so the
          one column of controls on the surface a rep watches for fifty minutes
          had no baseline: it tracked how long the client spoke. All seven rows
          now answer 24px and 12px. `--census`'s split rule is what found it
          and is what keeps it — no jsdom test can measure a stretched box.
        */
        className="no-drag text-muted hover:text-brand-700 focus-visible:opacity-100 inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center self-start rounded-sm opacity-0 transition group-hover:opacity-100"
      >
        <Bookmark />
      </button>
    </li>
  )
}

/**
 * How far the log's fade runs, in pixels, and **the number is measured against
 * the line box rather than described as one.**
 *
 * It was twenty, under a comment calling that « one line's ascender … little
 * enough that no whole line of a client's words is ever dimmed ». The line box in
 * this log is **19.5px** — `--type-ui` is 12px and `leading-relaxed` is 1.625 —
 * so twenty is *longer* than a whole line, and the sentence was false of the
 * surface it was written on. Swept over every scroll position the rep can reach
 * on the harness fixture, the worst was `scrollTop` 176, where a line box sat at
 * the very top of the visible area entirely inside the ramp: its ink ran from
 * alpha **0.19** at the top of the cap band to 0.79 at the bottom, on the one
 * surface a rep reads for fifty minutes, about words a client actually said.
 *
 * Twelve is the same cue and it is under the line box by 7.5 pixels, which is the
 * band of a fully-visible topmost line that stays at full strength whatever the
 * scroll offset. Measured the same way: the worst ink alpha is 0.31 rising to 1.0
 * across the line, and no whole line box can be inside the ramp at any scroll
 * position — that is the property, and it is `shot.mjs --fade` that holds it
 * rather than this comment.
 *
 * Nothing in this repo could see the old number. `--contrast` reads resolved
 * colours and a mask is not one; `--scrollers` is opted out of here by
 * `data-scrolls`, correctly, because a log is *supposed* to hold more than its
 * box. Do not change this without re-running the check.
 */
const FADE_PX = 12

/**
 * The log's mask, by which edges are hiding something.
 *
 * `undefined` rather than `'none'` when nothing is hidden: `mask-image: none`
 * is a paint the compositor still has to reason about, and a short call — which
 * is every call for its first minute — should carry no mask at all.
 */
const logMask = (edges: { top: boolean; bottom: boolean }): string | undefined => {
  /*
   * **`currentColor`, and not because a token was missing.**
   *
   * `check:tokens` refused the `#000` this was first written with, and it was
   * right to: a hex outside `tokens.css` is how `bg-muted/30` and `ring-card`
   * shipped. But the answer here is not a new token — a mask is an **alpha
   * stencil**, `mask-mode` defaults to `alpha`, and the hue of the opaque stop
   * is discarded before it reaches a pixel. A `--mask-ink` in `tokens.css`
   * would be a palette entry for something that is not a colour, which is worse
   * than the literal: the next reader would try to theme it.
   *
   * `currentColor` says the only thing that is actually being asserted — fully
   * opaque — in a value the check has no reason to object to, because it is not
   * a colour choice at all.
   */
  const from = `transparent 0, currentColor ${FADE_PX}px`
  const to = `currentColor calc(100% - ${FADE_PX}px), transparent 100%`
  if (edges.top && edges.bottom) return `linear-gradient(to bottom, ${from}, ${to})`
  if (edges.top) return `linear-gradient(to bottom, ${from})`
  if (edges.bottom) return `linear-gradient(to bottom, ${to})`
  return undefined
}

/**
 * A mark in the transcript, and the two kinds are drawn apart.
 *
 * The rep's carries their bookmark and a way to take it back — « taking one back
 * is an event, never a delete » (`meeting:forget` appends). The product's single
 * entry, the US-11 disclosure, carries neither: it is not a moment the rep
 * chose, so the bookmark would be a false attribution, and the × would let them
 * erase the record that the client was told — which is the one line in this
 * window a compliance question is answered from.
 */
function MarkRow({ mark, onForget }: { mark: MomentMark; onForget: (id: string) => void }) {
  /*
   * **Anything that is not the product's is the rep's**, which is the same
   * sentence `MomentMark.by`'s default makes: every mark written before the
   * field existed is theirs. Tested this way round rather than `=== 'rep'`
   * because a mark that reaches this component without passing the schema — a
   * fixture, a broadcast built by hand — would otherwise lose the rep's own
   * bookmark and their way to take it back, which is the opposite of the
   * failure this field was added to fix.
   */
  const mine = mark.by !== 'product'
  return (
    <li className="group flex gap-snug">
      {/*
        **A mark is an aside, and it was louder than the call.**

        The gutter carried a bookmark glyph *and* the word « marqué » in
        `brand-700` semibold, against a two-pixel `brand-500` rule, beside a
        client's own sentence set in `text-muted` with a grey label. Three
        brand-coloured elements on the rep's own note and none on the thing the
        note is about: on a fifty-minute call the eye went to the annotations
        and skated past the words. It reversed the hierarchy of the surface —
        the transcript is the record, the mark is a finger pointing at it.

        Same ink, same rule, one glyph. The bookmark alone says « marked » —
        it is the same glyph as the pill's own counter and the *Marquer*
        control, so it is already the word's meaning on this window — and the
        `aria-label` keeps the word for a reader that cannot see the shape.
        The note stays `text-strong`, because the rep wrote it on purpose.
      */}
      <span
        /*
          The rep's bookmark for the rep's marks. The product's one entry — the
          US-11 disclosure — is not a moment they chose, so wearing their glyph
          would be a false attribution on the row a compliance question is
          answered from. It gets the speech mark the mention control already
          uses, and its own name.
        */
        aria-label={mine ? 'Moment marqué' : 'Information donnée au client'}
        className="text-muted flex w-12 shrink-0 items-start justify-end pt-px text-meta leading-relaxed"
      >
        {mine ? <Bookmark /> : <Speech />}
      </span>
      <span className="text-strong border-subtle min-w-0 flex-1 border-l pl-snug text-ui leading-relaxed">
        {mark.note === '' ? 'Moment marqué.' : mark.note}
      </span>
      {/*
        **A mark can be taken back.**

        It is typed one-handed, into a box floating over a client's face, and
        sent on `Enter` — so a mistake is made here more easily than anywhere
        else in the product, and until this control existed there was no way to
        correct one: no channel, no event, nothing. It would have sat in the
        reader at the gate, in the rep's own words, permanently.

        A removal is an **event**, not a delete (DEC-27 leaves exactly one
        delete in this codebase and it is the diagnostics purge): `moment.forgotten`
        is appended and the fold drops the pair, so the log still says what
        happened and when.
      */}
      {/*
        Only the rep's. Theirs is a mistake they can correct; the product's is
        the record that the client was told, and a × beside it would let a rep
        erase the proof they asked — on the one surface where that question is
        answered.
      */}
      {!mine ? null : (
        <button
          type="button"
          onClick={() => onForget(mark.id)}
          aria-label="Retirer ce moment marqué"
          /*
            `self-start` for `TurnRow`'s reason, and this is the instance that
            was visible to the check: a one-line note drew this × at 24px and a
            two-line note at **39px**, on one card, so the same control moved
            8px down the row whenever the rep's own sentence wrapped.
          */
          className="no-drag text-muted hover:text-danger focus-visible:opacity-100 inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center self-start rounded-sm opacity-0 transition group-hover:opacity-100"
        >
          <span aria-hidden className="text-ui leading-none">
            ×
          </span>
        </button>
      )}
    </li>
  )
}
