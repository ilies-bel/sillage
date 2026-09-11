/**
 * The in-meeting widget (`src/widget/Widget.tsx`).
 *
 * Three of the four things on this surface are only reachable here. The
 * screenshot harness photographs it against a stubbed bridge and measures its
 * geometry; `scripts/e2e.mjs` proves the window opens, marks a moment and
 * closes with the recording. What neither of them can see is what the component
 * does with a *stream*: an interim result replaced in place rather than
 * appended, a mark arriving from the other window, the second press before a
 * recording is ended.
 *
 * jsdom measures every box as zero, so nothing here asserts a layout — the
 * `widget`, `widget-ouvert` and `widget-arret` stages do that, at both sizes,
 * under all six checks.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TranscriptSegment } from '../../../electron/core/contracts/transcript.ts'
import type { MomentMark } from '../../../electron/core/contracts/marks.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Widget } from '../Widget.tsx'

let bridge: FakeBridge
let uninstall: () => void

const STARTED = Date.UTC(2026, 8, 11, 12, 0, 0)

const segment = (
  id: string,
  channel: 'rep' | 'far',
  text: string,
  isFinal = true,
  receivedAt = STARTED + 60_000,
): TranscriptSegment => ({
  id,
  channel,
  text,
  startMs: 60_000,
  endMs: 60_000,
  isFinal,
  provider: 'local-whisper',
  receivedAt,
})

const recording = (marks: MomentMark[] = []) => ({
  meeting: {
    meetingId: 'm1',
    title: 'Néovia Santé — cadrage',
    clientName: 'Néovia Santé',
    startedAt: STARTED,
    marks,
  },
})

beforeEach(() => {
  bridge = fakeBridge()
  bridge.when('widget:state', () => recording())
  bridge.when('widget:resize', () => ({ ok: true }))
  bridge.when('window:focus', () => ({ ok: true }))
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

const openPanel = async () => {
  const toggle = await screen.findByRole('button', { name: /^Ouvrir le panneau/ })
  fireEvent.click(toggle)
}

test('the pill draws the recording and the meter, and names no client on it', async () => {
  render(<Widget />)

  // Always on screen, collapsed or not: this is DEC-38's proof of life, and it
  // is the one thing here that must never be behind a press.
  expect(await screen.findByLabelText('Durée d’enregistrement')).toBeTruthy()
  expect(screen.getByText('Enregistrement en cours')).toBeTruthy()

  /*
   * The client's name is in the *accessible name* of the control and nowhere on
   * the pill itself. A rep sharing their screen shares this window with it, and
   * the collapsed pill is the state that is always up — « Néovia Santé » across
   * somebody's slides is the app volunteering a client's name to whoever is in
   * the room.
   */
  expect(screen.queryByText('Néovia Santé')).toBeNull()
  expect(screen.getByRole('button', { name: /Néovia Santé/ })).toBeTruthy()
})

test('an interim result is replaced in place and marked as provisional', async () => {
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('i1', 'far', 'On est plutôt sur du 550', false),
    })
  })
  expect(await screen.findByText(/On est plutôt sur du 550/)).toBeTruthy()
  expect(screen.getByText('(en cours de transcription)')).toBeTruthy()

  // The next interim on the same channel replaces it. Appending would grow the
  // panel by a line per round trip and re-say the same half-sentence.
  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('i2', 'far', 'On est plutôt sur du 550 euros', false),
    })
  })
  await waitFor(() => {
    expect(screen.queryByText('On est plutôt sur du 550')).toBeNull()
  })
  expect(screen.getByText(/On est plutôt sur du 550 euros/)).toBeTruthy()

  // And the final one takes its place rather than sitting beside it.
  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('f1', 'far', 'On est plutôt sur du 550 euros pour un confirmé.'),
    })
  })
  await waitFor(() => {
    expect(screen.queryByText('(en cours de transcription)')).toBeNull()
  })
  expect(screen.getByText('On est plutôt sur du 550 euros pour un confirmé.')).toBeTruthy()
})

