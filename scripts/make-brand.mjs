/**
 * **Every brand asset this product ships, drawn from the one mark.**
 *
 * What this replaces was the archived predecessor's identity, shipped whole.
 * `ui/Logo.tsx` caught the raster on the splash and on first run — « the wrong
 * company's mark, a circled monogram belonging to the product this one
 * replaced » — and fixed those two screens. It did not reach the files nobody
 * greps, because they are not text:
 *
 *   assets/icon.png            512×512 circled « N » monogram
 *   assets/icons/mac/icon.icns the same, in the macOS bundle
 *   assets/icons/win/icon.ico  the same, in the NSIS installer
 *   assets/icons/png/*         the same, seven sizes, for Linux
 *   assets/dmg-background.png  « Drag Natively to Applications »
 *
 * So the dock, the taskbar, the Alt-Tab switcher, the installer window and the
 * disk image all carried another product's name and another product's mark,
 * and the disk image carried it as English prose in a French product.
 *
 * The mark is `ui/Logo.tsx`'s, not a copy of it in spirit: the same three
 * paths, the same `--brand-700` / `--brand-500` / `--brand-300` ramp, the same
 * round caps. `MARK` below is the single source of truth and the check reads
 * it, so a change to the drawn mark that is not mirrored here fails rather
 * than drifts.
 *
 * Rasterised through the Playwright Chromium this repo already runs the
 * harness in, so there is no new dependency and no second renderer to disagree
 * with the one that draws the product.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'assets')

/** The ramp, from `src/design/tokens.css`. Restated nowhere else in this file. */
export const BRAND = { 900: '#02334b', 700: '#036696', 500: '#0594da', 300: '#4dc2fb' }
/** The ground, `--bg-card`. */
export const CARD = '#fdfefe'
/**
 * **The tile's ground, and why the ramp reads backwards on it.**
 *
 * A `--bg-card` tile was the first draft and it was the old raster's mistake
 * wearing the other face: near-white artwork on a near-white tile vanishes into
 * a light desktop exactly as white-on-transparent vanished into the card, and
 * `ui/Logo.tsx` exists because nobody noticed that for three rounds. Measured
 * at 32 px it was a smudge.
 *
 * `--brand-900` is the declared deep brand navy, so the dock silhouette stays
 * the dark tile a rep already recognises — but it is this product's navy rather
 * than the monogram's.
 *
 * On it the ramp is read from the other end, because a ground inverted inverts
 * what « recedes » means. Geometry untouched, the same three tokens, and the
 * measurement says it loses nothing:
 *
 *     lead   --brand-300  6.608:1 on --brand-900   (light tile: --brand-700 6.214:1)
 *     mid    --brand-500  3.964:1                  (              --brand-500 3.323:1)
 *     trail  --brand-700  2.120:1                  (              --brand-300 1.994:1)
 *
 * Stronger on every rung than the light tile it replaces, with the lead clear
 * of WCAG 1.4.11's 3:1 for a graphic, and the trail still dissolving into the
 * ground — which is what a wake does.
 */
export const TILE = '#02334b'

/**
 * The three receding strokes, exactly as `ui/Logo.tsx` draws them in a 24×24
 * box. Kept as data so `make-brand.test` can compare it against that file.
 */
export const MARK = [
  { d: 'M4 8 L20 5', onLight: BRAND[700], onDark: BRAND[300] },
  { d: 'M6 13.5 L20 11', onLight: BRAND[500], onDark: BRAND[500] },
  { d: 'M10 19 L20 17', onLight: BRAND[300], onDark: BRAND[700] },
]

/** The three paths, inked for the ground they are going on. */
const strokes = (on) =>
  MARK.map(
    (m) =>
      `<path d="${m.d}" stroke="${on === 'dark' ? m.onDark : m.onLight}" stroke-width="3" stroke-linecap="round" />`,
  ).join('')

