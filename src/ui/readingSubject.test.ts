/**
 * **Both frames of a page turn's label, for every determiner a column uses.**
 *
 * What this can and cannot do is the whole reason R32-2 lived. It cannot drive
 * `ReadingColumn`: jsdom measures every box as zero, so `above` and `below` are
 * both false, `turn` is `null` and the control is never rendered — a render test
 * here would be a test whose fixture cannot exercise the property it is named
 * after. The rendered `up` state is measured by the `session-remonter` and
 * `onboarding-suite` stages, at both smoke sizes, against real layout.
 *
 * What it *can* do is the grammar, exhaustively and including the three
 * determiners no stage reaches — `vos` and `l’` sit on *Historique* panes that
 * fit their box at 1280×800 and 960×600, and `les` is *Demander*'s answers — and
 * the convergence with the review gate, which writes its own two labels by hand
 * and is the reference for what this product already sounds like.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readingTurnLabels, type ReadingDeterminer, type ReadingSubject } from './readingSubject.ts'

/** Every determiner the union declares, with the noun the product pairs it with. */
const SURFACES: { subject: ReadingSubject; where: string; down: string; up: string }[] = [
  {
    where: 'CompteRenduPane, Historique’s compte-rendu pane',
    subject: { determiner: 'le', noun: 'compte-rendu' },
    down: 'Lire la suite du compte-rendu',
    up: 'Remonter dans le compte-rendu',
  },
  {
    where: 'SignalRail',
    subject: { determiner: 'la', noun: 'fiche' },
    down: 'Lire la suite de la fiche',
    up: 'Remonter dans la fiche',
  },
  {
    where: 'Historique’s transcription pane',
    subject: { determiner: 'la', noun: 'transcription' },
    down: 'Lire la suite de la transcription',
    up: 'Remonter dans la transcription',
  },
  {
    where: 'Historique’s notes pane',
    subject: { determiner: 'vos', noun: 'notes' },
    down: 'Lire la suite de vos notes',
    up: 'Remonter dans vos notes',
  },
  {
    where: 'Historique’s extraction pane',
    subject: { determiner: 'l’', noun: 'extraction' },
    down: 'Lire la suite de l’extraction',
    up: 'Remonter dans l’extraction',
  },
  {
    where: 'AskPanel’s answers',
    subject: { determiner: 'les', noun: 'réponses' },
    down: 'Lire la suite des réponses',
    up: 'Remonter dans les réponses',
  },
  {
    where: 'Onboarding, step 3',
    subject: { determiner: 'cette', noun: 'étape' },
    down: 'Lire la suite de cette étape',
    up: 'Remonter dans cette étape',
  },
]

describe('the label of a reading column is right in both frames', () => {
  for (const { where, subject, down, up } of SURFACES) {
    test(`${subject.determiner} ${subject.noun} — ${where}`, () => {
      expect(readingTurnLabels(subject)).toEqual({ down, up })
    })
  }

  test('every declared determiner is covered, so the union cannot grow untested', () => {
    // The type is erased at runtime, so the list is read off the source: a sixth
    // determiner added without a surface here would otherwise be a silent hole,
    // which is the shape of the defect this file exists for.
    const source = readFileSync(resolve(import.meta.dirname, 'readingSubject.ts'), 'utf8')
    const declared = /export type ReadingDeterminer = ([^\n]+)/.exec(source)?.[1] ?? ''
    const names = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(1)
    expect(new Set(SURFACES.map((s) => s.subject.determiner))).toEqual(new Set(names))
  })

  test('the elision takes no space, in either frame', () => {
    const { down, up } = readingTurnLabels({ determiner: 'l’', noun: 'extraction' })
    expect(down).not.toMatch(/l’ /)
    expect(up).not.toMatch(/l’ /)
  })

  test('the descending frame is a genitive and the ascending one is not', () => {
    // The defect said in one line: every caller supplied « du compte-rendu »,
    // which is what `down` needs and exactly what `up` refuses.
    const genitive = /^(du|des|de la|de l’|de |d’)/
    for (const { subject } of SURFACES) {
      const { down, up } = readingTurnLabels(subject)
      expect(genitive.test(down.replace('Lire la suite ', ''))).toBe(true)
      expect(genitive.test(up.replace('Remonter dans ', ''))).toBe(false)
    }
  })
})

describe('the same gesture is named one way', () => {
  /*
   * The review gate does not use `ReadingColumn` — its guard measures the union
   * of the bands each column has shown and owns its own `measure` — so it writes
   * these two labels by hand. Both were already right, which is what made the
   * component's version visibly wrong beside them: the same document, one click
   * away, labelled two ways. Read out of the gate's source rather than restated,
   * so a change on either side is a failure here rather than a divergence
   * nobody notices.
   */
  test('the compte-rendu’s two labels are the gate’s, character for character', () => {
    const gate = readFileSync(
      resolve(import.meta.dirname, '../screens/Review.tsx'),
      'utf8',
    )
    const { down, up } = readingTurnLabels({ determiner: 'le', noun: 'compte-rendu' })
    expect(gate, 'the gate’s descending label has moved away from the shared one').toContain(down)
    expect(gate, 'the gate’s ascending label has moved away from the shared one').toContain(up)
  })
})

describe('a caller cannot supply half of the pair', () => {
  test('the determiner is a closed set', () => {
    // @ts-expect-error — a genitive is not a determiner: this is the defect,
    // and it is now a compile error rather than « Remonter dans du compte-rendu ».
    const bent: ReadingSubject = { determiner: 'du', noun: 'compte-rendu' }
    expect(bent).toBeTruthy()

    // @ts-expect-error — and neither is a whole label.
    const label: ReadingDeterminer = 'de la transcription'
    expect(label).toBeTruthy()
  })

  test('`ReadingColumn` interpolates no noun of its own', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'ReadingColumn.tsx'), 'utf8')
    // The old line was `Remonter dans ${what}` / `Lire la suite ${what}`, and a
    // grep is the only thing that can say it has not come back: the component
    // renders no control under jsdom, so no DOM test can.
    expect(source).not.toMatch(/Remonter dans \$\{/)
    expect(source).not.toMatch(/Lire la suite \$\{/)
    expect(source).toContain('readingTurnLabels(')
  })
})
