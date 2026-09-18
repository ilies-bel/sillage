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
them. Behaviour that is hard to place goes in `app/session/MeetingSession.ts` or
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
- Never draw an inert primary: while *Valider* is withheld the slot holds the control that shows the rest.
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
- A comment is not a check. Prose in this repo has been wrong about the code twenty-six times — five of them numbers that were computed and written down as numbers that were observed, one of those five repeated at four sites and then quoted back by a reviewer as the basis for a recommendation, another giving one variant's width, a second variant's count and a half-height belonging to neither — while a second file, arguing the same point, stated a third width again, so the tree contradicted itself about one measurement for two rounds — and nine of them docblocks that argued correctly for one of the several cases their subject covers — including two that named a colour distinction no painted pixel had, and one that concluded a hook was right for the very reason it was wrong; measure before trusting a sentence. Round 22 added five: a paragraph saying a fix « is not
in this commit » about code that had shipped it, which then generated a false brief for a
whole lane; a palette note still arguing for the hex it had been replaced by; a docblock
claiming its check discovered rungs by prefix while the code read a hand-written array of
three; a docblock calling a column « wide enough for the longest thing any list puts here »
when it was 31px generous; and the pass count four lines above this file's own command
block, wrong for the third time in the same direction.
- **An instrument can be green and narrow.** Round 22 found five checks that appeared to ask
  what a rep sees and asked something narrower: `--contrast` tested `background-image`
  before `background-color` and skipped 290 text runs; `--contrast` again computed the
  darkest pixel under the grain, printed 4.458:1 against a 4.5 floor on 138 runs, and bound
  nothing; `--census` read its radius ladder from a hand-written array; `--a11y` computes a
  heading-to-prose ratio and prints it on the *green* line; and every one of the eight
  visibility predicates across the twelve passes ignored whether an ancestor's overflow had
  scrolled the element away — on `historique` at 1280×800, 1 621 of 1 750 painted elements
  are outside their scroller. What decides whether that last one matters is not which helper
  a pass uses but whether its question is **relational**: a pass asking something intrinsic
  about one element is unaffected; a pass asking about the distance between two is corrupted.
  A number that is computed, printed and binds nothing is not a check.
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
node scripts/harness/smoke.mjs                 # every stage × two sizes, all twelve checks
```

`--geometry`, `--targets`, `--prose`, `--echo`, `--a11y`, `--contrast`, `--scrollers`,
`--motion`, `--fade`, `--census`, `--rhythm` and `--cells` are the twelve `smoke.mjs`
passes (`PASSES`, `smoke.mjs:189`); `--scan` is a thirteenth it does not pass. This said
« six » and named the first list for three rounds, then « nine » for one round after
`--census` landed, then « ten » for one round after `--rhythm` and `--cells` landed — each
time omitting exactly the passes added most recently, which are the ones a reviewer is
likeliest to assume unrun and re-run by hand. **Count them in `smoke.mjs` before repeating
this sentence**; it has now been wrong three times, in the same direction, about a list it
sits four lines above, and each time the sentence was written by whoever had just added the
pass it omitted. Each exists because something shipped past a screenshot. **Both sizes,
always** — 1280×800 and 960×600, the minimum `main.ts` declares. A design pass that only
reads `src/` has not looked at the product. Stages are held together by the product's own
French strings, so a copy change breaks one silently.

`scripts/e2e.mjs` launches the built main process (not the packaged renderer — that comes
from Vite) and walks a rep's first ten minutes, twice, seeding the gate through the
product's own `Store` with the app closed. `scripts/harness/README.md` has the screen list;
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
