# vendor/anarlog-editor

Vendored copy of `packages/editor` from **fastrepl/anarlog**.

| | |
|---|---|
| Upstream | https://github.com/fastrepl/anarlog |
| Commit | `f10709e065143750ad008353f0bfc6e9129beac7` (2026-08-04) |
| Licence | MIT — see `LICENSE` |
| Size | 16,476 LOC (`.ts`/`.tsx`, tests included) |

## Why it's here

DEC-8 chose raw ProseMirror over TipTap specifically so this package could be ported.
It is vendored rather than referenced because the original clone lived in `/tmp` and would
not survive a reboot.

## What we actually port

Take:

| Path | Why |
|---|---|
| `src/note/schema.ts` | The note document schema |
| `src/note/keymap.ts` + test | Keyboard behaviour, the thing DEC-11 lives or dies on |
| `src/note/title-layout.ts` + test | Title/body layout |
| `src/note/trailing-empty-line-click.ts` + test | The click-below-to-focus affordance |
| `src/transaction-guard.ts` + test | Transaction safety |
| `src/markdown.ts` + test | ProseMirror ⇄ markdown, needed for `taskDescription` |
| `src/editor-error-boundary.tsx` + test | A crashed editor must not take the session with it |

Leave:

| Path | Why not |
|---|---|
| `src/chat/` | We have no chat surface |
| `src/comments/` | No commenting in v1 |
| `src/app-link/` | Slack/Figma/Linear/Notion link unfurling — not our product |
| `src/task-storage.tsx`, `src/task-source.tsx`, `src/tasks.ts` | Their task model, not ours |
| `src/image-markdown.ts`, `src/note/portable-attachments.ts` | No image handling in v1 |
| `daily/` | Their daily-note concept |

## Rules

- **Do not edit files in this directory.** Port what you need into `src/editor/`, then
  adapt there. Keeping the vendor copy pristine is what makes diffing against upstream
  possible later.
- Their tests come with the ported files. Keep them — they encode ProseMirror edge cases
  that are expensive to rediscover.
- MIT requires the licence and copyright notice travel with the code. `LICENSE` stays.
