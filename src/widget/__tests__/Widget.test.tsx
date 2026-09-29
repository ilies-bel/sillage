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
import type {
  ConnectorHealth,
  ConnectorId,
  HealthSnapshot,
} from '../../../electron/core/contracts/health.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Widget } from '../Widget.tsx'
import { MENTION_LABEL, MENTION_NOT_LOGGED, MENTION_NOTE } from '../mention.ts'
/*
 * The sentences the *window* writes when a producer hands it a fragment, read
 * from the shipped table rather than restated here: a copy in a test is a copy
 * that agrees with itself after the product has stopped agreeing with either.
 */
import { WIDGET_SENTENCES } from '../healthSentence.ts'
/*
 * The sentence comes down `widget:state` now (US-19), so the test asserts against the
 * **contract's** default rather than against a constant in the file under test — and a
 * deployment that has configured its own wording is a separate test below, because
 * « the pill hands over what Réglages says » is the whole of what US-19 changed.
 */
import { MENTION_SENTENCE_DEFAULT } from '../../../electron/core/contracts/mention.ts'

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

const recording = (marks: MomentMark[] = [], mentionSentence = MENTION_SENTENCE_DEFAULT) => ({
  mentionSentence,
  meeting: {
    meetingId: 'm1',
    title: 'Néovia Santé — cadrage',
    clientName: 'Néovia Santé',
    startedAt: STARTED,
    marks,
    paused: false,
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
    return { id: 'mk1', at: STARTED + 90_000, note: payload.note ?? '', segmentId: null , by: 'rep' as const }
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
      mark: { id: 'mk1', at: STARTED + 90_000, note: 'plafond achats', segmentId: null, by: 'rep' as const },
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
      mark: { id: 'mk1', at: STARTED + 1_000, note: 'plafnod achats', segmentId: null, by: 'rep' as const },
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
    return { id: 'mk1', at: STARTED + 1_000, note: '', segmentId: null, by: 'rep' as const }
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
      mark: { id: 'mk1', at: STARTED + 1_000, note: '', segmentId: null, by: 'rep' as const },
    })
  })
  expect(await screen.findByRole('button', { name: 'Marquer ce moment (1 déjà marqué)' })).toBeTruthy()
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
      mark: { id: 'mk1', at: STARTED + 1_000, note: 'à revoir', segmentId: null, by: 'rep' as const },
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
    return { id: 'mk1', at: STARTED + 90_000, note: '', segmentId: payload.segmentId ?? null , by: 'rep' as const }
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
      mark: { id: 'mk9', at: STARTED + 10_000, note: 'vu depuis l’app', segmentId: null, by: 'rep' as const },
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
  fireEvent.click(screen.getByRole('button', { name: 'Arrêter définitivement' }))
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

test('the panel says why the client’s name may be drawn over a shared screen', async () => {
  // `setContentProtection(true)` is what makes a heading here defensible, and
  // it was documented in the source and stated nowhere a rep could read it. A
  // rep who does not know it will not open the panel during a share, which is
  // every moment the panel is worth having.
  render(<Widget />)
  await openPanel()

  expect(screen.getByText('Invisible en partage d’écran')).toBeTruthy()
})

test('Pause asks the main process and draws its answer, never its own press', async () => {
  const sent: unknown[] = []
  bridge.when('session:pause', (payload: { meetingId: string; paused: boolean }) => {
    sent.push(payload)
    return { ok: true, paused: payload.paused }
  })
  render(<Widget />)
  await openPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  await waitFor(() => expect(sent).toEqual([{ meetingId: 'm1', paused: true }]))
  // The press alone changes nothing on screen: the broadcast does.
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  await act(async () => {
    bridge.emit('recording:paused', { meetingId: 'm1', paused: true })
  })
  expect(screen.getByRole('button', { name: 'Reprendre' })).toBeTruthy()
  expect(screen.getByText('En pause')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]).toEqual({ meetingId: 'm1', paused: false })
})

/**
 * **The rep's half-typed note survives a pause, and the row says so.**
 *
 * The composer used to stay on screen paused, with the field `disabled` and
 * `unavailable()`'s 43-character sentence stacked inside the same flex row.
 * Measured on the shipped renderer: the field went **252.1 → 89.5 px** and the
 * card **355.6 → 376 px**. A 51-character note rendered **13** characters,
 * `text-overflow: clip`, in a box whose caret could not move — so the rep could
 * not read it, finish it, or tell whether it had survived. A rep pauses because
 * something they should not record just started, which is precisely the moment
 * they are mid-sentence.
 *
 * Nothing in the suite could see it. `widget-pause` presses *Pause* on an
 * **empty** field, and an empty input has `scrollWidth === clientWidth`, so
 * nothing overflows; `--scrollers` is blind to `<input>` besides. This test
 * types first, which is the whole difference.
 */
test('a note typed before Pause is kept, and the row says it is', async () => {
  bridge.when('session:pause', (payload: { meetingId: string; paused: boolean }) => ({
    ok: true,
    paused: payload.paused,
  }))
  render(<Widget />)
  await openPanel()

  const typed = 'revenir sur le plafond achats avant de proposer quoi que ce soit'
  fireEvent.change(screen.getByPlaceholderText('Noter ce moment…'), {
    target: { value: typed },
  })

  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  await act(async () => {
    bridge.emit('recording:paused', { meetingId: 'm1', paused: true })
  })

  // No crippled field: the row is a sentence, and it answers the question the
  // 13-character box left open.
  expect(screen.queryByPlaceholderText('Noter ce moment…')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Marquer' })).toBeNull()
  expect(screen.getByText(/Votre note est conservée/)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }))
  await act(async () => {
    bridge.emit('recording:paused', { meetingId: 'm1', paused: false })
  })

  // Back, untouched — not trimmed, not cleared.
  const back = screen.getByPlaceholderText('Noter ce moment…') as HTMLInputElement
  expect(back.value).toBe(typed)
})

/** With nothing typed there is nothing to promise, so the row does not promise it. */
test('paused with an empty field, the row states the reason and nothing more', async () => {
  bridge.when('session:pause', (payload: { meetingId: string; paused: boolean }) => ({
    ok: true,
    paused: payload.paused,
  }))
  render(<Widget />)
  await openPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  await act(async () => {
    bridge.emit('recording:paused', { meetingId: 'm1', paused: true })
  })

  expect(screen.getByText('En pause : rien n’est enregistré à marquer.')).toBeTruthy()
  expect(screen.queryByText(/Votre note est conservée/)).toBeNull()
})

