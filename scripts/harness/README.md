# Screenshot harness — Sillage renderer in a plain Chromium

Renders any screen of the app to a PNG, without Electron, without a real audio
device, without Graph, VerySwing or an LLM key — and runs a design detector
inside that same rendered page.

This harness is **not** the end-to-end run. It drives the real renderer against a
stubbed `window.app`, so it sees layout, geometry and the accessibility tree and
never sees the main process. `scripts/e2e.mjs` is the other half — it starts the
*packaged* application and walks 28 steps through the real bridge, the real store
and the real state machine, including the gate and the one press that writes to a
client's CRM. A defect lives in one or the other, rarely in both, and each was
introduced after something shipped that the other could not have caught.

```
node scripts/harness/shot.mjs <screen> <out.png> [--viewport WxH] [--expand|--no-expand] [--scan [out.json]] [--geometry] [--targets] [--prose] [--echo] [--a11y] [--contrast] [--marks] [--scrollers] [--motion] [--fade] [--census] [--rhythm] [--cells] [--press] [--no-png] [--sans-entra]
node scripts/harness/smoke.mjs                 # every stage × two sizes, with all twelve passes
node scripts/harness/serve.mjs                 # the same app at a URL, for tools that only take one
```

**The port is a default, and it was aimed at whatever owned it.** `shot.mjs`
reads `SILLAGE_URL`, falling back to `http://localhost:5180` — which is the port
the live checkout keeps a dev server on, while every round of this repo is
measured from a worktree. Measured both ways in the round that added the guard:
deleting `.measure` from the review gate's refusal in a worktree and running
`--prose` reported « aucune ligne au-delà de 75 caractères » at both sizes, and
the same command with `SILLAGE_URL` pointed at the worktree's own port reported
« 197 car./ligne — p.text-danger [hors .measure] ». The falsification step this
repo demands of every new instrument had quietly become a no-op.

Both scripts now refuse a server that is not serving the checkout they were
launched from — Vite answers `/@fs/<this repo>/package.json` with 200 from its own
root and 403 from any other, so it needs no version stamp and stays right when
the two trees hold identical source, which is when the confusion is invisible.
`smoke.mjs` stops at the first one rather than printing it a hundred and
fifty-six times.

    npm run dev -- --port 5182 --strictPort        # in *this* checkout
    SILLAGE_URL=http://localhost:5182 node scripts/harness/smoke.mjs

**Run `smoke.mjs` before and after a copy change.** A stage is a scripted path
through the real renderer and it is held together by the product's own French
strings, so renaming a button breaks stages silently — nothing runs them but a
person deciding to look at a screen. It has happened twice, and the second time
it broke six at once, including both of the features under review.

**Fourteen measured checks, and each exists because something shipped past a
screenshot.** The list is not prose — it is `PASSES` in `smoke.mjs`, and
`scripts/__tests__/harnessPasses.test.mjs` holds this line to it:

    --geometry --targets --prose --echo --a11y --contrast --marks --scrollers --motion --fade --census --rhythm --cells --press

This sentence said « six » for three rounds, then « nine » for one, while the
paragraph it sits in ended « All eight run on every stage » — three counts, none
of them right, each omitting the passes added most recently, which are the ones a
reviewer assumes unrun and re-runs by hand. It is a check now, and it is the
reason this line moved in the same commit as `--marks`.

`--geometry` (ten of twenty-three gutter markers clipped),
`--targets` (forty controls under WCAG 2.2's 24×24, none of them looking wrong in
the source), `--prose` (`66ch` rendering eighty-one characters for four rounds
because nothing counted), `--a11y` (a control whose only name is « ‹ »),
`--contrast`, computed from resolved styles with transitions switched off —
`getComputedStyle` returns the current *animated* value, which is how the bundled
detector reports a resting 14:1 button as 4.0:1 — `--motion` (every duration and
curve from a token, silent under `prefers-reduced-motion`, **and the slow end of the
motion at the end the element is actually going** — the one exit in the product wore
the *entering* curve for a round, an expo-out spending 73% of its change in the first
35 ms, which is a blink followed by 88 ms of a transparent always-on-top window over
the rep's call, and every curve in `:root` being an allowed curve is precisely why the
check could not see it — and note what it still cannot ask, which is why `widget-entree`
makes its own assertions rather than leaning on this: `--motion` reads *declarations*, so
it can say that the widget's arrival is on tokens and going the right way and never that
the window was sized off an untransformed box — **and it watches the stage being driven**,
because it is the one pass whose subject is a transient: `settled()` waits every `.leaving`
out before anything measures, correctly for geometry and wrongly for this, and it printed
« 0 qui s'en vont » on **83 of the 85 stages** including five of the seven that exist for
nothing else. That zero was read as a product finding in three separate rounds and became
a false premise in a fourth. A stage that stages a departure declares `departs: N` on its
own plan and the pass refuses it when the count is not met; a stage that stages none prints
what its watch looked at, so a zero cannot be mistaken for a verdict), `--fade`,
`--scrollers`, `--census`, `--rhythm`, `--cells`, `--marks` — the only one that compares two
elements rather than judging one — and `--press`, the only one that reads two *frames*,
below. All fourteen run on every
stage at 1280×800 *and* at 960×600 —
the size `main.ts` declares as the minimum, where a text field was crushed to
fourteen pixels while every check at the comfortable size passed.

**The fixture's clock is checked now, and this paragraph used to say it was not.** For
three rounds it described a family of small impossibilities — `startedAt` fifteen minutes
before its own `createdAt`, a transcript at 68 characters a minute, turns and marks dated in
the future — and told a reviewer not to trust density, durations or plausibility on these
stages. Every one of those was fixed by rounds 28 and 29, and the paragraph went on
disarming the next reviewer against judgements that had become sound: measured today,
`m-neovia-cadrage` has `startedAt` two minutes **after** `createdAt`, on its slot, with 313
turns and 26 292 characters over a 47-minute recording — 559 a minute against the 1 386 this
repo measured on a real call — and nothing anywhere dated past the pinned instant.
`modules/extract/__tests__/harnessFixture.test.ts` asserts all of it, on every meeting in
every scenario, on both halves of the Entra axis, and reverting any of the fixes costs
hundreds of named findings. **A README is prose, and `check:french` reads prose for
apostrophes, not for claims** — so the honest habit is to measure before trusting a sentence
here, this one included.

What is still worth knowing: `pinnedNow()` is 14:35, and `m-neovia-cadrage`'s slot **moves
with its state** — 14:30 when the call is live, so the pill is five minutes in, and 13:45
with a 47-minute recording when it has ended, so the gate is a real call rather than a
three-minute one. Every other meeting takes its transcript from `fillCall`, which tiles the
shared turns across that call's own window at `STEP_MS`, keeping the call's own cited turns
first so `spanOf` still locates and `MARKS` still pins. Consequently the records are large
on purpose — `m-lefort-cv` is 413 turns — and that is the point: a fixture shorter than the
output flatters every layout it appears in, which this file's own history records six
times.

**`--fade` measures the one thing a resolved colour cannot carry.** A fading mask
is how every log and every reading column in this product says « there is more
below », and the widget's transcript had its ramp at twenty pixels under a comment
reading « little enough that no whole line of a client's words is ever dimmed ».
The line box in that log is **19.5px** (`--type-ui` 12px × `leading-relaxed`
1.625), so the ramp was longer than a line: swept over every scroll position, a
whole line sat inside it with its ink at alpha 0.19. Neither of the two checks
that could plausibly have seen it can — `--contrast` reads resolved colours and a
mask is not one, and `--scrollers` is opted out of there by `data-scrolls`,
correctly, because a log is *supposed* to hold more than its box. This one
compares every **vertical** ramp against the tallest line box of the text it
fades over; a horizontal fade hides the ends of a row rather than a line and is
`--scrollers`' question, not this one — and that exemption is decided **per
layer**, because `linear-gradient(to right, …), linear-gradient(to bottom, …)` is
one declaration in which a vertical ramp can ride behind a horizontal one.

