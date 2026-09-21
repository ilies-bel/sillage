# The design rubric — the history

**Do not open this file until your score table is written.** It holds every round's
scores and every round's findings. `docs/design/RUBRIC.md` says to score blind, and
for three rounds that instruction sat sixty lines above the History table in the same
file: a single read returned both, and in round 22 **all three scorers saw the
previous round's numbers before writing one of their own** — independently, and each
disclosed it. The instruction was unobeyable as filed. It is a separate file now so
that obeying it is the default rather than an act of discipline.

Read `RUBRIC.md`, look at the product, write the whole table — *then* come here to
write the Movement section against what you find.

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
| 7 | widget | `94cc4b0` | 8 | 5 | 6.5 | 5 | 6 | 6.5 | 6 | 5 | 5.5 | **53.5** |
| 7 | detection | `94cc4b0` | 6.5 | 7.5 | 7.5 | 5.5 | 6.5 | 6 | 6 | 6.5 | 6 | **58** |
| 7 | main | `94cc4b0` | 7 | 7 | 6.5 | 6 | 6 | 5.5 | 6.5 | 7 | 6.5 | **58** |
| 8 | widget | `8d6b5ab` | 8 | 5 | 6.5 | 4.5 | 6 | 6 | 5.5 | 5.5 | 5.5 | **52.5** |
| 8 | main | `8d6b5ab` | 7 | 6.5 | 6 | 6 | 6.5 | 5.5 | 6.5 | 6.5 | 6.5 | **57** |
| 8 | detection | `8d6b5ab` | 6.5 | 7.5 | 7.5 | 5 | 6.5 | 6 | 6.5 | 6.5 | 6 | **58** |
| 9 | widget | `fb55045` | 7.5 | 5 | 6 | 4.5 | 5.5 | 6 | 6 | 5 | 5.5 | **51** |
| 9 | main | `fb55045` | 7 | 6.5 | 6 | 6 | 6.5 | 5.5 | 6.5 | 6.5 | 6.5 | **57** |
| 9 | detection | `fb55045` | 6.5 | 7.5 | 7.5 | 5 | 6 | 6 | 6 | 6.5 | 6 | **57** |
| 10 | main | `15fc6d4` | 7 | 6.5 | 5.5 | 6 | 6.5 | 6 | 6 | 6 | 6.5 | **56** |
| 10 | detection | `15fc6d4` | 7 | 7.5 | 7.5 | 5.5 | 5.5 | 6 | 5.5 | 6.5 | 5.5 | **56.5** |
| 10 | widget | `15fc6d4` | 7.5 | 5 | 6 | 4.5 | 6 | 6 | 6.5 | 5.5 | 5.5 | **52.5** |
| 11 | main | `b76c702` | 6.5 | 6 | 5.5 | 5.5 | 6 | 6 | 6 | 6.5 | 6.5 | **54.5** |
| 11 | detection | `b76c702` | 7 | 7.5 | 7 | 5.5 | 5.5 | 6.5 | 5 | 6 | 5.5 | **55.5** |
| 11 | widget | `b76c702` | 7 | 6 | 6 | 4.5 | 5.5 | 6 | 5.5 | 5 | 5.5 | **51** |
| 12 | detection | `f021867` | 7 | 7.5 | 7 | 5.5 | 5.5 | 6 | 5.5 | 6 | 5.5 | **55.5** |
| 12 | main | `f021867` | 6.5 | 6 | 5.5 | 5.5 | 5.5 | 5.5 | 6 | 6 | 6.5 | **53** |
| 12 | widget | `f021867` | 7 | 6 | 6 | 5 | 5.5 | 6 | 5.5 | 5.5 | 5.5 | **52** |
| 13 | widget | `aea9987` | 6.5 | 6 | 5.5 | 5 | 5.5 | 5.5 | 5 | 5.5 | 5.5 | **50** |
| 13 | detection | `aea9987` | 7 | 7.5 | 6.5 | 5.5 | 6.5 | 6 | 5.5 | 5.5 | 5 | **55** |
| 13 | main | `aea9987` | 6.5 | 6 | 5.5 | 5.5 | 5.5 | 6 | 6 | 6 | 6.5 | **53.5** |
| 14 | widget | `01c74f5` | 7.5 | 6 | 5 | 5.5 | 5 | 5 | 4 | 5 | 5 | **48** |
| 14 | main | `01c74f5` | 6.5 | 6 | 5.5 | 5 | 6 | 5.5 | 6 | 5.5 | 6.5 | **52.5** |
| 14 | detection | `7ac4017` | 7 | 7.5 | 6 | 5 | 6.5 | 6 | 5 | 5.5 | 5 | **53.5** |
| 15 | widget | `9e73fba` | 7 | 6 | 5.5 | 5.5 | 5.5 | 4.5 | 5.5 | 5 | 5 | **49.5** |
| 15 | main | `9e73fba` | 6.5 | 6 | 5.5 | 5.5 | 5.5 | 5.5 | 6 | 5.5 | 6.5 | **52.5** |
| 15 | detection | `9e73fba` | 7 | 7.5 | 6 | 5 | 6 | 6 | 5 | 5.5 | 5 | **53** |
| 16 | widget | `f6ae677` | 7 | 6 | 5.5 | 5.5 | 6 | 4.5 | 5 | 5 | 5 | **49.5** |
| 16 | main | `f6ae677` | 6.5 | 6 | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | 6 | **51.5** |
| 16 | detection | `f6ae677` | 7 | 7.5 | 6 | 5 | 5.5 | 5 | 5 | 5.5 | 5 | **51.5** |
| 17 | widget | `662ad78` | 7 | 6 | 5.5 | 5.5 | 6 | 4.5 | 5.5 | 5 | 5 | **50** |
| 17 | main | `662ad78` | 6.5 | 6 | 5.5 | 5.5 | 5.5 | 5.5 | 4.5 | 5 | 5.5 | **49.5** |
| 17 | detection | `662ad78` | 7 | 7.5 | 6.5 | 5 | 5.5 | 5 | 4 | 5.5 | 4.5 | **50.5** |
| 18 | widget | `38d85be` | 7 | 6 | 5.5 | 5.5 | 6 | 4.5 | 4.5 | 5 | 4.5 | **48.5** |
| 18 | main | `bccdca5` | 6.5 | 6 | 5.5 | 5.5 | 5.5 | 5.5 | 6 | 5 | 6 | **51.5** |
| 18 | detection | `497240f` | 7 | 7.5 | 6.5 | 5 | 5.5 | 5 | 5 | 5.5 | 5 | **52** |
| 19 | widget | `f6ffdc7` | 7 | 7 | 5.5 | 5.5 | 6.5 | 6.5 | 5.5 | 5 | 5.5 | **54** |
| 19 | detection | `9f597b7` | 7 | 7 | 6 | 5 | 5.5 | 5 | 6 | 5.5 | 5.5 | **52.5** |
| 19 | main | `89882fd` | 7 | 7 | 5.5 | 7 | 6.5 | 6 | 6.5 | 6.5 | 6 | **58** |
| 20 | widget | `9c9c995` | — | — | — | — | — | — | — | — | — | **53.5** † |
| 20 | detection | `19cb51a` | — | — | 6.5 | 6 | 6 | 5 | — | — | — | **54.5** |
| 21 | main | `c558d61` | 7 | 7.5 | 6.5 | 6.5 | 8 | 8 | 8 | 7.5 | 7 | **66** ‡ |
| 21 | main | `c558d61` | 7 | 8 | 7.5 | 6.5 | 8 | 8 | 7.5 | 8 | 7.5 | **68** ‡ |
| 21 | widget | `69e0b89` | 8.5 | 8 | 6.5 | 9 | 8 | 9 | 8.5 | 8.5 | 8.5 | **74.5** ‡ |
| 21 | main | `69e0b89` | 8.5 | 7.5 | 8 | 6.5 | 9 | 7 | 8.5 | 7 | 8 | **70** ‡ |
| 21 | detection | `69e0b89` | 7 | 7 | 7.5 | 7.5 | 8.5 | 8.5 | 7.5 | 8 | 7.5 | **69** ‡ |
| 22 | widget | `60f9686` | 9 | 7.5 | 6.5 | 9 | 8 | 8.5 | 7.5 | 7.5 | 7.5 | **71** ◊ |
| 22 | main | `60f9686` | 7.5 | 7 | 8 | 6.5 | 8 | 8 | 7.5 | 8 | 7 | **67.5** ◊ |
| 22 | detection | `60f9686` | 7.5 | 7 | 7.5 | 7 | 6.5 | 8 | 8 | 7 | 7 | **65.5** ◊ |

