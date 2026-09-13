/**
 * The live transcript, on the session screen, **behind the rep's own press**.
 *
 * ## Why this exists, and what it does not undo
 *
 * DEC-38 removed a live transcript pane from this screen, and the clause it
 * actually wrote is « do not reintroduce a live transcript *to prove the tool is
 * working* ». That job stays with the instrument: the level meter in the header
 * is what answers « is this thing hearing me », it is instant, and it answers
 * during a silence too. Nothing here is proof of life, and nothing here is
 * drawn unless the rep asked for it — the column opens on *Trame* and the
 * choice lives for the length of the meeting and no longer.
 *
 * What the transcript is good at is the other question, « what did they just
 * say », and until now the only surface in the product that answered it during
 * a call was a 340-pixel widget floating over the video window. A rep who has
 * Sillage open on a second screen had to reach for the overlay to read back two
 * turns. So it is offered here, at the width it wants, as an opt-in view of the
 * column that is otherwise the slate.
 *
 * ## The record, and only the record
 *
 * - **No second collector.** The turns arrive on `transcript:appended`, the same
 *   broadcast the widget's *window* subscribes to, and they are collected by
 *   `LiveAside` — which stays mounted across the toggle — rather than by this
 *   pane, which is mounted by a press and unmounted by the next one. A
 *   transcript held here would begin at the press, which is the feature failing
 *   on precisely its own use case.
 * - **No provisional text.** `isFinal: false` cannot occur (`LocalWhisperSession`
 *   and `RestSttSession` both emit `true`, every row in `STT_PROVIDERS` declares
 *   `streaming: false`), and the one non-final segment that somehow did would be
 *   dropped rather than drawn grey.
 * - **A side, never a person.** `speakerLabel` is called with no interlocuteurs
 *   here: this screen does not hold the invite's attendee list, and guessing
 *   from one would be the app naming a speaker it cannot know. « Client » and
 *   « Moi », which is what the reader in *Historique* prints for the same turn.
 * - **It writes nothing into the notepad** (DEC-5). It is a read, beside a
 *   document, exactly like the compte-rendu pane — and it says so in its own
 *   footer, because a rep meeting a live transcript for the first time is
 *   entitled to know it is not going to appear in their notes.
 *
 * ## The find box
 *
 * It marks, it does not filter — the same choice `TranscriptReader` makes at the
 * gate, and for the same reason: the turns either side are why anybody looks a
 * sentence up. The fold is `normalizeForVerification`, the one the app verifies
 * spans with, so a term typed with its accent finds a turn the STT dropped it
 * from.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import {
  normalizeForVerification,
  speakerLabel,
  type TranscriptSegment,
} from '../../../electron/core/contracts/transcript.ts'
import { formatOffset } from '../../app/format.ts'

interface TranscriptPaneProps {
  /** Collected by `LiveAside`, in arrival order. */
  turns: readonly TranscriptSegment[]
  /** Whether the recording is still running — the « en direct » dot is its. */
  live: boolean
  /** Open with the find box showing. Owned above, so it survives the toggle. */
  finding: boolean
}

export function TranscriptPane({ turns, live, finding }: TranscriptPaneProps) {
  const [needle, setNeedle] = useState('')
  const box = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  /*
   * Stuck to the bottom unless the rep has scrolled up — a log, not a document.
   * Read before the paint that adds the row, applied after it, so a rep reading
   * back at minute nine is not yanked to the end every twelve seconds.
   */
  const stuck = useRef(true)

  useEffect(() => {
    if (finding) box.current?.focus()
    else setNeedle('')
  }, [finding])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stuck.current) element.scrollTop = element.scrollHeight
  }, [turns.length])

  const trimmed = needle.trim()
  const matches = useMemo(() => {
    const folded = normalizeForVerification(trimmed)
    if (folded === '') return new Set<string>()
    return new Set(
      turns.filter((turn) => normalizeForVerification(turn.text).includes(folded)).map((t) => t.id),
    )
  }, [turns, trimmed])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {finding ? (
        <div className="shrink-0 px-4 pb-2">
          <input
            ref={box}
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Chercher dans l’appel…"
            aria-label="Chercher dans l’appel"
            className="border-card bg-card text-body min-h-[24px] w-full rounded-sm border px-2 py-1 text-ui"
          />
          {trimmed === '' ? null : (
            <p role="status" className="text-muted mt-1 text-meta">
              {matches.size === 0
                ? 'Aucune prise de parole ne contient ce mot.'
                : `${matches.size} prise${matches.size > 1 ? 's' : ''} de parole surlignée${
                    matches.size > 1 ? 's' : ''
                  }.`}
            </p>
          )}
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
      >
        {turns.length === 0 ? (
          /*
            Not « rien n'a été entendu » — that is the dry run's verdict about a
            broken machine, and this is the ordinary first thirty seconds of a
            call. The sentence says what is being waited for.
          */
          <p className="text-muted text-ui">
            {live
              ? 'La transcription apparaît ici dès la première prise de parole.'
              : 'Aucune prise de parole n’a été transcrite pendant cet appel.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {turns.map((turn) => {
              const found = matches.has(turn.id)
              return (
                <li
                  key={turn.id}
                  className={`flex gap-2 rounded-sm py-1 ${
                    found ? 'border-brand-500 border-l-2 pl-1.5' : ''
                  }`}
                >
                  {/*
                    The same two columns the reader in *Historique* draws — 40 and
                    48 — so a rep reading a call back three weeks later meets the
                    shape they read it in live. Changing one without the other is
                    two screens printing the same turn differently.
                  */}
                  <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                    {formatOffset(turn.startMs)}
                  </span>
                  <span className="text-muted w-12 shrink-0 text-meta leading-relaxed">
                    {speakerLabel(turn.channel, [])}
                  </span>
                  <span
                    className={`min-w-0 flex-1 text-ui leading-relaxed ${
                      found ? 'text-strong' : 'text-body'
                    }`}
                  >
                    {turn.text}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/*
        DEC-5, stated on the one surface where a rep might doubt it. It is not
        the permanent promise `SignalRail` dropped: this column is opt-in, the
        rep has just turned a live transcript on beside their own document, and
        « will this end up in my notes » is the first thing they will wonder.
      */}
      <p className="text-muted border-subtle shrink-0 border-t px-4 py-2 text-meta">
        Le texte n’entre jamais dans vos notes.
      </p>
    </div>
  )
}

/** The header's find control — exported so `LiveAside` can put it in its row. */
export function FindGlyph({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Chercher dans la transcription"
      onClick={onToggle}
      className={`inline-flex size-6 items-center justify-center rounded-sm transition ${
        on ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-subtle hover:text-body'
      }`}
    >
      <Search aria-hidden size={14} strokeWidth={2} />
    </button>
  )
}
