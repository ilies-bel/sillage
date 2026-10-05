/**
 * The rail is the one surface on every screen, so a row that does not answer
 * the pointer is a dead patch a rep meets all day.
 *
 * Measured on `agenda`@1280×800: 57 of 61 controls change at least one of
 * background-color, color, border-color, box-shadow, text-decoration, opacity
 * or transform under the pointer. Three of the four that do not are selected
 * nav items — a selected row has nowhere to go. The fourth was « Mise à jour
 * prête », which is painted `--brand-700` and `font-medium`: it reads as the
 * one link in the chrome and then behaves like a label.
 *
 * jsdom computes nothing for `:hover`, so this asserts what the file declares:
 * every button the rail draws carries at least one `hover:` utility. That is
 * the property the probe measured, restricted to the file that owns it, and it
 * is red on the parent commit for exactly one button.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { Rail } from '../Rail.tsx'

afterEach(cleanup)

const noop = () => {}

const draw = (updateReady: boolean) =>
  render(
    <Rail
      current="aujourdhui"
      pending={{ total: 2, capped: false }}
      updateReady={updateReady}
      onPlace={noop}
      onReglages={noop}
      onUpdate={noop}
    />,
  )

describe('every row in the rail answers the pointer', () => {
  test('each button that is not the current place declares a hover state', () => {
    draw(true)
    const dead = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === null)
      .filter((b) => !/(?:^|\s)hover:/.test(b.className))
      .map((b) => b.textContent ?? '')
    expect(dead).toEqual([])
  })

  test('the update offer keeps its brand ink and hovers down the ramp', () => {
    draw(true)
    const offer = screen.getByRole('button', { name: 'Mise à jour prête' })
    // `--brand-700` → `--brand-900` is the step the ramp already has and the
    // one `primary` uses; `hover:text-body` would take the row's own colour,
    // which is what says this is the row about something new.
    expect(offer.className).toContain('text-brand-700')
    expect(offer.className).toContain('hover:text-brand-900')
    expect(offer.className).toContain('hover:bg-card')
  })

  test('nothing is drawn for the offer when no update is ready', () => {
    draw(false)
    expect(screen.queryByRole('button', { name: 'Mise à jour prête' })).toBeNull()
  })
})

/**
 * **The note is a claim about a number, and it was the only surface making the
 * stronger one.**
 *
 * `pending` was a bare `number`, so the one thing that licenses a `+` — the main
 * process's own « a row was hidden » — could not reach this file at all. The
 * section on the calendar had it and printed « 50+ »; the rail printed « 50 » and
 * told a reader « 50 appels en attente de validation ».
 */
describe('the rail says how sure it is of the backlog', () => {
  const note = (pending: { total: number; capped: boolean } | null) => {
    render(
      <Rail
        current="aujourdhui"
        pending={pending}
        updateReady={false}
        onPlace={noop}
        onReglages={noop}
        onUpdate={noop}
      />,
    )
    const item = screen.getByRole('button', { name: /À valider/ })
    return {
      mark: [...item.querySelectorAll('span[aria-hidden]')]
        .map((s) => (s.textContent ?? '').trim())
        .join(''),
      label: item.textContent ?? '',
    }
  }

  test('an exact backlog is exact', () => {
    expect(note({ total: 50, capped: false })).toEqual({
      mark: '50',
      label: 'À valider5050 appels en attente de validation',
    })
  })

  test('a backlog the main process cut short carries the « + », to both readings', () => {
    expect(note({ total: 50, capped: true })).toEqual({
      mark: '50+',
      label: 'À valider50+au moins 50 appels en attente de validation',
    })
  })

  test('one call owed is singular, and none draws no note at all', () => {
    expect(note({ total: 1, capped: false }).label).toBe(
      'À valider11 appel en attente de validation',
    )
    cleanup()
    expect(note({ total: 0, capped: false })).toEqual({ mark: '', label: 'À valider' })
    cleanup()
    expect(note(null)).toEqual({ mark: '', label: 'À valider' })
  })
})