**Round 14 detection was measured against a tree I was editing under it, and that
is my error, not the reviewer's.** The round's own instructions say a review runs
against a clean baseline and never beside an implementing agent. It ran beside
one: `HEAD` stayed `7ac4017` throughout, but from 18:03 I was saving into the
main checkout — `Review.tsx`, `shot.mjs`, `index.css`, `tokens.css`, `VISION.md`
— so `smoke.mjs` ran red at 18:12 under a stage of mine that had not yet been
declared, and one `npm test` caught a half-written file. The reviewer noticed,
timestamped every measurement it kept to 17:44–18:05, and verified that
`electron/` — where all nine of its findings live — is untouched in that diff.
So the numbers stand; what does not is the method, and the cost of the collision
was borne by the reviewer rather than by me.


## Round 21: the instrument, measured — ‡ the two blind readings

**Two scorers, the same commit, the same prompt, neither allowed to read this
section. 66 and 68.** The last anchored reading of this surface was **58**
(round 19) and the one before it **49.5** (round 17).

Round 16's narrative already says it, in the reviewers' own words: « the
surfaces did not decline, the instrument widened ». That was five rounds ago
and nothing was done about it, so here is the measurement.

### What the series says

All 47 recorded totals, by surface:

| surface | peak | at round | latest | net, first to last | mean Δ/round | rounds to 90 at that rate |
|---|---|---|---|---|---|---|
| main | 58 | 7 | 58 (r19) | **+0.5** over 13 rounds | +0.04 | 832 |
| detection | 58 | 7 | 54.5 (r20) | **−3.5** over 16 rounds | +0.03 | 1065 |
| widget | 54.5 | 6 | 53.5 (r20) | +4.5 over 16 rounds | +0.28 | 130 |

Every surface peaked at round 6–7 and has never beaten that peak. Detection ran
**ten consecutive non-positive deltas** (58 → 50.5, rounds 7–17); main ran
58 → 49.5 and then recovered **+6.5 in one round**. A product does not decline
for eleven consecutive rounds while every round lands fixes with twelve gates
green, and it does not gain 6.5 points in one. That shape — a long slow slide
punctuated by a snap-back — is a drifting scale, not a changing product.

### The blind test

Two `sillage-adversary` instances, identical prompts, same clean tree at
`c558d61`, each told not to read this History and to disregard any past score
it saw. Neither knew of the other.

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | total |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 7 | 7.5 | 6.5 | 6.5 | 8 | 8 | 8 | 7.5 | 7 | **66** |
| B | 7 | 8 | 7.5 | 6.5 | 8 | 8 | 7.5 | 8 | 7.5 | **68** |
| Δ | 0 | .5 | 1 | 0 | 0 | 0 | .5 | .5 | .5 | **2** |

**The axes are fine.** Nine axes, maximum disagreement of one point on any of
them, two points on ninety — that is good inter-rater reliability, and it says
the rubric's definitions are well enough specified for two strangers to apply
them the same way. Both tables also sum to their own totals, which round 20's
did not.

**The protocol was the defect.** Blind, the surface reads 66–68. Anchored, the
same surface read 49.5–58. The gap is systematic, it is 8 to 18 points, and
three things in the old protocol produce it:

1. **The scorer's mandate is to find fault.** `sillage-adversary` ends
   `NOT IMPRESSED` « unless nothing survives ». The number is assigned by the
   agent that has just spent a round hunting defects, and the rubric asks it to
   pin every score to « the one measurement » — but the measurements in its
   hands are all faults.
2. **It reads the previous score.** The report's « Movement » section requires
   comparing against the last round, so the scorer anchors on the last *number*
   rather than on the product. Small negative steps then compound: eleven of
   them cost main 8.5 points with nothing behind them.
3. **The ceiling has no exemplar.** « Granola as the 10 » is a feel, judged
   fresh each round by a different instance.

### What changes, and what does not

The axes, the 1–10 descriptions and what a 10 means are **unchanged**. Only the
procedure changes, and the precedent is `pinnedNow`: an instrument that made two
rounds measure two different products was fixed so they measure one.

**66–68 is not progress and must not be read as a jump.** It is a
re-measurement of a product that was already there. Roughly nine points of what
was being called « the gap to 90 » was measurement artefact.

### Where the remaining ~22 points actually are

Both scorers worked independently and converged on the same defects, which is
much stronger evidence than either alone:

| axis | A and B agree | corroborated finding |
|---|---|---|
| 4 Density | 6.5 / 6.5 | **the gate-rail half is withdrawn, see below**; historique's bordered `li.bg-card.border-card` around a bordered `div.bg-inner.border-subtle` stands, as do 14 / 12 / 22 hairlines per viewport in two greys. |
| 1 Chrome | 7 / 7 | `ui/TitleBar.tsx` is an empty `role="presentation"` strip, 36px full-width, carrying nothing, with the app's own header band stacked under it — 118px, 14.8% of an 800px window, above the first agenda row. Verified in the source. |
| 9 The whole | 7 / 7.5 | `session-compte-rendu` at 960×600: three columns, three scrollers, two simultaneous page turns, one visible line of the document. |
| 3 Spacing | 6.5 / 7.5 | a 4px scale with three off-grid half-steps; nine distinct paddings on one screen. |
| 2 Typography | 7.5 / 8 | ~~both found this one unprompted: the title step is 1.27× on review~~ — **withdrawn on inspection, see below.** |
| 8 Craft | 7.5 / 8 | 5 undeclared painted marks on agenda, 11 on réglages. Independently verified here: the four calendar marks carry `data-graphic` in the grid cell (`CalendarGrid.tsx:320`) and **not** in the legend (`:238`), where the dot is the entire content of its element and the four colours are compared side by side. |

### One of them dissolved, and that is the point of checking

The typography row above is withdrawn. Both scorers independently measured the
review gate's title at **1.27×** (19px `--type-heading` over 15px `--type-prose`)
against 2× and 2.33× elsewhere, and both called it the weak rung. It is neither.

`Review.tsx:1909` argues the case and measures it: the title there is **the
meeting's own name**, not the word « Revue » — a 28px serif `<h1>Revue</h1>` was
what stood there, naming the furniture, with the call in muted 12px beside it.
The rep arrived by pressing *Relire et valider* on that call thirty seconds ago,
and the one press on this screen writes into that client's CRM, so the strongest
ink belongs to which call this is. At 960 — the minimum width `main.ts` declares
— a 28px setting of a real meeting title truncates beside a `⚠ faible` banner
that is itself load-bearing.

And the axis does not ask for a size ratio. It asks for « a real size *and*
weight *and* colour step ». The header is `text-heading font-semibold
text-strong` over 15px/400/body: **all three steps are present**. Two scorers
reduced a three-part criterion to its first part and scored a documented,
measured decision as a defect.

Two independent reviewers agreeing makes a finding **worth checking**, not
correct. That is the same trap as the one in `CLAUDE.md`'s ledger — a figure
quoted back by a reviewer as the basis for a recommendation — and the corrected
entry there was added this same round. Five of the six rows above survived
inspection; this is the sixth, and it was the one singled out as strongest.

### And a second one, which exposes a contradiction in axis 4 itself

Scorer A: « the gate's rail still nests white value boxes in a tinted panel in
the aside ». Literally true — three grounds, aside → container → box. The word
doing the damage is *still*: that nesting is not the defect, it is the **repair**,
and `Review.tsx:2576` carries the before and after.

The rail used to draw eleven value boxes on three nested grounds and let
**fifty-eight strokes** do all the grouping. Sampled on the shipped screen:

| pair | ratio | ΔL* |
|---|---|---|
| container on the aside (`--bg-card` on `--bg-card-soft`) | 1.027:1 | 1.06 |
| a value box on the container (`--bg-inner` on `--bg-card`) | **1.010:1** | **0.42** |

A just-noticeable difference in L* is about 1. At 0.42 the box and its ground
were the same colour, so the only reason a rep could see eleven fields was the
three concentric strokes around each. The fix inverted rather than darkened —
container to `--bg-subtle`, editable field stays white:

| pair | ratio | ΔL* |
|---|---|---|
| container on the aside | 1.077:1 | 2.94 |
| a value box on the container | 1.117:1 | **4.42** |

