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
   * **And « as headings » means to the accessibility tree, which for the life of
   * this component it did not.**
   *
   * `HEADING_CLASS`' docblock argues these are `<div>`s because the component is
   * a typesetter and not a markdown renderer — a rendering argument that was
   * read as settling the semantics too. Measured on the shipped renderer, both
   * smoke sizes: eleven headings drawn on `session-compte-rendu` and at the
   * gate, three on a record, and **none** of them a heading to a screen reader.
   * The two the session screen did report were the rep's own notepad lines.
   *
   * jsdom cannot see the face — `--census` owns that, on a real browser — but
   * `role` and `aria-level` are attributes, so the direction that fails is here:
   * revert either and this goes red. The level is one below the markdown's,
   * because the document sits inside a page that has already named itself; the
   * ladder that follows from that is measured by `--a11y`, on three surfaces at
   * two sizes.
   */
  it('announces each rung as a heading, one level under the page', () => {
    render(
      <CompteRenduDocument text={'# Titre\n\n## Section\n\n### Sous-section\n\nUne phrase.'} />,
    )
    for (const [text, level] of [
      ['Titre', 2],
      ['Section', 3],
      ['Sous-section', 4],
    ] as const) {
      const found = screen.getByRole('heading', { level, name: text })
      expect(found, `« ${text} » must be a heading at level ${level}`).toBeTruthy()
    }
    // The prose beside them is not one, or every line would be a rung.
    expect(screen.queryByRole('heading', { name: 'Une phrase.' })).toBeNull()
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

/**
 * **The identity block, set as itself — and the two surfaces that must not
 * touch it.**
 *
 * At 960×600, the minimum `main.ts` declares on HR-2's primary platform, the
 * session pane's compte-rendu column is 267.9px and the composer's four
 * identity lines took **122.0** of it as body prose. Measured on the shipped
 * renderer, `session-compte-rendu`, before and after: the block is **96.4px**,
 * « ## Résumé » moves **25.7px** earlier in the column, and the Résumé
 * paragraph itself goes from **28.3px of its 195 on screen to 53.9**.
 *
 * `foldMetadata` is opt-in and one caller passes it. The gate must not: its
 * arming guard measures what the rep was *shown*, and those four lines are the
 * account, the date and who was in the room — the deterministic facts the CRM
 * push is built on. `Historique` does not either. That is the direction these
 * tests defend, together with the one that matters more: **every character is
 * still on screen**. A `truncate`d fold behind a chevron was tried first and
 * `--cells` measured 830.6px of text, about 134 characters, cut with an
 * ellipsis and reachable only by a press. This file's licence is that nothing
 * here hides a character, and a control is not an exception to it.
 */
describe('the identity block', () => {
  const COMPOSED = [
    '# Néovia Santé — cadrage renfort data',
    '',
    'Client : Néovia Santé',
    'Date : jeudi 17 septembre 2026, 13:00–13:45',
    'Interlocuteurs : Élodie Vasseur',
    'Commercial : julien.marchand@synapse-conseil.fr',
    '',
    '## Résumé',
    '',
    'Une phrase.',
  ].join('\n')

  /** The four lines, as the DOM has them, in order. */
  const identityLines = (container: HTMLElement) =>
    [...container.querySelectorAll('p')]
      .map((node) => (node.textContent ?? '').trim())
      .filter((text) => /^(Client|Date|Interlocuteurs|Commercial) :/.test(text))

  it('sets the four lines smaller, and every character of them', () => {
    const { container } = render(<CompteRenduDocument text={COMPOSED} foldMetadata />)

    // Byte for byte, in order, from the same parsed array — not joined, not
    // summarised, not shortened.
    expect(identityLines(container)).toEqual([
      'Client : Néovia Santé',
      'Date : jeudi 17 septembre 2026, 13:00–13:45',
      'Interlocuteurs : Élodie Vasseur',
      'Commercial : julien.marchand@synapse-conseil.fr',
    ])
  })

  it('adds no control, because nothing is behind one', () => {
    const { container } = render(<CompteRenduDocument text={COMPOSED} foldMetadata />)
    // The version that had a chevron hid 134 characters behind it. Nothing to
    // press means nothing hidden, which is this file's whole licence.
    expect(container.querySelector('button[aria-expanded]')).toBeNull()
  })

  it('takes the secondary rung, not the document’s prose rung', () => {
    const { container } = render(<CompteRenduDocument text={COMPOSED} foldMetadata />)
    const line = [...container.querySelectorAll('p')].find((node) =>
      (node.textContent ?? '').startsWith('Client :'),
    )
    // `--type-copy` and `leading-snug`. 12px would be a character over
    // `--prose`'s 75 ceiling in this column, which is the number that chose it.
    expect(line?.className).toContain('text-copy')
    expect(line?.className).toContain('leading-snug')
  })

  it('leaves the block alone when nothing asked', () => {
    const { container } = render(<CompteRenduDocument text={COMPOSED} />)
    const line = [...container.querySelectorAll('p')].find((node) =>
      (node.textContent ?? '').startsWith('Client :'),
    )
    // What the gate and the historique record get: the document's own prose
    // setting, unchanged.
    expect(line?.className).toContain('text-prose')
    expect(identityLines(container)).toHaveLength(4)
  })

  it('leaves the rest of the document exactly where it was', () => {
    const { container } = render(<CompteRenduDocument text={COMPOSED} foldMetadata />)
    const text = drawn(container)
    expect(text).toContain('# Néovia Santé — cadrage renfort data')
    expect(text).toContain('## Résumé')
    expect(text).toContain('Une phrase.')
  })

  it('touches nothing when the document has no such block', () => {
    const { container } = render(
      <CompteRenduDocument text={'## Besoin\n\nDeux data engineers.'} foldMetadata />,
    )
    expect(drawn(container)).toContain('## BesoinDeux data engineers.')
  })
})
