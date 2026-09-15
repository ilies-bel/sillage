/**
 * **The product's mark.**
 *
 * What this replaces was `src/assets/logo.png`: a 644×644 raster carried in at
 * the root commit from the archived predecessor, drawn on the splash and on
 * first run — the two first screens a rep ever sees. Two things were wrong with
 * it and the second is the one nobody noticed for three rounds.
 *
 * It was the **wrong company's mark**, a circled monogram belonging to the
 * product this one replaced. The rename pass that moved every string missed the
 * one file nobody greps.
 *
 * And it was **invisible**: 47.0 % of its pixels opaque, their mean luminance
 * 252.9 / 255 — white artwork on transparency, measured at **1.04:1** against
 * the card it sat on. What actually rendered was its `shadow-card`, an empty
 * rounded square. So the brand moment showed nothing, and what it showed was
 * another company's.
 *
 * A mark and not a picture of one. Three receding strokes — `sillage` is the
 * wake a hull leaves, and the trail is the product: a conversation happened and
 * something of it stays behind. They lean, and they shorten from the top down,
 * because a wake spreads and fades astern; that also keeps the shape off the
 * two silhouettes it could collapse into, a menu glyph (three equal bars) and
 * an arrow. It rhymes with the input meter, which is the one instrument this
 * product makes its proof of life (DEC-38).
 *
 * `var(--brand-*)` in the `stroke` attribute rather than a `stroke-brand-700`
 * utility. Both are tokens; only one of them can fail silently. This repo has
 * shipped `ring-card`, `bg-muted/30` and `decoration-card` — three class names
 * that were right, resolved to nothing, and left an element unstyled with no
 * error — and `stroke-*` is a scale `tailwind.config.js` never declares. A
 * `var()` that does not resolve paints nothing either, but it is read in the
 * file that owns the mark instead of in a plugin's default palette.
 *
 * The ramp is the ramp: `--brand-700` carries the mark (5.14:1 on `--bg-card`,
 * so it is legible as ink and not only as decoration), `--brand-500` and
 * `--brand-300` fade behind it. `--brand-300` is the client's own blue, which
 * VISION §6 licenses as a fill and nothing else — here it is the faintest
 * stroke of a graphic whose contrast is carried by the one above it.
 */
export interface LogoProps {
  /** Size and spacing only — the strokes carry their own colour. */
  className?: string
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      /*
       * `aria-hidden` at both call sites today: the wordmark « Sillage » is set
       * beside it in Fraunces on the splash, and first run names the product in
       * its heading. A mark that repeated the name would be the same word twice
       * to a screen reader.
       */
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      strokeLinecap="round"
    >
      <path d="M4 8 L20 5" stroke="var(--brand-700)" strokeWidth="3" />
      <path d="M6 13.5 L20 11" stroke="var(--brand-500)" strokeWidth="3" />
      <path d="M10 19 L20 17" stroke="var(--brand-300)" strokeWidth="3" />
    </svg>
  )
}
