/**
 * *Demander*, at the DOM.
 *
 * The happy path is the least interesting thing here and would pass against a
 * panel that printed whatever the model said. What has to hold is everything
 * around it:
 *
 *  · an unverified quote is **on screen and marked** (DEC-21) — dropping it
 *    would leave a confident paragraph with one fewer footnote and no sign
 *    anything had gone wrong;
 *  · only a verified quote is a control, because following an unverified one
 *    opens the transcript on nothing and reads as the reader being broken —
 *    and the time is *inside* that control, not a label beside it;
 *  · an answer is never taken off screen to make room for the next one: the
 *    panel stores nothing, so the copy on screen is the only copy;
 *  · « the record does not say » renders as an answer, not as an error;
 *  · a refusal from the main process arrives as its own French sentence
 *    (DEC-26), never as a generic failure that hides which.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AskAnswer } from '../../../../electron/core/contracts/ask.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../../test/appBridge.ts'
import { AskPanel } from '../AskPanel.tsx'

let bridge: FakeBridge
let uninstall: () => void

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

const answer = (over: Partial<AskAnswer> = {}): AskAnswer => ({
  question: 'Qu’est-ce qui a été dit sur le TJM ?',
  answered: true,
  answer: 'Le client indique que la grille achats plafonne à 550 €.',
  citations: [
    {
      span: {
        quote: 'la grille achats plafonne à 550',
        channel: 'far',
        startMs: 940_000,
        endMs: 946_000,
      },
      verified: true,
    },
  ],
  ...over,
})

const ask = async (question = 'Quel TJM ?') => {
  fireEvent.change(screen.getByLabelText('Poser une question sur cet appel'), {
    target: { value: question },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Demander' }))
  })
}

describe('an answer never arrives alone', () => {
  test('the prose comes with the quote it leans on, and where in the call it is', async () => {
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-hair" />)
    await ask()

    expect(await screen.findByText(/la grille achats plafonne à 550 €/)).toBeTruthy()
    // The quote, and the second of the recording it was said at.
    expect(screen.getByText(/« la grille achats plafonne à 550 »/)).toBeTruthy()
    expect(screen.getByText('15:40')).toBeTruthy()
  })

  /*
   * The one that matters. An answer that leans on something nobody said keeps
   * its footnote, and the footnote says so — a rep can then distrust that
   * sentence specifically rather than the whole panel.
   */
  test('a quote the app could not find is shown, marked, and not followable', async () => {
    bridge.when('meeting:ask', () =>
      answer({
        citations: [
          {
            span: { quote: 'on peut monter à 600 sur le lead', channel: 'far', startMs: null, endMs: null },
            verified: false,
          },
        ],
      }),
    )
    render(<AskPanel meetingId="m-hair" onLocate={() => {}} />)
    await ask()

    expect(await screen.findByText(/« on peut monter à 600 sur le lead »/)).toBeTruthy()
    expect(screen.getByText(/introuvable dans la transcription/)).toBeTruthy()
    // No time claimed, because there is nowhere to point.
    expect(screen.getByText('—')).toBeTruthy()
    // And it is text, not a button: following it would open the reader on
    // nothing and read as the reader being broken rather than the quote wrong.
    expect(screen.queryByRole('button', { name: /on peut monter à 600/ })).toBeNull()
  })

  test('a verified quote opens the record on the moment it came from', async () => {
    const opened: string[] = []
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-hair" onLocate={(quote) => opened.push(quote)} />)
    await ask()

    const citation = await screen.findByRole('button', { name: /la grille achats plafonne/ })
    fireEvent.click(citation)
    expect(opened).toEqual(['la grille achats plafonne à 550'])
  })

  /*
   * The time was a span beside the button, so the one thing on the row that
   * reads as « where in the call » was the one thing a rep could not press —
   * against every media player they have ever used.
   */
  test('the time is inside the control, not a label beside it', async () => {
    const opened: string[] = []
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-hair" onLocate={(quote) => opened.push(quote)} />)
    await ask()

    const citation = await screen.findByRole('button', { name: /la grille achats plafonne/ })
    expect(citation.textContent).toContain('15:40')
    fireEvent.click(screen.getByText('15:40'))
    expect(opened).toEqual(['la grille achats plafonne à 550'])
  })
})

