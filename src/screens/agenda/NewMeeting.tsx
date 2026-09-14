/**
 * Starting a call the calendar knows nothing about.
 *
 * Without Graph this is the only way into the product, so it is a permanent
 * control rather than something that appears in an empty state. HR-10 says one
 * window and no modal chrome, and a dialog here would be a dialog in front of a
 * rep whose call has already started.
 *
 * ## Today is one click, and asks nothing
 *
 * *Démarrer une réunion* creates the meeting, starts the recording and opens the
 * session. There is no form in front of it.
 *
 * There used to be: two fields and a *Démarrer* that created an `idle` meeting,
 * opened the session screen, and put a **second** *Démarrer* in the header for
 * the rep to find. Two presses and a form, and the form's one required field was
 * an objet — asked of somebody who is walking into a call, about a call that has
 * not happened yet. Every second of that is a second the microphone is not on,
 * on the one product whose single unacceptable failure is not recording.
 *
 * Nothing is lost by not asking. The objet and the client are typed in the
 * session header during or after the call, and until they are, nothing stands in
 * for them — see `modules/extract/facts.ts` for why a placeholder here would be
 * worse than a blank.
 *
 * HR-7 still holds: *armed is an offer, never a recording*. This is not arming —
 * it is a human pressing a button that says *Démarrer*, which is the human
 * gesture HR-7 requires. What changed is that they press it once.
 *
 * ## Any other day is scheduling, and keeps its form
 *
 * A day the rep chose is a meeting placed there deliberately (DEC-31), not a
 * call about to start: it asks for the time, creates the meeting in that day's
 * cell and leaves the rep on the calendar rather than dropping them into a
 * session for a call that is next Thursday. The client name is a *display* name
 * either way — not resolved, not matched, not a CRM key (DEC-7).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Meeting } from '../../../electron/core/contracts/meeting.ts'
import { invoke } from '../../app/bridge.ts'
import { useShortcuts } from '../../app/shortcuts.ts'
import { atParis, noonOf, parseClock, type DayKey } from '../../app/calendar.ts'
import { formatDayMedium, upperFirst } from '../../app/format.ts'
import { Button, unavailable } from '../../ui/index.ts'

interface NewMeetingProps {
  /** The day the calendar has selected. */
  day: DayKey
  /** The rep's today. Equal to `day` ⇒ the meeting is for now. */
  today: DayKey
  /**
   * Awaited, so *Démarrer une réunion* stays busy until the recording has
   * actually started. A button that goes back to its resting label while the
   * session is still opening invites the second press this control exists to
   * remove.
   */
  onCreated: (meeting: Meeting) => void | Promise<void>
  /**
   * True when the day list is drawing an armed row — the call starting now.
   *
   * The screen's one filled control is then that row, and this one steps down
   * to an outline. Passed in rather than derived here: which rows are armed is
   * the calendar's question and this component has no business asking it.
   */
  armedElsewhere?: boolean
  /**
   * Where this instance is drawn.
   *
   * `header` is the permanent control described above — *Démarrer une réunion*
   * plus, on any other day, *Ajouter au …*.
   *
   * `empty` is the same scheduling half, drawn a second time **inside** the
   * empty day panel, and only the scheduling half: an empty day is a rep
   * looking at nothing and asking « et maintenant ? », and the answer was a
   * grey text link at the far end of the header, some seventeen hundred pixels
   * away and between *Réglages* and the blue button. An empty state whose
   * action is off-screen is a dead end with a sentence in it (DEC-26).
   *
   * A second *Démarrer une réunion* is deliberately not drawn: there is one
   * indispensable action in this product and putting it on screen twice makes
   * a rep choose between two identical buttons.
   */
  variant?: 'header' | 'empty'
  /**
   * `false` while the day pane is drawing its own *Ajouter une réunion*.
   *
   * An empty day offered three creation controls — *Ajouter au 31 août* and
   * *Démarrer une réunion* in the header, *Ajouter une réunion* in the panel
   * — for two intentions. The panel's is the one the rep is looking at, so on
   * an empty day the header keeps only *Démarrer*, which always means *now* and
   * is the product's one indispensable action.
   */
  showSchedule?: boolean
}

