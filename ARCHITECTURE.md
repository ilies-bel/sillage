# Architecture

Implementation architecture for the product defined in [VISION.md](./VISION.md).
This document answers three questions: **which repo**, **what gets deleted**, **how the
remainder is laid out**.

---

## 1. Repo decision

**Stay in this repo. Demolish, then rebuild — do not strip incrementally.**

### Why stay

Two assets here are expensive to recreate and orthogonal to features:

1. **`native-module/`** — the Rust crate with WASAPI loopback + mic capture, napi-rs
   bindings, resampler, VAD, and the arch gate. Dual-channel capture on Windows is the
   single hardest thing in the whole product (HR-2), and it already works. Rebuilding the
   napi build chain in a new repo costs more than deleting features here.
2. **The Windows build pipeline** — electron-builder NSIS x64/ia32 + portable targets,
   `patches/`, signing config, the packaged-arch test. Feature-independent, already tuned.

Everything else is a *different product*: a real-time answer assistant. It shares a
transport (Electron + audio) with a meeting notetaker, and nothing else.

### Why demolish rather than strip

The junction files cannot be edited down:

| File | LOC | Fate |
|---|---|---|
| `electron/ipcHandlers.ts` | 11,810 | **Delete.** Every removed feature leaves a stump. |
| `electron/main.ts` | 7,869 | **Delete.** Boots ~20 subsystems we don't have. |
| `electron/LLMHelper.ts` | 8,057 | **Delete.** |
| `electron/preload.ts` | 2,625 | **Delete.** |
| the overlay interface component | 8,417 | **Delete.** Wrong UI entirely. |

~39k LOC across five files, all rewritten from scratch regardless of approach. Trying to
edit them down means carrying dead branches, dead settings keys, and dead IPC channels
into the new product forever. One demolition commit is cheaper and leaves no fossils.

**Sequence:** one commit that deletes the kill list and leaves a repo that does not build.
Then rebuild. Do not attempt to keep `main` green during demolition — it is a lie that
costs days.

### What this is not

Not a monorepo. `npm workspaces` buys boundary enforcement we get more cheaply from a
lint rule, and costs build orchestration, tsconfig project references, and a second
install graph. One app, one `package.json`, plus the existing `native-module` crate
consumed over napi exactly as it is today.

---

## 2. Kill list

Delete outright. Grouped by why.

### It's the other product (real-time answer assistant)

| Path | LOC | |
|---|---:|---|
| `electron/llm/` | 27,474 | AnswerPlanner, WhatToAnswerLLM, IntentClassifier, answerPolish, AnswerValidator, codeVerification, manualProfileIntelligence |
| `electron/intelligence/` | 11,058 | |
| `electron/services/modes/` + `ModesManager`, `ModeGenerator`, `modePolicy`, `modeSourceContract`, `ModeContextRetriever`, `ModeReferenceFileIngestion` | ~4,000 | Modes are an answer-assistant concept |
| `electron/services/skills/` | 1,384 | |
| `electron/services/dynamic-actions/` + `src/components/dynamic-actions/` | 789 | |
| `electron/services/knowledge/` | 4,803 | Personal knowledge base |
| `electron/rag/` | 5,963 | Retrieval over the user's own corpus. Not in scope. |
| `electron/services/HindsightManager.ts`, `SessionTracker.ts` | ~1,600 | |

### Wrong input surface

The product hears a meeting and reads a calendar. Nothing else.

| Path | LOC | |
|---|---:|---|
| `electron/services/screen/` | 2,393 | Screen understanding |
| `electron/ScreenshotHelper.ts`, `CropperWindowHelper.ts`, `src/components/Cropper.tsx` | 1,834 | |
| `electron/services/browser-context/` | 961 | |
| `electron/services/PhoneMirrorService.ts`, `phoneMirrorClient.ts` | ~700 | |
| `electron/visionBenchmark/`, `vision-benchmark.models.json` | 958 | |
| the companion browser extension | 50 files | |

### Stealth (HR: explicitly not required)

