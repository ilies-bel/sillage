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
import type { TranscriptSegment } from '../../electron/core/contracts/transcript.ts'
import { speakerLabel } from '../../electron/core/contracts/transcript.ts'
import {
  MARK_NOTE_MAX,
  interleaveMarks,
  type MomentMark,
} from '../../electron/core/contracts/marks.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { formatElapsed } from '../app/format.ts'
import { LevelMeter } from '../screens/session/LevelMeter.tsx'
import { Button } from '../ui/index.ts'

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

export function Widget() {
  const state = useInvoke('widget:state', {})
  const meeting = state.state.status === 'ready' ? state.state.value.meeting : null
  const meetingId = meeting?.meetingId ?? null

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
  const [said, setSaid] = useState<string | null>(null)

  // The marks the meeting already had when this window opened — a widget that
  // is created mid-call after a crash, or a second recording in one window.
  const loadedMarks = meeting?.marks
  useEffect(() => {
    if (loadedMarks) setMarks((was) => (was.length === 0 ? [...loadedMarks] : was))
  }, [loadedMarks])

  useBroadcast('session:changed', () => state.reload())

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
   */
  const [trouble, setTrouble] = useState<string | null>(null)
  const health = useInvoke('health:snapshot', {})
  useEffect(() => {
    if (health.state.status !== 'ready') return
    const snapshot = health.state.value
    const worst = (['capture', 'transcribe'] as const)
      .map((connector) => snapshot[connector])
      .find((entry) => entry !== undefined && entry.state !== 'ok')
    setTrouble(worst?.reason ?? null)
  }, [health.state])
  useBroadcast('health:changed', ({ connector, health: next }) => {
    if (connector !== 'capture' && connector !== 'transcribe') return
    setTrouble(next.state === 'ok' ? null : (next.reason ?? null))
  })

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
    if (payload.meetingId !== meetingId) return
    setMarks((was) =>
      was.some((mark) => mark.id === payload.mark.id) ? was : [...was, payload.mark],
    )
  })

  useBroadcast('moment:forgotten', (payload) => {
    if (payload.meetingId !== meetingId) return
    setMarks((was) => was.filter((mark) => mark.id !== payload.markId))
  })

  const mark = useCallback(
    async (segmentId: string | null, text: string) => {
      if (meetingId === null) return
      try {
        await invoke('meeting:mark', { meetingId, note: text, segmentId })
        setSaid(text === '' ? 'Moment marqué.' : `Moment marqué : ${text}`)
      } catch (error) {
        setSaid(error instanceof Error ? error.message : 'Impossible de marquer ce moment.')
      }
    },
    [meetingId],
  )

  const forget = useCallback(
    (markId: string) => {
      if (meetingId === null) return
      void invoke('meeting:forget', { meetingId, markId })
        .then(() => setSaid('Moment retiré.'))
        .catch(() => setSaid('Impossible de retirer ce moment.'))
    },
    [meetingId],
  )

  return (
    <Frame open={open}>
      {(above) => (
        <>
          <Pill
            title={meeting?.clientName ?? (meeting?.title || null)}
            startedAt={meeting?.startedAt ?? null}
            meetingId={meetingId}
            marks={marks.length}
            open={open}
            above={above}
            onToggle={() => setOpen((was) => !was)}
            onMark={() => void mark(null, '')}
          />
          {open && meetingId !== null ? (
            <Panel
              meetingId={meetingId}
              heading={meeting?.clientName ?? meeting?.title ?? ''}
              turns={turns}
              marks={marks}
              trouble={trouble}
              onMark={mark}
              onForget={forget}
              onClose={() => setOpen(false)}
            />
          ) : null}
          {/*
            What just happened, for a screen reader and for a rep who pressed
            *Marquer* on the pill with no panel open — a refusal (« aucun
            enregistrement en cours ») would otherwise have nowhere to appear.
          */}
          <p aria-live="polite" className="sr-only">
            {said ?? ''}
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

function Frame({ open, children }: { open: boolean; children: (above: boolean) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)

  useLayoutEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let last = ''
    const send = (): void => {
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
      const anchor = element.querySelector('[data-pill]')?.getBoundingClientRect()
      const width = Math.ceil(frame.width)
      const height = Math.ceil(frame.height)
      // Where the pill is inside the frame, which is what lets the main process
      // leave *the pill* where it was rather than a window edge.
      const pillTop = Math.max(0, Math.round((anchor?.top ?? frame.top) - frame.top))
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
      if (width === 0 || height === 0 || key === last) return
      last = key
      void invoke('widget:resize', {
        width,
        height,
        pillTop,
        pillHeight: Math.round(anchor?.height ?? height),
      })
        .then((placement) => setAbove(placement.above))
        .catch(() => undefined)
    }
    const observer = new ResizeObserver(send)
    observer.observe(element)
    send()
    /*
     * And a flip of `above` moves the pill without resizing anything, so the
     * observer never fires for it. `send` is idempotent — the key stops a
     * duplicate — so asking on every render of the frame costs one rect read.
     */
    const raf = requestAnimationFrame(send)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  })

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
      className="flex h-full w-full items-start justify-center bg-transparent"
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
        {children(above)}
      </div>
    </div>
  )
}

