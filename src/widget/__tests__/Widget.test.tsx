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

/**
 * **The exit is asked for, and answered with a number.**
 *
 * `Overlay.dismiss()` broadcasts `widget:leave` and destroys the window when the
 * renderer says its animation is over — see `widget:left` in `contracts/ipc.ts`
 * for why a constant in the main process was the wrong answer in both
 * directions. Two halves here, and jsdom can only hold one of them honestly:
 * that the class the stylesheet acts on is applied, and that the reply is sent.
 *
 * The **duration** is not asserted here on purpose. jsdom resolves no
 * `transition` shorthand, so `transitionMs` answers `0` — which is a correct
 * answer for an environment with no animation, and would be a fixture proving
 * a property it cannot exercise if it were asserted as the product's. The real
 * number is measured against the shipped stylesheet in Chromium
 * (`scripts/harness/shot.mjs --motion` runs on all four widget stages, and
 * `scratch/widget-exit.mjs` measured 150ms resting and 0ms under
 * `prefers-reduced-motion`).
 *
 * What must not happen is asserted as well: the pill does **not** blank its own
 * numbers on the way out. The recording happened; a card that erased its elapsed
 * time and its mark count in its last frames would be saying something about the
 * call that is not true.
 */
test('the widget fades out when the recording ends, and says how long that takes', async () => {
  const left: unknown[] = []
  bridge.when('widget:left', (payload) => {
    left.push(payload)
    return { ok: true }
  })
  render(<Widget />)

  const elapsed = await screen.findByLabelText('Durée d’enregistrement')
  /*
   * Found by the drag region's own ancestor rather than by a path: the shell is
   * the element the *frame* renders, and `Frame` is the component under test
   * here. `data-pill` is the anchor the placement is built on, so its outermost
   * ancestor inside the render container is the one box that cannot move
   * without the widget's geometry moving with it.
   */
  const shell = screen.getByLabelText('Durée d’enregistrement').closest('.justify-center')
  assertShell(shell)
  expect(shell.className).not.toContain('widget-leaving')

  await act(async () => {
    bridge.emit('widget:leave', {})
  })

  expect(shell.className).toContain('widget-leaving')
  // One reply, carrying the duration this renderer resolved for its own rule.
  expect(left).toEqual([{ afterMs: 0 }])
  // And the pill still says what the call was.
  expect(elapsed.textContent).toBeTruthy()
  expect(screen.getByText('Enregistrement en cours')).toBeTruthy()
})

/**
 * **The last frame is the call, and this is what the test above could not see.**
 *
 * The assertion beside it — « the pill still says what the call was » — passed for
 * as long as it existed and proved nothing, because it never delivered the
 * broadcast that actually arrives: `main.ts` fans `session:changed` out to *every*
 * window and only then calls `syncOverlay()` → `dismiss()` → `widget:leave`. So the
 * leaving renderer reloaded `widget:state`, got `{ meeting: null }`, and dropped the
 * `LevelMeter`, the elapsed time, the mark counter and 41 px of width **17 ms into a
 * 150 ms fade, at opacity 0.998** — measured in the packaged app,
 * `scratch/r26-e2e-widget-last-frame.cjs`. A fixture that omits the one message
 * responsible is a test of a property the product does not have.
 *
 * Both orders are driven, because the *rule* is not about the order — and they fail
 * for different reasons, which is why neither is redundant. `session:changed` first
 * is what `main.ts` actually sends, and it is the freeze that holds it: the latch is
 * set after the read is already on the wire. `widget:leave` first is held by the
 * latch alone, because the reload is then never fired at all. So a future reordering
 * in `main.ts` cannot quietly make the freeze look unnecessary, and removing the
 * freeze cannot be hidden by reordering. Measured both ways in the packaged app:
 * with the reload suppressed and the freeze reverted, it still blanked the card at
 * +48 ms, at opacity 0.99998 (`scratch/r26-e2e-widget-last-frame.cjs`).
 *
 * jsdom measures every box as zero, so what is asserted here is what jsdom *can*
 * see and what was wrong: the text and the controls on the card. The width, the
 * opacity and the slide are the harness's and the probe's.
 */
for (const first of ['widget:leave', 'session:changed'] as const) {
  test(`la dernière image reste l’appel — ${first} d’abord`, async () => {
    bridge.when('widget:left', () => ({ ok: true }))
    render(<Widget />)

    fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
    await act(async () => {
      bridge.emit('moment:marked', {
        meetingId: 'm1',
        mark: { id: 'k1', at: STARTED + 30_000, note: '', segmentId: null },
      })
    })
    const marked = await screen.findByRole('button', { name: /Marquer ce moment \(1 déjà marqués\)/ })
    expect(marked).toBeTruthy()
    const elapsed = screen.getByLabelText('Durée d’enregistrement').textContent

    // The meeting is over on the main process's side from here on: any read of
    // `widget:state` now answers the truth, which is that nothing is recording.
    bridge.when('widget:state', () => ({ meeting: null }))

    await act(async () => {
      if (first === 'widget:leave') {
        bridge.emit('widget:leave', {})
        bridge.emit('session:changed', { meetingId: 'm1', state: 'ended' })
      } else {
        bridge.emit('session:changed', { meetingId: 'm1', state: 'ended' })
        bridge.emit('widget:leave', {})
      }
    })
    // Long enough for a reload that was already on the wire to land.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByText('Aucun enregistrement')).toBeNull()
    expect(screen.getByLabelText('Durée d’enregistrement').textContent).toBe(elapsed)
    expect(screen.getByRole('button', { name: /Marquer ce moment \(1 déjà marqués\)/ })).toBeTruthy()
  })
}

