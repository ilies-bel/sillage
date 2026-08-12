# Working rules for this repo

Read these three before writing code. They are the spec, not background:

| File | What it settles |
|---|---|
| [VISION.md](./VISION.md) | 29 decisions (DEC-1…29), 11 hard requirements (HR-1…11), UI/UX |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Repo decision, kill list, module layout, build order |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | The ordered task list. **Start here.** |

## What this is

**Sillage** — a desktop meeting notetaker for sales reps at a French ESN. The name is
carried all the way down: the package id `fr.ilies-bel.sillage`, the crate `sillage-audio`, and
the `SILLAGE_*` development overrides. It never joins the call —
it listens to the machine's own audio, transcribes, writes French notes, and after **one**
human confirmation pushes to VerySwing CRM and drafts a follow-up in Outlook.

**This repo is the only live checkout**, published at `github.com/ilies-bel/sillage`. Its
history deliberately starts at one root commit: the predecessor
(`Natively-AI-assistant/natively-cluely-ai-assistant`, branch `rebuild/sillage`) was
archived to `~/project/archive/natively-cluely-ai-assistant` on 2026-08-12 and is not to be
worked in. That archive is the only place the old history and the `.mars/` task database
still exist. Do not copy code out of it without diffing first — everything there still says
`notetaker`.

**Current phase: rebuilding.** The repo previously held a real-time answer assistant. That
product has been deleted (`scripts/demolish.sh`) and this one is being built in its place.
If you find code that has nothing to do with meeting notes, it is a leftover — check the
kill list in ARCHITECTURE.md §2 before assuming it matters.

**First deliverable is a live demo against the public VSA sandbox** (DEC-28). Not a client
deployment. There is no client tenant.

## Architecture rules

The folder structure is the pipeline. Data flows one way.

```
electron/core/       pure. no electron, no i/o, no network. contracts + domain logic.
electron/modules/    one external boundary each. capture, transcribe, calendar,
                     identity, llm, signals, extract, crm, mail, store, diagnostics.
electron/app/        electron wiring. main, session state machine, ipc, windows.
src/                 renderer.
```

**The import rule, enforced in CI:**

```
core/*      → may import nothing but core/
modules/X   → may import core/ and modules/X/.  NOT modules/Y.
app/*       → may import core/ and modules/*.
src/*       → may import core/contracts/ only.  Never modules/, never app/.
```

Modules never talk to each other. The orchestrator wires them. This one rule is what
prevents another 11,810-line `ipcHandlers.ts`.

If a behaviour is hard to place, it belongs in `app/session/MeetingSession.ts` (the state
machine) or in `core/domain/` — never in an IPC handler.

## Invariants that are easy to break

- **The rep's document is never written by AI during a call** (DEC-5, DEC-14). The signal
  rail is a read-only side surface. Gray AI text enters the document exactly once, at
  meeting end.
- **Proof of life is the input meter, not a live transcript** (DEC-38). The transcript pane
  was removed: it was seconds late, blank through every pause, and looked identical whether
  the room was quiet or the microphone was too quiet to transcribe — which is a meeting that
  actually happened. The header meter draws the amplitude measured on the capture path and
  greys every bar the transcriber would drop — **both channels**, mirrored about a baseline,
  the rep above and the far end below, because "nobody is being heard" and "the client is not
  being heard" have opposite fixes. The transcript itself is untouched: captured, stored, and
  still the only thing a citation may point at (DEC-21). Do not reintroduce a live transcript
  surface to prove the tool is working; that job now has an instrument.
- **No `/NN` opacity modifier on a design token.** Tailwind cannot recompute alpha on a bare
  `var()`, so `bg-muted/30` compiles to *no rule at all* — the class name is spelled right,
  nothing throws, and the element is simply unstyled. Two shipped that way: the meter's
  below-floor bars were transparent, and the signal rail's empty « — » inherited `--text-body`,
  drawing empty slots stronger than filled ones. `npm run check:tokens` now fails on it. The
  fix is a named token in `tokens.css`; a `color-mix()` derived from an existing one needs no
  entry in VISION.md §6.
