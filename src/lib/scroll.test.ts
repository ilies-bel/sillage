/**
 * **What the four helpers hand to the DOM, driven rather than read.**
 *
 * `scripts/check-motion.mjs` holds every spelling of an animated scroll to
 * `scroll.ts` — and by construction it can say nothing about `scroll.ts` itself,
 * which is the one file allowed to name a behaviour. `shot.mjs --motion` cannot
 * see this either: it reads `transitionDuration` and `animationDuration`, and a
 * scroll animation is neither. So the file that decides had **no check over it
 * at all**, and the decision is worth 1 996 ms per gate at 1280×800 and 2 647 ms
 * at 960×600 (measured on the shipped review gate; see the docblock there).
 *
 * This is that check. It drives the exported functions against fake elements
 * that record the options they are given — the shipped functions, not a reading
 * of their source — so putting `'smooth'` back in any one of the four fails here
 * whether or not it also fails `check-motion.mjs`.
 *
 * Two things it deliberately also asserts.
 *
 * **All four agree**, by value and not by inspection: two spellings of the
 * behaviour is the failure the file exists to prevent, and six call sites each
 * deciding for themselves is the history that produced it.
 *
 * **`matchMedia` is not consulted.** The old decision asked it per call, because
 * Chromium runs a `smooth` scroll at full curve whatever the OS setting says.
 * With nothing animated the two answers are equal, so a media query here would
 * be a control that does nothing — and a future reader wiring one back in is
 * wiring back the asymmetry it repaired. The test makes the *absence* explicit
 * by answering `matches: true` for every query: a helper that still asked would
 * return the same `'auto'` and pass, so what is asserted is that nothing asked.
 */
import { describe, expect, test, vi } from 'vitest'
import {
  SCROLL_BEHAVIOR,
  scrollElementBy,
  scrollElementTo,
  scrollToCenter,
  scrollToTop,
} from './scroll.ts'

/** An element that records what it was asked to do, and nothing else. */
const spyElement = () => {
  const calls: { method: string; options: unknown }[] = []
  const el = {
    scrollIntoView: (options: unknown) => calls.push({ method: 'scrollIntoView', options }),
    scrollTo: (options: unknown) => calls.push({ method: 'scrollTo', options }),
    scrollBy: (options: unknown) => calls.push({ method: 'scrollBy', options }),
  } as unknown as Element
  return { el, calls }
}

/** Every app-performed scroll in the product, driven through its own helper. */
const gestures: { what: string; drive: (el: Element) => void; method: string }[] = [
  {
    what: 'la citation (transcription vers le tour cité)',
    drive: (el) => scrollToCenter(el),
    method: 'scrollIntoView',
  },
  {
    what: 'l’ouverture du gate (rail vers le champ ⚠ faible)',
    drive: (el) => scrollToTop(el),
    method: 'scrollIntoView',
  },
  {
    what: 'le tour de page (vers le bord de la bande lue)',
    drive: (el) => scrollElementTo(el, { top: 747 }),
    method: 'scrollTo',
  },
  {
    what: 'le tour de page (repli d’une page)',
    drive: (el) => scrollElementBy(el, { top: 683 }),
    method: 'scrollBy',
  },
]

describe('aucun défilement que l’app déclenche n’est animé', () => {
  test('le comportement décidé est « auto »', () => {
    expect(SCROLL_BEHAVIOR).toBe('auto')
  })

  for (const { what, drive, method } of gestures) {
    test(`${what} ne s’anime pas`, () => {
      const { el, calls } = spyElement()
      drive(el)
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe(method)
      expect((calls[0].options as { behavior?: string }).behavior).toBe('auto')
    })
  }

  test('les quatre passent la même valeur', () => {
    const behaviours = gestures.map(({ drive }) => {
      const { el, calls } = spyElement()
      drive(el)
      return (calls[0].options as { behavior?: string }).behavior
    })
    expect(new Set(behaviours)).toEqual(new Set(['auto']))
  })

  /*
   * A `ScrollToOptions` the caller supplies never carries the behaviour past the
   * helper: the page turn passes `{ top }`, and this is what stops a call site
   * from adding a second key to it. `check-motion.mjs` catches the *literal*
   * beside a `behavior:` key — including here, because a test is a file like any
   * other and a check with an exemption for the file attacking it is gone — so
   * the value the rule exists to stop is named once, away from the key, and
   * threaded through a variable, which is also the spelling that check can never
   * see and therefore the one worth driving.
   */
  const ANIMATED = 'smooth' as ScrollBehavior

  test('une option fournie par l’appelant ne peut pas rétablir l’animation', () => {
    const { el, calls } = spyElement()
    scrollElementTo(el, { top: 120, behavior: ANIMATED })
    expect((calls[0].options as { behavior?: string }).behavior).toBe('auto')
    const by = spyElement()
    scrollElementBy(by.el, { top: 120, behavior: ANIMATED })
    expect((by.calls[0].options as { behavior?: string }).behavior).toBe('auto')
  })

  test('personne n’interroge matchMedia : les deux réponses seraient égales', () => {
    const matchMedia = vi.fn(
      (query: string) =>
        ({
          matches: true,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
    const before = window.matchMedia
    window.matchMedia = matchMedia as typeof window.matchMedia
    try {
      for (const { drive } of gestures) drive(spyElement().el)
      expect(matchMedia).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = before
    }
  })

  /*
   * The guards, which are the other half of this file and have their own reason:
   * jsdom implements none of the three methods, so an unguarded call turns
   * « the renderer scrolls to the cited line » into a crashed component tree.
   */
  test('une cible sans API de défilement ne fait rien lever', () => {
    expect(() => scrollToCenter(null)).not.toThrow()
    expect(() => scrollToTop(undefined)).not.toThrow()
    expect(() => scrollToCenter(document.createElement('div'))).not.toThrow()
    expect(() => scrollElementTo(document.createElement('div'), { top: 0 })).not.toThrow()
    expect(() => scrollElementBy(document.createElement('div'), { top: 0 })).not.toThrow()
  })
})