/**
 * The app icon's page.
 *
 * The mark sits at 58 % of the tile on `--bg-card`, inside the squircle radius
 * macOS and Windows both round to anyway — drawing it ourselves means the
 * Linux PNGs and the dev favicon get the same silhouette as the packaged
 * bundles instead of a bare square.
 *
 * `strokeWidth` is carried from the 24-box, so the strokes scale with the mark
 * rather than staying hairlines on a 1024 tile.
 */
const iconPage = (size, { ground = TILE, bleed = true } = {}) => {
  const inset = size * 0.17
  const box = size - inset * 2
  const radius = size * 0.2237 // Apple's continuous-corner ratio for app tiles
  const paths = strokes('dark')
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block}
  </style>
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bleed ? `<rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${ground}"/>` : ''}
    <g transform="translate(${inset} ${inset}) scale(${box / 24})">${paths}</g>
  </svg>`
}

/**
 * The macOS menu-bar template. Template images are black plus alpha and the
 * system recolours them, so the ramp cannot survive here — the three strokes
 * keep their geometry and give up their colour, which is what a template is.
 */
const templatePage = (size) => {
  const paths = MARK.map(
    (m) => `<path d="${m.d}" stroke="#000000" stroke-width="3" stroke-linecap="round" />`,
  ).join('')
  void strokes
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${paths}</svg>`
}

/**
 * The disk image's backdrop. It said « Drag Natively to Applications » — the
 * predecessor's name, in English, in a product whose every user-facing string
 * is French (and whose own convention puts the app name in guillemets).
 */
const dmgPage = (w, h, fraunces) => {
  const paths = strokes('light')
  return `<!doctype html><meta charset="utf-8"><style>
    /*
     * The wordmark is Fraunces, because the splash sets it in Fraunces — the
     * disk image is the first thing a rep ever sees and setting the name in the
     * system sans there would make the install and the first launch two
     * different products. Embedded as a data URI rather than linked, so the
     * render does not depend on a font being installed on whichever machine
     * runs the generator.
     */
    @font-face{font-family:'Fraunces';src:url(data:font/woff2;base64,${fraunces}) format('woff2');font-weight:100 900;font-display:block}
    html,body{margin:0;width:${w}px;height:${h}px;background:${CARD};
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .wrap{position:absolute;top:${Math.round(h * 0.085)}px;left:0;right:0;text-align:center}
    svg{display:inline-block;vertical-align:middle;margin-right:${Math.round(w * 0.012)}px}
    h1{display:inline-block;vertical-align:middle;margin:0;font-size:${Math.round(h * 0.062)}px;
      font-family:'Fraunces',ui-serif,Georgia,serif;font-weight:600;
      letter-spacing:-1.5px;color:${BRAND[900]}}
    p{margin:${Math.round(h * 0.022)}px 0 0;font-size:${Math.round(h * 0.028)}px;color:#5b7183}
  </style>
  <div class="wrap">
    <svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(h * 0.075)}" height="${Math.round(h * 0.075)}" viewBox="0 0 24 24">${paths}</svg>
    <h1>Sillage</h1>
    <p>Glissez « Sillage » dans Applications</p>
  </div>`
}

const shoot = async (page, html, size) => {
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.setContent(html)
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size.w, height: size.h } })
}

/**
 * A PNG-payload ICO, written by hand.
 *
 * The alternative was a dependency — `png-to-ico` or ImageMagick — for a
 * container that is a 6-byte header, a 16-byte directory entry per image, and
 * then the PNG bytes verbatim. `CLAUDE.md`: adding a dependency is a decision,
 * not a convenience. Windows has read PNG-payload ICOs since Vista and
 * electron-builder passes the file through untouched.
 */
const ico = (pngs) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + pngs.length * 16
  const dir = []
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2) // palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    dir.push(e)
  }
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.data)])
}

const PNG_SIZES = [16, 32, 64, 128, 256, 512, 1024]
/**
 * What Windows picks between. 48 is in here and not in `PNG_SIZES` because the
 * shell uses it for large-icon list views and nothing else does — and an ICO
 * directory entry that claims 48 while carrying 64×64 bytes is a container
 * lying about itself, which is how the first draft of this file shipped.
 */