test('with nothing recording it says so and offers no controls', async () => {
  bridge.when('widget:state', () => ({ meeting: null, mentionSentence: MENTION_SENTENCE_DEFAULT }))
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
  // Held for one `--motion` on its way out — see `CARD_MOTION` — so the
  // assertion is « it goes », never « it is gone in the same tick ».
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

/**
 * **The one card arrives and it leaves, and both cards do both.**
 *
 * The state change this window makes loudest — a refusal, over another
 * application's screen share — appeared between two frames and vanished between
 * two frames. Measured with `shot.mjs --motion` on `widget-refus` and
 * `widget-pause-refus`, at 1280×800 and at 960×600: « 3 élément(s) animé(s) dont
 * **0 qui s'en vont** ». `useDeparture` is the hook for a surface the world
 * removes and it had no caller under `src/widget/` at all.
 *
 * **Both cards and both directions**, because the two ways this slot empties are
 * different mechanisms and a fixture that ran one of them would be the round-17
 * shape again: the rep presses `×`, or a *later press that succeeds* yields the
 * stale card out from under them (`pause`, `forget`, `announce`). The second one
 * has no gesture on the card to intercept, which is the whole reason this is
 * `useDeparture` and not `useDismiss`.
 *
 * What jsdom can see is the class and the mount — the two rules are in
 * `index.css` and the curves are `--motion`'s to judge, on the stage. What it can
 * see is also exactly what was wrong: the element was gone.
 *
 * The mutual exclusion is asserted rather than assumed. `widget-arrive` is an
 * `animation … both` and a filled animation beats a transition on the same
 * property, so a card wearing both classes holds at `opacity: 1` for the whole of
 * its exit and then blinks out — the defect, reintroduced by its own fix.
 */
const cardBox = (): HTMLElement => {
  const card = document.querySelector('[data-card].widget-card-arrive, [data-card].widget-card-leaving')
  if (!card) throw new Error('aucune carte à l’écran')
  return card as HTMLElement
}

test('the refusal card arrives, and leaves whether it is pressed or yielded', async () => {
  let refuse = true
  bridge.when('meeting:mark', () => {
    if (refuse) throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
    return { id: 'mk1', at: STARTED, note: '', segmentId: null, by: 'rep' as const }
  })
  render(<Widget />)
  fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
  await screen.findByRole('alert')

  // Arriving: the entrance, and not the exit.
  expect(cardBox().classList.contains('widget-card-arrive')).toBe(true)
  expect(cardBox().classList.contains('widget-card-leaving')).toBe(false)

  // One: the rep presses the dismiss. Still mounted, now wearing the exit.
  fireEvent.click(screen.getByRole('button', { name: 'Masquer ce message' }))
  expect(screen.queryByRole('alert')).not.toBeNull()
  expect(cardBox().classList.contains('widget-card-leaving')).toBe(true)
  expect(cardBox().classList.contains('widget-card-arrive')).toBe(false)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

  // Two: the world takes it. A *Retirer* that succeeds yields a stale refusal,
  // and there is no gesture on the card for `useDismiss` to intercept.
  refuse = true
  fireEvent.click(screen.getByRole('button', { name: 'Marquer ce moment' }))
  await screen.findByRole('alert')
  refuse = false
  fireEvent.click(screen.getByRole('button', { name: 'Marquer ce moment' }))
  await waitFor(() => expect(cardBox().classList.contains('widget-card-leaving')).toBe(true))
  expect(screen.queryByRole('alert')).not.toBeNull()
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

/**
 * The panel is the largest object on this window and it left between two frames
 * too. Held by the same hook, because three of the four ways it closes are not a
 * gesture on it — the footer's *Replier*, the meeting ending, the window going.
 */
test('the panel is held long enough to leave, and comes back clean', async () => {
  render(<Widget />)
  await screen.findByLabelText('Durée d’enregistrement')
  const chevron = screen.getByRole('button', { name: /le panneau/ })
  fireEvent.click(chevron)
  await screen.findByPlaceholderText('Noter ce moment…')

  const panel = () => document.querySelector('.widget-panel-arrive, .widget-panel-leaving')
  expect(panel()?.classList.contains('widget-panel-arrive')).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Replier le panneau' }))
  expect(panel()).not.toBeNull()
  expect(panel()?.classList.contains('widget-panel-leaving')).toBe(true)
  expect(panel()?.classList.contains('widget-panel-arrive')).toBe(false)
  await waitFor(() => expect(panel()).toBeNull())

  // Reopened: a held exit that left a ghost would give two panels here, and the
  // frame the main process sizes the window to is measured off this box.
  fireEvent.click(chevron)
  await screen.findByPlaceholderText('Noter ce moment…')
  expect(document.querySelectorAll('.widget-panel-arrive, .widget-panel-leaving')).toHaveLength(1)
})

/**
 * **The route the rep actually meets, which the test beside this one did not.**
 *
 * The panel's exit shipped argued over four ways it closes and driven on one.
 * The condition fed to `useDeparture` was the press, and `meetingId !== null`
 * was ANDed at the render site *outside* the hold — so the chevron faded and
 * the meeting ending unmounted the panel on the frame `widget:state` answered
 * `{ meeting: null }`. Sampled frame by frame at 1280×800: the chevron gave
 * « 11 images, entre les deux 5, dernière 0.000 » and the meeting ending gave
 * « 9 images, entre les deux 0, dernière 1.000 » with no exit class at all.
 *
 * `EndOfMeetingWatch` ends a call on every meeting that runs past its grace, so
 * this is the common exit, not the rare one — and what was being torn off at
 * full opacity is 340×205 painted over the client's face on an always-on-top
 * window.
 *
 * The harness cannot hold this: `departureOf` needs a control to press, and
 * this route is a state change with no gesture anywhere on the surface. That is
 * why the check lives here and why the stage could not have caught it.
 */
test('the panel is held when the meeting ends under the rep', async () => {
  render(<Widget />)
  await screen.findByLabelText('Durée d’enregistrement')
  fireEvent.click(screen.getByRole('button', { name: /le panneau/ }))
  await screen.findByPlaceholderText('Noter ce moment…')

  const panel = () => document.querySelector('.widget-panel-arrive, .widget-panel-leaving')
  expect(panel()?.classList.contains('widget-panel-arrive')).toBe(true)

  // Not a gesture: the watch ended it, and `session:changed` is what tells this
  // window to re-read a channel that now answers `{ meeting: null }`.
  bridge.when('widget:state', () => ({ mentionSentence: MENTION_SENTENCE_DEFAULT, meeting: null }))
  bridge.emit('session:changed', { meetingId: 'm1', state: 'ended' })

  await waitFor(() => {
    expect(panel(), 'le panneau a été arraché au lieu de partir').not.toBeNull()
    expect(
      panel()?.classList.contains('widget-panel-leaving'),
      'le panneau est resté sans classe de sortie',
    ).toBe(true)
  })
  await waitFor(() => expect(panel()).toBeNull())
})

test('the mention card arrives and leaves too', async () => {
  const clipboard = withClipboard()
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())
    await screen.findByRole('status')

    expect(cardBox().classList.contains('widget-card-arrive')).toBe(true)
    expect(cardBox().classList.contains('widget-card-leaving')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Masquer cette phrase' }))
    expect(screen.queryByRole('status')).not.toBeNull()
    expect(cardBox().classList.contains('widget-card-leaving')).toBe(true)
    expect(cardBox().classList.contains('widget-card-arrive')).toBe(false)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  } finally {
    clipboard.restore()
  }
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
    by: 'rep' as const,
  }))
  render(<Widget />)

  fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
  await waitFor(() => expect(screen.getByText('Moment marqué.')).toBeTruthy())
  expect(screen.queryByRole('alert')).toBeNull()
})

/**
 * **A refused pause is drawn, and the pill stops claiming the recording.**
 *
 * *Pause* is the only privacy control on this surface: a rep presses it because
 * something that must not be recorded has just started. `Orchestrator.setPaused`
 * returns `false` when it holds no recording for the meeting, and `register.ts`
 * answers with the state *unchanged* — the `EndOfMeetingWatch` gap, the same one
 * `meeting:mark` refuses in.
 *
 * Measured on the shipped window before this test existed: the label still read
 * « Pause », the clock still counted, the pill still drew the `--accent` dot and
 * said « Enregistrement en cours », and the entire receipt was one sentence in a
 * 1×1 `clip: rect(0,0,0,0)` `aria-live` paragraph. The rep believed they were off
 * the record. Nothing in the suite or the harness could produce it: the fixture
 * honoured every request, and there was a `refuseMarks()` and no `refusePause()`.
 *
 * The second assertion is the half a card alone would not buy. A refusal is proof
 * this window's copy is stale, so the re-read has to reach the pill — otherwise
 * the loud half goes on saying a client is being written down while the quiet
 * half explains that they are not.
 */