interface PillProps {
  title: string | null
  startedAt: number | null
  meetingId: string | null
  marks: number
  open: boolean
  above: boolean
  onToggle: () => void
  onMark: () => void
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
  open,
  above,
  onToggle,
  onMark,
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
      className="drag-region bg-card border-card shadow-overlay flex shrink-0 items-center gap-2 self-center rounded-lg border py-1.5 pl-2.5 pr-1.5"
    >
      {/*
        Recording, said the way the rest of the product says it: orange, which
        VISION.md §6 gives exactly one meaning — armed or recording — and a
        word, because colour is never the only carrier of a state here.
      */}
      <span className="flex shrink-0 items-center gap-1.5">
        <span aria-hidden className="bg-accent h-2 w-2 shrink-0 rounded-full" />
        <span className="sr-only">Enregistrement en cours</span>
      </span>

      {meetingId === null ? (
        <span className="text-muted px-1 text-ui">Aucun enregistrement</span>
      ) : (
        <LevelMeter meetingId={meetingId} variant="pill" />
      )}

      <Elapsed since={startedAt} />

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
          aria-label={
            marks === 0 ? 'Marquer ce moment' : `Marquer ce moment (${marks} déjà marqués)`
          }
          className="no-drag text-muted hover:bg-subtle hover:text-brand-700 inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center gap-1 rounded-sm px-1 transition"
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
        <span aria-hidden className="text-ui leading-none">
          {open === above ? '▾' : '▴'}
        </span>
      </button>
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
    <span className="text-strong shrink-0 tabular-nums text-ui" aria-label="Durée d’enregistrement">
      {formatElapsed(now - since)}
    </span>
  )
}

interface PanelProps {
  meetingId: string
  /** The client, else the objet, else nothing — never an invented name. */
  heading: string
  turns: readonly TranscriptSegment[]
  marks: readonly MomentMark[]
  /** Collected by the window, never here — see the note on the state itself. */
  trouble: string | null
  onMark: (segmentId: string | null, note: string) => void
  onForget: (markId: string) => void
  onClose: () => void
}