test('a segment from another meeting is not drawn', async () => {
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm2',
      segment: segment('x1', 'far', 'Une autre réunion.'),
    })
  })
  await waitFor(() => {
    expect(screen.getByText('Rien n’a encore été transcrit.')).toBeTruthy()
  })
})

test('a note is marked on the meeting and drawn where the rep made it', async () => {
  let asked: unknown = null
  bridge.when('meeting:mark', (payload) => {
    asked = payload
    return { id: 'mk1', at: STARTED + 90_000, note: payload.note ?? '', segmentId: null }
  })
  render(<Widget />)
  await openPanel()

  const field = screen.getByPlaceholderText('Noter ce moment…')
  fireEvent.change(field, { target: { value: 'plafond achats' } })
  fireEvent.keyDown(field, { key: 'Enter' })

  await waitFor(() => {
    expect(asked).toEqual({ meetingId: 'm1', note: 'plafond achats', segmentId: null })
  })
  expect(await screen.findByText('plafond achats')).toBeTruthy()
  // Cleared, so the next thing the rep types is not appended to the last mark.
  expect((field as HTMLInputElement).value).toBe('')
})

test('marking a turn names that turn, so the reader does not have to guess', async () => {
  let asked: { segmentId?: string | null } = {}
  bridge.when('meeting:mark', (payload) => {
    asked = payload
    return { id: 'mk1', at: STARTED + 90_000, note: '', segmentId: payload.segmentId ?? null }
  })
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('f1', 'far', 'Le plafond achats est à 550.'),
    })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Marquer cette prise de parole' }))

  await waitFor(() => {
    expect(asked.segmentId).toBe('f1')
  })
})

test('a mark made in the other window arrives here', async () => {
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('moment:marked', {
      meetingId: 'm1',
      mark: { id: 'mk9', at: STARTED + 10_000, note: 'vu depuis l’app', segmentId: null },
    })
  })
  expect(await screen.findByText('vu depuis l’app')).toBeTruthy()
})

test('a refused mark says why, rather than doing nothing', async () => {
  bridge.when('meeting:mark', () => {
    throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
  })
  render(<Widget />)
  await openPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Marquer' }))
  expect(await screen.findByText(/Aucun enregistrement en cours/)).toBeTruthy()
})

/**
 * The two presses.
 *
 * Ending a recording cannot be undone — the state machine has no way back from
 * `ended` and the audio is never retained (DEC-12) — and this control floats
 * over a video call under a pointer the rep is using for something else.
 */
test('ending the recording takes a second press, on a different control', async () => {
  const sent: unknown[] = []
  bridge.when('session:command', (payload) => {
    sent.push(payload)
    return { ok: true as const, state: 'ended' as const }
  })
  render(<Widget />)
  await openPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Terminer' }))
  expect(sent).toEqual([])

  // And the way out of it is beside the confirmation, not under it.
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
  expect(screen.getByRole('button', { name: 'Terminer' })).toBeTruthy()
  expect(sent).toEqual([])

  fireEvent.click(screen.getByRole('button', { name: 'Terminer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’enregistrement' }))
  expect(sent).toEqual([
    { meetingId: 'm1', command: 'end', reason: 'terminée depuis le widget' },
  ])
})

test('the way back into the app raises the main window on this meeting', async () => {
  const asked: unknown[] = []
  bridge.when('window:focus', (payload) => {
    asked.push(payload)
    return { ok: true }
  })
  render(<Widget />)
  await openPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Sillage' }))
  expect(asked).toEqual([{ meetingId: 'm1' }])
})

test('with nothing recording it says so and offers no controls', async () => {
  bridge.when('widget:state', () => ({ meeting: null }))
  render(<Widget />)

  expect(await screen.findByText('Aucun enregistrement')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Terminer' })).toBeNull()
})
