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
 * **The live transcript pane is gone**, and its job was split rather than
 * dropped. It carried two: *proof of life* — "is this thing hearing me" — and
 * *evidence* — "where did that claim come from". It did the first badly, being
 * seconds late and empty through every pause, and it did the second at the
 * wrong time: nobody audits a citation while the client is talking. So proof of
 * life is now the header's level meter, which is instant and answers the
 * question during a silence too, and the evidence stays where an audit actually
 * happens — the transcript is still captured, still stored, and still backs
 * DEC-21's span check at the review gate. Nothing about the transcript changed
 * except that it stopped competing with the notepad for the rep's eyes.
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
import { CompteRenduPane } from './session/CompteRenduPane.tsx'
import { EnhancementNotice } from './session/EnhancementNotice.tsx'
import { LevelMeter } from './session/LevelMeter.tsx'
import { MeetingTitle } from './session/MeetingTitle.tsx'
import { RecipePicker, RecipeSwitchNotice, useRecipeChoice } from './session/RecipePicker.tsx'
import { SignalRail } from './session/SignalRail.tsx'
import { DEFAULT_RECIPE, type RecipeId } from '../../electron/core/contracts/recipes.ts'
import { Button, StateDot } from '../ui/index.ts'

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
   * Réglages, offered from one place on this screen: the notice that says no
   * model is configured. Optional so a harness can mount the screen without a
   * router — the notice then states the situation and omits the shortcut, which
   * is the correct degradation, because the sentence is the part that matters.
   */
  onReglages?: () => void
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

  const command = useCallback(
    async (verb: 'start' | 'end') => {
      const outcome = await invoke('session:command', { meetingId, command: verb, reason: null })
      setState(outcome.state)
    },
    [meetingId],
  )

  const initial = loaded.state.status === 'ready' ? loaded.state.value : null
  const current = state ?? initial?.meeting.state ?? null
  const recording = current === 'recording'

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
        <p className="text-danger text-sm">
          {loaded.state.status === 'failed' ? loaded.state.reason : 'Réunion introuvable'}
        </p>
        <button type="button" onClick={onBack} className="text-muted mt-3 text-xs underline">
          Retour
        </button>
      </Centered>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-subtle bg-card flex shrink-0 items-center gap-inline border-b px-gutter py-3">
        <Button variant="nav" onClick={onBack}>
          ‹ Calendrier
        </Button>

        <span aria-hidden className="border-subtle h-4 shrink-0 border-l" />

        {/*
          The orange belongs on the dot, not on the word. `--accent` is 2.44:1
          on white and 2.41:1 on the card, so the `text-accent` this line used
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
        {recording ? (
          <div className="border-accent bg-card flex shrink-0 items-center gap-inline rounded-sm border px-2 py-1">
            <StateDot
              tone="armed"
              label="Enregistrement"
              className="text-label font-semibold uppercase tracking-wider"
            />
            <Elapsed since={initial.meeting.startedAt} />
            <LevelMeter meetingId={meetingId} />
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
          One button, and which one depends on the machine — not on a local
          boolean. `session:command` refuses anything the state machine does not
          allow, so this cannot get out of step with it.
        */}
        {current === 'recording' ? (
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
          Whether the rail is showing at all, and nothing else — there is no
          longer anything to choose between (see the docblock). A rep who finds
          it distracting runs the pure notepad of DEC-11 and loses nothing,
          because the signals are still extracted and both surfaces are still
          there at the gate.

          The word names what disappears, which during the call is *Signaux* and
          afterwards is both panes.
        */}
        <button
          type="button"
          onClick={() => setShowRail((v) => !v)}
          aria-pressed={showRail}
          className={`shrink-0 text-[10px] uppercase tracking-wider ${
            showRail ? 'text-body' : 'text-muted hover:text-body'
          }`}
        >
          {compteRendu === null ? 'Signaux' : 'Panneau'}
        </button>
      </header>

      {saveFailed ? (
        <p role="alert" className="text-warn border-subtle border-b px-6 py-1.5 text-xs">
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
      <EnhancementNotice meetingId={meetingId} {...(onReglages ? { onReglages } : {})} />

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
        <main className="bg-inner min-w-[380px] flex-1">
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
        */}
        {showRail && compteRendu !== null ? (
          <aside className="border-subtle bg-card-soft w-[30%] min-w-[320px] max-w-[440px] shrink-0 border-l">
            <CompteRenduPane compteRendu={compteRendu} />
          </aside>
        ) : null}

        {/*
          280px for the signal rail, and the same floor-and-ceiling reasoning as
          the notepad's. It is the last column in both layouts, so a compte-rendu
          arriving inserts a pane rather than moving the one the rep has been
          glancing at for the length of the call.
        */}
        {showRail ? (
          <aside className="border-subtle bg-card-soft w-[20%] min-w-[210px] max-w-[280px] shrink-0 border-l">
            <SignalRail
              signals={allSignals}
              recording={recording}
              recipe={recipe ?? DEFAULT_RECIPE}
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

  return (
    <span className="text-strong tabular-nums text-ui" aria-label="Durée d’enregistrement">
      {formatElapsed(now - since)}
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted flex h-full flex-col items-center justify-center text-sm">
      {children}
    </div>
  )
}
