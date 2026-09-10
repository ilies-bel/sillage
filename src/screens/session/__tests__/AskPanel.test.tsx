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
 *    opens the transcript on nothing and reads as the reader being broken;
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
    render(<AskPanel meetingId="m-1" />)
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
    render(<AskPanel meetingId="m-1" onLocate={() => {}} />)
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
    render(<AskPanel meetingId="m-1" onLocate={(quote) => opened.push(quote)} />)
    await ask()

    const citation = await screen.findByRole('button', { name: /la grille achats plafonne/ })
    fireEvent.click(citation)
    expect(opened).toEqual(['la grille achats plafonne à 550'])
  })
})

describe('what it refuses to pretend', () => {
  test('« the record does not say » is an answer, not an error', async () => {
    bridge.when('meeting:ask', () => answer({ answered: false, answer: '', citations: [] }))
    render(<AskPanel meetingId="m-1" />)
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
    render(<AskPanel meetingId="m-1" />)
    await ask()

    const alert = await screen.findByRole('alert')
    // The sentence that names the screen to go to, not « une erreur est survenue ».
    expect(alert.textContent).toContain('Réglages')
  })

  test('the question above the answer is the rep’s own string', async () => {
    // Never the model's restatement of it: a question that came back subtly
    // reworded is a screen quietly changing what was asked.
    bridge.when('meeting:ask', () => answer({ question: 'Une autre question' }))
    render(<AskPanel meetingId="m-1" />)
    await ask('Quel TJM ?')

    // The panel prints what the answer carries, and `verifyAnswer` carries the
    // rep's string — so this is the contract test's DOM half.
    expect(await screen.findByText('Une autre question')).toBeTruthy()
  })
})

describe('it writes nothing and confirms nothing (DEC-4, DEC-5)', () => {
  test('asking sends exactly one channel, and it is the read', async () => {
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-1" />)
    await ask()
    await waitFor(() => expect(screen.getByText(/plafonne à 550 €/)).toBeTruthy())

    // No rename, no snapshot, no confirm. One read (DEC-25).
    expect(bridge.calls.map((call) => call.channel)).toEqual(['meeting:ask'])
  })

  test('the suggestions are scaffolding and leave once the box has been used', async () => {
    bridge.when('meeting:ask', () => answer())
    render(<AskPanel meetingId="m-1" />)

    const suggestion = screen.getByRole('button', { name: 'Qui décide, et quand ?' })
    await act(async () => {
      fireEvent.click(suggestion)
    })

    await screen.findByText(/plafonne à 550 €/)
    expect(screen.queryByRole('button', { name: 'Qui décide, et quand ?' })).toBeNull()
  })
})