Ten times the step, from tokens that already existed, and the strokes came off.

**So the axis contradicts itself on this case.** Axis 4 reads « Grouping by
space, not by strokes. No container inside a container. » The rail satisfies the
first sentence *by means of* breaking the second: it groups by ground instead of
by stroke, and a ground step requires a nested ground. Judged by sentence one it
is the best-argued region on the surface; judged by sentence two it is a defect.
Axis 4 has been the lowest or near-lowest axis in every round since round 2,
which is what you would expect of a criterion that penalises the product's own
deliberate grouping strategy.

**Left open, deliberately, and not resolved here.** Rewording an axis is not the
same kind of act as fixing the scoring procedure: the procedure change made two
rounds measure one product, whereas loosening a criterion would make 90 easier to
reach, and that is the owner's call and not the integrator's. The conflict is
recorded so the next blind scorer meets both sentences and the rail's argument
together, and so nobody spends a round flattening a ground step that was measured
into place.

### What both withdrawals have in common

Both dissolved the same way: a blind scorer read the rendered screen, matched a
pattern the rubric names as bad, and could not tell an unfixed defect from an
argued remedy that looks like one. That is the **cost of blind scoring**, and it
is a real cost of the change made this round — a scorer who reads the source
reasoning is anchored by it, and one who does not will keep re-reporting settled
questions. It does not outweigh an 8-to-18-point systematic bias, but it means a
corroborated finding is a *lead*, never a work item: check it against the source
before anyone spends a round on it. Two of six did not survive that check, and
both were among the three I ranked highest.

That list, less those two rows, is what a round should be spent on.

### The rule this adds

**A score is taken blind.** Read the axes and the scale, look at the product,
write the table — then and only then read this History to write the Movement
section. A scorer that knows last round's number is measuring last round's
number. And the agent that hunted the defects does not assign the score.


## Round 21, closed: the first movement this project has measured

Three blind scorers, one per surface, at `69e0b89`. Nobody read the History.

| surface | round 21, blind | last anchored | anchored peak, 20 rounds |
|---|---|---|---|
| widget | **74.5** | 53.5 | 54.5 (r6) |
| main | **70** | 58 | 58 (r7) |
| detection | **69** | 54.5 | 58 (r7) |

**Main is the one with a controlled comparison.** Two blind readings mid-round,
before any lane merged, gave 66 and 68. The post-merge blind reading is 70. So
the round moved it **+3 on a consistent instrument** — small, real, and the
first such number in twenty-one rounds. The other two surfaces have no blind
predecessor, so their gap against the anchored series is re-measurement, not
progress, and is recorded as such.

Every table summed to its own total. Both later scorers **verified their own
provenance unprompted** — each checked that the diff across its run touched no
file under `src/` or `electron/` — which is the round-14 error policing itself
without being asked.

### What the round shipped

Twenty-five commits. Three defects reachable on Windows, the primary platform:
three terminal states (`pushing`, `done`, `aborted`) drawing a screen with
nothing on it, reachable every time WASAPI loopback fails to open; a dry-run
*Autoriser* that could take no branch at all on a granted host; and a correct
French refusal rendered 810px above the top of the window. Plus a full-screen
invisible dialog with no way out on reopening Réglages; an exit animation that
painted **zero** intermediate frames, the row blinking out and leaving a hole
for a quarter second; a capture verb on two presses that do not capture; a
backlog counting the call the rep was still recording; four legend colours
clearing 3:1 by a quarter of a point with nothing measuring them; and an arming
refusal that found the live call and then called it « une réunion ».

### The instruments moved more than the product

**`--census`, the tenth pass.** The standing finding named in three separate
rounds — no check reads a distribution, so a *family* is invisible to all nine
— now has an instrument. On its first run it found a hover glyph orphaned onto
its own line, doubling a followable line's box at 960 while `--targets`,
`--geometry` and `--prose` all passed it; and the widget's row controls
stretching so the glyph tracked how long the client spoke.

**`--contrast` was measuring one element in twelve.** `groundOf` tested
`background-image` before `background-color`, and the app root carries both, so
**290 text runs were skipped, every one blocked by the declared `--grain`** —
85–94% of the text on the first screen a rep ever sees, under a green line
reading « texte AA ».

**The screen list documented 60 of 83 stages**, with zero stale rows: it never
went wrong, it stopped being extended. The 23 missing were the most recently
added, i.e. exactly the screens covering what the last few rounds found.

**Three checks were narrower than their own prose** — the refusal scan reading
four files of which two hold no refusal, the backlog wait swallowing its own
failure, and the preload-strip bound testing `\s` where the bridge applies
`\s*`.

### What this cost, stated rather than omitted

The integrator (me) was wrong five times, each from reasoning where measuring
was available: a false premise about `settled()` propagated into all four lane
briefs; two corroborated findings recorded and then withdrawn, both from the
three I had ranked highest; three successive wrong diagnoses of the census's
first failure, two of them sent to the owning lane as findings before anything
was measured — the check was right every time; and a suggested fix
(`box.height > lineHeight * 1.5`) that the lane measured and found would have
destroyed the census's own headline finding, because the widget's row controls
compute a 21.7px line-height.

Two tooling faults cost real work and are now in `CLAUDE.md`: the
`-m "$(cat <<EOF)"` commit form silently strips bodies, which happened to six
commits across three lanes, and **`git stash` is shared by every worktree** —
one lane's pop applied another's four files into the wrong tree and dropped
their entry, recovered only through `git fsck --unreachable`.

### Still open

`.pane-label`, the arming-refusal name and the harness stage list were closed
after the scores were taken, so they are not in the three totals above. Not
closed: the four-ground nesting and 40/56/28 hairlines on the gate and
historique (axis 4, the lowest axis on two surfaces); « 0 qui s'en vont » on the
main screens, where eleven evidence panels vanish in one frame; 45% of the
960×600 detection window spent on chrome; and the arming gesture itself, which
**has never been walked** — the bridge answers `agenda:arm` with `evt-${eventId}`
against a fixture whose meetings are all `m-*`, so pressing *Préparer* lands on
« réunion introuvable », and the stage that exists for it only counts buttons.


## Round 16: three reviewers, three surfaces, one verdict about the author

Widget flat, main −1, detection −1.5, and every reviewer said the same thing
unprompted: the surfaces did not decline, the instrument widened. Each also
found, independently, that **the guard shipped with the previous round's fix
passes the regression it was built to stop.**

| surface | the guard | what got past it |
|---|---|---|
| widget | `sweepHovers` | 7 of 14 controls — `group-hover:opacity-100` on the *parent* answers for the control |
| main | `review-sans-opportunite-valider` | the regex `/Valider malgré (\d+) champ/` never fires on the stage named after that string; it asserts `0 === 0`, twice |
| main | `measureRail` | censuses rows, then holds the read-only grammar to a floor of **one** |
| detection | the dwell | weakening `>= AD_HOC_DWELL_MS` to `> 0` leaves 1282/1282 green |
| detection | the origin bound | widening 20 → 60 min leaves 1282/1282 green |

The cause is one habit: **a check written at the moment of the fix, by the
person holding the numbers, encodes the fix rather than the property.** The
countermeasure that works, used for all three round-16 repairs, is to write the
check so it **fails on HEAD before the fix exists**. The origin-bound test did,
reproducing the finding verbatim. Every hollow check listed above passed on the
tree it was born on.

Second habit, same root: a number computed while choosing a value and written
down as a number observed. `ownClaims`' window was stated as eighty-five minutes
at four sites and is a hundred and ten — thirty before the anchor, eighty after.
The round-16 reviewer read the prose and quoted the wrong figure back as the
basis for its recommendation, which is how one wrong sentence becomes two.
Counted invariant thirteen → sixteen.

### Fixed in round 16

- **`9f83457`** — a client joining more than twenty minutes late lost their own
  named meeting to an anonymous row, and pressing the named row then produced
  `recording` + `armed`, which blocks every installer and is escapable only by
  stopping the recording. The bound was an analogy to `#over`, which reads
  `event.context.scheduledEnd` — a field `Meeting` does not have.
- **`dae6563`** — a failed *Pause*, the only privacy control on the widget, left
  the rep believing they were off the record: the whole receipt was one sentence
  in a 1×1 clipped `aria-live` paragraph. The fixture had `refuseMarks()` and no
  `refusePause()`, so no stage could reach it.
- **`f825eda`** — `Client` was a live textarea over a value no payload carries,
  at the gate that writes into a client's CRM, and the sentence beside *Valider*
  sent the rep to search a transcription the row says was never read.

