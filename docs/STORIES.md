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
| `ui-session` | `src/screens/Session.tsx`, `src/screens/session/` |
| `widget` | `src/widget/` — split out of `ui-session` once two parity stories wanted it at once |
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

## Feature parity, measured — what they ship and what we ship

Built from the probe (`ref/*.png`, the 31 nub channels in the Appendix, and `main.js`'s own
strings) against this tree at `c15a725`. **Ahead / level / behind is about what a rep can do,
not about lines of code**, and where we are ahead it is because the feature was built to a
different rule rather than to a smaller one.

| Their surface | Ours | Standing |
|---|---|---|
| The on-call widget (their **nub**) | `src/widget/`, DEC-49 | **ahead.** 31 channels compared one by one; structural parity, and `widget:measuring` has no counterpart — their sequence is `setSize()` then `showInactive()`, which is exactly the failure our first-frame handshake exists to prevent. US-13 then fixed our own version of it: the pill used to arrive clipped by 49 px and settle in three steps. |
| Meeting detection | `core/domain/adHoc.ts` | **level.** Both detect « which application holds a microphone » rather than « is Teams running ». Ours carries a 25 s dwell, per-branch horizons, and excludes its own pid; six consecutive adversarial rounds were spent on the arbitration between the calendar's claim and the detector's. |
| Silence auto-stop | DEC-16, 75 s / 25 s past a scheduled end | **ahead.** Theirs is 15 minutes; ours is scheduled-end aware, and `graceFor` refuses to shorten on a *synthesised* end because an ad-hoc call has no calendar slot to be past. |
| Consent / telling the client | US-11, `src/widget/mention.ts` + US-19 | **behind in mechanism, level in outcome.** They run a native messaging host, a socket per user, a browser extension and a cross-machine `coordinated-consent-send` that posts into the meeting chat. DEC-49 says we never join the call, so ours is one press: the sentence on the clipboard, on screen to read out, and the press in the log. It claims only that the rep was *offered* the sentence. |
| The ✨ *Enhanced* recipe picker | US-8, `src/screens/review/RecipeSwitch.tsx` | **level, with one rule they do not have.** Two declared recipes and no rep-authored template (DEC-43), and the picker states **before the press** how many of the rep's corrections a rewrite discards. |
| Ask bar + suggested action | `Demander` + US-4 | **ahead on the thing that matters.** Theirs answers from the summary the model itself wrote, so a mistake in the summary becomes a mistake in the answer with nothing left to check it against. Ours answers over the stored transcript, requires a verbatim fragment per claim, verifies each one with the same `locateQuote` the gate uses, and refuses an answer with no citation. |
| `#` markers in a gutter | `CompteRenduDocument` | **level, arrived at differently.** Ours is a *typesetter*, not a markdown renderer, because VerySwing receives the string the rep read — a hidden marker would land in the CRM as literal pipes. Its one property, `serialize(parse(x)) === x`, is proved for every fixture. |
| Magnifier on the hovered line | `[source ▸]` | **ahead.** Theirs opens context; ours opens the stored turn, highlighted, and says « introuvable » when the quote is not in the record — which is the one sentence a general-purpose notetaker cannot say. |
| Sleep / lid-close handling | US-1, US-2, `PowerWatch` | **ahead.** Seven power events and a window `session-end`, with the interrupted recording named on resume. Round 32 then found the flush it does not wait for (R32-1), which is being fixed. |
| **Spaces, and a note somebody else can open** | nothing | **behind.** US-9, argued debt: it is a sync service, an identity model and a permission model, and this product has no server. Recorded rather than scoped. |
| **Shared with me** | nothing | **behind**, and the same answer as Spaces. |
| **Global chat across every note** | nothing | **behind.** US-5. Ours answers one meeting at a time, because a citation is verified against *a* transcript; across meetings it needs a corpus and a per-answer provenance model that does not exist yet. |
| Folders / *Add to folder* | nothing | **behind**, and deliberately: *Historique* is search over the log (DEC-25), not a filing cabinet. If a rep needs one, it is a story, not a gap. |
| Virtual camera (11 channels) | nothing | **behind, and not wanted.** It puts a camera device on the rep's machine so the call shows a Granola frame. DEC-49 says this product is invisible to the call. |
| Meeting-control banner (5 channels) | nothing | **behind.** Mute/leave/join pushed into the conferencing app, which needs the accessibility permissions and per-app automation DEC-49 rules out. |
| Screenshot attachment (2 channels) | nothing | **behind.** Would need a decision like DEC-37's: a screenshot of a client call is a different class of retained content from a transcript, and DEC-12 retains no audio. |
| Screen-share OCR | nothing | **behind.** US-12, argued debt — `initScreenShareContextOcr` is why their notes can name a figure that was only on a slide. Reading a client's shared screen is a VISION decision first. |

**What this table is for.** The four rows in bold are the whole remaining gap, and three of the
four are the same missing thing: a server. That is a product decision and not a story — DEC-28
says the first deliverable is a live demo against the public VSA sandbox, and nothing in the
gap list blocks it. The rest of the list is where the work has actually been: not matching
features, but building each one to a rule theirs does not have, and then finding out by
measurement where ours was the one that was wrong.

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

## Defects in flight — round 32

Measured against `df28300` in a pinned worktree. The review ended **NOT IMPRESSED**.

| | Finding | Lane | State |
|---|---|---|---|
| R32-1 | `before-quit` awaits a flush that has already been taken from it | `session` | in flight |
| R32-2 | « Remonter dans **du** compte-rendu », on six labels | `ui-read` | in flight — US-18 made it a **sixth** call site |
| R32-3 | `check:ports` cannot see `MailPort` or `CapturePort` | `checks` | in flight |
| R32-4 | `--motion-fast` is pinned by its mapping and not by its number | `checks` | in flight |

### R32-1 — the tail of every call closed by its window is lost, and US-1 made it worse

`dispatch(id, 'end')` fires `void this.#enhance(id)`. `#enhance` is `async`, so its body
runs synchronously to its first `await` — which is `await this.stopRecording(id)`, and
**evaluating that call runs `stopRecording`'s own body synchronously to its first await**,
having already executed `this.#recordings.delete(meetingId)`.

So one line later, `before-quit`'s own `await orchestrator.stopRecording(meetingId)`
returns at `if (!recording) return`. Measured, on the real `Store` and the real
`Orchestrator`, with a transcriber that flushes a tail segment inside `stop()` the way
`LocalWhisperSession.#shutdown()` and every REST provider do:

```
── onEnded injected: no
   transcriber flushed? true    tail segments in the log: 1
── onEnded injected: YES — what main.ts:1496 always does
   transcriber flushed? false   tail segments in the log: 0
```

`Outbox.settle()` then returns synchronously when nothing is in flight, so `app.quit()` →
`before-quit` again with `quitting === true` → `overlay.hide(); store.close()` land within
a few microtasks, while the local engine is still draining on a **thirty-second** budget.

On Windows — the primary platform — `window-all-closed` quits, so « get the app out of the
way at the end of a call » is a quit. `main.ts` states « `stopRecording` is awaited so both
providers flush ». It waits for nothing. The last utterance — `stopRecording`'s own docblock
calls it « the part with the next steps in it », and `GAP_FLUSH_MS` means up to three
seconds of held speech plus whatever is queued in the model — never reaches the log, so it
is missing from the transcript the compte-rendu is folded from, from what `[source ▸]`
reads, and therefore from what VerySwing receives.

**And `b2cc981` (US-1/US-2) made the Windows shutdown and « Se déconnecter » case strictly
worse than before it landed.** `session-end` moves the meeting out of `recording` first, so
`before-quit`'s predicate finds nothing and does not even `preventDefault()`:

