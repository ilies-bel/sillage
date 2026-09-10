/**
 * The transcript, at the gate, opened on the line a citation came from.
 *
 * ## Why the gate has a transcript at all
 *
 * DEC-21 says confidence is *measured*: every interpretive field cites a span
 * and the app checks the span really occurs in the stored transcript. The gate
 * has always said so — `⚠ faible`, and a `source ▸` that opens the quote — but
 * a rep who wanted to know *what was actually said around it* had nowhere to
 * go. « TJM 2025 jugé trop haut par les achats » is a sentence somebody is
 * about to send to a CRM under their own name, and the evidence for it was a
 * fragment with no context and no way to reach any.
 *
 * So `source ▸` now leads somewhere. The cited line is found in the record,
 * highlighted, scrolled to, and drawn with the conversation either side of it.
 *
 * ## What it is not
 *
 * **Not the live transcript pane DEC-38 removed.** That one ran during a call,
 * as proof of life, and it was bad at that job: seconds late, blank through
 * every pause, identical whether the room was quiet or the microphone was. The
 * input meter took that job. This is the record *afterwards*, on a screen the
 * meeting has already ended on, opened deliberately by a rep checking a claim.
 * Nothing here streams and nothing here appears while the meeting is recording
 * — `review:get` answers with no panel at all in that state.
 *
 * **Not filtered.** `channelBleed.ts` drops the rep's duplicate copy of the far
 * end before the *model* reads it (DEC-41), and must not run here: a rep
 * hunting for a quote has to be able to find it wherever it was said, and the
 * verification ran against these rows unfiltered.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { TranscriptSegment } from '../../../electron/core/contracts/transcript.ts'
import { useInvoke } from '../../app/bridge.ts'
import { formatOffset } from '../../app/format.ts'
import { Centered } from '../../ui/index.ts'
import { scrollToCenter } from '../../lib/scroll.ts'

export interface TranscriptFocus {
  /** The cited fragment, verbatim. What `spanVerification.ts` matched. */
  quote: string
  /** The field it was cited for, so the reader can say what it is showing. */
  label: string
}

interface TranscriptReaderProps {
  meetingId: string
  /** Which citation to open on, or null for the top of the call. */
  focus: TranscriptFocus | null
}

/** `Moi` / `Client`, the same two words the transcript uses in Historique. */
const SPEAKER: Record<TranscriptSegment['channel'], string> = { rep: 'Moi', far: 'Client' }

export function TranscriptReader({ meetingId, focus }: TranscriptReaderProps) {
  const loaded = useInvoke('review:transcript', { meetingId })
  const segments = loaded.state.status === 'ready' ? loaded.state.value.segments : null

  /*
   * Which segment the citation lands in.
   *
   * Substring, and deliberately the same test `spanVerification.ts` uses — if
   * the quote verified, exactly this will find it. A quote that does *not*
   * match is the `⚠ faible` case, and the reader says so rather than silently
   * opening at the top, because « we could not find this » is the finding.
   */
  const hit = useMemo(() => {
    if (!segments || !focus) return null
    return segments.find((segment) => segment.text.includes(focus.quote)) ?? null
  }, [segments, focus])

  const hitRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    scrollToCenter(hitRef.current)
  }, [hit])

  if (loaded.state.status === 'failed') {
    return (
      <Centered>
        <p className="text-danger text-ui">{loaded.state.reason}</p>
      </Centered>
    )
  }
  if (!segments) return <Centered>Chargement…</Centered>

  if (segments.length === 0) {
    return (
      <Centered>
        <p className="text-ui">Aucune transcription n’a été enregistrée pour cet appel.</p>
      </Centered>
    )
  }

  return (
    <div>
      {/*
        What the reader is showing, before the reader. Opened from a citation it
        names the field; opened cold it says how long the call was — and when the
        quote is nowhere in the record, it says *that*, which is the same fact
        the `⚠ faible` on the row is stating and is worth repeating here rather
        than leaving the rep to scroll looking for something that is not there.
      */}
      <p className="text-muted border-subtle mb-3 border-b pb-2 text-meta">
        {/*
          « du champ « X » » rather than « de X ». The field labels are data —
          *Objections*, *Objet*, *Étape* — and French elides `de` before a vowel,
          so interpolating one produced « la citation de objections ». Naming the
          field in guillemets sidesteps the elision entirely and reads better:
          the rep is looking at a row called *Objections*, not at a noun.
        */}
        {focus === null ? (
          `${segments.length} prises de parole · ${formatOffset(segments[segments.length - 1]!.endMs)}`
        ) : hit ? (
          <>
            Citation du champ <span className="text-body">« {focus.label} »</span>, à{' '}
            <span className="tabular-nums">{formatOffset(hit.startMs)}</span>.
          </>
        ) : (
          <span className="text-warn">
            La citation du champ « {focus.label} » est introuvable dans la transcription.
          </span>
        )}
      </p>

      <ul className="space-y-2">
        {segments.map((segment) => {
          const cited = segment === hit
          return (
            <li
              key={segment.id}
              ref={cited ? hitRef : undefined}
              className={`flex gap-3 rounded-sm px-2 py-1 ${cited ? 'bg-brand-50' : ''}`}
            >
              <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                {formatOffset(segment.startMs)}
              </span>
              <span className="text-muted w-12 shrink-0 text-meta leading-relaxed">
                {SPEAKER[segment.channel]}
              </span>
              {/*
                The cited line in `--text-strong` rather than a second tint: the
                row already carries the wash, and colour is never asked to be the
                only signal in this product.
              */}
              <span
                className={`min-w-0 flex-1 text-ui leading-relaxed ${
                  cited ? 'text-strong' : 'text-body'
                }`}
              >
                {segment.text}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
