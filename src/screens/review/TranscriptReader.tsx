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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptSegment } from '../../../electron/core/contracts/transcript.ts'
import { useInvoke } from '../../app/bridge.ts'
import { formatOffset } from '../../app/format.ts'
import { Centered, CopyButton } from '../../ui/index.ts'
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

/**
 * The transcript as plain text, for the clipboard — the same three columns the
 * reader draws, tab-separated, so a paste into a document keeps them as columns
 * and a paste into a chat still reads as a dialogue.
 */
const transcriptText = (segments: readonly TranscriptSegment[]): string =>
  segments
    .map((s) => `${formatOffset(s.startMs)}\t${SPEAKER[s.channel]}\t${s.text}`)
    .join('\n')

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

  /*
   * The way out of « introuvable ».
   *
   * Saying the citation is not in the record is the honest half; leaving the
   * rep at 0:04 of a twenty-minute call with nowhere to go is the other half,
   * and it was missing. The claim is usually *in* there — paraphrased, split
   * across two turns, said in different words — and finding it was a read.
   *
   * So the box opens carrying the quote that did not match, and every segment
   * containing what is typed is marked. It filters nothing: the context either
   * side is the reason a rep came here rather than to the field.
   */
  const [needle, setNeedle] = useState('')
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    const quote = focus?.quote ?? null
    if (quote === null || seeded.current === quote) return
    seeded.current = quote
    // Only when the citation failed — a verified one is already pointed at, and
    // a search box that pre-filled itself over a hit would be noise.
    setNeedle(hit === null ? quote : '')
  }, [focus, hit])

  const trimmed = needle.trim().toLowerCase()
  const matches = useMemo(() => {
    if (trimmed === '' || !segments) return new Set<string>()
    return new Set(
      segments.filter((s) => s.text.toLowerCase().includes(trimmed)).map((s) => s.id),
    )
  }, [segments, trimmed])

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
      <div className="border-subtle mb-3 flex items-baseline gap-inline border-b pb-2">
      <p className="text-muted min-w-0 flex-1 text-meta">
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
      {/*
        The record, takeable. Historique's copy of this same transcript has had
        a *Copier* since it was drawn; the gate's did not, which made the same
        artefact behave differently one screen apart.
      */}
      <CopyButton text={transcriptText(segments)} what="la transcription" />
      </div>

      <div className="mb-3 flex items-baseline gap-inline">
        <input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          aria-label="Rechercher dans la transcription"
          placeholder="Rechercher dans la transcription…"
          className="text-strong placeholder:text-muted bg-inner border-subtle min-w-0 flex-1 rounded-sm border px-2 py-1 text-ui"
        />
        {trimmed === '' ? null : (
          <span className={`shrink-0 text-meta ${matches.size === 0 ? 'text-warn' : 'text-muted'}`}>
            {matches.size === 0
              ? 'aucun passage'
              : `${matches.size} passage${matches.size > 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {/*
        The box opens on the whole cited sentence, which by definition matches
        nothing — that is why the rep is here. Saying what to do about it costs
        one line and saves a rep reading twenty minutes of transcript: a claim
        that failed verification is usually in the call, paraphrased or split
        across two turns, and one word finds it.
      */}
      {trimmed !== '' && matches.size === 0 ? (
        <p className="text-muted mb-3 text-meta">
          Aucun passage ne contient cette phrase telle quelle — essayez un mot seul.
        </p>
      ) : null}

      <ul className="space-y-2">
        {segments.map((segment) => {
          const cited = segment === hit
          const found = matches.has(segment.id)
          return (
            <li
              key={segment.id}
              ref={cited ? hitRef : undefined}
              /*
                Two marks, and they are different things: the wash is *the
                citation*, the rule is *what the rep is looking for*. A search
                that reused the wash would make a match indistinguishable from a
                verified span, on the screen whose whole job is that distinction.
              */
              className={`flex gap-3 rounded-sm px-2 py-1 ${cited ? 'bg-brand-50' : ''} ${
                found && !cited ? 'border-brand-500 border-l-2 pl-1.5' : ''
              }`}
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
                  cited || found ? 'text-strong' : 'text-body'
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