/** The hour a working day is assumed to start at, when the rep does not say. */
const DEFAULT_CLOCK = '09:00'

export function NewMeeting({
  day,
  today,
  onCreated,
  variant = 'header',
  showSchedule = true,
  armedElsewhere = false,
}: NewMeetingProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [client, setClient] = useState('')
  const [clock, setClock] = useState(DEFAULT_CLOCK)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const forNow = day === today

  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  const close = useCallback(() => {
    setOpen(false)
    setTitle('')
    setClient('')
    setClock(DEFAULT_CLOCK)
    setFailure(null)
  }, [])

  /**
   * Create, and hand it to the caller. The one path both branches share.
   *
   * `onCreated` is what starts the recording for a meeting that is for now — in
   * `Agenda.tsx`, because it is the same callback that decides whether to open
   * the session at all, and splitting "start it" from "open it" across two files
   * is how they come to disagree.
   */
  const create = useCallback(
    async (input: { title: string; clientName: string | null; scheduledStart: number | null }) => {
      if (busy) return
      setBusy(true)
      setFailure(null)
      try {
        const meeting = await invoke('meeting:create', input)
        close()
        await onCreated(meeting)
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'La réunion n’a pas pu être créée.')
      } finally {
        setBusy(false)
      }
    },
    [busy, close, onCreated],
  )

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()

      // A day the rep chose gets the Paris instant they chose on it — computed
      // in `app/calendar.ts`, because a 09:00 stored as 09:00 UTC is a meeting
      // that shows at 11:00 all summer.
      const parsed = parseClock(clock)
      if (!parsed) {
        setFailure('Donnez une heure au format 09:00.')
        return
      }

      await create({
        title: title.trim(),
        clientName: client.trim() || null,
        scheduledStart: atParis(day, parsed.hour, parsed.minute),
      })
    },
    [clock, title, client, day, create],
  )

  /*
   * *Démarrer une réunion* is drawn on every day, and it always means **now**.
   *
   * The first cut of this hid it whenever the rep selected any day but today,
   * which put the product's one indispensable action behind « go back to
   * today » — a rep glances at Thursday, their 15:00 starts early, and the
   * button they need has turned into something else. Selecting a day is looking
   * at a day; it is not a statement about when the next call begins.
   *
   * *Ajouter au …* is the second control and appears beside it, never instead of
   * it: scheduling is a different intention and reads as one (DEC-31).
   */
  /*
   * `Ctrl/⌘ N`, on the control itself rather than on the screen above it.
   *
   * `create` is where the busy guard, the failure sentence and `onCreated`
   * live, so the shortcut is the button — not a second path to the same IPC
   * that would have to be kept in step with it. Only the header instance
   * claims the key: the empty-day panel draws a second `NewMeeting`, and two
   * handlers on one window would start two recordings from one press.
   */
  useShortcuts(
    variant === 'header'
      ? { nouvelle: () => void create({ title: '', clientName: null, scheduledStart: null }) }
      : {},
  )

  const start = (
    <Button
      /*
        **Never the second filled blue on the screen.**

        Measured at 1280×800: « Démarrer une réunion » at x=1099 and the armed
        row's « Enregistrer » at x=1140, both `--brand-700`, 172px apart and
        horizontally overlapping. « One primary per view » (VISION.md §6) was two
        — and the wrong one was louder: the top one creates an *untitled* meeting
        for right now, the bottom one records the client call that has already
        started. When the calendar is offering that row, this steps down; it is
        still the way in on every other day, and on a day with nothing armed it
        is the only fill on screen.
      */
      variant={armedElsewhere ? 'bordered' : 'primary'}
      onClick={() => void create({ title: '', clientName: null, scheduledStart: null })}
      {...unavailable(busy, 'Démarrage de la réunion…')}
    >
      {busy ? 'Démarrage…' : 'Démarrer une réunion'}
    </Button>
  )

  const alert = failure ? (
    <span role="alert" className="text-danger text-ui">
      {failure}
    </span>
  ) : null

  const inEmptyState = variant === 'empty'

  if ((forNow || !showSchedule) && !inEmptyState) {
    return (
      <div className="flex items-center gap-inline">
        {alert}
        {start}
      </div>
    )
  }

  if (!open) {
    return (
      <div className="flex items-center justify-center gap-inline">
        {alert}
        {/*
          `text` in the header, not `primary`: two filled buttons side by side
          make the rep choose between them, and only one of them is the thing
          they came to do. In the empty panel there is no competing button, and
          the whole point of drawing it there is that it can be seen — so it is
          the panel's own action and looks like one.
        */}
        <Button variant={inEmptyState ? 'bordered' : 'text'} onClick={() => setOpen(true)}>
          {/*
            « Ajouter une réunion » in the panel, « Ajouter au … » in the
            header: one verb, two positions, and never both on screen at once.
            The header control has to name the day because nothing near it does;
            the panel sits directly under « Lundi 31 Août », so repeating the
            date there buys nothing and would put two buttons with the *same
            accessible name* on one screen, which is a rep — and a screen reader
            — being asked to tell apart two things that read identically.

            Two verbs in the whole product: *Démarrer* is now, *Ajouter* is any
            other day, forward or back.
          */}
          {/*
            « Ajouter », not « Planifier ».
            
            DEC-31 lets a rep put a meeting on *any* day, and a past one is a
            real case: a call the calendar never carried, filed on the day it
            happened. « Planifier une réunion » on lundi 31 août, ten days
            behind today, promises to schedule something into the past — the
            screen already knows the day is past, and said so in the line above.
            « Ajouter » is true in both directions, and *Démarrer* is still the
            only word that means now.
          */}
          {inEmptyState ? 'Ajouter une réunion' : `Ajouter au ${formatDayMedium(noonOf(day))}`}
        </Button>
        {inEmptyState ? null : start}
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      // Escape closes it. A rep who opened this by mistake, mid-call, should
      // not have to aim at anything to get rid of it.
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
      className="border-card bg-card-soft animate-rise-in flex items-center gap-2 rounded-sm border p-1.5"
    >
      {/*
        Both optional, and both say so. A meeting placed on Thursday with no
        objet is drawn as « Sans objet » in that day's cell (`entries.ts`) and
        renamed from the session header when it happens — which is strictly more
        honest than a required field the rep fills with "point client" to get
        past it.
      */}
      <input
        ref={titleRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Objet (facultatif)"
        maxLength={200}
        className="bg-inner border-card text-strong placeholder:text-muted w-52 rounded-sm border px-2.5 py-1.5 text-ui"
      />
      <input
        value={client}
        onChange={(event) => setClient(event.target.value)}
        placeholder="Client (facultatif)"
        maxLength={200}
        className="bg-inner border-card text-strong placeholder:text-muted w-40 rounded-sm border px-2.5 py-1.5 text-ui"
      />

      <label className="text-muted flex items-center gap-2 text-ui">
        <span>{upperFirst(formatDayMedium(noonOf(day)))}</span>
        <input
          type="time"
          value={clock}
          aria-label="Heure de la réunion"
          onChange={(event) => setClock(event.target.value)}
          className="bg-inner border-card text-strong w-24 rounded-sm border px-2.5 py-1.5 text-ui tabular-nums"
        />
      </label>

      <Button type="submit" variant="primary" {...unavailable(busy, 'Création de la réunion…')}>
        {busy ? '…' : 'Ajouter'}
      </Button>
      <Button variant="text" className="px-2 py-1.5" onClick={close}>
        Annuler
      </Button>
      {failure ? (
        <span role="alert" className="text-danger px-1 text-ui">
          {failure}
        </span>
      ) : null}
    </form>
  )
}