describe('the panel keeps what it answered', () => {
  /*
   * The previous answer used to be cleared as the next question was sent, so a
   * rep who asked a second thing lost the first — and the panel stores nothing,
   * so that was the only copy of it.
   */
  test('a second question does not take the first answer off screen', async () => {
    bridge.when('meeting:ask', (payload) =>
      answer({ question: (payload as { question: string }).question }),
    )
    render(<AskPanel meetingId="m-hair" />)

    await ask('Quel TJM ?')
    await screen.findByText('Quel TJM ?')
    await ask('Qui décide ?')

    await screen.findByText('Qui décide ?')
    expect(screen.getByText('Quel TJM ?')).toBeTruthy()
  })

  test('the box empties, so the question is on screen once', async () => {
    bridge.when('meeting:ask', () => answer({ question: 'Quel TJM ?' }))
    render(<AskPanel meetingId="m-hair" />)
    await ask('Quel TJM ?')

    await screen.findByText(/plafonne à 550 €/)
    const box = screen.getByLabelText('Poser une question sur cet appel') as HTMLInputElement
    expect(box.value).toBe('')
    // Once: above its answer, and not also in the field they have stopped
    // looking at.
    expect(screen.getAllByText('Quel TJM ?')).toHaveLength(1)
  })

  /*
   * The suggestions used to go for good on the first question, which read as
   * the panel having spent what it had.
   */
  test('the suggestions not yet asked stay on offer', async () => {
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-hair" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Qui décide, et quand ?' }))
    })
    await screen.findByText(/plafonne à 550 €/)

    expect(screen.queryByRole('button', { name: 'Qui décide, et quand ?' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Qu’est-ce qui bloque côté client ?' })).toBeTruthy()
  })
})

describe('what it refuses to pretend', () => {
  test('« the record does not say » is an answer, not an error', async () => {
    bridge.when('meeting:ask', () => answer({ answered: false, answer: '', citations: [] }))
    render(<AskPanel meetingId="m-hair" />)
    await ask('Ont-ils parlé de RGPD ?')

    expect(await screen.findByText(/ne permet pas de répondre/)).toBeTruthy()
    // Not an alert — nothing failed. The app was asked something the recording
    // does not answer, and said so.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a refusal keeps the main process’s own sentence (DEC-26)', async () => {
    bridge.when('meeting:ask', () => {
      throw new Error(
        'Aucun modèle de langage n’est configuré — ajoutez-en un dans Réglages, « Modèle de langage ».',
      )
    })
    render(<AskPanel meetingId="m-hair" />)
    await ask()

    const alert = await screen.findByRole('alert')
    // The sentence that names the screen to go to, not « une erreur est survenue ».
    expect(alert.textContent).toContain('Réglages')
  })

  test('the question above the answer is the rep’s own string', async () => {
    // Never the model's restatement of it: a question that came back subtly
    // reworded is a screen quietly changing what was asked.
    bridge.when('meeting:ask', () => answer({ question: 'Une autre question' }))
    render(<AskPanel meetingId="m-hair" />)
    await ask('Quel TJM ?')

    // The panel prints what the answer carries, and `verifyAnswer` carries the
    // rep's string — so this is the contract test's DOM half.
    expect(await screen.findByText('Une autre question')).toBeTruthy()
  })
})

describe('it writes nothing and confirms nothing (DEC-4, DEC-5)', () => {
  test('asking sends exactly one channel, and it is the read', async () => {
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-hair" />)
    await ask()
    await waitFor(() => expect(screen.getByText(/plafonne à 550 €/)).toBeTruthy())

    // No rename, no snapshot, no confirm. One read (DEC-25).
    expect(bridge.calls.map((call) => call.channel)).toEqual(['meeting:ask'])
  })

  test('the suggestions are scaffolding and leave once the box has been used', async () => {
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-hair" />)

    const suggestion = screen.getByRole('button', { name: 'Qui décide, et quand ?' })
    await act(async () => {
      fireEvent.click(suggestion)
    })

    await screen.findByText(/plafonne à 550 €/)
    expect(screen.queryByRole('button', { name: 'Qui décide, et quand ?' })).toBeNull()
  })
})
