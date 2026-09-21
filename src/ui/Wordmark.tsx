import { cn } from '../lib/utils.ts'
import { Logo } from './Logo.tsx'

/**
 * **The product's name, set once — because it was set three times and no two
 * agreed.**
 *
 * Measured on the shipped renderer over all 83 stages at both smoke sizes,
 * before this component existed:
 *
 *     ui/Rail.tsx          <p>   28px / **400** / Fraunces / rgb(20, 32, 42)   54 paintings
 *     Splash, Onboarding   <h1>  28px / **500** / Fraunces / rgb(2, 51, 75)    22 paintings
 *
 * Two weights and two colours for one word. Neither file wrote a weight: the
 * base layer gives `h1,h2,h3` `--display-weight` and a `<p>` inherits the
 * body's 400, so **the HTML tag decided how heavy the brand was**. That is the
 * defect `4ee37e6` fixed for the 11px eyebrow — « the same eyebrow was set in
 * two typefaces, and the tag decided which » — reappearing one round later on
 * the top rung of the ladder.
 *
 * And it was not alone on that rung. « Sillage » sat 16 px above and 256 px
 * left of « Jeudi 17 septembre », both 28 px Fraunces, on the screen a rep
 * opens the app to. The page titles have stepped down to `--type-title`; 28 px
 * is the wordmark's now, and `.wordmark` in `src/design/index.css` is the one
 * rule that spends it — face, size, weight, tracking and ink in one place,
 * which `shot.mjs --census` reads back off `:root` and holds every painting of
 * the word to.
 *
 * **The mark travels with it.** The rail had the word and no mark at all — the
 * one surface on every screen of the product, and the least brand on any of
 * them. `ui/Logo.tsx` is drawn beside the word here, so the lockup is one
 * object wherever the product names itself, which is the standing instruction
 * on this mark.
 *
 * **Two props, and the second is not a style.** `stacked` is the splash's
 * vertical lockup, where the mark is the object and the word sits under it.
 * `asHeading` is a *document* question and not a visual one: on the splash and
 * on first run the product's name is what the screen is about, so it is the
 * page's `h1`; in the rail the screen behind it has its own `h1` saying what
 * changed (US-22), and a wordmark that claimed to be the heading would take
 * that from it on all three screens at once. Folding the two into one prop
 * would make the rail's tag follow its layout, which is how this defect
 * started.
 */
export interface WordmarkProps {
  /** The splash's lockup: the mark at 64 px, the word beneath it. */
  stacked?: boolean
  /** `h1` rather than `p` — only where the product's name is the page's subject. */
  asHeading?: boolean
  /** Placement only. The type and the ink are `.wordmark`'s, everywhere. */
  className?: string
}

export function Wordmark({ stacked = false, asHeading = false, className }: WordmarkProps) {
  const Name = asHeading ? 'h1' : 'p'
  return (
    <div
      className={cn(
        'flex',
        /*
         * `gap-snug` in the row: 8 px is the ladder's « a glyph to its word »
         * step and the mark is exactly that.
         *
         * **`gap-hair` stacked, and that is a measurement rather than a
         * preference.** The splash spent `mb-row` — 16 px — between its mark
         * and the word, and 6 px between the word and « COMPTE-RENDU DE
         * RÉUNION » under it. Neither element grouped the first pair, so
         * nothing could see that the lockup was looser inside than it was from
         * its own tagline; wrapping it made `shot.mjs --rhythm` say so at once,
         * on both sizes: « 16px dedans contre 6px autour ». A mark and the word
         * it locks to are one object, so the interval inside has to be the
         * tighter one.
         */
        stacked ? 'flex-col items-center gap-hair' : 'items-center gap-snug',
        className,
      )}
    >
      {/*
        32 px beside the word, 64 px above it. Both are what the two surfaces
        already drew — first run at `h-8 w-8` beside the same 28 px word, the
        splash at `h-16 w-16` above it — and the rail, which had neither, takes
        the row form.
      */}
      <Logo className={stacked ? 'h-16 w-16' : 'h-8 w-8 shrink-0'} />
      <Name className="wordmark">Sillage</Name>
    </div>
  )
}
