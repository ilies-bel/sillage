# Working rules for this repo

Read these before writing code. They are the spec, not background:

| File | What it settles |
|---|---|
| [VISION.md](./VISION.md) | 29 decisions (DEC-1…29), 11 hard requirements (HR-1…11), UI/UX |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Repo decision, kill list, module layout, build order |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | The ordered task list. **Start here.** |

Every rule below is stated in one line. The measurement behind it — what shipped, what it
cost, how it was found — is in [docs/INVARIANTS.md](./docs/INVARIANTS.md). Read that entry
before changing the code a rule names; a one-line rule is not enough to re-derive the trap.

## What this is

**Sillage** — a desktop meeting notetaker for sales reps at a French ESN. It never joins the
call: it listens to the machine's own audio, transcribes, writes French notes, and after
**one** human confirmation pushes to VerySwing CRM and drafts a follow-up in Outlook.

This repo is the only live checkout (`github.com/ilies-bel/sillage`). The predecessor was
archived to `~/project/archive/natively-cluely-ai-assistant` and is not to be worked in.
First deliverable is a live demo against the public VSA sandbox (DEC-28) — no client tenant.

## Architecture

The folder structure is the pipeline. Data flows one way.

```
electron/core/       pure. no electron, no i/o, no network. contracts + domain logic.
electron/modules/    one external boundary each.
electron/app/        electron wiring. main, session state machine, ipc, windows.
src/                 renderer.
```

**The import rule, enforced in CI:** `core/*` imports only `core/`. `modules/X` imports
`core/` and itself, never `modules/Y`. `app/*` imports `core/` and `modules/*`. `src/*`
imports `core/contracts/` only. Modules never talk to each other; the orchestrator wires
them.

**The rule also decides what can be tested together, and round 26 found two defects living
exactly where it forbids a caller.** `isWrittenSentence` sat in `src/widget/`, so nothing
could drive a `core/domain/` producer through it — and every `capturePermission.ts`
`degraded` sentence was being thrown away for want of a capital letter, with a corpus of
hand-written samples standing in for the composer. The fixture's model table sat in
`scripts/harness/` and the only file asserting things about it was under `modules/extract/`,
which may not import `modules/transcribe` — so nothing compared it to the catalogue, and it
painted three sizes the product does not report. **When a fact is shared by two sides of a
boundary, it belongs in `core/contracts/`; when a test needs both sides, it belongs in
`scripts/`.** A predicate about a contract type is not a property of the surface that happens
to call it first. Behaviour that is hard to place goes in `app/session/MeetingSession.ts` or
`core/domain/` — never in an IPC handler.

## The CRM boundary (DEC-29)

```
core/contracts/crm.ts     CrmPort — domain verbs, knows nothing about VSA
modules/crm/vsa/          the only place VSA exists
  fieldMap.ts             ExtractionESN ⇄ VSA columns — DATA, not code
  ext/                    client-specific overrides. subclass, don't fork.
  generated/              from OpenAPI. never hand-edit.
```

`grep -rn 'tiersCode\|oppyId\|salesStage' electron/ src/` must hit only under
`electron/modules/crm/vsa/`.

## Invariants

**Writes into a client's systems**
- `POST /v1/crm/tasks` has no idempotency key and `CrmPort` has no delete verb. Every rule below follows from that.
- One confirmation gate (DEC-4). No second path may confirm what the button refuses.
- A 5xx on a POST is not retryable. `429` is — it is the one status that says the request was not processed.
- `blocked` means a dependency has not settled *yet*, never that it failed.
- A row left `draining` by a dead process is reclaimed; a quit waits for one still on the wire.
- A `failed` push gets a sentence naming the cause, never a *Réessayer* button.
- An intent nobody can route is settled as far as the meeting is concerned (`routable`, injected by `main.ts`).
- An empty compte-rendu is not a task; `draftIntents` refuses one with no description.
- A field the gate cannot ship is read-only, with the reason above it.
- The outbox persists the returned id in the same transaction that drains the intent.
- Never write to the Outlook event body (DEC-10). We create drafts, never send mail (HR-8) — `Mail.ReadWrite`, never `Mail.Send`.

