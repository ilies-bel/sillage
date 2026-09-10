/**
 * *Demander* — a question about this call, answered from this call's record.
 *
 * ## What it is for
 *
 * A rep three weeks later remembers that the client said something about the
 * grille achats and cannot remember what. The compte-rendu has a paragraph on
 * it; the transcript has forty minutes. Neither answers « à partir de quand ? »
 * in one gesture. This does.
 *
 * ## Why it looks like this
 *
 * **The answer is never alone.** Every one arrives with the fragments it leans
 * on, and each fragment says whether the app found it in the recording (DEC-21).
 * That is the whole difference between this and the ask box on a general-purpose
 * notetaker: theirs answers from a document the model itself wrote, so a mistake
 * in the summary becomes a mistake in the answer with nothing left to check it
 * against. A rep can press a citation here and land on the second of the call it
 * came from.
 *
 * **An unverified quote is shown, not hidden.** `askAnswer.ts` keeps a quote it
 * could not find and marks it, and this draws the mark in `--warn` with the
 * reason spelled out. Dropping it would leave a confident paragraph with one
 * fewer footnote and nothing on screen saying anything had gone wrong — which is
 * exactly the failure DEC-21 exists to make visible.
 *
 * **It confirms nothing and writes nothing** (DEC-4, DEC-5). No answer touches
 * the rep's notes, the compte-rendu, or VerySwing, and none is stored: it is a
 * read over the log, like *Historique* (DEC-25).
 *
 * **Each question is asked alone; the panel keeps what came back.** Nothing of
 * the previous exchange is sent with the next one — a thread would need history,
 * a token budget and a summariser, none of which makes the first question better
 * answered, and DEC-21 verifies each quote against the transcript, not against
 * what the model said a minute ago. But the *screen* stacks the answers, newest
 * first. Replacing them meant a rep who asked « et le TJM ? » lost the answer
 * about the timeline they had asked ten seconds earlier and had not finished
 * reading, with no way back to it — the panel stores nothing, so the only copy
 * was the one on screen.
 *
 * **It is not on screen during the call** (DEC-23). The caller decides that;
 * this component is simply never mounted then.
 */
import { useState } from 'react'
import type { AskAnswer } from '../../../electron/core/contracts/ask.ts'
import { speakerLabel } from '../../../electron/core/contracts/transcript.ts'
import { invoke } from '../../app/bridge.ts'
import { formatOffset } from '../../app/format.ts'
import { Button, unavailable } from '../../ui/index.ts'

export interface AskPanelProps {
  meetingId: string
  /**
   * Open the transcript on a citation. Optional: on a surface that has no
   * transcript beside it the quote is still shown, just not followable — the
   * citation is worth having either way.
   */
  onLocate?: (quote: string, label: string) => void
  /**
   * The client-side people, from the calendar. A citation's `label` is what the
   * reader is opened on, and `speakerLabel` names the far channel when there is
   * exactly one of them — the same rule the two transcript surfaces follow.
   * Absent on a surface that has no attendee list to hand, where « Client » is
   * the correct answer anyway.
   */
  interlocuteurs?: readonly { name: string; email: string }[]
  /**
   * **The panel is pinned in a fixed column, so its answers scroll inside it.**
   *
   * On the session screen this sits under the compte-rendu in a flex column
   * that does not grow: an unbounded answer list pushed the document down to
   * its heading and one line of « Résumé », so asking a question cost the rep
   * the thing they were asking about. Bounded, the panel takes a share of the
   * column and the answers scroll within it.
   *
   * At the gate the opposite is right and this stays off: the whole column
   * already scrolls, so the answers simply extend it — a scroller inside a
   * scroller would give a rep two wheels over one region and hide the end of an
   * answer behind an inner edge they cannot see.
   */
  pinned?: boolean
  className?: string
}

