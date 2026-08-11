# Implementation

The ordered task list. Read [CLAUDE.md](./CLAUDE.md) first for the rules,
[VISION.md](./VISION.md) for *why*, [ARCHITECTURE.md](./ARCHITECTURE.md) for *where*.

**Target: the demo in VISION.md §8.1** — one real meeting, captured live, ending in visible
VerySwing records and an Outlook draft. Every step below is built to demo depth. Anything
marked *deferred* is designed for but not built yet.

Mark steps done by ticking them here. This file is the progress record.

---

## Step 0 — Demolition

```bash
git checkout -b demolition
./scripts/demolish.sh          # denylist pass, from ARCHITECTURE.md §2
./scripts/demolish-residue.sh  # allowlist pass, from ARCHITECTURE.md §3
```

**The repo will not build afterwards. That is intended** (ARCHITECTURE.md §1).

The second script exists because the first under-deletes — §2 groups by *reason*, the tree is
organised by *folder*, so every module §2 named left its test suite behind. See §3.1.

- [x] Run both passes — 362,074 lines removed, 28,000 remain
- [x] Confirm `native-module/src/speaker/`, `microphone.rs`, `resampler.rs`, `vad.rs` survive
- [x] Confirm `electron-builder.signed.cjs`, `patches/`, `scripts/`, `build/` survive
- [x] Trim `native-module/src/lib.rs` to the audio surface, and `Cargo.toml` with it —
      dropping `reqwest` takes tokio, hyper and the TLS stack out of the capture path,
      which makes DEC-26 structural rather than a promise
- [x] 22 test files survive — **but only 8 of them can run.** The other 14 import their
      subject's *compiled* copy from `dist-electron/`, which the legacy tree no longer
      produces; they looked green only because the working copy still held pre-demolition
      build output. `scripts/run-tests.mjs` defers them and prints the list every run.
      See ARCHITECTURE.md §3.1, and step 2 below for the repayment.
- [x] `cargo check` — **verified 2026-08-07**, on macOS 26 with Xcode 26.6. `sillage-audio`
      compiles clean, `npm run build:native` produces `index.darwin-arm64.node` (1.5 MB,
      Mach-O arm64), and it loads and enumerates real devices.

      Three things this cost, worth writing down because each looked like a dead end:
      `cidre` needs **full Xcode**, and the Command Line Tools SDK set — which is what a
      Mac has by default — is not a partial substitute but a hard refusal from
      `xcodebuild`. Moving `Xcode.app` into place is not installing it: the first
      `cargo check` after the switch still failed, on `CoreSimulator` being absent, until
      `sudo xcodebuild -runFirstLaunch`. And the App Store is not the way to get it — a
      download sat at 0 bytes for 35 minutes, while the `.xip` from
      developer.apple.com/download/all took about 90 seconds.

      **The Windows half is still uncompiled**, and cannot be compiled from here:
      `cargo check --target x86_64-pc-windows-msvc` fails inside `webrtc-vad`, which
      builds libfvad from C and wants the MSVC CRT headers. That is what
      `.github/workflows/native.yml` is for.

**Done when:** `git diff --stat main` shows the deletion and nothing in the keep list is gone.

---

## Step 1 — The spine

Nothing hangs off anything until this exists.

