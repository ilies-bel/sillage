# Tokens — the exact values

Generated from `src/design/tokens.css`. Every number here is the shipped value.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg-canvas` | `#f7f9fb` | the window's ground |
| `--bg-card` | `#fdfefe` | a card, a header |
| `--bg-card-soft` | `#f9fbfd` | a side column (rail, aside) |
| `--bg-inner` | `#ffffff` | inside a field, the main reading column |
| `--bg-subtle` | `#eef3f7` | a hover, a disabled fill, a selected chip |
| `--border-subtle` | `#e2e9ef` | a divider |
| `--border-card` | `#d3dee6` | a control's own border |

Text — the contrast ratios are in the source and are load-bearing:

| Token | Value | On white | On `--bg-subtle` |
|---|---|---|---|
| `--text-strong` | `#14202a` | 16.54:1 | 14.80:1 |
| `--text-body` | `#4a5a67` | 7.12:1 | 6.37:1 |
| `--text-muted` | `#62707b` | 5.09:1 | 4.56:1 |

Signal colours, and the one rule that is not obvious:

| Token | Value | Rule |
|---|---|---|
| `--accent` | `#d77000` | **3.38:1 — fill and dot only, never text.** It clears 3:1 as a *graphic* (WCAG 1.4.11) and is still under AA as text, which is why the rule is unchanged. It means exactly one thing: armed, or recording — and that, not the ratio, is why it is not a primary-button colour. It was the client's `#ff8500` at 2.44:1 until the calendar grid proved a mark can be the only carrier. |
| `--success` | `#2f855a` | 4.54:1 — dot only |
| `--warn` | `#b45309` | 5.02:1 — the `⚠ faible` mark, the caution primary |
| `--danger` | `#c53030` | 5.47:1 — one caller: the widget's second press, which ends a recording |

The brand ramp is where blue lives. `--brand-700` is the primary fill (6.28:1 with white on
it); `--brand-700`/`--brand-900` are link and nav ink. Blue marks **selection and
navigation**, orange marks **armed or recording**, and the two never swap.

## Type

| Token | Value |
|---|---|
| `--type-label` | 11px |
| `--type-meta` | 11px |
| `--type-ui` | 12px |
| `--type-copy` | 14px |
| `--type-display` | 28px |

| Family | Stack | Where |
|---|---|---|
| `--font-display` | `"Fraunces", ui-serif, Georgia, serif` — weight 500, tracking −1.5px | page titles, the compte-rendu's own headings, the notepad title |
| `--font-body` | `"Inter", -apple-system, …` | everything else |
| `--font-mono` | `ui-monospace, SFMono-Regular, …` | the markdown markers hanging in the gutter |

**One reading measure: `.measure`, `58ch`, and the number is measured rather than chosen.**
It goes on the element that *holds* the prose, never on a wrapper — `ch` resolves against the
element's own font size, so a wrapper at 14px leaves a 12px child unconstrained. Seven
surfaces wear it. The harness counts characters per line and fails above 75.

## Spacing

| Token | Value |
|---|---|
| `--space-tight` | 6px |
| `--space-inline` | 12px |
| `--space-row` | 16px |
| `--space-block` | 20px |
| `--space-gutter` | 32px |

## Shape

| Token | Value |
|---|---|
| `--radius-sm` | 10px |
| `--radius` | 12px |
| `--radius-lg` | 14px |
| `--border-width` | 1px |
| `--shadow-card` | `0 1px 2px rgb(0 0 0 / 8%)` |
| `--shadow-overlay` | `0 4px 14px rgb(0 0 0 / 38%)` — the widget only, see WIDGET.md |

There is also `--grain`, a 64×64 tiled PNG at very low opacity on the canvas. It is why the
background is not flat, and it will not survive a redraw unless it is deliberately kept.

## Motion

| Token | Value |
|---|---|
| `--motion-fast` | 90ms |
| `--motion` | 150ms |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--ease-in` | `cubic-bezier(0.64, 0, 0.78, 0)` |
| `--ease-overshoot` | `cubic-bezier(0.22, 1.5, 0.36, 1)` |

Three rules, each of which cost a defect to learn:

- **Things arrive on `--ease-out` and leave on `--ease-in`.** The two are one curve read in
  two directions (a 180° rotation about the midpoint), so there is no second piece of taste to
  keep consistent. Shipping the *entering* curve on the only exit in the product made a 150ms
  fade spend 88ms fully transparent — a blink.
- **Opacity and a 2–4px translate only.** No scale, no slide across the screen.
- `prefers-reduced-motion` collapses both durations to `0ms`, and the widget's exit handshake
  reads its own duration off computed style, so this is not cosmetic — the main process waits
  for whatever the renderer resolves.

## Minimum target size

Every control clears **24×24 px** (WCAG 2.2). It is done with `min-h-[24px]` +
`inline-flex items-center`, never with more padding — these controls sit on shared baselines
beside titles, and growing the box downward would shift every one of them. Forty-odd controls
were under it before this rule; `py-1.5` around 12px text resolves to nineteen pixels, which
looks generous in the source.