| Path | LOC | |
|---|---:|---|
| `native-module/src/stealth_window.rs` | 231 | macOS-only anyway |
| `native-module/src/keyboard_tap.rs` | 857 | Global key tap |
| `electron/services/StealthKeyboardManager.ts`, `ForegroundGate.ts`, `ImeDetector.ts` | ~800 | |
| `setContentProtection` calls in `WindowHelper.ts`, `SettingsWindowHelper.ts` | — | |

### Monetisation / consumer shell

Client deployment, not a consumer app.

| Path | LOC | |
|---|---:|---|
| `electron/premium/`, `src/premium/`, `premium/`, `src/components/trial/` | ~1,200 | |
| `native-module/src/license.rs` | 466 | |
| `electron/DonationManager.ts`, `services/ReviewService.ts`, `ReviewPromptLogic.ts`, `src/components/ReviewModal.tsx` | ~1,400 | |
| `services/InstallPingManager.ts`, `services/telemetry/` | 714 | Reintroduce later, opt-in |
| `src/components/onboarding/`, `FeatureSpotlight.tsx` | 2,387 | Rewritten for the new flow |
| `src/i18n.{es,ja,ru,zh}.generated.ts` | large | FR + EN only (HR-6) |

### Superseded

| Path | LOC | |
|---|---:|---|
| `src/components/settings/` + `SettingsOverlay.tsx` + `ProfileIntelligenceSettings.tsx` | 15,461 | Settings for features that no longer exist |
| `electron/services/CalendarManager.ts` | 493 | Google OAuth via proxy → replaced by Graph (HR-3) |
| the hosted-tier STT client + `electron/audio/relaySession.ts` | 1,493 | Vendor relay |
| `electron/audio/{Soniox,ElevenLabs}StreamingSTT.ts` | 845 | Excluded by HR-11 |
| `electron/db/DatabaseManager.ts` | 2,944 | Schema is for the other product. New event-log schema. |
| `electron/services/CodexCliService.ts`, `CodexOAuthService.ts` | — | |
| `electron/ModelSelectorWindowHelper.ts` | 305 | |
| `native-module/src/process_name.rs` | 119 | Arming is calendar-driven (HR-9) |

**Total deleted: ~175,000 of 188,678 LOC (~93%), plus ~1,700 of 4,955 Rust LOC.**

---

## 3. Keep list

Everything that survives, and in what condition.

| Path | LOC | Condition |
|---|---:|---|
| `native-module/src/speaker/{mod,windows,macos,sck,core_audio}.rs` | 1,282 | **As-is.** The reason to stay in this repo. |
| `native-module/src/{microphone,resampler,vad,audio_config,silence_suppression}.rs` | 1,301 | **As-is.** |
| `native-module/src/lib.rs` | 699 | Trim to the audio surface only |
| `electron/audio/{SystemAudioCapture,MicrophoneCapture,nativeModuleLoader,AudioDevices}.ts` | 878 | **As-is**, moved |
| `electron/audio/LocalWhisperSTT.ts` | 813 | **As-is.** The offline floor (HR-4, HR-11). |
| `electron/audio/RestSTT.ts` | 517 | Becomes the Azure Speech / Gladia base |
| `electron/audio/DeepgramStreamingSTT.ts` | 326 | Reference streaming adapter. |
| `electron/audio/{OpenAI,Google}StreamingSTT.ts` | 1,574 | **Reference only** — port the reconnect/backoff logic, don't ship the providers |
| `electron/services/meeting/{TranscriptChunker,TranscriptNormalizer,SectionPromptCompiler,MeetingSummarySchemaValidator,generateStructured}.ts` | 607 | Chunking + schema-validated generation. Reusable. |
| `electron/services/meeting/{MeetingSummaryV3,MeetingRecipes}.ts` | 798 | **Rewrite**, keep the recipe *shape* (DEC-13) |
| `electron/services/meeting/FollowUpDraftGenerator.ts` | 354 | Rewrite for FR ESN + Graph draft |
| `electron/services/CredentialsManager.ts`, `credentialFallbackCrypto.ts` | — | Keychain/DPAPI secret storage |
| `electron/services/{RateLimiter,SettingsManager,ProviderStatusRegistry,LocalModelDownloadService}.ts` | — | Generic infra |
| `electron/nativeArchGate.ts` + `.test.mjs` | 197 | Packaging safety net |
| `electron/lib/nativeArch.{mjs,cjs}` + parity test | 212 | Both twins. `scripts/rebuild-native-electron.js` requires the `.cjs`. |
| `electron/update/` | 197 | |
| `electron/services/{LocalFallbackAssets,LocalFallbackPreflight}.ts` | 450 | The offline floor's preflight (HR-4) |
| `electron/services/SafeDocumentTextExtractor.ts` | — | Recently hardened; useful for attachments |
| `electron/utils/{redactForLog,nativeModuleGuard,onnxLoadSentinel,onnxThreadConfig,NativeOomTrace,lifecycleTracker,workerStatus,emailUtils}.ts` | — | What the kept code imports, plus DEC-27 redaction |
| `electron-builder.signed.cjs`, `patches/`, `build/`, `resources/` | — | **As-is.** The other reason to stay. |
| `scripts/` | — | Build pipeline only. The eval and smoke harnesses went with their product. |