### Open, priced, not fixed

- **`--contrast` demands 4.5:1 of text inside `.sr-only`** — found by adding an
  announcement and watching `widget-pause` fail at 1.08:1 on a sentence
  deliberately painted for nobody. Any stage that announces anything fails.
- **`ReviewEdits`' docblock** calls itself « exactly the set of values that reach
  an external system » while `accountName` reaches none. The field now has one
  legitimate writer (the chip); the contract sentence is still wrong.
- **The panel and the mention card have no motion at all** — four state changes,
  `useDeparture` has no caller under `src/widget/`. Re-priced worse than round 15
  stated: it is not a missing exit, it is a missing arrival *and* exit.
- **`round.mjs` renders 1 of 11 widget stages**, and `smoke.mjs` still does not
  pass `--scan`. Every widget round since round 4 was scored on a directory
  holding one widget picture.
- **The flagship stage `agenda-appel-imprevu` photographs a day the shipped
  `Agenda` refuses to produce** — four facts, all four inverted.
- **The calendar key pairs both filled marks with the wrong label**, at 1280×800
  as well as 960×600: Δ 8.00 px from its own line, 0.53 px from the neighbour's.
- **The mark `<input>` hides 1327 px of a 280-character note** (84 %), no mask,
  no counter. `--scrollers` cannot see it and `shot.mjs:3644` says why.

### Round 15's fade finding does not reproduce, and the fix would have been wrong

Round 15 said the log's fade spends 8 of its 12 px on padding. Painted pixels say
`padding-top` is part of a scroller's scrollable overflow, so past `scrollTop = 8`
it has scrolled away and the ramp is over ink from y=0. The premise holds across a
7 px sliver of a 188 px range. The symptom is real and is the *scroll clip* cutting
mid-line-box — and the remedy implied (lengthen the ramp past `FADE_PX = 12`) is
exactly what the `--fade` ceiling exists to refuse. Holding the tree still while
the reviewers ran is what stopped this being built.

## Round 17: the fix that produced the next finding, twice in one night

Widget +0.5, main −2, detection −1. Two of the three regressions were mine,
introduced hours earlier by round-16 repairs.

### What round 16's fixes cost

- **`9f83457`** widened the arm-site origin bound 20 → 60 min and fixed the late
  client. By the same line it made the **earlier** of two rep-placed meetings
  swallow the later one: a rep whose 14:00 no-showed joins their 14:30 call and
  the product arms 14:00, at 45 and 60 minutes too. `ownClaims` sorts
  earliest-first and the arm loop took the head. DEC-46 then navigates to the
  wrong client's screen carrying the day's one filled *Enregistrer*. The old
  bound broke gaps under 20 minutes; the fix tripled that window and put the
  canonical half-hour ESN slot inside it. Fixed in **`803e792`**.
- **`dae6563`** added `refusePause()` to the fixture and it was wrong on arrival:
  it refused the pause while `widget:state` went on answering « recording », so
  it staged a refusal beside a filled accent dot and a running clock — the
  pairing `refuseMarks()` was fixed for thirty lines above it. Nothing called the
  verb, which is why nobody noticed. Fixed in **`c899b45`**, with the stage.
- **`f825eda`** rewrote one hollow renderer test and missed its sibling. « an
  edited field is what gets sent » still typed into `Client` — a `readOnly`
  control — and asserted `review:confirm`'s payload. It held because
  `fireEvent.change` ignores `readOnly` in jsdom. Fixed in **`0d20b67`**.

### The worst defect any round has found, and it was not a regression

**One press of a live *Valider* consumed DEC-4's only gate and created nothing.**
On an untitled manual call with no Microsoft account — the DEC-28 demo
configuration — all three intents are `available: false`, the screen still drew a
live primary, and pressing it moved the meeting to `pushing` with `intentIds: []`.
`pushing` accepts only `pushSettled`, which routes to `done` only when
`allIntentsSettled`, which reads `intents.length > 0 && …` — false for ever on an
empty outbox. `confirm`, `extract` and `abort` all refused. The row read « Envoi
en cours… » for the life of the database about a POST that was never made, and
the compte-rendu became unreachable from the gate.

Deleting the `intents.length > 0` clause left 1285 node tests, 808 renderer
tests, twelve gates and 152 stagings green. The refusal went **before** the
dispatch instead, because that clause has a second job — stopping a `pushSettled`
that arrives before the intents are written from settling the meeting vacuously.
Fixed in **`f630dcd`**.

### The instrument lesson, sharpened

Round 16's rule was « write the check so it fails on HEAD ». Round 17 shows that
is necessary and not sufficient. Both boundary tests `9f83457` shipped *do* fail
on the defect they guard — re-verified by the reviewer — and both are
**one-meeting fixtures**. A rule whose whole subject is *which of several
claimants wins* cannot be exercised by a fixture with one claimant. So:

> **A check must be as wide as the rule's subject, not just sharp on the case
> that prompted it.**

Two mutations were invisible for that reason — reversing `ownClaims`' sort, and
reading `now` instead of `#heldSince`. The sort one is now a true no-op rather
than an untested one: both call sites choose explicitly (`max` by anchor at the
arm site, `Math.min` over all claimants in `#calendarOffersAt`) instead of taking
the head of a sorted list.

`widget-pause` was the fourth instance of the round-16 habit: it read
`[data-card]`.first(), which is the **pill**, whose height is invariant across
the press, and reported 0 px while the panel grew 42. Shown side by side on the
same regression — repointed says « la carte passe de 351 à 393 px », the old one
says green. Fixed in **`19eab13`**.

### Open, priced, not fixed

- **A refused *resume* cannot be shown.** `setPaused` answers what is true
  afterwards, so `false` means both « resumed » and « there is nothing to
  resume »; for `next === false` the two collapse and the renderer reports
  success. The sentence written for it is dead code.
- **A paused recording never ends by itself** — `EndOfMeetingWatch` is held with
  no ceiling, the installer stays refused, and the next call does not arm. The
  pill replaces its clock with a word in exactly that state.
- **The `libre` gate**: a 2-row rail that `RAIL_ROWS = 11` makes `measureRail`
  structurally unable to visit, carrying two sentences that are both false.
- **The sub-line reaches 178 characters over three lines** at both sizes; the
  comment above it says « It is one line now ».
- **`--contrast` demands 4.5:1 of `.sr-only` text** and invents a white ground
  under the widget's transparent halo. `--echo` and `--scrollers` both have the
  exemption it lacks.
- **The flagship detection stage photographs a day the shipped `Agenda` refuses**
  — and the fixture's own docblock states the correct driven result three lines
  above the branch that stages the opposite.
- **Two icon stroke weights ship** (1.75 in the shared chrome, 2 in the panes),
  and nothing checks stroke width or radius.
- **`smoke.mjs` still does not pass `--scan`**: 134 detector findings across the
  widget family alone are invisible to the only thing that runs every stage.

## Retired: the palette campaign, and the measurement that was right about the wrong thing

For three rounds the named next spend was « move `--brand-500` darker to buy
headroom, then spread the ground ladder so a fill can group ». The arithmetic
behind it is exact and round 15 reproduced every figure — `--brand-500` 3.005:1
on `--bg-subtle`, `--warn` 3.029, `--text-muted` 4.559, three tokens with five
thousandths of headroom between them and their floors.

**The conclusion drawn from it does not follow, and understated the bill by two
orders of magnitude.** The whole light ground ladder spans L\* 95.58 → 100.00 —
**4.42 units**. For a ground-on-ground step to clear the 3:1 WCAG 1.4.11 asks of
a mark identifying a control, the darker ground has to sit at `rgb(146,146,146)`,
**L\* 60.6**: a mid grey. There is no light palette in which a field rail's
ground is a mid grey. Freeing `--brand-500` does not unlock this. Nothing does,
because the premise — that a *ground* can identify a control — is wrong.

What replaces it: **stop asking the ground to identify the control and give the
control a mark.** `--text-muted` is 4.559:1 on `--bg-subtle` and 5.093:1 on
white; it clears 3:1 on every ground in the file today, with no token moving. A
leading rule on the editable edge of a field is one declaration, reads as a
marker rather than a box, keeps the ground grammar the rail just bought, and
works identically on the white document column where the ground trick cannot
work at all — which is also what collapses the screen's three field grammars
into one.