const ICO_SIZES = [16, 32, 48, 64, 128, 256]
/** What `iconutil` demands, by name. */
const ICNS = [
  ['icon_16x16', 16], ['icon_16x16@2x', 32],
  ['icon_32x32', 32], ['icon_32x32@2x', 64],
  ['icon_128x128', 128], ['icon_128x128@2x', 256],
  ['icon_256x256', 256], ['icon_256x256@2x', 512],
  ['icon_512x512', 512], ['icon_512x512@2x', 1024],
]

const main = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const made = []

  mkdirSync(path.join(OUT, 'icons/png'), { recursive: true })
  mkdirSync(path.join(OUT, 'icons/mac'), { recursive: true })
  mkdirSync(path.join(OUT, 'icons/win'), { recursive: true })

  const at = new Map()
  for (const size of [...new Set([...PNG_SIZES, ...ICO_SIZES, ...ICNS.map((i) => i[1])])]) {
    at.set(size, await shoot(page, iconPage(size), { w: size, h: size }))
  }

  for (const size of PNG_SIZES) {
    const f = path.join(OUT, `icons/png/icon_${size}x${size}.png`)
    writeFileSync(f, at.get(size))
    made.push(f)
  }

  writeFileSync(path.join(OUT, 'icon.png'), at.get(512))
  made.push(path.join(OUT, 'icon.png'))

  // macOS menu-bar template, 22pt plus its @2x.
  writeFileSync(path.join(OUT, 'iconTemplate.png'), await shoot(page, templatePage(22), { w: 22, h: 22 }))
  writeFileSync(path.join(OUT, 'iconTemplate@2x.png'), await shoot(page, templatePage(44), { w: 44, h: 44 }))
  made.push(path.join(OUT, 'iconTemplate.png'), path.join(OUT, 'iconTemplate@2x.png'))

  // .icns, through the system tool rather than a hand-rolled container.
  const iconset = path.join(OUT, 'icons/mac/sillage.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  for (const [name, size] of ICNS) writeFileSync(path.join(iconset, `${name}.png`), at.get(size))
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT, 'icons/mac/icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
  made.push(path.join(OUT, 'icons/mac/icon.icns'))

  // .ico — the sizes Windows actually picks between.
  writeFileSync(
    path.join(OUT, 'icons/win/icon.ico'),
    ico(ICO_SIZES.map((size) => {
      const data = at.get(size)
      if (data === undefined) throw new Error(`taille ICO ${size} jamais dessinée`)
      return { size, data }
    })),
  )
  made.push(path.join(OUT, 'icons/win/icon.ico'))

  const fraunces = readFileSync(
    path.join(REPO, 'src/font/Fraunces/Fraunces-latin.woff2'),
  ).toString('base64')
  writeFileSync(
    path.join(OUT, 'dmg-background.png'),
    await shoot(page, dmgPage(2640, 1600, fraunces), { w: 2640, h: 1600 }),
  )
  made.push(path.join(OUT, 'dmg-background.png'))

  /*
   * The window's own icon, for the one surface that reads a favicon rather than
   * a bundle: the page itself. Written as SVG into Vite's `public/` so it is one
   * generated file and not the mark restated a third time in `index.html` — the
   * whole reason this file exists is that the mark drifted once already, into a
   * raster nobody greps.
   */
  const publicDir = path.join(REPO, 'public')
  mkdirSync(publicDir, { recursive: true })
  const favicon =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">` +
    `<rect width="24" height="24" rx="5.37" fill="${TILE}"/>` +
    `<g transform="translate(4.08 4.08) scale(0.66)">${strokes('dark')}</g>` +
    `</svg>\n`
  writeFileSync(path.join(publicDir, 'favicon.svg'), favicon)
  made.push(path.join(publicDir, 'favicon.svg'))

  await browser.close()
  for (const f of made) console.log(`  ${path.relative(REPO, f)}`)
  console.log(`marque ok — ${made.length} fichier(s) dessinés depuis ui/Logo.tsx`)
}

if (process.argv[1] && process.argv[1].endsWith('make-brand.mjs')) await main()