**Ported in from outside:** anarlog `packages/editor` (MIT) — ProseMirror schema,
node-views, keymap, `transaction-guard`, tests (DEC-8).

### 3.1 How the list is enforced

`scripts/demolish.sh` works from §2 — a denylist. It under-deletes, because §2 groups by
*reason* while the tree is organised by *folder*: every module it named left its test suite
behind, and files matched a category without being listed. It removed 207k lines and left
103k.

`scripts/demolish-residue.sh` inverts the rule: **this table is the allowlist**, and anything
under `electron/` or `src/` not matched by it is removed. Run it after `demolish.sh`. If you
add a path there, add a row here — the script's `keep()` is meant to be readable against this
table.

Two consequences worth stating plainly:

- **The renderer keeps no component.** `src/` is fonts, icons, assets and `lib/utils.ts`.
  §4 rebuilds it as `editor/`, `screens/`, `design/`, `state/`.
- **Most of the old test suite tested the old product.** 22 test files survive. The ones that
  died were largely source-*text* assertions against `main.ts` and `ipcHandlers.ts` — they read
  those files and grepped them, so they could not survive the rewrite in any form. What they
  asserted is recovered in
  [`docs/reference/capture-invariants.md`](./docs/reference/capture-invariants.md), which is
  the acceptance checklist for step 2.

- **Of those 22, only 8 can currently run**, and the reason is worth stating plainly rather
  than discovering later. Fourteen of them do not import their subject — they import the
  *compiled* copy from `dist-electron/`. Their subjects are on the keep list but still import
  modules that went with the old product, so the legacy tree no longer compiles and those
  tests have nothing to load. They appeared green immediately after demolition only because
  the working copy still held pre-demolition build output; on a clean checkout they could
  never have passed. `scripts/run-tests.mjs` defers them by a mechanical rule — a test naming
  a `dist-electron/` path that does not exist — and **prints the list on every run**. Each
  rejoins the suite automatically at the step that ports its subject into `modules/` and
  repoints it at the source. One further test, `AppState.isRealUpgrade`, was deleted outright:
  it never loaded the compiled bundle at all, falling back to a copy of the logic pasted into
  the test file, and its subject (the old `main.ts`) is gone.

---

## 4. Target layout

The folder structure **is** the pipeline. Data flows one direction; folders are ordered
by that direction.

