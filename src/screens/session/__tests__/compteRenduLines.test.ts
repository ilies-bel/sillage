/**
 * The one property the typesetter has to have: it adds nothing and removes
 * nothing.
 *
 * `CompteRenduDocument` is allowed to exist *only* because of this — the CRM
 * receives the string the rep read (DEC-44), so a pane that dropped a `#`, or
 * quietly turned two spaces into one, would be showing the rep a document
 * VerySwing will not get. Every case below is a round trip.
 */
import { describe, expect, it } from 'vitest'
import { parseCompteRendu, serializeCompteRendu } from '../compteRenduLines.ts'
import { COMPTE_RENDU_SECTIONS } from '../../../../electron/core/contracts/recipes.ts'

const roundTrips = (source: string) =>
  expect(serializeCompteRendu(parseCompteRendu(source))).toBe(source)

describe('parseCompteRendu', () => {
  it('round-trips a whole ESN compte-rendu', () => {
    roundTrips(
      [
        '# Néovia Santé — cadrage renfort data',
        '',
        ...COMPTE_RENDU_SECTIONS.flatMap((heading) => [heading, '', 'Une phrase.', '']),
        '- Mode : régie',
        '- TJM : 550 € (confirmé)',
      ].join('\n'),
    )
  })

  it('round-trips the empty document, a lone newline and trailing blanks', () => {
    roundTrips('')
    roundTrips('\n')
    roundTrips('## Résumé\n\n\n')
  })

  it('classifies the three markers the recipe emits', () => {
    const lines = parseCompteRendu('# T\n## S\n### s\n- item\nprose\n')
    expect(lines.map((l) => l.kind)).toEqual([
      'heading',
      'heading',
      'heading',
      'bullet',
      'text',
      'blank',
    ])
    expect(lines[0]).toEqual({ kind: 'heading', level: 1, marker: '# ', text: 'T' })
    expect(lines[3]).toEqual({ kind: 'bullet', marker: '- ', text: 'item' })
  })

  /*
   * The vocabulary is closed on purpose. A construct the recipe never writes
   * must fall through to `text` and be drawn verbatim — because that is exactly
   * what VerySwing will show, and the pane's job is to let the rep see it.
   */
  it('leaves anything outside the closed vocabulary verbatim', () => {
    for (const line of [
      '| Champ | Valeur |', // a table
      '#### too deep',
      '#no space',
      '-no space',
      '  ## indented',
      '**gras**',
      '1. numbered',
    ]) {
      expect(parseCompteRendu(line)).toEqual([{ kind: 'text', text: line }])
      roundTrips(line)
    }
  })

  /* A dash inside prose is prose. Only `- ` at column zero is a list marker. */
  it('does not mistake an em-dash sentence for a bullet', () => {
    const line = 'Régie — pilotage quotidien côté client'
    expect(parseCompteRendu(line)).toEqual([{ kind: 'text', text: line }])
  })

  it('preserves interior whitespace exactly', () => {
    roundTrips('## Besoin  \ndeux  espaces\n\tune tabulation')
  })
})