test('a pause that does not take is drawn, not only announced', async () => {
  /*
   * The refusal the main process really sends, which is **not** the state
   * inverted. `setPaused` answers `ok: false` with `paused: false` — it holds no
   * recording, so nothing is paused. Inverting the request was this fixture's
   * own invention and it staged a world the product cannot be in; it also hid
   * the other direction, below.
   */
  bridge.when('session:pause', () => ({ ok: false, paused: false }))
  render(<Widget />)
  await openPanel()

  // The call ended under the pill — which is why the press was refused.
  bridge.when('widget:state', () => ({ meeting: null, mentionSentence: MENTION_SENTENCE_DEFAULT }))

  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

  const notice = await screen.findByRole('alert')
  expect(notice.textContent).toBe('La pause n’a pas pu être prise.')
  // Not inside the visually-hidden region, which is the whole defect.
  expect(notice.closest('.sr-only')).toBeNull()
  expect(notice.closest('[data-card]')).not.toBeNull()

  // And the surface stops claiming a recording it has just been told is not
  // happening.
  await waitFor(() => expect(screen.getByText('Aucun enregistrement')).toBeTruthy())
})

/**
 * **The other direction, which had a sentence written for it and no way to
 * reach it.**
 *
 * The subject of the rule is « a press on this control that did not land is
 * drawn », and the fixture above has one claimant: *Pause*. *Reprendre* is the
 * other, and it was the one that could not work. `setPaused` answered the state
 * afterwards and nothing else, so `false` was both « resumed » and « there is no
 * recording here »; the renderer compared the answer to its request, found them
 * equal for `next === false`, and drew a success.
 *
 * Driven on the shipped renderer against the answer the main process really
 * gives, before `ok` existed: zero refusal cards, the label still « Reprendre »,
 * the pill still « enregistrement en pause ». A press that does nothing at all,
 * for as long as the rep keeps making it.
 */
test('a Reprendre that does not take is drawn too, and that could not be said before', async () => {
  bridge.when('session:pause', (payload: { meetingId: string; paused: boolean }) => ({
    ok: true,
    paused: payload.paused,
  }))
  render(<Widget />)
  await openPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  await act(async () => {
    bridge.emit('recording:paused', { meetingId: 'm1', paused: true })
  })
  expect(screen.getByRole('button', { name: 'Reprendre' })).toBeTruthy()

  /*
   * The call ends under the pill while it is paused — `EndOfMeetingWatch`'s gap,
   * the one `meeting:mark` refuses in. `setPaused` holds no recording, so it
   * answers `ok: false` with `paused: false`: the *same* `paused` the press asked
   * for, which is exactly why the comparison alone could not see it.
   */
  bridge.when('session:pause', () => ({ ok: false, paused: false }))

  fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }))

  const notice = await screen.findByRole('alert')
  expect(notice.textContent).toBe('L’enregistrement n’a pas pu reprendre.')
  expect(notice.closest('.sr-only')).toBeNull()
  expect(notice.closest('[data-card]')).not.toBeNull()
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
  expect(arrow(screen.getByRole('button', { name: 'Replier le panneau' }))).toBe('up')

  act(() => bridge.emit('widget:placed', { above: true }))
  await waitFor(() => {
    expect(arrow(screen.getByRole('button', { name: 'Replier le panneau' }))).toBe('down')
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
        mark: { id: 'k1', at: STARTED + 30_000, note: '', segmentId: null, by: 'rep' as const },
      })
    })
    const marked = await screen.findByRole('button', { name: /Marquer ce moment \(1 déjà marqué\)/ })
    expect(marked).toBeTruthy()
    const elapsed = screen.getByLabelText('Durée d’enregistrement').textContent

    // The meeting is over on the main process's side from here on: any read of
    // `widget:state` now answers the truth, which is that nothing is recording.
    bridge.when('widget:state', () => ({ meeting: null, mentionSentence: MENTION_SENTENCE_DEFAULT }))

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
    expect(screen.getByRole('button', { name: /Marquer ce moment \(1 déjà marqué\)/ })).toBeTruthy()
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
  expect(arrow(toggle)).toBe('down')

  await act(async () => {
    bridge.emit('widget:leave', {})
    bridge.emit('widget:placed', { above: true })
  })
  expect(arrow(screen.getByRole('button', { name: /^Ouvrir le panneau/ }))).toBe('down')
})

/**
 * Which way the chevron points, off the mark itself.
 *
 * This read `textContent` and compared it to « ▴ »/« ▾ » — U+25B4 and U+25BE,
 * two characters Inter does not carry, so the assertion was pinned to a glyph
 * the operating system chose. The mark is drawn now (`ChevronUp`/`ChevronDown`)
 * and the direction is on the element, which is the thing the test was ever
 * about: « the arrow points where the panel will go ».
 */
function arrow(control: Element): string | null {
  return control.querySelector('[data-arrow]')?.getAttribute('data-arrow') ?? null
}

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
/**
 * The boxes are **content-dependent**, and that is the one property this fixture
 * has to model rather than flatten.
 *
 * It answered a constant 240×78 for every element, which is enough for « was the
 * arrival released » and structurally blind to « how many times was the window
 * sized »: the key `Widget` dedupes on is `width×height×pillTop`, so a fixture
 * that answers one width can only ever produce one measurement, whatever the pill
 * is drawing. A count appearing beside the mark button is a *wider pill* — measured
 * in Chromium on the shipped renderer, 308 → 313 — so the stub width follows the
 * element's own text, which makes the digit cost a pixel here as it costs five
 * there. jsdom lays nothing out; this is the smallest fixture that can be wrong.
 *
 * The `ResizeObserver` is flushable for the same reason. jsdom never calls one, so
 * a stage's « the content grew and the observer noticed » has to be asked for
 * explicitly: `frame()` below is one browser frame.
 */
const observers: Array<() => void> = []
const measurable = (): (() => void) => {
  const realRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function box(this: Element) {
    const width = 240 + (this.textContent?.length ?? 0)
    return {
      width,
      height: 78,
      top: 0,
      left: 0,
      right: width,
      bottom: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }
  const realObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    notify: () => void
    constructor(notify: () => void) {
      this.notify = notify
      observers.push(notify)
    }
    observe(): void {}
    disconnect(): void {
      const at = observers.indexOf(this.notify)
      if (at >= 0) observers.splice(at, 1)
    }
  }
  return () => {
    Element.prototype.getBoundingClientRect = realRect
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver
    observers.length = 0
  }
}

/** One browser frame: whatever the last commit changed, the observer sees. */
const frame = async (): Promise<void> => {
  await act(async () => {
    for (const notify of [...observers]) notify()
    await Promise.resolve()
  })
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

/* ------------------------------------------------------------------------- *
 * US-11 — telling the client they are being transcribed.
 *
 * Granola ships a consent subsystem for this: a native messaging host installed
 * into the browser on both platforms, a socket per user, a browser extension, and
 * a coordinated send that posts the sentence into the meeting chat and arbitrates
 * between two attendees both running it. DEC-49 says this product never joins the
 * call, so what ships here is one press that hands the rep the sentence.
 *
 * jsdom measures no boxes, so nothing below asserts layout — the pill's 24×24 and
 * the card's own box are measured on real layout at both smoke sizes. What jsdom
 * *can* answer is the set of things the press touches, which is the half of this
 * story with a business consequence: it must not send, it must reach the log, and
 * it must claim nothing about the client.
 * ------------------------------------------------------------------------- */

/**
 * The clipboard jsdom does not have.
 *
 * Installed per test rather than globally, because the *absence* of it is a branch
 * this feature ships — `copyText` answers `false` and the card then says « lisez-la
 * à voix haute » instead of « collez-la ». A global stub would make that branch
 * unreachable from here, which is the fixture-cannot-exercise-its-own-property
 * shape this repo keeps producing.
 */
const withClipboard = (): { written: string[]; restore: () => void } => {
  const written: string[] = []
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text)
        return Promise.resolve()
      },
    },
  })
  return {
    written,
    restore: () => {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous)
      else delete (navigator as { clipboard?: unknown }).clipboard
    },
  }
}

