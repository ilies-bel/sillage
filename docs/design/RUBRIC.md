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
| 3 | `16f341f` | 7 | 7 | 5 | 5.5 | 6.5 | 5.5 | 7 | 7 | 6 | **56.5** |

**Round 4 split the product across three reviewers in parallel**, because two
whole surfaces had never been evaluated: the in-meeting widget, and the
detection-and-arming path. They are scored apart because they are judged on
different terms — a floating pill over another application's video is not held
to the same chrome rules as a screen.

| Round | Surface | Commit | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | widget | `feee61a` | 6.5 | 5.5 | 6 | 4.5 | 4.5 | 7 | 5 | 5 | 5 | **49** |
| 4 | detection | `feee61a` | 6 | 7.5 | 7 | 5 | 4 | 5.5 | 6 | 7 | 6 | **54** |

What splitting it bought, immediately: **both new reviewers independently found
the same defect, and it was not a design one.** The floating pill drew
`--accent` and announced « Enregistrement en cours » to a screen reader
*unconditionally* — so with no meeting it showed « Aucun enregistrement » beside
the recording colour while saying the opposite out loud. On the one surface
built to be read across a desk, the product's central safety claim was carried
by a mark that said the same thing either way.

Neither reviewer of the main screens had seen it in three rounds, because the
widget is not one of the main screens. A score is only as wide as what you point
it at.

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

**Round 5 kept the three-surface split.** Its per-axis breakdown lives in the
round-5 reports and was not transcribed into this table before the reports were
gone — a process failure, not a scoring one, and the reason round 6 onward
writes its row here as part of the round rather than after it. The totals are
the baseline round 6 is measured against:

| Round | Surface | Commit | Total |
|---|---|---|---|
| 5 | main | `d0a50c9` | **59.5** |
| 5 | detection | `d0a50c9` | **56** |
| 5 | widget | `d0a50c9` | **52** |

Round 5's own « one thing », now shipped (`1b9e9d1`): the calendar grid drew one
orange for « armed » and « recording » both, with a legend explaining only the
second.

**Round 6** writes its per-axis row here as part of the round, which is what
round 5 did not.

| Round | Surface | Commit | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | widget | `eb8ad43` | 7 | 5.5 | 6.5 | 5 | 5.5 | 7 | 6 | 5.5 | 5.5 | **53.5** |
| 6 | main | `d15d2e7` | 7 | 7 | 5 | 6.5 | 6.5 | 5.5 | 7 | 6.5 | 6.5 | **57.5** |
| 6 | widget | `d15d2e7` | 8 | 5.5 | 6.5 | 5 | 6 | 6.5 | 5.5 | 5.5 | 6 | **54.5** |
| 6 | detection | `d15d2e7` | 6.5 | 7.5 | 7 | 5.5 | 6 | 6 | 5.5 | 6.5 | 6 | **56.5** |