- [x] `electron/core/contracts/` — `meeting.ts`, `transcript.ts`, `signals.ts`, `lexicon.ts`,
      `extraction.ts`, `push.ts`, `crm.ts`, `providers.ts`, `diagnostics.ts`, `health.ts`,
      `ipc.ts`. Zod schemas, no logic, no imports outside `core/`. Plus two the original list
      missed: `events.ts` (the log's alphabet — the store needs a typed event union and it is
      cross-cutting, so it cannot live in a module) and `fixtures.ts` (canonical samples; the
      only place a fixture can sit without a boundary violation, since no layer may import
      another's tests).
- [x] `electron/modules/store/` — append-only log:
      `events(meeting_id, seq, ts, type, payload, PRIMARY KEY (meeting_id, seq))`.
      Projections (`meetings`, `outbox`) are derived and rebuildable, never authoritative.
      Built on **`node:sqlite`**, not `better-sqlite3` — see ARCHITECTURE.md §4.
- [x] `electron/modules/diagnostics/` — `DiagEvent` sink into the same log, rolling purge at
      90 days, export bundler. **Ships now, not last** — every later step is debugged through it.
      `core/domain/redactDiagnostics.ts` ships with it, unit-tested against content leakage.
- [x] `electron/app/session/MeetingSession.ts` — the state machine, one file, explicit
      transition table: `idle → armed → recording → ended → extracting →
      awaiting_confirmation → pushing → done`, plus `aborted`. `Orchestrator.ts` alongside it,
      because IPC needs something that owns sessions and the health board.
- [x] `electron/app/main.ts` — boot, ~150 lines.
- [x] `electron/app/ipc/register.ts` + `electron/preload.ts` — both generated from
      `core/contracts/ipc.ts`. Preload has no logic. `ipcMain` is injected into `register.ts`
      rather than imported, so the routing is testable without Electron.
- [x] CI: the import-boundary rule — `scripts/check-boundaries.mjs`, not
      `eslint-plugin-boundaries`. Reasoning in ARCHITECTURE.md §4.
- [x] CI: the VSA-vocabulary containment grep — `scripts/check-crm-containment.mjs`.

**Done:** 88 tests, 86 pass, 0 fail, 2 skipped (packaged-arch, platform-gated). Every edge in
the transition table is exercised — the last test in `MeetingSession.test.ts` walks the table
itself, so an edge added later without a test fails there rather than shipping unexercised.
Events land in SQLite, `replayState` reconstructs the state, `Projections.rebuild()` reproduces
both projections exactly, and the boundary analyser rejects a deliberate
`modules/crm → modules/store` import. `npm run build:electron && electron .` boots, opens the
store and writes its first `app.boot` diagnostic; the only error is the dev server not
answering, because the renderer does not exist until step 5.

Two things this step changed that were not on the list:

- **`scripts/build-electron.js` now builds `core/`, `modules/`, `app/` and `preload.ts` only.**
  The legacy folders do not compile — several import modules that went with the old product —
  and each is repaired at the step that ports it. Keep the list in step with
  `electron/tsconfig.json`'s `include`; they answer the same question.
- **The store's file is `sillage.db`, not the old product's `natively.db`.** The old product left one of the
  latter in `userData` with its own `meetings` table, and `CREATE TABLE IF NOT EXISTS` is a
  silent no-op against it: the app boots and then fails on the first query. `EventLog` also
  refuses to open a database whose version stamp is not its own.

---

## Step 2 — Capture and transcription

- [x] Move `electron/audio/{SystemAudioCapture,MicrophoneCapture,nativeModuleLoader,AudioDevices}.ts`
      → `electron/modules/capture/`. As-is, plus `CaptureSession` to own both channels.
      Two changes were not optional:
      - **The loader could not load the trimmed binary at all.** It hard-required
        `getHardwareId`/`verifyGumroadKey` and smoke-tested with the former; both went with
        `license.rs` in demolition 4/5, so every candidate path failed and `loadNativeModule()`
        returned null *silently* — no devices, no capture, no actionable error. Replaced with
        `abiProbe`, a new pure `#[napi]` function in `lib.rs`. It cannot be a device-enumeration
        call: those instantiate `cpal::default_host()`, which on macOS lights the orange
        microphone indicator at app launch.
      - The native class is now resolved lazily rather than at module scope, and nothing in
        `capture/` touches Electron or `SettingsManager` at import. That is what lets the
        capture path be tested against its source instead of against `dist-electron/`.
- [x] `electron/modules/transcribe/` — provider registry keyed on `ProviderCapabilities`
      (`residency: 'local'|'remote'`, `streaming`, `languages`, `cost`). `selectProvider`
      is pure, so the whole rule is provable with no key and no network. **DEC-33 since:**
      the row declares where it runs and Réglages shows it; it no longer refuses anything,
      and the allow-list flag is gone. **DEC-37 since:** it no longer names a jurisdiction
      either, so it breaks no ties — a tie falls to registry table order. Every refusal that remains names
      the constraint that bit — no key, no weights on disk, unsupported language,
      `offlineOnly` — rather than reporting a generic failure.
- [x] One cloud provider — **Azure Speech (France Central)**, on the ported `RestSTT`.
      **The question that was flagged twice is settled: it does generalise.** Everything
      vendor-shaped is confined to one table — endpoint, auth header, upload mode, extra
      fields, response extractor — and the buffering, VAD flush, silence gate, resample and
      WAV header were already serving five providers. Two constraints it does *not* remove,
      neither of which was in the spec:
      - **The Azure short-audio REST endpoint caps a request at 60 s.** The flush is
        VAD-driven, but a speaker who never pauses is exactly the case that overruns it, so
        `MAX_BUFFERED_BYTES` cuts at 40 s rather than meeting the ceiling as a 400 mid-call.
      - **No phrase lists.** Azure's are a feature of the SDK's WebSocket protocol, not of
        this endpoint, so the descriptor says `boost: 'none'` and the adapter drops boost
        terms rather than sending them to be ignored (DEC-17 — capability-detected, never
        assumed). Whisper-family providers do take them, as `initial_prompt`.
      Both are acceptable because the live transcript is a read-only side surface (DEC-5).
      They would not be for a streaming answer assistant, which is what the file was for.
- [x] Wire both channels to `MeetingSession`. Mic = rep, system = far end. No diarization.
      `app/session/Recording.ts` is the wire; the two modules still do not import each other.
      Transcription starts before capture and stops after it, so neither the greeting nor the
      next steps land on the floor.
- [x] Transcript segments persisted as they arrive (DEC-12) — final only. Interim text is
      broadcast to the pane and never written, or an extraction could cite a span the
      provider later revised away (DEC-21).
- [x] **`LocalWhisperSTT.ts` ported as the offline floor (HR-4)** — `modules/transcribe/
      LocalWhisperSession.ts` plus `modules/transcribe/whisper/`. 2,609 LOC in, ~1,150 out,
      and the difference is one decision: **the streaming loop is gone.** The original ran a
      second inference every 1.5 s over the still-open utterance and reconciled consecutive
      passes with LocalAgreement-2, to put words on screen before the speaker had finished
      saying them. That is right for an assistant that must answer live and wrong here —
      interim text is never persisted and never citable (DEC-21), the transcript pane is a
      read-only side surface (DEC-5), and the second inference is not a cheap extra: it is the
      *same* inference re-run on a growing window, competing with the final pass for the one
      thread `boundedSessionOptions()` allows it, on a laptop that is also encoding video for
      Teams. It bought latency and cost throughput, on the provider that has to work when
      nothing else does. The watchdog, the backoff and the latency telemetry went with it —
      they existed to supervise it. What is left emits finals only, which is what the registry
      already declared: `streaming: false`.

      Also dropped, each for a stated reason: **every English-only checkpoint** (Moonshine,
      all of Distil-Whisper, every `.en` variant — the locale is fixed to `fr-FR` with no
      detection anywhere under DEC-22, so an English-only decoder does not degrade, it
      transcribes French phonetically into English and produces confident nonsense);
      **`modelPreloader`** (a warm worker saves 2–5 s at the first hotkey press, which mattered
      to a hotkey-driven assistant; here the audio simply queues while the model loads and
      nothing is lost — see the backlog in `LocalWhisperSession`); and **the four-way ONNX
      priority gate**, which arbitrated between Whisper, an embedder, a reranker and an intent
      classifier, three of which went with the RAG stack. What replaced it is a plain mutex
      over the *load*, because the case that still bites is real: rep and far end spawn their
      workers within milliseconds of each other and two simultaneous loads of a 500 MB–1.5 GB
      checkpoint double peak RSS at the worst moment in the meeting.

      **Two bugs surfaced in the port, both silent, both fixed:**
      - `MIN_SPEECH_FRAMES` counted every frame spent inside a segment, including the ten
        hangover frames. A 60 ms door slam therefore cleared a four-frame minimum every time,
        and Whisper answered the resulting 360 ms of near-silence with subtitle boilerplate —
        the exact input the hallucination filter exists to catch, generated by the code meant
        to prevent it. The counter now counts frames actually above the threshold.
      - **The hallucination list was English-only**, which is the wrong half for a `fr-FR`
        pipeline. Whisper's French inventions are the subtitling credit lines
        ("Sous-titres réalisés par la communauté d'Amara.org", "❤️ par SousTitreur.com") and
        they are worse than noise: fluent, and DEC-21 would verify their span perfectly
        happily, because the words really are in the transcript. Whole-segment matches stay
        exact — "merci" alone is boilerplate, "merci, on vous envoie la proposition" is the
        most important sentence in the call.

      Kept and worth keeping: the crash-loop sentinel (ORT can abort the *process* during a
      load, which no in-memory handler survives — the disk record turns crashes-forever into
      crashes-at-most-once), the byte-weighted progress aggregator, the fp32-encoder/q8-decoder
      dtype map, and the tail-keep across a forced cut.
- [x] Restore the five capture tests — `CaptureRestartRegression`, `CaptureStopAwaitable`,
      `MicrophoneCapturePreWarmFailed`, `PreWarmGatedAfterTeardown`,
      `SystemAudioOrphanHandleOnStartFailure`. Replaced by
      `modules/capture/__tests__/capture.test.ts`, which runs against the `.ts` with a fake
      binary injected at the loader's one test seam. 16 assertions, no build.
      `NativeDodoSoftRequired` was deleted rather than restored: it grepped the old loader's
      source for licensing methods that no longer exist.
- [x] **Deferred tests: 9 → 3.** Six were superseded by the ports and deleted with their
      subject; one was *replaced*, which is the interesting one.
      - `WhisperLoadSentinel`, `WhisperProgressAggregator`, `WhisperExternalDataFormat` →
        covered behaviourally in `modules/transcribe/__tests__/whisper.test.ts`, against the
        `.ts`, with no build.
      - `LocalWhisperSpawnFailTeardown`, `LocalWhisperStuckWorker` → these grepped the old
        class's *source text* for `streamingTaskInFlight` resets, so they could not survive
        the loop being deleted. The invariant under them did survive and is now stated as
        behaviour: **the session must never be left in a state where nothing will ever
        complete and nothing says so.** A `stop()` that hangs is worse than a lost tail —
        the meeting never reaches `ended`, so the rep's document never receives its AI block.
      - `ModelPreloaderTakeWarmWorker` → deleted, not restored: the preloader is not ported.
      - `RestSttSafetyNetGate` → **replaced, because it pinned the opposite of what step 2b
        decided.** It asserted, by grepping the source, that the flush guards on `isActive` at
        entry. That guard does stop post-stop uploads — and it also discards the last thing
        said in the meeting, because `stop()` clears the flag before draining. `RestSttSession`
        now takes an injectable `upload`, and the three properties are asserted directly: the
        tail is uploaded exactly once, nothing is uploaded after stop however the session is
        poked, and a stopped session never re-arms its safety net.
      Still deferred: `GoogleSTTDropsKeepaliveSilence` and `openaiTranscriptTurnCoalescer`
      (their subjects are the streaming providers kept as reference material, below), and
      `ReleaseNotesManager` (until `electron/update/` finds a home in `app/`, step 9).
- [x] `systemAudioHealthClassifier.mjs` moved to `modules/capture/` with its test.

*Deferred: the model download UI and its catalog screen — `modules/transcribe/whisper/
catalog.ts` has the presence check and the sizes, but nothing drives a download yet, so today
the offline floor is available only if the weights are already under
`userData/whisper-models/`. `isLocalWhisperReady()` is what `selectProvider` should be handed
as `configured`. Also deferred: device picker UI, mid-session provider failover, model
pre-warm at arming time (step 3 gives a natural five-minute window for it), reconnect/backoff
polish (port the logic from `OpenAIStreamingSTT.ts` when needed — reference only, don't ship
the provider). `GoogleSTT.ts`, `DeepgramStreamingSTT.ts`, `OpenAIStreamingSTT.ts` and
`dnsHelpers.ts` are the only files left in `electron/audio/`, kept deliberately as that
reference; `LocalWhisperSTT.ts`, `whisper/` and `RestSTT.ts` are deleted, having been ported.*

**Done when:** a real Teams call produces two labelled channels of French transcript in
SQLite, and pulling the network mid-call does not stop capture (DEC-26).

**Status:** every module is built and unit-tested — 179 tests, 177 pass, 0 fail, 2 skipped
(platform-gated), 3 deferred. The "done when" is **not met yet**, and cannot be from a test
suite: it needs a real call. The two things to check on that call are the ones no fake can
show — that the far channel really is everyone else and the mic really is only the rep, and
that unplugging the network mid-sentence degrades transcription to `⚠ dégradé` while capture
keeps writing. For the offline half, the model has to be on disk first; there is no download
UI yet (see the deferred list above).

---

### Seven things that were built but not connected

Found by booting the app rather than by a test, which is why they are recorded here:

- [x] **Nothing opened the devices.** `dispatch('start')` moved the machine to `recording`;
      `startRecording` is what opens the microphone — and outside `devRecord.ts` nothing
      called it. Pressing *Démarrer* produced a session that reported `recording` and captured
      nothing: the one failure a notetaker may not have, and one that looks completely healthy
      from every surface. The orchestrator now opens on the **edge into `recording`**,
      symmetrically to closing and enhancing on `recording → ended`. A resolver that finds no
      usable provider **aborts** the meeting rather than leaving it claiming to record; no
      resolver injected at all is silent, because that is the dev harness driving recording
      itself.
- [x] **The lexicon was unreachable.** `buildBoostSet` and `store.lexicon.forClient()` were
      built and tested in step 4, and no production path called either — `boostTerms` was
      supplied only by the terminal harness. It is now assembled in `main.ts` at the moment a
      meeting starts, because that is when it can be: the terms depend on *which* meeting it
      is (DEC-17). `modules/transcribe/config.ts` is new and is the only file in that module
      that reads `process.env`, mirroring `modules/llm/config.ts`.
- [x] **`allowRemoteModels` was unconditionally true** in the whisper worker. A missing cache
      entry would have turned a recording into a HuggingFace download, over whatever network
      the rep's client happens to be on, at the moment a call is starting — which DEC-26
      forbids outright. It is now opt-**in**, so the offline default is what you get by
      omission rather than by remembering. Nothing on a shipping path asks for it: the weights
      travel inside the installer.
- [x] **A transcription outage lasted the rest of the meeting.** A provider error was recorded,
      reported as `degraded`, and then nothing: the sessions stayed pointed at the dead
      provider, so from the moment a hotel network dropped, every remaining word was lost.
      "Degraded, never down" is the right half of DEC-26 — capture keeps running — but it read
      as *recoverable*, and it is not: the audio is discarded as it is transcribed (DEC-12), so
      there is nothing left to re-transcribe afterwards.

      `TranscribeSession` now takes a `fallbackProviderId` and moves onto it after
      `FAILOVER_AFTER_ERRORS` (3) consecutive failures on either channel — roughly fifteen to
      thirty seconds of speech for a batch provider, past the point where "the network came
      back" is the likely explanation. **Both** channels move, because what kills a cloud
      provider is not a property of one microphone. It is **one-way**: a fail-back would reload
      a model each way and leave one transcript carrying two engines' vocabularies with nothing
      marking the seam. Segments record the engine that actually produced them, and the health
      strip says `repli sur la transcription locale` rather than `ok` — the quality drop is
      real and a panel that hid it would make the transcript inexplicable.
- [x] **`local-whisper` claimed to be configured on machines that had never downloaded it.**
      It has no credential to be missing, so `configuredSttProviders` always listed it, and
      `recordingOptionsFor` handed that straight to the selector — which would pick it on an
      unprepared machine and have transformers start a several-hundred-megabyte transfer during
      the meeting. Exactly what `isLocalWhisperReady` was written to prevent, bypassed by the
      one caller that mattered. The same gap ran the other way in Réglages, which considered
      *only* the local engine and so would report `local-whisper` while a meeting ran on Azure.
      `usableSttProviders()` now reconciles configured-in-the-environment with
      installed-on-disk, and is the single source both callers use.
- [x] **The model's health was answered once, at boot, and never again.** `crmHealth` and
      `mailHealth` are both called on every drain; `llmHealth` — written for exactly this and
      sitting beside them — had no caller at all. So a key that expired at 14h and a provider
      that started returning 503s both left the strip reading `ok` while every compte-rendu
      failed, which is the specific state DEC-26 says a rep must be able to see.

      `Enhancement` now reports its outcome through an injected `onOutcome`, and `main.ts`
      maps it. The mapping is injected rather than done in `Enhancement` because it needs
      `modules/llm` *and* `modules/extract` and a module may not import another module — and
      the kinds are not interchangeable: `llm` reads the real reason off its `LlmError` cause
      (auth is not retryable, a quota is), `reply-invalid` and `deterministic-leak` are
      degraded-with-a-real-retry because the provider answered and regenerating is the remedy,
      and `empty-transcript` reports **nothing**, because no model was ever asked and pointing
      the rep at the LLM would send them to the wrong subsystem.
- [x] **Meetings never ended on their own.** `decideEndOfMeeting` — DEC-9 and DEC-16's whole
      rule, with both grace windows and a passing unit suite — had no caller. A meeting ended
      only when the rep pressed *Terminer*, so a call they walked away from recorded until the
      app was closed.

      The rule was pure and stayed pure; what was missing was everything around it. **The VAD
      only signalled one edge.** The Rust suppressor fires `speech_ended` on the speech→silence
      transition and nothing on the way back, and on its own "no `speechEnded` for 75 seconds"
      is equally true of an empty room and of somebody talking without pause. `CaptureSession`
      now emits `speechStarted` too, derived from a frame that is not the suppressor's
      zero-filled keepalive — an exact test, not a second threshold, because the level decision
      was already made in Rust and two VADs that disagree is worse than one.

      `app/session/EndOfMeetingWatch.ts` holds the countdown: silence is judged on **both**
      channels (a call where the rep is talking and nobody answers is not over, nor the
      reverse), resuming audio cancels it silently, and the deadline is **re-asked** rather
      than trusted — a laptop that suspends mid-meeting wakes past the deadline and must end
      then, not one full window later. `OrchestratorOptions.timers` sits beside `clock` so the
      75-second window is testable at all.
- [x] **A destroyed window could take the main process with it.** Found by the test above, not
      by inspection. `webContents.send` throws once the window is gone; most dispatches come
      from an IPC handler where that merely rejects a call, but DEC-16's automatic end comes
      from a **timer**, and an exception there is unhandled. Closing the window during a silent
      meeting is not exotic — it is how a rep leaves for lunch. `#broadcast` is now wrapped
      once at construction rather than guarded at each of a dozen call sites: a broadcast is a
      readout, never a dependency.

---

## Step 3 — Identity and calendar

Ahead of the UI deliberately: it supplies the surnames step 4 boosts on and the client
identity the session screen shows before anyone speaks.

- [x] `electron/modules/identity/` — MSAL public client, no client secret. PKCE, the loopback
      redirect and the system-browser hand-off are MSAL's `acquireTokenInteractive`; the rules
      worth testing (forbidden scopes, which account to restore, what a silent failure means)
      sit behind a four-method interface in `MsalIdentity.ts` and need no tenant to exercise.
- [x] Token cache in the OS credential store via `keytar` (`vault.ts`), wired as an MSAL
      `ICachePlugin`. **`@azure/msal-node-extensions` deferred**, deliberately: it carries a
      native addon needing a per-Electron-ABI rebuild, and keytar — already a dependency —
      reaches the same stores (Keychain, DPAPI-backed Credential Manager, libsecret). Revisit
      for the Windows WAM broker, which is the part keytar genuinely cannot do.
- [ ] **Entra app registration — blocked, and not ours to create.** It lives in the tenant
      that runs the demo. Multi-tenant (DEC-1) → authority `/organizations`, work accounts
      only. Platform *Mobile & desktop*, redirect `http://localhost`, "Allow public client
      flows" on, **nothing under Certificates & secrets**. Delegated scopes `Calendars.Read`,
      `Mail.ReadWrite`, `User.Read`, `offline_access`. The client id it yields is public by
      design and is read from `SILLAGE_ENTRA_CLIENT_ID`; absent, the app boots as a notepad
      with `calendar` `down` and a reason (DEC-26), which is what the whole module is built to
      degrade into.

      **A tenant admin will be involved once, at a real client.** None of the four scopes is
      flagged *admin consent required*, but that is a different question from whether a rep may
      approve them alone. The default tenant setting since ~2020 allows user consent only for
      Microsoft's low-impact set (`User.Read`, `offline_access`, `openid`, `profile`, `email`);
      `Calendars.Read` and `Mail.ReadWrite` sit above it, so the first rep sees *Approbation de
      l'administrateur requise* (AADSTS90094) and an admin approves once for the whole tenant
      from the same screen. Handled, not merely documented: `isConsentFailure()` in
      `core/contracts/identity.ts` reads the entra code (never the localised prose) and
      `signIn()`/`token()` raise `ConsentRequiredError`, which `calendarHealth()` reports as
      **down and not retryable** with the French line that says who to ask. Retrying is what a
      generic error would have made the rep do, forever.
- [x] `electron/modules/calendar/` — `GET /me/calendarView/delta`, paged to the `@odata.deltaLink`.
      `Prefer: outlook.timezone="Europe/Paris", odata.maxpagesize=50`. No
      `$select`/`$filter`/`$orderby`/`$expand` — Graph rejects them on a delta query, so
      ordering and filtering happen on the folded result.
- [x] `MeetingContext` (DEC-15) mapped in `mapEvent.ts`: subject, `bodyPreview` as agenda,
      organizer, attendees with names + emails + response status, `onlineMeeting.joinUrl`,
      categories, sensitivity, scheduled start/end, `seriesMasterId`.
- [x] Events with `sensitivity = private | confidential` are dropped **at the boundary** —
      `mapEvent` returns null, so the subject never enters the database. An event that turns
      private between two syncs removes the copy already held. `arming.ts` checks again,
      because a `MeetingContext` can also arrive from a manually started session.
- [x] `core/domain/arming.ts` — arm at `event.start − 5 min` AND a conferencing app present.
      Also skips: private events, blocks with no attendee and no join link, plages over 4 h
      (the all-day guard), and anything already over. `nextArmable()` picks the earlier of two
      overlapping calls and returns the **earliest** wait horizon, not the first one found.
- [x] `core/domain/endOfMeeting.ts` — silence + 75 s grace, 25 s once past the scheduled end
      (DEC-16). The short grace is chosen by when the silence *started*, not by the clock, so a
      pause that spans the scheduled end is not cut mid-sentence. Manual *Terminer*
      short-circuits; audio resuming cancels silently. **Pure and tested, not yet wired** — it
      needs the capture-side silence signal, which arrives with the session screen (step 5).
- [x] `electron/modules/capture/MeetingApps.ts` — the process half of `MeetingDetector`
      (VISION.md §210). `ps` / `tasklist`, cached 15 s, single-flight, and it never throws: a
      machine where the probe is unavailable loses automatic arming and nothing else.
- [x] `electron/app/session/Agenda.ts` — the loop. Syncs every 5 min, re-evaluates on the
      horizon `arming.ts` hands back, and on `arm` creates the session and dispatches `arm`.
      **It never dispatches `start`** (HR-7): arming is an offer a human accepts. Meeting ids
      are `sha1(graphEventId)`, so a restart re-arms the meeting it already created instead of
      opening a second row for one conversation.
- [x] IPC: `auth:state` / `auth:signIn` / `auth:signOut`, `agenda:snapshot` / `agenda:refresh`,
      broadcasts `agenda:changed` and `auth:changed`. **No token ever crosses IPC.**
- [x] `modules/store` schema 3 — the `app_state` table. Cursor and fold are persisted as one
      value: a cursor saved without the events it was earned by would, on the next boot, ask
      Graph only for what changed *since*, and the app would come up with an empty calendar
      and no way to notice.

**The process signal says "a conferencing app is running", not "a call is in progress."**
Teams starts with Windows and stays open all day, so on its own it would arm for everything.
It is only ever the second half of a conjunction whose first half is a five-minute window
around a real event with real attendees — and arming is still only an offer. The refinement
(the loopback actually carrying sound) waits on an always-on level probe that does not exist:
capture only opens the device once recording starts.

**A Graph `dateTime` is not a `Date`.** With `Prefer: outlook.timezone` set, times come back
as `2026-08-05T14:00:00.0000000` with the zone named separately and **no offset in the
string**. `new Date(s)` gets machine-local — right on a French laptop, an hour out on a CI box,
and wrong twice a year everywhere. `time.ts` resolves it through `Intl`, two passes so the
lookup lands on the correct side of a DST change.

*Deferred: recurrence/`seriesMasterId` linking, prior mail thread as account history, the WAM
broker, and a UI for choosing between two cached accounts (today, two accounts and no
remembered choice means signed out rather than a guess).*

**Done when:** the app arms itself from a real Outlook event without being told, and
`MeetingContext` is populated before the call starts. *Everything but the registration is
built and tested; the end-to-end run needs a client id.*

---

## Step 4 — Lexicon

Cheap, and every later step reads a better transcript.

- [x] `core/domain/lexicon/terms.fr-esn.ts` — the static list, human-reviewed: TJM, régie,
      forfait, intercontrat, ESN, AO, portage, ADR, CV anonymisé, astreinte, préavis, etc.
      Plus the English tech terms kept verbatim under DEC-22 (backend, Kubernetes, sprint,
      staffing, release).
- [x] `core/domain/lexicon/boost.ts` — `MeetingContext` → per-meeting hotwords. **Attendee
      surnames are the highest-value terms in the product** and the calendar gives them free.
- [x] Capability-detected boosting in `transcribe/`: Azure phrase lists, Deepgram keyterms,
      Whisper `initial_prompt`. Never assume support.
- [x] STT locale fixed to `fr-FR` (DEC-22). No language detection anywhere.

**`prompt_ids` is not the Whisper boost channel — `decoder_input_ids` is.** transformers.js
declares `prompt_ids` on `WhisperGenerationConfig` and comments it out of `generate()`, so
passing it is a silent no-op: measured on a real call, identical audio came back byte-for-byte
identical with and without a glossary. The lexicon reaches the decoder only as a hand-built
`<|startofprev|> …terms… <|startoftranscript|> <|fr|> <|transcribe|> <|notimestamps|>` prefix,
whose echo is then stripped from the output (`modules/transcribe/whisper/prompt.ts`). This is
the DEC-17 failure mode occurring inside our own code, so treat any future boost channel as
unproven until a before/after says otherwise.

- [x] `core/domain/lexicon/correct.ts` — known-variant repair after the fact. Promoted out
      of "deferred" because measurement made it the *primary* lever, not the fallback.
- [x] `modules/store` `lexicon` table + `scripts/lexicon.mjs` — per-client and per-account
      terms, enriched by hand today and by `termsLearnedFrom()` once the calendar lands.

**The boost prompt is small and specific on purpose.** Swept on four 25 s clips of real
calls: 0 terms → 128 words transcribed, 5–20 terms → ~82 with the target nouns fixed, 40
terms → 66 with the nouns *lost again*. Past ~20 terms a Whisper prompt collapses the decode
(25 s of speech returned as "et des services de la production."), and generic vocabulary in
the prompt inserts itself into speech — one run opened a segment with "CDI," where nobody
said it, which in a CRM-bound transcript is an invented contract type. So: budget 12, scoped
terms only, shipped vocabulary reserved for `correct.ts` where an unmatched term costs
nothing. Three client-scoped terms outperformed every larger list tried.

*Deferred: fuzzy/phonetic matching in `correct.ts`. It repairs unseen mistakes and invents
new ones, and a wrong repair is invisible — the output is a plausible French word either way.*

**Done when:** "TJM", "régie" and "intercontrat" transcribe correctly in a recorded sample
that previously mangled them. This is demo beat #2 — keep the before/after.

*Measured on a real client call (`scripts/replay.mjs`, same 150 s of audio, both arms):
`mon **cher point** de préprôde` → `mon **SharePoint** pré-production`, `**Charcot** et il
marche` → `**SharePoint**, il marche`, `mon dossier **rag**` → `mon dossier **RAG**`. One
regression, `une heure` → `inut`: a prompt biases the whole decode, not only its terms.*

---

## Step 5 — The session screen

The screen the demo is watched on.

- [x] Port from `vendor/anarlog-editor/` into `src/editor/` — see
      `vendor/anarlog-editor/PROVENANCE.md` for what to leave and `src/editor/README.md` for
      what was adapted. **Complete:**
  - [x] `note/schema.ts` — adapted: upstream's eight custom node views are down to zero.
        `taskList`/`taskItem`, `image`/`fileAttachment`, `appLink`, `mention-@`, `session` and
        `clip` are their product, and every node type the document can contain is a shape
        `modules/extract/` has to read. Node *names* kept exactly (`codeBlock`, `bulletList`,
        `listItem`, `hardBreak`) so a document written by either tree parses in the other.
  - [x] `note/title-layout.ts`, `note/trailing-empty-line-click.ts`, `transaction-guard.ts` —
        verbatim, with their tests.
  - [x] Renderer test harness: **vitest + jsdom**, driven from `scripts/run-tests.mjs` so
        `npm test` is still one command. A second framework, for one reason — the ported code
        keeps its upstream tests and those tests are vitest. Rewriting them into `node --test`
        would be rewriting the thing that made the port worth doing.
  - [x] `scripts/lib/boundaries.mjs` fix: the renderer rule denied `src/` importing *itself*.
        It is about what the renderer may reach into `electron/` for, not one import path and
        no other; `src/editor/note/title-layout.ts` needs `./schema`. Regression test added.
  - [x] `note/keymap.ts` — adapted: upstream's Enter/Backspace/Tab handlers special-case
        `taskItem` before falling through to `listItem`; with the node gone the special cases
        went and the `listItem` paths they sat in front of are what remain.
  - [x] `markdown.ts` + `markdown/{parser,schema,serializer}.ts`. **One deliberate behaviour
        change:** upstream catches everything in both directions, so an unserialisable
        document becomes `""`. Its own test file calls that out as a known hazard. Here
        `json2md` throws `MarkdownSerializationError` instead, because its output is what
        step 8 writes into the VSA task's `taskDescription` — a silent `""` means the rep
        clicks *Valider*, the push succeeds, and the CRM records a meeting whose compte-rendu
        is empty. `md2json` still falls back, because unparseable markdown degrades to the
        same text as one paragraph and loses nothing.
  - [x] `editor-error-boundary.tsx` — French, and it says **« L'enregistrement continue. »**
        That sentence is the point: the capture path has no dependency on the renderer
        (DEC-26), so a dead editor costs the notepad and nothing else, but a rep who does not
        know that will hang up to restart the app. `onError` replaces `console.error` so a
        crash reaches DEC-27's bundle.
  - [x] `src/design/tokens.test.ts` parses VISION.md §6's own ```css block and fails if
        `tokens.css` has drifted from it — in both directions, so an invented `--brand-blue`
        is caught too. Palette drift is the quietest kind of design rot.
- [x] `src/design/` — blume tokens from VISION.md §6. Fraunces + Inter, both **vendored**
      under `src/font/` with their OFL text. Not a preference: the renderer's CSP is
      `default-src 'self'` with no `font-src` escape, and a notetaker that fetches a font on
      open leaks *when a rep is in a call* to a third party, from inside a client's network.
      Gelica and SN Pro are not shipped — they are commercially licensed.
- [x] `index.html`, `tailwind.config.js` and `vite.config.mts` rebuilt off the old product's.
      What was in them: Inter from fonts.googleapis.com, googletagmanager allowed as a script
      source, `connect-src` reaching Google Analytics and a Vercel deployment, and a
      `manualChunks` entry for `@huggingface/transformers` that was pulling a **21 MB ONNX
      runtime `.wasm`** into a bundle with no use for it (whisper runs in the main process).
      The renderer bundle is now 135 kB gzipped.
- [x] **`meeting:create`** — starting a meeting the calendar knows nothing about. Not a
      fallback: with no Entra registration this is the *only* way a session begins. The
      client name rides on the `meeting.created` event rather than being written into the
      projection, because the projections are a fold and nothing else (ARCHITECTURE.md §5.C) —
      a direct write survives until the first rebuild and then quietly disappears.
- [x] `npm run check` now typechecks `src/` too. It never did, which is a hole that only
      mattered once the renderer became most of the remaining work.
- [x] `src/screens/Session.tsx` — notepad (the only editable surface, widest, the only
      cursor) | `SignalRail`, with `LevelMeter` in the header (DEC-14 as amended by DEC-38).
      The `TranscriptPane` is deleted: it proved the tool was alive seconds late and not at
      all during a pause, and the meeting that settled it — 37 % input volume, every window
      under the transcriber's speech floor, one line in two minutes — looked on that pane
      exactly like a quiet room. The meter answers instantly and greys the bars the
      transcriber would drop. The rail now renders a fixed slate of slots rather than a sort
      by `seq`, which makes "never reorders" structural: there is nothing to reorder past.
- [x] `electron/modules/signals/` — rolling transcript chunks → chips, ~1 call/minute.
      Read-only, and structurally so: nothing exported can produce a ProseMirror transaction,
      and a test asserts it. Chunking is measured in **transcript time**, not wall clock, so a
      replay produces the same chips as the live call. A chip whose quote cannot be located in
      the stored transcript is **dropped, not downgraded** — the rail is glanced at during a
      call and has no room for a caveat. Dedup happens before a `seq` is handed out, so a fact
      mentioned three times keeps the number it first got.
- [x] Wired through the orchestrator, which is the only thing allowed to know both
      `modules/capture` and `modules/signals` exist. Signals are **persisted** as events and
      then broadcast, so the rail survives a restart by replay. The transcript is broadcast
      *before* the producer is offered the segment, and inside a `try` — a wiring test caught
      a throwing producer travelling back up the capture path, which DEC-26 forbids.
- [x] `src/screens/Agenda.tsx` — the day's meetings, armed state, quiet accent dot. Only the
      armed row offers a way in; an unarmed row is information, not a control. *Nouvelle
      réunion* is permanent rather than an empty-state fallback, because without Graph it is
      the only door.
- [x] `src/screens/HealthStrip.tsx` — DEC-26 made visible. Silent when everything is fine;
      `reason` is mandatory on the type so it can never be a bare dot, and *Réessayer* appears
      exactly when `retryable` says so.
- [x] Persist every ProseMirror transaction on a ~500ms debounce (DEC-12), flushed on
      unmount and on `pagehide`. A failed write puts the work back rather than dropping it, so
      a transient IPC failure costs a delay and never the paragraph. Selection-only
      transactions are not document changes — saving on them would mean a write per arrow key.

*Deferred: collapse-state persistence, keyboard polish, Mes notes / Enrichi toggle.*

**Done when:** typing feels instant, the transcript scrolls without stealing focus, chips
appear as facts are spoken, and killing the app at minute 40 loses at most half a second.

---

## Step 6 — Extraction

- [x] `electron/modules/llm/` — provider registry, same capability shape as STT. BYOK +
      Ollama/OpenAI-compatible (HR-5). Where a provider runs is **data in the descriptor
      table** and **DEC-33 made it data only**: every provider is listed with it stated, and
      a configured provider is never refused for it. **DEC-37** removed the jurisdiction
      claim, so it no longer breaks ties either — a tie falls to registry table order. `structured()` revalidates against the caller's zod schema **even
      when the server promised enforcement** — a server that advertises `json_schema` still
      truncates at its token ceiling, and the extraction is the longest output we ask for.
- [x] `core/domain/spanVerification.ts` — built early because step 5's signal rail needed it.
      `locateQuote` returns *where* the words were said, so channel and timings are measured
      from the transcript rather than taken from the model.
- [x] `electron/modules/extract/` — the **compte-rendu commercial ESN** recipe (DEC-13, one
      fixed shape). The old `services/meeting/` helpers were **not** reused: the import rule
      forbids `modules/extract` reaching into `electron/services/`, `generateStructured` and
      `MeetingSummarySchemaValidator` are superseded by `LlmPort.structured` + zod, and
      `TranscriptChunker`/`TranscriptNormalizer` are built for a different segment shape and
      strip English fillers. Written fresh; the one idea carried over is the token-budget
      chunk-with-overlap.
- [x] **Map-then-reduce, with a map stage that does not summarise.** Summarise-then-extract
      cannot satisfy DEC-21: a summary is paraphrase, so every field would cite words nobody
      said, `locateQuote` would fail on all of them, and *every* field would arrive `⚠ faible`
      — the measurement correct and the product useless. The map stage returns short French
      notes each carrying a citation copied verbatim from its chunk. Under ~45 minutes the map
      stage is skipped entirely.
- [x] `ExtractionESN = { facts: DeterministicFacts, interpretation: LlmInterpretation }`.
      `LlmInterpretation`'s zod schema **has no fields** for emails, dates, account codes or
      attendee names (DEC-7). A model that emits them fails validation.
- [x] **DEC-7's second channel**, which a schema cannot close. A strict schema stops a model
      returning a name as *data*; nothing in it stops
      `"compteRendu": "Réunion avec Camille Le Roy (camille.leroy@…) le 12/03/2026"`.
      `deterministicLeaks.ts` walks every string except the citations and refuses e-mail
      shapes, French phone shapes, fully-qualified dates, and any attendee name from
      `MeetingContext`. Citations are exempt on purpose — they are transcript verbatim, people
      introduce themselves on calls, and a citation never becomes CRM data. The model is never
      shown the attendee list, which is what makes a match unambiguous rather than an echo.
      A leak fails the **whole** reply; scrubbing the sentence would leave a compte-rendu
      written by a model that misunderstood its job.
- [x] Every interpretive field carries a cited transcript span. Unlike the signal rail, an
      unverifiable quote here is **downgraded, not dropped** — the review gate has room to
      show the caveat and the rep can correct it, which a chip glanced at mid-call does not.
- [x] `core/domain/spanVerification.ts` — pure function, checks the span exists in the stored
      transcript. No verifiable span → `⚠ faible` (DEC-21). Unit-tested.
- [x] Enhancement fires automatically on end-of-meeting — `app/session/Enhancement.ts`,
      triggered by the **edge** `recording → ended` and not by the state `ended`. The
      distinction is load-bearing and a test pins it: `extractionFailed` also lands on `ended`,
      so keying on the state re-runs a failing extraction forever, at the model's expense,
      with nobody watching. Output French unconditionally.
- [x] `Enhancement` dispatches **through the orchestrator**, not onto the session. A
      transition made straight on the session advances the machine without broadcasting, so
      the rep would watch a spinner that never resolves while the compte-rendu sat finished in
      the database. A test caught this one too.
- [x] `core/domain/documentText.ts` — the rep's notes flattened to text for the recipe. In
      `core/domain/` because `app/` may not import `src/editor/`, and because it is a pure
      rule over a data structure. Total by construction: an unreadable document yields `''`,
      which runs the extraction on the transcript alone — the ordinary case where the rep typed
      nothing. Throwing would turn an unreadable note into a failed compte-rendu.

*Deferred: user-initiated regeneration with edits as prompt context.*

**Done when:** a recorded French sales call produces a compte-rendu a salesperson would
recognise as their own. **This is demo beat #3 and the only one that cannot be faked** —
budget real time for prompt iteration here.

---

## Step 7 — The review gate

- [x] `src/screens/Review.tsx` — compte-rendu left, extracted fields right, each editable,
      each with `[source ▸]`. Email draft previewed inline.
- [x] Three independently selectable intents (DEC-20): task, opportunity, Outlook draft.
      All drafted automatically, each uncheckable. **One** *Valider* button (DEC-4).
- [x] Account field always pre-filled with the best candidate + `⚠ faible` when weak (DEC-18).
      Sibling accounts listed inline — the shape ships (`panel.accountCandidates`, rendered as
      one-click overrides); it stays empty until `modules/crm` resolves against VSA in step 8.
- [x] Never surface anything while `MeetingSession` is `recording` (DEC-23).

*Deferred: source-span drill-down UI, the evening nudge notification.*

Two channels, both in `core/contracts/ipc.ts` with their schemas in `core/contracts/review.ts`:
`review:get` returns a **closed union** (`{ open: false, state, reason }` carries no `panel`
field at all) and `review:confirm` takes the form plus the checked intent ids. The rules live
in `core/domain/reviewGate.ts` — pure, no store, no Electron.

**DEC-23 is structural in three places, not remembered in one.** The response has no panel to
leak while `recording`; `review:confirm` goes through `MeetingSession.dispatch('confirm')`,
which the transition table permits from `awaiting_confirmation` and nowhere else, so a
mid-call confirmation writes zero events; and `Session.tsx` only renders *Relire et valider* in
that same state, so there is no route into the screen during a call.

**`⚠ faible` is read, never computed in the renderer.** `reviewFields()` reads
`VerificationReport.fields` — an array row takes the worst of its items (`objections.2`
`faible` marks the row) — and the account row takes `report.fields.account` or
`facts.account.confidence`, both measurements and neither the model's. `LlmInterpretation`
has no account field at all (DEC-7), so there is no third source to read by accident.

Two decisions that were not on the list. **Unchecking the opportunity rewrites the task's
`dependsOn`**, rather than leaving an edge to an intent nobody is creating — the task would sit
`blocked` forever otherwise, which the outbox has no way to distinguish from a slow CRM.
And **mail recipients are not in `ReviewEdits`**: the rep edits subject and body, but the
addresses are derived from `facts.interlocuteurs` in the main process, because a renderer that
can post an address is a renderer that can post one a model invented (DEC-7).

**Done when:** the whole payload is correctable in under 30 seconds and one click ships it.

---

## Step 8 — CRM and mail — the payoff

Read `docs/reference/vsa-api.md` before starting. It has the real shapes and three gotchas.

- [x] `core/contracts/crm.ts` — `CrmPort`: `resolveAccount`, `pushCompteRendu`,
      `createContact`. Domain verbs only, no VSA vocabulary (DEC-29).
- [x] `modules/crm/vsa/generated/` — typed client from
      `docs/reference/vsa-sandbox-openapi.json`. Never hand-edited.
- [x] `modules/crm/vsa/fieldMap.ts` — `ExtractionESN` ⇄ VSA columns as **data**.
- [x] `modules/crm/vsa/referentials.ts` — cache task types/status/priorities, sales stages,
      probabilities. Never hard-coded.
- [x] `modules/crm/vsa/probe.ts` — connect-time capability diff (DEC-24).
- [x] Entity resolution: `GET /v1/prospect-contacts?email=` first (exact match, works for
      personal addresses), then domain, then other attendees, then sibling grouping.
      **v1 does not auto-create prospect accounts** — the endpoint needs address/activity/tax
      fields a meeting cannot produce. Use `linkType: FREE` + `freeProspectId` instead.
- [x] `modules/mail/` — `POST /me/messages`. Draft only. Never `Mail.Send` (HR-8).
      Enforced structurally, not by convention: one URL builder taking no arguments, scopes
      through `rejectedScopes()` at construction *and* per request, and a test that reads the
      module's own source and fails on a send path or the events resource (DEC-10).
- [x] `app/session/Outbox.ts` — drains a **DAG**: opportunity before the task carrying its
      `oppyId`; draft independent. A failed dependency blocks only its dependants.
      Persist the returned `id` in the same transaction that drains the intent.
- [x] `ConnectorHealth` wiring — VSA down greys the CRM intents **with the reason inline and
      a retry**, and the Outlook draft still ships (DEC-26). The Review screen reads health
      itself rather than having it folded into `review:get`, because it changes independently
      of the panel: VSA can come back while the screen is open and should stop saying it is
      down without a reload.

      **Greying does not disable the checkbox**, and getting that backwards would be the
      expensive mistake. The outbox drains what it cannot send yet, so an intent confirmed
      while VSA is unreachable is *queued*, not lost. Disabling it would send the rep away to
      come back later — the second prompt DEC-4 exists to prevent — and would quietly turn an
      outage into a dropped compte-rendu. `available: false` is a different thing and still
      disables: it means there is nothing to send at all (no opportunity in the extraction, no
      recipient for a draft), which no amount of reconnecting fixes.
- [x] Attach the raw transcript via `POST /v1/crm/tasks/{id}/attach`.

**Done when:** *Valider* produces a visible task, opportunity and contacts in the sandbox plus
a draft in Outlook — and killing VSA mid-push still ships the draft and leaves the row
retryable, not lost.

---

## Step 9 — Historique and Réglages

Deliberately last, deliberately cheap: the data has been in the log since step 1.

- [x] `src/screens/Historique.tsx` — every call, searchable, expanding into transcript /
      raw notes / compte-rendu / extraction with spans / push status per intent (DEC-25).
- [x] `src/screens/Reglages.tsx` — provider tiers, connector state, probe result.
- [x] Diagnostics panel: recent errors, retention setting, two exports.
      `core/domain/redactDiagnostics.ts` is a **pure function**, so "contains no client
      conversation content" is a unit test, not a claim (DEC-27).

Three channels, and the first one is the whole design: `history:search` (the query runs in
the main process — the alternative is shipping every transcript to the renderer so it can
filter, which puts the corpus of client conversations in a devtools console), `history:record`
(fetched only when a row opens), `settings:snapshot`.

Four things this step changed that were not on the list, each because the alternative was a
screen that lies:

- **`tier` is now a field on both provider descriptors.** VISION.md asks for a three-tier
  model and it is not derivable from `residency`: a model served by the client's own vLLM is
  `residency: 'local'` — nothing leaves the perimeter — but it is an operated service with a
  URL and an outage, not an engine in this process. Deriving it would have filed « installez
  le modèle » and « vérifiez l'URL du serveur » under one heading.
- **`CapabilityReport` moved to `core/contracts/crm.ts`**, and `modules/crm/vsa/probe.ts` now
  aliases its own `ProbeReport` to it. `src/*` may import `core/contracts/` and nothing else,
  so a report that only existed inside the adapter could never reach the screen DEC-24 wrote
  it for. Nothing in the contract names a VerySwing concept — `table`, `column` and `schema`
  are the vocabulary of any record store.
- **`ProviderRowSchema` refuses an unselectable row with no reason**, as a zod refinement.
  HR-11's visible half is that every provider is *listed with its residency*, and an unusable
  one carries the reason. A row that says "indisponible" and nothing else cannot cross the
  boundary at all. (Residency itself stopped being one of those reasons — DEC-33.)
- **The probe runs at boot and again on *Réessayer*, into a variable.** It is six network
  calls; opening Réglages must not cost them and three visits must not cost three. "Not
  finished yet" is a sentence in the panel, not an absent section.

*Cut from the demo entirely.*

---

## Demo preparation — not optional

Neither of these is in the step list and both are needed for VISION.md §8.1.

- [ ] **Seed the sandbox** — a plausible French ESN account base: accounts with
      `parentTiersCode` groups, contacts with emails, the referentials populated. The payoff
      beat is records appearing in VerySwing; an empty CRM makes it land on nothing.

      **The seeder is written — `scripts/seed-vsa.mjs`, `npm run seed:vsa`. It has never
      been run against the sandbox, because no `SILLAGE_VSA_*` credentials exist on any
      machine here yet.** That is the only thing between this bullet and a tick.

      Twelve accounts and fifteen contacts, shaped for what they have to exercise rather
      than for volume: `Groupe Acme` holds the company `fixtures/transcript-acme.json`
      names, on that fixture's own domain, so the replay path pushes somewhere real;
      `Groupe Ravel` puts three subsidiaries on **one shared domain** under a holding with
      no contacts of its own, which is INPUT-2 and the only input in the base that produces
      DEC-18's `⚠ faible` sibling list; one contact sits on a consumer domain, which is
      INPUT-1 and resolves only through the exact `?email=` lookup. Verified against a stub
      tenant seeded with this exact table — the fixture resolves `ok` at 1.0 with its two
      siblings listed, the shared-domain trio comes back as three `faible` rows at 0.78
      with the family, and the personal address resolves `ok` at 0.95.

      `--dry-run` is the default and reads only; `--apply` is the one mode that writes;
      `--offline` prints the plan with no credentials and no network. Every record is
      looked up before it is created and skipped with a note if it is there, because
      `POST /v1/prospect` answers 200 with no body and no idempotency key — the same
      problem as `POST /v1/crm/tasks`, and re-running a half-finished seed against a
      **shared public sandbox** must not double the base.

      Two things it deliberately does not do. It **cannot populate the six referentials**:
      none of them has a POST anywhere in the 261-path spec, so it reads them, prints which
      are empty, and says an admin has to fill those in the VerySwing UI — calling that
      "seeded" would be a lie that only surfaces mid-demo. And it does not add its four
      write endpoints to `generated/operations.ts`; `VsaCrm.ts` documents at length that
      the product never calls `POST /v1/prospect`, and a typed `createProspectAccount` in
      the shared client is an invitation to call it from `app/` later.

      One finding came out of building it, and it is a product bug rather than a script
      one: **`resolveAccount` cannot see customer contacts at all.** `Directory.snapshot()`
      bulk-loads prospect contacts only — `/v1/prospect-contacts` has no customer twin —
      and `Directory.customerContacts()` is called by nothing in the tree. A meeting with a
      contact on the customer side therefore resolves on name matching alone, at 0.62–0.68
      `⚠ faible`, against 0.95 `ok` for the same person as a prospect contact. That is the
      whole established-client half of an ESN's CRM. The seed set works around it for now
      by putting the demo's account on the prospect side (truthful anyway — the fixture is
      a first qualification call) and keeping two customer accounts so the branch stays
      seeded and the gap stays visible.
