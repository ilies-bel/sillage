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
        /*
         * The meter's two channels. Named because the meter is a *graphic* and
         * was drawing with two text steps — see `--widget-meter-rep` in
         * tokens.css for the 1.51:1 collapse that cost.
         */
        'meter-rep': 'var(--meter-rep)',
        'meter-client': 'var(--meter-client)',

        /* The one sheet's backdrop (Réglages). See `--veil` in tokens.css. */
        veil: 'var(--veil)',

        /* The splash panel, over the blurred washes. See `--bg-scrim`. */
        scrim: 'var(--bg-scrim)',

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
      /*
       * The same two rules, reachable from `ring-*`.
       *
       * They were not, and the failure was silent in exactly the way the naming
       * rule above describes: `StateDot`'s `pending` tone is
       * `bg-transparent ring-1 ring-inset ring-card`, `ring-card` resolved to no
       * colour, and the outline that *is* the dot never drew. On the splash the
       * « Audio » row therefore had a hole where the other two rows have a dot —
       * which is the rendering fault an empty slot was invented to avoid.
       *
       * `ring` and `border` are two utilities over one pair of tokens; whatever
       * `border-x` can say, `ring-x` has to be able to say too, or the next
       * outline is invisible for the same reason.
       */
      /*
       * And the third utility that draws a rule, for the third time.
       *
       * `decoration-card` would otherwise resolve through the generic `colors`
       * palette to `--bg-card` — a near-white *background* token — so a dotted
       * underline asked to be the weight of a table rule would have drawn in the
       * colour of the paper. Same shape as `ring-card` below and `bg-muted/30`
       * before it: the class name is right, something resolves, and the element
       * is silently unstyled. A rule-drawing utility reads the border tokens,
       * and `design/tokens.test.ts` holds the three scales to each other.
       */
      textDecorationColor: {
        subtle: 'var(--border-subtle)',
        card: 'var(--border-card)',
        muted: 'var(--text-muted)',
      },
      ringColor: {
        DEFAULT: 'var(--border-subtle)',
        subtle: 'var(--border-subtle)',
        card: 'var(--border-card)',
        muted: 'var(--text-muted)',
        brand: 'var(--brand-500)',
        /* The armed dot is a hollow ring — see `StateDot`'s `armed` tone. */
        accent: 'var(--accent)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        /*
         * **The one radius that is not a card corner.** The input meter's bars
         * are three pixels wide (`session/LevelMeter.tsx`), and the 10–14px
         * band VISION §6 sets for a *box* would round each of them into a dot.
         * They wore `rounded-[1px]`, an arbitrary value, which is the shape
         * `check:tokens` now rejects everywhere else — so it is named here
         * instead of exempted there. A rung for a cap on a bar, not a fourth
         * step on the card scale; nothing with a border should reach for it.
         */
        bar: '1px',
      },
      /*
       * **One entry, and `shadow-card` is gone because nothing wore it.**
       *
       * It was mapped here, backed by `--shadow-card` in `tokens.css`, and had
       * **zero** `className` occurrences anywhere under `src/` — a utility a
       * developer could reach for and that no screen had ever used. Same shape as
       * the two motion tokens US-3 found unspent, and as `ring-card`, which named a
       * colour `ringColor` did not have and drew nothing: the class name is right,
       * something resolves, and no screenshot shows anything.
       *
       * Deleted rather than sprinkled onto a surface to justify it. Every card in
       * this product is a 1px `--border-card` on `--bg-card`, which is what VISION
       * §6's « Borders 1px » and « Density over decoration » produce, and adding an
       * elevation to one pane to use up a declaration is the opposite of a design
       * system. `--shadow-card` stays in `tokens.css` — VISION §6 names its value,
       * and `--shadow-overlay`'s own reasoning is stated *relative* to it — so the
       * day a surface genuinely lifts off the paper this is one line again.
       */
      boxShadow: {
        /* The in-meeting widget, which floats over another application. */
        overlay: 'var(--shadow-overlay)',
        /*
         * **Back, and this time something wears it** — the condition the
         * paragraph above set when it deleted this line (« the day a surface
         * genuinely lifts off the paper this is one line again »).
         *
         * Two surfaces do, and both were reaching for Tailwind's own `shadow-sm`
         * to get it, which `check:tokens` now refuses: the page turn's floating
         * control (`ui/PageTurn.tsx`), which hovers *over* the column it
         * scrolls, and the selected chip in `ui/Segmented.tsx`, which is lifted
         * off its own track. VISION §6 names this exact value — « Shadows barely
         * there (0 1px 2px rgb(0 0 0 / 8%)) ».
         *
         * **It said three, and named the two app icons on the splash and on
         * first run.** Those were `<img>` elements carrying the archived
         * predecessor's mark as white artwork on transparency, so the shadow was
         * the only thing that rendered — an empty rounded square standing in for
         * a logo (`ui/Logo.tsx`). The mark is drawn now and stands on its own;
         * the box and the lift existed to make a raster read as an app icon.
         * The sentence also missed `Segmented`, which had been wearing this and
         * saying so in its own file the whole time.
         *
         * The paragraph's other half still holds and is the reason this list is
         * two entries and not five: a **card** in this product is a 1px
         * `--border-card` on `--bg-card`, flat. The cards that wore `shadow-sm`
         * — first run's three, the calendar-connect panel — did not get this
         * token, they lost the shadow.
         */
        card: 'var(--shadow-card)',
      },
      /*
       * Five steps, added alongside Tailwind's numeric scale rather than
       * replacing it — `px-row` and `py-tight` say what they are for, and the
       * numeric utilities stay available for the one-off cases that are not
       * part of the system.
       */
      spacing: {
        hair: 'var(--space-hair)',
        snug: 'var(--space-snug)',
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
         * The document ladder. See `--type-prose` in tokens.css for why these
         * four exist and why they are sizes rather than a ratio: they are the
         * settings the notepad and the compte-rendu were already drawing with,
         * off the scale, in two versions that disagreed by one step.
         *
         * `title` and not `heading-lg`, `prose` and not `body`: a key may not
         * appear in both `colors` and `fontSize` (the rule at the top of this
         * file), and `text-body` is already the body *colour*.
         */
        prose: 'var(--type-prose)',
        subhead: 'var(--type-subhead)',
        heading: 'var(--type-heading)',
        title: ['var(--type-title)', { letterSpacing: '-0.8px' }],
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
      /*
       * **`transition` means the pointer's own feedback, which is the fast rung.**
       *
       * `DEFAULT` was `--motion` and `fast` was `--motion-fast`, and a grep for
       * `duration-fast` under `src/` returned **nothing** — so the fast rung was
       * declared in `tokens.css`, mapped here, and drawn by no element in the
       * product. Measured on the shipped renderer across six stages: 311 live
       * declarations, of which 307 are a bare `transition` on a hover tint, all
       * of them at 150ms. One duration, on a token file that documents two.
       *
       * What `transition` is written on, everywhere it appears, is a control
       * answering the pointer: a row tint, a chip, a button, a nav item, a
       * segmented option, a calendar cell, a dotted underline. That is the
       * frequency table's « hundreds of times a day → reduce » row, and 90ms is
       * where it lands — measured per animation frame, the change is 44% landed
       * at the second frame at 150ms and 79% at 90ms. `tokens.css` carries the
       * table.
       *
       * `--motion` is not orphaned by this and is not reachable as a utility on
       * purpose: it belongs to a *surface* arriving or leaving, and all three of
       * those are declared as rules rather than assembled out of utilities —
       * `animate-rise-in`, `animate-fade-in` and `.widget-leaving`. A
       * `duration-slow` class would be a fourth way to spell the same thing and
       * would be the first to drift.
       */
      transitionDuration: {
        DEFAULT: 'var(--motion-fast)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-out)',
        out: 'var(--ease-out)',
        /*
         * **The exit curve, reachable from a utility — and it was not.**
         *
         * `--ease-in` existed, argued over forty lines of `tokens.css` and
         * pinned by shape in `tokens.test.ts`, but the only way to spend it was
         * a hand-written `transition:` in `index.css`. So the first element
         * outside that file to need it — the Réglages veil, fading out with the
         * sheet — reached for `transition-opacity`, got `DEFAULT`, and left on
         * the *arriving* curve. `shot.mjs --motion` caught it on the new
         * `reglages-sortie` stage: « 1 élément qui s'en vont portent une courbe
         * d'arrivée », which is the exact defect that check was written for and
         * the exact defect the widget's exit shipped with for a round.
         *
         * A rule with no way to obey it is a rule that will be broken. VISION.md
         * §6: « ease-out on the way in, ease-in on the way out ».
         */
        in: 'var(--ease-in)',
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