Recorded here rather than quietly dropped, because the campaign was named as
« the one thing » twice and is written into `4b7bdc8`'s commit message as a
constraint on a future commit. It is not a constraint. It is a dead end that
measured correctly all the way to the wrong door.

## Retracted: the « blocked on a decision » section was wrong

**The block did not survive one grep, and the round-8 reviewer found it in
minutes.** The section below claimed « there is no default meeting length
anywhere in the codebase to borrow ». There is: `AD_HOC_NOMINAL_MS = 60 * 60_000`
in `core/domain/adHoc.ts`, and its docblock is *verbatim the argument the section
said still had to be made* — « `scheduledEnd` **bounds** the session …; it is not
a claim about when the call will end, and for an unscheduled call there is
nothing to claim. An hour is the bound that behaves like the ordinary case. »
`adHocContext` names `main.ts`'s `manualContext` as its mirror, one file away. A
rep-placed meeting and a detected call are the same object: no invite, no stated
end. The product decided this, wrote the constant, wrote the reasoning, shipped
it — and I wrote a section saying the question was open.

The other two premises were no better. `manualContext` already synthesised a
`scheduledEnd`, and it was `meeting.endedAt ?? meeting.updatedAt`, which on a
meeting that has not ended resolves to *now* — a context claiming the call is
already over, which is a bug that was hiding inside the same gap. And « `#arm` is
written around `CalendarEvent` » is effort, not a decision: `#armAdHoc` arms a
non-`CalendarEvent` meeting today.

Both stated candidate answers were also wrong. `CALENDAR_CLAIM_MS` (30 min) is
the *worse* one, because a claim shorter than the call reopens the duplicate at
minute 31; and the form field relitigates DEC-31.

Kept below rather than deleted, because « prose in this repo has been wrong about
the code » is a counted invariant and this is an instance of it that cost a
round — written by the person who also wrote the rule.

## What the section said (wrong, kept for the record)

Round 7's detection « one thing » is not fixed, and the reason is worth writing
down rather than leaving as a silent gap.

**A meeting the rep creates in this app never arms, and the detector then offers
a second, anonymous one for the same conversation.** `#calendarOffersAt` and
`#spent` both iterate `this.#window.events` — Graph only — so on the no-Entra
build (DEC-28's first deliverable, DEC-31's explicit case) a meeting placed on
the app's own calendar claims nothing. Driven on the shipped class: the rep's
14:30 stays `idle`, « Appel non planifié — Teams » arms instead, and the day
holds two rows for one call, the anonymous one wearing the only filled
*Enregistrer*. Pressing it records into a meeting with no client, no subject and
no `scheduledStart`, losing the account resolution, the VSA link and the Outlook
draft's recipients.

It is blocked because **the product has never decided how long a rep-placed
meeting claims the microphone.** `meeting:create` takes `scheduledStart` and
deliberately no duration — « the rep is walking into a call, and a required field
there is a form between them and the one thing the product must not miss » — and
`Meeting` has no `scheduledEnd`. A claim window needs an end, and there is no
default meeting length anywhere in the codebase to borrow.

Half the fix makes the product worse, which is why no half shipped. Deferring the
detector to a meeting the agenda cannot arm leaves the rep with **no** offer
instead of a duplicate one. Arming it needs `#arm`, which is written around
`CalendarEvent`, to become event-agnostic. Both halves need the same missing
number.

The two candidate answers, so the next round argues rather than rediscovers:
reuse `CALENDAR_CLAIM_MS` (30 min) as the cap, which invents no constant and
degrades to today's behaviour on a long call; or give `meeting:create` an
optional end and let the rep say, which is a form field the channel's docblock
argues against. The second is a DEC.

## Retracted twice, then shipped: `PageTurn` over the content it points at

**The « blocked by the arming guard » write-up was wrong, and the round-9 main
reviewer took it apart correctly.** It claimed docking « changes the viewport the
guard measures » and that « every fix that removes it » does the same. It named a
Playwright `for (let i = 0; i < 40; i++)` in the *driver* as « the one
measurement between a rep and an unread payload reaching a client's CRM ». It
said « re-applied and measured » about a run that measured the `review` stage
being clean and never quoted the one number that settles it.

That number is `review-garde-mort`, which presses until the gate arms and reports
the count. Measured both ways at the same commit: ***Valider* reached in 6
presses then 4, docked and not — byte-identical.** The guard was never touched.
Second time this session a « blocked » claim of mine did not survive the first
real measurement, after the first one was retracted for the same reason.

**What the dock actually cost**, now that it is known rather than asserted:

- `readToTheEnd` and `onboarding-suite` each hold their own copy of
  `column.locator('.turn-ground button')`, scoped *inside* the scroller. Docking
  moves the control to the scroller's sibling, so both found nothing —
  `session-remonter` reported « no page turn on an overflowing column » and
  `onboarding-suite` broke out of its loop without pressing anything. The
  property each asserts is unchanged; the locator encoded where the control
  lived. Widened to reach the sibling, still scoped to one column, which is the
  harness's own printed advice on a failing stage.
- The in-flow button was providing the clearance `.fade-below` needs under the
  last line, by accident. Docked, the final beat of onboarding step 3 stayed
  under the mask at 960×600. That clearance is a `data-unmeasured` spacer now, so
  `shippedHeight` subtracts it and the gate does not count a spacer as something
  the rep must read.

One more trap worth recording: a single `shot.mjs` run defaults to **1440×900**,
a size `smoke.mjs` never uses. `onboarding-suite` fails there with « rien sous la
ligne de flottaison » on a clean tree, because at 1440 the step genuinely fits —
which sent this investigation after a regression that did not exist. Reproduce a
smoke failure at a smoke size.

140 stagings, 1275 + 781 tests, `npm run check` green.

## Declined, with the measurement: the compte-rendu's « two grammars for one signal »

Round 11's main « one thing » asked to « give `**` and `_` the gutter that `#`
already has, and stop underlining the document at rest », on the grounds that the
inline markers sit « at body colour » and that the followable rule makes the
ranked list « read as a link list while the paragraphs above underline only their
quotes: two grammars for one signal ».

**Both premises are wrong, and the second is wrong in the shipped pixels.**
Sampled on `review@1280×800`, the densest single-colour row under each:

| rule | measured | token |
|---|---|---|
| a quotation, inside a paragraph | `rgb(98,112,123)` | `--text-muted` |
| a whole followable line, in *Éléments retenus* | `rgb(211,222,230)` | `--border-card` |

Two weights, not one — which is precisely what `CompteRenduDocument` says it does
and why: « Every bullet being followable is the opposite situation: six
consecutive rows … all ruled at that weight turned the section into a link farm
and made the document harder to read than the thing it is evidence for. So the
rest state is `--border-card`, which is the weight of a table rule … and hover
and focus bring it up to the same rule a quotation wears, because at that point
the rep has singled the line out. » The distinction the finding asks for is
built, argued over twenty lines, and measurable.

The first premise is wrong too: `parseInline` emits `**` and `_` as `marker`
runs and the renderer draws them `text-muted select-none`, not at body colour.

**And the gutter is not available to them.** The gutter works because `#`, `##`
and `-` are *line-initial* — they can hang outside the measure without moving the
text. `**` and `_` are mid-line by definition; there is no gutter for a marker
that sits between two words, and giving them one would mean either indenting the
prose or reordering the rep's own sentence.

What survives of the finding, and is not fixed: the inline markers are welded to
the word they mark with no optical separation, so `**Besoin**` reads as one token
rather than a word between two marks. That is a real, small typographic cost and
it is the only part of this worth spending on.

Recorded rather than silently ignored, per `CLAUDE.md`: « If you think one is
wrong, say so — don't silently build the other thing. »

### Round 18 — the round that scored the previous round's fixes, and found two of them wrong

Widget 50 → **48.5**, main 49.5 → **51.5**, detection 50.5 → **52**. The widget
regression is not a decline: `a133f78` is `662ad78` plus a rubric commit, so the
surface did not change. Round 17 scored `dae6563`'s refusal card as shipped;
round 18 drove **both** its directions and found one of them draws nothing at
all. The instrument widened, and the score followed it down. That is the third
time a surface has lost points for being measured better, and it is the only
kind of regression worth having.

**Two of round 17's own fixes were defects, and both were found the same way:
by running the new fixture in the direction it could not express.**