**Evidence (DEC-21)**
- Confidence is measured, never self-reported: every interpretive field cites a transcript span the app verifies. No verifiable span → `⚠ faible`.
- Deterministic data never comes from the LLM (DEC-7) — names, emails, dates, account codes come from Graph or VSA.
- One lookup: `locateSegments` in `core/contracts/` (normalised, channel-joined). Never write a second one.
- An answer with no citation is no answer. A quote too short to look up is kept and marked, never dropped.
- A quote is attributed to a **side**, never to a person. Exactly one interlocutor on the far side names them; otherwise « Client ».
- A mark is the rep's and is never inferred onto a sentence. Taking one back is an event, never a delete.
- The model reads the de-duplicated transcript (`channelBleed.ts`); the store keeps all of it. The timing test is proximity of arrival, not interval overlap.
- `Demander` reads the same transcript the recipe does and says how much of it it read.
- `⚠ faible` is a mark everywhere it appears, `font-semibold` as well as coloured. The string is never rewritten.

**The review gate**
- The arming guard measures what the rep was *shown*, not where a scroller sits; `data-unmeasured` marks what a column holds but does not send.
- Coverage is keyed by which view was read; growth never invalidates, a shrink past `SHRINK_SLACK` does.
- The page turn must move a scroller, and lands on the covered band's edge, not a page away.
- The one control that ships is never the rectangle the rep just pressed.
- Never draw an inert primary: while *Valider* is withheld the slot holds the sub-line saying what is left to read, and nothing else. The control that shows the rest is at the foot of the column it turns, 291px away — putting it in the slot is the double-click-ships defect `Review.tsx:2960-2990` records fixing.
- **The one control is on screen exactly when the press creates something, and the accelerator reads the same expression.** One button used to paint identically for « writes three records », « writes two » and « writes none » — same box, same cursor, same fill, and at one tick state the same label too — while `Ctrl/⌘ Entrée` called `review:confirm` with `intentIds: []`. That is a second path confirming what the button refuses, which DEC-4 forbids, reachable by keyboard on the screen whose POST has no idempotency key and whose port has no delete verb.
- The measurement reaches the button: « Valider malgré N champ(s) non vérifié(s) ».
- The gate opens on the first `⚠ faible` field.
- Leaving the gate never discards a correction (`PENDING_EDITS`, in memory, cleared by a confirmation).
- Nothing hides inside the measured columns — `field-sizing: content`, checked by `--scrollers`.
- `Ctrl/⌘ Entrée` never fires from inside an editable.

**Capture**
- The capture path has zero network dependencies (DEC-26). A downstream failure never stops a recording.
- Raw audio is never retained (DEC-12).
- Proof of life is the input meter, never a transcript (DEC-38) — both channels, mirrored.
- A channel producing *nothing* emits no frames, so the watchdog is fed before the keepalive guard, on a timer, per channel.
- A change of output route during a call is reported, never repaired.
- One missing channel is `degraded`, never `down` (DEC-32), and the sentence names which side.
- The permission is asked for; capability-tested, never platform-tested. A refusal leads to the settings pane, not a prompt.
- The dry run is offered, never automatic; silence is « rien n'a été entendu », not a broken machine. Its verdict is kept and outranks the boot probe (DEC-45).
- A 200 that is not a transcription is a failure, not a silence. A string body is not a transcript.
- AEC (`aec3`, pinned exactly) runs before silence suppression; `enable_high_pass_filter` true, noise suppression and AGC2 off. Tests assert the **shipped** constructor.
- The local engine is pooled and outlives the meeting, so its prompt is set unconditionally — an empty prompt is a statement.

**The session and the agenda**
- One recording at a time, enforced in `Orchestrator.dispatch` — the state table is per meeting.
- `liveStates()`/`liveIds()` mean *work in flight in this process*, never the rehydration cache. Reading a past meeting must not make it live.
- A window closing never abandons a recording; a boot sweep ends one a crash left in `recording`.
- `arm` is illegal beside a live recording, and a refusal names the live call.
- One conversation, one offer: `calendarClaim` defers the ad-hoc detector to the calendar's better offer.
- `#spent` is « has the product finished with this conversation », and `ended`/`extracting` are not in it (they persist for ever with no model — DEC-39).
- « Over » means absent, cancelled, or past `scheduledEnd + OVERRUN_GRACE_MS` — `wait` is not over.
- `armNow` returns the meeting for the event the rep pressed, and raises no notification.
- A synthesised end (`eventId === null`) never gets the short end-of-meeting grace.
- Detection does not require Microsoft: `Agenda` is built over `NULL_CALENDAR` in both branches, with no `onHealth` in the null one.
- Exactly two things navigate without a press: the arming notice (DEC-46) and `PowerWatch`'s. Neither starts anything.
- One anchor for when a meeting is: `meetingAnchor` = `scheduledStart ?? startedAt ?? createdAt`. `endedAt` is never consulted.
- A meeting that ends never leaves the screen blank — `EnhancementNotice` states the case and waits (DEC-39).

