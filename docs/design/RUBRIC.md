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

**Score blind.** Read the axes and the scale, look at the product, write the whole
table — *then*, and not before, open `RUBRIC-HISTORY.md` to write the Movement
section. A scorer who knows last round's number scores last round's number: two
blind readings of the same commit came in at 66 and 68 where the anchored protocol
had been reading 49.5–58, a systematic 8–18 points, and the two blind readings
disagreed with each other by 2. The axes are reliable; the anchoring was not.

**The history is a separate file because this instruction was unobeyable in one.**
It sat sixty lines above the History table, and a single read of this file returned
both. In round 22 **all three scorers were anchored before they wrote a number** —
independently, by the same mechanism, each disclosing it unprompted. Three agents
failing one instruction the same way is a defect in the instruction, not in the
agents: the same reading this repo applies to its own checks. Do not merge the two
files back together, and do not quote a past score into a scorer's brief.

**The agent that hunted the defects does not assign the score.** Ending a round
`NOT IMPRESSED` « unless nothing survives » is the right mandate for finding
faults and the wrong one for measuring, because every measurement then in hand is
a fault. Split the roles.

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