/**
 * Three questions a rep actually asks, offered as one tap on an empty panel.
 *
 * Not a feature list and not a demo script: an empty text field with a
 * placeholder is a surface where the honest reaction is « what can I ask it »,
 * and answering that with prose costs a paragraph nobody reads. Three real
 * questions answer it in the only way that generalises — by being asked.
 */
const SUGGESTIONS = [
  'Qu’est-ce qui bloque côté client ?',
  'Qu’est-ce qui a été dit sur le TJM ?',
  'Qui décide, et quand ?',
]

export function AskPanel({
  meetingId,
  onLocate,
  pinned = false,
  interlocuteurs = [],
  className,
}: AskPanelProps) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  /** Newest first. The panel's only memory, and it never leaves the screen. */
  const [answers, setAnswers] = useState<readonly AskAnswer[]>([])
  const [asked, setAsked] = useState<readonly string[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  const ask = async (question: string) => {
    const trimmed = question.trim()
    if (trimmed === '' || busy) return

    setBusy(true)
    setFailure(null)
    /*
     * The box empties as the question is sent. It used to keep the text, so the
     * rep's question was on screen twice — once in the field they had stopped
     * looking at and once above the answer, where it belongs and where it stays
     * as the answers stack.
     */
    setQuestion('')
    setAsked((before) => [...before, trimmed])
    try {
      const answer = await invoke('meeting:ask', { meetingId, question: trimmed })
      setAnswers((before) => [answer, ...before])
    } catch (error) {
      // The main process's own French sentence — « aucun modèle de langage
      // n'est configuré… », « la réunion est en cours… ». Never a stack, and
      // never a generic « une erreur est survenue » that hides which (DEC-26).
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const remaining = SUGGESTIONS.filter((suggestion) => !asked.includes(suggestion))

  return (
    <section
      className={
        pinned ? `ask flex min-h-0 flex-col ${className ?? ''}` : `ask ${className ?? ''}`
      }
    >
      <form
        className="flex shrink-0 items-center gap-inline"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(question)
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          aria-label="Poser une question sur cet appel"
          placeholder="Poser une question sur cet appel…"
          className="text-strong placeholder:text-muted bg-inner border-card min-w-0 flex-1 rounded-sm border px-2 py-1.5 text-ui"
        />
        {/*
          Disabled only while a question is in flight — never for an empty box.

          `unavailable` renders its reason on screen, which is right (DEC-26) and
          was wrong here: on a panel the rep has not touched yet it printed
          « Écrivez une question » under the button, telling them off before they
          had done anything. An empty submit is not a refusal, it is a no-op, and
          `ask` already returns on a blank string.
        */}
        <Button
          type="submit"
          variant="primary"
          {...unavailable(busy, 'Question en cours')}
        >
          {busy ? 'Recherche…' : 'Demander'}
        </Button>
      </form>

      {/*
        The ones not yet asked, and they stay until they run out.

        They used to vanish for good on the first question, which read as the
        panel having spent what it had — a rep who asked one thing and wondered
        what else it could do got a blank row where the ideas had been. Filtering
        by what has been asked keeps the offer honest without ever repeating one.
      */}
      {failure === null && !busy && remaining.length > 0 ? (
        <ul className="ask-suggestions mt-2 flex shrink-0 flex-wrap gap-1.5">
          {remaining.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(suggestion)
                  void ask(suggestion)
                }}
                // `min-h-[24px]`, WCAG 2.2 target size: `py-0.5` around
                // `--type-meta` resolves to twenty-three pixels, and these sit
                // in a wrapped row where a miss lands on the chip below.
                className="border-card bg-inner text-muted hover:text-body hover:bg-subtle inline-flex min-h-[24px] items-center rounded-sm border px-2 py-0.5 text-meta transition"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {failure ? (
        <p role="alert" className="text-danger mt-2 measure text-ui">
          {failure}
        </p>
      ) : null}

      <div className={pinned ? 'min-h-0 flex-1 overflow-y-auto' : undefined}>
        {answers.map((answer, at) => (
          // The question is the identity here — two answers to the same question
          // would be the same row twice, and the index keeps them apart.
          <Answer
          key={`${answer.question}-${at}`}
          answer={answer}
          onLocate={onLocate}
          interlocuteurs={interlocuteurs}
        />
        ))}
      </div>
    </section>
  )
}

function Answer({
  answer,
  onLocate,
  interlocuteurs,
}: {
  answer: AskAnswer
  onLocate?: AskPanelProps['onLocate']
  interlocuteurs: readonly { name: string; email: string }[]
}) {
  /*
   * The honest empty case, and it is a first-class outcome rather than an error.
   * « The record does not say » is the correct answer to most questions about
   * most meetings, and a model with no way to give it invents one instead — so
   * the prompt asks for it and the screen has to draw it as an answer.
   */
  if (!answer.answered) {
    return (
      <div className="mt-3">
        <Question>{answer.question}</Question>
        <p className="text-muted measure text-ui">
          La transcription de cet appel ne permet pas de répondre. Rien n’a été inventé.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <Question>{answer.question}</Question>
      <p className="text-body measure whitespace-pre-wrap text-copy leading-relaxed">
        {answer.answer}
      </p>

      {answer.citations.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {answer.citations.map((citation) => {
            const at = citation.span.startMs
            // A quote the model gave no channel for is nobody's turn to claim.
            const label =
              citation.span.channel === null
                ? 'client'
                : speakerLabel(citation.span.channel, interlocuteurs)
            /*
             * **The time is part of the control, not a label beside it.**
             *
             * It was a separate span, so the one thing on the row that reads as
             * « where in the call » was the one thing a rep could not press —
             * and pressing a timestamp to go to that moment is the gesture every
             * player has taught them. One button now holds both, which also
             * makes the target the width of the row rather than the width of a
             * sentence fragment.
             */
            const time = citation.verified && at !== null ? formatOffset(at) : '—'
            if (citation.verified) {
              return (
                <li key={citation.span.quote}>
                  <button
                    type="button"
                    onClick={() => onLocate?.(citation.span.quote, label)}
                    /*
                      Where there is no transcript beside this panel the quote is
                      still drawn — it is worth reading even when it cannot be
                      opened — so the control degrades to text rather than to a
                      dead button (DEC-26).
                    */
                    disabled={onLocate === undefined}
                    className="hover:bg-subtle flex w-full gap-2 rounded-sm px-1 py-0.5 text-left transition disabled:hover:bg-transparent"
                  >
                    <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                      {time}
                    </span>
                    <span className="text-body min-w-0 flex-1 text-ui leading-relaxed">
                      « {citation.span.quote} »
                    </span>
                  </button>
                </li>
              )
            }
            /*
             * **The mark is on the quote, not on the sentence after it.**
             *
             * The quote was set in `--text-body` exactly like a verified one and
             * the warning trailed it — so the fragment a rep is most likely to
             * copy into an email looked identical to the fragments that are
             * actually in the recording, and the disclaimer was a tail their eye
             * had already passed. Underlined in `--warn`, it is marked where it
             * is read. It is deliberately not a control: following it would open
             * the reader on nothing and read as the reader being broken rather
             * than as the citation being wrong.
             */
            return (
              <li key={citation.span.quote} className="flex gap-2 px-1 py-0.5">
                <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                  {/* No time claimed, because there is nowhere to point. */}
                  {time}
                </span>
                <span className="min-w-0 flex-1 text-ui leading-relaxed">
                  <span className="text-body decoration-warn underline decoration-dotted decoration-from-font underline-offset-4">
                    « {citation.span.quote} »
                  </span>{' '}
                  <span className="text-warn">
                    — introuvable dans la transcription, à ne pas reprendre tel quel.
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/** The rep's own question, above the answer, in their own words. */
function Question({ children }: { children: string }) {
  return <p className="text-muted mb-1 measure text-meta">{children}</p>
}