`803e792` replaced a `for`/`break` over a sorted list with « the greatest anchor
claiming now ». Its two-claimant test has the earlier meeting no-show and the rep
join the later one. Run it the other way — the rep joins the **earlier** slot and
stays on the call — and `now` advances under a call that does not, so at 14:25 the
offer walks to a client the rep is not talking to. A press there sends one
client's conversation into another's account through a `POST` with no idempotency
key and no delete verb. The row it abandoned is never withdrawn: `armed` survives
a relaunch, every installer is refused about a call that ended at 15:00, and
`#adHocSpent` latches, so a genuine unscheduled call five hours later got **zero**
offers. Causation was pinned, not asserted — reverting only the arm-site shape
makes both symptoms vanish. Fixed in `4d378ef`, with a second standing-offer
withdrawal in `497240f` after `["armed","recording"]` — verbatim the string this
file records round 24 as having closed — turned out to be reachable through
« Démarrer une réunion » while Teams held the microphone.

`c899b45` taught `refusePause()` to set `RECORDING_STOPPED`, and its fixture
answers `{ paused: !payload.paused }`. For a *Pause* that equals what `setPaused`
returns. For a *Reprendre* it is the **opposite** of it. So the one direction the
product could not draw a refusal in was the direction the harness staged a
refusal in perfectly. The commit's claim « the staged world is now reachable »
held for `paused: true` only. Fixed in `38d85be`, which also honours a pause
asked for during the device-open window — refused 8 samples out of 12 while
`widget:state` still answered a live meeting, drawing « La pause n'a pas pu être
prise. » beside « Enregistrement en cours » at 00:00:00. That is the round-4
defect verbatim, and the refusal's own remedy (`state.reload()`) re-read the
channel and got the recording back.

### The worst defect of round 18, and it was never a design one

`dispatch('start')` fires `#openDevices` as `void`. Three routes out of it
returned with the meeting in `recording` and no `Recording` behind it:
`capture.start()` called **0** times, segments 0, diagnostics 0, and
`health.capture` **ok** — so DEC-32's one general status stays green and the
bundle a support call reads shows a healthy app. The pill floats over the whole
call saying « Enregistrement en cours » with a running clock, capturing nothing,
for the life of the process. Then `recording` + `armed` refuses every later call
until a restart.

Route 1 is two presses away: the twenty-second dry run (DEC-45) is a wall clock
in the main process that nothing cancels, so `Escape` out of Réglages leaves it
running behind a live « Démarrer une réunion ». Fixed in `ad8dc24`.

Why it was invisible: `recording.test.ts`'s « a meeting will not start on top of
the dry run » calls `orchestrator.startRecording()` **directly**, and no
production code does — `#openDevices` is its only caller. The fixture asserted
the *method* rejects, which it does, and could not express the property it is
named after. **A test is not a caller** was already in `CLAUDE.md`; this is the
first time it cost the product its one unacceptable failure.

### The third instrument lesson: a check can be sharp, wide, and still aimed at one of three subjects

`e6c52aa` made the document's VerySwing claim conditional on the task intent.
Round 18 walked **all eight** tick sets and found **six go red on HEAD**: two more
sentences — the rail notice the product *sends the rep to* when nothing is
correctable, and the mail heading — were still constants. The subject was never
« does the document mention the task »; it was « which of three intents is
going », and every existing fixture ticked all three or unticked the opportunity
alone. Fixed in `ac29f75`.

DEC-4's only refusal had also never been drawn: `bridge-stub.mjs` answered
`ok: true` to every press, so 154 stagings never rendered the element, and
`--prose` measured it at **197 characters a line** the first time it saw it — the
widest prose in the product, on the sentence a rep reads immediately after
pressing the one irreversible control. Fixed in `7bd3a94`; the stub now applies
`register.ts`' own rule rather than a flag.

### What round 18 checked and found sound — do not re-measure

- **The `fireEvent.change`-into-`readOnly` sweep is clean.** Every `change`/`input`
  event in all 31 renderer suites was instrumented with a capture listener
  recording a `readOnly`/`disabled` target: **zero hits across 809 tests**. The
  instrument was falsified by making `taskName` inert, which produced a hit and a
  failure. `f825eda`/`0d20b67` hold; there is no third sibling.
- **Reversing `ownClaims`' sort moves nothing**, in either direction, including on
  tied anchors (`Array.sort` is stable and `listMeetings` fixes the order). The
  property holds — but the comment above it still claims the arm site takes the
  one whose slot the rep reached **first**, which is false of both consumers.
- **`calendarClaims`' sort is load-bearing and guarded** — reversing it turns two
  node tests red. The `break` that depends on it is instrumented.
- **`measureRail`'s census is exact in both directions** — a missing row reports
  « 1 manquant(s) », an extra one « 1 en trop », on both rail stages.
- **`f630dcd` cannot be spent by a second path**: `session:command`'s schema is
  `z.enum(['start','end','abort'])`, and exactly one `dispatch(…, 'confirm', …)`
  exists in the repo.
- **No dead control on the widget** — all 14 pressed, every press produced IPC and
  a screen change.

### Open, priced, not fixed

- **A paused recording never ends by itself**, re-priced **downward** with a
  control: 75 s of silence ends an unpaused meeting, a paused one is still
  `recording` at **+24 h**. But `armNow`'s refusal names the live call and
  « elle reste proposée » was verified to hold, so it is « blocked until the rep
  notices », not bricked. Not fixed deliberately: the only remedy is a ceiling,
  and this repo has never stated how long a legitimate pause may last. Choosing
  one while writing the fix is the round-16 habit; ending a paused call is
  irreversible, so a wrong ceiling loses the rest of a real call.
- **Unticking the Outlook draft costs up to 8 page turns** at 960×600 under
  « Il reste des champs à lire, plus haut. » — while the rail does not move a
  pixel (`scrollHeight` 1021 → 1021, one read-only row before and after).
  `viewOf`'s key is the whole checked set; its docblock argues the case for the
  **opportunity**, which is one tick of three. The honest fix makes the key
  payload-derived, which makes it move while the rep types — and
  `review-garde-frappe` exists because a keystroke taking *Valider* away is a
  failure this guard has already produced once.
- **The flagship detection stage still photographs a day the shipped `Agenda`
  refuses**, all four facts inverted, unchanged since round 16. The check that
  should hold it counts armed rows and never asks *which* meeting a real `Agenda`
  would arm — narrower than its subject, in this file's own sense.
- **No fixture anywhere puts `⚠ faible` on a deterministic row.** Consequence:
  mutating the count to `correctableFaible.length` — the regression the stage's
  own docblock argues against — leaves `review-sans-opportunite-valider` green,
  and `accountReason`'s sub-line branch is drawn by no stage at any size.
- **The widget has no departures at all** — « 0 qui s'en vont, 0 @keyframes de
  sortie » on 11 stages × 2 sizes. `useDeparture` exists and has no caller under
  `src/widget/`. The refusal card, the loudest state change on a surface drawn
  over another application, has neither arrival nor exit.
- **`--scan` is not in `smoke.mjs`**, re-priced with a reason: turning it on today
  floods every row-list stage with a known-benign occlusion class (12 of the 15
  findings on the agenda stage are the `after:absolute after:inset-0` row overlay,
  reported as « 100% covered » on text that is perfectly legible in the PNG).
  122 detector findings across the widget family alone are invisible to smoke.
- **Four radius families on one 340 px widget card** (1 / 10 / 14 / 9999 px), not
  three. The two icon stroke weights are a main-surface finding; the widget ships
  one.
- **`src/screens/Review.tsx` contains a literal U+0000**, which makes it **binary
  to `grep`** — so `grep -rn 'tiersCode\|oppyId\|salesStage' electron/ src/`, the
  containment check this repo states as a command, silently skips it. The `.mjs`
  gates read with `fs`, so `npm run check` is unaffected.
- **`--contrast` demands 4.5:1 of `.sr-only` text** and invents a white ground
  under a transparent halo. Unchanged. A second detector artefact of the same
  family was confirmed on `onboarding-essai-fait`, where the named element is
  entirely below the fold.

### Round 20 — the walk nobody was running, and a class name in front of every refusal

Main 51.5 → **58**, detection 52.5 → **54.5**, widget 54 → **53.5**. Five lanes,
split by file ownership rather than by surface, because four rounds of three
whole-surface reviewers had moved only axes 7 and 9 while axes 1–6 and 8 — 70 of
the 90 points — stood still.

