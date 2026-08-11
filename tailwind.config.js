/**
 * Tailwind, mapped onto the design tokens in `src/design/tokens.css`.
 *
 * This file is how the screens consume the system: they write `text-strong`,
 * `bg-card`, `border-card`, `px-row`, `text-ui`, never a raw value. Every entry
 * below is a `var()` reference and never a literal — the tokens have one home,
 * `src/design/tokens.test.ts` checks that home against VISION.md §6 on every
 * run, and `scripts/check-tokens.mjs` fails the build on a hex typed anywhere
 * under `src/`. A literal here would be a value outside both loops.
 *
 * The palette is the brand ramp of VISION.md §6: hue 200, six steps, because
 * the client's own blue `#4dc2fb` is 2.01:1 on white and cannot carry text, an
 * icon, a border or a state dot. `brand-300` is that blue — it is available as
 * a fill and it is a bug anywhere else. Orange (`accent`) has exactly one
 * meaning, "armed or recording", and it is a fill and a dot, never text.
 *
 * The previous config belonged to the old product: a dark theme, an orchid
 * accent, a `legacy-action` blue kept "immune to the Settings orchid scope",
 * and eight keyframes for things that bounced. VISION.md §6 says ≤150ms,
 * ease-out, opacity and 2–4px translate only, nothing bounces — so almost all
 * of it went rather than being renamed.
 *
 * Naming: Tailwind cannot recompute alpha on a bare `var()`, so a `/NN` opacity
 * modifier on any token below silently compiles to nothing. Add a named token
 * instead of reaching for `bg-card/60`.
 *
 * Naming, second rule: a key may not appear in both `colors` and `fontSize`,
 * because both plugins claim the `text-` prefix and the class would emit two
 * rules. That is why the type scale is `label / meta / ui / copy / display` and
 * not `… / body / …` — `text-body` is already the body *colour*.
 */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        card: 'var(--bg-card)',
        'card-soft': 'var(--bg-card-soft)',
        inner: 'var(--bg-inner)',
        subtle: 'var(--bg-subtle)',

        strong: 'var(--text-strong)',
        body: 'var(--text-body)',
        muted: 'var(--text-muted)',

        /* Provenance (DEC-5). Colour alone — no badges, no icons. */
        'ink-rep': 'var(--ink-rep)',
        'ink-agent': 'var(--ink-agent)',

        /*
         * The ramp. Ratios vs #ffffff are in tokens.css beside each value:
         * 50 and 100 are washes, 300 is fill-only, 500 clears 3:1 (non-text
         * UI: borders, focus rings, state dots), 700 and 900 carry text.
         */
        'brand-50': 'var(--brand-50)',
        'brand-100': 'var(--brand-100)',
        'brand-300': 'var(--brand-300)',
        'brand-500': 'var(--brand-500)',
        'brand-700': 'var(--brand-700)',
        'brand-900': 'var(--brand-900)',

        /*
         * The input meter's third state: measured, and under the transcriber's
         * floor. A named token because the `bg-muted/30` it replaces was the
         * exact failure the naming rule above warns about — it compiled to
         * nothing and the bars were invisible.
         */
        'meter-dropped': 'var(--meter-dropped)',

        accent: 'var(--accent)',
        success: 'var(--success)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
      borderColor: {
        DEFAULT: 'var(--border-subtle)',
        subtle: 'var(--border-subtle)',
        card: 'var(--border-card)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      /*
       * Five steps, added alongside Tailwind's numeric scale rather than
       * replacing it — `px-row` and `py-tight` say what they are for, and the
       * numeric utilities stay available for the one-off cases that are not
       * part of the system.
       */
      spacing: {
        tight: 'var(--space-tight)',
        inline: 'var(--space-inline)',
        row: 'var(--space-row)',
        block: 'var(--space-block)',
        gutter: 'var(--space-gutter)',
      },
      fontSize: {
        label: 'var(--type-label)',
        meta: 'var(--type-meta)',
        ui: 'var(--type-ui)',
        copy: 'var(--type-copy)',
        /*
         * The one step that carries tracking, because tracking is a property of
         * the size and not of the tag. `-1.5px` is a 28px setting; the base
         * layer used to hang it on every `h1/h2/h3` and so applied it to a 14px
         * meeting title and a 10px eyebrow as well.
         */
        display: ['var(--type-display)', { letterSpacing: 'var(--display-tracking)' }],
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },
      transitionDuration: {
        DEFAULT: 'var(--motion)',
        fast: 'var(--motion-fast)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-out)',
        out: 'var(--ease-out)',
      },
      /*
       * Two, and both obey the rule: opacity plus a small translate, ≤150ms,
       * no scale and no spring. The signal rail uses neither — a chip that
       * moves during a call is a chip that steals a glance (DEC-14).
       */
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn var(--motion) var(--ease-out)',
        'rise-in': 'riseIn var(--motion) var(--ease-out)',
      },
    },
  },
  plugins: [],
}
