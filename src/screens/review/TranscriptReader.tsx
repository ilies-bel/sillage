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
import { speakerLabel, type TranscriptSegment } from '../../../electron/core/contracts/transcript.ts'
import { useInvoke } from '../../app/bridge.ts'
import { formatOffset } from '../../app/format.ts'
import { Centered, CopyButton } from '../../ui/index.ts'
import { scrollToCenter } from '../../lib/scroll.ts'

export interface TranscriptFocus {
  /** The cited fragment, verbatim. What `spanVerification.ts` matched. */
  quote: string
  /** The field it was cited for, so the reader can say what it is showing. */
  label: string
  /**
   * Which surface asked for it.
   *
   * The header names what it is showing, and « Citation du champ « client » »
   * is not what a quote under an answer from *Demander* is — it came from a
   * sentence the rep asked for, not from a row of the form. Defaulted, so every
   * existing call site keeps the wording it had.
   */
  from?: 'field' | 'answer'
}

interface TranscriptReaderProps {
  meetingId: string
  /** Which citation to open on, or null for the top of the call. */
  focus: TranscriptFocus | null
  /**
   * The client-side people, from the calendar. Names the far channel when
   * there is exactly one of them — `speakerLabel`, and the same rule the
   * reader in *Historique* follows, because two screens naming the same turn
   * differently is two things for a rep to reconcile.
   */
  interlocuteurs: readonly { name: string; email: string }[]
}

/** Accents and case folded, so « Achats » and « achats » are one term. */
const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr')

/**
 * The transcript as plain text, for the clipboard — the same three columns the
 * reader draws, tab-separated, so a paste into a document keeps them as columns
 * and a paste into a chat still reads as a dialogue.
 */
const transcriptText = (
  segments: readonly TranscriptSegment[],
  interlocuteurs: readonly { name: string; email: string }[],
): string =>
  segments
    .map((s) => `${formatOffset(s.startMs)}\t${speakerLabel(s.channel, interlocuteurs)}\t${s.text}`)
    .join('\n')