**The widget (DEC-49)**
- A saved position is a request, never an instruction — the window must land on a real display.
- The window is the size of its own content, plus the shadow's extent, given back with `widget:passThrough`.
- `setContentProtection(true)`: it is over everything the rep shares.
- It is not an open app — `second-instance`, `activate` and teardown name `mainWindow`.
- It leaves by asking the renderer to fade (`widget:leave` → `widget:left`), with a fallback timer armed first; it stops being `#window` and stops taking the mouse before it does.
- It is not shown before the renderer has measured itself, with the real font and `widget:state` settled. The order must hold: harness `widget:state` latency < `MEASURE_DEADLINE_MS` < `FIRST_FRAME_MS` < `APPEARANCE_MS`, and the renderer states its own deadline from its own mount.
- Every timer is reset when a window is created; an elapsed deadline is elapsed.
- The pill is the anchor, not a window edge — the renderer reports `pillTop`, the main process answers `above`.
- The transcript is opt-in on both surfaces and off by default — proof of life stays the meter (DEC-38). The **window** collects it, never the panel; on the session screen `LiveAside` does, never `Session`. No provisional text — `isFinal: false` cannot occur.

**The renderer**
- The rep's document is never written by AI during a call (DEC-5, DEC-14). Gray AI text enters once, at meeting end.
- The compte-rendu is typeset by `CompteRenduDocument`, markers hanging in a gutter — never a markdown renderer, because VerySwing receives the string the rep read.
- One reading measure: `.measure`, `58ch`, **on the element holding the prose**, never only on a wrapper. `--prose` ceiling is 75; do not change the number without re-running the count.
- A pane is named by its content; a page title names what changed. Well is silent.
- A reading column says how much of itself is left (`ui/ReadingColumn.tsx`).
- No `/NN` opacity modifier on a design token. Whatever `border-*` can say, `ring-*` and `decoration-*` must say too.
- Every control clears 24×24.
- A gutter is owned by what hangs in it, and geometry is measured, not read.
- Ease-out on the way in, ease-in on the way out.
- The keyboard is declared in `src/app/shortcuts.ts` and printed in Réglages: both modifiers always, `closest` as the typing guard, an unclaimed key never `preventDefault`ed.
- The signal rail draws the whole slate, empty rows included.
- Nothing Electron composes reaches a rep's eyes — `preload.ts` strips the `Error invoking remote method` prefix.

**Extraction**
- The compte-rendu opens on a « ## Résumé » (DEC-40), for both recipes.
- Two recipes, declared in `core/contracts/recipes.ts`, never a rep-authored template (DEC-43). `LlmInterpretation.recipe` stays a defaulted key.
- `REGISTRE` reaches the two reduce prompts only. No new markdown. The guillemet guard stays in `REGISTRE`, never in `FORBIDDEN`.
- The compte-rendu never requires a Microsoft account — `repEmail` is nullable the whole way down.
- The document's own lines are followable, by string equality against `compteRenduSources` — never a heuristic. Provenance travels beside the document, never inside it (DEC-44).

