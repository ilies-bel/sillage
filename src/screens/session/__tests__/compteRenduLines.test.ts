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
import {
  metadataBlock,
  parseCompteRendu,
  parseInline,
  serializeCompteRendu,
} from '../compteRenduLines.ts'
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

/*
 * ── the only part of the prose that claims to be verbatim ───────────────────
 *
 * `REGISTRE` licenses « … » for a few words the client actually said, when the
 * formulation itself is the point. Everything else in the compte-rendu is the
 * model reporting — hedges kept, quantities approximate — so a quotation is the
 * one thing in two thousand four hundred pixels of prose that can be checked
 * against the recording, and it was the one thing with no way to check it while
 * every typed field beside it carried a `[source ▸]`.
 */
describe('a quoted fragment', () => {
  it('is a run of its own, with the guillemets and without them', () => {
    const runs = parseInline('Le client parle d’« une quarantaine de jobs » restants.')
    const quote = runs.find((run) => run.kind === 'quote')
    expect(quote).toBeTruthy()
    // `text` is what the rep reads, `inner` is what `locateQuote` is handed.
    expect(quote?.text).toBe('« une quarantaine de jobs »')
    expect(quote && 'inner' in quote && quote.inner).toBe('une quarantaine de jobs')
  })

  it('leaves the string untouched', () => {
    const line = 'L’équipe est décrite comme « trois personnes, dont deux à mi-temps ».'
    expect(parseInline(line).map((run) => run.text).join('')).toBe(line)
  })

  it('does not span a line, and is never empty', () => {
    // A stray guillemet is prose. Two of them around nothing is not a quotation
    // and must not become a control.
    for (const line of ['un « seul guillemet ouvrant', 'fermant » tout seul', '« »']) {
      expect(parseInline(line).some((run) => run.kind === 'quote')).toBe(false)
    }
  })

  it('sits beside the other marks without disturbing them', () => {
    const line = '- **Objections** : « le TJM est trop haut » ⚠ faible'
    const runs = parseInline(line)
    expect(runs.map((run) => run.text).join('')).toBe(line)
    expect(runs.filter((run) => run.kind !== 'plain').map((run) => run.kind)).toEqual([
      'marker',
      'strong',
      'marker',
      'quote',
      'faible',
    ])
  })
})

/**
 * **The identity block, found by shape.**
 *
 * `modules/extract/compteRendu.ts` opens every document on `# <objet>`, one
 * blank, three or four unmarked lines, one blank, `## Résumé` (DEC-40). Those
 * unmarked lines are the meeting's identity, and the parser classes them
 * `text` like any other line because they carry no marker.
 *
 * A rule that looked for « Client : » would be this file guessing which of the
 * product's own lines are metadata — and the repo's invariant is that a
 * document's lines are followable *by string equality*, never by a heuristic.
 * So the shape is the whole rule, and these say what shapes it refuses.
 */
describe('metadataBlock', () => {
  const composed = [
    '# Néovia Santé — cadrage renfort data',
    '',
    'Client : Néovia Santé',
    'Date : jeudi 17 septembre 2026, 13:00–13:45',
    'Interlocuteurs : Élodie Vasseur (elodie.vasseur@neovia-sante.fr)',
    'Commercial : julien.marchand@synapse-conseil.fr',
    '',
    '## Résumé',
    '',
    'Une phrase.',
  ].join('\n')

  it('finds the run the composer writes, and only that run', () => {
    const lines = parseCompteRendu(composed)
    expect(metadataBlock(lines)).toEqual({ start: 2, end: 6 })
    // Every line in the range is one of the four, verbatim — the range is into
    // the parsed array, so nothing here is recomposed.
    expect(lines.slice(2, 6).map((line) => (line.kind === 'text' ? line.text : null))).toEqual([
      'Client : Néovia Santé',
      'Date : jeudi 17 septembre 2026, 13:00–13:45',
      'Interlocuteurs : Élodie Vasseur (elodie.vasseur@neovia-sante.fr)',
      'Commercial : julien.marchand@synapse-conseil.fr',
    ])
  })

  it('finds the three-line form, because Microsoft is optional', () => {
    // `repEmail` is nullable the whole way down — a compte-rendu never requires
    // a Microsoft account — so « Commercial : » is simply absent.
    const lines = parseCompteRendu(composed.split('\n').filter((l) => !l.startsWith('Commercial')).join('\n'))
    expect(metadataBlock(lines)).toEqual({ start: 2, end: 5 })
  })

  it('refuses a title followed by prose', () => {
    // The closing condition is « a blank, then a heading ». Prose is not
    // followed by a heading one blank later, so a document that opens on a
    // paragraph keeps every line it had.
    expect(
      metadataBlock(parseCompteRendu('# Titre\n\nUne phrase.\nUne autre.\n\nEt la suite.')),
    ).toBeNull()
  })

  it('refuses a single line, because one folded is one drawn', () => {
    expect(metadataBlock(parseCompteRendu('# Titre\n\nClient : X\n\n## Résumé\n\nBon.'))).toBeNull()
  })

  it('refuses a document that does not open on a level-1 heading', () => {
    expect(metadataBlock(parseCompteRendu('## Besoin\n\nClient : X\nDate : Y\n\n## Résumé'))).toBeNull()
    expect(metadataBlock(parseCompteRendu(''))).toBeNull()
  })

  it('changes nothing about the round trip it sits beside', () => {
    // The whole point: this reads the parsed array and never writes one.
    roundTrips(composed)
  })
})