† The widget lane's per-axis table re-labelled two axes and omitted « The whole »,
so it sums to 55 rather than the 53.5 it states. The total is carried because it
is consistent with the one movement the lane argued (motion 6.5 → 6, from a
baseline of 54); the per-axis row is not carried, because it cannot be
reconstructed. Recorded rather than quietly reconciled.

**`npm run test:e2e` had been red and unwatched.** It is the only thing that
exercises the real Electron main process, it is in **neither** `npm run check`
nor `run-tests.mjs`, and every round this session had reported « twelve gates
green, both suites green » over a third gate that was failing. It now plays
**38 of 38**.

My own framing of it was wrong in a way worth recording. I reported « 20 failures
at `ed4528a`, 7 at `f6ffdc7`, a strict subset — thirteen steps fixed ». The lane
could not reproduce either number and found why: `scripts/e2e.mjs` guarded one of
its three prerequisites, and the other two — the native module and 489 MB of
whisper weights — are gitignored build products that no gate creates. Fully
provisioned the count is 3; without the weights it is 20. So my figures measured
one tree's untracked state, not two commits, and the « thirteen steps fixed »
conclusion does not follow from them. Measure before trusting a sentence applies
to a coordinator's summary as much as to a comment.

### The worst defect of round 20, and it was in front of every sentence a rep reads

`electron/preload.ts` stripped `/^[A-Za-z]*Error:\s*/` from what Electron
composes. `core/contracts/refusal.ts` sets `this.name = 'Refusal'` on purpose,
and `Refusal` does not end in `Error`. So every one of the **34 `refuse()` sites**
in `register.ts` — every stated reason the product has, DEC-26's whole surface —
reached the rep as:

    Refusal: Aucune transcription n’a été enregistrée pour cet appel.

An English class name in front of the French, on a French product. `refusal.ts`'s
own docblock claims « Nothing about the renderer changes… the sentence is the
same sentence ».

Four instruments were green over it, each for a different reason: renderer tests
inject a fake bridge throwing a clean `Error`; the harness stubs `window.app`;
`preloadUnwrap.test.ts`'s fixture composes the wrapper with the literal word
`Error`, so **the one class the product defines could not be fed to it**, and its
« a subclass name is stripped too » case uses `TypeError`; and the e2e step
written for exactly this pressed the wrong control *and* asserted a pattern
`Refusal:` matches neither half of.

That step had been pressing the navigation rail for 105 commits —
`page.locator('li').first()`, written when `Historique` had no `Rail` in it and
broken the commit that added one. Green in both gates the whole time.

### Two fixes from the round before produced two of this round's findings

The panel exit added in round 19 was argued over four routes and driven on one.
`useDeparture` was fed the press while `meetingId !== null` was ANDed outside the
hold, so the chevron faded and **the meeting ending tore the panel off at opacity
1.000** — 340×205 over the client's face, on the route `EndOfMeetingWatch` takes
on nearly every call. The same animation also emits a `widget:resize` box built
from two layout passes (`pillTop` moving while `height` stands still), which
`placeWindow` correctly clamps and then inherits as if the rep had dragged the
pill — transient in, permanent out, **−162 px**.

And the fix for the first produced a third: holding the panel through the fade
made `widget-pause-refus` report eleven controls at **22 px** against the 24 px
floor. 22 is 24 × 0.92, the exit's own scale. Nothing was under-sized — `settled()`
asked `getAnimations()`, which answers for the compositor, while `useDeparture`
holds an element on a JS timer for one `--motion` after its exit finishes. A
class ending `-leaving` now counts as motion.

### What round 20 measured and refused to act on

- **Round 19's nominated one thing was founded on a 4× miscount.** « 80 spans at
  1 px radius that are 2 px tall and should be `rounded-full` » is **20** elements
  (80 was a count of *corners*), they measure 5.8 × 3.45–8.88 rather than 2 px
  tall, and `--widget-soft` **is** cashed in — `index.css` re-points three tokens
  to it inside `.widget-surface` and the panel's tray wears it. Acting on it would
  have made the meter worse. I relayed that recommendation into round 20's brief
  without checking it.
- **« the caution *Valider* reads olive-brown »** is a request to undo a measured
  decision: `--warn` was moved to hue 42° specifically to separate it from
  `--accent`'s 31° after two reviewers found three filled shapes colliding at
  1.48:1. Acting on it re-creates that finding.
- **« three radius families in one 400 px column »** does not reproduce — two, at
  10 px on 39 elements and 14 px on one.
- **`--motion` reporting « 0 qui s'en vont » on a still screen is not a defect.**
  Only three stages stage a departure; every other is a settled frame and
  `settled()` waits transitions out before measuring. Round 18 and 19 both read
  that zero as a product finding. It overstates it.

### Open, priced, not fixed

- **~~`pinnedNow.mjs` is not pinned, and its docblock says it is.~~ CLOSED, and this
  page did not notice for two rounds.** `PINNED_DAY` is 17 September 2026 at 14:35
  Europe/Paris, and the DST offset is resolved by *measuring* it rather than by
  knowing which side of the change the date falls on. 17 September and not another
  date precisely so every measurement recorded here through round 20 stays
  comparable. The finding below is the state it was found in; it returned
  *today's* date at 14:35 Paris under « so two runs of the same screen produce the
  same pixels ». Same commit, consecutive days: the `agenda` scan went « 15
  signalements, 4 types » to « 16, 5 », the extra being
  `extreme-negative-tracking` on « Vendredi 18 septembre », three characters
  longer than « Jeudi 17 septembre ». One detector count moved 26 scans on a
  weekday name. **Scores taken on different days are not comparable, which is a
  problem for a process whose whole instrument is comparison between rounds.**
- **The capture verb names two acts in identical rectangles.** Three pixel-identical
  89×32.6 « Enregistrer » on one screen: one filled, which only navigates, and two
  outlined, which create a meeting. Fill is the only carrier, and the stage and the
  component have to move together.
- **`aborted` draws nothing and says nothing.** The rep presses *Démarrer une
  réunion*, lands on the session screen, the recording dies for want of a
  transcription provider, and that screen offers no control and no sentence —
  the only place it is said is a status control back on the calendar. Reachable
  on the primary platform whenever WASAPI loopback fails to open. DEC-39 covers
  `ended`; `aborted` has no equivalent.
- **No instrument reads a distribution.** A fifth radius family on the largest
  object on the widget passes twelve gates, 164 stagings and 51 renderer tests.
  Every check reads one value against one rule; a *family* is invisible to all of
  them. Same shape as the ink-ramp gap round 19 closed and the wrapped-cell gap
  the agenda lane found.
- **The exit ladder's last painted frame is 0.235–0.599 opacity** on three hooks
  and four surfaces — the blink the family exists to remove, on the rung whose
  docblock says it was fixed. The remedy is `transitionend` with the timer as a
  ceiling.

## Round 22

**◊ — all three scorers were anchored, by the file they were told to read.** The
« score blind » instruction and the History table were sixty lines apart in one
file; a single read returned both. Three agents, three surfaces, one failure mode,
three unprompted disclosures. The history lives in this file now for that reason.
**Read the three totals as a differently-anchored re-reading, not as a decline.**
Every scorer said so independently: of the −9.5 across three surfaces, the part
they would defend as paint is **two regressions, both shipped by round 22 itself,
both the same shape** — a correct fix applied in one of the two directions its
subject has.

- **`CARD_SEAM` ran one direction.** `Widget.tsx:226` applies `mt-row` (16) on two
  cards that already receive and render `above`. Below the pill: 16 px. **Above the
  pill: 0.00 px** — the card's bottom border and the pill's top border touch, two
  14 px radii meeting at a tangent. On a real desktop the pill sits low, so `above`
  is the *common* case. One window now carries three values for one relationship
  (16 / 6 / 0). `--rhythm` stays green because 16 is on the ladder whichever side it
  lands on, `widget-refus`'s `pile:` assertion measures the two cards' **widths**
  and never the gap, and both stages the commit cites stage the *below* direction.
- **`measure` on the refusal span stranded its dismiss.** `Agenda.tsx:819`. Adding
  `.measure` to a `min-w-0 flex-1` span cut a 96-character line to 58 ch and capped
  the span at 439 px inside a flex row, leaving *Fermer* ending at x = 1080.4
  against a content edge of 1236 — **155.6 px, 23 % of the banner, empty**, at both
  sizes. Both properties are individually correct. Together they align the banner to
  nothing it contains.

Both are `CLAUDE.md` shape #2 — a check as narrow as the fix rather than as wide as
the rule's subject — committed by the round that wrote that rule down.
### Round 22: six refutations and five narrow instruments

