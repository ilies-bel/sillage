# The design rubric — how a round is scored

A round used to end `IMPRESSED` / `NOT IMPRESSED`. That is one bit, and it was
always going to be the same bit for several rounds running: it says nothing
about whether a round moved the product, which half of it moved, or what to
spend the next one on.

So a round scores **nine axes out of 10**, against **Granola** as the 10.
`docs/stories/ref/granola-*.png` is the reference and is gitignored — a
competitor's interface and a capture of a real account. Read it locally.

## The axes

| # | Axis | What a 10 looks like |
|---|---|---|
| 1 | **Chrome & shell** | The window frame spends nothing. No band, no stroke doing a ground's job, content to the edges. |
| 2 | **Typographic hierarchy** | One ladder, every rung earned, a real size *and* weight *and* colour step between levels. |
| 3 | **Spacing rhythm** | One scale, visible at a glance. Tight groups, generous separation, more space above a heading than below. |
| 4 | **Density & grouping** | Grouping by space, not by strokes. No container inside a container. |
| 5 | **Colour discipline** | One accent doing one job per screen. Every role distinguishable and named. |
| 6 | **Motion & micro-interaction** | Every state change legible. Arrivals and departures both. Nothing moves that shouldn't. |
| 7 | **States** | Empty, loading, error, hover, focus, disabled — all designed, none a placeholder. |
| 8 | **Craft details** | Optical alignment, one icon weight, one radius family, control heights, focus rings. |
| 9 | **The whole** | Does it read as one product by one hand — and would you ship it against Granola? |

## Scoring

- **1–3** broken or absent · **4–5** functional, visibly dated · **6–7** competent, clearly behind
- **8** good; a reasonable person would ship it · **9** excellent; better than Granola on this axis somewhere
- **10** nothing left to say

Score the **product as it is now**, never the delta. A round that fixed a lot can
still score 6 — and an axis that was 8 last round and is 7 now is a regression,
which is the thing a single verdict could never show.

**Every score carries the one measurement that pins it.** A number with no
observation behind it is the fourth shape on `CLAUDE.md`'s list. Half-points are
allowed; a range is not.

## The report

1. A table: axis · score · the one measurement.
2. **Movement** — each axis against the previous round's score, and the cause.
   A regression is named as a regression.
3. Ranked findings, most expensive first, each naming the axis it would lift.
4. **The one thing** — the single highest-value change available now.
5. Last line: `TOTAL: NN/90`.

## History

| Round | Commit | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `b716856` | — | — | — | — | — | — | — | — | — | *pre-rubric, `NOT IMPRESSED`, 15 findings* |
| 2 | `84a326f` | 7 | 7 | 5 | 5 | 6 | 5 | 7 | 6 | 6 | **54** |

Round 2's own notes, kept because the next round is scored against them:

- The three axes that moved from round 1 were **chrome**, **typography** and
  **craft** — the band, the split document scale, and Tailwind's scales leaking
  past `theme.extend`. Craft moved furthest because it became *enforced*
  (`check:tokens`' fourth rule) rather than merely tidied.
- **Density moved sideways and that counts as a regression.** Taking the boxes
  off the agenda removed the only thing bracketing *Passées*, and the three row
  grammars underneath — a 132px spread of title left edges — became the most
  visible thing on the home screen. A fix that exposes something worse is not a
  fix yet.
- Motion scored 5 on one measurement: « 0 qui s'en vont, 0 @keyframes de
  sortie » on all eight app screens. `--ease-in` was declared, argued over forty
  lines and worn by one element, in the other window.
- The round withdrew its own round-1 request for a sliding thumb on `Segmented`
  and ruled the §6 refusal correct — then named the real defect behind it, a
  selection resting on **1.08:1** of fill. A request is evidence of a problem
  and not a specification of the fix.