function Panel({
  meetingId,
  heading,
  turns,
  marks,
  trouble,
  onMark,
  onForget,
  onClose,
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
    <div data-card className="bg-card border-card shadow-overlay my-1.5 w-[340px] rounded-lg border">
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
      <div className="border-subtle flex items-baseline gap-2 border-b px-3 py-1.5">
        <h1 className="text-strong min-w-0 flex-1 truncate font-sans text-ui font-semibold">
          {heading.trim() === '' ? 'Réunion en cours' : heading}
        </h1>
      </div>

      {trouble === null ? null : (
        <p className="text-warn border-subtle border-b px-3 py-1.5 text-meta font-semibold">
          {trouble}
        </p>
      )}

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
          colour. `FADE_PX` is the one number: twenty is about one line's
          ascender, which is enough for the eye to read « this continues » and
          little enough that no whole line is ever dimmed.
        */
        style={{ maskImage: logMask(edges), WebkitMaskImage: logMask(edges) }}
        /*
          `data-scrolls`: declared, which is what the attribute means. A live
          transcript is a log — it sticks to the bottom, the rep scrolls up to
          read back, and it is *supposed* to hold more than its box. It is not
          the « clipped and looks short » failure `--scrollers` is about.
        */
        data-scrolls
        className="max-h-[220px] overflow-y-auto px-3 py-2"
      >
        {rows.length === 0 ? (
          <p className="text-muted text-ui">{NOTHING_YET}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) =>
              row.kind === 'mark' ? (
                <MarkRow key={row.key} mark={row.mark} onForget={onForget} />
              ) : (
                <TurnRow
                  key={row.key}
                  segment={row.segment}
                  onMark={() => onMark(row.segment.id, '')}
                />
              ),
            )}
          </ul>
        )}
      </div>

      <div className="border-subtle flex items-center gap-1.5 border-t px-3 py-2">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const text = note.trim()
            setNote('')
            onMark(null, text)
          }}
          maxLength={MARK_NOTE_MAX}
          aria-label="Noter ce moment"
          placeholder="Noter ce moment…"
          className="text-strong placeholder:text-muted bg-inner border-subtle no-drag min-h-[24px] min-w-0 flex-1 rounded-sm border px-2 py-1 text-ui"
        />
        <Button
          variant="nav"
          className="no-drag px-1"
          onClick={() => {
            const text = note.trim()
            setNote('')
            onMark(null, text)
          }}
        >
          Marquer
        </Button>
      </div>

      <div className="border-subtle flex items-center justify-between gap-2 border-t px-3 py-2">
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
        {confirmEnd ? (
          <span />
        ) : (
          <Button
            variant="nav"
            className="no-drag px-1"
            onClick={() => void invoke('window:focus', { meetingId }).catch(() => undefined)}
          >
            Ouvrir Sillage
          </Button>
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
          <span className="flex items-center gap-1.5">
            <Button
              variant="danger"
              className="no-drag"
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
              Arrêter l’enregistrement
            </Button>
            <Button
              variant="text"
              className="no-drag min-w-[5rem] px-1"
              onClick={() => setConfirmEnd(false)}
            >
              Annuler
            </Button>
          </span>
        ) : (
          <Button
            variant="text"
            className="no-drag text-danger hover:text-danger px-1"
            onClick={() => setConfirmEnd(true)}
          >
            Terminer
          </Button>
        )}
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

function TurnRow({ segment, onMark }: { segment: TranscriptSegment; onMark: () => void }) {
  return (
    <li className="group flex gap-2">
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
      <span className="text-body min-w-0 flex-1 text-ui leading-relaxed">{segment.text}</span>
      <button
        type="button"
        onClick={onMark}
        aria-label="Marquer cette prise de parole"
        /*
          Always in the layout, only *visible* on hover and focus: an affordance
          that appears on hover changes the width of every line under the
          pointer, and a transcript that reflows while it is being read during a
          call is the flicker DEC-14 forbids. Opacity, never `display`, so the
          keyboard can still reach it — `focus-visible:opacity-100` is what
          makes that true rather than merely intended.
        */
        className="no-drag text-muted hover:text-brand-700 focus-visible:opacity-100 inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm opacity-0 transition group-hover:opacity-100"
      >
        <Bookmark />
      </button>
    </li>
  )
}

/**
 * One line's ascender. Enough for the eye to read « this continues », little
 * enough that no whole line of a client's words is ever dimmed.
 */
const FADE_PX = 20

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

function MarkRow({ mark, onForget }: { mark: MomentMark; onForget: (id: string) => void }) {
  return (
    <li className="group flex gap-2">
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
        aria-label="Moment marqué"
        className="text-muted flex w-12 shrink-0 items-start justify-end pt-px text-meta leading-relaxed"
      >
        <Bookmark />
      </span>
      <span className="text-strong border-subtle min-w-0 flex-1 border-l pl-2 text-ui leading-relaxed">
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
      <button
        type="button"
        onClick={() => onForget(mark.id)}
        aria-label="Retirer ce moment marqué"
        className="no-drag text-muted hover:text-danger focus-visible:opacity-100 inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm opacity-0 transition group-hover:opacity-100"
      >
        <span aria-hidden className="text-ui leading-none">
          ×
        </span>
      </button>
    </li>
  )
}