Ten lanes. The round's defining shape is that **six lanes produced their best work
by refuting the brief I sent them**, and in four of those six the false premise was
a sentence in this repo's own prose.

- **The hairlines did not exist.** The brief said 40/56/28 strokes in three colours;
  the paint has 25, in two. The 58 was a pre-fix count quoted out of round 21's own
  docblock.
- **The rail was already right-sized** — 22.1 px of slack, already truncating.
- **The title bar is not winnable from the renderer.** `env(titlebar-area-height, 36px)`
  is wired to `main.ts:280`; the renderer cannot move it.
- **The fade ladder was shipped.** A paragraph saying the fix « is not in this commit »
  described code that had shipped it (`Review.tsx:3128`, `useDeparture` + `.leaving`),
  and I pushed that false premise into a lane's brief before a second lane measured it.
  « 0 qui s'en vont » is a sampling artefact `shot.mjs:2614` documents.
- **The ground ladder has nowhere to spread.** My three L* values were exact and my
  prescription was still wrong: `--bg-inner` is white — a wall — and the real floor is
  `--brand-500` at 3.005 against WCAG 1.4.11's 3:1. 0.348 L* of slack in total.
- **`Splash.tsx`'s grain never reaches a word** — σ 0.000 inside the card against
  σ 2.149 twenty pixels outside.

And three of my own prescriptions were refuted by measurement: the `--cells` rule I
wrote does not fire on the row it was written for (a 61.7 px button is smaller); there
is no shared `shown()` to audit — there are eight predicates across twelve passes; and
lane d refuted its *own* headline finding by building the alternative and letting a
gate refuse it (at 144 px pane width the search row holds one line, but `--targets`
reported 42 day cells at 13×36, 54 % of the WCAG floor).

### An instrument can be green and narrow

Five checks appeared to ask what a rep sees and asked something narrower. The
distinguishing property is not which helper a pass uses but whether its question is
**relational**: a pass asking something intrinsic about one element is unaffected by
an ancestor's scroll; a pass asking about the distance between two is corrupted by it.

- `--contrast` tested `background-image` before `background-color`, skipping 290 runs.
- `--contrast` again: it computed the darkest pixel under the grain, printed 4.458:1
  against a 4.5 floor across 138 runs, and **bound nothing**.
- `--census` claimed in its docblock to discover radius rungs by prefix and read a
  hand-written array of three.
- `--a11y` computes a heading-to-prose ratio and prints it on the *green* line.
- All eight visibility predicates ignored ancestor overflow. On `historique` at
  1280×800, **1 621 of 1 750** painted elements are outside their scroller.

A number that is computed, printed and binds nothing is not a check.

### Axis 3 had never been measured

`--rhythm` is the round's largest single instrument: three claims over painted
geometry, typed OM rather than `getComputedStyle` (which returns the *used* margin).
It opened at **156 of 170 stagings red** — 2 px painted 9 716 times, outnumbering
`--space-row` three to one — and closed at **0 of 170**, with 98.1 % of painted
spacing on the declared ladder.

Why 2 px was a defect and not a rung: every pressable chip painted at exactly
24.00 px, and only because `min-h-[24px]` dragged it up from a natural 23.05 — the
WCAG floor, reached with zero margin.

Of the last 21 red stagings, 19 were product defects and 3 were the pass measuring
distances nobody paints — and each of those three was probed before the pass was
changed rather than after:

- **Another plane.** The Réglages sheet is `position: fixed`; a heading inside it was
  being measured against the calendar header *behind* it. 9 of 15 claim-3 findings.
  Fixed by nearest `absolute`/`fixed` ancestor rather than a `[role="dialog"]` list,
  so `[role="menu"]` is covered and `sticky` stays in flow.
- **An unpainted edge.** A heading's own paragraph was correctly clipped by the new
  ancestor-overflow filter, so the search walked on to a sticky button *outside* the
  scroller.
- **`.meter-key` is an artefact.** It is `flex-col justify-between` with no gap at
  all; the 6 px is the meter's 28 px height less two 11 px words.

Each exemption reports its own coverage cost on every run — headings measured
377 → 356, nested pairs 283 → 278, the five removed being exactly the five
`.meter-key` sites. **An exemption that does not say what it stopped measuring is
the shape this round found five times.**

### Not closed

- Lane b's gate fix (grounds 4 → 3, minimum step 0.693 → 2.171) is still blocked by
  `RAIL_FLOOR = 2.5` in `shot.mjs`; the binding constraint is `--brand-500` at 3.005.
- `--a11y`'s heading-to-prose ratio is still unbound.
- The title bar's 36 px needs a Windows measurement nobody has taken.
- The day column shrinks as the window grows past `lg` — 544 px at 960, 512 at 1024.
- One unexplained smoke failure in seven runs, whose log was lost to a `tail`. Five
  consecutive green runs since. Recorded as a hole rather than rounded to zero.

### Closed, and the rubric did not notice

- **`pinnedNow.mjs` is pinned.** `RUBRIC.md` still lists « `pinnedNow.mjs` is not
  pinned, and its docblock says it is » under « Open, priced, not fixed ». It is
  pinned — `PINNED_DAY` is 17 September 2026 at 14:35 Europe/Paris, resolved across
  DST by measuring the offset rather than by knowing it, and the date was chosen as
  17 September precisely so every measurement recorded through round 20 stays
  comparable. The finding's own remedy shipped and the page recording it did not
  move. That is the thirty-third time prose in this tree has been wrong about the
  code, and the first time it was wrong by being *pessimistic* — every previous one
  claimed something was better than it was.

### The narrow instruments, now seven

Round 22 opened by finding five checks that were green and narrow. Scoring found
two more, and both hide a defect rather than a cosmetic gap:

- **No pass compares two marks to each other.** `rgb(5,148,218)` « réunion
  enregistrée » and `rgb(215,112,0)` « enregistrement en cours » measure
  **1.0077:1, ΔL\* 0.226** — a fifth of a just-noticeable lightness step — on 6×6 px
  dots printed adjacent in the calendar legend and side by side in the month grid.
  Both clear their *ground* handsomely (3.357 and 3.383), so `--contrast` prints
  « 14 graphique(s) à 3:1 » and goes green: it reads each `[data-graphic]` against
  `groundOf(el.parentElement)` (`shot.mjs:7678`) and never against its neighbour. A
  rep glancing at the month to answer « is anything recording right now » is reading
  hue alone. **This is the core question of the product, and twelve passes are
  structurally unable to ask it.**
- **`--census` counts stroked `<svg>` only.** Of the five marks on the widget it
  sees one. The disclosure triangle is a **5.67 × 12** Unicode character sitting
  beside 10–12 px filled glyphs — four glyph grammars on one 340 px card, under the
  check that exists to hold « one icon weight ».

And two more instruments print a number on their own *green* line: `--census`
reports the review gate's four control heights (24 / 24.38 / 26.59 / 27.05 — two
pairs under half a pixel apart) as green, and `--motion` prints « 0 qui s'en vont »
on all twelve base runs **and on all four `-sortie` stages**, where a per-stage
driver samples 11–12 painted frames ending at opacity 0.000. That blindness is what
caused round 21 to record the exit ladder as open a round *after* it shipped, and
then caused me to push that false premise into a round-22 lane brief.

**The rule that unifies all of it**: a pass asking something *intrinsic* about one
element is sound; a pass asking about a *relation* — between two marks, two
controls, two planes, an element and its scroller — is the one that goes quietly
narrow. `--targets`, `--cells` and `--census` all pass the session aside at 960×600,
where `Masquer` (BUTTON, 12 px, `rgb(93,107,118)`, no border, no fill, no underline)
sits at **x = 737** directly above `Profil` (SPAN, 11 px, `rgb(93,107,118)`) at
**x = 737**. One pixel of font-size separates the aside's only control from the
labels under it. Each check asks an intrinsic question; the defect is relational.

### Still the lowest axis, for the eighteenth round

`session-compte-rendu` at 960×600 — the minimum width `main.ts` declares — paints
**12.8 % of the compte-rendu** (307 px of 2 390), shows one heading of it, sets the
rep's own notes at **20.7 characters per line** (196 px ÷ 9.45 px/ch), and puts
**two « Lire la suite » buttons on screen at once**, 361 px apart. `--prose` has a
75-character ceiling and no floor, so nothing sees it. Density has been 6.5 since
round 19 and this is why.
