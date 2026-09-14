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
node scripts/harness/shot.mjs <screen> <out.png> [--viewport WxH] [--expand|--no-expand] [--scan [out.json]] [--geometry] [--targets] [--prose] [--a11y] [--contrast] [--scrollers] [--motion] [--fade] [--no-png] [--sans-entra]
node scripts/harness/smoke.mjs                 # every stage × two sizes, with all eight checks
node scripts/harness/serve.mjs                 # the same app at a URL, for tools that only take one
```

**Run `smoke.mjs` before and after a copy change.** A stage is a scripted path
through the real renderer and it is held together by the product's own French
strings, so renaming a button breaks stages silently — nothing runs them but a
person deciding to look at a screen. It has happened twice, and the second time
it broke six at once, including both of the features under review.

**Eight measured checks, and each exists because something shipped past a
screenshot.** `--geometry` (ten of twenty-three gutter markers clipped),
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
the window was sized off an untransformed box), `--fade`, and `--scrollers`, below. All eight run on every stage at 1280×800 *and* at 960×600 —
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
| `session-compte-rendu` | the same meeting **after the analysis** — three columns: the rep's own notes, still editable and still theirs (DEC-5), the compte-rendu, and the slate, all drawn at once with nothing pressed. *Relire et valider* is still the only door to the gate (DEC-4) |
| `review` | the gate (DEC-4): the compte-rendu typeset with its markers in the gutter and the Outlook draft under it at the reading measure, eleven fields each stating what verified it, and the three intents pinned above one *Valider*. Shoot it `--no-expand` |
| `review-transcription` | the same gate with a **verified** citation followed into the record: the cited turn highlighted and scrolled to, headed « Citation du champ « Besoin », à 3:58. », with the field still on screen beside it |
| `review-transcription-introuvable` | the other verdict — the one field the extraction could not verify. The reader says the quote is not in the transcript instead of opening silently at 0:00 |
| `historique` | the reader (DEC-25): seven calls with per-intent push status, one row expanded into transcript · notes · compte-rendu · extraction · envois |
| `reglages` | *Connecteurs*, opened where the header control lands: **Requis** with one *à vérifier*, **Facultatifs** with VerySwing down and Outlook to check, two *Réessayer*, and the VSA tenant probe |
| `agenda-sans-entra` | the same calendar with **no Entra app registration** — see below |
| `agenda-appel-imprevu` | an **unscheduled call** detected by a conferencing app holding a microphone, offered with no calendar entry behind it. Staged with no Entra registration on purpose: that is the build where it is the only offer there is |
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
| `reglages-transcription` | the STT table — **the harness had never rendered it**: no stage opened this pane, and the fixture's provider rows were missing `fields`, which `ProviderRowSchema` requires and `ProviderLine` reads, so the pane threw and the whole app went blank. Seventy-four stagings and six measured checks had never touched the surfaces where HR-4, DEC-30, DEC-34 and DEC-35 live |
| `reglages-modele` | the language-model table, same story — and where DEC-34's « no environment variable » lives: every provider setting is a declared field rendered as a text input |
| `reglages-hors-ligne` | « Cette machine uniquement » (DEC-37) **after** the press: the one switch in this product that refuses something, and the state worth photographing is the consequence — every off-machine engine gone from the tables below, including a selected one. The fixture applies the constraint rather than flipping a flag |
| `reglages-raccourcis` | the keyboard, printed from `app/shortcuts.ts`. Its own pane, and its own stage, because a printed table that drifts from the matcher is exactly what nobody looks at again |
| `agenda-empty-presentation` | the empty day's second way out: a rep who installs on Tuesday with no calls until Thursday replays first run, rather than being shown a fabricated demo |
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
| `widget-sortie` | **the pill leaving** — `widget:leave`, the broadcast `Overlay.dismiss()` sends so the one surface drawn over another application fades instead of vanishing between two frames. Its picture is a blank card by construction (an exit ends at opacity zero), which is the point: `smoke.mjs` drives every stage with `--no-png` and what it takes from this one is `--motion`, which asks which end of the motion the slow part belongs to. `.widget-leaving` had been visited by none of the eight checks on any of the 104 stagings, and shipped for a round wearing the *entering* curve — a blink, then 88 ms of a fully transparent always-on-top window over the rep's call |
| `widget-entree` | **the pill arriving** (DEC-50) — the other end of the one motion a rep watches, and the end nobody had looked at: measured on the real window the panel had `transitionDuration: 0s`, `animationName: none` and `transform-origin` at the CSS initial centre whichever way it stacked, so it appeared between two frames over the face of the person on the call. Four assertions, three of which only a stage can make: the `widget:resize` that sized the window was taken with **nothing animating and nothing transformed** (recorded at the instant of the call, not read back afterwards — `getBoundingClientRect` includes transforms, and the first draft of this feature sent `pillHeight: 35` for a 38 px card); the reported pill matches the resting one; the curve that reached the element **exceeds 1 somewhere in its span**; and the panel's origin is the edge **on the pill's side**, both ways up |
| `widget-ouvert` | the same window opened: the live transcript that arrived **while it was shut**, the rep's own marks in place, the note field and the two ways out. The replay runs before the click, and the order is the assertion — a stage that has to be driven in an unnatural order is a stage describing a defect |
| `widget-refus` | **a refused mark, on the pill, with no panel open.** `meeting:mark` refuses whenever the meeting is not `recording` — `EndOfMeetingWatch` can make that true with the pill still floating over the call — and the sentence went into an `sr-only` paragraph measuring 1×1 with `clip: rect(0,0,0,0)`, on a window with no `role="alert"` in it, while the counter correctly did not move because nothing had been written. The stage measures the box, not the picture, and asserts the counter stayed put |
| `widget-arret` | the second press. Ending a recording cannot be undone, so the confirmation is a different rectangle from the label that summoned it (DEC-4) |

A stage carrying `query` is loaded on that query string. There is exactly one today and it
is the widget: the app has one window with no routes in its URL, and the second window is
told which renderer it is by `?window=widget` (`src/main.tsx`). The six widget stages are
photographed over the app’s own canvas rather than over a video call — the eight checks measure
the pill against paper, and the contrast a rep actually sees is against whatever Teams is
painting. The shadow is what carries that separation, and a screenshot here cannot verify it:
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
