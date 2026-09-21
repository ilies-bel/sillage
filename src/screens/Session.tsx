/**
 * *En réunion* — the surfaces of DEC-14, weighted deliberately.
 *
 *   ┌ Mes notes ──────────────────┬ Compte-rendu ──┬ Signaux ────┐
 *   │ the reason it's open        │ what it made   │ what it heard│
 *   └─────────────────────────────┴────────────────┴─────────────┘
 *      ▁▃▅▂ in the header — proof of life
 *
 * **Both side surfaces are shown at once; neither is behind the other.** The
 * compte-rendu and the slate are read together or not at all: the slate is the
 * list of things that had to come up, and the only way to judge a compte-rendu
 * against it — to see that « Durée — » is empty *and* that the document says
 * nothing about how long the mission runs — is to have both in one glance.
 * Behind a two-tab switch that comparison costs a click and a memory, so nobody
 * makes it. The third column exists only once there is a compte-rendu; during
 * the call this screen is exactly the two it has always been.
 *
 * **The live transcript is behind the column's own switch**, and its job is
 * split rather than carried alone. It carried two: *proof of life* — "is this thing hearing me" — and
 * *evidence* — "where did that claim come from". It did the first badly, being
 * seconds late and empty through every pause, and it did the second at the
 * wrong time: nobody audits a citation while the client is talking. So proof of
 * life is the header's level meter, which is instant and answers the question
 * during a silence too (DEC-38), and the audit stays at the gate, where the
 * stored record backs DEC-21's span check. What is left over is the third job,
 * « what did they just say », which the transcript is genuinely good at and
 * which nothing on this screen answered — so the right column offers it under a
 * segmented control, opt-in, defaulted to the slate, and the rep decides
 * whether it is worth the glance. See `LiveAside.tsx`.
 *
 * The load-bearing rule on this screen: **the AI never writes into the
 * document during the call.** Signals arrive over broadcasts and land in the
 * side rail, which has no path into the notepad — see `Notepad.tsx`, which
 * takes an initial document and accepts no incoming transactions at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Signal } from '../../electron/core/contracts/signals.ts'
import type { MeetingState } from '../../electron/core/contracts/meeting.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { formatElapsed } from '../app/format.ts'
import { Notepad } from '../editor/Notepad.tsx'
import { EditorErrorBoundary } from '../editor/editor-error-boundary'
import { ArmedBrief } from './session/ArmedBrief.tsx'
import { CompteRenduPane } from './session/CompteRenduPane.tsx'
import { EnhancementNotice } from './session/EnhancementNotice.tsx'
import { OutcomeNotice } from './session/OutcomeNotice.tsx'
import type { SectionId } from './Reglages.tsx'
import { LevelMeter } from './session/LevelMeter.tsx'
import { MeetingTitle } from './session/MeetingTitle.tsx'
import { RecipePicker, RecipeSwitchNotice, useRecipeChoice } from './session/RecipePicker.tsx'
import { LiveAside } from './session/LiveAside.tsx'
import { DEFAULT_RECIPE, type RecipeId } from '../../electron/core/contracts/recipes.ts'
import { LanguagePill } from './session/LanguagePill.tsx'
import { Button, StateDot } from '../ui/index.ts'

/**
 * **Three reading columns need 1 184 px, and the window's own minimum is 960.**
 *
 * Measured on the shipped renderer, `session-compte-rendu`, sweeping the
 * viewport width and counting the characters a line of every run of prose on
 * the screen really holds (`shot.mjs --prose`'s own arithmetic — the box over
 * the average advance of French lowercase, not over `ch`):
 *
 *     960   notes 280  compte-rendu 440  trame 240   narrowest 25 car./ligne
 *    1024   notes 344  compte-rendu 440  trame 240   narrowest 34
 *    1120   notes 426  compte-rendu 448  trame 246   narrowest 42
 *    1176   notes 447  compte-rendu 470  trame 259   narrowest 42
 *    1184   notes 450  compte-rendu 474  trame 260   narrowest 47
 *    1280   notes 486  compte-rendu 512  trame 282   narrowest 51
 *
 * 45 is the bottom of the classic 45–75 band that `.measure`'s own docblock
 * cites for the top, and `shot.mjs --prose` now binds both ends. 1 184 is the
 * first width at which *every* run on this screen clears it; 1 176 does not.
 *
 * So below it the screen holds **two** columns and not three: the compte-rendu
 * and the trame, which are the pair DEC-14 says is read together — « Durée — »
 * empty on the slate beside prose that is silent about it. The notepad is the
 * one of the three that is not part of that judgement, so it is the one that
 * yields, and it yields to a *press* rather than to nothing: « Mes notes » in
 * the header below the breakpoint, and `LiveAside`'s own « Masquer » at any
 * width, both reaching the same `showRail === false` the screen has always had.
 *
 * Measured at 960×600, the two arrangements:
 *
 *                     three columns (before)    two columns (here)
 *     compte-rendu    440px, 42 chars a line   653px, 57 chars a line
 *     trame           240px, 345/532 = 64.8%   307px, 446/446 = 100%
 *     notes           280px, 25 chars a line   960px on one press, 69
 *     page turns      2, 361px apart           1
 *
 * No new bar and no new pane: a strip of its own above the two slots costs
 * **51px of a 600px window**, measured — 8.5 % of the screen's height,
 * permanently, and every one of those pixels comes off the document. The
 * control is a button in a header row that already exists.
 *
 * The number is a media query rather than a measurement in JavaScript because
 * the *control* has to appear exactly where the layout changes; one number in
 * one place, read by both, cannot drift. `SIDE_BY_SIDE_PX` is exported so
 * `session-breakpoint.test.tsx` can assert that every Tailwind variant in this
 * file spells it, and that the `max-` half is exactly one pixel below.
 */