const mentionControl = () => screen.getByRole('button', { name: MENTION_LABEL })

/**
 * **One press, the sentence, and nothing sent.**
 *
 * The set of channels is the assertion, not a sample of it. « it never sends » is a
 * claim about every channel that is *not* here — a chat post, a mail draft, a write
 * to the Outlook event body (DEC-10, which mails every attendee and destroys the
 * Teams join blob) — and a docblock cannot hold that. So the press is measured by
 * what it reached: `meeting:mark`, once, and nothing else. `widget:resize` and
 * `widget:passThrough` are excluded by name because they are this window telling
 * the main process how big it is and where the pointer is; they carry no meeting
 * payload and they fire on every content change on this surface.
 */
/**
 * **The pill hands over the ESN's sentence, not ours** (US-19).
 *
 * The half of US-11 that shipped wrong: the wording was a constant in this renderer,
 * so the one piece of *speech* this product puts in front of a client could not be
 * changed without a build. It arrives on `widget:state` now — on every answer,
 * including `{ meeting: null }`, because that is the answer `MEASURE_DEADLINE_MS`
 * treats as settled either way and the control must not be drawn off a placeholder.
 *
 * Asserted in both directions, because only the pair is the property. A file that
 * kept a fallback would pass the first half and fail here: what goes on the clipboard
 * and onto the card is what the *state* said, and this renderer holds no default of
 * its own.
 */
test('c’est la phrase configurée qui part, pas celle du code', async () => {
  const own = 'Cet appel est transcrit par un outil interne. Dites-le si cela vous gêne.'
  bridge.when('widget:state', () => recording([], own))
  const clipboard = withClipboard()
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')

    fireEvent.click(mentionControl())
    await waitFor(() => expect(clipboard.written).toEqual([own]))

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain(own)
    expect(notice.textContent).not.toContain(MENTION_SENTENCE_DEFAULT)
  } finally {
    clipboard.restore()
  }
})

/**
 * And the card keeps the sentence **the press copied**, not the one Réglages holds a
 * moment later.
 *
 * This window re-reads `widget:state` on every `session:changed`, so any answer that
 * carries a different sentence would otherwise rewrite, under the rep's eyes, the one
 * they are in the middle of reading aloud to a client. The card is a record of a press;
 * the field in Réglages is a setting.
 *
 * Note what is *not* claimed, because the obvious assumption is wrong and was written
 * down wrong here once: `settings:setMentionSentence` pushes nothing to this window.
 * `onSettingsChanged` is `drainDeferredEnhancements` in `main.ts` — it retries a
 * compte-rendu waiting on a model (DEC-39) — and a recording has no transitions, so a
 * wording changed *during* a call reaches the pill at the next recording. This test
 * drives `session:changed` directly, which is the real route and the only one.
 */
test('la carte garde la phrase qui a été copiée', async () => {
  const first = 'Première formulation, celle qui a été copiée.'
  const second = 'Deuxième formulation, arrivée après la pression.'
  let sentence = first
  bridge.when('widget:state', () => recording([], sentence))
  const clipboard = withClipboard()
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())
    const notice = await screen.findByRole('status')
    await waitFor(() => expect(notice.textContent).toContain(first))

    // Réglages is saved; the window re-reads its state on the next transition — which
    // is the only route, and is why a mid-call change lands at the next recording.
    sentence = second
    await act(async () => {
      bridge.emit('session:changed', { meetingId: 'm1', state: 'recording' })
    })

    expect((await screen.findByRole('status')).textContent).toContain(first)
    expect(clipboard.written).toEqual([first])
  } finally {
    clipboard.restore()
  }
})

test('la phrase part au presse-papiers et nulle part ailleurs', async () => {
  const clipboard = withClipboard()
  const marks: unknown[] = []
  bridge.when('meeting:mark', (payload) => {
    marks.push(payload)
    return { id: 'mk-mention', at: STARTED + 30_000, note: String(payload.note), segmentId: null , by: 'rep' as const }
  })
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    bridge.calls.length = 0

    fireEvent.click(mentionControl())
    await waitFor(() => expect(clipboard.written).toEqual([MENTION_SENTENCE_DEFAULT]))
    await waitFor(() => expect(marks.length).toBe(1))

    const reached = bridge.calls
      .map((call) => call.channel)
      .filter((channel) => channel !== 'widget:resize' && channel !== 'widget:passThrough')
    expect(reached).toEqual(['meeting:mark'])

    // What the log was told, which is the weakest true claim available: the
    // sentence was copied. Never that it was said, never that anybody agreed.
    // `by: 'product'` is the point: the disclosure is the product's act, not a
    // moment the rep chose, and until that field existed the two were the same
    // row — counted in the pill's number and deletable with the rep's own ×.
    expect(marks).toEqual([
      { meetingId: 'm1', note: MENTION_NOTE(true), segmentId: null, by: 'product' },
    ])
    expect(MENTION_NOTE(true)).toBe('Phrase d’information sur la transcription copiée.')
  } finally {
    clipboard.restore()
  }
})

/**
 * **The sentence is drawn, because the clipboard is invisible.**
 *
 * A press that only wrote to the clipboard would be the `sr-only` paragraph the
 * refused mark was rescued from: nothing on screen changes and the rep — mid-
 * sentence, over a client's face — has no way to tell it worked. Drawing it is also
 * the route the story names first, « or reads it out, which is what a rep does
 * anyway », so the card is the second half of the feature and not a receipt.
 */
test('la phrase est à l’écran, dans une carte, pour être lue à voix haute', async () => {
  const clipboard = withClipboard()
  bridge.when('meeting:mark', () => ({
    id: 'mk-mention',
    at: STARTED + 30_000,
    note: MENTION_NOTE(true),
    segmentId: null,
    by: 'rep' as const,
  }))
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
    // Inside a card: everything on this window that is not one is halo, and halo
    // is handed to Teams with `setIgnoreMouseEvents(…, { forward: true })`.
    expect(notice.closest('[data-card]')).not.toBeNull()
    expect(notice.closest('.sr-only')).toBeNull()
    // `status`, not `alert`: nothing has gone wrong, and this window must not take
    // a rep's keyboard away mid-sentence.
    expect(screen.queryByRole('alert')).toBeNull()

    // And it goes away when asked, rather than on a timer — a sentence a rep is
    // about to read aloud is the last thing to remove after four seconds.
    fireEvent.click(screen.getByRole('button', { name: 'Masquer cette phrase' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  } finally {
    clipboard.restore()
  }
})

/**
 * **No string here claims the client agreed, and none may.**
 *
 * This is the acceptance line with the legal consequence: the product knows it
 * handed the rep a sentence. It cannot know whether the rep said it, and it
 * certainly cannot know what the client answered. So the whole of the window's
 * rendered text after the press is swept for the vocabulary of an obtained
 * consent, and the log's own note is swept with it — a row read back at the gate
 * months later is the one most likely to be mistaken for a receipt.
 */
test('rien ne prétend que le client a donné son accord', async () => {
  const clipboard = withClipboard()
  bridge.when('meeting:mark', () => ({
    id: 'mk-mention',
    at: STARTED + 30_000,
    note: MENTION_NOTE(true),
    segmentId: null,
    by: 'rep' as const,
  }))
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())
    await screen.findByRole('status')

    const claim = /consentement|a accept|a donn[ée]|autoris|accord du client|informé que le client/i
    expect((document.body.textContent ?? '').match(claim)).toBeNull()
    expect(MENTION_NOTE(true).match(claim)).toBeNull()
    expect(MENTION_NOTE(false).match(claim)).toBeNull()
    expect(MENTION_SENTENCE_DEFAULT.match(claim)).toBeNull()
  } finally {
    clipboard.restore()
  }
})

