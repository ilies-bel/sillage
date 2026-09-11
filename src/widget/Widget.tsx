/**
 * **The in-meeting widget** — the product, on top of the call.
 *
 * For fifty minutes the Sillage window is behind Teams, and everything this
 * app knows about the call it is recording is on the other side of it. That is
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
 * baseline, without the two-word key a 220-pixel pill cannot afford.
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
 * Two things it does that the pane DEC-38 removed did not. It **names the
 * side**, by `speakerLabel` and therefore by the same rule as every other
 * transcript in the product (DEC-47) — and where the calendar settles it, by
 * the client's first name. And it **says what is provisional**: an interim
 * result is drawn muted with an ellipsis and replaced in place, so a rep never
 * reads a half-heard sentence as the record. Granola's widget shows the same
 * stream with neither distinction.
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
   * A transition re-reads the whole state. The widget is destroyed when the
   * recording ends, so the case this actually covers is the other one: a
   * meeting that starts while the window is still open from the last one, on a
   * rep who records two calls back to back.
   */
  useBroadcast('session:changed', () => state.reload())

  return (
    <Frame>
      {meeting === null ? (
        <Pill
          title={null}
          startedAt={null}
          meetingId={null}
          open={false}
          onToggle={() => undefined}
        />
      ) : (
        <>
          <Pill
            title={meeting.clientName ?? (meeting.title || null)}
            startedAt={meeting.startedAt}
            meetingId={meeting.meetingId}
            open={open}
            onToggle={() => setOpen((was) => !was)}
          />
          {open && meetingId !== null ? (
            <Panel
              meetingId={meetingId}
              heading={meeting.clientName ?? meeting.title}
              initialMarks={meeting.marks}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      )}
    </Frame>
  )
}

/**
 * The window is the size of what is in it.
 *
 * Everything around the card is a rectangle of somebody else's screen that the
 * rep cannot click — the window is transparent and always on top, so an
 * oversized one is a hole punched in the call. The measurement is the
 * renderer's because the renderer is the only thing that knows: the pill's
 * width depends on the elapsed time and on French strings, and the panel's
 * height depends on how much has been said.
 *
 * `ResizeObserver` and not an effect on the state that opened it: the content
 * also changes height when a turn arrives, when a mark is made and when the
 * health line appears, and an effect per cause is a list that will be one short.
 */
function Frame({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let last = ''
    const send = (): void => {
      const rect = element.getBoundingClientRect()
      const width = Math.ceil(rect.width)
      const height = Math.ceil(rect.height)
      const key = `${width}×${height}`
      // The observer fires on every sub-pixel change; the window may only be
      // moved for a real one, or a resize animates against itself.
      if (width === 0 || height === 0 || key === last) return
      last = key
      void invoke('widget:resize', { width, height }).catch(() => undefined)
    }
    const observer = new ResizeObserver(send)
    observer.observe(element)
    send()
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full w-full items-end justify-center bg-transparent">
      {/*
        `w-max`: the frame is measured, so it must be exactly as wide as its
        content and never as wide as the window it is in — otherwise the first
        measurement reports the window's own size back to the window and it
        never shrinks again.
      */}
      <div ref={box} className="w-max">
        {children}
      </div>
    </div>
  )
}

interface PillProps {
  title: string | null
  startedAt: number | null
  meetingId: string | null
  open: boolean
  onToggle: () => void
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
function Pill({ title, startedAt, meetingId, open, onToggle }: PillProps) {
  return (
    <div className="drag-region bg-card border-card shadow-overlay flex items-center gap-2 rounded-lg border py-1.5 pl-2.5 pr-1.5">
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

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        /*
          Named, not decorated. « ▸ » is a shape and a screen reader reads it as
          nothing; the check that measures every control's accessible name is
          what caught the last one of these in this product.
        */
        aria-label={open ? 'Replier le panneau' : `Ouvrir le panneau${title ? ` — ${title}` : ''}`}
        className="no-drag text-muted hover:bg-subtle hover:text-strong inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-sm transition"
      >
        <span aria-hidden className="text-ui leading-none">
          {open ? '▾' : '▴'}
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
  initialMarks: readonly MomentMark[]
  onClose: () => void
}

function Panel({ meetingId, heading, initialMarks, onClose }: PanelProps) {
  const [turns, setTurns] = useState<TranscriptSegment[]>([])
  const [interim, setInterim] = useState<Record<'rep' | 'far', TranscriptSegment | null>>({
    rep: null,
    far: null,
  })
  const [marks, setMarks] = useState<MomentMark[]>([...initialMarks])
  const [note, setNote] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

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
    const segment = payload.segment
    if (segment.isFinal) {
      setInterim((was) => ({ ...was, [segment.channel]: null }))
      setTurns((was) => [...was, segment].slice(-KEPT_TURNS))
    } else {
      // Replaced in place, per channel. Appending them would make the panel
      // grow by a line per round trip and re-say the same half-sentence.
      setInterim((was) => ({ ...was, [segment.channel]: segment }))
    }
  })

  useBroadcast('moment:marked', (payload) => {
    if (payload.meetingId !== meetingId) return
    setMarks((was) => (was.some((mark) => mark.id === payload.mark.id) ? was : [...was, payload.mark]))
  })

  /*
   * The transcription's own health, and nothing else's.
   *
   * The pill says a meeting is recording; the one thing that could make that
   * misleading is a channel arriving silent or a transcriber that has stopped,
   * and both already broadcast (`capture`, `transcribe`). Shown here and not on
   * the pill, because a sentence that appears over a client's face uninvited is
   * the interruption DEC-14 forbids — the meter is what says it without words.
   */
  const [trouble, setTrouble] = useState<string | null>(null)
  useBroadcast('health:changed', ({ connector, health }) => {
    if (connector !== 'capture' && connector !== 'transcribe') return
    setTrouble(health.state === 'ok' ? null : (health.reason ?? null))
  })

  const mark = useCallback(
    async (segmentId: string | null, text: string) => {
      try {
        const made = await invoke('meeting:mark', { meetingId, note: text, segmentId })
        setMarks((was) => (was.some((m) => m.id === made.id) ? was : [...was, made]))
        setSaid('Moment marqué.')
      } catch (error) {
        setSaid(error instanceof Error ? error.message : 'Impossible de marquer ce moment.')
      }
    },
    [meetingId],
  )

  /*
   * Everything said, in order, with the rep's own marks in place — one helper
   * in `core/contracts/marks.ts`, shared with the two readers in the app, so
   * the widget and the gate cannot disagree about where a mark sits.
   *
   * The interim lines ride at the end and are never given to the interleave:
   * they are not in the record, they cannot be marked, and a mark placed
   * against one would point at a sentence that is about to be replaced.
   */
  const rows = useMemo(() => interleaveMarks(turns, marks), [turns, marks])
  const pending = [interim.rep, interim.far].filter(
    (segment): segment is TranscriptSegment => segment !== null && segment.text.trim() !== '',
  )

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
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stuck.current) element.scrollTop = element.scrollHeight
  }, [rows.length, pending.length])

  return (
    <div className="bg-card border-card shadow-overlay mt-1.5 w-[340px] rounded-lg border">
      {/*
        Which call this is.

        The pill deliberately does not carry it — a name floating over a video
        call is the one thing on this window that would be read by everybody in
        the room if the rep is sharing their screen, and the pill is the state
        that is always up. Here it is behind a press the rep made, and it is
        worth the line: a widget that says « recording » and not *what* is one a
        rep has to open the app to trust.

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
          stuck.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 24
        }}
        className="max-h-[220px] overflow-y-auto px-3 py-2"
      >
        {rows.length === 0 && pending.length === 0 ? (
          <p className="text-muted text-ui">{NOTHING_YET}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) =>
              row.kind === 'mark' ? (
                <MarkRow key={row.key} mark={row.mark} />
              ) : (
                <TurnRow key={row.key} segment={row.segment} onMark={() => void mark(row.segment.id, '')} />
              ),
            )}
            {pending.map((segment) => (
              <li key={`interim-${segment.channel}`} className="flex gap-2">
                <span className="text-muted w-12 shrink-0 text-meta leading-relaxed">
                  {speakerLabel(segment.channel, [])}
                </span>
                {/*
                  Muted and ended with an ellipsis, because it is not the
                  record: an interim result is never persisted (DEC-12), can
                  never be cited (DEC-21), and is routinely wrong about the end
                  of the sentence. The rep is told which half of what they are
                  reading is provisional; Granola's widget draws the same stream
                  and does not.
                */}
                <span className="text-muted min-w-0 flex-1 text-ui leading-relaxed">
                  {segment.text} <span aria-hidden>…</span>
                  <span className="sr-only">(en cours de transcription)</span>
                </span>
              </li>
            ))}
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
            void mark(null, text)
          }}
          maxLength={MARK_NOTE_MAX}
          aria-label="Noter ce moment"
          placeholder="Noter ce moment…"
          className="text-strong placeholder:text-muted bg-inner border-subtle no-drag min-h-[24px] min-w-0 flex-1 rounded-sm border px-2 py-1 text-ui"
        />
        <Button variant="nav" className="no-drag px-1" onClick={() => {
          const text = note.trim()
          setNote('')
          void mark(null, text)
        }}>
          Marquer
        </Button>
      </div>

      <div className="border-subtle flex items-center justify-between gap-2 border-t px-3 py-2">
        <Button
          variant="nav"
          className="no-drag px-1"
          onClick={() => void invoke('window:focus', { meetingId }).catch(() => undefined)}
        >
          Ouvrir Sillage
        </Button>

        {/*
          **Two presses, and the second one is a different rectangle.**

          Ending a recording cannot be undone: the state machine has no way back
          from `ended`, and the minutes that follow a stray click are audio this
          product never retains (DEC-12) and so can never recover. This control
          floats over a video call, under a pointer the rep is using for
          something else. One click is the wrong number of clicks for that.

          It is the same reasoning DEC-4 states at the review gate — the one
          control that ships is never the rectangle the rep just pressed — and
          it is honoured the same way: the confirmation is drawn where the
          *label* was, in `danger`, and the escape is beside it rather than
          under the pointer.
        */}
        {confirmEnd ? (
          <span className="flex items-center gap-1.5">
            <Button variant="text" className="no-drag px-1" onClick={() => setConfirmEnd(false)}>
              Annuler
            </Button>
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
          </span>
        ) : (
          <Button variant="text" className="no-drag text-danger hover:text-danger px-1" onClick={() => setConfirmEnd(true)}>
            Terminer
          </Button>
        )}
      </div>

      {/*
        What just happened, for a screen reader and for a rep who pressed
        *Marquer* and needs to know it landed — the list above may be scrolled
        away from the new mark, and a refusal (« aucun enregistrement en
        cours ») has nowhere else to appear.
      */}
      <p aria-live="polite" className="sr-only">
        {said ?? ''}
      </p>
    </div>
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

function MarkRow({ mark }: { mark: MomentMark }) {
  return (
    <li className="flex gap-2">
      <span className="text-brand-700 flex w-12 shrink-0 items-center gap-1 text-meta font-semibold leading-relaxed">
        <Bookmark />
        marqué
      </span>
      <span className="text-strong border-brand-500 min-w-0 flex-1 border-l-2 pl-2 text-ui leading-relaxed">
        {mark.note === '' ? 'Moment marqué.' : mark.note}
      </span>
    </li>
  )
}
