# src/editor

Ported from `vendor/anarlog-editor/` (fastrepl/anarlog, MIT, commit `f10709e`). DEC-8 chose
raw ProseMirror over TipTap precisely so this code could be reused.

**The vendor copy is never edited.** Files are copied here and adapted here, which is what
keeps a diff against upstream possible later. Their tests come with them — they encode
ProseMirror edge cases that are expensive to rediscover.

Upstream's formatting (semicolons, double quotes) is kept deliberately, for the same reason:
a reformatted port cannot be diffed against the file it came from. Code written *for* this
product follows the repo's own style.

MIT requires the licence and copyright notice travel with the code. It is at
`vendor/anarlog-editor/LICENSE` and every ported file names its origin.

## Ported so far

| Here | From | Adapted? | Reached by |
|---|---|---|---|
| `note/schema.ts` | `src/note/schema.ts` | Yes — see below | `Notepad.tsx` |
| `note/keymap.ts` | `src/note/keymap.ts` | Yes — task-list handlers removed, `onNavigateToTitle` dropped, `NOTE_SHORTCUTS` added | `Notepad.tsx`, `screens/Reglages.tsx` |
| `note/trailing-empty-line-click.ts` | `src/note/trailing-empty-line-click.ts` | No | `Notepad.tsx`'s plugin list |
| `transaction-guard.ts` | `src/transaction-guard.ts` | No | `Notepad.tsx`'s `dispatchTransaction` |
| `editor-error-boundary.tsx` | `src/editor-error-boundary.tsx` | Yes — see *The error boundary* | `screens/Session.tsx` |

**The last column is the point.** Four of the ported files had no entry in it for as
long as they existed: 1147 lines with 48 green tests and no caller, all marked `[x]`
« Complete » in IMPLEMENTATION.md. Three of them are wired now and two are deleted,
and the standing rule is the repo's — a module here is wired or deleted, never
excused by a docblock.

### What was deleted, and why

- **`note/title-layout.ts`** (+ its test) forced the document's first block to be an
  `h1`, because upstream's note *had* a title line. This document does not: a
  meeting's title is the calendar's objet, drawn in the session header, and DEC-5
  says nothing writes into the rep's document during a call. Wiring it would have
  rewritten the rep's first sentence into a 24px heading on the first keystroke of
  every call. `note/keymap.ts`'s `onNavigateToTitle` parameter, and the `ArrowLeft`,
  `ArrowUp` and `Shift-Tab` handlers that hung off it, went with it for the same
  reason: there is no title field to navigate to, and no caller ever passed one.
- **`markdown.ts`, `markdown/{parser,schema,serializer}.ts`** (+ `markdown.test.ts`)
  were a ProseMirror ⇄ markdown pair with no caller and **no route to one**. The
  claim that justified its one deliberate divergence from upstream — « its output is
  what step 8 writes into the VSA task's `taskDescription` » — was not true: the
  rep's notes reach `modules/extract` as plain text through
  `core/domain/documentText.ts`, whose own docblock says why the flattening lives
  there (`app/` may not import `src/`, ARCHITECTURE.md §4). The import rule makes
  that structural: `src/*` may import `core/contracts/` only, so nothing outside the
  renderer can ever call these, and nothing inside it wants to — the compte-rendu is
  drawn by `CompteRenduDocument`, which is deliberately not a markdown renderer
  (DEC-44). Deleting them dropped `markdown-it` and `prosemirror-markdown` from
  `dependencies`, which `build.files` was shipping whole inside every installer:
  2.5 MB of `node_modules` for a function nobody called. Nothing is lost —
  `vendor/anarlog-editor/` still holds all four files with their tests, and the port
  takes an hour on the day a caller exists.

### What the schema drops, and why

Upstream's schema pulls in eight custom node views. Six of them are their product, not ours,
and PROVENANCE.md already says to leave them: `taskList`/`taskItem` (their task model),
`image`/`fileAttachment` (no image handling in v1), `appLink` (Slack/Figma/Linear/Notion
unfurling), `mention-@`, `session`, `clip`.

Dropping them is not just tidying. Each one is a node type the document can contain, and every
node type the document can contain is a shape `core/domain/documentText.ts` has to flatten
for `modules/extract/` to read. A notepad the rep types French sentences into needs
paragraphs, headings, lists, quotes, code and tables — and the extraction reads better prose
for it.

Node **names** are kept exactly as upstream spells them (`codeBlock`, `bulletList`,
`listItem`, `hardBreak`) so that a document written by either tree parses in the other.

### The error boundary

Recovery behaviour is upstream's, untouched: remount once automatically, then show a manual
reload and stop. One automatic retry, because a second remount of a component that has thrown
twice is a render loop, and a render loop mid-meeting is worse than a visible error.

Three adaptations:

- The copy is French and it says **« L'enregistrement continue. »** That sentence is the point.
  The capture path has no dependency on the renderer (DEC-26), so a dead editor costs the
  notepad and nothing else — but a rep who does not know that will hang up to restart the app.
- `onError` replaces `console.error`, so the app can route a crash into `modules/diagnostics`
  where DEC-27's bundle can find it. A crash that only ever reached a devtools console nobody
  had open is a crash we never hear about.
- Blume tokens instead of upstream's `bg-muted` / `text-muted-foreground`.

### The error boundary can now fire for the failure it was written for

`transaction-guard.ts` catches a throw out of `applyTransaction` — and until it was called,
`Notepad.tsx` applied transactions bare. A throw there happens inside a ProseMirror DOM
handler, which React does not see, so no boundary fired and the sentence above could not be
shown for the one failure DEC-8 names `transaction-guard` as a reason to port at all. The
guard hands the error to React state and the component throws it in render, which is the only
thing a boundary catches. The last good document crosses the remount in memory
(`RECOVERED`, the shape of the gate's `PENDING_EDITS`), because the boundary's recovery *is* a
remount and a remount reads `initialDoc` — the document as it was when the screen opened.

### What the keymap drops, and what it gained

Upstream's Enter/Backspace/Tab handlers special-case `taskItem` before falling through to
`listItem`. With the node gone the special cases go with them, and the `listItem` paths they
sat in front of are what remain — those are exercised by the ported tests, which is how the
one behavioural regression during the port was caught.

Two things were added, and both are about a vocabulary that existed in the CSS and nowhere
else. `NOTE_SHORTCUTS` is the block table the keymap binds and Réglages prints; `Backspace`
starts with `undoInputRule`, because a rule fires on a space and « 1. » at the start of a line
is a numbered list here and a date in a rep's notes. And `navigator.platform` is gone: it
decided whether `Mod-y` was redo and whether eight Cocoa keys were re-declared here, which is
the mac-first mistake HR-2 is about. The digit combinations are bound under **both** modifiers
(`app/shortcuts.ts`'s rule); the letters keep `Mod-`, because inside a `contenteditable` on
macOS `Ctrl-A` is « start of line » and binding *select all* over it would mean a rep selecting
their whole page of notes and replacing it with the next character they type.