**Settings, privacy, updates**
- No environment variable is required to run this app (DEC-34). Keys go to the OS credential store; other provider settings are a `fields` entry. `process.env` is a development override, read last.
- What Réglages says is what a meeting does: `resolveLlm` and `recordingOptionsFor` are asked per use, never snapshotted at boot.
- « Cette machine uniquement » binds the **candidate set**, before ranking and before the explicit pick, and it binds the language model too.
- Where a provider runs is surfaced, never enforced. No jurisdiction claim — no `eu`, no « UE » badge.
- Local transcription is the default, not the fallback (DEC-30). Never call it *dégradé*.
- The calendar is always drawn (DEC-31), with no Graph and on an empty day.
- One general status, moved only by capture, transcription and analysis (DEC-32).
- A model download must report progress, land where the engine looks, and never run during a call (DEC-35).
- The ChatGPT row borrows, never runs, an OAuth flow (DEC-36). No *Se connecter* button.
- An update is verified before it runs: on an unsigned Windows build the updater is not constructed and the panel says why (`core/domain/updateTrust.ts`).
- Diagnostics: a message the product did not write is **declared** (`origin: 'foreign'`), not cleaned. `detail` is an allowlist over shapes — never a place to put a foreign string.
- The schema stamp is written after the fold, not before it.