export const SIDE_BY_SIDE_PX = 1184

interface SessionProps {
  meetingId: string
  onBack: () => void
  /**
   * Opens the review gate. Offered from this screen only, and only once the
   * machine has reached `awaiting_confirmation` — a session that is recording
   * has no control that leads there (DEC-23).
   */
  onReview?: (meetingId: string) => void
  /**
   * Réglages, offered from two places on this screen: the notice that says no
   * model is configured, and the one that says the recording was abandoned.
   * Optional so a harness can mount the screen without a router — the notices
   * then state the situation and omit the shortcut, which is the correct
   * degradation, because the sentence is the part that matters.
   *
   * It takes the pane, because the two callers send the rep to different ones:
   * a missing model is *Modèle de langage* and a dead capture is *Connecteurs*.
   * `App.tsx` has always passed `(section?) => …`; the prop was the narrower of
   * the two and threw the argument away.
   */
  onReglages?: (section?: SectionId) => void
}

export function Session({ meetingId, onBack, onReview, onReglages }: SessionProps) {
  const loaded = useInvoke('meeting:get', { meetingId })

  const [signals, setSignals] = useState<Signal[]>([])
  const [state, setState] = useState<MeetingState | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [showRail, setShowRail] = useState(true)

  useBroadcast('signal:appended', (payload) => {
    if (payload.meetingId !== meetingId) return
    setSignals((previous) => [...previous, payload.signal])
  })

  useBroadcast('session:changed', (payload) => {
    if (payload.meetingId === meetingId) setState(payload.state)
  })

  const save = useCallback(
    (payload: { meetingId: string; revision: number; doc: unknown }) => {
      setSaveFailed(false)
      return invoke('document:save', payload)
    },
    [],
  )

  const onSaveFailed = useCallback(() => setSaveFailed(true), [])

  /**
   * The one button in the header is in flight.
   *
   * *Terminer* is the click a rep makes at the least patient moment of the call
   * — the client has hung up and they want to know it registered. The command
   * itself returns quickly, but until it does the button sits there fully live,
   * so a rep who saw nothing happen pressed it again; the state machine refuses
   * the second press silently, which looks exactly like the first one having
   * been ignored too. The control now says what it is doing and stops taking
   * presses while it does.
   */
  const [inFlight, setInFlight] = useState<'start' | 'end' | null>(null)

  const command = useCallback(
    async (verb: 'start' | 'end') => {
      setInFlight(verb)
      try {
        const outcome = await invoke('session:command', { meetingId, command: verb, reason: null })
        setState(outcome.state)
      } finally {
        // Cleared whatever happened. A command that threw leaves the machine
        // where it was, and a button that stayed disabled would strand the rep
        // on the state they were trying to leave.
        setInFlight(null)
      }
    },
    [meetingId],
  )

  const initial = loaded.state.status === 'ready' ? loaded.state.value : null
  const current = state ?? initial?.meeting.state ?? null
  const recording = current === 'recording'
  /*
   * **Pause is a capture verb, and this screen draws the instrument it changes.**
   *
   * Only the widget can *take* the pause today, but the state is the meeting's,
   * not the widget's — so the header meter here shows the same reading a rep is
   * shown over their call. Without it, a rep who paused from the pill and then
   * looked at the session screen saw the product's proof of life (DEC-38) moving
   * exactly as it does while recording. One instrument wired two ways is two
   * answers to one question.
   *
   * Seeded from the snapshot as well as the edge, for the reason the widget's
   * health collection is: `recording:paused` is an edge broadcast, so a screen
   * mounted *after* the pause would never hear it.
   */
  const [paused, setPaused] = useState(false)
  useBroadcast('recording:paused', (payload) => {
    if (payload.meetingId === meetingId) setPaused(payload.paused)
  })

  /*
   * The compte-rendu, re-read when the machine moves.
   *
   * `meeting:get` answers with it once the extraction has stored one, so the
   * mount read covers a meeting opened from Historique and this covers one that
   * finishes while the screen is open. Keyed on the *state* rather than polled:
   * `extracting → awaiting_confirmation` is exactly the edge on which one comes
   * into existence, and there is no second signal to disagree with.
   *
   * `enhancement:status` is not enough on its own — it reports `idle` on
   * success, because the notice has nothing left to say — which is the whole
   * reason this listens to the transition instead.
   */
  const [compteRendu, setCompteRendu] = useState<string | null>(null)
  /**
   * Which recipe the meeting is set to (DEC-43).
   *
   * Held beside the compte-rendu and refreshed on the same edge, because the two
   * move together: a regeneration is the one event that changes the document
   * *and* is the consequence of changing this. Null until the first read lands,
   * so the picker does not flash the default before the meeting's own answer
   * arrives.
   */
  const [recipe, setRecipe] = useState<RecipeId | null>(null)
  useEffect(() => {
    setCompteRendu(initial?.compteRendu ?? null)
    setRecipe(initial?.recipe ?? null)
  }, [initial])

  useBroadcast('session:changed', (payload) => {
    if (payload.meetingId !== meetingId) return
    void invoke('meeting:get', { meetingId })
      .then((next) => {
        setCompteRendu(next.compteRendu)
        setRecipe(next.recipe)
      })
      // The pane simply stays as it was. A meeting whose compte-rendu could not
      // be re-read is still a meeting with a notepad and a review gate.
      .catch(() => undefined)
  })

  const choice = useRecipeChoice({
    meetingId,
    recipe: recipe ?? DEFAULT_RECIPE,
    hasCompteRendu: compteRendu !== null,
    onChosen: setRecipe,
  })

  /**
   * Whether the compte-rendu column is on screen — and therefore whether the
   * notepad is the one that yields below `SIDE_BY_SIDE_PX`.
   *
   * The same predicate the compte-rendu column is drawn under, named once: the
   * notepad's `hidden` variant must agree with it exactly, or below the
   * breakpoint the screen has two reading columns stacked into one slot, or an
   * empty slot with neither.
   */
  const twoUp = showRail && compteRendu !== null

  // The persisted history, merged once. After mount the broadcasts are the
  // only source, which is why this is memoised on the load rather than on
  // `signals`.
  const allSignals = useMemo(() => [...(initial?.signals ?? []), ...signals], [initial, signals])

  if (loaded.state.status === 'loading') {
    return <Centered>Chargement…</Centered>
  }

  if (loaded.state.status === 'failed' || !initial) {
    return (
      <Centered>
        <p className="text-danger text-copy">
          {loaded.state.status === 'failed' ? loaded.state.reason : 'Réunion introuvable'}
        </p>
        <button type="button" onClick={onBack} className="text-muted mt-inline text-ui underline">
          Retour
        </button>
      </Centered>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* `.session-header` declares the container the pill measures itself
          against; see `index.css`. Below 1080px the pill drops its wording and
          keeps its instrument. */}
      <header className="session-header border-subtle bg-card flex shrink-0 items-center gap-inline border-b px-gutter py-inline">
        <Button variant="nav" onClick={onBack}>
          ‹ Calendrier
        </Button>

        <span aria-hidden className="border-subtle h-4 shrink-0 border-l" />

        {/*
          The orange belongs on the dot, not on the word. `--accent` is 3.38:1
          on white and 3.35:1 on the card — a graphic's floor, not a word's, so
          the `text-accent` this line used
          to carry made the one label on screen that must never be missed the
          least readable thing in the header. `StateDot` keeps the colour where
          it works and the label at `--text-muted`.

          Bounded, and carrying the elapsed time (`5.2 En réunion`). "Is it
          still running?" is the question a rep asks this screen most often, and
          a clock that has moved since they last looked answers it in a way a
          static word cannot.
        */}
        {/*
          The meter sits inside the recording pill rather than beside it,
          because it means nothing outside a recording: bars that keep moving
          after « Terminer » would say the app is still listening. One element
          appears and disappears together, and the rep's eye already goes here.

          A `div` and no longer a `p`: the meter is not phrasing content, and a
          `div` inside a `p` is closed by the parser at the opening tag, which
          React reports as a hydration error and the browser renders as a pill
          with its own contents sitting outside it.
        */}
        {/*
          **And no word on it.** The pill said « ENREGISTREMENT » in 10px caps
          beside a running clock and a moving meter — three statements of the
          same fact, of which the word is the only one that never changes. What
          is left is the dot, the clock and the instrument, and the dot is not
          alone: `Elapsed` hands `StateDot` the elapsed time as its label, so
          the coloured dot still has a legible word beside it (VISION.md §6) and
          that word is the one carrying information.
        */}
        {recording ? (
          <div
            role="status"
            aria-label="Enregistrement en cours"
            className="border-accent bg-card flex shrink-0 items-center gap-snug rounded-sm border px-snug py-hair"
          >
            <Elapsed since={initial.meeting.startedAt} />
            <LevelMeter meetingId={meetingId} paused={paused} />
          </div>
        ) : null}

        {/*
          Editable, because a meeting now starts on one click and arrives here
          with no name at all. Two fields on one line, the client beside the
          objet rather than under it, so the header stays one line tall.
        */}
        <MeetingTitle
          meetingId={meetingId}
          title={initial.meeting.title}
          clientName={initial.meeting.clientName}
        />

        {/*
          Which document this meeting produces (DEC-43). Live from the first
          frame, so a rep who knows on the way in that this is a follow-up and
          not a prise de besoin sets it before pressing *Démarrer* — and can
          still change their mind on the call, which is when they find out.
        */}
        <RecipePicker choice={choice} state={current} />

        {/*
          What the app transcribes in, stated rather than chosen.

          `TRANSCRIPTION_LANGUAGE` is the single place this product declares it
          — `recordingOptionsFor` asks the registry for that exact tag — and
          there is no setting behind this chip because there is no setting: v1
          transcribes French, every row in `STT_PROVIDERS` declares `fr-FR`, and
          a control offering a choice the engines do not have would be the dead
          control DEC-26 forbids. So it is display only, and it is here because
          a rep on a call with an English-speaking client needs to find out from
          the header rather than from the compte-rendu.
        */}
        <LanguagePill />

        {/*
          One button, and which one depends on the machine — not on a local
          boolean. `session:command` refuses anything the state machine does not
          allow, so this cannot get out of step with it.
        */}
        {/*
          A word while the command is in flight, not a disabled button — the
          same choice `RecipePicker` makes, and for the same two reasons.
          `Button`'s disabled form stacks its mandatory reason underneath
          (DEC-26), which in a one-line header is a 14px jump every time a rep
          presses *Terminer*; and a greyed button still looks pressable, which
          is precisely the invitation this is here to withdraw.
        */}
        {inFlight !== null ? (
          <span className="text-muted shrink-0 text-ui" role="status">
            {inFlight === 'end' ? 'Fin de réunion…' : 'Démarrage…'}
          </span>
        ) : current === 'recording' ? (
          <Button onClick={() => void command('end')}>Terminer</Button>
        ) : current === 'idle' || current === 'armed' ? (
          <Button variant="primary" onClick={() => void command('start')}>
            Démarrer
          </Button>
        ) : null}

        {/*
          The gate's only entry point, and it exists in exactly one state. While
          the meeting is `recording` this branch is not reachable — no button,
          no badge, no count (DEC-23).
        */}
        {current === 'awaiting_confirmation' && onReview ? (
          <Button variant="primary" onClick={() => onReview(meetingId)}>
            Relire et valider
          </Button>
        ) : null}

        {/*
          Only the way *back*. Putting the volets away is a verb inside the
          thing it closes — `SignalRail`'s own header — because a word in the
          header ( « SIGNAUX », then « PANNEAU », then « VOLETS » ) was the one
          control in the app whose effect could not be guessed from its face.

          It is drawn only while they are hidden, which is exactly when there is
          a notepad's width of room to spell it out: with the panes shown, this
          slot is what was truncating the meeting's own title on a 1280 laptop.
          A control that is not on screen is not a dead control (DEC-26) — it is
          the state it belongs to.
        */}
        {showRail ? null : (
          <Button variant="text" className="shrink-0" onClick={() => setShowRail(true)}>
            {compteRendu === null ? 'Afficher les signaux' : 'Afficher les volets'}
          </Button>
        )}

        {/*
          **The way back to the rep's own notes, below `SIDE_BY_SIDE_PX`.**

          Below the breakpoint the notepad is not on this screen: there is room
          for two reading columns and the two being judged against each other
          are the document and the slate (DEC-14). The notes are one press away
          and this is the press — it is the *same* state `LiveAside`'s
          « Masquer » reaches, named by what it reveals rather than by what it
          puts away, because down here that is what the rep is looking for. Its
          twin is the control directly above: one of the two is always drawn,
          never both.

          Above the breakpoint it is not drawn at all — all three columns are on
          screen and a control offering to fetch one of them would be the dead
          control DEC-26 names. In the header rather than over the panes because
          a bar of its own costs **51px of a 600px window**, measured: 8.5 % of
          the screen's height, permanently, for a press a rep makes rarely — and
          every one of those pixels comes off the document this screen is named
          after. The header's own title cell is `flex-1 min-w-0`, so this takes
          its width from the one child that has it to give: measured at 960×600,
          the button is 59px and the title cell goes from 442px to 371, with the
          row still ending at x=928 of 960 exactly as it did.
        */}
        {showRail && compteRendu !== null ? (
          <Button
            variant="text"
            className="shrink-0 min-[1184px]:hidden"
            onClick={() => setShowRail(false)}
          >
            Mes notes
          </Button>
        ) : null}
      </header>

      {saveFailed ? (
        <p role="alert" className="text-warn border-subtle border-b px-6 py-tight text-ui">
          Enregistrement des notes en attente — nouvelle tentative à la prochaine frappe.
        </p>
      ) : null}

      {/*
        Draws nothing until the meeting has ended, and then says what became of
        it. Directly under the header because it is the answer to the button the
        rep just pressed, and above the notepad because those notes are exactly
        what it is reassuring them about.

        It owns its own subscription for the same reason `Elapsed` and
        `LevelMeter` do — this screen holds a live ProseMirror view, and a status
        broadcast that re-rendered `Session` would reconcile the notepad's
        subtree along with it.
      */}
      {/*
        And before it has started, what it *is* — the hour, the far side, and
        that nothing is being recorded yet. First in the stack because the three
        below it answer for a meeting that has already run: no two of the four
        are ever drawn together.
      */}
      <ArmedBrief
        state={current}
        eventId={initial.meeting.eventId}
        scheduledStart={initial.meeting.scheduledStart}
      />

      <EnhancementNotice meetingId={meetingId} {...(onReglages ? { onReglages } : {})} />

      {/*
        And what became of the meeting when the machine stopped for good.

        Under `EnhancementNotice` because the two never draw together — that one
        answers `ended` and `extracting`, this one the three terminal states — and
        because the order on the day a tenth state makes them overlap should be
        « what is still happening » above « what already happened ».
      */}
      <OutcomeNotice state={current} {...(onReglages ? { onReglages } : {})} />

      {/*
        Only ever drawn when a switch is armed against an existing compte-rendu.
        Under the header rather than over the notepad — the sentence it carries
        is the one that says what is about to be replaced, and it has to be
        readable in full (DEC-43).
      */}
      <RecipeSwitchNotice choice={choice} />

      <div className="flex min-h-0 flex-1">
        {/*
          A floor, because the read-only rail has one and the writing surface
          did not. `min-w-0` let it absorb the entire deficit: measured at the
          app's own minimum window (960px, `main.ts`) with the browser at 200%
          zoom, the notepad was **10px wide and its text measure was zero**,
          while the rails held their minimums. The one surface with a cursor was
          the one that vanished. Kept even though only one rail remains — the
          deficit that produced it was a sum, not a single pane.
        */}
        {/*
          `min-w-[260px]`, down from 380.

          At 960 — the window's own minimum — the three columns are all at their
          floor and the arithmetic left the compte-rendu 360px, which is 42
          characters a line and, with the read-only note and *Demander* under it,
          **zero words of the prose**: a rep on the minimum window saw six lines
          of deterministic header they already knew and nothing else. DEC-40 says
          the document opens on a « ## Résumé » and it did so only in the fixture.

          The notepad gives the room because it is the one of the three that is
          not part of the judgement. The rule is that the document and the slate
          are read *together* — « Durée — » empty beside prose that is silent
          about it — and the notes are what the rep wrote during the call, an
          hour ago, and are not being compared to anything.
        */}
        <main
          className={`bg-inner min-h-0 flex-1 min-[1184px]:min-w-[260px] ${
            twoUp ? 'max-[1183px]:hidden' : ''
          }`}
        >
          <EditorErrorBoundary resetKey={meetingId}>
            <Notepad
              meetingId={meetingId}
              initialDoc={initial.document}
              initialRevision={0}
              save={save}
              onSaveFailed={onSaveFailed}
              placeholder="Vos notes…"
            />
          </EditorErrorBoundary>
        </main>

        {/*
          The compte-rendu, in a column of its own and only once one exists.

          Side by side rather than stacked, because the two panes want opposite
          things from the space they are given: the slate is seven short rows and
          wants height it does not have to scroll, the document is prose and
          wants every line it can get. Stacked, the one that suffered was always
          the compte-rendu — at 900px tall it showed six lines under a full slate.
          Beside each other they each get the full height of the screen, and the
          arithmetic still holds at the app's own minimum window (960px,
          `main.ts`): 320 + 210 of rail leaves the notepad 430, above its floor.

          Wider than the signal rail for the reason it always was: at 280px this
          prose wrapped every heading and turned a document into a column of
          stubs.

          36 % rather than 30, and a 560px ceiling rather than 440. Once the
          analysis has landed, the document is the thing being judged and it was
          the narrowest prose on the screen: 384px at 1280 against a notepad of
          640 holding four bullet points and six hundred pixels of white. The
          notepad keeps its floor and every pixel it needs to write in; what it
          gives up is space it was not using.
        */}
        {/*
          Below `SIDE_BY_SIDE_PX` it is not a column beside the notes: it *is*
          the left slot, taking every pixel the trame does not, and the document
          inside it keeps the one reading measure (`CompteRenduPane` wears
          `.measure` now). Measured at 960×600: 653px of slot against 440, and
          the narrowest run of the document goes from 42 characters a line to
          57. `min-[1184px]:flex-none` is what hands the three-column layout
          back its fixed share — a `flex-1` that also carries `w-[40%]` would
          grow past the ceiling above it.
        */}
        {showRail && compteRendu !== null ? (
          <aside className="border-subtle bg-card-soft min-h-0 flex-1 min-[1184px]:w-[40%] min-[1184px]:min-w-[440px] min-[1184px]:max-w-[560px] min-[1184px]:flex-none min-[1184px]:shrink-0 min-[1184px]:border-l">
            {/*
              `eventId` rides along because the pane's *Demander* offers the
              follow-up, and a call with no calendar entry has no attendees to
              address one to — see `askActions.ts`. Read off the meeting rather
              than guessed from the attendee list, which this screen does not
              have.
            */}
            <CompteRenduPane
              compteRendu={compteRendu}
              meetingId={meetingId}
              fromCalendar={initial.meeting.eventId !== null}
            />
          </aside>
        ) : null}

        {/*
          The signal rail, with the same floor-and-ceiling reasoning as the
          notepad's. It is the last column in both layouts, so a compte-rendu
          arriving inserts a pane rather than moving the one the rep has been
          glancing at for the length of the call.

          22 % and a 300px ceiling, up from 20 % and 280. The label column takes
          64px of it and the row its padding, which at 1280 left the *value* —
          the thing the rail exists to show — **117 pixels**: « 2 × Data
          Engineer confirmé — Databricks, Airflow, dbt » set six words to a line
          is a staircase, not a reading. The floor stays at 210 so the
          arithmetic still holds at the app's own minimum window (960px): 360 of
          document and 211 of rail leave the notepad 389, above its 380 floor.
        */}
        {/*
          Below `SIDE_BY_SIDE_PX` it is one of **two** columns rather than one
          of three, so its share goes up: 32 % with a 360px ceiling, which at
          960 is 307px against the 240 it was pinned to. That is the width its
          own container query (`index.css`) was written to stop happening — at
          240 the slate sets its label above its value and « 2 × Data Engineer
          confirmé » staircases. The ceiling is what keeps the other slot from
          being starved on the way up to the breakpoint.
        */}
        {showRail ? (
          <aside className="border-subtle bg-card-soft min-h-0 w-[32%] min-w-[280px] max-w-[360px] shrink-0 border-l min-[1184px]:w-[22%] min-[1184px]:min-w-[240px] min-[1184px]:max-w-[300px]">
            {/*
              Two views of the same call, and the rep picks (`LiveAside`). The
              slate is the default and the transcript is opt-in — DEC-38's
              clause is about a transcript drawn *to prove the tool works*, and
              proof of life is still the meter in the header.
            */}
            <LiveAside
              meetingId={meetingId}
              onHide={() => setShowRail(false)}
              signals={allSignals}
              recipe={recipe ?? DEFAULT_RECIPE}
              recording={recording}
            />
          </aside>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The elapsed clock, and its own component for one reason: it re-renders every
 * second, and nothing else on this screen may.
 *
 * The centre column is a live ProseMirror view with the rep's caret in it. A
 * `setInterval` that set state on `Session` would re-render the notepad's
 * subtree once a second for the length of a call — on the one surface in the
 * product where a dropped keystroke is unrecoverable. Isolating the tick here
 * means React reconciles a single `<span>` of text.
 *
 * `startedAt` null is a meeting the machine says is recording but which carries
 * no start — nothing honest to count from, so nothing is drawn.
 */
function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (since === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])

  if (since === null) return null

  /*
   * The dot rides with it. `StateDot` refuses to render a bare coloured dot —
   * a state is never colour alone — and the clock is the right label for it:
   * visible, legible at `--text-strong`, and the one thing in the pill that
   * answers « is it still running » rather than merely repeating that it is.
   */
  return (
    <StateDot
      // Filled: capture is running. The offer is the hollow ring — `StateDot`.
      tone="recording"
      label={formatElapsed(now - since)}
      labelClassName="text-strong tabular-nums"
      /*
        `gap-tight` over `StateDot`'s own `gap-snug`, and it is the pill's rhythm
        that asks for it rather than this component's taste.

        Painted at both smoke sizes, the pill read « ● 8 00:05:00 8 ▮▮▮ »: the dot
        sat exactly as far from its clock as the clock sat from the level meter, so
        the one group in it — a state and the time it has been in — was not drawn as
        a group. `--rhythm` reports it « 8px dedans contre 8px autour », on
        `session`, `session-libre` and `session-sans-entra`.

        Which side moves is decided by the header around it, measured at 960×600:
        its own children stand **12 px** apart, so the pill's outer gap cannot go up
        to 12 without becoming the same distance as the separation between the pill
        and the meeting's title — and it cannot grow at all without taking width
        from `MeetingTitle`, which is the `flex-1 min-w-0` cell beside it (226.25 px
        of 960, everything to its right already ending at 928 of 960). So the inner
        one comes down: 12 outside the pill, 8 across it, 6 from the dot to its
        word, and the pill is 2 px narrower than it was.
      */
      className="text-ui gap-tight"
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted flex h-full flex-col items-center justify-center text-copy">
      {children}
    </div>
  )
}
