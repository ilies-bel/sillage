/**
 * **Motion the browser will not stop for `prefers-reduced-motion`.**
 *
 * `shot.mjs --motion` measures the motion that *is* stoppable: a computed
 * `transition-duration` or `animation-duration`, flipped under
 * `emulateMedia({ reducedMotion: 'reduce' })` and re-read. It cannot see a
 * programmatic scroll, because a scroll animation has neither property — and
 * **Chromium does not suppress `behavior: 'smooth'` for that setting**. The
 * media query collapses CSS motion; `scrollIntoView`, `scrollTo` and `scrollBy`
 * run their full curve regardless.
 *
 * So the one check that claimed to measure the accessibility half was printing
 * « s'arrête quand l'OS le demande » over six live animations that do not stop:
 * the review gate's opening jump to the first unverified field, every page turn
 * the arming guard walks a rep through, *Historique*'s and the transcript
 * reader's scroll-to-line, `ReadingColumn`'s « revenir en haut », and the search
 * chips' rail. A rep with a vestibular disorder who had turned motion off
 * system-wide got all of it, unasked for.
 *
 * The fix is `src/lib/scroll.ts`, which is the one file that decides. It asked
 * `matchMedia` per call until US-14 measured what the animation was costing —
 * every scroll the app performs is `auto` now, for everyone, so there is no
 * longer a resting path and a reduced-motion path that could diverge. This is
 * the half that keeps it fixed.
 * A rule enforced by one helper is one new call site away from being bypassed,
 * silently, by somebody who reasonably wrote the two words the DOM documents —
 * which is exactly how there came to be six of them.
 *
 * Source as evidence, the `preloadUnwrap.test.ts` and `echo_canceller.rs`
 * shape: what is asserted is a property of the *rest of the tree* that no test
 * of `scroll.ts` can see.
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SCANNED = ['src']

/**
 * The one file allowed to name a scroll behaviour, because it is the file that
 * decides which one. Not an exemption list that can grow: a second entry here
 * would mean two places decide, which is the condition this check exists to
 * prevent.
 */
const DECIDER = 'src/lib/scroll.ts'

/**
 * `behavior: 'smooth'` in any spelling the language allows, plus the CSS
 * property that does the same thing declaratively.
 *
 * `scroll-behavior: smooth` in a stylesheet is the same defect wearing CSS: it
 * animates every programmatic scroll into that element, and the media query
 * does not touch it either. It is legal **inside** an
 * `@media (prefers-reduced-motion: ...)` block, which is why the CSS test is
 * about the declaration and the file reports the line for a human to read.
 */
const PATTERNS = [
  { what: "behavior: 'smooth'", re: /behaviou?r\s*:\s*['"`]smooth['"`]/ },
  { what: 'scroll-behavior: smooth', re: /scroll-behaviou?r\s*:\s*smooth/ },
  /*
   * **Three spellings this check could not see, all measured passing it.**
   *
   * The two above are how the DOM and CSS document the property, and they were
   * written as though those were the only ways to say it. They are not, and the
   * twenty-third review round said so: a probe file containing all three of the
   * rules below was dropped into `src/` and this check printed « motion ok ».
   *
   * `scroll-smooth` is a Tailwind utility — 3.4 is installed and ships it — so it
   * is one class name away on any element, and it reads as styling rather than as
   * behaviour, which is exactly what makes it likely. The two script forms are the
   * same declaration reached through the CSSOM instead of through a string
   * literal, and `setProperty` in particular takes the property name as data,
   * where no amount of squinting at `behavior:` would find it.
   *
   * Nothing in the repo uses any of them today. That is the point: this check
   * exists because six call sites wrote `behavior: 'smooth'` before anyone noticed
   * the browser ignores `prefers-reduced-motion` for it, and a gate that only
   * catches the spelling that has already been used is a gate for the past.
   */
  { what: "Tailwind's scroll-smooth utility", re: /(?:class(?:Name)?\s*=|["'`\s])scroll-smooth(?=["'`\s])/ },
  { what: 'style.scrollBehavior = smooth', re: /scrollBehavior\s*=\s*['"`]smooth['"`]/ },
  {
    what: "setProperty('scroll-behavior', 'smooth')",
    re: /setProperty\(\s*['"`]scroll-behaviou?r['"`]\s*,\s*['"`]smooth['"`]/,
  },
]

const files = async (dir) => {
  const out = []
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await files(path)))
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(path)
  }
  return out
}

const found = []
let scanned = 0

for (const dir of SCANNED) {
  for (const path of await files(dir)) {
    const rel = relative('.', path).split('\\').join('/')
    if (rel === DECIDER) continue
    scanned++
    const lines = readFileSync(join(ROOT, path), 'utf8').split('\n')
    lines.forEach((line, index) => {
      // A line that is only talking *about* the rule — every one of these files
      // carries the reasoning in prose — is not a call site.
      const code = line.replace(/^\s*(\*|\/\/).*/, '')
      for (const { what, re } of PATTERNS) {
        if (re.test(code)) found.push({ rel, line: index + 1, what, text: line.trim() })
      }
    })
  }
}

if (found.length > 0) {
  console.error(`motion: ${found.length} défilement(s) animé(s) hors de ${DECIDER}`)
  for (const f of found) {
    console.error(`  ${f.rel}:${f.line}: ${f.what}`)
    console.error(`    ${f.text.slice(0, 110)}`)
  }
  console.error('')
  console.error('Chromium n’arrête pas un défilement « smooth » sous prefers-reduced-motion,')
  console.error('quelle que soit la façon de le demander — classe Tailwind ou CSSOM comprises.')
  console.error(`Passez par scrollToCenter / scrollToTop / scrollElementTo / scrollElementBy`)
  console.error(`(${DECIDER}), le seul fichier qui décide du comportement.`)
  process.exit(1)
}

console.log(
  `motion ok — ${scanned} fichier(s) scannés, 1 seul décide du comportement de défilement (${DECIDER})`,
)