- **The signal rail draws the whole slate, empty rows included** (DEC-14, DEC-38). The ESN
  recipe's fields are fixed (DEC-13), so they are known before the call starts. An empty slot
  says « — » and stays that way until somebody says the thing — filling one is the failure
  DEC-21 exists to prevent. The slate comes from the recipe (`slate` in `recipes.ts`); a
  recipe that declares none draws only what landed, and says so. **It is never behind a tab
  with the compte-rendu**: once one exists the session screen is three columns — notes,
  document, slate — because judging the document against the slate means seeing « Durée — »
  empty *and* the prose silent about it in one glance, and a switch costs that glance a click
  and a memory. Side by side, not stacked: stacked, the document showed six lines under a
  full slate at 900px.
- **The compte-rendu opens on a « ## Résumé »** (DEC-40). Two to four sentences that read on
  their own — a summary of whatever happened, so *both* recipes open on it.
  `COMPTE_RENDU_SECTIONS` is the single source for the ESN headings; the prompt and the tests
  both read it, and it lives in `core/contracts/recipes.ts` beside the recipe that uses it.
- **Two recipes, declared in one file, and never a template the rep writes** (DEC-43,
  amending DEC-13). `core/contracts/recipes.ts` declares a *shape* — headings, field names,
  labels — and never a fact. A third recipe is an entry there plus its prompt in
  `modules/extract/prompt.ts`. A rep-authored template would be a prompt nobody benchmarks,
  which is the half of DEC-13 that stands. The free recipe extracts **nothing typed**, and
  that costs exactly two things, both stated on screen rather than silently absent: no
  measured confidence (DEC-21 has no cited value to verify) and no VerySwing *opportunité*
  (every descriptive column of one is fed by a field it does not produce, so `draftIntents`
  refuses it with the reason on the row). Everything that was never the recipe's still holds
  — the deterministic header, the leak check, the CRM task, the Outlook draft.
  `LlmInterpretation.recipe` is a **defaulted** key so that every extraction stored before
  this existed replays as the ESN one; do not make it required.
- **A meeting that ends never leaves the screen blank** (DEC-39). `ended` draws no control and
  the review gate refuses it, so when enhancement cannot run the rep sees a recording finish and
  nothing happen. `EnhancementNotice` is the answer: it states the case, and *waiting for a model*
  is a promise the app keeps — every write in Réglages drains what is waiting. Compute
  `EnhancementStatus`, never store it.
- **The compte-rendu never requires a Microsoft account** (DEC-39). `repEmail` is nullable the
  whole way down. It names the rep on the header line and subtracts them from `interlocuteurs`;
  neither is worth the extraction. Reinstating a `if (!repEmail) return` makes Entra a
  prerequisite of the only thing the product does.
- **The model reads the de-duplicated transcript; the store keeps all of it** (DEC-41). On a
  laptop with its speakers open the microphone hears the far end, so the client is transcribed
  twice — once correctly on `far`, once as the rep. Measured on a real call: 24 of 38 rep
  segments. `core/domain/channelBleed.ts` drops the rep copy *at read time*, in `main.ts` before
  the recipe. Never filter the stored transcript: DEC-21 verifies citations against it and
  `[source ▸]` points at it. The timing test is **proximity of arrival**, not interval overlap —
  `modules/transcribe` sets `startMs === endMs` (a batch provider cannot report acoustic time),
  so an intersection test silently never fires.
- **Echo cancellation is one filter, not one canceller per platform** (DEC-42). `aec3`, a
  pure-Rust AEC3, inside the native module — because the OS cancellers are unreachable
  through `cpal` and taking one would mean a second microphone path, COM, and two
  `check-platform.mjs` allowances for one behaviour. It runs **before** silence
  suppression: a canceller fed a gated signal cannot hold adaptation, and the gated frames
  are the ones carrying the echo. The far channel is the reference and stays untouched.
  Three things are load-bearing and none of them are obvious. **`enable_high_pass_filter`
  must stay `true`** — without it the filter cancels 66 dB and then permanently diverges,
  and the crate documents none of this. **Noise suppression and AGC2 must stay off**: they
  reshape the amplitude that `inputLevel.ts`, the VAD and DEC-40's too-quiet detector all
  measure downstream. **The version is pinned exactly**, and the regression test in
  `echo_canceller.rs` carries the one signal that exposes the divergence — speech with
  pauses and a low first formant. Continuous speech at 520 Hz hides it completely; a draft
  of that test passed with the stage disabled. Everything fails open (DEC-26): a graph that
  will not build, a frame it rejects, a rate that is not 16 kHz, all leave the microphone
  exactly as it arrived.
