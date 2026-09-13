# User stories

The ordered backlog, written from the rep's side. `IMPLEMENTATION.md` is the build
order for the product's skeleton; this file is what gets added to it once the
skeleton stands, and it is the file an implementing agent is pointed at.

Read [CLAUDE.md](../CLAUDE.md) first. Every rule there outranks every line here.

---

## How an agent uses this file

One agent takes **one story**. It is done when:

1. The behaviour ships — not a docblock describing it, not a test fixture that
   demonstrates it. This repo's method is *execute the shipped function, drive the
   shipped renderer, measure the shipped box*.
2. Every acceptance line under the story is **measured**, by a test or a harness
   stage that fails when the change is reverted. Revert your own fix and watch the
   check go red before you claim it. A check that stays green over a reverted fix
   is the defect, not the evidence.
3. `npm test`, `npm run check` and — for anything the rep can see —
   `node scripts/harness/smoke.mjs` are green at **both** smoke sizes.
4. The commit message is a message *file* (`git commit -F <path>`; `-F -` is blocked
   by husky) whose subject is a conventional commit ≤72 chars.

A story is **not** done because it was hard. If you finish and the acceptance lines
are not all measurable, say which one is not and why, rather than lowering it.

### The shapes this repo keeps producing

Every one of these has shipped here and been caught by a later round. Check your own
work against them before handing it back:

1. A test whose fixture cannot exercise the property it is named after.
2. A fix that produces the next round's finding.
3. A check that measures nothing while reporting green.
4. A declared port, channel or method with no caller.
5. A fixture faster or simpler than the product.
6. A mac-first decision (Windows is the primary platform, HR-2).
7. Prose describing what the code does not do.
8. A control that is present and does nothing.

---

## Lanes, and how several agents run at once

The import rule already partitions the tree, so the lanes below are disjoint by
construction. **Two agents never hold the same lane at the same time.**

| Lane | Owns |
|---|---|
| `capture` | `electron/modules/capture/`, `native-module/` |
| `session` | `electron/app/session/`, `electron/core/domain/` (session rules) |
| `extract` | `electron/modules/extract/`, recipe prompts |
| `crm-mail` | `electron/modules/crm/`, `electron/modules/mail/` |
| `ui-review` | `src/screens/Review.tsx`, `src/screens/review/` |
| `ui-session` | `src/screens/Session.tsx`, `src/screens/session/`, `src/widget/` |
| `ui-history` | `src/screens/Historique.tsx`, `src/screens/search/` |
| `ui-onboarding` | `src/screens/Onboarding.tsx`, `src/screens/Splash.tsx` |
| `motion` | `src/design/*.css`, `tailwind.config.js`, `src/ui/` |
| `harness` | `scripts/harness/` |
| `checks` | `scripts/check-*.mjs` |

Three files are **shared** and belong to nobody:

- `electron/core/contracts/*` — a new IPC channel, port verb or schema.
- `electron/app/main.ts` — the wiring.
- `CLAUDE.md`, `VISION.md` — the decisions.

The rule for all three: **the coordinator edits them, on `main`, before the fan-out.**
A story that needs a channel says so in its entry; that channel is declared and
committed first, and only then do the agents start. Inside a lane, an agent wires its
own behaviour as one exported function in its own file and main.ts gains **one line**
calling it — so the merge conflict surface for the whole wave is a handful of lines
in one file instead of a rewrite.

Each implementing agent runs in **its own git worktree** (`isolation: "worktree"`).
That is not tidiness: an adversarial review measures against a clean baseline, and a
dirty working tree in the live checkout silently changes what it measures.

    git worktree add ../sillage-us3 -b story/us-3-veille

---

## The reference images

`docs/stories/ref/` holds the screenshots a story is judged against. It is
**gitignored**: the repo is public, and those images are a competitor's interface and
a capture of a real account. Read them locally; never publish them, never paste their
contents into a commit message, an issue or a PR.

| File | What it shows |
|---|---|
| `ref/granola-home.png` | Their Home: « Coming up » with an empty-calendar card that still draws the day, past notes grouped by day, and a persistent *Ask anything* bar pinned to the foot of the window. |
| `ref/granola-note.png` | One note: title, a chip row (view toggle · ✨ *Enhanced* recipe picker · date · attendee count · *Add to folder*), `#` markers hanging in a left gutter exactly as `CompteRenduDocument` draws them, a magnifier that appears **on the hovered line** — their `[source ▸]` — *Share* and a copy-link control top right, and an ask bar carrying a suggested action (*Write follow up email*). |
| `ref/granola-chat.png` | Their global chat: « Hi Ilies, ask anything » over *every* note, a model picker, and a *Recipes* row of one-press prompts. The sidebar shows **Spaces** (`My notes` 🔒, a team space) and **Shared with me**. |