/**
 * **The card does not relayout on its way out either, and this is the channel that
 * would move the card rather than its content.**
 *
 * `above` flips `flex-col` to `flex-col-reverse`, so a `widget:placed` arriving
 * during the fade moves the pill by the panel's whole height. It is the same rule as
 * the two tests above — a window that has been told to go away stops taking state —
 * on the one broadcast jsdom can deliver end to end.
 *
 * The other half of that rule cannot be reached from here and is not pretended
 * otherwise: `widget:resize` is answered `{ ok: false, above: false }` once `Overlay`
 * has released the window, and the renderer used to write that default into its own
 * layout — which is the « ▴ » → « ▾ » flip in the packaged-app measurement. The
 * renderer only sends a measurement for a box with a non-zero width and jsdom
 * measures every box as zero, so no reply ever arrives here. That one is proved in
 * Chromium, against real layout: `scratch/r26b-refused-place.mjs` opens the panel
 * with every `widget:resize` refused (« ▾ » kept; « ▴ » when the guard is reverted).
 */
test('une carte qui s’en va ne se remet pas en page', async () => {
  render(<Widget />)

  const toggle = await screen.findByRole('button', { name: /^Ouvrir le panneau/ })
  // The stub answers `above: false`, so a shut panel points down.
  expect(toggle.textContent).toBe('▾')

  await act(async () => {
    bridge.emit('widget:leave', {})
    bridge.emit('widget:placed', { above: true })
  })
  expect(screen.getByRole('button', { name: /^Ouvrir le panneau/ }).textContent).toBe('▾')
})

function assertShell(node: Element | null): asserts node is Element {
  if (node === null) throw new Error('la coque du widget n’a pas été trouvée')
}

/**
 * **The arrival does not start before the window has been placed** (DEC-50).
 *
 * The one bound of that decision that no stage can assert without a race and no
 * measured check can assert at all, so it is held here, where the reply can simply
 * be kept on the wire for as long as the test likes.
 *
 * What it protects is the whole `MEASURE_DEADLINE_MS` / `FIRST_FRAME_MS`
 * handshake. `getBoundingClientRect` **includes transforms**, so a pill that is
 * scaling when `widget:resize` goes out reports a box eight per cent small and the
 * main process sizes a frameless, always-on-top window to it — the clipped first
 * frame that handshake exists to end, reintroduced by the polish meant to follow
 * it. The first draft of this feature did exactly that — a *paused* animation
 * still holds a transformed `from` frame — and sent `pillHeight: 35` for a 38px
 * card, measured.
 *
 * jsdom needs both of the things the measurement effect guards on: there is no
 * `ResizeObserver` and every box measures zero, and both of those are *fail-open*
 * paths that release the arrival at once — correct behaviour (DEC-26), and enough
 * to make this test pass without ever reaching the gate it is about.
 */
const measurable = (): (() => void) => {
  const rect = {
    width: 240,
    height: 78,
    top: 0,
    left: 0,
    right: 240,
    bottom: 78,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
  const realRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function box() {
    return rect
  }
  const realObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  }
  return () => {
    Element.prototype.getBoundingClientRect = realRect
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver
  }
}

const pillCard = (): Element => {
  const pill = document.querySelector('[data-pill]')
  if (pill === null) throw new Error('la pilule n’a pas été trouvée')
  return pill
}

test('la pilule n’arrive pas avant que la fenêtre ne soit posée', async () => {
  const restore = measurable()
  try {
    let answer: ((placement: { ok: true; above: boolean }) => void) | null = null
    bridge.when(
      'widget:resize',
      () =>
        new Promise<{ ok: true; above: boolean }>((resolve) => {
          answer = resolve
        }),
    )
    render(<Widget />)

    // The measurement is on the wire and has not been answered.
    await waitFor(() => {
      expect(bridge.calls.some((call) => call.channel === 'widget:resize')).toBe(true)
    })
    expect(pillCard().className).toContain('widget-arriving')
    expect(pillCard().className).not.toContain('widget-arrived')

    await act(async () => {
      answer?.({ ok: true, above: false })
    })
    await waitFor(() => expect(pillCard().className).toContain('widget-arrived'))
    expect(pillCard().className).not.toContain('widget-arriving')
  } finally {
    restore()
  }
})

/**
 * **And a refusal is still an answer, here** — which is the opposite reading of
 * `ok: false` from the test above about `above`, deliberately.
 *
 * For `above` a refusal is a *default* and writing it in relaid the card out
 * mid-fade. For « may this pill be drawn » it is the end of the question: there is
 * no window, nothing else is coming, and a pill that is never painted is worse
 * than one painted early — this window has no taskbar entry and nothing to
 * alt-tab to (DEC-26).
 */
test('un refus de placement dessine quand même la pilule', async () => {
  const restore = measurable()
  try {
    bridge.when('widget:resize', () => ({ ok: false as const, above: false }))
    render(<Widget />)
    await waitFor(() => expect(pillCard().className).toContain('widget-arrived'))
  } finally {
    restore()
  }
})

/**
 * **A renderer that cannot measure at all still draws its pill.**
 *
 * The other half of « every path out ends in a `send()` », one level up: the two
 * environments where the measurement effect returns before it can do anything — no
 * layout box, no `ResizeObserver` — are exactly the two where nothing would ever
 * release the arrival, and an unreleased arrival is an invisible pill over a live
 * call. jsdom is one of them, which is why every other test in this file renders a
 * drawn pill without doing anything about it.
 */
test('un rendu qui ne peut rien mesurer dessine quand même la pilule', async () => {
  render(<Widget />)
  await waitFor(() => expect(pillCard().className).toContain('widget-arrived'))
})
