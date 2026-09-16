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
