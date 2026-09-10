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
import { parseCompteRendu, parseInline, serializeCompteRendu } from '../compteRenduLines.ts'
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

/**
 * The inline half, and its property is the parser's own: the runs concatenate
 * back to the exact string they came from.
 *
 * That is the whole of DEC-44 at this level. A renderer that dropped the two
 * asterisks would be showing the rep a document VerySwing is not going to get,
 * on the one screen whose job is to let them check exactly that — and the
 * failure would be invisible, because the result reads *better* than the truth.
 */
describe('parseInline', () => {
  const ROUND_TRIP = [
    '**Client** : Néovia Santé',
    '- **TJM évoqué** : 550 €',
    '- **Durée de mission** : _non évoqué_',
    'Rien de particulier.',
    '',
    '**Date** : jeudi 10 septembre 2026, 14:30 – 15:30 ⚠ faible',
    'La grille achats plafonne à 550 € — _sans réponse apportée_',
    // The two things the vocabulary must *not* touch.
    'Écrire à elodie_vasseur@neovia-sante.fr avant vendredi.',
    'Le module sillage_audio expose verify_all sur les deux plateformes.',
    'Un calcul : 2 * 3 * 4 = 24.',
    '**gras** au début et _italique_ à la fin',
  ]

  for (const source of ROUND_TRIP) {
    it(`keeps every character of « ${source.slice(0, 40)} »`, () => {
      expect(
        parseInline(source)
          .map((run) => run.text)
          .join(''),
      ).toBe(source)
    })
  }

  it('sets what the markers wrap, and keeps the markers as runs of their own', () => {
    expect(parseInline('**Client** : Néovia')).toEqual([
      { kind: 'marker', text: '**' },
      { kind: 'strong', text: 'Client' },
      { kind: 'marker', text: '**' },
      { kind: 'plain', text: ' : Néovia' },
    ])
  })

  it('leaves an identifier’s underscores exactly where they are', () => {
    // One plain run and nothing else: no `em`, no marker, no split.
    expect(parseInline('voir sillage_audio et verify_all')).toEqual([
      { kind: 'plain', text: 'voir sillage_audio et verify_all' },
    ])
  })

  it('is not fooled by a multiplication', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ kind: 'plain', text: '2 * 3 * 4' }])
  })
})


/*
 * ── the one mark this product invented ──────────────────────────────────────
 *
 * `⚠ faible` is written into the document on purpose (DEC-21): a rep skimming
 * the prose rather than opening the form still has to see which sentence the app
 * could not stand behind. The typesetter learned `**gras**` and `_italique_` and
 * never learned this one, so it rendered in `--text-body` at `--type-copy` —
 * pixel-identical to the prose around it — while the same eight characters were
 * orange in the rail and orange in the header banner. Three renderings of one
 * measurement on one screen, and the only invisible one was inside the artefact
 * that leaves the machine.
 */
describe('⚠ faible', () => {
  it('is a run of its own, whole', () => {
    const mark = parseInline('- **TJM** : 550 € ⚠ faible').find((run) => run.kind === 'faible')
    expect(mark).toBeTruthy()
    // Whole, including its space: splitting it would let a line break fall
    // between the glyph and the word.
    expect(mark?.text).toBe('⚠ faible')
  })

  it('marks the legend at the foot too', () => {
    // `renderCompteRendu` appends one, and it is the line that explains the
    // glyph to a delivery manager who has never seen the review gate.
    const runs = parseInline('⚠ faible : la citation de cette valeur n’a pas été retrouvée.')
    expect(runs[0]?.kind).toBe('faible')
  })

  it('is the glyph and the word, never the word alone', () => {
    // « une confiance faible » is prose. Only the pair is the measurement, and
    // only the pair is what the composer writes.
    for (const line of ['une confiance faible', 'faible', '⚠ autre chose']) {
      expect(parseInline(line).some((run) => run.kind === 'faible')).toBe(false)
    }
  })

  it('leaves the string untouched — VerySwing receives the same bytes', () => {
    // The whole reason it is a run rather than a substitution (DEC-44).
    const line = '- **Objections** : le TJM 2025 est jugé trop haut ⚠ faible'
    expect(parseInline(line).map((run) => run.text).join('')).toBe(line)
  })

  it('sits beside emphasis without disturbing it', () => {
    const line = '- **Durée** : _non évoqué_ ⚠ faible'
    const runs = parseInline(line)
    expect(runs.map((run) => run.text).join('')).toBe(line)
    expect(runs.filter((run) => run.kind !== 'plain').map((run) => run.kind)).toEqual([
      'marker',
      'strong',
      'marker',
      'marker',
      'em',
      'marker',
      'faible',
    ])
  })
})
