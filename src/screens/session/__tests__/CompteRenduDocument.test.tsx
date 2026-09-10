/**
 * The typesetter's licence, checked at the DOM.
 *
 * `compteRenduLines.test.ts` proves the parse round-trips. This proves the
 * *rendered* surface still shows every character of it — which is the actual
 * promise: VerySwing receives the string the rep read (DEC-44), so a pane that
 * dropped a `#`, or turned a table into a table, would be showing the rep a
 * document the CRM will not get.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CompteRenduDocument } from '../CompteRenduDocument.tsx'

afterEach(cleanup)

/** Everything the pane draws, with the line structure collapsed away. */
const drawn = (container: HTMLElement) => (container.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('CompteRenduDocument', () => {
  it('draws every marker, muted, rather than hiding it', () => {
    const { container } = render(
      <CompteRenduDocument text={'# Titre\n\n## Contexte\n\nUne phrase.\n\n- Mode : régie'} />,
    )
    const text = drawn(container)
    expect(text).toContain('# Titre')
    expect(text).toContain('## Contexte')
    expect(text).toContain('- Mode : régie')
  })

  it('sets the headings as headings while the text stays the same string', () => {
    render(<CompteRenduDocument text={'## Besoin\n\nDeux data engineers.'} />)
    // The heading is its own box, at heading weight — and « ## » is beside it,
    // not deleted from it.
    expect(screen.getByText('Besoin')).toBeTruthy()
    expect(screen.getByText('##')).toBeTruthy()
  })

  /*
   * The vocabulary is closed on purpose. A table the recipe never writes lands
   * as literal pipes here *and* in the CRM — which is the point: the pane is
   * where a rep finds that out, before pressing the one button.
   */
  it('draws a construct the recipe never writes exactly as VerySwing will get it', () => {
    const { container } = render(<CompteRenduDocument text={'| Champ | Valeur |'} />)
    expect(drawn(container)).toBe('| Champ | Valeur |')
    expect(container.querySelector('table')).toBeNull()
  })

  it('renders nothing surprising for an empty document', () => {
    const { container } = render(<CompteRenduDocument text="" />)
    expect(drawn(container)).toBe('')
  })
})