- **Deterministic data never comes from the LLM** (DEC-7). Attendee names, emails, dates and
  account codes come from Graph or VSA. `LlmInterpretation`'s schema has no fields for them.
- **Confidence is measured, not self-reported** (DEC-21). Every interpretive field cites a
  transcript span; the app verifies the span exists. No verifiable span → `⚠ faible`.
- **Never write to the Outlook event body** (DEC-10). It mails attendees and destroys the
  Teams join blob.
- **We create drafts, never send mail** (HR-8). `Mail.ReadWrite`. Never `Mail.Send`.
- **Raw audio is never retained** (DEC-12). Transcribed and discarded.
- **The capture path has zero network dependencies** (DEC-26). Everything downstream may
  fail; nothing downstream may stop a meeting being recorded.
- **`POST /v1/crm/tasks` has no idempotency key.** The outbox persists the returned `id` in
  the same transaction that drains the intent, and never re-posts a drained one.
- **Where a provider runs is surfaced, never enforced** (HR-11 as amended by DEC-33 and
  narrowed by DEC-37). Every provider row declares `local | remote` and Réglages shows it as
  « sur la machine » / « hors machine ». It refuses nothing and breaks no ties. **Do not
  reintroduce a jurisdiction claim** — no `eu` value, no « UE » badge, no allow-list flag: a
  contractual term differs per client and per year, and a literal in a source file cannot
  keep it true, which makes a stale one worse than none. The one switch that still refuses is
  `offlineOnly` — the rep asking, in the product, for this meeting's audio to stay on the
  machine.
- **Local transcription is the default, not the fallback** (DEC-30). Never call it *dégradé*
  in a French string, never present it as a downgrade, and never show a cloud engine as the
  normal case. Cloud STT is an opt-in accuracy upgrade; falling back to local is a return to
  the default and is not announced.
- **The calendar is always drawn** (DEC-31), with no Graph connection and on an empty day. A
  rep can create and record a meeting on any day. No placeholder box where the grid belongs.
- **One general status, and only required subsystems move it** (DEC-32). Capture,
  transcription and analysis — nothing else. VerySwing, Outlook and the calendar are optional
  (DEC-26) and must never render as an app-level degradation. Per-control reasons still stay
  inline; only the aggregate footer strip is gone.
- **No environment variable is required to run this app** (DEC-34). Keys go to the OS
  credential store from Réglages; everything else a provider needs — a base URL, an Azure
  deployment, a region — is a `fields` entry on its descriptor, stored in the KV store and
  rendered as a text field. `process.env` is a *development override* and is read last. When
  you add a provider setting, declare it; do not reach for a new `SILLAGE_*`.
- **What Réglages says is what a meeting does.** `resolveLlm` and `recordingOptionsFor` read
  the vault, the provider preference and the model preference, and are asked *per use*. Both
  were once boot-time snapshots that consulted only `process.env`, which made the whole
  settings surface decorative. A new read path that skips `credentials.keys()` or
  `preferences.provider(…)` reintroduces exactly that.
- **The ChatGPT row borrows, never runs, an OAuth flow** (DEC-36). It reads
  `~/.codex/auth.json` and never writes to it: refreshing here would invalidate the token
  Codex holds. Its model comes from Codex's `config.toml`, because the endpoint serves a short
  account-specific list. Do not add a *Se connecter* button to it.

## The CRM boundary (DEC-29)

The client will have their own developments on top of VSA. That must cost an adapter change,
never a core change.

```
core/contracts/crm.ts     CrmPort — domain verbs, knows nothing about VSA
modules/crm/vsa/          the only place VSA exists
  fieldMap.ts             ExtractionESN ⇄ VSA columns — DATA, not code
  ext/                    client-specific overrides. subclass, don't fork.
  generated/              from OpenAPI. never hand-edit.
```

**CI check:** `grep -rn 'tiersCode\|oppyId\|salesStage' electron/ src/` must return hits
only under `electron/modules/crm/vsa/`. Anywhere else means the abstraction leaked.

## Commands

```
npm test                  # the suite. prints which tests are deferred, and why
npm run check             # typecheck + import boundaries + CRM containment + platform branches
npm run build:electron    # esbuild → dist-electron (core/, modules/, app/, preload only)
```

`npm test` needs no build: `.ts` runs directly under Node's type stripping.

**Looking at a screen** — the renderer runs in a plain Chromium with a stubbed IPC bridge,
so no Electron, no audio device, no Graph and no keys are needed:

