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
 * `widget`, `widget-ouvert`, `widget-refus` and `widget-arret` stages do that, at
 * both sizes, under all eight checks. That division is exactly why the refused
 * mark survived: the sentence *was* in the DOM, and the only thing wrong with it
 * was the 1×1 clipped box it was in.
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
  bridge.when('widget:resize', () => ({ ok: true, above: false }))
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

/**
 * **A provisional result is not drawn at all.**
 *
 * An early draft drew interims muted, with an ellipsis, and the repo's own
 * documentation called that a difference over Granola's widget. It could not
 * happen: `LocalWhisperSession` and `RestSttSession` both emit `isFinal: true`
 * and every row in `STT_PROVIDERS` declares `streaming: false`, so the branch
 * was unreachable and the test that covered it fed the component a fixture —
 * proving a renderer *can* draw a value, never that one arrives, which is the
 * failure this repo has now written down five times.
 *
 * The one line that remains is the drop, and this is what holds it: the day a
 * streaming provider ships, the widget shows the record until somebody decides
 * otherwise, rather than silently starting to show guesses.
 */
test('a provisional segment is dropped rather than drawn', async () => {
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('i1', 'far', 'On est plutôt sur du 550', false),
    })
  })
  await waitFor(() => {
    expect(screen.getByText('Rien n’a encore été transcrit.')).toBeTruthy()
  })

  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('f1', 'far', 'On est plutôt sur du 550 euros pour un confirmé.'),
    })
  })
  expect(await screen.findByText('On est plutôt sur du 550 euros pour un confirmé.')).toBeTruthy()
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

/**
 * **The row appears because the main process said so, not because we asked.**
 *
 * This used to insert the mark the `invoke` returned, which draws a row whose
 * write may not have happened and leaves `moment:marked` — a declared broadcast
 * — doing nothing at all. The test then passed with the broadcast entirely
 * unwired, which is the exact shape `scripts/check-surfaces.mjs` exists to
 * fail. So the answer is deliberately withheld here: nothing is drawn until the
 * broadcast arrives.
 */
test('a note is marked on the meeting and drawn when the log says so', async () => {
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
  // Cleared, so the next thing the rep types is not appended to the last mark.
  expect((field as HTMLInputElement).value).toBe('')
  // Not drawn yet — the answer to the invoke is not evidence of a write.
  expect(screen.queryByText('plafond achats')).toBeNull()

  act(() => {
    bridge.emit('moment:marked', {
      meetingId: 'm1',
      mark: { id: 'mk1', at: STARTED + 90_000, note: 'plafond achats', segmentId: null },
    })
  })
  expect(await screen.findByText('plafond achats')).toBeTruthy()
})

/**
 * A mark can be taken back.
 *
 * It is typed one-handed into a box floating over a client's face and sent on
 * `Enter`, so a typo is made here more easily than anywhere else in the
 * product — and it is read again at the gate, in the rep's own words.
 */
test('a mark can be taken back, and the list follows the log', async () => {
  const asked: unknown[] = []
  bridge.when('meeting:forget', (payload) => {
    asked.push(payload)
    return { forgotten: true }
  })
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('moment:marked', {
      meetingId: 'm1',
      mark: { id: 'mk1', at: STARTED + 1_000, note: 'plafnod achats', segmentId: null },
    })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Retirer ce moment marqué' }))
  await waitFor(() => {
    expect(asked).toEqual([{ meetingId: 'm1', markId: 'mk1' }])
  })
  // Still there: the row goes when the log says it went, not when we asked.
  expect(screen.getByText('plafnod achats')).toBeTruthy()

  act(() => {
    bridge.emit('moment:forgotten', { meetingId: 'm1', markId: 'mk1' })
  })
  await waitFor(() => {
    expect(screen.queryByText('plafnod achats')).toBeNull()
  })
})

/**
 * **The pill can mark, without opening anything.**
 *
 * Three files described this button before it existed. A rep who wanted to
 * bookmark a moment had to open a 340-pixel card over the client's face first,
 * which is the opposite of what a one-press bookmark is for.
 */
test('the pill marks a moment with the panel closed, and counts them', async () => {
  const asked: unknown[] = []
  bridge.when('meeting:mark', (payload) => {
    asked.push(payload)
    return { id: 'mk1', at: STARTED + 1_000, note: '', segmentId: null }
  })
  render(<Widget />)

  fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
  await waitFor(() => {
    expect(asked).toEqual([{ meetingId: 'm1', note: '', segmentId: null }])
  })

  // The count is the receipt: a press with no note and no panel changes nothing
  // else on screen, so without it the rep pressed a button that did nothing.
  act(() => {
    bridge.emit('moment:marked', {
      meetingId: 'm1',
      mark: { id: 'mk1', at: STARTED + 1_000, note: '', segmentId: null },
    })
  })
  expect(await screen.findByRole('button', { name: 'Marquer ce moment (1 déjà marqués)' })).toBeTruthy()
})