- [x] **A replay fixture** — `fixtures/transcript-acme.json` plus
      `npm run replay:extract`. A synthetic French sales call (25 segments, ~2½ min of speech;
      **no real client conversation is stored in this repo**) driven through the real
      `CompteRenduRecipe` with no audio, no devices and no calendar.

      It exists because step 6 says demo beat #3 is the only one that cannot be faked and to
      budget real time for prompt iteration — and iterating against a live meeting is not
      iterating, it is waiting for someone to have a call. This makes the loop seconds long
      and keeps runs comparable, because the input never varies. With no model configured it
      says so and exits: a silent fallback would make a missing key look like a bad prompt.

      Verified end to end against a stub OpenAI-compatible server: the compte-rendu renders
      with its five fixed sections, all nine interpretive fields verify their citations
      against the stored transcript (`global: ok`), the unresolved account carries `⚠ faible`,
      and a reply that names an attendee is refused whole with `kind: deterministic-leak`.
      Live capture in front of an audience fails for reasons unrelated to the product: a
      bluetooth headset, a muted device, a hotel network. This is the rehearsal harness and
      the fallback. Costs an afternoon.
- [ ] **Rehearse the four beats** in order (VISION.md §8.1): armed itself → vocabulary right
      → compte-rendu reads French and commercial → records appear live.

