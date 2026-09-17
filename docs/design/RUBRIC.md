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