**Ports and prose**
- A declared port that nothing calls is not a feature. `npm run check:ports` and `check:surfaces` are that grep, run for you; `UNWIRED`/`UNREACHED` entries carry the reason and the cost.
- A comment is not a check. Prose in this repo has been wrong about the code forty-three times — seven of them numbers that were computed and written down as numbers that were observed, one of those seven repeated at four sites and then quoted back by a reviewer as the basis for a recommendation, another giving one variant's width, a second variant's count and a half-height belonging to neither — while a second file, arguing the same point, stated a third width again, so the tree contradicted itself about one measurement for two rounds — and twelve of them docblocks that argued correctly for one of the several cases their subject covers — including two that named a colour distinction no painted pixel had, and one that concluded a hook was right for the very reason it was wrong; measure before trusting a sentence. Round 22 added five: a paragraph saying a fix « is not
in this commit » about code that had shipped it, which then generated a false brief for a
whole lane; a palette note still arguing for the hex it had been replaced by; a docblock
claiming its check discovered rungs by prefix while the code read a hand-written array of
three; a docblock calling a column « wide enough for the longest thing any list puts here »
when it was 31px generous; and the pass count four lines above this file's own command
block, wrong for the third time in the same direction. Round 25 added two, both
in the file it was fixing: `Intents.tsx`'s header said « `drained` is the only
state that gets a tick » from the root commit until that round — `d8eab35` took
the glyphs out and left the sentence describing them — while the same docblock
asserted that both screens read the same push state, which *Historique*'s own
table contradicted; and `PushFailure`'s comment claimed the adapter's fragment
and the product's sentence were joined by « the em dash this app already uses to
join a clause to its consequence », when they are joined by `{' '}` and what
fixed the collision it describes was `sentence()` punctuating the fragment.
Round 26 added three, and **the first was written by the reviewer who was
checking the other two**: a paragraph marking two true paragraphs of
`MeetingTitle.tsx` as stale prose, and counting it, because it re-drove their
960×600 numbers on `session-compte-rendu` — where the call is over and the
header row is 371.28px — instead of `session`, where it is 228.25 and the
numbers are exact to the pixel, including a prediction the fix then met to the
digit. **A measurement is about a stage; a re-measurement on a different stage
falsifies nothing, and « I could not reproduce it » is not « it is not there ».**
The other two are fixtures asserting things the product cannot do:
`healthSentence.test.ts`'s corpus hand-wrote three `capturePermission.ts`
sentences using a wording that exists nowhere in that file, on the one producer
whose real sentences were failing the predicate the corpus was testing; and
`Review.test.tsx`'s « with no Microsoft account » staged a *signed-in* panel
with the calendar's reason on the row, its name and its fixture disagreeing
with nothing able to tell them apart.
Round 27 added two, both found while moving one number into a token, and both
about a **rung**: `Chip.tsx`'s docblock said « the uppercase `label` variant
keeps `--type-meta` » over code that has said `text-label` since the round that
wrote the sentence — harmless while the two 11px rungs differed only in name,
and an argument for taking the eyebrow's tracking back off the moment
`--label-tracking` landed on one of them; and `Splash.tsx`'s kicker has called
its own type « ten-pixel » since the root commit, `a87cc7f` having moved
`--type-label` to 11px without touching the line that justifies its 0.22em.
Round 28 added two, and the first carries **the sixth and seventh
computed-as-observed numbers**: `4780bc4` corrected every size in the Whisper catalogue — Tiny
74 → 61, Base 145 → 130, Small 466 → 486, Medium 1530 → 1614 — and did not
touch `whisper/onnx.ts`, which does *arithmetic* on them, so five sentences
across that file and its test went on arguing from the old table. Two of the
five stated a derived figure: « a single load costs … 2.3× the file » (2.2× of
486 MB) and « Medium … wants something closer to 3.7 GB », written twice, over
a function that answers **3.9** — and restoring 1530 makes it answer exactly
3.7, which is the proof the number was computed rather than seen. The second is
`whisper-models.verified.json`'s turbo entry, whose note said the row was
« kept in the catalogue … because it is the only user of `externalDataFormat` »
— the argument `catalog.ts` **rebuts in the same commit that removed the row**,
so the ledger was still making a case the code had already thrown out, about a
row that was no longer there. Both are now pinned by a test rather than a
sentence: `onnxMemory.test.ts` writes down every catalogue row's requirement,
so moving a `sizeMb` goes red in the diff that moves it.
Round 30 added six, and **one of them was this file**: the review-gate rule
above said « while *Valider* is withheld the slot holds the control that shows
the rest », and driven at both sizes the slot holds `<div aria-hidden
className="mt-row min-h-[35px]" />` and nothing else, while the page turn sits
at x 274…468.4 against the slot's 759.4…1264 — **291px of horizontal gap**.
`Review.tsx:2983-2988` argues the opposite in the same tree (« this slot holds
the decision, or nothing »), and the sixty lines above it record fixing the
double-click-ships-to-the-CRM defect that the rule, followed literally, would
reintroduce — on the screen whose POST has no idempotency key. A rule is prose
too, and this one was a brief for rebuilding a fixed defect. Three more were
**an instrument describing a product that does not exist**. `bridge-stub.mjs`'s transcription table painted
four rows, of which three were invented: `local-whisper-large` / « Whisper
large-v3 (local) » against a registry declaring exactly one local engine;
`soniox`, a provider the app has never offered; and « Azure Speech — France
Centre » for the registry's « Azure Speech (France Central) », id and label both
wrong. Its refusal — « poids absents de cette machine — 1,5 Go à installer » —
is composed nowhere in the tree (`providerRows.refusal` says « non installé sur
cette machine »), and 1,5 Go is in no catalogue row either. So every Réglages
staging photographed a table a rep cannot see and the fourteen passes measured
its contrast, its rhythm and its cells. **The cost was a vacuous gate**:
`shot.mjs`'s `reglages-hors-ligne` — the one stage asserting DEC-37's promise —
waited for « Azure Speech — France Centre » to reach `state: 'detached'`, which
an element that never existed satisfies instantly, so the stage passed whether
the switch filtered anything or not. Its own comment, two lines above, warns
that « a selector that matches prose is a stage that passes while the thing it
is about is still on screen »; a selector matching *nothing* is that defect one
notch worse, and the fixture had the filter all along. The wait is two-sided now
— present, press, gone — and breaking `settingsSnapshot`'s residency filter
reddens it, which it did not before. The other two: `Reglages.tsx`'s diagnostics
docblock called `retentionDays` « the retention setting » from the root commit,
in the one section that states a policy and offers no control, where a docblock
promising one is a brief for building it; and `Onboarding.tsx`'s « Measured,
never asserted. The dot says « prêt » because the snapshot does, not because a
button was pressed » was false about exactly the case it defends until
`9980aac`, the capture dot having read the consent row alone — a button pressed,
nothing probed, the sentence arguing against the code beneath it.
Round 29 added two, both in files the same commit was fixing, and both about
**a table**. `config.ts`'s READERS docblock said Anthropic « stays in the table
and `configuredLlmProviders` never reports it » over a table that has never had
an `anthropic` key — an argument for the mechanism beside the one actually used,
and the absence was load-bearing twice, since the filter is `READERS[p.id]` and
the missing reader is the whole reason that row needs a supplied sentence.
`providerRows.ts`'s `refusal` was the tenth docblock right about one of its
cases: « aucune clé enregistrée » « sends them to the field they have to
fill, which is where the fix is » — true of a cloud row with an empty vault, and the
exact opposite on `azure-openai`, where a key is stored, two required fields are
empty, and the sentence sent the rep back to the one thing they had already
done. **The second was found by driving the first's fix**: a relational test
over the real registry reddened on a row the finding had not named, which is
what a guard is for and what the docblock could not do.
- **An instrument can be green and narrow.** Round 22 found five checks that appeared to ask
  what a rep sees and asked something narrower: `--contrast` tested `background-image`
  before `background-color` and skipped 290 text runs; `--contrast` again computed the
  darkest pixel under the grain, printed 4.458:1 against a 4.5 floor on 138 runs, and bound
  nothing; `--census` read its radius ladder from a hand-written array (**closed** — it
  discovers `--radius*` from `:root` and binds five findings; a lane in round 23 read this
  sentence as a live claim, so it is marked); `--a11y` computes a heading-to-prose ratio and
  prints it on the *green* line (**this one was wrong about the check** — `--a11y` does bind,
  pushing a problem at `px <= body`, and its docblock argues that threshold; what it lacked
  was a *denominator*, and round 23 added one. It was stated here as an unbound number and
  repeated from here into a round-23 brief before a lane measured it); and every one of the eight
  visibility predicates across the twelve passes then shipped ignored whether an ancestor's
  overflow had scrolled the element away — on `historique` at 1280×800, 1 621 of 1 750 painted elements
  are outside their scroller. What decides whether that last one matters is not which helper
  a pass uses but whether its question is **relational**: a pass asking something intrinsic
  about one element is unaffected; a pass asking about the distance between two is corrupted.
  A number that is computed, printed and binds nothing is not a check.
  **And an instrument that is red, knows about a shipped defect, and is in no gate is a
  comment.** `npm run check:models` had reported `onnx-community/whisper-large-v3-turbo-ONNX`
  — a 2 848 MB download a rep could select from Réglages, every one of whose inferences
  throws — since 2026-09-21, and it was in neither `npm run check` nor CI. The reason
  `catalog.ts` gave, « its subject is gigabytes of weights rather than source », was true of a
  dev laptop and not of the check: with no weights it answers from its ledger in about 110 ms
  and reaches the network not at all, which is exactly a CI runner. **Before trusting that a
  check is excluded for a good reason, run it and time it.**
  **And a list of open findings goes stale the round after it is written.** Two of the five
  above were closed or false within one round while this paragraph went on asserting them in
  the present tense — which is the same defect the paragraph is about, committed by the
  paragraph. Mark an entry when it closes, in the same commit that closes it.