```
electron/
  core/                     ← pure. no electron, no i/o, no network.
    contracts/              ← the only thing every module may import
      meeting.ts              Meeting, MeetingContext, Attendee, ArmingDecision
      transcript.ts           Segment, Channel, TranscriptView
      signals.ts              Signal chip — read-only, never enters the doc (DEC-14)
      lexicon.ts              LexiconTerm, BoostCapability (DEC-17)
      extraction.ts           ExtractionESN = { facts, interpretation }
      push.ts                 PushIntent (+ dependsOn), PushResult, OutboxEntry
      crm.ts                  CrmPort — domain verbs only, no VSA vocabulary (DEC-29)
      diagnostics.ts          DiagEvent, Severity, RetentionPolicy (DEC-27)
      health.ts               ConnectorHealth — why a control is disabled (DEC-26)
      providers.ts            SttProvider, LlmProvider, ProviderCapabilities
      ipc.ts                  channel names + zod payload schemas
      events.ts               the log's alphabet — every MeetingEvent variant
      fixtures.ts             canonical sample values, shared by every layer's tests
    domain/                 ← logic with zero dependencies
      arming.ts               calendar event + audio state → arm | skip
      endOfMeeting.ts         silence + grace, scheduled-end aware (DEC-9, DEC-16)
      entityResolution.ts     attendee domains → ranked candidates + confidence (DEC-18)
      spanVerification.ts     cited span really in the transcript? → ⚠ faible (DEC-21)
      redactDiagnostics.ts    DiagEvent[] → content-free export bundle (DEC-27)
      lexicon/
        terms.fr-esn.ts       the static ESN list — data, reviewed by a human
        correct.ts            deterministic post-STT fuzzy pass (DEC-17)
        boost.ts              MeetingContext → per-meeting hotwords
      redaction.ts

  modules/                  ← one external boundary each. never import each other.
    capture/                  native-module ↔ PCM frames
    transcribe/               PCM frames ↔ STT vendors (registry) + boost injection
    calendar/                 Graph calendarView/delta, event metadata, mail thread
    identity/                 MSAL, DPAPI cache, WAM broker
    llm/                      LLM vendors (registry) + prompt compilation
    signals/                  rolling chunks → in-call chips (DEC-14)
    extract/                  transcript + doc → ExtractionESN
    crm/                      CrmPort implementations (DEC-29)
      vsa/
        VsaAdapter.ts           implements CrmPort. the only file that knows VSA exists.
        generated/              typed client from OpenAPI — never edited by hand
        fieldMap.ts             ExtractionESN ⇄ VSA columns. DATA, not code.
        referentials.ts         per-tenant cache: stages, priorities, task types
        probe.ts                connect-time capability diff (DEC-24)
        ext/                    client-specific overrides. subclass, don't fork.
    mail/                     Graph POST /me/messages (draft only, HR-8)
    store/                    SQLite append-only event log
    diagnostics/              DiagEvent sink, rolling purge, export bundler (DEC-27)

  app/                      ← electron wiring. thin.
    main.ts                   boot, ~150 lines
    session/
      MeetingSession.ts       THE state machine. one file. all transitions.
      Orchestrator.ts         owns sessions, subscribes modules to the machine
      Outbox.ts               drains PushIntents with retry
    ipc/
      register.ts             generated from core/contracts/ipc.ts
    windows/

  preload.ts                ← generated bridge. ~80 lines. no logic.

src/                        ← renderer
  editor/                     ported ProseMirror package (README notes upstream)
  screens/
    Splash.tsx                boot lines, first-run model download (DEC-30)
    Agenda.tsx                calendar + day list + search, armed state (DEC-31)
    Session.tsx               notepad | signals, meter in the header (DEC-14, DEC-38)
      LevelMeter.tsx            input level, greys what the transcriber drops
      SignalRail.tsx            the fixed slate, empty rows included, never reorders
    Review.tsx                one gate, three selectable intents (DEC-4, DEC-20)
    Historique.tsx            every call, full record — entered from Agenda search (DEC-25)
    Reglages.tsx              providers, connectors, Diagnostics panel (DEC-27)
    StatusControl.tsx         the one header status; required subsystems only (DEC-32)
  design/                     tokens (brand ramp + cool paper), primitives
  state/

native-module/              ← unchanged crate, minus stealth/license/keyboard
```

### The import rule

```
core/*        →  may import nothing but core/
modules/X     →  may import core/ and modules/X/. NOT modules/Y.
app/*         →  may import core/ and modules/*.
src/*         →  may import core/contracts/ only. Never modules/, never app/.
```

This is the whole design. It is one rule and it is what prevents a second
11,810-line `ipcHandlers.ts` from growing. Modules never talk to each other; the
orchestrator wires them.

Enforced by `scripts/check-boundaries.mjs` (`npm run check`), not by
`eslint-plugin-boundaries` or `dependency-cruiser` as this document originally
said. The rule is four lines; a small analyser runs in milliseconds with no
dependency to install, no ESLint config to keep alive and no plugin to upgrade.
The analyser lives in `scripts/lib/boundaries.mjs` so the rule itself is
unit-tested — the deliberate `modules/a → modules/b` import that must fail is a
test case rather than a file someone has to remember to delete. If the rule ever
outgrows that file, swap it for the real thing.