**It parses the value, and it prints what it visited.** The first version was a
regex that required the transparent stop to carry a pixel offset, and CSS lets the
first stop drop its `0` — so `.fade-below[data-above="true"]`, which every scrolled
reading column in the product wears, computed to
`linear-gradient(rgba(0, 0, 0, 0), rgb(0, 0, 0) 12px)` and was **skipped in
silence**, under a line reading « aucun ne couvre une ligne entière ». A 40px ramp
forced over the gate's own 25px line box passed, exit 0. It reads stops now —
implicit `0` and implicit `100%`, `Npx` and `calc(100% - Npx)`, `transparent` and
`rgba(…, 0)`, `black` and `currentColor`, the dropped default direction and a named
one, `mask-image` and its `-webkit-` twin, and **both** ramps of the four-stop
combined rule rather than the longer of the two. And it prints a census — masks
visited, vertical ramps measured, layers exempted for the other axis, ramps left in
percent — the way `--motion` prints how many elements it animated, because a check
that visited zero elements must not be able to print the same sentence as a check
that measured everything. A mask it cannot parse is a **finding**, not a skip:
that is where a too-long fade would hide.

`SILLAGE_FADE_ATTACK=1` stages one element per gradient form the product can
produce, at a ramp longer than the line box inside it, and is how anyone touching
the reader finds out whether they have re-opened either hole:

```
SILLAGE_FADE_ATTACK=1 node scripts/harness/shot.mjs review-valider /dev/null \
  --no-png --fade      # seven ramps, one unreadable mask, exit 11
```

**`--scrollers` finds what the harness itself was hiding.** It reports any box
inside the screen whose content is taller or wider than the box, and it exists
because the review gate's arming guard measures **two** columns and withholds
*Valider* until both have been shown — so a scroller *nested* in one of them is a
hole in that promise, and one no picture shows, because a clipped textarea looks
exactly like a short one. There were eleven: `FieldRow` sized its box from
`value.split('\n')`, a count of *newlines* where a rep reads *wrapped* lines,
under a `Math.min(6, …)` ceiling. A nine-line « Prochaines étapes » hid three
lines at 1280×800, armed; at 960×600 three fields hid text at once.

**Thirteen rounds of screenshots missed it, and the reason is in this file.**
`--expand` injects `textarea { field-sizing: content !important }` so a `fullPage`
shot shows the mail draft rather than scrolling past it — so every screenshot ever
taken of that gate showed the fields at their full height while the shipped
product cut them off. The check runs **before** the expansion, deliberately.
Truncation that draws its own ellipsis — a `line-clamp`, a `text-overflow` — is
exempt: the check is for content cut off with nothing on screen saying so. A box
that scrolls on purpose declares `data-scrolls`.

**`--geometry` measures what a picture hides.** Anything marked `data-hangs` —
the compte-rendu's gutter markers today — is compared against the padding edge
of the box that clips it, and the tightest clearance on the screen is printed.
Ten of twenty-three markers were clipped for three review rounds: every one of
them was in the accessibility tree, every one read correctly in `innerText`, and
a third of the `###` was simply not painted.

**`--rhythm` is the only instrument rubric axis 3 has ever had.** The axis reads
« One scale, visible at a glance. Tight groups, generous separation, more space
above a heading than below », and it has been the widget's lowest axis by a point
and a half while **no pass read a gap**: `--census` prints byte-identical output
on either side of a change that regroups a whole surface. This reads every painted
`gap`, `padding` and `margin` through the Typed OM — `getComputedStyle` answers
with the *used* margin, so the rail's `mt-auto` reads back as `511.03px`, a number
no author wrote — and asks the axis's three questions separately. The seven steps
are read out of `:root`, never restated, so a renamed token turns it red rather
than quietly shrinking what it checks.

