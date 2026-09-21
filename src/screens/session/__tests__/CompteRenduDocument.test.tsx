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

  /*
   * The deterministic header and the whole of « Éléments retenus » are written
   * with inline emphasis, and the pane drew five lines of literal asterisks
   * until the harness fixture was made to match the composer. The markers stay
   * — VerySwing gets them — and the words between them are set.
   */
  it('sets inline emphasis without swallowing a single asterisk', () => {
    const { container } = render(
      <CompteRenduDocument text={'**Client** : Néovia Santé\n\n- **Durée** : _non évoqué_'} />,
    )
    const text = drawn(container)
    expect(text).toContain('**Client** : Néovia Santé')
    expect(text).toContain('_non évoqué_')

    // And the emphasis is real, not a class name on a paragraph.
    expect(screen.getByText('Client').tagName).toBe('STRONG')
    expect(screen.getByText('non évoqué').tagName).toBe('EM')
  })

  it('renders nothing surprising for an empty document', () => {
    const { container } = render(<CompteRenduDocument text="" />)
    expect(drawn(container)).toBe('')
  })
})

/*
 * The magnifier at the end of a followable line (DEC-44). It is drawn only on
 * a line the composer wrote from a span — string equality, never a guess — and
 * a plain line gets neither the glyph nor the control.
 */
describe('provenance glyph', () => {
  const sources = [{ text: 'TJM évoqué : 550 €', span: { quote: '550 euros' } }]

  it('hangs a magnifier on a sourced line and none on a plain one', () => {
    const { container } = render(
      <CompteRenduDocument
        text={'- TJM évoqué : 550 €\n- Mode : régie'}
        sources={sources}
        onQuote={() => {}}
      />,
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBe(1)
    expect(buttons[0]?.querySelector('svg')).not.toBeNull()
    expect(buttons[0]?.textContent).toContain('TJM évoqué')
  })

  it('draws no control at all when there is no record beside it', () => {
    const { container } = render(
      <CompteRenduDocument text={'- TJM évoqué : 550 €'} sources={sources} />,
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })
})

/*
 * **One rung, one family — the half a browser has to measure, and the half that
 * can be held here.**
 *
 * The defect these two assertions exist for was measured on the shipped
 * renderer: « À retenir » in the notepad at 19px/500/Fraunces beside « Résumé »
 * in the compte-rendu at 19px/600/Inter, one rung, one screen. jsdom answers
 * zero for every box and resolves no stylesheet, so *nothing here can see a
 * typeface* — `shot.mjs --census`' third display-face claim is the instrument
 * that measures it, on the real renderer at both smoke sizes.
 *
 * What is held here is the two things that claim depends on and a browser check
 * cannot state: that the document still says what it is, and that the three
 * heading rungs still agree about their face rather than leaving it to a tag.
 * Removing `data-document` makes `--census` print « aucun document » and pass —
 * the silence its own docblock records — so this is where that direction fails.
 */
describe('one document, set two ways', () => {
  it('declares itself a document, so the face census can find it', () => {
    const { container } = render(<CompteRenduDocument text={'# Titre'} />)
    const root = container.querySelector('[data-document]')
    expect(root, 'the compte-rendu must declare data-document').not.toBeNull()
    expect(root?.getAttribute('data-document')).toBe('compte-rendu')
  })

  it('sets all three heading rungs in the display face, and none of them in a weight', () => {
    const { container } = render(
      <CompteRenduDocument text={'# Titre\n\n## Section\n\n### Sous-section'} />,
    )
    const rungs = [...container.querySelectorAll('div[class*="text-title"], div[class*="text-heading"], div[class*="text-subhead"]')]
    expect(rungs.length, 'three heading rungs are drawn').toBe(3)
    for (const rung of rungs) {
      const classes = rung.className
      expect(classes, `${classes} must write the display face`).toContain('font-display')
      /*
       * `.font-display` carries `--display-weight` in the base layer, which is
       * the rule `4ee37e6` shipped so that writing the face writes the weight.
       * A `font-semibold` beside it is the tag deciding again, one level down —
       * it is what level 2 and level 3 carried, and it is what made them 600
       * against the notepad's 500.
       */
      expect(/\bfont-(thin|light|normal|medium|semibold|bold|extrabold|black)\b/.test(classes), `${classes} must not overrule the face's weight`).toBe(false)
    }
  })
})