```
── WITHOUT PowerWatch (pre-b2cc981) · session-end
   state at before-quit: ended   defers the quit? true
── WITH PowerWatch (HEAD) · session-end
   state at before-quit: ended   defers the quit? false   tail segments: store already closed
```

`PowerWatch.ts` claims « The flush still happens, on the way out or on the way back ». For
`session-end` there is no way back, and the way out no longer waits.

**Why nothing saw it.** `powerWatch.test.ts` models the quit path as
`liveIds().filter(recording).map(dispatch('end'))` and stops there — no `stopRecording`, no
flush — and it *asserts* that the quit path finds nothing, which is the defect written down
as the expectation. `signalWiring.test.ts` and `recording.test.ts` call `stopRecording`
directly on an `Orchestrator` constructed **without `onEnded`**, so `#enhance` returns on
its first line and the Recording is still there to flush: a fixture simpler than the
product (shape #5), on the exact axis that decides the outcome. Nothing in the repo boots
`main.ts`, and `scripts/e2e.mjs` ends its meeting through the UI rather than by quitting
during a recording.

**Acceptance.** One flush per recording, awaited by whoever needs it — the obvious shape is
that `stopRecording` memoises its own in-flight promise per meeting so a second caller
awaits the first rather than finding nothing, but drive it before choosing. `PowerWatch`'s
`session-end` path must leave `before-quit` something to wait for, or must do the waiting
itself. The proof is a test that **runs through `#enhance`** — an `Orchestrator` with
`onEnded` injected, which is the only configuration `main.ts` ever produces — and asserts
the tail segment is in the log after the quit path has finished; and it must be red on
today's code, at the boundary, not merely absent. Extend `scripts/e2e.mjs` if a quit during
a recording can be reached there: this is the one class of defect that only a booted
`main.ts` can see, and there are now two instances of it.

### R32-2 — one French string interpolated into two grammatical frames

`src/ui/ReadingColumn.tsx:98`:

```tsx
what={turn === 'up' ? `Remonter dans ${what}` : `Lire la suite ${what}`}
```

Every caller supplies the genitive, because that is what the *first* state needs:
`CompteRenduPane` « du compte-rendu », `SignalRail` « de la fiche », `Historique`'s four
`turnLabel`s « de la transcription », « de vos notes », « du compte-rendu »,
« de l'extraction ». Six labels. Driven on the shipped renderer:

```
── session screen        « Remonter dans du compte-rendu »
── Historique            « Remonter dans de la transcription »
── review gate, by hand  « Remonter dans le compte-rendu »   ← correct
```

The rep reads to the end of the compte-rendu on the session screen — four presses at
1280×800 — and the control under it turns into broken French. The gate, one click away,
writes its two labels by hand and both are right, so the same document on two screens
labels the same gesture two ways, one of them ungrammatical, on the most-pressed control in
three reading surfaces.

**Why nothing saw it.** `ReadingColumn` has **no test file**, and could not have one that
bites: jsdom measures every box as zero, so `above` and `below` are both false, `turn` is
`null`, and the control does not render. No stage reaches the `up` state —
`session-compte-rendu` photographs the pane at `scrollTop 0`. `--a11y` asks whether a
control *has* a name, never whether the name is French; `check:french` reads prose for the
straight apostrophe, and « de l'extraction » carries U+2019. Shapes #1 and #8 at once.

**Acceptance.** The component takes what it needs for both frames rather than one string
bent into two — two labels, or a noun plus its article, decided in the file that knows.
The gate's two hand-written labels are the reference for what correct reads like, and the
same gesture must not be named two ways on two screens. And **a stage has to reach the
`up` state**: press a `ReadingColumn` to its end and photograph the control, at both smoke
sizes, or this comes back.

### R32-3 — the two ports left outside `core/contracts/` are capture and mail

`check-ports.mjs` discovers ports from `electron/core/contracts/` only. `MailPort` is
declared in `modules/mail/OutlookMail.ts`; `CapturePort` in `modules/capture/index.ts`.
Measured, with a temporary mutation since reverted:

```
# a dead sendNow() on MailPort, implemented on OutlookMail:
node scripts/check-ports.mjs   → ports ok, 27 méthodes vérifiées
npm run check                  → twelve gates green
npm test                       → 1235 + 586 pass
# the same shape on CrmPort, for contrast:
node scripts/check-ports.mjs   → « CrmPort.closeSession n’est appelé nulle part »
```

Corroborating and already live: `CapturePort.running` is declared, implemented twice, and
read by nothing outside `modules/capture/`.

Not a live false green — `createDraft` is genuinely wired — but the guarantee is gone on
the two ports where it matters most. CLAUDE.md's own sentence is « every method on a port
declared in `core/contracts/` », and `MailPort`'s docblock says « one way to create a
draft, and no second method for anything else » while `Outbox`'s says « narrow enough that
it has no second verb to grow into a way of sending (HR-8) ». HR-8 is « never
`Mail.Send` ». Both are prose, and on this port the check that would hold them is not
looking.

**Acceptance.** Either every `export interface …Port` outside `core/contracts/` fails the
check by existing — which is the honest rule, and moves the two declarations — or they are
discovered where they live. Whichever: a dead verb on `MailPort` must fail, and a dead verb
on `CapturePort` must fail, and `CapturePort.running` is a real finding to resolve rather
than excuse. Drive both directions, as `check:ports` already does elsewhere: prose naming a
method must not satisfy it, and an ordinary respelling of a live call must not break it.

### R32-4 — the motion ladder is pinned by its mapping, not by its numbers

`tokens.test.ts` holds every `--motion*` rung to `<= 150ms` and pins
`durations.DEFAULT === 'var(--motion-fast)'`. So the *mapping* is pinned and the *number*
is not: setting `--motion-fast: 150ms` reverts the whole measured result of `c6ea550` with
every check green and every test passing.

US-3's own research is the evidence — Granola's twelve durations, the published standard's
100–160 ms band for press feedback — and it is committed in `docs/stories/motion-research.md`.
A ladder whose rungs can all collapse onto one value is one token edit from being the single
curve US-3 replaced.

**Acceptance.** The rungs are held *apart*, not just under a ceiling, and each is held to
the band the research gives it. Do not invent numbers: the file has them. A revert of
`--motion-fast` to 150 ms must be red.


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
| US-4 | The suggested next thing, on the note | `ui-session` | **done** — merged |
| US-5 | « Qu'est-ce que j'ai dit à Sodexial en juin ? » | `extract` | todo — **local, not a server story** (grilled) |
| US-6 | Sending the compte-rendu to someone who was not there | `crm-mail` | **half done** — `73edb2c` |
| US-7 | A first run that has already seen a meeting | `ui-onboarding` | deferred — the rep asked for this later |
| US-8 | The recipe is visible on the document, and changeable | `ui-review` | **done** — merged |
| US-9 | Spaces, and a note somebody else can open | — | **argued debt, not a story** |
| US-10 | The installer carries the demolished product's mark | — | argued debt |
| US-11 | Telling the client they are being recorded | `widget` | **done** — `c3f337c` |
| R32 | Round 32 adversarial review | — | **ran at `df28300` — NOT IMPRESSED, four findings above** |
| US-12 | What the shared screen says | — | argued debt |
| US-13 | The widget arrives by popping into existence | `ui-session` | **done** — `a4f35d9` |
| US-14 | The gate's page turn takes 434 ms | `ui-review` | **done** — `a511d30` |
| US-15 | Three dead declarations, one mask that snaps | `motion` | **done** — merged |
| US-16 | The harness compte-rendu is missing two constructs | `harness` | **done** — merged |
| US-17 | A page turn still moving 150 ms later is unmeasured | `harness` | **done** — merged |
| US-18 | Onboarding narrates a product two features old | `ui-onboarding` | **done** — merged |
| US-19 | The mention sentence belongs to the ESN | coordinator | **done** — `3609bb6` |
| US-20 | No stage presses US-11's control, so its card is unmeasured | `harness` | **next** |
| US-21 | A landmark that clips its content is unmeasured | `harness` | **next** |
| R32-1 | The quit awaited a flush it could not see | `session` | **done** — merged |
| R32-2 | A reading column said « Remonter dans du compte-rendu » | `ui-read` | **done** — merged |
| R32-3 | Two ports declared outside `core/contracts/` | `checks` | **done** — merged |
| R32-4 | `tokens.test.ts` pinned the mapping, not the numbers | `checks` | **done** — merged |
| | **The Granola pass — round 35** | | *the user: « on par with Granola »* |
| G35-1 | The window's blue chrome band | `ui-shell` | **done** — `75cf869` |
| G35-2 | Two document scales, eleven sizes under a comment saying five | `ui-read` | **done** — `75cf869` |
| G35-3 | Three competing containers on the day, seven on the slate | `ui-agenda` `ui-session` | **done** — `75cf869` |
| G35-4 | The splash overflowed its own window by 112×149px | `ui-onboarding` | **done** — `75cf869` |
| G35-5 | `bg-white/60`, the one surface colour no token named | `checks` | **done** — `75cf869` |
| G35-6 | The calendar held 320px while the titles truncated at 960×600 | `ui-agenda` | **done** — `75cf869` |
| G35-7 | Tailwind's own scales leaking past `theme.extend` | `checks` | in flight |
| G35-8 | No exit motion anywhere outside the widget | `motion` | todo |
| G35-9 | The Réglages sheet is a fixed 920×600 with no fade | `ui-reglages` | todo |
| G35-10 | Two oranges twenty pixels apart in the rail | `ui-status` | todo |
| G35-11 | Chips are `rounded-sm`; every reference chip is a pill | `ui-shared` | todo |
| G35-12 | The rail's five rows sit on two left edges | `ui-shared` | todo |
| — | A sliding thumb on `Segmented` | `motion` | **rejected — §6 allows 2–4px translate; the thumb travels ~80px, live during a call** |
| | **The simplicity pass — round 34** | | *the user, on the screenshots* |
| US-22 | The screen is named by what changed | `ui-agenda` `ui-history` | agenda half **done** — merged; history half in flight |
| US-23 | A caption only where the content cannot name itself | `ui-session` `ui-history` | session half **done** — merged; history half in flight |
| US-24 | Well is silent | `ui-status` | **done** — merged |
| US-25 | The product stops explaining itself during a call | `ui-session` | **done** — merged |
| US-26 | One filled control per list | `ui-agenda` | **done** — merged |
| US-27 | The session header says « recording » four times | `ui-session` | todo |
| US-28 | Réglages captions the pane with its own nav item | `ui-reglages` | todo — `--echo` ships; point it at `reglages` |
| US-29 | What happened last time, before the call | `ui-agenda` | **next** — grilled; exact `client_name`, fails closed |
| US-30 | `StatusControl`'s only remaining rendering is unmeasured | `harness` | todo |
| US-31 | The gate's prose is read twice, or not at the press | `ui-review` | blocked on R33-1 |
| US-32 | The manual draws over a past record | `ui-history` | assigned to the running lane |
| R33 | Round 33 adversarial review | — | **ran at `0f4a457` — NOT IMPRESSED, five findings above** |
| R33-1 | A rewrite that cannot run takes *Valider* away silently | `ui-review` | in flight |
| R33-2 | The mention control eats the refusal it yields to | `widget` | **done** — merged |
| R33-3 | The sleep notice navigates off a live recording | `session` | **done** — merged |
| R33-4 | `check:surfaces` visited 20 of 52 invoke channels | `checks` | **done** — merged |
| R33-5 | The pill asks twice when the meeting carries marks | `widget` | **done** — merged with R33-2 |
| | The two found while merging, not by a round | | |
| — | The chip's tests waited for the wrong read | `ui-session` | **done** — `3792be1` |
| — | `meeting:get` shipped an outbox nothing read | coordinator | **done** — `a83c42c` |

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

### US-13, as shipped — and the trap it walked into on purpose

`a4f35d9`. Three things are worth keeping.

**One overshoot, derived rather than borrowed.** `--ease-out` is
`cubic-bezier(0.22, 1, 0.36, 1)`; the overshoot is `(0.22, 1.5, 0.36, 1)` — the same control
abscissae, one nudge past the endpoint and back. `--ease-in` is that curve rotated and this
is that curve overshot, so the file still holds **one** piece of taste and two derivations
of it, which is the argument `--ease-in`'s own comment makes. A competitor curve was not
lifted wholesale. Peak progress 1.0800, so from `scale(0.92)` it is 1.54 px on the pill's
240 px card and 2.18 px on the panel's 340 px one, above 1 from 39 ms to 145 ms of the 150.
Measured against `y1` from 1.2 to 1.8: 1.2 and 1.3 are sub-pixel on the pill (0.24 px,
0.57 px) and 1.8 overshoots 3.4 px, which over a video call is a bounce rather than a settle.

**It broke a measured check, and that was the right way to find out.** `widget-ouvert`
reported the chevron at **23.26 px** — a WCAG target-size failure on a control that is 24 px
at rest, caught mid-arrival. The fix is not to loosen `--targets`: a control genuinely 23 px
at rest is exactly what that check exists to catch, and forty of them shipped once. A
general `settled(page)` gate runs before every measurement instead, bounded and silent so a
page that legitimately never settles still gets measured. Same family as the trap DEC-50
names — `getBoundingClientRect` includes transforms — reached from the other side.

**The self-test grew a twelfth probe that must stay silent.** DEC-50's arrival is an
element whose opacity is 0 at one end, riding a curve that leaves the allowed set — which is
exactly the shape `--motion`'s direction rule is built to report as a blink. « les douze
attaques signalées, les trois dernières restées muettes. »

114 stagings now, 57 screens × 2.

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

## US-11 — « est-ce que j'ai le droit d'enregistrer ce client ? » — **done**, `c3f337c`

**Lane** `widget` · **the one with a business consequence.**

Shipped: one press on the pill puts the sentence on the clipboard, draws it so the rep can
read it out instead, and writes the press into the meeting's log — reaching `meeting:mark`
and no other channel, which `Widget.test.tsx` asserts as a *set* because « it sends nothing »
is a claim about everything that is not there. 240 → 272 px of pill, measured. It found the
defect it would otherwise have produced: `copyText` is an async clipboard permission check,
so « press the control, press *Terminer* » lands `widget:leave` between the press and the
card, and a 145 px card mounting mid-fade asks for the `widget:resize` `Overlay` refuses —
the ~20 px slide already recorded in this repo. Two things it left: the sentence is not yet
configurable (**US-19**), and no harness stage presses the control, so the card is visited by
none of the nine measured checks on any of the 114 stagings (**US-20**).

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

## US-18 — « on m'a dit trois choses et il s'en passe six »

**Lane** `ui-onboarding` · `src/screens/Onboarding.tsx`

Measured, on the shipped file:

```
grep -niE "pastille|widget|par-dessus|flottant|fenêtre|planifi|détect|notification|Teams|Zoom" \
  src/screens/Onboarding.tsx     →  nothing
```

Three surfaces the product has gained since that screen was written are absent from the one
screen whose entire job is « voilà ce qui se passera ».

**The widget.** Beat 1 of step 3 says « L'en-tête affiche alors deux barres de niveau » — the
header of the window the rep is about to leave. What actually happens on *Enregistrer* is a
frameless, transparent, always-on-top card at the `screen-saver` level, on every Space, over
the face of the person on the call, carrying `setContentProtection(true)` — **with no taskbar
entry and nothing to alt-tab to**. It is the most visible thing this product does and the one
surface a rep has no way back into. Onboarding does not name it once. `overlayPlacement.ts`
already treats a saved origin as « a request, never an instruction » precisely because this
window is unrecoverable; a rep who does not know what it is has the same problem on the first
call.

**The unscheduled-call detector** (`core/domain/adHoc.ts`). Twenty-five seconds of a held
microphone raises an **OS notification** whose click navigates the rep's window (DEC-46).
Beat 1 describes only the manual route — « ou avec "Démarrer une réunion" si elle n'y est
pas » — which is exactly the case the detector now covers, so the detector arrives as the app
doing something nobody mentioned, during a client call, from an app onboarded once.

**The mention sentence** (US-11, `src/widget/mention.ts`) — this product's whole answer to
« ai-je le droit d'enregistrer ce client ? », and it lives on the pill the rep has not been
told about.

That is shape #7 on this repo's list: prose describing what the code does not do — on the
screen written so that the first real call is unremarkable.

**Acceptance.**

- Step 3 names the pill **before** the first recording: where it appears, that it is the
  meter and the controls during the call, that it is kept out of a screen share, and the two
  ways out of it (*Ouvrir Sillage*, *Terminer*). A window with no taskbar entry needs its
  exits stated once, in the rep's words.
- Step 3 names the detector: what triggers it (an application holding the microphone), that
  it is an **offer** and never a recording, and that ignoring it costs nothing.
- The mention sentence is named where the pill is named, in one clause — not as a fourth
  beat.
- **Still not a gate, and still not a wall.** *Continuer* stays live on every step and every
  exit records `onboarding:seen`. A longer step 3 must be *measured*: drive the onboarding
  stages at 1280×800 **and** 960×600 with `--prose --scrollers --targets --geometry --a11y`.
  If the step now scrolls it wears `ReadingColumn` or says how much is left; a first-run
  screen that hides its own last beat behind a hard edge is exactly the defect
  `ReadingColumn` exists to end, on the screen a rep sees once.
- Nothing claims a permission or a health the app has not measured — the screen's own
  existing rule, and step 2 is untouched.
- `scripts/e2e.mjs`'s « the empty day can replay first run » and « first run is not shown
  twice » must still pass.

**Out of scope** — a fourth step (three is the count the progress dots draw, and
`--contrast` has already been through those dots once); a *picture* of the pill, because an
image of a surface is a second place it is described and it goes stale; any change to when
permissions are asked for.

## US-19 — the sentence is the ESN's, not ours — **coordinator, not a lane**

US-11 shipped `MENTION_SENTENCE` as a constant in `src/widget/mention.ts`. The wording a rep
reads to a client is a legal matter and belongs to the ESN. DEC-34 says every setting is
declared, stored and rendered, and a sentence hard-coded in the renderer is the
`SILLAGE_STT_OFFLINE_ONLY` mistake DEC-37 has already paid for once.

It is **one unit and not two**, which is why it is not fanned out: the contract, the channel
and the Réglages field have to land together or `check:surfaces` correctly fails a
`settings:setMentionSentence` nothing under `src/` calls — declared, and unreached.

`core/contracts/mention.ts`; `mentionSentence` on `SettingsSnapshotSchema` and on
`widget:state`, because the widget does not call `settings:snapshot`; the KV key beside
`settings.offlineOnly`; a textarea in Réglages wearing `.measure` on the element that holds
the prose. An empty setting falls back to the default and says so — a blank sentence is a
control that copies emptiness. And there is no second field for « le client a accepté »: the
product knows what it handed over and nothing about what was said.


## US-21 — a landmark that clips its content is invisible to all nine checks

**Lane** `harness` · found by US-18 while fixing US-18, which is the honest way these arrive.

`--scrollers` exempts landmarks, and the reason written beside the exemption is sound as far
as it goes: « a landmark *is* the page's own scroll region ». But the landmarks in this app
are not the window's scroll — they are **inner** scrollers wearing a landmark role.
`<main className="overflow-y-auto">` is a clipped box with a hard edge, and on macOS the
scrollbar is not drawn until something moves.

Measured, on first run's step 3 before US-18 rewrote it: **54 pixels behind a hard edge at
960×600**, no mask, no page turn — and `--scrollers` printed « rien de caché ». Reverting
US-18's `ReadingColumn` reproduces it at **389 hidden pixels**, still green.

That is the third instance of one shape in this check's own history. It once scoped itself to
`main *, aside *, dialog *` and visited **zero** elements on *Historique*, which has no
landmark, printing « rien de caché » over four unmeasured panes; widening to `#root *` fixed
the children and left the landmark itself exempt. `CLAUDE.md` already says of that round that
« a check that measures nothing is worse than no check ».

**Acceptance** — a landmark that hides its own content is measured, and the exemption becomes
a *declaration* rather than a class of element: the window's own scroll is exempt because the
browser draws it; a box with `overflow` and a fixed height is not, whatever role it wears. The
existing vocabulary is already there — `data-scrolls` declares a box that holds more than
itself by definition, and `ReadingColumn` is the component that says how much is left. Drive
both directions: US-18's step 3 must pass, its pre-US-18 form must fail, and no existing stage
may go red without a stated reason. `onboarding-suite` is the stage that closes it for one
screen; the other landmark-scrolled screens are still unmeasured on this axis, so say which
ones the widened check newly visits.

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

## US-20 — no stage presses US-11's control, so its card is unmeasured

**Lane** `harness` · `scripts/harness/shot.mjs`

US-11's button is on the collapsed pill, so `widget`, `widget-ouvert`, `widget-refus` and
`widget-arret` all measure it — 24×24, named, contrast fine. The **card** it opens is measured
by nothing: its 260×145 box, its dismiss control and its 39-character lines were driven only
by the implementing agent's own Playwright script, which is not a gate. Nine measured checks,
114 stagings, and the newest surface in the product is visited by none of them.

This is the `widget-sortie` lesson said again: no stage emitted `widget:leave`, so
`.widget-leaving` was invisible to all of them and shipped on the wrong curve.

**Acceptance** — a `widget-mention` stage shaped like `widget-refus`: press
« Prévenir le client de la transcription », wait for `getByRole('status')`, and assert the box
is not 1×1 and that `closest('[data-card]')` is non-null — because a card that forgot
`data-card` draws a dismiss button the pointer goes straight through into Teams. Then
`smoke.mjs` runs the nine checks on it at both sizes. The staging count moves from 114.

---

# The simplicity pass — round 34

Not an adversarial finding. The direction came from the person this is being built for, on
the screenshots, and it is one sentence in three parts: **focus on simplicity, avoid obvious
labels — « calendar? we already know it's one » — and put the priority on what should be
visible directly.**

It is right, and it is measurable on the home screen as shipped today. Above the fold,
1280×800:

| What the eye lands on, in order | What it is |
|---|---|
| « Calendrier », serif, 42 px, the largest thing on the screen | the name of the furniture |
| « DIMANCHE 13 SEPTEMBRE », in the header | the date |
| « Tout fonctionne », a filled pill, top right | nothing is wrong |
| « Dimanche 13 septembre », 170 px lower | **the same date, again** |
| six outlined buttons of identical weight | four *Ouvrir*, two *Enregistrer* |

The rep opened this app at 14:30 because a client is on the line. The live call is the
fourth-strongest thing on its own screen, and the two strongest are a noun that never changes
and a date printed twice.

The same disease, worse, one screen over: the session pane carries « COMPTE-RENDU » over the
compte-rendu and « SIGNAUX » over the signals, the client's name appears **five times** above
the fold, and two permanent sentences explain the product's own rendering conventions to a rep
who is on a call.

**The rule these five stories share, and it goes in CLAUDE.md:**

> A pane is named by its content. A caption earns its place only where two things on the same
> screen could otherwise be confused — and the strongest thing on a screen is the thing that
> *changed*, never the thing the screen always is.

That is a rule with a live exception on both sides, which is why it is worth stating rather
than a purge: *Historique*'s « Mes notes » and « Extraction » sit side by side and are both
plain French prose with no shape of their own, so they keep their captions; *Réglages*' eleven
section headers are a long form's navigation and keep theirs. What goes is every caption over
a box that already announces itself — a transcript with timestamps and speaker names, a
document whose first line is its own `#` heading, a rail of seven labelled slots.

## US-22 — the screen is named by what changed

**Lane** `ui-agenda` · `src/screens/Agenda.tsx`, `src/screens/Historique.tsx`

`Agenda.tsx:367` draws `<h1 class="font-display text-display">Calendrier</h1>` and the date
beside it, and `DayPane` draws the same date again 170 px below. Delete the h1; the day
becomes the page's own title, drawn once. The back-link « ‹ Calendrier » on the other screens
stays — a destination needs a name, a page you are standing on does not.

*Historique* has no natural « what changed », so its h1 becomes the one thing on that screen
that is information: the record count and the active filter (« 47 appels · 90 jours »),
recomputed as the chips change. `scripts/e2e.mjs` waits on « Historique » in two steps and
must be moved with it.

**Acceptance** — measured, both sizes: no visible string is drawn twice on either screen, and
the tallest text box above the fold is the date (agenda) / the count (historique). A probe
that normalises visible text and counts repeats is the evidence, and it belongs in `shot.mjs`
as a tenth check — `--echo` — because « the same sentence twice » is exactly the class of
defect a screenshot review cannot see and this repo has now shipped on its home screen.

## US-23 — a caption only where the content cannot name itself

**Lane** `ui-panes` · `CompteRenduPane.tsx`, `SignalRail.tsx`, `Historique.tsx`

Delete four: « Compte-rendu » over the typeset document (its first line is `# <objet>`),
« Signaux » over seven labelled field boxes, and *Historique*'s « Transcription » and
« Compte-rendu ». Keep « Mes notes » and « Extraction » for the reason above, keep
« Passées » (it separates two lists of identical shape on one screen) and keep « En attente de
validation » (it carries a count and a link — it is doing work, not naming furniture).

`SectionHeader` stays; what changes is who calls it. Add the rule to its docblock so the next
pane does not reintroduce one.

**Acceptance** — the four are gone from the rendered accessibility tree, the three kept are
still there, and the vertical space recovered is reported per screen at both sizes. Three
stages wait on « Compte-rendu » in `shot.mjs`.

## US-24 — well is silent

**Lane** `ui-status` · `src/screens/StatusControl.tsx`

« Tout fonctionne » is a filled pill in the header of every screen, permanently, saying that
nothing is wrong. Its own docblock already contains the argument for this story: *« it says
nothing before it knows anything … the header holds the space empty instead »*. Silence when
the answer is good is the same gesture one step further, and it makes the degraded case — the
one that matters, on the primary platform, thirty seconds before a client joins — the only
thing that ever appears there.

Nothing else changes: the tone, the wording and the click-through to *Réglages → Connecteurs*
stay exactly as they are for `degraded` and `down`, and the full board stays in Réglages.
DEC-32 is untouched — this is still one general status and still only the three required
subsystems. And it does not weaken DEC-45: what reassures a rep that capture works is the
input meter during the call (DEC-38) and the dry run before it, not a badge.

**Acceptance** — `ok` renders nothing at all (not an empty box with padding: measure it), the
degraded and down cases are pixel-identical to today, and `StatusControl.test.tsx`'s four
« Tout fonctionne » assertions are rewritten to assert absence rather than deleted.

## US-25 — the product stops explaining itself during a call

**Lane** `ui-session` · `CompteRenduPane.tsx`, `SignalRail.tsx`

Two permanent sentences on the screen a rep has open while a client is talking:

- « Les marques # ## – ∗∗ font partie du texte : VerySwing reçoit exactement ce qui est
  affiché. » — a manual for our own typesetting convention. It is a real promise and it is
  needed **once**, at the moment the rep can act on it: the gate, where the document is
  editable and where the press that sends it to VerySwing lives. Move it there; do not delete
  it.
- « Rien ne migre dans vos notes. » — a statement about a thing that does not happen. US-18's
  onboarding now names the rail and what it does; that is where it belongs, and it is already
  said there.

« Lecture seule — corrigez-le à l'étape « Relire et valider » » **stays**: it names where the
action is, which is the opposite of explaining a convention.

**Acceptance** — both strings gone from the session screen, the markers sentence present at
the gate, and `session-output.test.tsx`'s two assertions moved rather than dropped.

## US-26 — one filled control per list

**Lane** `ui-rows` · `src/screens/agenda/DayPane.tsx`, `PendingGates.tsx`

Six outlined buttons of identical weight on the home screen, and the rep's next action is
exactly one of them. The live call — the row already saying « En cours » — and the rows saying
« À valider » are the two things a rep acts on; they are today drawn in the same ink as a
17:30 invite four hours away.

One filled control per list, on the row the app believes is next; every other row keeps the
quiet one. This is a hierarchy change and not a new control: nothing gains or loses an
affordance, and *Démarrer une réunion* in the header stays what it is.

**Acceptance** — driven, both sizes: exactly one filled control in the day list, and it is on
the live row when one exists and on the earliest `à valider` otherwise. The `agenda`,
`agenda-liste` and `agenda-semaine` stages photograph it.

## US-27 — the session header says « recording » four times

**Lane** `ui-session` · `src/screens/Session.tsx` (header only) — **not yet assigned**

The screen a rep has open *while the client is talking*, measured at 1280×800. Its header
carries, left to right: a back link, an orange dot, the word « ENREGISTREMENT », a running
clock `00:05:00`, a live two-channel meter, the objet, the account, the word « Modèle », a
two-option segmented control, and *Terminer*. Ten things, and four of them say the same
thing — the dot (VISION.md §6 gives orange exactly one meaning: armed or recording), the
word, the clock that is counting, and the meter that is moving.

The dot and the clock are enough, and the meter is the one that is actually *load-bearing*
(DEC-38: proof of life is the instrument, not a word). « Modèle » goes for the same reason
« Compte-rendu » goes in US-23: the two options beside it are named « Prise de besoin » and
« Libre », which is what a recipe picker looks like.

Do not touch the meter, the clock's format or *Terminer*. This is the one screen where a
removal that turns out to be load-bearing costs a rep the call they are on.

## US-28 — Réglages captions the pane with the nav item it is under

**Lane** `ui-reglages` · `src/screens/Reglages.tsx` — **not yet assigned**

The left rail has « Connecteurs » selected, in brand blue, with its count beside it. Three
hundred pixels to the right, the pane opens with « — CONNECTEURS ». The same word, twice,
on one screen, one of them naming the thing the rep just clicked to get there.

This is the screen US-23 exempts, and the exemption still holds — *Réglages*' section
headers are a long form's navigation and « REQUIS » / « FACULTATIFS » are doing real work.
What does not is the pane-level caption that restates the selected rail item. Eleven
`SectionHeader` call sites live in this file; the rule is the one in CLAUDE.md, applied per
call site rather than to the file.

**This story should be found by `shot.mjs --echo` (US-22) rather than by this paragraph** —
it is a visible string drawn twice on one screen, which is exactly what that check measures.
If `--echo` does not report it on the `reglages` stage, the check is wrong before the screen
is: fix the check first.

## US-29 — what happened last time, before the call rather than after it

**Lane** `ui-agenda` (after US-22/US-26 land) · **not yet assigned** · **and a row my own
parity table missed**

The direction was « priority on what feature should be visible directly ». This is the
answer, and probing Granola again is what surfaced it: their product is organised as
**avant / pendant / après**, and the *avant* is a **Brief** — who is on the call, and what
was said last time. Our table has eighteen rows and none of them is this. We have the
« pendant » (the widget, the meter, the detector) and the « après » (the gate, the CRM, the
draft). Before the call we show a time, an objet and two names.

For a rep at an ESN the question before picking up is not « who is this ». It is **what did I
promise last time, and did it happen**. That is the one thing they will be asked in the first
thirty seconds, and it is the thing this product already knows better than Granola can:

- `HistoryRecord.fields` — each with its cited span and a measured confidence (DEC-21)
- `HistoryRecord.intents` — **what became of each**: the VerySwing task, its remote id, the
  Outlook draft, and whether the push settled
- `HistoryRecord.marks` — what the rep themselves flagged during the call
- `meetingAnchor` — when it was

So the line under a calendar row for a client already met reads from the record, not from a
model: « 09/09 — 3 CV avec TJM avant vendredi · tâche VerySwing créée ». Granola's brief is
prior discussion context; ours can say **whether the promise was kept**, because we are the
thing that made it.

**Four rules, and each is a decision rather than an implementation detail.**

1. **The brief is made of what the rep confirmed, never of what the model proposed.** Only a
   meeting that reached the gate and was validated contributes a sentence: at that point the
   text is the rep's own, because DEC-4's one confirmation is exactly where it stopped being
   the model's. A call that never reached the gate contributes its date and its marks and
   nothing else. This is what keeps DEC-21 intact — there is no `⚠ faible` on the agenda,
   because nothing unverified is drawn there, and a confidence mark on a row where the rep
   cannot follow a citation would be a claim with no way to check it.
2. **Deterministic halves stay deterministic** (DEC-7). The date, the intent states and the
   client's name come from the store. Nothing here calls an LLM, and no new extraction runs.
3. **It writes nothing and confirms nothing** (DEC-25) — a read over the log, like
   *Historique* and like *Demander*.
4. **Absent, not empty.** A first call with a new client has no brief and draws no box. An
   « aucun historique » caption on nine rows out of ten is the noise round 34 exists to
   remove, and it would be the first thing to reintroduce it.

**Acceptance** — driven, both sizes: a row for a client with a validated past call carries
one line; a row for a new client is pixel-identical to today; the line never wraps past the
`.measure` ceiling; and `--echo` stays green, because the brief must not restate the objet
that is already on the row (`meetingHeading` already strips the client's name for exactly
that reason, one rule up). The fixture has to grow a second call for one of its accounts —
`bridge-stub.mjs` stages five clients and the harness fixture test will hold the new record
to the same clock and density rules as the rest.

**Out of scope** — anything cross-meeting that needs a server (US-5, US-9). This is one
account's own history on this machine, which is why it can ship.

---

## Defects in flight — round 33

Round 33 ran pinned to `0f4a457`, in its own worktree, and ended **NOT IMPRESSED** with five
findings. Its baseline was identical opening and closing, and its four source mutations were
reverted byte-for-byte. Two of the five are in code merged this session.

It also cleared a long list explicitly — US-19's 400-character ceiling on the always-on-top
window (measured at 960×600: 260×145 → 260×275, the pill held at the bottom of the frame),
US-11's channel set (the press reaches `meeting:mark` and `widget:resize` and nothing else),
US-15's resting mask (0 differing pixels), US-17's `pressAndSettle`, US-16, `fc9c314` in both
directions, and US-18's six claims one at a time. Do not re-measure those.

### R33-1 — a rewrite that cannot run takes *Valider* away, says nothing, and gives it back over the document it promised to replace

**Lane** `ui-review` · `src/screens/Review.tsx` · **blocked** until US-23/US-25 land — another
agent holds that file.

Press *Réécrire avec « Compte-rendu libre »* on a machine whose model key has expired. The
handler answers `changed: true` and fires the run without awaiting it; the run finds no
recipe; the gate resets its coverage. Measured on the shipped renderer:

```
avant : valider=true   puce « Modèle : Prise de besoin commercial ▸ »
après : valider=false  remède « Lire la suite du compte-rendu »
        phrases sur la réécriture : []
        tête du document : inchangée
ré-armé après 5 tours de page (8 à 960×600) : valider=true
        puce « Modèle : Compte-rendu libre ▸ »,  document toujours l'ESN
```

The rep read « La validation reprendra dès que le nouveau compte-rendu sera prêt », pressed
once, paid five to eight page turns, and got the one irreversible press back over a document
the screen had just told them was being replaced — under a chip naming the recipe that did not
run. Nothing on the open gate says so.

**Re-derive the mechanism before fixing it.** The round was pinned to `0f4a457` and its (a)
names a silent return in `Enhancement.ts`; at the current tip that path calls `#deferred.add`,
records `enhancement.deferred` and calls `#announce`. So the question is not « does the main
process know » — it does — but **whether an open gate ever learns**, and the round's own
reading is that `rewriting` is drawn only in the `!open` branch and further gated on
`state === 'extracting'`. Measure that at the tip. The harm was driven and stands either way.

**Three coverage holes underneath it**, all worth their own line: `Review.test.tsx`'s two
`regenerating: true` tests both make a panel arrive or close the gate, so the silent case is
never left silent; jsdom measures every box as zero, so `below` is null and *Valider* is armed
unconditionally — the withdrawal is structurally invisible to all 646 renderer tests; and
**no stage presses the picker or even opens it**, so US-8's panel — 230 px, three `.measure`
paragraphs, two buttons, on the DEC-4 screen — has been visited by none of the ten checks on
any staging. The fixture cannot produce the input either: `bridge-stub.mjs` answers
`regenerating: false` for every recipe change, including the one the shipped handler calls
changed. A fixture that cannot exercise its property, for the eighth time in that file.

### R33-2 — the new control on the pill eats the refusal it is documented to yield to

**Lane** `widget` · `src/widget/Widget.tsx:457`

`announce()` opens with `setSaid(null)`. Sixty lines below, the render carries the precedence
and implements it correctly — `said?.problem !== true && mention !== null` — under a comment
saying « **a refusal outranks it** … the mention is one press away from being asked for again,
so it is the half that yields ». The guard can never fire for a refusal that existed before
the press, because the press deletes it first. Verified in the shipped source, not only in the
round's driver.

```
après « Marquer » (refusé)      refus visible : oui   carte phrase : non
après « Prévenir le client »    refus visible : NON   carte phrase : oui
```

A rep marks a moment at minute 40, the write is refused, the card says so — and their next
press, on a button 26 px away, deletes that sentence. The moment they marked is the one they
will go looking for at the gate; it is not there, and the only thing that said so was removed
by a gesture that had nothing to do with it. Verbatim the harm `Refus` was added to end,
reintroduced by the control added beside it.

Second half, same file: two presses whose first log write is refused write **two** rows for
one sentence and report the refusal nowhere, because press 2's card replaced press 1's.

### R33-3 — the sleep notice navigates off a live recording, and offers what the product refuses

**Lane** `session` · `electron/app/session/PowerWatch.ts:233`, `main.ts`

`notification.on('click', () => deps.onOpen?.(meetingId))` closes over the *interrupted*
meeting id with no re-check, and `session:open` is an unconditional `setRoute`. Driven on the
shipped `watchPower` over a real `Orchestrator`: call A, suspend, resume, notice raised and
left unclicked, call B started, then the click — `états en direct ["ended","recording"]`,
`onOpen a reçu ["m-A-sodexial"]`.

A rep clearing their notification centre during the 15:05 call is thrown off the live call's
notepad onto a finished meeting, under a notice inviting them to « démarrer un nouveau »
enregistrement which the product refuses twice over (`start` is illegal from `ended`, and the
one-recording-at-a-time guard refuses *Démarrer une réunion*). DEC-26's dead control, on the
second of exactly two things in this product that navigate without a press inside the window.

Round 32 noted this undriven; it is driven now.

### R33-4 — `check:surfaces` visits 20 of the 42 invoke channels, and `review:confirm` is not one of them

**Lane** `checks` · `scripts/check-surfaces.mjs:495`

`RESPONSE_SCHEMA` is `/response:\s*([A-Za-z0-9_]+)/`, so a channel written
`response: z.object({ … })` captures the identifier `z`, resolves to nothing, and is skipped
**in silence**. Same for a `z.discriminatedUnion`, a `z.record` or a type alias. The pass line
reports « 132 champ(s) de réponse », which reads as coverage.

```
canaux invoke portant une réponse         : 42
canaux dont le schéma est résolu (mesuré) : 20
jamais visités : … review:confirm · widget:state · meeting:recipe · health:snapshot …
```

Nothing false is green behind it today — the round checked all sixteen inline channels by
hand. What it costs is the next one: `review:confirm`, the only thing in this product that
writes into a client's CRM, and `widget:state`, which US-19's `mentionSentence` rides on, are
outside the only rule in the repo that asks whether a shipped field has a reader. And
`meeting:recipe.state`, added by US-8 this round, is already a declared response field with no
reader that the check cannot see. A dead field planted in an inline response passes, exit 0.

Its self-guard refuses to measure *nothing* and nothing asks whether the number it reports is
the number of fields that exist. Shape #3 at half strength, inside an instrument written to
close shape #4.

### R33-5 — the pill still asks twice when the meeting already carries marks

**Lane** `widget` · `src/widget/Widget.tsx:287` · fold into R33-2

`loadedMarks` is applied in a `useEffect`, which runs *after* `Frame`'s measurement
`useLayoutEffect` in the same commit, so the pill measured for the first `widget:resize`
carries a mark button with no count. Measured: `308×78` revealed, `313×78` 160 ms later — 5 px
wide, 2.5 px of sideways drift, over the face of the person on the call. With `marks=0` there
is exactly one ask.

Small, and it is the last one: CLAUDE.md's « 3 asks → **1**, at the right size » is true only
of a meeting with no marks, which the crash-recovered and rehydrated cases are not.
`widget-entree` reads `window.__entree[0]` and never reads `__entree.length` — an assertion
about the first ask cannot tell one ask from two, which is the converse of the sentence in
`Overlay`'s own test docblock.

## US-30 — the only rendering `StatusControl` has left is measured by nothing

**Lane** `harness` · `scripts/harness/shot.mjs` · **not yet assigned**

US-24 made the header silent when everything is up, which is right and which had a
consequence its own agent reported rather than hid: **no stage stages a degraded required
connector**, so every staging renders the `ok` case — and the `ok` case is now *nothing*. The
control's degraded and down renderings, the only ones left, are visited by none of the ten
measured checks at either size.

The gap pre-existed — every stage was `ok` — and US-24 took it from « one of two renderings
unmeasured » to **all of them**. Measured by hand instead, which is exactly what a stage is
for: 128.9 × 28.6 (clears 24×24) and the label at 4.56:1 on the chip, both sizes.

**Acceptance** — a stage with a required connector `degraded` and one with it `down`, and the
ten checks run on both at both sizes. `capture` degraded is the honest one to stage: DEC-45
says a missing channel is `degraded` and never `down`, and the sentence names which side.

## US-31 — the gate's prose is read once at the top or once at the decision, never twice

**Lane** `ui-review` · `src/screens/Review.tsx` · **not yet assigned, and blocked on R33-1**

Proposed by the agent that landed US-25, after measuring the gate it had just changed. Three
muted paragraphs sit above the first heading of a 2 647 px column: the markers legend, « Les
corrections faites à droite vont dans l'opportunité… », and the rail's foot paragraph. A rep
meets roughly ninety words of instruction **before** the document and none of it again at the
press.

Neither paragraph should be deleted — both say what *ships*, which is the gate's whole job and
the thing DEC-4 exists to protect. What is wrong is placement. Whatever is about *what ships*
belongs immediately above *Valider*, where `reassurance` already lives; what stays at the top
is only the gutter legend, because that is the one sentence explaining something visible in
that exact spot.

**Blocked on R33-1**, which holds `Review.tsx` and is changing what the gate says when a
rewrite does not run — two stories moving the same prose in one file is a merge conflict for
no reason. And measure the arming guard either side: moving content between two measured
columns is the arithmetic this repo has already been wrong about three times.

## US-32 — one more caption, on the surface that cannot act on it

**Lane** `ui-history` · `src/screens/Historique.tsx` · **assigned to the running `ui-history`
agent by message**

`CompteRenduMarkersNote` turned out not to be an inherited default but three explicit call
sites. US-25 deleted the session one and pinned the gate's; the third draws the typesetting
manual over a **past** record in *Historique*, which is as read-only as a surface gets —
nothing there can be corrected and nothing there ships to VerySwing.

## US-33 — the other notification has the same stale id, one caller over

**Lane** `session` · `electron/app/main.ts` (`announceArmed`), `scripts/e2e.mjs` ·
**not yet assigned**

Found by the agent that fixed R33-3, in the neighbouring caller, and correctly left alone
because the arming path was flagged sensitive. Verified on the tree: `announceArmed` closes
over `meetingId` and calls `focusMainWindow(id, broadcast)` at the click with no re-check —
byte-for-byte the shape R33-3 just replaced with `clickTarget()` in `PowerWatch`.

**Why it is not already the same defect, and why it still is one.** Arming is refused beside
a live recording (rounds 29 and 30 closed that), so the *raise* is safe. What is not refused
is the rep starting an **unrelated** meeting after the notice is up: `armed` is not
`recording`, so `dispatch`'s one-recording-at-a-time guard does not stop *Démarrer une
réunion*. 14:55 the calendar arms the 15:00 invite and the OS says so; 14:56 the rep takes an
unscheduled call instead; 14:58 they clear their notification centre and are thrown off the
live recording onto the armed meeting's screen.

DEC-46's whole weight is that these two notifications are the only things in the product that
navigate without a press inside the window, and that this is rare and always welcome. One of
the two now re-asks at the click; the other does not.

**The second half, and it is the reason to do both together:** there is **no e2e coverage of
either notification's click**. R33-3's guard and `focusMainWindow`'s `null` branch are held by
a unit test and a source read, and its own fourth revert check is the demonstration of why
that is thin — spelling the broadcast unconditionally
(`broadcast('session:open', { meetingId: meetingId ?? '' })`) leaves **every test in
`powerWatch.test.ts` green** while the renderer routes on the navigation that was withheld.
`tsc` cannot hold that either. A step that seeds a suspend-interrupted meeting, starts a
second recording, fires the click and asserts the route did not move is the real measurement.

**Acceptance** — `clickTarget`'s shape in `announceArmed`, one predicate shared by both
notifications rather than two that can drift, and the e2e step above. The refusal keeps
DEC-26: a click that does nothing is not a dead control here, because the notice is a
statement and not an offer — but say what the sentence should be if it names a control at all.

## US-34 — the compte-rendu says its two most operative sections twice

**Lane** `extract` · `electron/core/contracts/recipes.ts`, `modules/extract/prompt.ts` ·
**not yet assigned** · found by `--echo` on its first run, and verified by hand

`--echo` reported « prochaines étapes » three times on the `review*` stages. Two of them are
**inside one compte-rendu**. I checked it against CLAUDE.md's record of the doubled-heading
defect and this is *not* that regression: the collision was real, it was fixed by demoting the
appended recap, and `compteRendu.test.ts:61` documents the fix. The fixture is faithful and the
product really does write both:

```
## Prochaines étapes            ← the model's narrative section (COMPTE_RENDU_SECTIONS)
Envoi de trois CV avec les TJM associés avant vendredi, la validation achats en copie…

### Prochaines étapes           ← the appended field recap, under « Éléments retenus »
- Envoyer 3 CV avec les TJM associés — Julien Marchand — avant vendredi
```

Same for « Objections et points de vigilance ». Different heading levels, different parents,
so nothing is broken — and the rep still reads the same commitment twice under the same name,
once as prose and once as a bullet, and **VerySwing receives both** because it receives the
string the rep read (DEC-44).

**This is a decision, not a patch, which is why it is a story and not a defect.** Both halves
have a reason to exist: the narrative section is what makes the document read as a report
(DEC-44's register), and « Éléments retenus » is the extraction recap — the fields that
actually ship, in the order they ship, which is the one place a rep can check what the CRM
will get. Deleting either is a real loss.

Three ways out, and they are not equivalent. The recap could carry only what the narrative
*cannot* — the field values with their `⚠ faible` marks, no restated sentences. The narrative
section could lose the two headings that the recap covers, leaving the prose to end on
« Échanges et points techniques ». Or the recap could stop repeating headings the narrative
already used and become one flat field list. Measure the document each way against a real
transcript with `npm run replay:extract` before choosing — this is a prompt change, and this
repo's rule is to tune the register by replaying rather than by reading.

**Out of scope** — the renderer. `CompteRenduDocument` draws what it is given and must keep
drawing every marker; the fix is upstream or it is not a fix.

## US-35 — two things left on the home screen, after round 34's first pass

**Lane** `ui-agenda` · `src/screens/agenda/PendingGates.tsx`, `CalendarGrid.tsx` ·
**not yet assigned** · found by looking at the screen after the pass, which is the point

US-22/US-24/US-26 landed and the screen is right: the day is the title and is drawn once, the
« Tout fonctionne » pill is gone, and exactly one control is filled — the live call. Two
things survive that are the same class as what was removed.

1. **« 2 autres sont dans la liste du jour, au-dessus. »** — a sentence explaining the app's
   own list-making, drawn permanently under a section heading. It is there because a meeting
   can legitimately appear in both the day list and the pending list, and the count on the
   heading would otherwise look wrong. That is a real problem and this is the wrong solution:
   the count and the list disagree, and the app narrates the disagreement instead of resolving
   it. Decide which number the heading states — three pending, or the one not already above —
   and say it in the count rather than in a sentence under it.

2. **The legend is now three lines.** « réunion enregistrée · réunion prête · événement seul »
   plus « Synchronisé il y a 4 min », wrapping since `--echo`'s fix lengthened « prêt » to
   « réunion prête ». It is a key for three 6-px dots, and it is the third-largest block in the
   left column. Do **not** simply delete it: those dots carry meaning by colour alone, which is
   the thing `--contrast`'s `data-graphic` rule exists for and which no other text on the
   screen recovers. The question is whether a key belongs on screen permanently or whether the
   dots should be reachable another way — measure before deciding, and `--contrast` is the
   check that must stay green either way.

Neither is urgent. Both are recorded because the screen was looked at *after* the change, which
is the half of a design pass that usually does not happen.

---

# Grilling the next features — before building, not after

Three of the queued stories were argued from their own descriptions. Measured against the
tree, two of my claims were wrong and one story is more expensive than it says.

## US-5 does not need a server, and my parity note said it did

The parity table records three of the four gaps as « the same missing thing — a server »:
Spaces, Shared with me, **cross-meeting chat**. The first two are right. The third is not:
US-5 as written is *« one account, a bounded window »* over the local store — no server, no
index, nothing shared between machines. Corrected here rather than silently.

## US-29 and US-5 are the same missing primitive, and neither has it

Both need « this account's past calls », and **the meetings projection has no account key**.
`Projections`' `meetings` row carries `client_name` and nothing else about who the client is;
`accountId` lives in the extraction and in the push intents — in the **event log**, foldable
but not queryable.

Two ways, and they are not equivalent:

- **Exact `client_name`.** Costs nothing, needs no migration, and is wrong across sibling
  companies — which is not hypothetical: the gate itself offers « Rattacher plutôt à une
  autre société du groupe » with « Néovia Santé — Pôle Ouest » and « Néovia Hospitalisation »
  beside it, so the product already knows one account has several names.
- **An `account_id` column on the projection.** The right key, and it means touching the
  schema stamp and the refold — the one place in the store where CLAUDE.md records a latent
  defect (« a new stamp over empty projections, and the next boot reads that as already
  upgraded »), in databases that by then hold real meeting history.

**Take the first, and let it fail closed.** A brief that is missing costs a rep a glance at
*Historique*. A brief that attaches **the wrong client's promise** to the call they are about
to take is the worst thing this product could put on a screen, and a `client_name` match
across siblings is exactly how that happens. Exact match, no brief for siblings, and the
column becomes a story of its own the day a rep asks why.

## US-29's own fixture claim was wrong

It says « the fixture has to grow a second call for one of its accounts ». It does not: the
stub already stages **two** repeat clients — `m-lefort-decouverte` → `m-lefort-cv` and
`m-nordis-support` → `m-nordis-renouvellement`. The first pair is « découverte du besoin »
followed by « restitution des CV DevOps », which is precisely the promise-then-delivery arc a
brief exists to show. The fixture was ready before the story was.

## The order, and why it is not the obvious one

**US-29 before US-5.** US-29 is deterministic end to end — no model, no citation to verify, no
corpus to truncate — so it builds the account-history primitive against the easiest possible
consumer. US-5 first would mean solving cross-meeting DEC-21 citations (a citation must name
*which call* and open that call's reader on that turn) **and** the corpus-size problem
(`ASK_MAX_INPUT_CHARS` silently kept the tail of one 90-minute call; six months of an account
is one corpus size away from the same defect) before anything at all is visible before a call.

## The strongest objection to US-29, stated rather than dodged

Round 34 has just spent a day taking things **off** the home screen, and US-29 puts a line
back on every row. The answer is not that this line is special; it is that the test is the
same one round 34 applied — **is it about the call, or about the app?** « 09/09 — 3 CV avec
TJM avant vendredi · tâche VerySwing créée » is about the call. It must also be absent rather
than empty, must not restate the objet already on the row, and must be measured by `--echo`
and against the row's `.measure` at both sizes. If it cannot clear those, it does not ship.