To photograph our own side, run the harness — `scripts/harness/README.md` has the
stage list. **A design pass that only reads `src/` has not looked at the product.**

Captured with `screencapture -x -o -l <windowId>`, the window id from
`CGWindowListCopyWindowInfo`. That captures a window even when another application is
in front of it, which is the only way to photograph an app while working in a
terminal.

---

## Defects in flight — round 31

An adversarial round runs against every commit. Its findings are work items like any
other, they carry a lane like any other, and they are **first** — a defect is a promise
this product already made and is not keeping. The full round is in the session
transcript; each entry below is self-contained.

### R31-1 — the gate's only remedy is a treadmill in the Transcription tab

**Lane** `ui-review` · **Severity** the highest of the four: it is DEC-4's confirmation
gate again, reached by the one gesture this product has over a general-purpose
notetaker.

`Review.tsx:1545-1567` draws the `PageTurn` whenever `below === 'document'`, in **every**
mode. In the Transcription tab `unread` (`:547-566`) reads `docRef.current` — which is
then the *transcript's* scroller — against `seen.current.document`, a band in the
*compte-rendu's* coordinates that `measure` deliberately stops updating (`:602`). So the
control moves the transcript, forever, while the caption under it says « il reste du
compte-rendu, à gauche ».

Measured: at 1280×800 the transcript oscillates **752 ↔ 1427 of 16 972** for 25 presses
and *Valider* never appears; at 960×600, **547 ↔ 1030 of 17 172** for 14. Reached by one
click on the Transcription tab, or by following `source ▸` → « Voir dans la
transcription › » — which is what a rep does first, because the gate opens jumped to the
one `⚠ faible` row. The compte-rendu is unarmable **by construction** while that tab is
open, not by accident. The escape (« Lecture ») exists and nothing on screen names it, so
the cost is minutes and trust rather than a lost compte-rendu.

This is round 30's own finding one tab over, and round 29's verbatim. `turn`'s docblock
already says it: « a control that moves and achieves nothing is the dead one with extra
steps ».

**Why nothing caught it** — `review-garde-transcription` drives exactly this route and
asserts only that the guard *refuses*; it is green. `review-garde-mort`, the stage built
to ask whether the remedy **arms**, never enters the tab — and its « every press must move
a scroller » assertion is *satisfied* here, because the transcript does move.

**Acceptance** — the stage that would have caught it exists and fails on the revert; the
turn acts on the scroller the mode is showing, or the slot holds the sentence that names
the escape instead of a control that cannot help.

### R31-2 — `check:surfaces` is free for any session method named `close`, `stop`, `start` or `state`

**Lane** `checks` · `scripts/check-surfaces.mjs:322-333`.

`knows(other)` only requires the caller to *import* the declaring module, and
`electron/app/main.ts` imports every session module and contains `store.close()`,
`agenda.stop()`, `session.start()` and `updates.state()`. Adding `close(): void {}` to
`Outbox` exits **0** and is counted as wired. No live false green today — 37 of 38 methods
have a plausibly-typed receiver — but the hole is one method name wide, at the boundary
CLAUDE.md calls « where *nobody calls it* is a behaviour that silently does not happen ».
Had `Outbox.isDraining` been spelled `close`, this check would never have seen it.

**Acceptance** — a dead method named `close` fails; the four live ones still pass; both
directions driven.

### R31-3 — `withoutProse` mis-parses regex literals, and one realistic line turns `check:ports` red on live code

**Lane** `checks` · `scripts/check-ports.mjs:233-284`.

`historySearch.ts:84` writes `.replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")` — a
**backtick inside a character class**. The scanner opens an 8-line « template literal »
over it, eats three real `.replace` calls and an interface, and stays desynced for thirty
lines. Ten files carry residue. Injecting the same shape at `Agenda.ts:201` makes
`check:ports` report `CalendarPort.sync` and `CalendarPort.window` as called nowhere,
exit 1, while `tsc` is clean and both are wired. Today's tree is unaffected — the dumps
are byte-identical with a regex-aware stripper — so this is the false-positive direction,
which gets working code deleted or an `UNWIRED` entry written: standing permission on
live code, the exact rot that list exists to prevent.

**Acceptance** — a self-test over the stripper, fed each token class TypeScript has that
looks like both a comment and a quote (regex literal, character class, division, a
backtick inside one); the 0.55 s budget holds; the `PORT`/`RECV` dump is unchanged on
today's tree.

### R31-4 — *rejected*: CLAUDE.md was already current

The round reported that CLAUDE.md « says *Three are listed today* » and still argues
`LlmPort.complete` is declared debt. Measured: it says « **Two** are listed today, and
there were three »; `UNWIRED` holds `CrmPort.attachTranscript` and `CrmPort.createContact`;
`LlmPort` declares one method; and the `LlmPort.complete` paragraph is written in the past
tense throughout, ending « `LlmPort` has one verb now ».