export function TranscriptReader({ meetingId, focus, interlocuteurs }: TranscriptReaderProps) {
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
  const [picked, setPicked] = useState<string | null>(null)
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    const quote = focus?.quote ?? null
    // `segments` first: until the record has arrived, *every* citation looks
    // unmatched, and seeding on that would put the quote in the box even for
    // the ones that verify.
    if (quote === null || segments === null || seeded.current === quote) return
    seeded.current = quote
    // Only when the citation failed — a verified one is already pointed at, and
    // a search box that pre-filled itself over a hit would be noise.
    setNeedle(hit === null ? quote : '')
  }, [focus, hit, segments])

  const trimmed = needle.trim().toLowerCase()
  const matches = useMemo(() => {
    if (trimmed === '' || !segments) return new Set<string>()
    return new Set(
      segments.filter((s) => s.text.toLowerCase().includes(trimmed)).map((s) => s.id),
    )
  }, [segments, trimmed])

  /**
   * **The passages a human would have accepted**, ranked, when the citation is
   * nowhere in the record.
   *
   * This offered *words* before: content tokens of the failed query that occur
   * somewhere in the call, longest first, as chips. On the fixture it was right
   * and useless. The quote « la grille achats plafonne à 550 » produced exactly
   * one chip, « achats » — « 550 » was below the four-character floor even
   * though it is the most discriminating token in the sentence — and the line a
   * rep accepts in two seconds, « votre TJM de l'an dernier était un peu haut
   * pour nos achats », was never surfaced at all. A word is not what the rep is
   * looking for; a moment in the call is.
   *
   * So the unit is the segment, scored by how much of the query it carries:
   *
   *  · a term is a run of letters of three or more, or a run of digits of two
   *    or more — which is what lets « 550 » and « 2027 » count, and they are
   *    usually the terms that settle it;
   *  · each term is weighted by `log(N / df)`, so a word in most of the call
   *    contributes almost nothing and a word in one line dominates. That is an
   *    inverse-frequency weight and not a stop-list, because the words worth
   *    ignoring are a property of *this* call — « data » is noise in a data
   *    meeting and a strong signal in any other;
   *  · a term in more than a third of the segments is dropped outright.
   *
   * Three at most, and labelled as candidates rather than as an answer: the
   * whole reason this panel exists is that the app could not verify the quote,
   * and a ranked guess must not be dressed as a verification (DEC-21).
   */
  const candidates = useMemo(() => {
    if (!segments || matches.size > 0 || trimmed === '') return []

    const termsOf = (text: string): string[] =>
      fold(text).match(/\p{L}{3,}|\d{2,}/gu) ?? []

    const wanted = [...new Set(termsOf(trimmed))]
    if (wanted.length === 0) return []

    const bag = segments.map((segment) => ({ segment, terms: new Set(termsOf(segment.text)) }))
    const total = bag.length

    const weight = new Map<string, number>()
    for (const term of wanted) {
      const df = bag.filter((entry) => entry.terms.has(term)).length
      /*
       * Absent, or so common in this call that it separates nothing.
       *
       * `max(2, …)` and not a bare third: a term has to be in at least three
       * turns before « common » means anything. A short record makes every term
       * exceed a third of it — on a two-segment transcript a word in one segment
       * is fifty per cent — and the cut then threw away the whole query and
       * offered the rep nothing at all, which is the dead end this exists to
       * end.
       */
      if (df === 0 || df > Math.max(2, total / 3)) continue
      weight.set(term, Math.log(total / df))
    }
    if (weight.size === 0) return []

    return bag
      .map(({ segment, terms }) => {
        let score = 0
        for (const [term, w] of weight) if (terms.has(term)) score += w
        return { segment, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.segment.startMs - b.segment.startMs)
      .slice(0, 3)
      .map((entry) => entry.segment)
  }, [segments, matches, trimmed])

  const hitRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    scrollToCenter(hitRef.current)
  }, [hit])

  /*
   * The candidate the rep chose, if any. It is *marked*, not confirmed — the
   * same left rule a search match wears, never the citation's wash: the app
   * failed to verify this quote and a ranked guess that borrowed the verified
   * treatment would be the one lie this screen exists to prevent (DEC-21).
   */
  const pickedRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    scrollToCenter(pickedRef.current)
  }, [picked])

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
            {focus.from === 'answer' ? (
              <>Extrait cité par la réponse, à </>
            ) : (
              <>
                Citation du champ <span className="text-body">« {focus.label} »</span>, à{' '}
              </>
            )}
            <span className="tabular-nums">{formatOffset(hit.startMs)}</span>.
          </>
        ) : (
          <span className="text-warn">
            {focus.from === 'answer'
              ? 'Cet extrait est introuvable dans la transcription.'
              : `La citation du champ « ${focus.label} » est introuvable dans la transcription.`}
          </span>
        )}
      </p>
      {/*
        The record, takeable. Historique's copy of this same transcript has had
        a *Copier* since it was drawn; the gate's did not, which made the same
        artefact behave differently one screen apart.
      */}
      <CopyButton text={transcriptText(segments, interlocuteurs)} what="la transcription" />
      </div>

      {/*
        **Who « Client » can be** (DEC-47, DEC-7).

        The far channel is labelled by side and never by person: the hardware
        measures which channel a turn arrived on, and *which of two people spoke*
        is a guess this product does not make — there is no diarisation, and no
        amount of plausibility makes « Élodie » true of a turn Marc took. With
        one interlocutor the calendar settles it and `speakerLabel` prints the
        first name; with two it prints « Client », correctly, and a rep reading a
        column of them has lost something the app *does* know: who was on that
        side of the call.
        So it is stated once, here, as the fact it is — the calendar's attendee
        list — rather than smuggled into a column where it would read as an
        attribution. The rep can tell « the buyer or the technician » apart from
        the words; they could not tell it apart from nothing.
      */}
      {interlocuteurs.length > 1 ? (
        <p className="text-muted mb-3 text-meta">
          Côté client&nbsp;: {interlocuteurs.map((person) => person.name).join(', ')}. Les tours
          sont attribués au canal, jamais à une personne.
        </p>
      ) : null}

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
        nothing — that is why the rep is here. « Essayez un mot seul » was the
        right instruction and still a chore: the rep has to guess which word.
        The app can compute it. Each candidate is a word of the failed quote
        that *does* occur in the record, longest first — the longest word is the
        most specific — so the dead end ends in a tap.

        Content words only: a quote that failed on « la grille achats plafonne à
        550 » must not offer « la » as a lead.
      */}
      {trimmed !== '' && matches.size === 0 ? (
        <div className="border-subtle bg-inner mb-3 rounded-sm border p-2">
          <p className="text-muted text-meta">
            {candidates.length === 0
              ? 'Aucun passage ne contient cette phrase, ni aucun de ses termes.'
              : 'Aucun passage ne contient cette phrase. Les plus proches, à vérifier :'}
          </p>
          {candidates.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {candidates.map((segment) => (
                <li key={segment.id}>
                  {/*
                    A whole row, not a chip: the rep is choosing between moments
                    of the call, so the thing they press has to be the moment —
                    its time, who was speaking, and enough of the sentence to
                    recognise it. Pressing it goes there and marks it, and the
                    mark is the *search* rule and never the citation wash, because
                    this is a candidate and the app has not verified anything
                    (DEC-21).
                  */}
                  <button
                    type="button"
                    onClick={() => setPicked(segment.id)}
                    className="hover:bg-subtle flex w-full gap-2 rounded-sm px-1 py-0.5 text-left transition"
                  >
                    <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                      {formatOffset(segment.startMs)}
                    </span>
                    <span className="text-body min-w-0 flex-1 text-ui leading-relaxed">
                      {segment.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-2">
        {segments.map((segment) => {
          const cited = segment === hit
          const found = matches.has(segment.id) || segment.id === picked
          return (
            <li
              key={segment.id}
              ref={cited ? hitRef : segment.id === picked ? pickedRef : undefined}
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
                {speakerLabel(segment.channel, interlocuteurs)}
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
