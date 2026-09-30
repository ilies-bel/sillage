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
import {
  locateSegments,
  normalizeForVerification,
  speakerLabel,
  type TranscriptSegment,
} from '../../../electron/core/contracts/transcript.ts'
import { useInvoke } from '../../app/bridge.ts'
import { formatOffset, formatTime } from '../../app/format.ts'
import { interleaveMarks } from '../../../electron/core/contracts/marks.ts'
import { Centered, CopyButton } from '../../ui/index.ts'
import { scrollToCenter } from '../../lib/scroll.ts'

export interface TranscriptFocus {
  /** The cited fragment, verbatim. What `spanVerification.ts` matched. */
  quote: string
  /**
   * The side the span claims, when the caller has one.
   *
   * Passed to the same `locateSegments` the gate verified with, so the reader
   * lands on the turn the verification landed on. Without it the search is
   * rep-first — and on a laptop with open speakers the microphone hears the far
   * end too (DEC-41, measured at 24 of 38 rep segments), so a client's sentence
   * would be found on the rep's echo and highlighted under « Moi ».
   */
  channel?: 'rep' | 'far' | null
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
  /**
   * Fired once the record has arrived — or failed to.
   *
   * The gate's arming guard is keyed by *what the column is showing*, and until
   * this fires what it is showing is a placeholder. Six hundred and fifty-nine
   * pixels of it, which fits a 1280×800 column entirely, so the guard recorded
   * the view as read before the transcript existed. `Review.tsx` uses this to
   * keep « chargement » and « the record » two different views, which is what
   * they are.
   *
   * It fires on failure too, and it has to: what is on screen then is the error
   * sentence, the rep has seen all of it, and refusing to count that would be a
   * gate a failed fetch could wedge shut.
   */
  onLoaded?: () => void
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

export function TranscriptReader({
  meetingId,
  focus,
  interlocuteurs,
  onLoaded,
}: TranscriptReaderProps) {
  const loaded = useInvoke('review:transcript', { meetingId })
  const settled = loaded.state.status !== 'loading'
  const announced = useRef(false)
  useEffect(() => {
    if (!settled || announced.current) return
    announced.current = true
    onLoaded?.()
  }, [settled, onLoaded])
  const segments = loaded.state.status === 'ready' ? loaded.state.value.segments : null
  const marks = loaded.state.status === 'ready' ? loaded.state.value.marks : []

  /*
   * Which segment the citation lands in — **the gate's own search, not a second
   * one that agrees with it most of the time.**
   *
   * This was `segments.find((s) => s.text.includes(focus.quote))` under a
   * comment saying it was « deliberately the same test `spanVerification.ts`
   * uses — if the quote verified, exactly this will find it ». It was not the
   * same test in four ways, and each of them is ordinary:
   *
   *     accent lost by the STT    gate: verified   reader: introuvable
   *     typographic apostrophe    gate: verified   reader: introuvable
   *     trailing full stop        gate: verified   reader: introuvable
   *     quote spanning two turns  gate: verified   reader: introuvable
   *
   * The gate matches over a normalised, channel-joined haystack; this matched
   * raw, inside one segment — so the last case failed by construction for every
   * quote the join exists to bridge, and the accent case is the one
   * `normalizeForVerification` names as routine French STT behaviour. A rep
   * pressed `[source ▸]` on a row the app had just certified and landed on « Cet
   * extrait est introuvable dans la transcription », which is this product's one
   * advantage over a general-purpose notetaker calling its own evidence
   * fabricated.
   *
   * `locateSegments` moved into `contracts` so there is one search
   * (`src/*` may import nothing else). A quote that genuinely is *not* in the
   * record is still the `⚠ faible` case and still says so.
   */
  const hit = useMemo(() => {
    if (!segments || !focus) return null
    return locateSegments(focus.quote, segments, focus.channel ?? null)[0] ?? null
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

  const trimmed = needle.trim()
  /*
   * The same folding as the lookup above, for the same reason: a rep who lands
   * here because a quote with an accent did not match would type the accent and
   * find nothing either. `normalizeForVerification` is what both ends of this
   * screen agree on.
   */
  const matches = useMemo(() => {
    const folded = normalizeForVerification(trimmed)
    if (folded === '' || !segments) return new Set<string>()
    return new Set(
      segments
        .filter((s) => normalizeForVerification(s.text).includes(folded))
        .map((s) => s.id),
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

  // The rep's own marks survive a call that produced no transcript — see the
  // same rule in *Historique*'s reader. The sentence is still said; it is just
  // no longer the only thing on the screen.
  if (segments.length === 0 && marks.length === 0) {
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
      <div className="border-subtle mb-inline flex items-baseline gap-inline border-b pb-snug">
      {/*
        `.measure` on the paragraph, for the reason the one below it carries: `ch` resolves
        against the element's own size, so a `--type-meta` line in a column sized for
        `--type-copy` runs long. This one names the citation the rep is following, or says
        it is not in the record — 88 characters a line, measured.
      */}
      <p className="text-muted measure min-w-0 flex-1 text-meta">
        {/*
          « du champ « X » » rather than « de X ». The field labels are data —
          *Objections*, *Objet*, *Étape* — and French elides `de` before a vowel,
          so interpolating one produced « la citation de objections ». Naming the
          field in guillemets sidesteps the elision entirely and reads better:
          the rep is looking at a row called *Objections*, not at a noun.
        */}
        {focus === null ? (
          // Zero is reachable now that a call with marks and no transcript
          // opens this reader at all: the last segment's end is the length of
          // the call, and there is no last segment.
          segments.length === 0 ? (
            'Aucune transcription — seuls vos moments marqués sont ci-dessous.'
          ) : (
            // Zero is handled on the line above; one was not, and a one-turn
            // call read « 1 prises de parole ». Every other `${n} <noun>s` in
            // this tree branches (`pushWords.ts`, `Widget`'s mark button,
            // `Valider malgré N champ(s)`); this was the one that did not.
            `${segments.length} prise${segments.length > 1 ? 's' : ''} de parole · ${formatOffset(segments[segments.length - 1]!.endMs)}`
          )
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
      {/*
        `ml-auto`, because `.measure` on the paragraph beside it stopped the row being
        filled. That paragraph is `flex-1`, so it used to push this button to the row's
        right edge; capping it at `58ch` left the button floating **sixty pixels** inside a
        `border-b` that still runs the full width (41 at 960×600, measured). The prose stays
        capped — it was 88 characters a line — and the control goes back to the end of the
        rule it belongs to. None of the eight measured checks can see a mis-aligned button,
        which is why applying `--prose`'s remedy to seven surfaces needed measuring too.
      */}
      <CopyButton
        text={transcriptText(segments, interlocuteurs)}
        what="la transcription"
        className="ml-auto"
      />
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
        <p className="text-muted measure mb-inline text-meta">
          Côté client&nbsp;: {interlocuteurs.map((person) => person.name).join(', ')}. Les tours
          sont attribués au canal, jamais à une personne.
        </p>
      ) : null}

      <div className="mb-inline flex items-baseline gap-inline">
        <input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          aria-label="Rechercher dans la transcription"
          placeholder="Rechercher dans la transcription…"
          className="text-strong placeholder:text-muted bg-inner border-subtle min-w-0 flex-1 rounded-sm border px-snug py-hair text-ui"
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
        <div className="border-subtle bg-inner mb-inline rounded-sm border p-snug">
          <p className="text-muted measure text-meta">
            {candidates.length === 0
              ? 'Aucun passage ne contient cette phrase, ni aucun de ses termes.'
              : 'Aucun passage ne contient cette phrase. Les plus proches, à vérifier :'}
          </p>
          {candidates.length > 0 ? (
            <ul className="mt-tight space-y-hair">
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
                    className="hover:bg-subtle flex w-full gap-snug rounded-sm px-hair py-hair text-left transition"
                  >
                    <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                      {formatOffset(segment.startMs)}
                    </span>
                    <span className="text-body measure min-w-0 flex-1 text-ui leading-relaxed">
                      {segment.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/*
        **The rep's own marks, in place** (`core/contracts/marks.ts`).

        Made during the call, from the widget floating over it, and read here —
        which is the point of making them at all. `interleaveMarks` is shared
        with the widget's own live list, so the moment a rep marked at 14:32 is
        in the same place on both surfaces.

        Interleaved rather than listed above: a mark is a *position in the
        conversation*, and a list of them at the top of the reader would be five
        bookmarks with nothing to point at — the rep would have to find the turn
        again, which is the work the mark was made to save.
      */}
      <ul className="space-y-snug">
        {interleaveMarks(segments, marks).map((row) => {
          if (row.kind === 'mark') {
            return (
              <li key={row.key} className="flex gap-inline px-snug">
                <span className="text-brand-700 w-10 shrink-0 tabular-nums text-meta font-semibold leading-relaxed">
                  {formatTime(row.mark.at)}
                </span>
                <span className="text-brand-700 w-12 shrink-0 text-meta font-semibold leading-relaxed">
                  marqué
                </span>
                <span className="text-strong border-brand-500 min-w-0 flex-1 border-l-2 pl-snug text-ui leading-relaxed">
                  {row.mark.note === ''
                    ? /*
                        A mark with no note is not an empty mark — the rep pressed
                        a button during a call, which is a statement about this
                        moment and nothing else. Saying so is better than drawing
                        a blank line, and better than inventing a summary of what
                        they might have meant.
                      */
                      'Marqué pendant l’appel.'
                    : row.mark.note}
                </span>
              </li>
            )
          }
          const segment = row.segment
          const cited = segment === hit
          const found = matches.has(segment.id) || segment.id === picked
          return (
            <li
              key={row.key}
              ref={cited ? hitRef : segment.id === picked ? pickedRef : undefined}
              /*
                Two marks, and they are different things: the wash is *the
                citation*, the rule is *what the rep is looking for*. A search
                that reused the wash would make a match indistinguishable from a
                verified span, on the screen whose whole job is that distinction.
              */
              className={`flex gap-inline rounded-sm px-snug py-hair ${cited ? 'bg-brand-50' : ''} ${
                found && !cited ? 'border-brand-500 border-l-2 pl-tight' : ''
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
