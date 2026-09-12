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
   * The last meeting this window *rendered*, which is what makes the freeze cover
   * a read that was already on the wire. Written during render and only while the
   * window is staying: that is the definition of « what is on screen », and there
   * is no commit after `leaving` in which it could be captured instead.
   */
  const drawn = useRef(live)
  if (!gone.current) drawn.current = live
  const meeting = drawn.current
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
  /**
   * What just happened, and **whether it was a refusal** — which is the whole of
   * the difference between this being announced and being drawn.
   *
   * A mark that worked has a receipt already: the counter on the pill moves, which
   * is what that counter is for, and « Moment marqué. » painted over a client's
   * face would be a second one. A mark that was *refused* had nothing — the
   * sentence went into an `sr-only` paragraph, measured 1×1 with
   * `clip: rect(0,0,0,0)` and no `role`, and the counter correctly did not move.
   * So the rep pressed, saw nothing change, and had every reason to believe the
   * moment was marked. `meeting:mark` refuses whenever the meeting is not
   * `recording`, which `EndOfMeetingWatch` can make true with the pill still up,
   * and on any store failure.
   *
   * One live region either way and never two: a visible `role="alert"` is
   * announced, so the polite paragraph draws only what the alert does not.
   */
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null)

  // The marks the meeting already had when this window opened — a widget that
  // is created mid-call after a crash, or a second recording in one window.
  const loadedMarks = meeting?.marks
  useEffect(() => {
    if (loadedMarks) setMarks((was) => (was.length === 0 ? [...loadedMarks] : was))
  }, [loadedMarks])

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
    if (gone.current) return
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
      try {
        await invoke('meeting:mark', { meetingId, note: text, segmentId })
        setSaid({ text: text === '' ? 'Moment marqué.' : `Moment marqué : ${text}`, problem: false })
      } catch (error) {
        setSaid({
          text: error instanceof Error ? error.message : 'Impossible de marquer ce moment.',
          problem: true,
        })
      }
    },
    [meetingId],
  )

  const forget = useCallback(
    (markId: string) => {
      if (meetingId === null) return
      void invoke('meeting:forget', { meetingId, markId })
        .then(() => setSaid({ text: 'Moment retiré.', problem: false }))
        .catch(() => setSaid({ text: 'Impossible de retirer ce moment.', problem: true }))
    },
    [meetingId],
  )

  return (
    <Frame
      open={open}
      leaving={leaving}
      gone={gone}
      settled={state.state.status !== 'loading'}
    >
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
          {/*
            A refusal, where the press was.

            Between the pill and the panel in the DOM, which puts it against the
            pill whichever way the card stacks — `flex-col-reverse` reverses the
            paint and not the order, so it is directly under the pill when the
            panel opens downward and directly over it when the panel opens up.
            Never *inside* the panel: the press it answers is most often the one
            on the pill, with no panel open at all, which is the case that had
            nowhere to appear.
          */}
          {said?.problem === true ? (
            <Refus text={said.text} onDismiss={() => setSaid(null)} />
          ) : null}
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
            {said?.problem === false ? said.text : ''}
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
  children: (above: boolean) => React.ReactNode
}

function Frame({ open, leaving, gone, settled, children }: FrameProps) {
  const box = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)

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
    if (!element || typeof ResizeObserver === 'undefined') return
    if (armed.current === 0) armed.current = Date.now()
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
      if (width === 0 || height === 0 || key === last.current) return
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
    }
    const observer = new ResizeObserver(send)
    observer.observe(element)

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
        {children(above)}
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
 * moment it had something to say. It is also replaced by whatever the next press
 * produces, so it can never stack.
 */
function Refus({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div
      data-card
      className="bg-card border-card shadow-overlay mt-1.5 flex w-[260px] items-start gap-1.5 self-center rounded-lg border px-2.5 py-1.5"
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
      <span className="text-body measure min-w-0 flex-1 text-ui leading-relaxed">{segment.text}</span>
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
