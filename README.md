# Sillage

> Target user: sales reps ("commerciaux") at a French ESN.

A desktop meeting notetaker that **never joins the call**. It listens to the
machine's own audio, transcribes it, produces structured French notes tuned to
ESN sales vocabulary, and — after one human confirmation — pushes them to
VerySwing (VSA) and drafts a follow-up email in Outlook.

The rep never types a CRM entry again. That is the whole product.

**Status: rebuilding.** This repository previously held a different product, a
real-time answer assistant. That product has been demolished and this one is
being built in its place. The first deliverable is a live demo against the
public VSA sandbox (DEC-28), not a client deployment.

## Read these first

They are the spec, not background.

| File | What it settles |
|---|---|
| [VISION.md](./VISION.md) | 29 decisions (DEC-1…29), 11 hard requirements (HR-1…11), UI/UX |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Repo decision, kill list, module layout, build order |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | The ordered task list. **Start here.** |
| [CLAUDE.md](./CLAUDE.md) | Working rules: import boundaries, invariants, conventions |

## Layout

The folder structure is the pipeline. Data flows one way.

```
electron/core/       pure. no electron, no i/o, no network. contracts + domain logic.
electron/modules/    one external boundary each. capture, transcribe, calendar,
                     identity, llm, signals, extract, crm, mail, store, diagnostics.
electron/app/        electron wiring. main, session state machine, ipc, windows.
src/                 renderer.
native-module/       the Rust audio crate (WASAPI loopback + CoreAudio tap, mic,
                     resampler, VAD) behind napi-rs.
```

The import rule, enforced in CI:

```
core/*      → may import nothing but core/
modules/X   → may import core/ and modules/X/.  NOT modules/Y.
app/*       → may import core/ and modules/*.
src/*       → may import core/contracts/ only.  Never modules/, never app/.
```

Modules never talk to each other; the orchestrator wires them. That one rule is
what prevents another 11,810-line `ipcHandlers.ts`.

## Commands

```
npm test                  # the suite. prints which tests are deferred, and why
npm run check             # typecheck + import boundaries + CRM containment + naming
npm run build:electron    # esbuild → dist-electron (core/, modules/, app/, preload)
npm run app:dev           # vite + electron
```

`npm test` needs no build: `.ts` runs directly under Node's type stripping.

## Invariants that are easy to break

- The rep's document is never written by AI during a call (DEC-5, DEC-14).
- Deterministic data never comes from the LLM (DEC-7).
- Confidence is measured, not self-reported (DEC-21).
- Never write to the Outlook event body (DEC-10).
- Drafts, never sent mail (HR-8). `Mail.ReadWrite`. Never `Mail.Send`.
- Raw audio is never retained (DEC-12).
- The capture path has zero network dependencies (DEC-26).
- Every provider row says whether the audio leaves the machine, and `offlineOnly` means it does not (DEC-33, DEC-37).

See [CLAUDE.md](./CLAUDE.md) for the full list and the reasoning.

## Privacy and security

[PRIVACY.md](./PRIVACY.md) — what is recorded, what leaves the machine, and when.
[SECURITY.md](./SECURITY.md) — the threat model and how to report a finding.

## Licence

Proprietary and unlicensed. No terms are granted; settle them in writing before
the code leaves your hands.
