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
 * read over the log, like *Historique* (DEC-25). The next question starts fresh
 * — a thread would need history, a token budget and a summariser, none of which
 * makes the first question better answered.
 *
 * **It is not on screen during the call** (DEC-23). The caller decides that;
 * this component is simply never mounted then.
 */
import { useState } from 'react'
import type { AskAnswer } from '../../../electron/core/contracts/ask.ts'
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

export function AskPanel({ meetingId, onLocate, className }: AskPanelProps) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const ask = async (asked: string) => {
    const trimmed = asked.trim()
    if (trimmed === '' || busy) return

    setBusy(true)
    setFailure(null)
    /*
     * The previous answer goes as the new question is sent, deliberately.
     * Leaving it under a spinner puts the answer to a question the rep has
     * stopped asking directly above the one they are waiting for, and the two
     * are indistinguishable at a glance.
     */
    setAnswer(null)
    try {
      setAnswer(await invoke('meeting:ask', { meetingId, question: trimmed }))
    } catch (error) {
      // The main process's own French sentence — « aucun modèle de langage
      // n'est configuré… », « la réunion est en cours… ». Never a stack, and
      // never a generic « une erreur est survenue » that hides which (DEC-26).
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={className}>
      <form
        className="flex items-center gap-inline"
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
        The suggestions go once the panel has been used. They are scaffolding for
        the first question and clutter after it — a rep who has asked one knows
        what the box is for.
      */}
      {answer === null && failure === null && !busy ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(suggestion)
                  void ask(suggestion)
                }}
                className="border-card bg-inner text-muted hover:text-body hover:bg-subtle rounded-sm border px-2 py-0.5 text-meta transition"
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

      {answer ? <Answer answer={answer} onLocate={onLocate} /> : null}
    </section>
  )
}

function Answer({ answer, onLocate }: { answer: AskAnswer; onLocate?: AskPanelProps['onLocate'] }) {
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
            const label = citation.span.channel === 'rep' ? 'moi' : 'client'
            return (
              <li key={citation.span.quote} className="flex gap-2">
                <span className="text-muted w-10 shrink-0 tabular-nums text-meta leading-relaxed">
                  {/* A verified quote has a time; an unverified one has nowhere
                      to point, and « — » says so without claiming a moment. */}
                  {citation.verified && at !== null ? formatOffset(at) : '—'}
                </span>
                {citation.verified ? (
                  <button
                    type="button"
                    onClick={() => onLocate?.(citation.span.quote, label)}
                    /*
                      Only a verified quote is a control. Following an unverified
                      one would open the transcript on nothing and read as the
                      reader being broken rather than as the citation being wrong.
                      Where there is no transcript beside this panel the quote is
                      still drawn — it is worth reading even when it cannot be
                      opened — so the control degrades to text rather than to a
                      dead button (DEC-26).
                    */
                    disabled={onLocate === undefined}
                    className="text-body hover:bg-subtle min-w-0 flex-1 rounded-sm px-1 text-left text-ui leading-relaxed transition disabled:hover:bg-transparent"
                  >
                    « {citation.span.quote} »
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 px-1 text-ui leading-relaxed">
                    <span className="text-body">« {citation.span.quote} »</span>{' '}
                    <span className="text-warn">
                      — introuvable dans la transcription, à ne pas reprendre tel quel.
                    </span>
                  </span>
                )}
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
