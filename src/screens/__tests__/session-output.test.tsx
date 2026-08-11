/**
 * What the session screen does with the two things a rep arrives without: a
 * name for the meeting, and — until the analysis lands — a compte-rendu.
 *
 * Both used to be somebody else's problem. The objet was a required field on a
 * form in front of the microphone; the compte-rendu was behind *Relire et
 * valider* on a screen called *Revue*, so a rep pressed *Terminer*, waited
 * several minutes, and was shown their own notes again with a button beside
 * them. Nothing on screen was the output.
 *
 * The invariants underneath are unchanged and are what these tests guard:
 *
 *  · **DEC-5 / DEC-14** — the pane is a *read* beside the notepad, never a write
 *    into it. The rep's notes stay editable and stay theirs.
 *  · **DEC-23** — nothing about the compte-rendu exists while the meeting is
 *    recording, including the control that would switch to it.
 *  · **DEC-4** — this is not a second gate. No form, no intents, no button that
 *    sends anything; *Relire et valider* is still the only door.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Meeting, MeetingState } from '../../../electron/core/contracts/meeting.ts'
import type { RecipeId } from '../../../electron/core/contracts/recipes.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Session } from '../Session.tsx'

let bridge: FakeBridge
let uninstall: () => void

const COMPTE_RENDU = '# Néovia Santé\n\n## Résumé\n\nCadrage du renfort data.\n'

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'm-1',
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
  ...over,
})

/** The screen as the main process would answer for it. */
const open = (
  over: Partial<Meeting> = {},
  compteRendu: string | null = null,
  recipe: RecipeId = 'besoin-commercial',
) => {
  bridge.when('meeting:get', () => ({
    meeting: meeting(over),
    segments: [],
    signals: [],
    outbox: [],
    document: null,
    compteRendu,
    recipe,
  }))
  return render(<Session meetingId="m-1" onBack={() => {}} onReview={() => {}} />)
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('the compte-rendu appears where the rep already is', () => {
  test('a meeting with one shows it beside the notes, without being asked', async () => {
    open({ state: 'awaiting_confirmation' }, COMPTE_RENDU)

    // Not behind a click: the rail defaults to it the moment one exists, because
    // it is what the rep pressed *Terminer* to get.
    expect(await screen.findByText(/Cadrage du renfort data/)).toBeTruthy()

    // And their own notes are still there, still the editable surface (DEC-5).
    // By the ProseMirror host itself: the pane beside it must not be able to
    // take the notepad's place, only sit next to it.
    expect(document.querySelector('.ProseMirror')).toBeTruthy()
  })

  test('it is a read, not the gate — no form and no second confirmation (DEC-4)', async () => {
    open({ state: 'awaiting_confirmation' }, COMPTE_RENDU)
    await screen.findByText(/Cadrage du renfort data/)

    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
    expect(screen.queryByText(/Ce qui sera créé/)).toBeNull()
    // The one door is still on screen and still the only one.
    expect(screen.getByRole('button', { name: 'Relire et valider' })).toBeTruthy()
  })

  test('nothing about it exists while the meeting is recording (DEC-23)', async () => {
    open({ state: 'recording' }, null)
    await screen.findByRole('button', { name: 'Terminer' })

    expect(screen.queryByText(/Compte-rendu/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Compte-rendu' })).toBeNull()
  })

  /*
   * This used to assert the rail *switch*: clicking « Signaux » swapped the
   * compte-rendu pane out for the slate. There is no switch any more — both
   * columns are drawn at once, because the only way to judge a compte-rendu
   * against the slate is to see « Durée — » empty *and* the document silent
   * about it in one glance.
   *
   * What survives of the old test is the part that was actually load-bearing:
   * the rep can still get rid of the panel, and getting rid of it costs them
   * nothing (DEC-11).
   */
  test('the rep can put both panes away, and the notepad is what is left', async () => {
    open({ state: 'awaiting_confirmation' }, COMPTE_RENDU)
    await screen.findByText(/Cadrage du renfort data/)

    // Both are on screen together, unasked.
    expect(screen.getByText(/Ne se réordonne pas|Se remplit à mesure/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Panneau' }))

    expect(screen.queryByText(/Cadrage du renfort data/)).toBeNull()
    expect(screen.queryByText(/Ne se réordonne pas|Se remplit à mesure/)).toBeNull()
    // The surface the rep owns is untouched by any of it (DEC-5).
    expect(document.querySelector('.ProseMirror')).toBeTruthy()
  })
})

/**
 * The recipe picker (DEC-43).
 *
 * Two behaviours, and the difference between them is the whole safety of the
 * control: before a compte-rendu exists a click is the gesture, and after one
 * exists a click only *arms* the gesture — because the second one spends a model
 * call and replaces a document the rep may be reading.
 */
describe('choosing what the compte-rendu will be', () => {
  test('mid-call, switching is one click and nothing is at stake', async () => {
    open({ state: 'recording' }, null)
    let asked: unknown = null
    bridge.when('meeting:recipe', (payload) => {
      asked = payload
      return { recipe: 'libre' as const, regenerating: false, state: 'recording' as const }
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Libre' }))

    await waitFor(() => expect(asked).toEqual({ meetingId: 'm-1', recipe: 'libre' }))
    // No confirmation strip: there is no document to replace.
    expect(screen.queryByText(/Réécrire le compte-rendu/)).toBeNull()
  })

  test('after a compte-rendu exists, a click asks first and names what it replaces', async () => {
    open({ state: 'awaiting_confirmation' }, COMPTE_RENDU)
    let called = false
    bridge.when('meeting:recipe', () => {
      called = true
      return {
        recipe: 'libre' as const,
        regenerating: true,
        state: 'extracting' as const,
      }
    })

    // The document first: what arms the confirmation is a compte-rendu existing,
    // and it reaches the screen one read after the meeting does.
    await screen.findByText(/Cadrage du renfort data/)
    fireEvent.click(screen.getByRole('button', { name: 'Libre' }))

    // Nothing has been sent yet — the click armed a question, not a rewrite.
    expect(called).toBe(false)
    expect(screen.getByText(/Réécrire le compte-rendu/)).toBeTruthy()
    // And the sentence says what goes and what stays.
    expect(screen.getByText(/vos notes et la transcription ne changent pas/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Réécrire' }))
    await waitFor(() => expect(called).toBe(true))
  })

  test('cancelling leaves the meeting on the recipe it had', async () => {
    open({ state: 'awaiting_confirmation' }, COMPTE_RENDU)
    let called = false
    bridge.when('meeting:recipe', () => {
      called = true
      return { recipe: 'libre' as const, regenerating: true, state: 'extracting' as const }
    })

    await screen.findByText(/Cadrage du renfort data/)
    fireEvent.click(screen.getByRole('button', { name: 'Libre' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(called).toBe(false)
    expect(screen.queryByText(/Réécrire le compte-rendu/)).toBeNull()
    // The document is still the one that was there.
    expect(screen.getByText(/Cadrage du renfort data/)).toBeTruthy()
  })

  test('a run in flight locks the picker rather than greying a live control', async () => {
    open({ state: 'extracting' }, null)
    await screen.findByText(/rédaction en cours/)

    // No toggle at all — not a disabled one. `Segmented` has no disabled state,
    // and a row of greyed pills that still look pressable is the dead control
    // DEC-26 forbids.
    expect(screen.queryByRole('button', { name: 'Libre' })).toBeNull()
  })

  test('the free recipe’s rail says the plan is decided at the end (DEC-43)', async () => {
    open({ state: 'recording' }, null, 'libre')

    // No slate — and the reason, so an empty rail cannot read as a broken one.
    expect(await screen.findByText(/le plan du compte-rendu sera décidé à la fin/)).toBeTruthy()
    expect(screen.queryByText('TJM')).toBeNull()
    expect(screen.queryByText('Profil')).toBeNull()
  })
})

describe('the meeting names itself where the rep is, not before the call', () => {
  test('an untitled meeting says so as a hint, never as a stored value', async () => {
    open({ title: '', clientName: null })

    const objet = (await screen.findByLabelText('Objet de la réunion')) as HTMLInputElement
    expect(objet.value).toBe('')
    expect(objet.placeholder).toBe('Sans objet')
  })

  test('typing an objet renames the meeting on blur, once', async () => {
    bridge.when('meeting:rename', () => meeting({ title: 'Cadrage Nordis' }))
    open({ title: '', clientName: null })

    const objet = await screen.findByLabelText('Objet de la réunion')
    fireEvent.change(objet, { target: { value: 'Cadrage Nordis' } })

    // Not per keystroke — `meeting:rename` appends an event to the meeting's log.
    expect(bridge.calls.some((c) => c.channel === 'meeting:rename')).toBe(false)

    await act(async () => {
      fireEvent.blur(objet)
    })

    await waitFor(() =>
      expect(bridge.calls.find((c) => c.channel === 'meeting:rename')?.payload).toMatchObject({
        meetingId: 'm-1',
        title: 'Cadrage Nordis',
      }),
    )
  })

  test('a blur that changed nothing sends nothing', async () => {
    open({ title: 'Point Acme' })

    const objet = await screen.findByLabelText('Objet de la réunion')
    await act(async () => {
      fireEvent.blur(objet)
    })

    expect(bridge.calls.some((c) => c.channel === 'meeting:rename')).toBe(false)
  })

  test('the meeting can be named during the call, not only after it', async () => {
    bridge.when('meeting:rename', () => meeting({ title: 'Point Nordis' }))
    open({ state: 'recording', title: '' })

    await screen.findByRole('button', { name: 'Terminer' })
    const objet = screen.getByLabelText('Objet de la réunion')
    fireEvent.change(objet, { target: { value: 'Point Nordis' } })
    await act(async () => {
      fireEvent.blur(objet)
    })

    await waitFor(() => expect(bridge.calls.some((c) => c.channel === 'meeting:rename')).toBe(true))
  })
})