---

## Step 10 — The redesign (DEC-30, DEC-31, DEC-32)

The design is settled in `../design/untitled.pen` and the palette and screens are written into
VISION.md §6. **None of it is in the code yet.** This step is the port, and it is larger than a
restyle because two of the three decisions add surface area rather than repaint it.

| # | Work | Settles |
|---|---|---|
| 10a | **Repaint the tokens.** `src/design/tokens.css` and its transcription check in `src/design/tokens.test.ts` both move from the cream palette to the brand ramp. Carry the measured contrast ratio in a comment beside every colour that ever holds text — the ramp exists because `#4dc2fb` is 2.01:1 on white and cannot. | VISION.md §6 |
| 10b | **Splash screen.** `src/screens/Splash.tsx`. Three boot lines fed by real state (store open, devices enumerated, model present), plus the first-run download with progress. Nothing optional is awaited — the window must not wait on Graph, VSA or Outlook. | DEC-30 |
| 10c | **Local STT is the default.** Provider selection prefers `local-whisper` when its weights are on disk; `usableSttProviders()` already reconciles configured-vs-installed, so this is an ordering change plus a French-string sweep. Delete every string calling local transcription *dégradé* — including the `'repli sur la transcription locale'` health reason emitted by `modules/transcribe/index.ts` on failover. Failover to local stays; announcing it as a degradation stops. | DEC-30 |
| 10d | **The calendar.** The largest piece. `Agenda.tsx` today filters to `isSameDay(now)` and renders a flat list — there is no grid, no day selection, no `Jour · Semaine · Mois · Liste`, and no past-meeting section. All of that is new. It must render with `auth.status !== 'signedIn'` and on an empty day. | DEC-31 |
| 10e | **Rich search, and Historique's new entry point.** A search field plus filter chips (client, période, statut, intention) over the day list, running in the main process as `Historique`'s already does — the renderer never holds a corpus it did not ask for. Remove the `Historique` nav link from `Agenda.tsx` and `Reglages.tsx`; the back link in `Historique.tsx` becomes *‹ Calendrier*. | DEC-25, DEC-31 |
| 10f | **One status control.** Delete `HealthStrip.tsx`. Replace with a header control that reads `capture`, `transcribe` and `llm` only and navigates to Réglages. `calendar`, `crm` and `mail` keep publishing `ConnectorHealth` — they simply stop feeding the aggregate. | DEC-32 |
| 10g | **Réglages, two-pane.** Section list left, content right. Connectors split **Requis** / **Facultatifs**, with the sentence at the top of the section stating what the header control means. Local listed first under Transcription. | DEC-30, DEC-32 |

The CI check that matters here: a grep for *dégradé* near the transcription strings, and the
existing `tokens.test.ts` drift check — which will fail the moment 10a lands and is the point.

## Known open items

- ~~`RestSTT.ts` may not generalise past one vendor.~~ **Settled in step 2b: it does.** What
  it does not do is stream, and the Azure REST endpoint it lands on has a 60 s cap and no
  phrase lists — see step 2 for what that costs and why it is affordable here.
- `electron/update/ReleaseNotesManager.test.mjs` is deferred with the capture tests, for the
  same reason and with a different repayment date: `electron/update/` has no home in the new
  layout yet. It joins `app/` when the updater is wired, which is step 9 at the earliest.
- **DEC-11 rides untested to the demo.** No rep has been observed on a real call. With no
  tenant and no rep access this is the accepted trade — the demo is what earns the field test.
- INPUT-1 (personal-address share) and INPUT-2 (holding structures) are unknown but now
  measurable directly from the VSA API rather than needing a client export.
