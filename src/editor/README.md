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

| Here | From | Adapted? |
|---|---|---|
| `note/schema.ts` | `src/note/schema.ts` | Yes — see below |
| `note/keymap.ts` | `src/note/keymap.ts` | Yes — task-list handlers removed |
| `note/title-layout.ts` | `src/note/title-layout.ts` | No |
| `note/trailing-empty-line-click.ts` | `src/note/trailing-empty-line-click.ts` | No |
| `transaction-guard.ts` | `src/transaction-guard.ts` | No |
| `markdown.ts` | `src/markdown.ts` | Yes — see *Failure directions* |
| `markdown/parser.ts` | `src/markdown/parser.ts` | Yes — dropped node types |
| `markdown/schema.ts` | `src/markdown/schema.ts` | Yes — mirrors the reduced note schema |
| `markdown/serializer.ts` | `src/markdown/serializer.ts` | Yes — dropped node types |
| `editor-error-boundary.tsx` | `src/editor-error-boundary.tsx` | Yes — see *The error boundary* |

The port is complete. Every file listed in PROVENANCE.md as ours to take is here.

### What the schema drops, and why

Upstream's schema pulls in eight custom node views. Six of them are their product, not ours,
and PROVENANCE.md already says to leave them: `taskList`/`taskItem` (their task model),
`image`/`fileAttachment` (no image handling in v1), `appLink` (Slack/Figma/Linear/Notion
unfurling), `mention-@`, `session`, `clip`.

Dropping them is not just tidying. Each one is a node type the document can contain, and every
node type the document can contain is a shape `modules/extract/` has to read and
`markdown.ts` has to serialise. A notepad the rep types French sentences into needs
paragraphs, headings, lists, quotes, code and tables — and the extraction reads better prose
for it.

Node **names** are kept exactly as upstream spells them (`codeBlock`, `bulletList`,
`listItem`, `hardBreak`) so that a document written by either tree parses in the other.

### Failure directions — the one behaviour change worth arguing about

`markdown.ts` upstream catches everything in both directions and returns a fallback:
unparseable markdown becomes a single paragraph, and an unserialisable document becomes `""`.
Its own test file describes the second one as a known hazard — a node added to the note schema
without its mirror "silently returns '' (killing export, copy-as-md, and LLM snapshots)".

The two directions are kept asymmetric here, because they fail asymmetrically:

- **`md2json` still falls back.** The text survives as one paragraph. The rep sees it and can
  fix it. Nothing is lost.
- **`json2md` now throws `MarkdownSerializationError`.** Its output is what step 8 writes into
  the VSA task's `taskDescription`. A silent `""` means the rep clicks *Valider*, the push
  succeeds, and the CRM records a meeting whose compte-rendu is empty — a failure that looks
  like a success from every side, including the outbox's. Throwing puts it where a failure
  belongs.

The `schema mirror` test is the guard that makes this cheap: its fixture holds every node and
mark the two schemas share, so adding one to `note/schema.ts` and forgetting `markdown/schema.ts`
fails the suite rather than the demo.

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

### What the keymap drops

Upstream's Enter/Backspace/Tab handlers special-case `taskItem` before falling through to
`listItem`. With the node gone the special cases go with them, and the `listItem` paths they
sat in front of are what remain — those are exercised by the ported tests, which is how the
one behavioural regression during the port was caught.
