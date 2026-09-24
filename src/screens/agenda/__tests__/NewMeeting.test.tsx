/**
 * **The two fields no screenshot has ever reached, and the one rule that had
 * always been written for them.**
 *
 * `shot.mjs --a11y` has carried « champ sans étiquette (le placeholder n'en est
 * pas une) » since it was written, with the reason stated beside it: a
 * placeholder is gone the moment a rep types. It was green over this form for
 * the life of the form — 180 stagings, 90 screens, both sizes — because the
 * form only exists after a press and no stage presses it. The same blindness
 * put this file's three fields off the spacing ladder at `px-2.5` for as long,
 * and that half was found by hand-driving `Ajouter une réunion`; the accessible
 * names were not looked at on the way past.
 *
 * Across the whole renderer these were the only two: every other `<input>` and
 * `<textarea>` is either `aria-label`led, wrapped in a `<label>`, or `for=`
 * linked. The session header names the identical pair — *Objet de la réunion*
 * and *Client* in `MeetingTitle.tsx` — so the tree stated the rule and broke it
 * about the same two fields at two sites.
 *
 * Driven through the press rather than by rendering the open form, because the
 * press is what no stage does and is therefore the thing worth asserting.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NewMeeting } from '../NewMeeting.tsx'

afterEach(cleanup)

const DAY = '2026-09-17'

describe('the scheduling form names its fields', () => {
  test('both text fields are reachable by name once the form is open', () => {
    render(<NewMeeting day={DAY} today={DAY} onCreated={() => {}} variant="empty" />)

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une réunion' }))

    // By role and name — the way the accessibility tree reaches them, which is
    // the thing a placeholder does not provide.
    expect(screen.getByRole('textbox', { name: 'Objet de la réunion' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Client' })).toBeTruthy()
  })

  /**
   * The half that a placeholder passes and a label does not: a filled field.
   * `getByPlaceholderText` would keep working here; the accessible name is what
   * disappears, so it is what is asked for.
   */
  test('the names survive the rep typing into them', () => {
    render(<NewMeeting day={DAY} today={DAY} onCreated={() => {}} variant="empty" />)

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une réunion' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Objet de la réunion' }), {
      target: { value: 'cadrage' },
    })

    const objet = screen.getByRole('textbox', { name: 'Objet de la réunion' })
    expect((objet as HTMLInputElement).value).toBe('cadrage')
    // Still named with a value in it — the placeholder is no longer drawn.
    expect(screen.getByRole('textbox', { name: 'Client' })).toBeTruthy()
  })
})