The reviewer read a historical narrative as a live claim. Kept here because acting on it
would have deleted an accurate account of a defect — and « the prose is stale » is a
finding shape this repo produces often enough that the next round will reach for it again.

**A finding is checked before it is fixed**, including one from an agent whose other three
findings were sound.

---

## Status

| | Story | Lane | State |
|---|---|---|---|
| R31-1 | The page turn is a treadmill in the Transcription tab | `ui-review` | **done** — `5c7f18d` |
| R31-2 | `check:surfaces` free for four method names | `checks` | **done** — `418f7bb` |
| R31-3 | `withoutProse` mis-parses regex literals | `checks` | **done** — `418f7bb` |
| R31-4 | ~~CLAUDE.md prose is stale~~ | shared | **rejected — measured false** |
| US-1 | The machine went to sleep during the call | `session` | **done** — `b2cc981` |
| US-2 | Windows ended the session while a call was live | `session` | **done** — `2c7fe2b` |
| US-3 | A motion vocabulary, not one curve | `motion` | **done** — `c6ea550` |
| US-4 | The suggested next thing, on the note | `ui-session` | todo |
| US-5 | « Qu'est-ce que j'ai dit à Sodexial en juin ? » | `extract` | todo |
| US-6 | Sending the compte-rendu to someone who was not there | `crm-mail` | **half done** — `73edb2c` |
| US-7 | A first run that has already seen a meeting | `ui-onboarding` | deferred — the rep asked for this later |
| US-8 | The recipe is visible on the document, and changeable | `ui-review` | todo |
| US-9 | Spaces, and a note somebody else can open | — | **argued debt, not a story** |
| US-10 | The installer carries the demolished product's mark | — | argued debt |
| US-11 | Telling the client they are being recorded | `ui-session` | **next** — business consequence |
| US-12 | What the shared screen says | — | argued debt |
| US-13 | The widget arrives by popping into existence | `ui-session` | **now** |
| US-14 | The gate's page turn takes 434 ms | `ui-review` | **done** — `a511d30` |
| US-15 | Three dead declarations, one mask that snaps | `motion` | todo |
| US-16 | The harness compte-rendu is missing two constructs | `harness` | todo |
| US-17 | A page turn still moving 150 ms later is unmeasured | `harness` | **next** |

---

## US-1 — « mon portable s'est mis en veille pendant l'appel »

**Lane** `session` · **Contracts** none · **Reference** none — this one is invisible
until it costs a recording.

The rep closes the lid, or the machine sleeps on its own while the rep is on a call
they are not looking at. Measured in this codebase: there is **no `powerMonitor`
usage anywhere**. So the capture devices go away with the machine and the meeting
stays in `recording` — with nothing behind it, which is precisely the condition the
boot sweep exists to repair after a crash, except that here the process is still
alive and no sweep will ever run. `EndOfMeetingWatch` cannot rescue it either: its
countdown starts from a *silence edge*, and a lid closed mid-sentence leaves
`#speaking` non-empty, so no timer is ever armed.

