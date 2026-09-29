/**
 * The right column's own switch — *Trame* and *Transcription* (`LiveAside`).
 *
 * DEC-38 removed a live transcript **drawn to prove the tool was working**, and
 * that job still belongs to the meter. What these tests hold is the shape of
 * the thing that replaced the removal: the slate is what the column opens on,
 * the transcript is something the rep turns on, the record is collected by the
 * component that stays mounted across the toggle rather than by the pane, and
 * a provisional segment is dropped rather than drawn.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Meeting } from '../../../electron/core/contracts/meeting.ts'
import type { TranscriptSegment } from '../../../electron/core/contracts/transcript.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Session } from '../Session.tsx'

let bridge: FakeBridge
let uninstall: () => void

const meeting = (): Meeting => ({
  id: 'm-hair',
  state: 'recording',
  title: 'Point Acme',
  eventId: null,
  clientName: 'Acme SA',
  scheduledStart: null,
  createdAt: 1,
  startedAt: 1,
  endedAt: null,
  confirmedAt: null,
  updatedAt: 1,
})

const segment = (over: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  id: 's-1',
  channel: 'far',
  text: 'La grille achats plafonne à 550 sur un confirmé.',
  startMs: 242_000,
  endMs: 248_000,
  isFinal: true,
  provider: 'local-whisper',
  receivedAt: 2,
  ...over,
})

const open = () => {
  bridge.when('meeting:get', () => ({
    meeting: meeting(),
    segments: [],
    signals: [],
    // Empty, and honestly so: nothing is drafted before the gate is spent.
    intents: [],
    outbox: [],
    document: null,
    compteRendu: null,
    recipe: 'besoin-commercial' as const,
  }))
  return render(<Session meetingId="m-hair" onBack={() => {}} onReview={() => {}} />)
}

const append = (over: Partial<TranscriptSegment> = {}) =>
  act(() => {
    bridge.emit('transcript:appended', { meetingId: 'm-hair', segment: segment(over) })
  })

const toTranscription = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Transcription' }))

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('the column opens on the slate and the transcript is asked for', () => {
  test('Trame is the current view and the transcript is nowhere on screen', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })

    expect(screen.getByRole('button', { name: 'Trame' }).getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Transcription' }).getAttribute('aria-pressed'),
    ).toBe('false')

    // A turn arrives with the slate showing. Nothing draws it — the rep did not
    // ask for a transcript, and DEC-38's clause is about one appearing unasked.
    append()
    expect(screen.queryByText(/La grille achats plafonne/)).toBeNull()
    // The slate is what is there.
    expect(screen.getByText('Démarrage')).toBeTruthy()
  })

  test('the window collects the turns, so switching late does not start the record late', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })

    // Two turns while *Trame* is showing — the pane that would draw them is not
    // mounted. The collector is `LiveAside`, which is.
    append({ id: 's-1', text: 'On a voté le budget ce matin.' })
    append({ id: 's-2', text: 'Deux data engineers confirmés et un lead.' })

    toTranscription()
    expect(screen.getByText('On a voté le budget ce matin.')).toBeTruthy()
    expect(screen.getByText('Deux data engineers confirmés et un lead.')).toBeTruthy()
  })

  test('a row is a time, a side and a sentence — and the side is never a person', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })
    append({ channel: 'far' })
    append({ id: 's-2', channel: 'rep', startMs: 260_000, text: 'Sur le TJM, où se situe votre grille ?' })
    toTranscription()

    // 242 000 ms into the call.
    expect(screen.getByText('4:02')).toBeTruthy()
    // The far side is « Client » on every call: this screen holds no attendee
    // list, and naming a speaker it cannot know is the thing `speakerLabel`
    // exists to refuse.
    expect(screen.getByText('Client')).toBeTruthy()
    expect(screen.getByText('Moi')).toBeTruthy()
  })

  test('a provisional segment cannot be drawn', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })
    append({ text: 'euh, la grille ach', isFinal: false })
    toTranscription()

    expect(screen.queryByText(/euh, la grille ach/)).toBeNull()
  })

  test('the promise the rep needs when they turn it on', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })
    toTranscription()

    // DEC-5, on the surface where a live transcript beside a notepad invites
    // exactly this doubt.
    expect(screen.getByText('Le texte n’entre jamais dans vos notes.')).toBeTruthy()
    // Proof of life is still the meter; this dot says what the column is.
    expect(screen.getByText('en direct')).toBeTruthy()
  })

  test('the find box marks, and never filters away the context', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })
    append({ id: 's-1', text: 'On a voté le budget ce matin.' })
    append({ id: 's-2', startMs: 260_000, text: 'La grille achats plafonne à 550.' })
    toTranscription()

    fireEvent.click(screen.getByRole('button', { name: 'Chercher dans la transcription' }))
    fireEvent.change(screen.getByLabelText('Chercher dans l’appel'), {
      target: { value: 'achats' },
    })

    expect(screen.getByText(/1 prise de parole surlignée/)).toBeTruthy()
    // Both turns are still on screen: the ones either side are why anybody
    // looks a sentence up.
    expect(screen.getByText('On a voté le budget ce matin.')).toBeTruthy()
    expect(screen.getByText('La grille achats plafonne à 550.')).toBeTruthy()
  })

  test('the choice lives for the meeting and does not survive leaving it', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })
    toTranscription()
    expect(
      screen.getByRole('button', { name: 'Transcription' }).getAttribute('aria-pressed'),
    ).toBe('true')

    cleanup()
    open()
    await screen.findByRole('button', { name: 'Terminer' })
    expect(screen.getByRole('button', { name: 'Trame' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('what the header says about the recording', () => {
  test('the pill carries no word — a dot, the clock, the meter', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })

    expect(screen.queryByText('Enregistrement')).toBeNull()
    // The state is still named, once, where a screen reader can find it.
    expect(screen.getByRole('status', { name: 'Enregistrement en cours' })).toBeTruthy()
  })

  test('the language is stated and is not a control', async () => {
    open()
    await screen.findByRole('button', { name: 'Terminer' })

    const pill = screen.getByLabelText('Transcription en français')
    expect(pill.textContent).toContain('FR')
    expect(pill.tagName).toBe('SPAN')
  })
})
