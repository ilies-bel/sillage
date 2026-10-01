/**
 * The right column of the session screen, and the one switch on it.
 *
 * Two views of the same call, under one segmented control: **Trame**, the slate
 * the recipe declares and the signals that have landed in it, and
 * **Transcription**, the record as it arrives. Trame is the default and always
 * has been the whole of this column; the transcript is the thing a rep now
 * asks for.
 *
 * ## Why the collection lives here and not in the pane
 *
 * `transcript:appended` is an **edge**. A pane mounted by a press and unmounted
 * by the next one holds a transcript that begins at the press — the defect the
 * widget already had once, named in its own header. So this component, which is
 * mounted for the length of the meeting, is the subscriber; the pane is handed
 * a list.
 *
 * It said « whichever view is showing », and that was the whole of the claim
 * anyone had checked. There is a second toggle: `showRail`, reached by the
 * *Masquer* below at any width and by « Mes notes » under 1184 — and `Session`
 * used to spend it by rendering this component or `null`. So the collector
 * *was* unmounted by a press, the record went with it, and the pane came back
 * drawing « La transcription apparaît ici dès la première prise de parole. »
 * over a call forty minutes old, with no way back during it: `review:get`
 * answers with no panel while `recording` (DEC-23), and `review:transcript` is
 * the only channel that serves the stored record. The column takes `shown` and
 * draws nothing when it is put away, so the sentence above is true of both
 * toggles rather than of one.
 *
 * And it is here rather than in `Session` for the reason `Elapsed` and
 * `LevelMeter` are their own components: `Session` holds a live ProseMirror view
 * with the rep's caret in it, and a segment arriving every few seconds must not
 * reconcile that subtree. This aside is the editor's sibling, so it does not.
 *
 * ## The choice lives for the meeting only
 *
 * Component state, keyed by nothing and persisted nowhere. There is no setting
 * for it and no stored preference: a rep who wants the transcript on this call
 * says so on this call. Leaving the meeting and coming back opens on the slate,
 * which is the view that is true of every call.
 */
import { useState } from 'react'
import type { Signal } from '../../../electron/core/contracts/signals.ts'
import type { TranscriptSegment } from '../../../electron/core/contracts/transcript.ts'
import type { RecipeId } from '../../../electron/core/contracts/recipes.ts'
import { useBroadcast } from '../../app/bridge.ts'
import { Button, Segmented, StateDot } from '../../ui/index.ts'
import { SignalRail } from './SignalRail.tsx'
import { FindGlyph, TranscriptPane } from './TranscriptPane.tsx'

type AsideView = 'trame' | 'transcription'

const VIEWS = [
  { id: 'trame', label: 'Trame' },
  { id: 'transcription', label: 'Transcription' },
] as const satisfies readonly { id: AsideView; label: string }[]

interface LiveAsideProps {
  meetingId: string
  signals: Signal[]
  recipe: RecipeId
  /** Whether the machine is still recording — the « en direct » dot is its. */
  recording: boolean
  /** Put the side panes away. The way back is in the session header. */
  onHide: () => void
  /**
   * Whether the column is on screen. **Never a reason to unmount**: the turns
   * collected so far live here, and a rep who put the panes away did not ask
   * to lose them.
   */
  shown: boolean
}

export function LiveAside({
  meetingId,
  signals,
  recipe,
  recording,
  onHide,
  shown,
}: LiveAsideProps) {
  const [view, setView] = useState<AsideView>('trame')
  const [finding, setFinding] = useState(false)
  const [turns, setTurns] = useState<TranscriptSegment[]>([])

  useBroadcast('transcript:appended', (payload) => {
    if (payload.meetingId !== meetingId) return
    // The record, and only the record. `isFinal: false` cannot occur — see
    // `TranscriptPane`'s header — and the one that did would be a draft.
    if (!payload.segment.isFinal) return
    setTurns((was) => (was.some((t) => t.id === payload.segment.id) ? was : [...was, payload.segment]))
  })

  /*
   * After the subscription and never before it: a hook that stops being called
   * is a hook that stops collecting, which is the defect this file is about.
   */
  if (!shown) return null

  return (
    /*
     * The column's own box. It was `Session`'s while the ternary was, and it
     * comes here with it, so that putting the panes away draws nothing rather
     * than an empty 280px gutter.
     *
     * Above 1184 this is one of three columns — 22 % with a 300px ceiling and
     * a 240 floor. Below it, one of two, so its share goes up: 32 % with a
     * 360px ceiling, which at the app's own minimum window (960px) is 307px.
     * The floor is what the slate's container query (`index.css`) was written
     * against: at 240 it sets its label above its value and « 2 × Data
     * Engineer confirmé » staircases.
     */
    <aside className="border-subtle bg-card-soft min-h-0 w-[32%] min-w-[280px] max-w-[360px] shrink-0 border-l min-[1184px]:w-[22%] min-[1184px]:min-w-[240px] min-[1184px]:max-w-[300px]">
      <section className="flex h-full min-h-0 flex-col">
        {/*
          `flex-wrap`, measured: at the app's own minimum window (960px, `main.ts`)
          this column is at its 210px floor, which leaves 178px inside the
          gutters. The switch alone is 145 of them, so *Masquer* beside it pushed
          the group 25px past the edge and the check called it — a control drawn
          outside the box it is in is a control nobody can press. Wrapped, the
          verb takes a second line at that size and shares the first everywhere
          else.
        */}
        <header className="flex flex-wrap items-center justify-between gap-inline gap-y-hair px-row pb-snug pt-row">
          <Segmented
            label="Vue de la colonne"
            options={VIEWS}
            current={view}
            onSelect={(next) => {
              setView(next)
              if (next === 'trame') setFinding(false)
            }}
          />

          {view === 'transcription' ? (
            <span className="flex shrink-0 items-center gap-inline">
              {/*
                « en direct » only while the machine is recording. On a call that
                has ended the same column is a record, and a dot claiming
                otherwise would be the app saying it is still listening.
              */}
              {recording ? (
                <StateDot tone="recording" label="en direct" className="text-meta" />
              ) : null}
              <FindGlyph on={finding} onToggle={() => setFinding((was) => !was)} />
            </span>
          ) : (
            <Button variant="text" className="shrink-0" onClick={onHide}>
              Masquer
            </Button>
          )}
        </header>

        {view === 'trame' ? (
          <SignalRail signals={signals} recipe={recipe} />
        ) : (
          <TranscriptPane turns={turns} live={recording} finding={finding} />
        )}
      </section>
    </aside>
  )
}