/**
 * **A clipboard that refuses is an ordinary outcome, and the log records the
 * weaker fact.**
 *
 * This window is frameless, transparent, always on top, shown with
 * `showInactive()` and never focused by the app; Chromium refuses `writeText` from
 * an unfocused document. So « copiée » can be false, and a single note saying it
 * anyway would be a false sentence in the one record that exists to be trusted.
 * What the rep is told is the instruction that still works.
 *
 * jsdom has no `navigator.clipboard`, so this test reaches that branch by doing
 * nothing — which is exactly why the stub above is installed per test.
 */
test('un presse-papiers qui refuse est dit, et le journal garde le fait plus faible', async () => {
  const marks: Array<{ note?: string }> = []
  bridge.when('meeting:mark', (payload) => {
    marks.push(payload)
    return { id: 'mk-mention', at: STARTED + 30_000, note: String(payload.note), segmentId: null , by: 'rep' as const }
  })
  render(<Widget />)
  await screen.findByLabelText('Durée d’enregistrement')

  fireEvent.click(mentionControl())
  const notice = await screen.findByRole('status')
  // The sentence is still there — it is the half that matters, and reading it out
  // is the route that never needed a clipboard.
  expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
  expect(notice.textContent).toContain('Copie impossible : lisez-la à voix haute.')
  await waitFor(() => expect(marks.length).toBe(1))
  expect(marks[0]?.note).toBe(MENTION_NOTE(false))
  expect(MENTION_NOTE(false)).toBe('Phrase d’information sur la transcription affichée.')
})

/**
 * **A log that refused says so, and the sentence stays.**
 *
 * `meeting:mark` refuses whenever the meeting is not `recording` — which
 * `EndOfMeetingWatch` can make true with the pill still up — and on any store
 * failure. « did I tell them » is answered from the log, so a write that failed
 * silently would leave the rep believing it had been answered. The card says both
 * things at once because they lead to different next moves: say the sentence
 * anyway, and know that this call carries no record of it.
 */
test('un journal qui refuse est dit, sans emporter la phrase', async () => {
  const clipboard = withClipboard()
  bridge.when('meeting:mark', () => {
    throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
  })
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())

    const notice = await screen.findByRole('status')
    await waitFor(() => expect(notice.textContent).toContain('Non inscrit au journal'))
    expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
  } finally {
    clipboard.restore()
  }
})

/**
 * **A card the rep dismissed does not come back.**
 *
 * The log answers after the card is drawn — deliberately: the sentence is the
 * urgent half and must not wait on SQLite behind a preload hop. So a rep who
 * dismisses in between must not have the card reappear on its own. A card that
 * returns over a client's face with nobody having pressed anything is the one
 * thing DEC-14 forbids of this window.
 */
test('une carte écartée ne revient pas quand le journal répond', async () => {
  const clipboard = withClipboard()
  let answer: (() => void) | null = null
  bridge.when(
    'meeting:mark',
    () =>
      new Promise((resolve) => {
        answer = () =>
          resolve({
            id: 'mk-mention',
            at: STARTED + 30_000,
            note: MENTION_NOTE(true),
            segmentId: null,
            by: 'product' as const,
          })
      }),
  )
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())
    await screen.findByRole('status')

    fireEvent.click(screen.getByRole('button', { name: 'Masquer cette phrase' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())

    await act(async () => {
      answer?.()
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).toBeNull()
  } finally {
    clipboard.restore()
  }
})

/**
 * **It is never a gate.**
 *
 * The acceptance line, driven rather than argued: a rep who never presses the
 * control records exactly as before. Nothing on this window asks whether the
 * sentence was copied — not the mark, not *Terminer*, not the way back into the
 * app — and refusing to record a client call because a sentence was not copied is
 * not this product's decision to make.
 *
 * Also the *other* direction, which is what makes this more than a tautology: a
 * clipboard that is simply absent, which is this environment, leaves every one of
 * those controls working. A feature that failed closed here would take the
 * recording with it.
 */
test('ne rien presser n’empêche rien, et une mention qui échoue n’empêche rien non plus', async () => {
  const ended: unknown[] = []
  const marked: unknown[] = []
  bridge.when('session:command', (payload) => {
    ended.push(payload)
    return { ok: true as const, state: 'ended' as const }
  })
  bridge.when('meeting:mark', (payload) => {
    marked.push(payload)
    return {
      id: `mk${marked.length}`,
      at: STARTED + 1_000,
      note: String(payload.note),
      segmentId: null,
      by: payload.by ?? ('rep' as const),
    }
  })
  render(<Widget />)
  await screen.findByLabelText('Durée d’enregistrement')

  // Never pressed: the mark works and the recording can be ended.
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Marquer ce moment/ }))
  await waitFor(() => expect(marked.length).toBe(1))

  // Pressed, with no clipboard at all: every control is untouched.
  fireEvent.click(mentionControl())
  await waitFor(() => expect(marked.length).toBe(2))
  await openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Terminer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Arrêter définitivement' }))
  expect(ended).toEqual([{ meetingId: 'm1', command: 'end', reason: 'terminée depuis le widget' }])
})

/**
 * **A window on its way out draws no new card, and still writes the log.**
 *
 * The one path in this feature that crosses an `await` before its first paint:
 * `copyText` is an async permission check on the clipboard, so « press the
 * control, press *Terminer* » — or the meeting ending under the rep, which
 * `EndOfMeetingWatch` does — lands `widget:leave` in between. A 145-pixel card
 * arriving *during* the 150 ms fade grows the frame and asks for a `widget:resize`
 * that `Overlay` answers `{ ok: false }`, which is the ~20 px slide measured in
 * `scratch/r26-e2e-widget-last-frame.cjs`. The rule this window already states is
 * « a window that has been told to go away stops taking state ».
 *
 * The write is still made, because it happened, and the log is where « did I tell
 * them » is answered. Only the drawing is dropped.
 */
test('une fenêtre qui s’en va ne dessine pas de nouvelle carte, et écrit quand même', async () => {
  const marks: unknown[] = []
  bridge.when('meeting:mark', (payload) => {
    marks.push(payload)
    return { id: 'mk-mention', at: STARTED + 30_000, note: String(payload.note), segmentId: null , by: 'rep' as const }
  })
  let release: (() => void) | null = null
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    },
  })
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())

    // The recording ends while the clipboard is still deciding.
    act(() => {
      bridge.emit('widget:leave', {})
    })
    await act(async () => {
      release?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(marks.length).toBe(1))
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous)
    else delete (navigator as { clipboard?: unknown }).clipboard
  }
})

/**
 * **The control arrives with the real pill, never with the placeholder.**
 *
 * `MEASURE_DEADLINE_MS` holds the window off screen until `widget:state` has
 * settled, precisely so the main process never sizes a frameless always-on-top
 * window to a pill saying « Aucun enregistrement ». A control that appeared before
 * that read would be 32 px of width arriving *after* the measurement the window was
 * revealed at — the clipped-first-frame defect DEC-50 closed, reintroduced by this
 * story. It is drawn on exactly the condition the mark button is.
 */
