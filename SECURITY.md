# Security

## Reporting a vulnerability

This is a pre-release client deliverable with no public release channel. Report
anything you find privately to the repository owner rather than opening an
issue.

## What the app can reach

The threat model follows from what the product actually does — it listens to a
meeting, reads a calendar, and writes to two systems of record.

| Surface | Scope |
|---|---|
| Machine audio | Microphone + system loopback, capture only. **Raw audio is never written to disk** (DEC-12): frames are transcribed and discarded. |
| Microsoft Graph | `Calendars.Read` and `Mail.ReadWrite`. **Never `Mail.Send`** (HR-8) — the app creates drafts and a human sends them. It never writes to an event body (DEC-10). |
| VerySwing (VSA) | Writes only after one explicit human confirmation (DEC-4). |
| Speech-to-text | Either fully local (Whisper, HR-4) or an EU-resident provider (HR-11). Soniox, ElevenLabs and Speechmatics are excluded on residency grounds. |
| LLM | Interpretation only. Deterministic data — names, emails, dates, account codes — never comes from a model (DEC-7). |

## Secrets

API keys and tokens live in the OS keychain (macOS Keychain / Windows DPAPI) via
`CredentialsManager`, with an encrypted file fallback when no keychain is
available. Nothing is committed: `.env` is ignored and `.env.example` carries
empty values only.

## Diagnostics

The diagnostic log is redacted by an **allowlist**, not a denylist
(`electron/core/domain/redactDiagnostics.ts`): numbers, booleans and short
identifier-shaped strings survive; everything else is replaced by a type-and-
length placeholder. A field added upstream cannot leak by being forgotten here.
Export bundles are built from that same redacted view.