It also enforces the half of "pure" that the folder layout cannot state:
`core/` may not import `electron`, the filesystem, or the network. That is what
makes §5.G true rather than aspirational.

The check prints how many files it skipped. Those are the folders that survived
demolition and have not reached their porting step — a silently growing
exemption list is how a boundary rule stops meaning anything.

### Two conventions the tree depends on

**Relative imports inside `electron/` carry their `.ts` extension**, and
`electron/package.json` marks the tree `"type": "module"`. Together those let the
same source run three ways with no build step in between: `node --test` (native
type stripping), esbuild for the app bundle, and `tsc --noEmit` for the
typecheck. It is why `core/domain/` and `modules/store/` are unit-tested by
running them, not by running a compiled copy of them.

**The store is `node:sqlite`, not `better-sqlite3`.** Stdlib, so there is no
native module to rebuild per Electron ABI and no `asarUnpack` entry — and it
loads in plain `node`, which a module built against Electron's ABI does not.
That second property is the one that matters: a store you can only test inside a
packaged app is a store nobody tests. Confirmed available in Electron 43
(Node 24.18).

---

## 5. Ten decisions inside the architecture

### A. One state machine, not scattered listeners

`MeetingSession` is a single file with an explicit transition table:

```
idle → armed → recording → ended → extracting → awaiting_confirmation → pushing → done
                    ↓                                    ↓
                 aborted                             (rep edits, stays here)
```

Every module is *driven* by the machine and reports back through it. No module subscribes
to another module's events. If a behaviour is hard to place, it belongs in the machine or
in `core/domain/` — never in an IPC handler.

This is the direct answer to `ipcHandlers.ts`. That file exists because there was no
owner of "what is happening right now".

### B. IPC is a contract, generated once

`core/contracts/ipc.ts` declares every channel with a zod schema for its payload.
`app/ipc/register.ts` and `preload.ts` are both derived from it. Preload contains no
logic. Adding a channel is one entry in one file, and the renderer gets types for free.
Main/preload/renderer cannot drift.

### C. Append-only event log is the source of truth (DEC-12)

One table:

```sql
events(meeting_id TEXT, seq INTEGER, ts INTEGER, type TEXT, payload JSON,
       PRIMARY KEY (meeting_id, seq))
```

Transcript segments, document snapshots, extraction versions, confirmation, push attempts
and push results are all events. Current state is a fold over the log. Consequences:

- Crash recovery is free — replay.
- DEC-12 becomes structural, not aspirational. Nothing can be silently mutated.
- Raw audio is never an event. It is discarded at frame level after transcription (DEC-12).
- Projections (`meetings`, `outbox`) are derived tables, rebuildable, never authoritative.

### D. Provider registries, not switch statements

```ts
interface ProviderCapabilities {
  residency: 'local' | 'remote'         // DEC-33, DEC-37
  streaming: boolean
  languages: string[]
  cost: 'free' | 'metered'
}
```

HR-4, HR-5 and HR-11 become **data**. The settings UI *displays* `residency` and the
selector uses it only to break ties (DEC-33) — it is a fact the row declares, not a filter,
so a provider that lies about residency misinforms rather than misroutes. Adding Gladia is a
file in `modules/transcribe/providers/`, nothing else.

### E. The deterministic/interpretive split is enforced by types (DEC-7)

```ts
type ExtractionESN = {
  facts: DeterministicFacts        // from Graph + VSA referentials. Never from an LLM.
  interpretation: LlmInterpretation // the ONLY thing the model produces
}
```

`LlmInterpretation`'s zod schema **has no fields** for attendee emails, dates, account
codes, or TJM figures read off a screen. A model that hallucinates them fails schema
validation instead of being believed. DEC-7 stops being a guideline the moment the two
types are separate.

### F. The outbox, and why VSA forces it

One confirmation (DEC-4) fans out to two remote systems that fail independently. Without
an outbox, a VSA 500 after a successful Outlook draft leaves the rep re-confirming and
double-creating.