- A test is not a caller. A fixture that calls a private method no production path reaches asserts that the method behaves, never that the product is protected — that shape hid a `recording` state with no capture, no health and no diagnostic, for the life of the process.

## Commands

```
npm test                  # the suite. no build needed — Node type-stripping
npm run check             # typecheck ×2 + boundaries + CRM + tokens + platform + French
                          # + ports + surfaces + reasons + diag + motion
npm run test:e2e          # builds, then walks the real main process under Electron.
                          # NEEDS a dev server: 5180, or VITE_DEV_SERVER_URL=…
npm run build:electron    # esbuild → dist-electron
npm run dist              # package (scripts/package-app.mjs), either host
```

**Looking at a screen** — the renderer runs in plain Chromium with a stubbed IPC bridge:

```
npm run dev -- --port 5180 --strictPort        # first, in another shell
node scripts/harness/shot.mjs review scratch/review.png --scan
node scripts/harness/smoke.mjs                 # every stage × two sizes, all fourteen checks
```

`--geometry`, `--targets`, `--prose`, `--echo`, `--a11y`, `--contrast`, `--marks`,
`--scrollers`, `--motion`, `--fade`, `--census`, `--rhythm`, `--cells` and `--press` are the
fourteen `smoke.mjs` passes (`PASSES`, `smoke.mjs:214`); `--scan` is a fifteenth it does not
pass. (The line number said **193** for two rounds after the list moved; a reviewer in round
26 counted the passes correctly and reported the pointer beside them as stale, which is the
first time this sentence was wrong about *where* rather than *how many*.) This said « six » and named the first list for three rounds, then « nine » for one
round after `--census` landed, then « ten » for one round after `--rhythm` and `--cells`
landed, then « twelve » while `--marks` was being added, then « thirteen » while `--press`
was being added — each time omitting exactly the passes added most recently, which are the
ones a reviewer is likeliest to assume unrun and re-run by hand. **Count them in
`smoke.mjs` before repeating this sentence**; it has now been wrong **four** times, in the
same direction, about a list it sits four lines above. The first four times it was written
by whoever had just added the pass it omitted; the fifth time the lane that added `--press`
declined to edit it — correctly, it is coordinator-owned — and named it as stale, so the
count was wrong for the length of one merge instead of one round.