test('la mention n’est pas dessinée avant que l’état n’arrive', async () => {
  let settle: ((value: ReturnType<typeof recording>) => void) | null = null
  bridge.when(
    'widget:state',
    () =>
      new Promise<ReturnType<typeof recording>>((resolve) => {
        settle = resolve
      }),
  )
  render(<Widget />)

  expect(await screen.findByText('Aucun enregistrement')).toBeTruthy()
  expect(screen.queryByRole('button', { name: MENTION_LABEL })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Marquer ce moment/ })).toBeNull()

  await act(async () => {
    settle?.(recording())
    await Promise.resolve()
  })
  expect(screen.getByRole('button', { name: MENTION_LABEL })).toBeTruthy()
})

/* ------------------------------------------------------------------------- *
 * R33-2 — the precedence between the two cards, asked of the writer.
 *
 * The render carried it correctly and the writer undid it: `announce()` opened
 * with `setSaid(null)`, so the guard could never fire for a refusal that existed
 * before the press. Measured on the shipped renderer at 1280×800 and 960×600,
 * two controls 32 px apart:
 *
 *   après « Marquer » (refusé)      refus visible : oui   carte phrase : non
 *   après « Prévenir le client »    refus visible : NON   carte phrase : oui
 *
 * What is asserted here is the *state*, which is where the fix is: one card, one
 * union, the precedence applied at the write. jsdom cannot measure the boxes —
 * `widget-refus` does that on real layout, and the mention card is measured by
 * nothing until US-20 adds its stage.
 * ------------------------------------------------------------------------- */

test('un refus que le commercial n’a pas écarté survit à la commande voisine', async () => {
  const clipboard = withClipboard()
  const reached: unknown[] = []
  bridge.when('meeting:mark', (payload) => {
    reached.push(payload)
    throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
  })
  try {
    render(<Widget />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
    const refusal = await screen.findByRole('alert')
    expect(refusal.textContent).toContain('Aucun enregistrement en cours')

    fireEvent.click(mentionControl())
    await waitFor(() => expect(reached.length).toBe(2))

    /*
     * The refusal is still the card, and the mention drew none. The moment the rep
     * marked is not in the record and the only thing that said so is still on
     * screen — which is the whole of this finding.
     */
    expect(screen.getByRole('alert').textContent).toContain('Aucun enregistrement en cours')
    expect(screen.queryByRole('status')).toBeNull()

    /*
     * And it yields rather than losing: the sentence went to the clipboard, the log
     * write was made, and the card is one press away once the refusal is dismissed.
     * A control that swallowed the press entirely would be the dead control DEC-26
     * forbids.
     */
    expect(clipboard.written).toEqual([MENTION_SENTENCE_DEFAULT])
  } finally {
    clipboard.restore()
  }
})

test('la phrase revient dès que le refus est écarté, sans réécrire au journal', async () => {
  const clipboard = withClipboard()
  const reached: unknown[] = []
  let refuse = true
  bridge.when('meeting:mark', (payload) => {
    reached.push(payload)
    if (refuse) throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
    return { id: `mk${reached.length}`, at: STARTED, note: String(payload.note), segmentId: null, by: payload.by ?? ('rep' as const) }
  })
  try {
    render(<Widget />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
    await screen.findByRole('alert')
    refuse = false
    fireEvent.click(mentionControl())
    await waitFor(() => expect(reached.length).toBe(2))
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Masquer ce message' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    fireEvent.click(mentionControl())
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
    /*
     * Two presses, one sentence, one row: the yield did not cost the write and the
     * second press did not repeat it. The card says the log has it, because it does.
     */
    expect(reached.length).toBe(2)
    await waitFor(() => expect(notice.textContent).not.toContain('Non inscrit'))
  } finally {
    clipboard.restore()
  }
})

/**
 * **Two presses, one sentence, one row.**
 *
 * Measured on the shipped renderer at both smoke sizes, counted off the pill's own
 * counter, which is the receipt for a write that landed: « départ 2 · après 1
 * pression 3 · après 2 **4** ». `meeting:mark` has no idempotency key, the row is
 * read back at the gate in a list of the rep's own notes, and the press is a 24-pixel
 * control over a client's face.
 */
test('une phrase déjà inscrite au journal n’y est pas inscrite deux fois', async () => {
  const clipboard = withClipboard()
  const reached: string[] = []
  bridge.when('meeting:mark', (payload) => {
    reached.push(String(payload.note))
    return { id: `mk${reached.length}`, at: STARTED, note: String(payload.note), segmentId: null, by: payload.by ?? ('rep' as const) }
  })
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())
    const notice = await screen.findByRole('status')
    await waitFor(() => expect(reached.length).toBe(1))

    fireEvent.click(mentionControl())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(reached).toEqual([MENTION_NOTE(true)])
    // The sentence is still on screen, and it still says the log has it.
    expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
    expect(notice.textContent).not.toContain('Non inscrit')

    /*
     * Dismissing ends the act. A press after it is a new telling — a second person
     * joining the call at minute 40 — and it is written down.
     */
    fireEvent.click(screen.getByRole('button', { name: 'Masquer cette phrase' }))
    fireEvent.click(mentionControl())
    await waitFor(() => expect(reached.length).toBe(2))
  } finally {
    clipboard.restore()
  }
})

/**
 * **The round's own sequence: the second press lands while the first write is on
 * the wire.**
 *
 * Two rows for one sentence, and the first press's refusal reported nowhere,
 * because press 2's card replaced press 1's and a press *token* could then only say
 * « not mine » and drop the answer. The card is identified by its sentence now, so
 * the one write's answer is the one card's answer.
 */