Granola stops recording when the computer sleeps. We stop for silence sooner than
they do (DEC-16's 75 s, and 25 s past a calendar end, against their fifteen minutes)
— the silence half is not the gap. Sleep is.

**What ships**

- The rule is pure and lives in `core/domain/`: which power events end a live
  recording, and the French sentence each produces.
- `suspend` **ends the recording**, and the end is dispatched **synchronously inside
  the handler**. Both halves are load-bearing. The machine may never come back — a
  battery that dies asleep, a hibernate image discarded — so the transition has to be
  in the log before the process stops running; and `dispatch(id, 'end', …)` is
  synchronous and already fires `#enhance`, which flushes the providers and runs the
  recipe when the machine wakes.
- `lock-screen` **does not**, and this is the branch where being wrong is expensive in
  the other direction. A locked screen still records on both platforms; a rep who locks
  their laptop on a headset call is having an ordinary call, and display sleep is not
  system sleep. Ending there destroys a live recording for a gesture that costs nothing.
- `shutdown` ends it, on the same argument as `suspend`, because `before-quit` is not
  promised to run first.
- `resume` **restarts nothing**. The rep pressed *Enregistrer*; the app does not press
  it for them, and a resumed capture would be a second recording with a different
  `startedAt` inside one meeting.
- `resume` **says what happened**, because the screen was off when it did. A rep who
  reopens the lid to a call still in progress has to learn that the recording stopped
  in time to press *Enregistrer* again — DEC-26: a stated degradation, never a silent
  one. Mirror `main.ts`'s existing arming notification (DEC-46) rather than inventing
  a second mechanism, and raise nothing when the sleep ended no recording.

**Acceptance, measured**

- A unit test over the pure rule: `suspend` and `shutdown` end, `lock-screen`,
  `unlock-screen`, `on-battery` and `on-ac` do not. Flipping any one branch fails it.
- A test on the shipped watch, driven through a fake power emitter and a real
  `Orchestrator` over `openMemoryStore`: a live meeting is `ended` after `suspend`,
  and **still `recording`** after `lock-screen`.
- The end is in the log **before** the handler returns — assert it synchronously, with
  no `await` between the emit and the read. A test that awaits a tick cannot tell a
  synchronous dispatch from a deferred one, and the deferred one is the bug.
- The rep is told exactly once per sleep, and not at all when nothing was recording.
- `npm run check:diag` passes: every new `.record({…})` whose `message:` is not a
  literal declares `origin`.

**Out of scope** — resuming the capture, sleep *prevention* (`powerSaveBlocker` during
a call is a separate decision with its own battery cost, and it is not this story).

---

## US-2 — le PC éteint, la réunion restée ouverte — **done**, `2c7fe2b`

**Lane** `session`.

**This entry was wrong when it was written, and checking it was the story.** It said
`app.on('session-end')`. In Electron 43 `session-end` is declared on `BaseWindow` /
`BrowserWindow`; the `App` interface declares no such event. `app` is a plain
`EventEmitter`, so the version this file asked for would have **compiled, never fired, and
read as a fix** — shape #4, on the primary platform, about a call left recording for ever.
It is subscribed on the windows.

**And the same reading found a hole in US-1**, which had already merged: `powerMonitor`'s
`shutdown` is `@platform linux,darwin`. So US-1's hardest-argued branch — « `shutdown` must
end, because `before-quit` is not promised to run first » — **cannot fire on Windows at
all**. The branch is right where it fires and the argument was never wrong; what was wrong
was the coverage the prose implied on the platform that matters. Two tuples now, against two
emitters, over one decision table, and the census test asserts the **negative**:
`session-end` is not asked of `powerMonitor`.

A shutdown or a session end raises no resume notice: the sleep notice says the *sleep*
stopped the recording, which is false about either, and a meeting remembered against one
would wait in the field for a later sleep to publish it.

**Not verified on Windows, and that is stated rather than implied.** That `WM_ENDSESSION`
reaches a `BrowserWindow` listener at all, that it reaches *every* top-level window, that it
arrives before the process is killed, and that a synchronous SQLite write completes inside
it, are all read off Electron's declarations and never observed. Every measurement is
against a fake window under `node --test`.

## US-3 — « ça bouge, mais tout bouge pareil »

**Lane** `motion` · **Reference** `ref/granola-note.png`, and the token table below.

The goal named this: *production-ready feeling*. It is not a matter of taste and it is
countable. Measured on the shipped stylesheets of both products:

| | Granola 7.543.3 | Sillage today |
|---|---|---|
| durations | ~12: `0, 75ms, .1, .15, .2, .25, .28, .3, .325, .375, .5, .6, 1s` | **2** (`--motion` 150 ms, `--motion-fast` 90 ms) |
| curves | 10, incl. `--ease-out-expo: cubic-bezier(.16,1,.3,1)` | **2** |
| overshoot | `(.22,1.2,.36,1)`, `(.25,1.1,.5,1)`, `(.34,1.56,.64,1)` | **none** |
| named keyframes | ~60 | **1** (`animate-rise-in`, used twice) |
| distinct shadows | 15 | 0 in `src/design/*.css` |

Their base duration is `.15s` — the same as our `--motion` — and one of their curves is
`--join-ease: cubic-bezier(.22,1,.36,1)`, **byte-identical to our `--ease-out`**, named
for the moment of joining a call. So the taste is already right and the vocabulary is
one note. We have nothing that overshoots, and overshoot is what makes a thing
*arriving* read as alive rather than merely fast.

**What ships** — a duration ladder and a spring family as tokens in `tokens.css`, and
each one **used** by something. A token nothing draws with is the fourth shape on the
list above.

**Acceptance, measured**

- `design/tokens.test.ts` pins every new curve by its **shape**, not its string — the
  existing `--ease-in` assertion is the model: redefining it to
  `cubic-bezier(0.22, 1, 0.36, 0.99)` restored the blink it exists to prevent and passed
  every check, because nothing asked what the curve *did*. An overshoot curve is pinned
  as « progress exceeds 1 somewhere in its span ».
- `npm run check:tokens` passes: no `/NN` opacity modifier on a design token, and no
  `ring-*` or `decoration-*` name that resolves to a `--bg-` token.
- `shot.mjs --motion` passes on all stagings, its self-test still reports eight attacks
  caught and one deliberately silent, and **no element leaves on an entering curve**.
- Every duration you add is used by at least one shipped rule. Grep for it and say where.
- `prefers-reduced-motion` collapses all of it, and `widget-sortie` still exits within
  its measured deadline — the exit handshake reads its duration off computed style, so a
  new duration on `.widget-leaving` changes what the main process waits for.

**Out of scope** — animating the review gate's decision controls. The page turn and
*Valider* deliberately share no rectangle and no transition; a shared one painted the
ship's fill under the turn's label for one frame and shipped a CRM task on a double
click.

---

## US-4 — « et maintenant, je fais quoi de ça ? »

**Lane** `ui-session` · **Reference** `ref/granola-note.png`, foot of the window.

Their ask bar carries a **suggested action** — one chip, *Write follow up email* on a
meeting note, *List recent todos* on the home screen. It is not a feature so much as
the answer to « this box is open, what do I type ». Our *Demander* panel opens on an
empty field and says nothing about what it is good at.

We already compose a follow-up draft at the gate, so the chip is an entry point to work
that exists, not a new promise.

**Acceptance** — the chip is offered only where its action can actually run (no Entra,
no follow-up chip: a dead control is DEC-26's own example); pressing it writes nothing
and confirms nothing, like everything else `Demander` does (DEC-25); `--targets` clears
24×24 and `--prose` stays under 75 characters a line; a harness stage photographs it.

---

## US-5 — « qu'est-ce que j'ai dit à Sodexial en juin ? »

**Lane** `extract` · **Reference** `ref/granola-chat.png`.

Their Chat answers over **every** note. Ours answers over one meeting: `AskPanel` is
mounted on *Historique* and on the session screen, and `ask.ts` reads one stored
transcript. A rep preparing a renewal wants six months of one account.

The hard part is not the model, it is DEC-21. A cross-meeting answer still has to cite
a verbatim fragment, and the citation now has to name **which call** it came from and
open that call's reader on that turn. `locateSegments` already does the lookup; what
does not exist is a corpus selection that a rep can understand and a citation that
carries a meeting id.

Scope it to **one account, a bounded window** before reaching for an index — the
truncation defect (`ASK_MAX_INPUT_CHARS` silently keeping the tail of a 90-minute call
and answering « la transcription ne permet pas de répondre » about the first twenty
minutes) is one corpus size away from happening again, at six months of material.

**Acceptance** — every citation resolves to a real turn in a named meeting and opens it;
a corpus too large to send is **said**, never silently trimmed; an answer with no
citation is refused, exactly as `verifyAnswer` refuses one today.

---

## US-6 — envoyer le compte-rendu — **half done**, `73edb2c`

**Lane** `crm-mail` for what shipped; the remainder is `ui-review` and `ui-history`.

The acceptance line — « the exported string is character-for-character the one the rep
read » — **was measured at neither boundary the compte-rendu crosses**. `modules/mail` never
asserted the POST body at all: replacing one line of `messageBody` so it strips every `#`,
`##` and `###` out of every draft the product creates left **1 798 tests green**. And
`modules/crm` did assert it, against a 40-character fixture with one heading and no trailing
newline — so trimming `TEXT.toColumn`, which changes the real document on every push
(`renderCompteRendu` ends every document with exactly one newline), passed 40 of 40.

Both fixtures are the composer's document now, faithful in *constructs* — the six sections
read off `COMPTE_RENDU_SECTIONS` so they cannot drift from the recipe, plus the heading
levels, the list marker, emphasis, a quotation, U+2019, the low-confidence marker with its
legend, and the trailing newline — with a guard test in each file that refuses a fixture
missing a construct. Seventh instance of shape #5 in this repo.

**No product code changed, and none should have.** `OutlookMail.createDraft({ subject, body,
to: [] })` *is* the export; the payload schema already permits an empty recipient list. A
`MailPort` verb wrapping it would have been a declaration with no caller.

**The coordinator's design call, taken: ship the clipboard, defer the Graph draft.**

- The clipboard half **already ships and is already verbatim** — `Review.tsx:1391` copies
  the pending compte-rendu, `Historique.tsx:506` copies the stored one. What it lacks
  against a *Share* button is a subject and one gesture. Making both copy the subject and
  the document together, the way the follow-up draft's own copy control already does, needs
  no channel, no network and no Microsoft account — which is the configuration DEC-28 ships
  first. That is the remainder, and it is two lines in two files.
- The Graph draft buys **one saved gesture** at the cost of an Entra registration the first
  deliverable does not have, so it waits until there is a reason beyond symmetry.
- **`mailto:` is measurably wrong; do not build it.** The harness compte-rendu is 3 026
  characters; percent-encoded into a `mailto:` it is **4 994** — 2.4× Windows' 2 083-character
  shell URL cap, so it truncates silently on the primary platform and breaks the acceptance
  line by construction.

## US-7 — a first run that has already seen a meeting *(deferred)*

**Lane** `ui-onboarding` · **Reference** `ref/granola-home.png`, « Demo meeting ».

Granola pre-loads a two-minute demo meeting from a colleague, so a new user reads a
finished note before they have ever taken a call. We have three honest steps with the
real health rows and a twenty-second dry run, and **no worked example** — which is
exactly what DEC-28's demo build is for.

Deferred on the rep's own instruction. When it comes back: the fixture has to be a
document `modules/extract` could really have produced, held by `harnessFixture.test.ts`
like every other one. That file has caught this repo's fixtures flattering it **six**
times.

---

## US-8 — « ce n'est pas le bon modèle de compte-rendu »

**Lane** `ui-review` · **Reference** `ref/granola-note.png`, the ✨ *Enhanced* chip.

Their recipe is a chip on the document and a dropdown one press away. Ours is
`recipes.ts`, decided before the call and invisible afterwards — so a rep who recorded
a discovery call under the ESN recipe and wanted the free one has no way to say so
without re-recording.

DEC-43 stands: two **declared** recipes, never a rep-authored template. This is a
picker over the declared set, not an editor.

**Acceptance** — re-running lands through `Orchestrator.enhance`, the retry path that
already exists, so a re-extraction can never analyse less material than the attempt it
replaces; the rep's pending edits are not silently destroyed by it (`PENDING_EDITS` is
per meeting and in memory — say what happens to them, on screen, before the press).

---

## US-9 — Spaces, and a note somebody else can open *(argued debt, not a story)*

`ref/granola-chat.png`'s sidebar: **Spaces** (`My notes` 🔒, a team space) and **Shared
with me**. It is the feature a rep asks for after the third good compte-rendu, and it
is a *server* — accounts, permissions, an authority on who may read a client's words,
and a copy of that content off the rep's machine.

That is a decision for VISION.md, not an implementation. Everything this product
currently promises about where a client's words live — DEC-12, DEC-37, the
`offlineOnly` switch, « cette machine uniquement » — is written on the assumption that
they do not leave. Shipping a share link is amending those decisions, and doing it as a
feature would amend them by accident.

The nearest thing that costs none of it is **US-6**.

---

## US-10 — the installer's mark *(argued debt)*

`assets/icons/**` has not been touched since the root commit and is the demolished
predecessor's mark: a white circled **N** on navy. It ships inside every installer
under `fr.ilies-bel.sillage` — taskbar, dock, alt-tab, Start menu, DMG background. In
the app itself there is no mark at all: `Splash.tsx` and `Onboarding.tsx` set the
wordmark as type.

Deferred on the rep's own instruction (« keep reviewing, logo later »), recorded here
so it is a decision rather than something nobody noticed.

---

## Wave-2 stories, all three found by measuring rather than by reading

### US-13 — the widget arrives by popping into existence

**Lane** `ui-session` · **Licensed by DEC-50** · **This is the goal's headline surface.**

Driven on the real window: the 340×205 card that appears over another application's video
call has `transitionDuration: 0s`, `animationName: none`, and
`transform-origin: 170px 102.594px` — dead centre, the CSS initial, **regardless of
`above`**. It has no transform at all. It pops between two frames, at the instant the rep
presses *Enregistrer*, over the face of the person on the call.

The frequency table puts this surface on the « once or twice a day → this is where delight
belongs » row, and there is nothing on it. Every other motion decision in this product has
been made; this one never was.

DEC-50 is what makes it possible and also what bounds it — read the decision, not this
paragraph. The four bounds are each a test: overshoot pinned by **shape**, collapsed
entirely under reduced motion, the **exit untouched**, and nothing animating before
`widget:measuring` has answered, because `getBoundingClientRect` includes transforms and a
window sized from a scaled box is the clipped-first-frame defect that handshake exists to
end — reintroduced by its own polish.

**Acceptance** — `widget-entree` as a stage beside `widget-sortie`; the origin follows
`above`; `scripts/e2e.mjs` still measures the pill's screen position across an open and a
close on the real window, unchanged; `--motion`'s self-test still reports eleven attacks
with two deliberately silent.

### US-14 — the gate's page turn takes 434 ms, and no check can see it

**Lane** `ui-review` · owns `src/lib/scroll.ts`.

Measured on the gate's own compte-rendu column, driven the rep's way:

```
1280×800   box 747 in 2549 (3 pages)   smooth 434 ms / 52 frames   auto 33 ms / 4 frames
 960×600   box 547 in 2549 (5 pages)   smooth 369 ms / 44 frames   auto 35 ms / 4 frames
```

434 ms is nearly **3× VISION §6's 150 ms ceiling** and above the standard's 300 ms master
rule — and it is the only motion in the product above either. `shot.mjs --motion` cannot
see it, because a scroll animation is neither a transition nor an animation;
`scroll.ts`'s own docblock already records that blind spot and nothing was ever built
against it.

At 6–10 presses per gate that is **2.6–3.7 seconds per gate**, on the one screen a rep
cannot leave without deciding. The frequency table's row for « tens of times a day » is
*remove or drastically reduce*.

A token cannot fix it: Chromium picks the duration for `scroll-behavior: smooth`. So the
question is whether this scroll should be animated at all, and the answer has to be
measured against the guard — the arming guard records the viewports a column has *shown*,
and a scroll that teleports shows nothing on the way. That is the whole reason it was
smooth. Read `review-garde`'s « a scroll the app performs is marked and records where it
landed, never the bands it animated past » before changing anything: the coverage
arithmetic already does not credit the intermediate frames, which may mean the animation is
paying a cost for a property that is not being bought.

### US-15 — three dead declarations, one of them a mask that snaps

**Lane** `motion`, except the first line.

- `shadow-card` has **zero** `className` occurrences under `src/` — declared, mapped,
  drawn by nothing. Same shape as the two motion tokens US-3 resurrected.
- `src/design/index.css`'s `.fade-below` and `.filter-scroller` switch their mask between a
  two-stop and a four-stop gradient **between two frames**, so a hard edge appears under the
  rep's eyes on the pane where they meet the compte-rendu. The fix is always the four-stop
  form with a registered `--fade-reading` animating, which rewrites a rule `shot.mjs --fade`
  defends heavily — so it is its own story and not a hunk in someone else's.

### US-16 — the harness compte-rendu, caught for the seventh time

**Lane** `harness` · `scripts/harness/bridge-stub.mjs`, its compte-rendu around line 896.

It carries the low-confidence marker but **no legend line**, and it does **not end with a
newline**. `renderCompteRendu` appends both unconditionally
(`modules/extract/compteRendu.ts:400-405`). So every screenshot judgement about the gate, the
session pane and *Historique* has been made against a document the composer cannot produce,
in two ways — and `harnessFixture.test.ts`, the file whose whole job is to refuse exactly
this, does not ask about either.

Found by US-6 while making the *crm* and *mail* fixtures faithful, which is the point: a
fixture caught lying in one place is worth re-asking everywhere.

### US-17 — nothing can see a scroll that takes too long

**Lane** `harness` · proposed by US-14, which measured the problem and deliberately did not
build the instrument in someone else's lane.

`shot.mjs --motion` reads `transitionDuration` and `animationDuration`. A scroll animation
has neither, so the 415 ms page turn US-14 removed was invisible to every one of the nine
measured checks for as long as it existed. `check-motion.mjs` holds every spelling to one
file and by construction cannot ask what that file *says*. `scroll.test.ts` now pins the
decision in-lane — but a duration only exists in a browser pressing the real control.

**The instrument, as US-14 specified it**: in `review-garde-mort`'s `reach()` loop, sample
`at()` twice about 150 ms after each press and fail when the columns moved between the two
samples — « un tour de page encore en mouvement 150 ms après la pression », which is VISION
§6's own ceiling. One extra `at()` per press. It would have been red on every run before
`a511d30` and is green after, which is the acceptance line.

A new `shot.mjs --scroll` flag is the wrong shape: it would have to press the control to
observe anything, so it would duplicate the stage rather than add a check.

**And while in that file**: those stages wait 360 ms after each press, which was *inside*
the animation for as long as they have existed — so every position they ever printed was
mid-flight. They are settled now and the waits can come down.

---

## Appendix — their on-call widget, channel by channel

Granola calls it the **nub**. Read off `main.js` inside their asar, so this is their
surface and not a description of it. Thirty-one channels; ours are the `widget:*` and
`moment:*` families in `core/contracts/ipc.ts`.

| Granola | Sillage | |
|---|---|---|
| `nub:request_initial_state` | `widget:state` | parity |
| `nub-banner:resize` | `widget:resize` | parity |
| `nub:set_interactive` | `widget:passThrough` | parity |
| `nub:visible` · `nub:banner_exit_complete` | `widget:leave` · `widget:left` | parity — **the same two-phase exit handshake** |
| `nub:open_document` | `session:open` | parity |
| `nub:hover` | handled in the renderer | theirs reports hover to the main process; ours decides it where it happens |
| `nub:transcription_action` | `meeting:mark`, `moment:marked`, `moment:forgotten` | ours is narrower on purpose (DEC-21, DEC-27) |
| — | **`widget:measuring`**, `widget:placed` | **ours, and they have nothing like it** |
| `nub:add_screenshot_attachment` · `nub:screenshot_attachment_ready` | — | gap |
| `nub:meeting_control_banner_*` (5) | — | gap |
| `nub:virtual_camera_*` (11) | — | out of scope |

Two conclusions, and the first is the answer to « reach the same quality ».

**Structurally the widget is at parity, and in one place we are ahead.** Their sequence is
`setSize(w, h)` then `showInactive()` — which is exactly the shape whose failure
`widget:measuring` exists to prevent here: a window shown before anything measured it,
arriving clipped and settling in three steps over the face of the person on the call. They
have no first-frame measurement handshake. Whatever else is true, that one is ours.

**The gaps are features hung off the widget, not the widget.** Eleven of their thirty-one
channels are a virtual camera. Five are an in-meeting control banner. Two are a screenshot
attachment.

## US-11 — « est-ce que j'ai le droit d'enregistrer ce client ? »

**Lane** `ui-session` · **Priority: this is the one with a business consequence.**

Granola ships a whole **consent subsystem**: `meet-consent-host` (a native messaging host
installed into the browser, Windows and macOS), a named pipe or unix socket per user, a
browser extension, and `granola:coordinated-consent-send` — which posts a consent message
into the meeting chat and coordinates so that two attendees running Granola do not send it
twice. Their workspace settings carry
`in_meeting_copy_consent_message_banner_enabled` and its message, and their rule set
matches on `calendar_event_title`, `organized_by`, `in_person` and `consent_page_missing`.

We have **nothing**. We record a client's words in France with no surface anywhere that
tells them it is happening. For a product sold to an ESN whose clients are enterprises,
that is likelier to be a procurement blocker than any feature on this list.

**What is honestly available to us.** Their mechanism needs a browser extension and a bot
in the call; DEC-49 says this product never joins the call, and that is not up for
revision. The version that costs none of it: the pill offers **one press that puts the
sentence on the clipboard**, and the rep pastes it into the Teams chat — or reads it out,
which is what a rep does anyway. No server, no extension, no bot, and the rep stays the
one who speaks.

**Acceptance** — the sentence is French, declared in one place, and configurable in
Réglages the way every other setting is (DEC-34: no environment variable); the control is
on the pill, clears 24×24, and **does nothing else** — it never sends, never writes to the
meeting, never touches the Outlook event body (DEC-10); pressing it is recorded as an
event, because « did I tell them » is a question the rep will be asked later and the log is
where the answer lives; and it is never a gate — a rep who does not press it still records,
because refusing to record is not this product's call to make.

**Out of scope** — a native messaging host, a browser extension, any coordination between
two machines, and anything that claims consent was *obtained*. The product can record that
the rep was offered the sentence. It cannot know what the client said.

## US-12 — what the shared screen says *(argued debt)*

`initScreenShareContextOcr` — they OCR the screen being shared and feed it to the model as
context. It is the reason their notes can name a figure that was only ever on a slide.

Recorded, not scoped. DEC-12 retains no raw audio, and reading a client's shared screen is
a substantially larger step than listening to a call the rep is already in: a pricing sheet,
a roadmap, another client's name. If it is ever wanted it is a VISION decision first, with
the same care DEC-37 got.

---

## The agents

Three definitions live in `.claude/agents/`, and they exist so that a wave of work does
not have to re-explain this repo four times.

| Agent | Holds | Use |
|---|---|---|
| `sillage-story` | one lane | Implements one story or defect end to end. Give it the id and the lane; it reads the rest. |
| `sillage-motion` | `motion` | The duration ladder, the curve family, how a surface arrives and leaves. Carries the measured competitor comparison and the `--ease-in` trap. |
| `sillage-adversary` | nothing | Reviews the tree after a wave merges. Ends `NOT IMPRESSED` unless nothing survives. |

**The adversary never runs beside an implementor.** It measures against a clean baseline,
and a dirty working tree silently changes what it measures — round 31 opened by noting an
uncommitted `.gitignore` line that was not its own.

### Fanning out a wave

1. Pick the ready stories, one per lane, from the Status table.
2. Apply any shared-file edits — a new contract, a channel, a CLAUDE.md decision —
   yourself, on `main`, and commit. Agents start from that commit.
3. Launch them **in one message**, one per lane, each with `isolation: "worktree"`.
4. Merge as they land, running `npm run check` between merges: two clean diffs can be a
   broken tree, and the gate that catches it is cheap.
5. Run `sillage-adversary` **in its own worktree, pinned to a named commit** — concurrently
   with the wave if you like; it is the merges, not the agents, that break it.

   This is the one rule in this file that was learned by breaking it. Round 32 was pointed
   at the live main checkout, correctly reasoning that the implementing agents were isolated
   in worktrees — and then four lanes were merged into that same checkout while it measured.
   « HEAD moved under me » cost the whole round. Isolation from other agents is not
   isolation from yourself.
6. Its findings become the next wave's first entries, which is what the section above is.

A finding from an agent is checked before it is acted on. R31-4 is why.