Four rules decide what is not rhythm, and each is a rule and not a list: a
container whose children hold no text, no name and no behaviour is a **drawing**
(the meter's bars, 820 gaps); a value equal to what a bare tag of the same name
gets is the **baseline** (`th`/`td` at 1px, found by building a probe element in
the page rather than by being told); a value that is not a whole pixel came from
the **type** and not the ladder (60, all in `CompteRenduDocument`); and a
one-sided horizontal padding past the widest step is a **gutter**, which is
`--geometry`'s subject (80). `RHYTHM_ALLOWANCES` in `shot.mjs` carries what no
rule could recognise — two entries, both argued in the tree before this existed —
and `scripts/__tests__/rhythmAllowances.test.mjs` holds each of them to a live
site in `src/`, because « does this deviation still exist anywhere » is a question
about the tree and not about one screen.

Three more rules landed when the axis was closed, and each removes a measurement
no rep could have seen rather than a finding. A neighbour on another **plane** —
the nearest `absolute` or `fixed` ancestor — is not the space above a heading: the
Réglages sheet is `position: fixed`, so on `reglages@960` the h3 « Requis » inside
it was measured against the calendar `header` **behind** it, 7.7 px above against
12 below, and nine of the fifteen claim-3 findings were that one shape. An **edge
that is not painted** has no space beside it: on `onboarding@960` the h3 « Sillage
s’adapte à votre vocabulaire » straddles its scroller's bottom at y 458.81, so its
own paragraph 6 px under it was clipped away and « below » became 25.7 px to a
sticky button outside the scroller — the authored rhythm is 20/6 and correct; four
findings, including the mirror of it on `review-garde-tapis@960`. And free space a
container **distributes** is nobody's spacing: `.meter-key` is `flex-col
justify-between` with no gap, so the 6 px between « moi » and « client » is the
level meter's own height showing through, which is the drawing exemption one box
out; five stagings. Claim 2's outer measure was already immune to that by taking
`Math.min`, which is why only the inner one needed it.

Swept over all 85 stages at both sizes when it was introduced: **59 553 painted
spacings over 54 886 elements, 79.6 % on the ladder**, 254 nested group pairs, 484
headings, **156 of 170 stagings red over 63 distinct sites**, the off-ladder mass
one number — **2px, painted 9 716 times**, outnumbering `--space-row` at 16px
(3 483) three to one. The same sweep at the end of the round: **51 831 painted
spacings over 54 872 elements, 98.1 % on the ladder**, 278 nested pairs (5 with
their space distributed), **356 headings measured, 4 straddling an edge, 35 with
nothing on one side**, and **0 of 170 stagings red**. Those last three are printed
on every run beside `read`, because an exclusion that is not counted is a check
quietly measuring less.

What it cannot see, so nobody has to rediscover it: claim 2 compares a group
against what surrounds it, so a row with **no** groups in it is invisible to it.
The widget's pill before its fix was six flat children at one interval — nothing
nested, nothing to compare. Driven with `src/widget/Widget.tsx` put back, claim 2
stays silent and claim 1 turns red on `10px pad Left`, which is the same finding
the declaration-reading test made from the class list. The two are complementary.

**`--cells` finds a growing cell starved by its fixed siblings**, which every
other pass is blind to **by construction**. A search result at 960×600 rendered
the client's name in 40.3 px while four fixed-width siblings kept 382 of the row's
430; `line-clamp-2` then cut the word, so three results read « Sodex / comi… »,
« Group Maréc / quali… », « Banqu Delcou / prem… ». All ten passes were green over
it: a `-webkit-box` clamp overflows in the **block** direction, so
`scrollWidth === clientWidth` and `--scrollers` has nothing to measure, and
`--prose` counts characters a line rather than cells.

So this measures the width the cell's contents *want*, with a `Range` over the
contents rather than `scrollWidth` — verified on the defect itself, where the
Range reports 187.1 px inside an 88.3 px box. The rule is an arithmetic and not a
ranking: **the cell that grows is short of its own text while the cells that do
not grow are holding slack.** The proposed « the growing cell is the smallest cell
in the row » was measured against the same row and does **not** fire — the row is
`64 / 88.3↔ / 80 / 112 / 61.7` and a 61.7 px button is smaller than the starved
cell. The floor is one character of the cell's own resolved font, through a canvas
the way `--prose` measures its advance: with no floor the sweep reports one site
on `main`, 1.5 px short — a quarter of a character — against the defect's 98.8 px,
sixteen characters, and nothing in 5 070 growing cells sits between them. A cell
that can scroll is exempt, that being `--scrollers`' subject; an ellipsis is
**reported and not required**, because on the row this exists for the starved cell
itself resolves to `text-overflow: clip`, with the ellipsis on one child and the
clamp on another.

**The second claim is the same arithmetic run the other way: a closed box wider
than anything in it can take.** Found on the agenda's arming refusal — a box of
672 px at 1280×800 whose sentence was capped at 439.078 px by `.measure` and whose
only control, *Fermer*, ended at 1080.4 with the box's own stroke at 1235: **154.6
px, 23 % of the banner, past everything in it**. `flex-1` says take the rest and
`max-width` says never exceed this; one of the two declarations is dead and the
remainder goes nowhere. The rule is **every growing cell pinned at a length cap,
*and* more than one character of the row's own font still free** — both halves, as
in claim 1, because a row with free space and a cell that could still grow is a row
mid-layout. Swept over all 85 stages at both sizes, the arithmetic alone finds four
distinct rows, all `.measure` + `flex-1`: this banner (154.6 px), `session-attente`
(635.2 px, 49.6 %), *Historique*'s match rows (429.8 px, 45.1 %, ×85) and the
transcript reader's header (60 px). Only the first is **closed** — a 1 px stroke on
both inline sides and a 10 px corner; the other three have `border-left-width: 0px`,
`border-right-width: 0px` and `border-radius: 0px`, so they are bands and list rows
that end where the pane ends and have no edge of their own for the emptiness to sit
inside. Those three are a real question about reading width on three other lanes'
screens and are recorded in the round report rather than excused here, because
`RHYTHM_ALLOWANCES` is right that « nobody has changed it yet » is not a reason.

**`--marks` compares two marks to each other, which none of the other twelve can.**
Every pass in `shot.mjs` asks something *intrinsic* about one element — this ink
against that ground, this box against 24×24, this gap against the ladder — so a
code made of several marks was measured one mark at a time and never as a code.
The calendar's « réunion enregistrée » `rgb(5,148,218)` and « enregistrement en
cours » `rgb(215,112,0)` each clear their own ground at 3.24–3.26:1 and measure
**1.0077:1, ΔL\* 0.226** against *each other*, on 6 px dots one above the other in
the same legend: in greyscale, and for a blue-orange deficiency, the month said
nothing about whether anything was recording.

It reads every painted `[data-graphic]` on one screen, takes its ink the way
`--contrast` does (fill, then a `ring-*` box-shadow, then a border on any side)
and rasterises its silhouette from the box, the four corner radii and the band
that draws it. A pair of differently-named marks passes on **either** channel
that survives greyscale: ΔL\* ≥ 10, or a form distance ≥ 0.30, where the form
distance is the share of the two centred silhouettes' union that only one of them
paints. Two marks painted *identically* are one mark with two names — the
onboarding draws two completed steps that way on purpose — and they are counted
as « jumelles » rather than failed on; the subject is a pair somebody meant to be
different. A second rule holds one name to one ink, which is the `#ff8500`
against `#d77000` defect `tokens.css` records.

Both floors are judgements between two measured anchors and not numbers off a
standard, and the docblock says so: 1.4.11 has no figure for two marks against
each other, and 3:1 between them is unreachable for a palette whose oranges and
blues are both pinned to clearing 3:1 on the same near-white grounds. The anchors
are the product's own — `brand-500` against `brand-700` on the onboarding's step
dots (ΔL\* 17.49, reads correctly), fill-against-hollow on a 6 px dot (0.4447,
the axis `MARK_CLASS` and `Widget.tsx` both spend), and a 6 px square against a
6 px dot (0.2186, corners and nothing else, refused).

**What it does not reach**, stated rather than implied: a code spread across
*states* — the widget's idle, paused and recording glyphs are three stages and
never two elements at once, so it prints « aucune paire à comparer » on all
fifteen widget stages — and two marks on two *screens*. Swept over the whole
list: **39 of the 85 stages draw no declared mark at all, 14 draw exactly one,
and 32 compare a pair** — which is why the census line names how many marks were
painted and how many pairs were compared. A screen with one mark must not be
able to print what the agenda's six pairs print.
`SILLAGE_MARKS_ATTACK=1` injects nine probes, three that must be reported and six
that must stay silent, and exits 21.

**`--press` asks the only question in this file that needs two frames.** Every
other pass measures one settled frame, and all thirteen of them were green over
this: at both sizes, pressing *Préparer* on the agenda beside a live recording
inserted the arming refusal above the day list, the list fell **71.2 px**, and
the rectangle that arrived under a pointer that had not moved was *Ouvrir* on
the **live call** — `:hover` already true, fill stepped to `brand-900`, hit area
the whole 1050 px row. Twelve of 69 controls moved. `--geometry` reads both
rested states and both are impeccable; `--motion` reads declarations and printed
« mesure vide » on that stage; `--cells` measures width.

It installs a capture-phase watch on `pointerdown` **before** the app loads,
snapshots every control's rectangle with the pointer's position, waits for a
resting frame, and asks whether the control under the pointer is still the one
the rep aimed at. Four verdicts, and three are exemptions that say what they
stopped measuring: `remplacé` (the pressed control has left the document — a
navigation promises nothing under the pointer), `recouvert` (no resting frame,
because a second press began first or the layout never settled), `libéré` (the
control moved and nothing took its place — a press cannot misfire onto prose),
and `tenu`, the green one. Only « another control now occupies the rectangle »
fails.

**What it does not reach, stated.** A press with no pointer — `Ctrl/⌘ Entrée`, a
`Tab` then `Enter` — has no coordinates and is not watched at all; and a press no
stage drives is a press nobody measures. Swept over the whole list, that is
**665 pointer presses across 176 stagings**, printed stage by stage so a zero
reads as a zero. « Rested » is three agreeing samples with nothing running, and
that is not fussiness: with two, `review-garde-sources` reported the gate's
document displaced 137 px on 1 parallel run in 4 and 0 px on every serial one —
the provenance panel pushes the column and the scroll puts it back inside the
same press. The tolerance that had already been written for it was deleted
instead. `PRESS_TOLERATED` in `shot.mjs` holds what is left (one entry: the month
grid re-paging under `agenda-empty`, 180 px, at both sizes) and cannot rot — an
entry whose finding stops reproducing fails the pass until it is removed, and it
grants nothing at a size it was not measured at. `SILLAGE_PRESS_ATTACK=1` injects
four probes, two that must be reported and two that must stay silent, and exits 21.

**Two instruments were answering a narrower question than they appeared to, and
both are fixed here.** `--census` read its radius ladder from a hand-written
`['--radius-sm', '--radius', '--radius-lg']` under a docblock saying it read
`:root` by prefix, and its guard was `< 3` — so `--radius` (12px, worn by **0 of
40 388** corners over 170 stagings, which `--census` itself printed every run)
could not be deleted from `tokens.css` without failing every stage at exit 15.
The instrument that proved the token dead was the reason it was unremovable. It
discovers `--radius*` now and refuses only an *empty* ladder. Driven both ways:
deleting the unworn rung leaves the census green on 2 rungs; deleting a rung
classes still wear does **not** turn it red and cannot — `rounded-sm` resolves
`var(--radius-sm)`, and a `var()` with no token is an invalid declaration the
browser drops, so the corner is simply not painted (40 rounded boxes → 1, exit
0). `src/design/tokens.test.ts` is the instrument that catches that, and it does
(2 tests red).

**And the other two thirds of `--census` were still printing rather than
asking.** Its control-height line was a list on the *pass* line — `review` printed
`24×15 26.59×9 24.38×9 27.05×5 32.59×3 13×3 28.59×1` at both sizes — and the only
rule under it needed *one component* drawn at two heights, so four heights across
four components shipped green with two of the pairs less than half a pixel apart.
Its mark line counted stroked `<svg>` and nothing else, so it said « 1 icône(s) à
stroke-width 2 » over a widget card carrying five marks and « aucune icône » over
the pill, where two were painting.

Both bind now. **Heights**: no two authored heights on one screen may be under a
pixel apart, the pixel read off the distribution rather than chosen — 622 adjacent
gaps over 168 stagings, 113 at or under 0.90 and 509 at or over 1.41, nothing
between. Two exemptions, each *counted in the printed line* rather than skipped: a
height the line box dictated (no padding, no border, box equal to `line-height` —
the compte-rendu's nine 24.38px followable lines and citations, which sit 0.38px
from the chrome's 24px and are not reported), and a box caught mid-transform
(`widget-carte-sortie` measures its three 24px buttons at 23.55 under `scale:
0.980745`). **Marks**: all three grammars are counted — stroked `<svg>`, filled
`<svg>`, and Unicode characters — and the one rule that fits a character is that a
font the app ships has to carry it. Coverage is measured, not asked:
`document.fonts.check()` answers from a declaration's `unicode-range` and says
`true` for a range-less `@font-face`, so the glyph is drawn twice on a canvas —
once in the shipped family, once in a family that does not exist — and identical
ink means the fallback drew both. Unicode decides what is a mark: `\p{S}` is,
punctuation is not, which is why `« » ‹ › · — …` and the compte-rendu's own `# ##
- ** _` are outside the rule and — measured — carried anyway.

Swept before the fix, with the final instrument: **109 of 170 stagings red**, 84
on a mark the product does not ship the glyph for (`▾ ▴ ▸ ✕`, none of them in
Inter 4.1) and 61 on a height cluster (the chip family's 27.05 against a segmented
option's 26.59 on 27 screens; the session header's 31.69 objet field against the
32.59 button beside it on 11). The old pass was green on all 170. Every one was
fixed in the product — the four marks are drawn now, the chips are set at
`--type-ui`, the header fields carry the button's padding — and the sweep is 0 of
170.

`--contrast` had the same shape twice over: it composited the grain at a
hard-coded `9 / 255` — so the remedy `index.css` names in its own words, « a
quieter tile », would not have moved the number by a thousandth — and it printed
the result on the **green** line. It decodes the tile now (shipped grain: 64×64,
four levels 0/3/6/9, mean 4.47) and fails on it. The judgement call was settled
by measuring rather than by arguing about textures: swept for the darkest window
of each shape on the torus the repeat makes, `1×1`, `1×2` and `1×4` are all at
9.000, `1×6` 8.500, `1×8` 7.875, `2×8` 7.313, `8×8` 5.813. **A 1×4 run of the
darkest level exists**, one CSS pixel wide and four tall, and a 12px Inter stem
is about 1.2px wide — so a quarter of a lowercase letter can sit entirely on the
darkest level. The minimum is reachable, not theoretical, so it is the statistic;
the `1×8` mean would pass the shipped palette at 4.52:1, which is an answer about
a letter nobody reads one stem of. Falsified both ways: `--text-muted` at
`#5e6b76` → green, a tile rewritten at alpha 4 → « noir 4/255 » and green, the
shipped pair → **138 passages across 18 stagings, 4.83:1 declared against 4.46:1
under the grain, floor 4.5**.

**What is on the screen, and what is only in the tree — the audit every pass
needed.** No pass had ever asked whether an ancestor's `overflow` had scrolled an
element out of view: `display`, `visibility` and `clip` are the element's *own*
properties, and a box at y −596 inside a pane whose visible band starts at 196.9
has all three in perfect order. Measured over all 170 stagings, the share of each
pass's population that is clipped away by an ancestor:

| population | measured | off screen | pass(es) reading it | does it change the verdict |
|---|---|---|---|---|
| `[data-hangs]` markers | 1 116 | **89.9 %** | `--geometry` | no — a marker's overhang is against the box that clips it, and that is the same when scrolled in |
| prose surfaces | 4 870 | 85.6 % | `--prose` | no — characters a line is intrinsic to the element at its width |
| text runs | 26 522 | 67.2 % | `--contrast`, `--echo` | no for `--contrast` (a colour ratio does not move); **in principle yes for `--echo`**, whose question is « does *this screen* draw the string twice » — no live finding depends on it |
| flex rows | 6 599 | 66.4 % | `--cells` | no — a row is clipped whole, so the starved cell and its siblings move together |
| every painted element | 54 808 | 53.5 % | `--rhythm` | claims 1 and 2 no (both answered inside one container); **claim 3 yes, fixed here** |
| rounded corners | 10 073 | 47.0 % | `--census` | **in principle yes** — « au plus deux échelons sur un même écran » is a claim about a screen and its population is the DOM. Today that makes it stricter than its wording, which is the safe direction, and nothing it reports depends on it |
| controls | 6 434 | 30.6 % | `--targets`, `--census` heights | no for 24×24 (intrinsic); same note as above for the two-heights rule |
| headings | 527 | 25.2 % | `--a11y`, `--rhythm` claim 3 | no for the ladder (a size is a size); **yes for claim 3** |
| icons | 513 | 13.1 % | `--census` strokes | no — a stroke width is intrinsic |

`--scrollers`, `--fades` and `--motion` are not in the table because their
populations were not swept: all three read a property of one element against
itself — content against its own box, a mask against its own line box, a
declaration against `:root` — so a clipped element answers the same question the
same way. That is reasoning, not measurement, and it is marked as such.

The one that was wrong is `--rhythm`'s claim 3, and it was wrong by a lot: it
picks the nearest painted box above and below a heading, and **15 of its 42
violations across the sweep were measured against a box outside its scroller**.
The gate's h1 reported `-0.47 above` against a `circle` at y 32.47–48.47 inside
`main.fade-below…`; *Historique*'s h1 `0.22 above` against a `span.min-w-0` at
y 19.50–59.78 inside `main…overflow-y-auto`. Corrected, they are **12 px** and
**32 px** — the header padding a rep actually sees — and the claim goes from 42
violations to 27. `historique@960` had flipped red only because a 4 px move put
the h1 beside a *different* clipped row, so the verdict was a function of scroll
position.

**`--no-expand` is the flag a design pass wants.** Three screens ask for
`expand` in their own plan because what matters on them sits below an inner
fold — but the same unclipping deletes whatever is *pinned* to the bottom of a
column, and the review gate now pins its decision there. A shot of `review`
without this flag photographs a screen no rep has ever seen: the whole panel at
once, with the one button somewhere in the middle of it. Use `--no-expand` on
`review`, `historique` and `reglages` whenever the question is « what does the
rep get », and shoot at **1280×800** as well as 1440×900 — the reps this ships
to are on Windows laptops (HR-2).

## The two entry points

**`shot.mjs`** drives the screen the way a rep reaches it and shoots it. With
`--scan` it also evaluates impeccable's `detect-antipatterns-browser.js` in the
page and writes the findings as JSON beside the PNG. The scan runs *before*
`--expand`, on the layout the window really draws — unclipping the scrollers is
a lie told to the camera, and told to the detector it would erase every finding
about content below a fold.

**`serve.mjs`** proxies Vite on a second port with the bridge injected and the
CSP meta dropped, so anything that can only be handed an address works:

```
node scripts/harness/serve.mjs &
node ~/.claude/skills/impeccable/scripts/detect.mjs "http://localhost:5181/?scenario=agenda" --viewport 1440x900
```

Pointed at Vite directly (`:5180`) that command scans a spinner and reports
nothing, because `window.app` is missing and every screen renders its error
state. That is why every browser-mode design pass this repo has run came back
empty — not because the screens were clean. `?scenario=` picks the dataset,
`?freeze=0` unpins the clock. Only the entry screens are reachable that way;
anything behind a click needs `shot.mjs`.

## Two screens that only exist as a gesture

`review-transcription` and `review-transcription-introuvable` are the same
screen reached the way a rep reaches it: open a field's `source ▸`, then press
« Voir dans la transcription › ». There is no URL for that state and there
should not be one — it is a gesture on one column answered by the other. The
first stages a citation the extraction verified (found, highlighted, scrolled
to); the second stages the one it could not, where the reader says so instead of
opening silently at 0:00.

## Why it works

The renderer reaches the main process through exactly one object: `window.app`,
put there by `electron/app/preload.ts`. In a browser that object does not exist,
so every screen renders a spinner or an error.

`bridge-stub.mjs` exports one self-contained function that installs the same
two-method shape (`invoke` / `on`), and `shot.mjs` injects it with
`page.addInitScript` — which runs **before** `main.tsx`, so the first
`useInvoke('boot:state')` already has an answer. Nothing in `src/` is patched or
mocked; the app is the app.

Payload shapes are lifted from the renderer's own vitest fixtures
(`src/screens/__tests__/*.test.tsx`), which are typed against
`electron/core/contracts/`. If a channel is renamed there, those tests break
first and this stub is the second thing to fix.

## Requirements

The Vite dev server on **port 5180**:

```
cd <repo root>
npm run dev -- --port 5180 --strictPort
```

Override with `SILLAGE_URL=http://localhost:1234 node shot.mjs …`.

Playwright is resolved out of the repo's own `node_modules` (v1.60), so the
harness can live outside the repo and still run from anywhere.

`--scan` reads the detector from
`~/.claude/skills/impeccable/scripts/detector/detect-antipatterns-browser.js`;
`IMPECCABLE_DETECTOR` overrides the path. The skill's *own* `detect <url>` mode
additionally needs `puppeteer` somewhere Node can resolve it from the skill
directory — `npm install puppeteer --prefix ~/.claude` puts it in
`~/.claude/node_modules`, which survives `npx impeccable update`. Without it
that command exits with "puppeteer is required for URL scanning", which is the
second reason browser-mode passes came back empty.

`page.evaluate` reaches the page over CDP rather than through a `<script>`
element, so `index.html`'s `script-src 'self'` does not apply to `--scan`. It
does apply to anything that injects an overlay by appending a tag — that is
what `serve.mjs` drops the meta for.

## Screens

| screen | what it stages |
|---|---|
| `splash` | screen 0 (DEC-30): base locale ready (« ouverte · sur cette machine », the phrase `main.ts` really publishes), audio still pending, the first-run model download at 42 % with its size and its remaining time under the bar |
| `agenda` | *Calendrier* on a full day — month grid with marks, two calls ahead, one **Prêt** (armed, HR-7), two under *Passées*, the search bar with client chips, `Tout fonctionne` in the header |
| `agenda-hors-fenetre` | a month the calendar was **never asked about** — the sync window is eight days and the grid draws six weeks, so *Mois* asserted « Aucune réunion ce jour-là. » about thirty-four of forty-two days, explained by the *arming* reason (« Teams émet du son » accounting for an empty Thursday three weeks out) |
| `agenda-empty` | DEC-31's own case: a day with nothing on it, grid and search bar still drawn. The day is found by its accessible name, not by date, so the shot does not expire |
| `agenda-semaine` | the same day in the **Semaine** view |
| `agenda-liste` | the same day in the **Liste** view |
| `agenda-client` | one client chip pressed — the filter path rather than the typed-query path |
| `agenda-search-client` | a call found **by its own name** — the thing a rep types first and the thing the product could not do: its « four searchable surfaces » were three, all of them *contents* of a call, so the client name offered as a chip one row above the box matched nothing unless somebody had said it aloud |
| `agenda-search` | the same screen with `TJM` typed: the day list gives way to *Résultats*, each row carrying the matched excerpt and its push summary |
| `session` | *En réunion* — the rep's own ProseMirror notes filling the frame, the seven-slot signal rail on the right, and the two-channel level meter in the recording pill fed a speech-shaped history over `audio:level` — the rep above the baseline, the far end below, both with bars under the transcription floor — `00:22:00` on the clock |
| `session-attente` | the same meeting **ended with no model configured** (DEC-39) — the notice that used to be a blank screen, stating that the transcript and the notes are safe and that the compte-rendu follows as soon as a model exists, beside *Choisir un modèle* |
| `session-compte-rendu` | the same meeting **after the analysis**. Above 1 184px (`SIDE_BY_SIDE_PX`) three columns: the rep's own notes, still editable and still theirs (DEC-5), the compte-rendu, and the slate, all drawn at once with nothing pressed. Below it **two** — the document and the slate, the notes one press away — because three reading columns do not fit in the 960px window `main.ts` declares. *Relire et valider* is still the only door to the gate (DEC-4) |
| `review` | the gate (DEC-4): the compte-rendu typeset with its markers in the gutter and the Outlook draft under it at the reading measure, eleven fields each stating what verified it, and the three intents pinned above one *Valider*. Shoot it `--no-expand` |
| `review-transcription` | the same gate with a **verified** citation followed into the record: the cited turn highlighted and scrolled to, headed « Citation du champ « Besoin », à 3:58. », with the field still on screen beside it |
| `review-transcription-introuvable` | the other verdict — the one field the extraction could not verify. The reader says the quote is not in the transcript instead of opening silently at 0:00 |
| `historique` | the reader (DEC-25): seven calls with per-intent push status, one row expanded into transcript · notes · compte-rendu · extraction · envois |
| `reglages` | *Connecteurs*, opened where the header control lands: **Requis** with one *à vérifier*, **Facultatifs** with VerySwing down and Outlook to check, two *Réessayer*, and the VSA tenant probe |
| `agenda-sans-entra` | the same calendar with **no Entra app registration** — see below |
| `agenda-appel-imprevu` | an **unscheduled call** detected by a conferencing app holding a microphone, offered with no calendar entry behind it. Staged with no Entra registration on purpose: that is the build where it is the only offer there is |
| `agenda-ligne-sortie` | **a row of the day leaving** — the clock moves past a meeting's end and the `agenda:changed` that follows rebuilds it. The one exit in the product that no stage watched, and the one `useLeaving` exists for. Judged by `heldDepartureOf`, which follows whichever `<li>` the renderer marks out of the ones standing *before* the trigger: a leaver that is a **new** element is the finding, because a transition interpolates from the last value the browser painted and a node created already wearing the exit has none. That is exactly how it shipped |
| `session-sans-entra` | a call recorded with no Microsoft account of any kind |
| `review-sans-entra` | the gate with the Outlook intent greyed and the two VerySwing ones live |
| `reglages-sans-entra` | *Facultatifs* with the Microsoft row inert and stating why |
| `splash-telechargement` | the `downloading` variant `core/contracts/boot.ts` declares for a boot-time fetch that **does not exist yet** — the weights ship inside the installer. Its own scenario so it can be looked at without the ordinary splash quietly staging a download a rep never sees |
| `onboarding` | first run, step 1 — what the app is, before anything has been asked for |
| `onboarding-besoins` | step 2, the one worth photographing: the **real** health rows and the **real** `health:retry` behind them, because a hand-written checklist would be a second place where « is capture working » is decided |
| `onboarding-essai` | step 3 — the twenty-second dry run offered, not yet run (DEC-45) |
| `onboarding-suite` | step 3's **second screenful**, which the beats naming the pill and the detector put below the fold at both sizes (US-18). It presses the page turn and requires every press to move the scroller and the last beat to end up whole in the column — « does this control do anything », the question none of the nine measured checks asks |
| `onboarding-essai-fait` | the dry run **after it answered**, with the case that matters: the rep was heard and the machine was not. That is the failure a rep cannot find on their own, because their own voice is in the transcript and the recording looks like it worked |
| `reglages-essai` | the same dry run where a rep in trouble actually looks for it — under the *Requis* rows, one of which says « Audio · connecté », which is a device that opened and not a sound that arrived (DEC-45) |
| `reglages-transcription` | the STT table — **the harness had never rendered it**: no stage opened this pane, and the fixture's provider rows were missing `fields`, which `ProviderRowSchema` requires and `ProviderLine` reads, so the pane threw and the whole app went blank. Seventy-four stagings and the measured checks of the day had never touched the surfaces where HR-4, DEC-30, DEC-34 and DEC-35 live |
| `reglages-modele` | the language-model table, same story — and where DEC-34's « no environment variable » lives: every provider setting is a declared field rendered as a text input |
| `reglages-hors-ligne` | « Cette machine uniquement » (DEC-37) **after** the press: the one switch in this product that refuses something, and the state worth photographing is the consequence — every off-machine engine gone from the tables below, including a selected one. The fixture applies the constraint rather than flipping a flag |
| `reglages-raccourcis` | the keyboard, printed from `app/shortcuts.ts`. Its own pane, and its own stage, because a printed table that drifts from the matcher is exactly what nobody looks at again |
| `reglages-presentation` | first run replayed from Réglages › Connecteurs — the one way back to the three beats and the dry run, rather than a fabricated demo |
| `reglages-calendrier` | the Microsoft 365 account said in the calendar's terms: what connecting brings, and that nothing is written to the agenda |
| `session-libre` | the same call on the free recipe (DEC-43) — a scenario, not a click, because what is worth photographing is the **rail** with no slate declared, saying so instead of drawing empty rows |
| `session-demander` | *Demander* during… no: on the session's compte-rendu, with the question **typed** rather than chip-clicked, because the suggestion chips are the first thing 960px drops |
| `historique-marque` | a call found by a **mark the rep typed during it** — the fifth searchable surface, and the only one a rep can write from inside the call (`core/contracts/marks.ts`). `searchableRecord` folded four and « prix : ils bloquent à 550 » was in the record with `550` finding nothing, so the surface built for a rep who is talking was write-only. « Moments marqués » is the longest of the five labels and is what the row's first column is now sized for |
| `historique-tronque` | **the truncation, said out loud** — `--scenario historique-annees`, eighteen months of calls, the only stage where the fifty-row cap is reached. The sentence names the corpus it is fifty of (`scanned`, shipped on every answer since the channel existed and read by no screen), and it is drawn only when a row was actually hidden: `capped` was `rows.length >= limit`, so exactly fifty matches told a rep to narrow a finished search |
| `historique-demander` | *Demander* on the reader — the screen it was written for, and the one where its citations lead somewhere, the record's own transcription being in the same box (DEC-25) |
| `review-valider` | the same gate once **both** columns have been read to the end, which is the only way *Valider* is drawn at all |
| `review-garde` | **not a photograph — twelve assertions.** Eight attacks the arming guard must refuse (the opening jump, an instant `scrollTo` to both bottoms, a fast flick, a resize mid-read, the Transcription tab, a window that shrinks, a payload changed after arming) and four returns it must leave **free** (re-ticking an intent, « Modifier », and back to « Lecture »). Both halves fail without the other's fix, in opposite directions |
| `review-garde-transcription` | **the ninth attack, and it needed its own gate.** One click on *Transcription* and nothing else: the reader draws a placeholder that fills the column, so the view was covered before the transcript existed, and four presses of the rail's page turn put *Valider* on screen with the compte-rendu at `scrollTop` 0. `review-garde` cannot host it — by its eighth attack its rep has legitimately read both columns, and coverage is a set, so going back is free and correct |
| `review-garde-citation` | **the tenth attack, and it is a *return* the guard must leave free.** Read both columns, arm *Valider*, then follow a citation into the transcript — the gesture DEC-21 exists to produce. The ninth attack's fix made the transcript a *view* of the measured column, so following one cost the arming: fifty page turns on a fifty-minute call, under a caption naming the compte-rendu while the only control named the transcript. Paired with `review-garde-transcription`, which must keep refusing |
| `review-garde-sources` | **the eleventh attack, and the third instance of one shape.** Arm *Valider*, then open five `[source ▸]` panels — a rep checking the evidence on five of eleven rows, which is what DEC-21 exists to produce. They open *inline*, inside the rail the guard measures, so the content grew past `GROWTH_SLACK`, the coverage was deleted, and closing them again left a screen pixel-identical to the armed one still refused: two page turns to recover at 1280×800, five at 960×600. It passes at 1440×900 either way — run it at the smoke sizes |
| `review-garde-mort` | **the twelfth, and the first that asks whether the guard's own remedy works.** The five stages above all prove the guard *refuses*, which is the half that protects the client's CRM; none asks whether the control the refusal offers **arms** the gate. It did not: drag the compte-rendu's scrollbar thumb to the end, or press the `source ▸` on a row the gate's own opening jump put above the fold, and *Valider* never appears in forty presses, at 1280×800 and at 960×600 — DEC-4's one confirmation gate, unreachable, with the only control in the primary slot doing nothing. `review-garde` waits for that button to *exist*, which is exactly what a dead control does. This one presses until the gate arms and requires **every press to move a scroller**; the press count is printed (6 and 5 at 1280×800, 10 and 7 at 960×600) so a slower regression shows in the output instead of hiding behind the ceiling |
| `review-garde-tapis` | **the thirteenth, and it is `review-garde-mort`'s own question from the one tab where « something moved » was the wrong answer.** In *Transcription* the page turn read `docRef` — the transcript's scroller — against a band `measure` deliberately stops updating, which is the compte-rendu's: measured, **757 ↔ 1427 of 16 972** for twenty-six presses at 1280×800 and **547 ↔ 1030 of 17 172** at 960×600, with *Valider* never appearing and the slot's sentence reading « il reste du compte-rendu, à gauche » throughout. The compte-rendu was unarmable **by construction** while that tab was open, reached by `source ▸` → « Voir dans la transcription › » on a gate nothing had been read on yet. `review-garde-mort` could not see it: the transcript *does* move. So this one presses until the gate arms and refuses a press that lands the columns on a position they have already been on — 6 presses at 1280×800, 9 at 960×600, printed |
| `review-valide` | the one irreversible press, driven: read both columns, correct a field, press *Valider*, and assert the payload actually left with the correction in it |
| `review-modele` | **the recipe picker, opened** (US-8, DEC-43). Its panel is 230 px, three `.measure` paragraphs and two `Button`s on the DEC-4 screen, and across 122 stagings not one of the ten checks had ever visited it: no stage clicked the chip. The stage ends with the panel open, which is the only way any of them sees it, and waits on the consequence sentence rather than on the box |
| `review-modele-differe` | **a rewrite that cannot run** (R33-1). `register.ts` answers `changed: true` and fires the run without awaiting it; with no model — the demo build DEC-28 ships first, or an expired key — `Enhancement.run` records `enhancement.deferred` and returns without moving the machine, so the gate stays open and no document arrives. The one sentence this screen had was drawn in the `!open` branch under `state === 'extracting'`, the one branch a deferred rewrite never reaches. Measured before the fix, on a gate read to the end: *Valider* withdrawn, « phrases sur la réécriture : [] », and back after **5 page turns at 1280×800 and 8 at 960×600** over the same document, under a chip naming the recipe that did not run. Three assertions: the sentence is there, the chip names the *document* (which is what keeps « Réécrire avec « Compte-rendu libre » » on screen as the retry), and the count is **zero** — printed, because a fix trading five turns for two would pass a threshold |
| `review-sans-opportunite` | the gate with the opportunity unchecked — nine rows read-only, the reason stated once above the group rather than eleven times |
| `review-citation-prose` | the prose given the provenance the fields already had (DEC-21): a « … » quotation inside the compte-rendu followed into the transcript, on the screen whose whole argument is that nothing ships unchecked |
| `widget` | **the in-meeting widget, collapsed** (DEC-49) — its own window, which is why the stage carries `?window=widget` rather than a gesture: there is no route to it from inside the app and there must not be one. The meter is on it whether the panel is open or not |
| `widget-sortie` | **the pill leaving** — `widget:leave`, the broadcast `Overlay.dismiss()` sends so the one surface drawn over another application fades instead of vanishing between two frames. Its picture is a blank card by construction (an exit ends at opacity zero), which is the point: `smoke.mjs` drives every stage with `--no-png` and what it takes from this one is `--motion`, which asks which end of the motion the slow part belongs to. `.widget-leaving` had been visited by none of the checks on any staging, and shipped for a round wearing the *entering* curve — a blink, then 88 ms of a fully transparent always-on-top window over the rep's call |
| `widget-entree` | **the pill arriving** (DEC-50) — the other end of the one motion a rep watches, and the end nobody had looked at: measured on the real window the panel had `transitionDuration: 0s`, `animationName: none` and `transform-origin` at the CSS initial centre whichever way it stacked, so it appeared between two frames over the face of the person on the call. Four assertions, three of which only a stage can make: the `widget:resize` that sized the window was taken with **nothing animating and nothing transformed** (recorded at the instant of the call, not read back afterwards — `getBoundingClientRect` includes transforms, and the first draft of this feature sent `pillHeight: 35` for a 38 px card); the reported pill matches the resting one; the curve that reached the element **exceeds 1 somewhere in its span**; and the panel's origin is the edge **on the pill's side**, both ways up |
| `widget-ouvert` | the same window opened: the live transcript that arrived **while it was shut**, the rep's own marks in place, the note field and the two ways out. The replay runs before the click, and the order is the assertion — a stage that has to be driven in an unnatural order is a stage describing a defect |
| `widget-pause` | the paused call: the footer's *Pause* becomes *Reprendre* and the pill draws « En pause » where the clock was. Nothing changes on the press — only on `recording:paused`, which the stub emits the way the main process does |
| `widget-refus` | **a refused mark, on the pill, with no panel open.** `meeting:mark` refuses whenever the meeting is not `recording` — `EndOfMeetingWatch` can make that true with the pill still floating over the call — and the sentence went into an `sr-only` paragraph measuring 1×1 with `clip: rect(0,0,0,0)`, on a window with no `role="alert"` in it, while the counter correctly did not move because nothing had been written. The stage measures the box, not the picture, and asserts the counter stayed put |
| `widget-arret` | the second press. Ending a recording cannot be undone, so the confirmation is a different rectangle from the label that summoned it (DEC-4) |
| `agenda-demarrer-tot` | the **Semaine** view with an armable call ahead of its hour — the offer to start early, beside the invites that are not yet armable |
| `agenda-preparer` | **the arming gesture, walked** — *Préparer* pressed on a named upcoming invite and the screen the rep actually lands on. Every earlier stage *counted* this control; none had ever pressed it, and the stub answered an id no meeting carried, so the press landed on « réunion introuvable: evt-evt-delcourt-tjm ». Staged on the one fixture day with nothing live, because `Agenda.#arm` declines beside a recording; the assertion is the objet on the session header, so « landed on *a* meeting » cannot pass for « landed on the one pressed » |
| `agenda-preparer-refus` | the same press while a call is under way: `arm` is illegal beside a recording, and the refusal **names the live call** — « « Néovia Santé — cadrage renfort data » est déjà en cours d'enregistrement. Terminez-la, puis reprenez celle-ci — elle reste proposée. » in the calendar's own `role="alert"`, never a `window.alert` (HR-10). The sentence was fixed one round ago and no screenshot could reach it |
| `agenda-preparer-refus-sortie` | the same refusal, **arriving and leaving**. It is the one thing on the calendar that appears without a press, and it had neither: `animationName: none`, `transitionDuration: 0s`, at both smoke sizes. Three assertions — the arrival's curve, the exit's curve, and `judgeDeparture` over the frames painted between the two ends, because a node created already wearing `.leaving` carries every declaration and paints none of them |
| `review-rail` | the gate's measured rail with every value box drawn, read by `measureRail` — the eleven fields the confirmation is about |
| `review-rail-inerte` | the same rail after the rep's own press removes the opportunity: nine of the eleven boxes lose their fill, because a field the gate cannot ship is text on the ground, not an input |
| `review-garde-frappe` | the guard while the rep is **typing** into the compte-rendu — `Ctrl/⌘ Entrée` must not fire from inside an editable |
| `review-decocher` | the gate with intents unticked one at a time, so the primary's count follows what will actually ship |
| `review-refus` | all three intents refused — the state where nothing is left to send and the primary must say so rather than stay pressable |
| `review-sans-opportunite-valider` | the no-opportunity gate driven through its page turn to the end, so *Valider* is reached the way a rep reaches it |
| `review-source-sortie` | the source panel **leaving** — the departure frame-sampled, not the rule asserted |
| `session-attente-sortie` | « Compte-rendu en attente » on its way out (DEC-39): the notice that states the case and waits, measured as it goes |
| `session-mes-notes` | the rep's own notes on their own — `showRail === false`, which nothing staged until round 23. Reached by « Mes notes » in the header at 960×600, where the notepad is not on screen, and by `LiveAside`'s « Masquer » at 1280×800, where it must **not** be: the stage fails if the control is drawn where all three columns fit |
| `session-remonter` | the compte-rendu read to its end, so the page turn has somewhere to go back to |
| `session-suivi` | *Rédiger la relance* answered — the follow-up draft with the question that produced it above the answer |
| `session-suivi-sans-entra` | the same chip with **no Entra registration**: the compte-rendu never requires a Microsoft account, so the follow-up must say what it can and cannot do |
| `reglages-sortie` | the Réglages sheet **closing**, reached by the keyboard first — the departure that left an invisible full-screen dialog behind for a round |
| `onboarding-refus` | step 2 with screen capture **refused** — the machine-wide state the first stage could not reach, and the settings pane rather than a second prompt |
| `onboarding-micro` | the same step with the **microphone** blocked, which is a different permission with a different way out |
| `onboarding-gere` | the permission blocked **by policy**: « votre service informatique », where no button the rep can press will change it |
| `widget-sombre` | the panel open over a dark ground — the overlay re-points its ink, and the contrast a rep sees is against what Teams is painting |
| `widget-attente` | « Aucun enregistrement »: no clock, no meter, no mark button, which is the half a `waitFor` on one string cannot prove |
| `widget-ennui` | a long quiet call — the surface a rep watches for fifty minutes with nothing arriving |
| `widget-deux-pannes` | **two** health edges: the local engine dies while the audio route is already wrong, then the capture recovers and the transcription must still be reported |
| `widget-survol` | the panel under the cursor, so every hover step is painted rather than declared |
| `widget-pause-refus` | *Pause* refused: the control stays, and the sentence names the cause instead of a *Réessayer* |
| `widget-carte-sortie` | the card leaving, read off whatever the alert or status element is actually saying |
| `widget-panneau-sortie` | the panel leaving while the pill stays — the departure that must not tear the panel off its anchor |

A stage carrying `query` is loaded on that query string. There is exactly one today and it
is the widget: the app has one window with no routes in its URL, and the second window is
told which renderer it is by `?window=widget` (`src/main.tsx`). The fifteen widget stages are
photographed over the app’s own canvas rather than over a video call — the twelve passes
measure the pill against paper, and the contrast a rep actually sees is against whatever Teams
is painting. (Both numbers said something else until they were counted: « fourteen » was
right for one round and « nine » for three, and `CLAUDE.md` records the same drift one level
up about the same list. Count `SCREENS` and `PASSES` before repeating either.) The shadow is what carries that separation, and a screenshot here cannot verify it:
the harness page has five hundred pixels of paper around the pill, so the shadow lands
beautifully whether or not the *window* has room for it. It did not, for a round — the window
was sized to the card and `getBoundingClientRect` excludes a `box-shadow` — and the same blind
spot is what `--expand` did to eleven clipped textareas. What holds it now is the halo in
`Widget.tsx`, not this picture.

## `--sans-entra` — the configuration the first demo ships in

The stub used to answer `auth:state` with a signed-in account **on every
screen**, so the only case the harness could photograph was the one that does
not exist yet. There is no Entra app registration — it lives in a tenant we do
not control (DEC-28) — and that is the build a rep will be shown.

`entra: false` is therefore an axis of its own rather than a scenario name: it
crosses all of them. It is not "signed out", which is a rep who has an app to
sign into and has not; it is *there is nothing to sign into*. The stub answers
as the main process does in that state — `auth:state` carries
`AuthState.reason`, `auth:signIn` rejects, `agenda:snapshot` is `EMPTY_AGENDA`,
and calendar and mail are `down` with `retryable: false` and `app/main.ts`'s own
sentences.

```
node scripts/harness/shot.mjs agenda-sans-entra scratch/x.png     # the four staged screens
node scripts/harness/shot.mjs historique scratch/x.png --sans-entra   # or any other screen
http://localhost:5181/?scenario=agenda&entra=0                        # via serve.mjs
```

What the four screens are there to hold to: the grid is drawn and usable
(DEC-31), the header still reads *Tout fonctionne* because only capture,
transcription and analysis may move it (DEC-32), *Nouvelle réunion* records a
call end to end, and no control on any of them is one that cannot work (DEC-26).

`meeting:create` is remembered rather than answered and discarded, so that last
one is actually reachable: the created meeting appears in the grid, opens, and
records.

Every screen except `splash` is reached the way a rep reaches it — a click on a
row, on *Relire et valider*, on *Tout l'historique ›*, on *Réglages*. Nothing is
deep-linked, so a broken route fails the shot instead of hiding behind it.

## The fixtures

One day in the life of **Julien Marchand**, commercial at *Synapse IT* (a French
ESN), on the Microsoft account `julien.marchand@synapse-it.fr`. Seven client
accounts — Néovia Santé, Groupe Lefort, Sodexial, Groupe Maréchal, Banque
Delcourt, Nordis Retail, Arkelia Logistique — with real ESN vocabulary (TJM,
régie, profils, démarrage, durée, objections achats) so the type and the layout
are judged on sentences the product will actually hold.

The live meeting is **Néovia Santé — cadrage renfort data**: a data-engineering
staffing conversation that names two confirmed profiles, a lead, September,
twelve months, régie, and a purchasing objection at 550 €. Both the signal rail
and the review gate are folded from that same conversation, so the three screens
agree with each other.

## Determinism

`page.clock.setFixedTime()` pins the clock to **today at 14:35 Paris**, and the
same instant is handed to the stub, so the fixtures and the app agree to the
millisecond: the armed call started five minutes ago, two are behind, two ahead,
and the elapsed clock always reads `00:22:00`. The browser context is
`Europe/Paris` / `fr-FR`, so the app's `atParis()` arithmetic and the stub's
`setHours()` land on the same day. Timers keep running — the search debounce is
200 ms real time and has to fire.

## `--expand`

The app shell never scrolls the document: it is `h-full` with its own inner
`overflow-y-auto` columns, so a `fullPage` shot of it is exactly one viewport
and anything below an inner fold is lost. `review`, `historique` and `reglages`
therefore unclip those scrollers before the shot — the shell's
`.h-full.overflow-hidden` and every `.overflow-y-auto`, never the rounded `List`
whose own clipping is what draws its corners. Width, type, spacing and colour
are untouched; only the clipping is. Pass `--expand` to force it on any screen.

The ones that fit — `splash`, every `agenda*` and `session` — are shot exactly
as the window renders them.

## Output

1440 × 900 viewport by default, `deviceScaleFactor: 2`, `fullPage`. So
`agenda.png` is 2880 × 1800 and `review.png` is 2880 × 3568. `--viewport
1280x800` and `--viewport 1920x1080` are the other two the app is judged at;
that flag is why there is one file here and not five near-identical copies of
it.

`--scan` writes `scratch/scan-<screen>-<width>.json` unless given a path, and
prints one line per finding *type* with a count — the detector reports per
element, and one wrong token is forty elements.

## What the scan finds today

Every screen reports `overused-font` (Inter) and `layout-transition`
(`transition: width`). The recurring one worth a decision is
`undersized-ui-text`: the `label` type step is 10px and the detector's floor for
functional text is 11px, so the calendar's weekday headers, its legend, the
section eyebrows and the *Passées* divider are all flagged. That is a design
call — the ramp is deliberate — but it is now a call made with the count in
front of us rather than one nobody was shown.

## Debugging

- The stub exposes `window.__harness`: `emit(channel, payload)` pushes a
  broadcast as the main process would, `calls` is every invoke, `unanswered` is
  every channel it had no answer for. A non-empty `unanswered` is printed after
  each run — it means a screen asked for something the stub does not know, which
  is usually a channel added to `core/contracts/ipc.ts`.
- A staging failure prints the screen's own text, so « why did the click not
  find *Ouvrir* » is answered without opening a browser.
- Console errors and warnings are reported, minus Vite's own chatter. The one
  that always appears — `'frame-ancestors' is ignored when delivered via a
  <meta> element` — is the app's CSP meta tag and is expected outside Electron.

## Adding a screen

Add an entry to `SCREENS` in `shot.mjs` with the `scenario` its data needs and a
`drive(page)` that clicks its way there. Add data to `bridge-stub.mjs` only if a
channel has no answer — the stub answers all 20 invoke channels of
`core/contracts/ipc.ts` today, and listens on all 8 broadcasts.