test('une seconde pression pendant l’écriture n’écrit rien et hérite de la réponse', async () => {
  const clipboard = withClipboard()
  const reached: string[] = []
  let refuse: ((error: Error) => void) | null = null
  bridge.when('meeting:mark', (payload) => {
    reached.push(String(payload.note))
    return new Promise((_resolve, reject) => {
      refuse = reject
    }) as never
  })
  try {
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    fireEvent.click(mentionControl())
    const notice = await screen.findByRole('status')
    await waitFor(() => expect(reached.length).toBe(1))

    fireEvent.click(mentionControl())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(reached.length).toBe(1)

    await act(async () => {
      refuse?.(new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.'))
      await Promise.resolve()
      await Promise.resolve()
    })
    // The refusal is reported, on the card that is on screen.
    expect(notice.textContent).toContain(MENTION_NOT_LOGGED)
    expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
  } finally {
    clipboard.restore()
  }
})

/**
 * **A mark that worked is still announced and still draws nothing**, and it no
 * longer takes a sentence off the screen with it.
 *
 * The other half of « one card, one state »: a success rides the polite region, so a
 * rep who is halfway through reading the sentence to a client keeps it. What a
 * success *does* spend is a refusal from the same control — same gesture, same rep,
 * looking at the card.
 */
test('une marque réussie annonce, n’écarte pas la phrase, et solde le refus', async () => {
  const clipboard = withClipboard()
  let refuse = true
  bridge.when('meeting:mark', (payload) => {
    if (refuse) throw new Error('Aucun enregistrement en cours — il n’y a pas de moment à marquer.')
    return { id: 'mk1', at: STARTED, note: String(payload.note), segmentId: null , by: 'rep' as const }
  })
  try {
    render(<Widget />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marquer ce moment' }))
    await screen.findByRole('alert')

    refuse = false
    fireEvent.click(mentionControl())
    // Refused mark still on screen, so the mention yields.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Masquer ce message' }))
    fireEvent.click(mentionControl())
    const notice = await screen.findByRole('status')

    // A mark that works: announced, and the sentence stays.
    fireEvent.click(screen.getByRole('button', { name: /^Marquer ce moment/ }))
    await waitFor(() => expect(screen.getByText('Moment marqué.')).toBeTruthy())
    expect(notice.textContent).toContain(MENTION_SENTENCE_DEFAULT)
    expect(screen.queryByRole('alert')).toBeNull()
  } finally {
    clipboard.restore()
  }
})

/* ------------------------------------------------------------------------- *
 * R33-5 — the window is sized once, off a pill that is already complete.
 *
 * `loadedMarks` was applied in a `useEffect`, which runs *after* `Frame`'s
 * measurement `useLayoutEffect` in the same commit — child effects before parent
 * effects — so the pill the main process sized the window to carried a mark button
 * with no count. Measured on the shipped renderer, both smoke sizes:
 *
 *   demandes widget:resize : 2
 *     +297 ms  308×78  compteur «  »
 *     +460 ms  313×78  compteur « 2 »
 *
 * Five pixels is 2.5 of window x — `placeAroundPill` holds the pill's *centre* —
 * over the face of the person on the call, at the instant the rep presses
 * *Enregistrer*. With `marks=0` there was exactly one ask, so « 3 asks → 1 » held
 * only for a meeting with none, which the crash-recovered and rehydrated cases are
 * not.
 *
 * `widget-entree` reads `window.__entree[0]` and never `__entree.length`: an
 * assertion about the first ask cannot tell one ask from two. The **count** is
 * asserted here, with what the pill was drawing when each ask went out; the pixel
 * widths stay a browser measurement, and remain outside every gate until US-20.
 * ------------------------------------------------------------------------- */

/** Every `widget:resize`, with what the pill was drawing at the moment it left. */
const watchAsks = (): Array<{ size: string; counter: string }> => {
  const asks: Array<{ size: string; counter: string }> = []
  bridge.when('widget:resize', (payload) => {
    asks.push({
      size: `${payload.width}×${payload.height}`,
      counter:
        document.querySelector('[data-pill] [aria-label^="Marquer"]')?.textContent?.trim() ?? '',
    })
    return { ok: true as const, above: false }
  })
  return asks
}

test('une réunion qui porte déjà des marques ne fait mesurer la fenêtre qu’une fois', async () => {
  const restore = measurable()
  try {
    const asks = watchAsks()
    bridge.when('widget:state', () =>
      recording([
        { id: 'mk1', at: STARTED + 1_000, note: '', segmentId: null, by: 'rep' as const },
        { id: 'mk2', at: STARTED + 2_000, note: 'plafond achats', segmentId: null, by: 'rep' as const },
      ]),
    )
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    await act(async () => {
      await Promise.resolve()
    })
    // The observer gets its look at whatever the commit changed.
    await frame()

    expect(asks.length).toBe(1)
    // And the one measurement was taken off a pill that already carried the count.
    expect(asks[0]?.counter).toBe('2')
    // The list the panel draws is the same one, so nothing was traded for the pixel.
    expect(screen.getByRole('button', { name: 'Marquer ce moment (2 déjà marqués)' })).toBeTruthy()
  } finally {
    restore()
  }
})

/**
 * The control: a meeting with no marks. One ask either way, which is what makes the
 * test above a statement about the *count* and not about the fixture.
 */
test('une réunion sans marque ne fait pas mesurer la fenêtre davantage', async () => {
  const restore = measurable()
  try {
    const asks = watchAsks()
    render(<Widget />)
    await screen.findByLabelText('Durée d’enregistrement')
    await act(async () => {
      await Promise.resolve()
    })
    await frame()
    expect(asks.length).toBe(1)
    expect(asks[0]?.counter).toBe('')
  } finally {
    restore()
  }
})

/**
 * **A second recording in one window gets its own marks**, which is the other half
 * of keying the seed on the meeting rather than on « the list is empty ».
 *
 * The old guard was `was.length === 0`, so a window that had already collected one
 * call's marks kept them over the next call — a count on the pill and rows in the
 * panel belonging to a conversation that had ended. `session:changed` is the
 * broadcast that carries exactly that transition.
 */
test('un second enregistrement dans la même fenêtre porte ses propres marques', async () => {
  bridge.when('widget:state', () =>
    recording([{ id: 'mk1', at: STARTED + 1_000, note: 'premier appel', segmentId: null, by: 'rep' as const }]),
  )
  render(<Widget />)
  expect(await screen.findByRole('button', { name: 'Marquer ce moment (1 déjà marqué)' })).toBeTruthy()

  bridge.when('widget:state', () => ({
    mentionSentence: MENTION_SENTENCE_DEFAULT,
    meeting: {
      meetingId: 'm2',
      title: 'Sodexial — comité de staffing',
      clientName: 'Sodexial',
      startedAt: STARTED + 3_600_000,
      marks: [], paused: false,
    },
  }))
  await act(async () => {
    bridge.emit('session:changed', { meetingId: 'm2', state: 'recording' })
    await Promise.resolve()
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Marquer ce moment' })).toBeTruthy(),
  )
  await openPanel()
  expect(screen.queryByText('premier appel')).toBeNull()
})

/*
 * ── The two required channels, and the one strip that reports them ──────────
 *
 * `grep -c 'health:changed\|health:snapshot'` over this file returned **0**
 * before these four tests. The widget's own docblock calls the strip « the one
 * reading that says the product is failing », and it was fed by one harness
 * stage emitting one connector from a static table and asserted by nothing at
 * all — so the two writers into `trouble` were free to disagree, and did.
 */

/**
 * All six, because the orchestrator seeds all six at construction and
 * `HealthSnapshot` is a total record — a fixture shorter than the product's own
 * answer is a fixture simpler than the thing under test.
 */
const snapshot = (
  troubled: Partial<Record<ConnectorId, ConnectorHealth>>,
): HealthSnapshot => ({
  capture: { state: 'ok' },
  transcribe: { state: 'ok' },
  calendar: { state: 'ok' },
  llm: { state: 'ok' },
  crm: { state: 'ok' },
  mail: { state: 'ok' },
  ...troubled,
})

/**
 * **`Orchestrator.ts:482`'s reason, word for word — and it is a fragment, not a
 * sentence.**
 *
 * Lowercase, unterminated, no remedy: a state machine's note to itself. It is
 * the fixture on purpose, because it is what a rep met on `widget-deux-pannes`
 * before `healthSentence.ts` existed. The assertions below read
 * `WIDGET_SENTENCES.transcribe.down` — what the window says *instead* — so a
 * change that let the raw string back through fails them.
 */
const TRANSCRIBE_DOWN = {
  state: 'down' as const,
  reason: 'aucun fournisseur de transcription disponible',
  since: STARTED + 120_000,
  retryable: true,
}

/**
 * `capture/index.ts` `#checkOutputRoute`, word for word — DEC-32's `degraded`,
 * and one of the seven reasons in the tree that *is* a written sentence. It
 * names the side and the remedy, so the window renders it verbatim rather than
 * replacing it with its own, blunter one.
 */
const CAPTURE_DEGRADED = {
  state: 'degraded' as const,
  reason:
    'La sortie audio de l’ordinateur a changé pendant l’appel — le son du client peut ne plus être capté. Terminez et redémarrez l’enregistrement pour le reprendre.',
  since: STARTED + 60_000,
  retryable: true,
}

/**
 * **A capture blip that recovers must not erase a transcription that is still
 * dead.**
 *
 * Both connectors report on `health:changed`, independently, for the length of
 * the call (`Recording.ts` wires `capture.on('health')` and
 * `transcribe.on('health')` to the same `onHealth`), and `health:retry` on the
 * capture row in Réglages publishes `capture: ok` mid-call. Collapsing two
 * connectors into one string at the point of receipt means the later edge wins
 * whatever it says: the strip went silent for the rest of the call with no
 * transcription happening, on the one surface whose job is to say so.
 */
test('une panne de transcription survit au rétablissement de la capture', async () => {
  bridge.when('health:snapshot', () => snapshot({}))
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('health:changed', {
      connector: 'transcribe',
      health: TRANSCRIBE_DOWN,
      at: STARTED + 120_000,
    })
  })
  expect(await screen.findByText(WIDGET_SENTENCES.transcribe.down)).toBeTruthy()

  act(() => {
    bridge.emit('health:changed', {
      connector: 'capture',
      health: { state: 'ok' },
      at: STARTED + 130_000,
    })
  })
  expect(screen.queryByText(WIDGET_SENTENCES.transcribe.down)).toBeTruthy()
})

/**
 * **The strip names the worst live channel, not the first one in an array.**
 *
 * The snapshot path called its variable `worst` and took `.find()` over
 * `['capture', 'transcribe']` — the *first* non-`ok`, which is a different
 * question. A capture that is `degraded` (half the call still recorded, DEC-32)
 * therefore outranked a transcription that is `down` (nothing recorded at all),
 * for as long as both were true. `aggregateStatus` is the repo's one ranking of
 * these states and it is what decides now.
 */
test('le canal le plus atteint parle, pas le premier de la liste', async () => {
  bridge.when('health:snapshot', () =>
    snapshot({ capture: CAPTURE_DEGRADED, transcribe: TRANSCRIBE_DOWN }),
  )
  render(<Widget />)
  await openPanel()

  expect(await screen.findByText(WIDGET_SENTENCES.transcribe.down)).toBeTruthy()
  expect(screen.queryByText(CAPTURE_DEGRADED.reason)).toBeNull()
})

/**
 * And the one it was holding back comes forward when the worse one clears —
 * which is what makes « the worst, not a list » honest rather than lossy.
 */
test('le canal encore atteint reprend la parole quand le pire se rétablit', async () => {
  bridge.when('health:snapshot', () =>
    snapshot({ capture: CAPTURE_DEGRADED, transcribe: TRANSCRIBE_DOWN }),
  )
  render(<Widget />)
  await openPanel()
  expect(await screen.findByText(WIDGET_SENTENCES.transcribe.down)).toBeTruthy()

  act(() => {
    bridge.emit('health:changed', {
      connector: 'transcribe',
      health: { state: 'ok' },
      at: STARTED + 200_000,
    })
  })
  expect(await screen.findByText(CAPTURE_DEGRADED.reason)).toBeTruthy()
})

/**
 * **An edge that beats the snapshot home is not overwritten by it.**
 *
 * The snapshot is one preload hop issued at mount and the edges are a stream;
 * seeding from the answer when it lands would republish a reading that was
 * already stale when it was taken. Driven with the answer held until after the
 * edge, which is the order a window created *during* a meeting can genuinely
 * see.
 */
test('un état arrivé avant l’instantané n’est pas écrasé par lui', async () => {
  let answer: (value: HealthSnapshot) => void = () => {}
  bridge.when(
    'health:snapshot',
    () =>
      new Promise<HealthSnapshot>((resolve) => {
        answer = resolve
      }),
  )
  render(<Widget />)
  await openPanel()

  act(() => {
    bridge.emit('health:changed', {
      connector: 'transcribe',
      health: TRANSCRIBE_DOWN,
      at: STARTED + 120_000,
    })
  })
  expect(await screen.findByText(WIDGET_SENTENCES.transcribe.down)).toBeTruthy()

  await act(async () => {
    answer(snapshot({}))
    await Promise.resolve()
  })
  expect(screen.queryByText(WIDGET_SENTENCES.transcribe.down)).toBeTruthy()
})

/**
 * The health slot, named by its attribute and not by its role: the mention card
 * is also a `role="status"` on this surface, so « the status » is two elements
 * and a bare `getByRole` answers with whichever React rendered first.
 */
const healthRegion = async () => {
  const region = await waitFor(() => {
    const found = screen.getAllByRole('status').filter((el) => el.hasAttribute('data-health'))
    expect(found, 'la fente de santé n’est pas une région vivante').toHaveLength(1)
    return found[0]
  })
  return region
}

/**
 * **What the slot held before `healthSentence.ts`, and why jsdom can see it.**
 *
 * Round 23 fixed *which* connector speaks. It did not fix *how*, and the stage
 * the fix added is what exposed the rest: `aggregateStatus` returns the
 * connector's `reason` verbatim — correctly, that is its contract — and five of
 * the twelve producers compose a fragment for themselves rather than a sentence
 * for a rep. Measured on the shipped renderer at 1280×800 and 960×600 before
 * this landed, the slot read:
 *
 *     « aucun fournisseur de transcription disponible »   role: null  aria-live: null
 *
 * on a card that is over everything the rep is sharing, during a call. The two
 * tests below are the jsdom half: the string and the wiring, which is all jsdom
 * can answer for. The box it sits in is `widget-deux-pannes`' half.
 */
test('un fragment interne n’atteint jamais l’écran du commercial', async () => {
  bridge.when('health:snapshot', () => snapshot({ transcribe: TRANSCRIBE_DOWN }))
  render(<Widget />)
  await openPanel()

  const line = await healthRegion()
  /*
   * Asserted as an inequality against the *producer's own literal*, not against
   * a predicate: a check that re-applied `isWrittenSentence` here would pass on
   * a fix that had been reverted and a predicate that had been loosened to
   * match. This one can only pass if the string changed.
   */
  expect(line.textContent).not.toBe(TRANSCRIBE_DOWN.reason)
  expect(line.textContent).toBe(WIDGET_SENTENCES.transcribe.down)
  expect(line.getAttribute('data-written')).toBe('widget')
})

/**
 * And the other half, which is what stops the fix from being « replace
 * everything »: a producer that *did* write a sentence keeps it, because it
 * names the channel — « le son du client » — and nothing derivable from
 * `AppStatus` can.
 */
test('une phrase écrite par le producteur est rendue telle quelle', async () => {
  bridge.when('health:snapshot', () => snapshot({ capture: CAPTURE_DEGRADED }))
  render(<Widget />)
  await openPanel()

  const line = await healthRegion()
  expect(line.textContent).toBe(CAPTURE_DEGRADED.reason)
  expect(line.getAttribute('data-written')).toBe('connector')
})

/**
 * **The live region is there before it has anything to say.**
 *
 * A polite region inserted *with* its text is announced by no assistive
 * technology reliably — it has to be in the accessibility tree before the text
 * changes. So the region is mounted unconditionally and the text arrives into
 * it, which is the sequence this drives: a healthy panel, then an edge.
 *
 * `role="status"` and not `role="alert"`: this is a condition that lasts the
 * rest of the call and changes hands while it lasts, not a transient answer to
 * a press. Asserted rather than described, because the element carried neither
 * role for the life of this file.
 */
test('la région vivante existe avant d’avoir quelque chose à dire', async () => {
  bridge.when('health:snapshot', () => snapshot({}))
  render(<Widget />)
  await openPanel()

  const line = await healthRegion()
  expect(line.textContent).toBe('')
  expect(line.getAttribute('aria-live')).toBe('polite')
  expect(line.getAttribute('aria-atomic')).toBe('true')

  act(() => {
    bridge.emit('health:changed', {
      connector: 'transcribe',
      health: TRANSCRIBE_DOWN,
      at: STARTED + 120_000,
    })
  })
  // The same node, not a new one — a region replaced is a region reinserted.
  expect(await healthRegion()).toBe(line)
  expect(line.textContent).toBe(WIDGET_SENTENCES.transcribe.down)
})