Critically: **`POST /v1/crm/tasks` has no idempotency key.** The outbox must therefore
persist the returned `id` in the same transaction that marks the intent drained, and must
never re-post a drained intent — retry is only ever for intents with no recorded response.
This is a correctness requirement, not a nicety.

Under DEC-20 the outbox drains a **DAG, not a queue**. Up to three intents ship per
confirmation (task, opportunity, draft) and the opportunity must land before the task that
carries its `oppyId`:

```
opportunity ──dependsOn──▶ task          draft (independent)
     │                       │              │
  unchecked ──▶ task falls back to linkType: COMPANY
```

A dependency that fails blocks its dependants and nothing else — a VSA outage must never
stop the Outlook draft from shipping (DEC-26).

### G. `core/domain/` is testable without Electron

Arming, end-of-meeting detection, and entity resolution are the three places where
behaviour is subtle and bugs are invisible. All three are pure functions over plain data,
unit-tested with no Electron, no audio device, no network. If a rule needs a mock of
Electron to test, it is in the wrong folder.

---

### H. Degradation is a first-class state, not an error path (DEC-26)

Every module publishes `ConnectorHealth` to the orchestrator. The renderer reads health from
`core/contracts/health.ts` and disables exactly the controls that depend on a dead
connector — **always with the reason inline**. A greyed control with no explanation is the
worst possible outcome, and it is the default one unless the type makes the reason mandatory:

```ts
type ConnectorHealth =
  | { state: 'ok' }
  | { state: 'degraded'; reason: string; since: number; retry: () => void }
  | { state: 'down';     reason: string; since: number; retry: () => void }
//                        ^^^^^^ not optional. by design.
```

The hard invariant: **the capture path has zero network dependencies.** `capture/` and a
local `transcribe/` provider must run with the machine offline. Everything downstream is
allowed to fail; nothing downstream may prevent a meeting from being recorded.

### I. Errors are events, and the export is redacted by default (DEC-27)

Diagnostics go to the same append-only log as everything else — one store, one query path,
one retention mechanism. Two independent policies:

| Class | Default retention | Purge |
|---|---|---|
| `DiagEvent` (errors, warnings, probe results, retries) | 90 days, configurable | rolling, on boot |
| Meeting content (transcript, notes, extractions) | never auto-expires | manual only |

`core/domain/redactDiagnostics.ts` is a **pure function** — `DiagEvent[] → bundle` — so the
guarantee "this export contains no client conversation content" is unit-testable rather than
a claim. That test is not optional: a bundle full of prospect transcripts in a support
mailbox is a GDPR incident, and the redacted export is the one the button reaches first.

### J. The CRM boundary survives the client's own developers (DEC-29)

They will have custom fields and custom endpoints on top of VSA. That must cost an adapter
change, never a core change. Three layers, and the middle one is the point:

```
core/contracts/crm.ts        CrmPort — domain verbs. Knows nothing about VSA.
  ├ resolveAccount(attendees) → AccountCandidate[]
  ├ pushCompteRendu(payload)  → PushResult
  └ createContact(contact)    → ContactRef
        ▲
modules/crm/vsa/VsaAdapter   the ONLY file that knows VSA exists
        ▲
        fieldMap.ts          ExtractionESN ⇄ VSA columns — DATA
```

A client-specific **field** is a line in `fieldMap.ts`. A client-specific **endpoint** is a
method on a subclass in `ext/`. Neither touches `core/`, `app/`, or the renderer, and neither
requires understanding the pipeline. `generated/` is regenerated from their `/api/doc`, never
hand-edited — hand-edits are how generated clients rot.

The test that proves the boundary holds: **grep the codebase for `tiersCode`, `oppyId`,
`salesStage`.** Every hit must be inside `modules/crm/vsa/`. A hit anywhere else means the
abstraction has already leaked and the client's devs will be editing core files.

## 6. Migration sequence

Ordered so the riskiest assumption is falsified first (DEC-11).