```
npm run dev -- --port 5180 --strictPort        # first, in another shell
node scripts/harness/shot.mjs review scratch/review.png --scan
node scripts/harness/serve.mjs                 # the same app at a URL, for tools that take one
```

`scripts/harness/README.md` has the screen list. `--scan` runs a design detector inside the
rendered page. **A design pass that only reads `src/` has not looked at the product** — the
defects that matter here live in rendered geometry and in the accessibility tree.

## Platforms — Windows is the primary one (HR-2)

The reps this ships to are on Windows laptops. macOS is where it is *written*, which is the
whole risk: a mac-first decision looks reasonable on the machine where it is typed and is
only discovered on the platform that matters.

**CI check:** `npm run check:platform`. Every file allowed to know what it is running on is
declared in `scripts/check-platform.mjs` with the reason it cannot be written portably —
five today, all in capture and whisper. A new `process.platform`, a `sysctl`, a `tasklist`,
a `/Applications` path or a `C:\` literal outside that list fails the check. So does an
allowance whose branch has since gone, so the list cannot rot into a blanket exemption.

Where the two platforms genuinely differ, the difference lives in one place each:

| | macOS | Windows |
|---|---|---|
| System audio | ScreenCaptureKit, `native-module/src/speaker/macos.rs` | WASAPI loopback, `speaker/windows.rs` |
| Toolchain for that module | full Xcode (`cidre`), not Command Line Tools | VS Build Tools + `rustup target add x86_64-pc-windows-msvc` |
| Refresh token | Keychain | Credential Manager (DPAPI) — same `SecretVault` port |
| Capture permission | TCC prompt, screen recording | none |
| Package | dmg + zip | NSIS + portable |

`npm run dist` (→ `scripts/package-app.mjs`) runs on either host. Never put shell syntax in a
`package.json` script: `$?`, subshells and `&&`-chains that must not short-circuit belong in a
`.mjs` runner, because `cmd.exe` does not read them and the failure lands on the primary
platform.

Third-party native addons are down to **one** — `keytar`. Adding a second is a decision, not a
dependency: it has to be rebuilt per Electron ABI, per arch, on both platforms, and on Windows
that means MSVC and Python on every machine that runs `npm install`.

## Conventions

- TypeScript strict. Zod schemas for every IPC payload and every LLM output.
- **Relative imports inside `electron/` carry their `.ts` extension.** That is what lets one
  source tree run under `node --test`, esbuild and `tsc --noEmit` with no build step between.
  `electron/package.json` marks the tree `"type": "module"`; the root stays CommonJS.
- Node's type stripping is **strip-only**, so no TypeScript construct with runtime meaning:
  no `enum`, no `namespace`, no constructor parameter properties (`constructor(private x: T)`).
  String-literal unions and explicit field assignments instead. `tsc` will not catch these —
  `node --test` will, with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- **SQLite is `node:sqlite`**, never `better-sqlite3` — stdlib, no ABI rebuild, and it loads
  in plain `node`, which is what keeps the store and `core/domain/` testable without Electron.
- A module never imports another module. If `modules/X` needs something `modules/Y` has,
  declare a port (an interface) and let `app/` inject it — as `modules/diagnostics` does with
  `DiagLog`, and as every module does with `DiagRecorder` from `core/contracts/diagnostics.ts`.
- French for all user-facing strings. English for code, comments and commits.
- `core/domain/` is unit-tested with no Electron, no audio device, no network. If a rule
  needs an Electron mock to test, it is in the wrong folder.
- Ported ProseMirror code keeps its upstream tests (`vendor/anarlog-editor/`, MIT).
- Never edit `vendor/` — port out of it into `src/editor/`, then adapt there.

## Reference material

- `docs/reference/vsa-api.md` — the VSA endpoints we use, with shapes and gotchas
- `docs/reference/vsa-sandbox-openapi.json` — the full 261-path spec
- `vendor/anarlog-editor/PROVENANCE.md` — what to port and what to leave

## Things already decided — do not relitigate

Editor is raw ProseMirror, not TipTap (DEC-8). Calendar is Microsoft Graph, not Google
(HR-3). No monorepo (ARCHITECTURE.md §1). No live AI writing into the document (DEC-5). Two
declared compte-rendu recipes and no rep-authored template (DEC-13 as amended by DEC-43).
One confirmation gate (DEC-4). If you think one of these is wrong, say so — don't silently
build the other thing.