/**
 * **Collapsing the panel must not destroy the call.**
 *
 * The transcript and the marks were held by the panel, which is mounted by a
 * press and unmounted by the next one — so a rep who opened the widget to check
 * a number, closed it off the client's face and opened it again got an empty
 * box, on precisely the use case the feature exists for. The subscription lives
 * in the window now, not in the panel.
 */
test('what arrived while the panel was shut is there when it opens', async () => {
  render(<Widget />)
  // The window has to know which meeting it is on before a broadcast about
  // that meeting means anything — `widget:state` is one round trip, and in
  // production it resolves long before the first turn of a call arrives.
  await screen.findByLabelText('Durée d’enregistrement')

  // Collapsed the whole time.
  act(() => {
    bridge.emit('transcript:appended', {
      meetingId: 'm1',
      segment: segment('f1', 'far', 'Le plafond achats est à 550.'),
    })
    bridge.emit('moment:marked', {
      meetingId: 'm1',
      mark: { id: 'mk1', at: STARTED + 1_000, note: 'à revoir', segmentId: null },
    })
  })

  await openPanel()
  expect(await screen.findByText('Le plafond achats est à 550.')).toBeTruthy()
  expect(screen.getByText('à revoir')).toBeTruthy()

  // And closing it does not throw any of it away.
  fireEvent.click(screen.getByRole('button', { name: 'Replier le panneau' }))
  await openPanel()
  expect(await screen.findByText('Le plafond achats est à 550.')).toBeTruthy()
  expect(screen.getByText('à revoir')).toBeTruthy()
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

/**
 * **A refused mark, for a rep who can see.**
 *
 * `meeting:mark` refuses whenever the meeting is not `recording` — which
 * `EndOfMeetingWatch` can make true with the pill still floating over the call —
 * and on any store failure. The sentence went into the `sr-only` paragraph at the
 * bottom of the window: a 1×1 box with `clip: rect(0,0,0,0)`, measured, on a
 * window carrying no `role="alert"` anywhere. The counter beside the button
 * correctly did not move, because nothing had been written. So the screen's answer
 * to a refusal and its answer to a success were the same screen, and a rep who
 * presses this button one-handed over a client's face is not going to look twice.
 *
 * jsdom cannot measure the box — `widget-refus` does that on real layout — so what
 * is asserted here is the thing jsdom *can* see and the thing that was wrong: the
 * sentence is in the accessibility tree as an alert rather than only as polite
 * text nothing draws.
 */
test('a refused mark is drawn, not only announced', async () => {
  bridge.when('meeting:mark', () => {
    throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
  })
  render(<Widget />)

  fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))

  const notice = await screen.findByRole('alert')
  expect(notice.textContent).toBe('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
  // Not inside the visually-hidden region, which is the whole defect.
  expect(notice.closest('.sr-only')).toBeNull()
  // And inside a card: everything on this window that is not one is halo, and
  // halo is handed to Teams with `setIgnoreMouseEvents`.
  expect(notice.closest('[data-card]')).not.toBeNull()

  // The counter does not move on a refusal. A receipt for a write that did not
  // happen is the same failure one layer on.
  expect(screen.getByRole('button', { name: 'Marquer ce moment' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Masquer ce message' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

/**
 * **A mark that landed is announced and not drawn.**
 *
 * The other half of the rule, and it is the half that keeps the first one from
 * becoming noise: the receipt for a mark that worked is the counter on the pill,
 * and a card painted over a client's face to say « Moment marqué. » would be a
 * second one on a window whose every pixel is a pixel of Teams the rep cannot
 * click.
 */
test('a mark that worked raises no notice', async () => {
  bridge.when('meeting:mark', () => ({
    id: 'mk1',
    at: STARTED + 1_000,
    note: '',
    segmentId: null,
  }))
  render(<Widget />)

  fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
  await waitFor(() => expect(screen.getByText('Moment marqué.')).toBeTruthy())
  expect(screen.queryByRole('alert')).toBeNull()
})

/**
 * **The stacking direction can change without this window asking.**
 *
 * `above` came back on the reply to `widget:resize` and nowhere else, so it was
 * only ever recomputed when the frame's own `width × height × pillTop` changed.
 * Two things change it that do not change those: a display going away — the
 * rescue that keeps this window recoverable at all — and the rep dragging the
 * pill across the display's midline, which moves the pill by the panel's whole
 * height and resizes nothing. `widget:placed` is the main process saying so.
 */
test('widget:placed flips which way the panel opens', async () => {
  render(<Widget />)
  await openPanel()
  /*
   * The stub's `widget:resize` answers `above: false`, so the panel is stacked
   * downward and the chevron points back the way it will collapse — « the arrow
   * points where the panel will go », which with the panel open is shut.
   */
  expect(screen.getByRole('button', { name: 'Replier le panneau' }).textContent).toBe('▴')

  act(() => bridge.emit('widget:placed', { above: true }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Replier le panneau' }).textContent).toBe('▾')
  })
})