| # | Step | Proves |
|---|---|---|
| 0 | Demolition commit. Repo does not build. | — |
| 1 | `core/contracts/` + `store/` event log + `diagnostics/` + `app/session/MeetingSession.ts` | The spine exists before anything hangs off it. **Diagnostics ships in step 1**, not last — every step after this one is debugged through it (DEC-27). |
| 2 | `capture/` + `transcribe/` (local Whisper only) rewired to the machine | Windows dual-channel still works post-demolition |
| 3 | `identity/` + `calendar/` — Graph delta, arming, `MeetingContext` | HR-3, HR-9, DEC-15. **Moved ahead of the UI** — see below. |
| 4 | `core/domain/lexicon/` + boost injection into `transcribe/` | DEC-17. Cheap, and every later step reads a better transcript. |
| 5 | `src/editor/` port + `screens/Session.tsx` — three panes, transcript live, signal rail stubbed with `signals/` on a cheap local model | DEC-11 + DEC-14. The screen the demo is watched on. |
| 6 | `llm/` + `extract/` — the French ESN recipe, schema-validated | HR-6, DEC-7 |
| 7 | `screens/Review.tsx` — the one gate, three selectable intents | DEC-4, DEC-20 |
| 8 | `crm/` (CrmPort + VsaAdapter + fieldMap) + `mail/` + `Outbox` DAG + `ConnectorHealth` | HR-7, HR-8, DEC-24, DEC-26, DEC-29 |
| 9 | `screens/Historique.tsx` + `Reglages.tsx` diagnostics panel | DEC-25, DEC-27. Readers over the step-1 log — small, because the data was there from the start. |

**Calendar moved from step 4 to step 3.** Under DEC-15 the Outlook event is no longer just
a trigger — it supplies the attendee surnames that step 4 boosts on, the client identity the
session screen shows before a word is spoken, and the scheduled end that DEC-16 uses to size
the grace window. Building the session UI first would mean building it twice.

**Step 9 is deliberately last and deliberately cheap.** Under DEC-12 and DEC-27 the history
and the diagnostics are already in the log from step 1 — the screens are readers, not
features. Building them early would be building UI over data that is still changing shape.

### 6.1 The demo cuts across this order (DEC-28)

The table above is the *dependency* order. It is not the *delivery* order, because DEC-28
made the first deliverable a live demo ending in a visible VSA write — and **a demo that
stops before the CRM write has no ending.** Step 8 cannot be last.

So the demo is a thin vertical slice through all nine steps rather than a deep pass through
the first five. Every step is built to demo depth, nothing more:

| Step | Demo depth | Deferred |
|---|---|---|
| 1 spine | full — it's the foundation | — |
| 2 capture + STT | one good cloud provider | local Whisper fallback, device picker |
| 3 calendar | delta sync + arming + `MeetingContext` | recurrence, `seriesMasterId`, mail thread |
| 4 lexicon | the static ESN list + attendee surnames | fuzzy correction pass |
| 5 session UI | all three panes, real | collapse persistence, keyboard polish |
| 6 extraction | the ESN recipe, span-verified | regeneration, edits-as-context |
| 7 review gate | three intents, editable | source-span drill-down |
| 8 CRM + mail | **full — this is the payoff** | health/degradation, retry UI |
| 9 historique | cut entirely | — |

Two pieces of demo-specific work that are not in the table and are not optional:

- **Seed the sandbox.** A plausible French ESN account base — accounts, contacts,
  referentials — so resolution resolves to something real and the write lands somewhere
  recognisable. An empty CRM makes the payoff beat land on nothing.
- **A replay fixture.** A stored transcript that can be fed through steps 6–8 without live
  audio. Live capture in front of an audience fails for reasons that have nothing to do with
  the product — a bluetooth headset, a muted device, a hotel network. The fixture is the
  rehearsal harness and the fallback, and it costs an afternoon.

**What this order gives up, knowingly.** DEC-11 stops being falsifiable early: there is no
reps-first notepad build, so the assumption that commercials will type rides all the way to
the demo untested. That is the correct trade — with no tenant and no rep access, the demo is
what earns the right to run the field test.

---

## 7. Deliberately deferred

- Multi-tenant packaging (DEC-1 says product later — the Entra app is multi-tenant from
  day one, the app is not)
- Telemetry (reintroduce opt-in)
- macOS (`speaker/{sck,core_audio}.rs` stays compiling; no macOS UI work)
- Client-authored recipes (DEC-13)