Two of the fourteen are **relational**, and both exist because twelve intrinsic passes were
green over a defect. `--marks` compares two marks of a key to each other rather than each to
its ground: the calendar said « recorded » and « recording now » in two colours **1.0077:1**
apart. `--press` compares the layout *before* a pointer press to the layout *after* it —
the only pass that does not measure a single settled frame: pressing *Préparer* dropped the
list 71.2 px and lit « Ouvrir » on the live recording under an unmoved cursor, and with the
column scrolled it painted the refusal at **y −191**, off screen entirely. Each exists because something shipped past a screenshot. **Both sizes,
always** — 1280×800 and 960×600, the minimum `main.ts` declares. A design pass that only
reads `src/` has not looked at the product. Stages are held together by the product's own
French strings, so a copy change breaks one silently.

`scripts/e2e.mjs` launches the built main process (not the packaged renderer — that comes
from Vite) and walks a rep's first ten minutes, twice, seeding the gate through the
product's own `Store` with the app closed. **It is in no gate** — CI runs `check`,
`check:models` and `npm test`, not this — and two of its 38 steps spent 22 commits red on
a string the product had deliberately stopped saying, because nobody typed the command.
It costs 37 s wall including both builds, so cost is not the reason; the reason is in its
header. Run it by hand after changing a user-facing string. `scripts/harness/README.md` has the screen list;
measure its claims before trusting them.

## Platforms — Windows is the primary one (HR-2)

macOS is where it is written, which is the whole risk. `npm run check:platform`: every file
allowed to know what it is running on is declared in `scripts/check-platform.mjs` with the
reason, and an allowance whose branch has gone also fails.

| | macOS | Windows |
|---|---|---|
| System audio | ScreenCaptureKit, `speaker/macos.rs` | WASAPI loopback, `speaker/windows.rs` |
| Toolchain | full Xcode (`cidre`) | VS Build Tools + `x86_64-pc-windows-msvc` |
| Refresh token | Keychain | Credential Manager — same `SecretVault` port |
| Capture permission | TCC prompt | none |
| Package | dmg + zip | NSIS + portable |

Never put shell syntax in a `package.json` script — `cmd.exe` does not read it. Third-party
native addons are **one** (`keytar`); adding a second is a decision, not a dependency.

## Conventions

- TypeScript strict. Zod schemas for every IPC payload and every LLM output.
- Relative imports inside `electron/` carry their `.ts` extension.
- Node's type stripping is strip-only: no `enum`, no `namespace`, no constructor parameter properties.
- SQLite is `node:sqlite`, never `better-sqlite3`.
- A module never imports another module — declare a port and let `app/` inject it.
- French for user-facing strings. English for code, comments and commits.
- **Commit with `git commit -F <file>`.** The `-m "$(cat <<'EOF' … EOF)"` form is
  stripped to its first line in this environment, silently. Six commits across three
  lanes landed as subject-only before anyone noticed, and the measurement that
  justified each of them existed nowhere else. A body is the evidence; losing it
  turns a measured fix into an assertion.
- **`git stash` is shared by every worktree of a repo.** Two lanes stashing at once
  is one lane's tree landing in the other's, and the first `pop` drops the entry.
  It happened this round and cost most of a day's work until the dangling commit
  was recovered with `git fsck --unreachable` and re-attached with `git stash store`.
  Copy the file to `/tmp` instead; a round runs four worktrees at a time.
- `core/domain/` is unit-tested with no Electron, no audio device, no network.
- Never edit `vendor/` — port out of it into `src/editor/`, then adapt.
- Reference: `docs/reference/vsa-api.md`, `docs/reference/vsa-sandbox-openapi.json`.

## Already decided — do not relitigate

Raw ProseMirror, not TipTap (DEC-8). Microsoft Graph, not Google (HR-3). No monorepo. No
live AI writing into the document (DEC-5). Two declared recipes, no rep template (DEC-43).
One confirmation gate (DEC-4). If you think one is wrong, say so — don't silently build the
other thing.
