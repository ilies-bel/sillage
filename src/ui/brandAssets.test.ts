/**
 * **The mark is drawn twice, and an image is not text.**
 *
 * `ui/Logo.tsx` draws it for the two screens that show it. `scripts/make-brand.mjs`
 * draws it for the thirteen files a build ships — the macOS `.icns`, the Windows
 * `.ico`, seven Linux PNGs, the menu-bar template, the disk image's backdrop and
 * the window favicon. Two drawings of one mark is a drift risk, and this repo has
 * already lost that bet once: the rename pass that moved every string left the
 * predecessor's circled monogram in `src/assets/logo.png`, and `ui/Logo.tsx` was
 * written three rounds later to replace it. The same pass left the same monogram
 * in five packaged assets and a disk image reading « Drag Natively to
 * Applications », and no gate in this repo could see any of it, because every one
 * of them greps source.
 *
 * So this is the gate that reads both. It compares geometry, not appearance —
 * the three `d` attributes and the three ramp tokens, in order — because those
 * are what make it the same mark. It deliberately does *not* compare colour
 * assignment: the tile inverts the ramp, and `make-brand.mjs` states the
 * measurement for why.
 *
 * Falsified by changing one coordinate in either file: the pair goes red.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LOGO = path.resolve(HERE, 'Logo.tsx')
const GENERATOR = path.resolve(HERE, '../../scripts/make-brand.mjs')

/**
 * Every path in a file, in source order.
 *
 * Two spellings because the two files hold the mark differently: the component
 * writes `d="…"` as JSX, and the generator holds it as data (`d: '…'`) which it
 * then interpolates. Reading the generator's rendered string would find
 * `${m.d}`, which is how the first draft of this test passed nothing useful.
 */
const paths = (source: string): string[] => [
  ...[...source.matchAll(/\bd="(M[^"]+)"/g)].map((m) => m[1] as string),
  ...[...source.matchAll(/\bd:\s*'(M[^']+)'/g)].map((m) => m[1] as string),
]

/** Every `--brand-NNN` named in a file, in source order, de-duplicated in place. */
const ramp = (source: string): string[] =>
  [...source.matchAll(/--brand-(\d{3})/g)].map((m) => m[1] as string)

describe('the mark ships the same everywhere it is drawn', () => {
  it('the generator draws the geometry ui/Logo.tsx draws', () => {
    const drawn = paths(readFileSync(LOGO, 'utf8'))
    const shipped = paths(readFileSync(GENERATOR, 'utf8'))

    expect(drawn.length, 'ui/Logo.tsx ne dessine plus trois traits').toBe(3)
    expect(
      shipped,
      'scripts/make-brand.mjs ne dessine pas la marque de ui/Logo.tsx — les fichiers ' +
        'livrés (icns, ico, PNG, favicon, image disque) porteraient une autre marque ' +
        'que les deux écrans, et aucune autre barrière ne lit une image',
    ).toEqual(drawn)
  })

  it('both draw it from the same ramp', () => {
    const drawn = ramp(readFileSync(LOGO, 'utf8'))
    const shipped = ramp(readFileSync(GENERATOR, 'utf8'))

    expect(new Set(drawn), 'ui/Logo.tsx n’utilise plus les trois échelons').toEqual(
      new Set(['700', '500', '300']),
    )
    // A superset: the generator also names `--brand-900` for the tile's ground,
    // which the component has no use for.
    for (const rung of new Set(drawn)) {
      expect(
        shipped,
        `scripts/make-brand.mjs ignore --brand-${rung}, que ui/Logo.tsx dessine`,
      ).toContain(rung)
    }
  })

  it('the favicon the page loads is the one the generator wrote', () => {
    const favicon = readFileSync(path.resolve(HERE, '../../public/favicon.svg'), 'utf8')
    const drawn = paths(readFileSync(LOGO, 'utf8'))
    expect(
      paths(favicon),
      'public/favicon.svg a dérivé — relancez `node scripts/make-brand.mjs`',
    ).toEqual(drawn)

    const html = readFileSync(path.resolve(HERE, '../../index.html'), 'utf8')
    expect(html, 'index.html ne charge aucune icône').toMatch(
      /<link rel="icon"[^>]*href="\.\/favicon\.svg"/,
    )
  })
})
