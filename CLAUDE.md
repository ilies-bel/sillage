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
- **There is a second window, and it is the widget over the call** (DEC-49,
  `app/windows/Overlay.ts`, `src/widget/Widget.tsx`). Frameless, always on top at the
  `screen-saver` level, absent from the taskbar, shown with `showInactive()` and created
  exactly while a meeting is `recording`. One bundle and one HTML file: `?window=widget` is
  what `src/main.tsx` reads to decide which of the two renderers it is. Three things are
  load-bearing. **A saved position is a request, never an instruction** — this window has no
  title bar, no taskbar entry and nothing to alt-tab to, so an origin on a monitor that has
  since been unplugged is *unrecoverable*; `overlayPlacement.ts` honours a saved origin only
  if the window would land on a real display by at least a quarter of its own area, and
  clamps it inside. **The window is the size of its own content** (`widget:resize`): every
  pixel of a transparent always-on-top window that is not the pill is a pixel of Teams the
  rep cannot click. And **the widget is not an open app** — `second-instance`, `activate` and
  the teardown all name `mainWindow` rather than `getAllWindows()[0]`, and the pill is closed
  with the main window so `window-all-closed` still fires and `before-quit` still ends the
  live meeting properly instead of leaving a process with no way back into it.
- **The widget may draw the transcript; the session screen still may not** (DEC-49, DEC-38).
  The clause DEC-38 wrote is « do not reintroduce a live transcript *to prove the tool is
  working* », and that job now belongs to an instrument. The meter is on the pill whether the
  panel is open or not; the transcript is behind a press and names the side (DEC-47).
  `transcript:appended` had been broadcast for every segment of every meeting since the
  orchestrator was written and subscribed to by nobody; this is the surface that keeps that
  promise. **The window collects it, never the panel** — the panel is mounted by a press and
  unmounted by the next one, so a transcript held there began at the press and was destroyed
  by the one that closed it, which is the feature not working on precisely its own use case.
  And **no provisional text**: a draft drew interim results muted and called that a difference
  over Granola, and `isFinal: false` cannot occur — `LocalWhisperSession` and `RestSttSession`
  both emit `true` and every row in `STT_PROVIDERS` declares `streaming: false`. It was a
  rendering no run of this product could produce, covered by a test that fed it a fixture and
  by a harness stub that manufactured the input. A non-final segment is dropped in one line.
- **The halo is not the widget, and the widget is not in the screen share** (DEC-49).
  `getBoundingClientRect` does not include a `box-shadow`, so sizing the window to the card
  clipped the shadow to nothing — and the shadow is the only thing separating a pale card from
  the video call underneath, which `tokens.css` says itself. Every harness screenshot showed it
  perfectly, against five hundred pixels of the app's own paper: the same blind spot as
  `--expand`. The frame reserves the shadow's extent and gives those pixels back with
  `widget:passThrough` → `setIgnoreMouseEvents(…, { forward: true })`, which still delivers
  moves so the pointer coming back over the card can switch it off. And the window carries
  `setContentProtection(true)`: it floats above everything on every Space, which is exactly
  what a rep shares when they share their screen, and what is on it is the client's name,
  their words and the rep's own commercial notes.
- **The pill's anchor is the pill** (DEC-49, `overlayPlacement.ts`). The first version
  anchored a window *edge* — bottom edge in the bottom half of the display, like a menu — and
  the pill is drawn at the **top** of the content with the panel under it, so holding the
  bottom still moved the control the rep had just pressed by the height of the panel:
  **333 pixels, on the default placement, on the first press of the first call.** The docblock
  argued the rule at length and the unit test asserted it faithfully, and neither could see it,
  because they measured rectangles and never asked what is drawn at the top of one. The
  renderer now reports where the pill sits inside the frame (`pillTop`, measured, never a
  constant two files must keep equal) and the main process answers with `above` — which way
  the panel stacks — because only it knows which display the pill is on, and the renderer needs
  it *before* it lays the panel out. `scripts/e2e.mjs` measures the pill's screen position
  across an open and a close on the real window, which is the only place a window has one.
- **A mark is the rep's, and it is never inferred onto a sentence** (`core/contracts/marks.ts`).
  A turn is written down *after* it is spoken — `modules/transcribe` stamps a segment with its
  arrival and says a batch provider cannot report acoustic time — so « the turn nearest the
  timestamp » is a guess, and this product does not guess about evidence (DEC-21). Pressed on
  a *line*, the mark carries that line's id and is drawn on it, because the rep pointed at it;
  pressed on the pill, it is a moment in time and claims nothing about the turns either side.
  `interleaveMarks` is in `contracts` for the reason `speakerLabel` and `meetingAnchor` are:
  three surfaces draw it — the widget's live list, the gate's reader, *Historique*'s — and
  `src/*` may import nothing else. A mark survives a call with **no transcript at all**, which
  is the case that needs it most and the one both readers used to swallow. A mark can be
  **taken back** — it is typed one-handed over a client's face and sent on `Enter`, so a typo is
  made here more easily than anywhere else in the product and is read again at the gate in the
  rep's own words — and taking one back is an event (`moment.forgotten`), never a delete
  (DEC-27). **The broadcast is the only way the widget's list changes**: it does not insert
  what `meeting:mark` returned, because an optimistic insert draws a row whose write may not
  have happened *and* leaves the broadcast doing nothing, which is how a channel ends up
  declared and unreached.
- **Proof of life is the input meter, not a live transcript** (DEC-38). The transcript pane
  was removed: it was seconds late, blank through every pause, and looked identical whether
  the room was quiet or the microphone was too quiet to transcribe — which is a meeting that
  actually happened. The header meter draws the amplitude measured on the capture path and
  greys every bar the transcriber would drop — **both channels**, mirrored about a baseline,
  the rep above and the far end below, because "nobody is being heard" and "the client is not
  being heard" have opposite fixes. The transcript itself is untouched: captured, stored, and
  still the only thing a citation may point at (DEC-21). Do not reintroduce a live transcript
  surface to prove the tool is working; that job now has an instrument.
- **The compte-rendu is typeset, and every marker stays on screen.** The document is drawn by
  `CompteRenduDocument` — the `#`, the `##` and the `- ` hang muted in a left gutter, the way an
  editor shows them, and the prose beside them is set as prose. That is not a markdown renderer
  and must not become one: the invariant below is that VerySwing receives the string the rep
  read, and a renderer *hides* the markers, so a table that appeared would look like a table on
  screen and land in the CRM as literal pipes. `compteRenduLines.ts` recognises exactly the
  closed vocabulary the recipe writes; anything else falls through and is drawn verbatim, which
  is the point. Its one property — `serialize(parse(x)) === x` — is proved for every fixture,
  and a DOM test asserts the pane's own text still contains every marker. The prompt's soft
  wraps are undone at *composition* time by `unwrapProse`, not at render time, so the stored
  string is the clean one.
- **One reading measure, `.measure` in `index.css`, `58ch` — and the number is measured, not chosen.** The notepad, the compte-rendu on
  three screens, the follow-up draft and Réglages' prose all share it. Every one of them used to
  set its own width, and each was set by what fit rather than by what reads — 98 characters a
  line in the notepad, 130 at the gate. Nothing is clipped and nothing overlaps, which is
  exactly why three screenshot reviews missed it: an unreadably long line is invisible in a
  picture. A new pane that holds prose uses the class; it never picks its own number.
  It was `38rem`, which is a *different* measure at every font size that lands in it —
  eighty-seven characters at `--type-copy` and a hundred and eleven at `--type-meta` — so
  the class written to end this problem was reintroducing it one size down, on the caption
  under the compte-rendu and on Réglages' explanations. `ch` resolves against the element's
  own size, so prose that is not inside a `.measure` wrapper wears the class itself.
  **The class goes on the element that holds the prose, never only on a wrapper**:
  `ch` resolves against the *element's own* font size, so a wrapper wearing it at
  `--type-copy` leaves a `--type-ui` child completely unconstrained — which is how
  the follow-up draft rendered **eighty** characters a line, and the gate's eleven
  field boxes seventy-eight, while `--prose` reported the screen green. The check
  now measures **every element owning ninety characters of its own text**, not
  just the ones wearing the class, because a surface that forgot it is precisely
  the failure the rule exists to prevent and the old selector could never see it.
  It was then `66ch` for four rounds, and `66ch` is **not sixty-six characters**: `ch` is the
  advance of the digit zero, which in Inter is ~9.4px against ~7.7 for average French
  lowercase, so every `.measure` surface rendered **eighty-one** — the rule written to end
  ninety-eight-character lines had been fifteen over its own number since the day it was
  written, because nothing counted. `shot.mjs --prose` counts, ceiling 75, and `smoke.mjs`
  runs it on every stage; the detector's `line-length` is zero as well and is the weaker of
  the two checks. Do not change the number without re-running the count.
- **The harness fixture is the document the composer writes, or the design pass is
  fiction.** `bridge-stub.mjs`'s compte-rendu was four invented headings for five review
  rounds — no deterministic header, no « Éléments retenus », no list sections — roughly half
  the length of the real thing, and every screenshot judgement about the three-column session
  layout and the two-column gate was made against it. Making it faithful surfaced three
  defects in one shot: `## Objections et points de vigilance` and `## Prochaines étapes` were
  each written **twice** into every ESN document (the model's narrative and the appended list
  collided, so the CRM got both), and `**gras**` / `_italique_` were drawn as literal
  asterisks because the typesetter's vocabulary stopped at the line. A fixture shorter or
  simpler than the output flatters every layout it appears in.
- **The measurement reaches the button** (DEC-21, DEC-4). A gate with an unverified field
  drew a *Valider* pixel-identical to a clean one. The primary now reads « Valider malgré N
  champ(s) non vérifié(s) » in `caution`, and the line under it names the fields — same
  control, same gesture, nothing withheld, because a greyed primary is a button a rep presses
  and withholding would be a second gate. The reveal control is a **page turn** and not a jump
  to the end, for the same reason: arming is measured from the scroll position either way, but
  one teleport measures *revealing* and a page turn measures reading.
- **One anchor for when a meeting is** — `meetingAnchor` in `core/contracts/meeting.ts`,
  `scheduledStart ?? startedAt ?? createdAt`. It lives in `contracts` because `src/*` may
  import nothing else, and three screens had each written their own version: Historique
  printed one order, the pending list another, and the store ordered by `updated_at`, which is
  not a date but the last time the log touched the row. A call validated late sorted above a
  call held two days after it. `endedAt` is never consulted — a recording left running
  overnight would move to the next morning.
- **A row names its client once.** The objet a rep types opens on the client's own name
  almost every time (« Sodexial — comité de staffing »), so `meetingHeading` strips the prefix
  it duplicates. Drawn raw, the strongest line on the row was a word repeated three pixels
  below it.
- **A `failed` push is not a missing *Réessayer*, it is a missing sentence.** `Outbox` retries
  everything it safely can — an adapter that knows nothing was created answers
  `{ ok: false, retryable: true }` and the row stays `pending`. `failed` is the opposite case:
  the attempt threw, nobody knows whether the record exists, and `POST /v1/crm/tasks` has no
  idempotency key, so a retry button is a duplicate in the client's CRM one click away. The
  cause and the application to go look in are now on the collapsed row, where the orange count
  is, instead of two clicks below it.
- **Whatever `border-*` can say, `ring-*` must be able to say.** `StateDot`'s `pending` tone
  was `ring-card` and drew *nothing at all* for two rounds because `ringColor` was not in
  `tailwind.config.js` — same failure as `bg-muted/30`: a name that is right, a rule that does
  not exist, an element simply unstyled. The splash's « Audio » row had a hole where the other
  two rows have a dot.
- **The arming guard remembers *which view* was read, and never charges for it
  twice.** Coverage is a set keyed by what the column is showing — `compte-rendu`,
  `transcription`, and for the rail the sorted set of checked intents, which is the
  payload — with the height it was covered at. Everything hard about this was
  learned by being wrong in both directions. Too coarse, and a rep armed *Valider*
  on seventeen hundred unseen pixels by opening the Transcription tab, or by
  shrinking the window; unchecking « Opportunité » turned nine rows read-only and
  inserted a paragraph saying so that a rep at the bottom of the rail never saw.
  Too fine, and the guard punished the correction it exists to invite: stamping one
  view at a time charged thirteen page turns to fix one word, six of them
  re-showing the compte-rendu just read. **Lecture and Modifier are one view** —
  the same string, sixty-eight pixels of textarea chrome apart — and Transcription
  is another. Growth never invalidates (a taller box has *less* below the fold);
  a shrink beyond `SHRINK_SLACK = 64` does, because two lines of the decision
  footer reflowing on their own is chrome, not a resize, and treating it as one
  made the guard oscillate. `scripts/harness`'s `review-garde` stage is the proof:
  eight attacks that must be refused and four returns that must be free, all driven
  against real layout — jsdom measures every box as zero, so the renderer's tests
  can only assert that an unmeasurable column fails **open**.
- **A column is not read until its content has arrived, and the guard has to be told when
  it does.** One click on *Transcription* armed *Valider* at 1280×800 with the compte-rendu at
  `scrollTop` 0 — `TranscriptReader` fetches its own record and draws a placeholder that
  **fills the column** (`scrollHeight === clientHeight`), so the view was covered the instant it
  painted; the transcript then replaced it and nothing re-measured, because a scroller's own box
  does not change when its content grows and nobody scrolls when content appears. Four presses
  of the rail's page turn and the press that writes the VerySwing task was on screen. It held at
  960×600, where the placeholder does not fit — so the defect was on the **larger** window, the
  one every screenshot review and every gate stage runs at. Three rules state the one property
  now, and each is enough on its own: coverage remembers the **content** height it was covered
  at (`GROWTH_SLACK`, a hundred, because *Lecture* and *Modifier* are one view sixty-eight
  pixels of textarea chrome apart); the view key says « chargement » until the record lands, and
  is forgotten on the way out of the tab so the *second* visit cannot stamp over a placeholder
  either; and the `ResizeObserver` watches each column's **first child** as well as the column,
  because that is the box that changes. `review-garde-transcription` is the proof and it needed
  its own stage: `review-garde` is one rep in one sitting, and by its eighth attack that rep has
  legitimately read both columns, so nothing appended to it can reproduce this.
  **And the harness fixture was the reason no stage could ever see it**: every responder in
  `bridge-stub.mjs` resolved in the same microtask, so no loading state ever painted. A fixture
  faster than the product hides every one of them; `review:transcript` now answers after a tick.
- **Nothing hides inside the columns the guard measures.** The gate's guard
  measures two boxes and withholds *Valider* until both have been shown, under a
  caption that says so; a scroller *nested* in one of them is a hole in that
  claim, and one no screenshot shows, because a clipped textarea looks exactly
  like a short one. There were eleven: `FieldRow` sized its box from
  `value.split('\n')` — a count of newlines, where a rep reads *wrapped* lines —
  under a `Math.min(6, …)` ceiling, so a nine-line « Prochaines étapes » hid three
  lines at 1280×800 and three fields hid text at once at 960×600, which is the
  `minWidth`/`minHeight` `main.ts` enforces. The same defect had been found and
  fixed on the follow-up draft's body, in the same file, with the reasoning in a
  comment beside it. `field-sizing: content` is the fix and `shot.mjs
  --scrollers` is the check. It runs on every stage at both sizes — **and note
  what hid it for thirteen rounds: `--expand` injects `field-sizing: content`
  into every textarea so a `fullPage` shot shows a draft rather than scrolling
  past one, so every screenshot ever taken showed the fields unclipped.**
- **A reading column says how much of itself is left** (`ui/ReadingColumn.tsx`).
  The mask and the page turn were built at the gate, where they are a safety
  property, and the pane where the rep *meets* the compte-rendu had neither: it
  hid 73% of the document at 1280×800 and 83% at 960×600, with a hard rule under
  the last visible line, so « …a voté ce matin en comité » followed by a border
  read as the end of a four-paragraph document. The rule had been added to fix
  that symptom. Same document, one click apart, opposite treatment. A new pane
  that scrolls prose uses the component; the gate keeps its own `measure`
  because its guard is a union of bands, not an edge.
- **The dry run's verdict is kept, and outranks the boot probe** (DEC-45).
  Twenty seconds of listening is the strongest fact this product has about
  capture — the probe says a device *opens*, the trial says sound *arrived* — and
  it used to be returned and thrown away, so a rep who read « Vous seriez capté,
  le client non » and closed the card got « Tout fonctionne » and « Audio ·
  connecté ». `ESSAI_LAST_KEY` stores it, `essaiHealth` folds it into the capture
  row as `degraded` (never `down`: the meeting still records — DEC-32) dated by
  the measurement. Nothing expires it; a later trial replaces it, which is what
  the *Réglages* entry point is for.
- **The gate opens on the doubt, and never draws an inert primary** (DEC-4, DEC-21). The rail
  scrolls to the first `⚠ faible` field on open — the screen was flagging a field in the header
  and hiding it six rows below the fold. *Valider* is withheld until the rail has been on
  screen, and while it is withheld the primary slot holds the control that *shows* the rest,
  never a greyed copy of *Valider*: a disabled primary is a button a rep presses. That is not a
  second gate — pressing it confirms nothing — and the guard is stated as « is there something
  below the fold », so an environment that cannot lay out fails **open**.
- **The capture permission is asked for, and the two channels are reported apart**
  (`core/domain/capturePermission.ts`, DEC-45). The app never looked at TCC at all: `probe()`
  asked only whether the native module loads, so onboarding's row and Réglages' *Requis* card
  both carried a `retryable: false` capture health with no registered retry and no remedy
  anywhere — install, refuse the macOS prompt, and no screen in the product could ask again
  while the OS had quietly stopped prompting. Three rules. **A permission never asked for is
  a prompt; one already refused is the settings pane** — the OS silently returns the old
  answer, so offering *Autoriser* for a refusal is the dead control DEC-26 forbids. **One
  missing channel is `degraded`, never `down`**: a meeting still happens and a transcript
  still exists, and the sentence names which side goes missing because losing the microphone
  and losing the system audio have opposite fixes. **Capability-tested, never
  platform-tested**: `getMediaAccessStatus` throws where it does not exist, `askForMediaAccess`
  is simply absent, and both degrade to « we did not measure it », which counts as usable —
  Windows has none of these to grant and must not be shown a permission warning. The
  screen-recording prompt has no ask API; `desktopCapturer.getSources` is what fires it.

- **The dry run is offered, never automatic, and silence is not a fault** (DEC-45).
  `capture:essai` opens both channels for twenty seconds, reports what each heard, and keeps
  nothing — no meeting, no store row, no transcription — and refuses while a meeting is
  recording, because opening a second handle on the same devices is not a thing to test
  against an onboarding screen. It reuses the session's own `LevelMeter` on a reserved
  meeting id, so the instrument a rep watches here is the one they will watch during the call.
  A channel that heard nothing is reported as « rien n'a été entendu », never as a broken
  machine: the rep may simply have said nothing, and a false statement about their hardware
  is one they will act on.

- **First run asks for the permissions before they are needed** (`Onboarding.tsx`). The app
  had none, so the first time a rep pressed *Démarrer une réunion* the OS asked them for
  microphone and screen-recording permission in its own words, over a screen that had explained
  nothing, thirty seconds before a client joined. On macOS the screen-recording prompt is the
  one people refuse, and refusing it silently costs the far end of every call the product
  exists to capture — the rep is transcribed, the client is not, and nothing says so until the
  compte-rendu describes a monologue. Three steps: what it is, what it needs, what will happen.
  **The rows on step 2 are the real health rows and the buttons are the real `health:retry`** —
  a hand-written checklist would be a second place where « is capture working » is decided.
  It is **never a gate**: *Continuer* is live on a step where nothing has been granted, and
  every exit — *Passer* and *Réglages ›* included — records `onboarding:seen`, because nagging
  somebody who said no is how an onboarding becomes the thing people close without reading.
- **The keyboard is declared in one file and printed in Réglages** (`src/app/shortcuts.ts`).
  VISION.md §6 says « keyboard-first » and there was not one global shortcut, so every route
  cost a rep a mouse and a hunt. Six now: `Ctrl/⌘ N K H ,`, `Échap`, `Ctrl/⌘ Entrée`. Three
  things are load-bearing. **Both modifiers, always, never detected** — Windows is the primary
  platform and macOS is where this is typed, so a branch on the host is the mac-first mistake
  `check-platform.mjs` exists to catch, and accepting both costs nothing. **The typing guard is
  `closest`, not the target's tag** — a keydown in the notepad lands on the `<p>` the caret is
  in, so a tag check sees an ordinary paragraph and lets `Ctrl N` start a recording from inside
  the rep's own notes; `Échap` and `Ctrl Entrée` are the two exceptions because that is what
  they do in every mail client. **An unclaimed key is never `preventDefault`ed**, so a screen
  with no search leaves `Ctrl K` to the platform rather than turning it into a dead control
  (DEC-26). It is not a command palette — that is modal chrome (HR-10) — and the gate's
  accelerator exists only while *Valider* is already armed, as an absent handler rather than a
  handler that declines, because a second path that could confirm what the button is refusing
  is a second gate (DEC-4). The Réglages pane is a *view* of `SHORTCUTS`, never a second list.

- **The document's own lines are followable, not just its quotations** (DEC-21).
  The eleven typed rows each offer a `[source ▸]`; the compte-rendu beside them
  offered provenance on « … » fragments only — five followable lines out of
  twenty-eight, and **none on the twelve bullets**, which are the operative half:
  « Envoyer 3 CV avec les TJM associés » is the commitment that becomes the
  VerySwing task. Nothing new is claimed to fix it. Every one of those lines was
  already composed *from* a `Cited<T>` whose span `spanVerification` had looked
  up; the span simply never left the extraction. `compteRenduSources` pairs each
  line **as written** with that span, `review:get` ships it beside the document,
  and the renderer matches on **string equality** — never a heuristic, because a
  near-match would be the app guessing which sentence a piece of evidence belongs
  to. A line that matches nothing stays plain, which is what keeps the free
  recipe (types nothing, so no sources) and *Historique* (no panel) working
  untouched. What is *followed* is the span's quote, never the composed line:
  the line is how the document says it, the quote is what was said, and only the
  second is findable in a transcript. It travels **beside** the document and
  never inside it (DEC-44) — VerySwing receives the string the rep read.
- **An answer with no citation is not a weaker answer, it is no answer** (DEC-21).
  `AskDraftSchema.quotes` may be empty and nothing downstream required otherwise,
  so a model that returned prose and no fragments produced
  `{ answered: true, citations: [] }` — and `AskPanel` draws the citation list
  only when it is non-empty. What reached the rep was a confident paragraph with
  nothing under it, which is *exactly* Granola's Chat and the one difference this
  feature exists to be. `verifyAnswer` now refuses it, and says the same thing it
  says when the transcript cannot answer, because from where the rep stands it is
  the same fact. The other half of the same rule: a quote too short to look up is
  **kept and marked**, never dropped — dropping leaves a paragraph one footnote
  lighter with nothing saying anything went wrong, and the filter counted *raw*
  characters where `MIN_QUOTE_CHARS` is documented as counted after
  normalisation, so the two disagreed at the boundary.
- **`Demander` answers from the recording, and every quote is checked** (DEC-21, DEC-23).
  This is the one surface a general-purpose notetaker has that Sillage did not — Granola's
  sidebar calls it *Chat* — and the version built here is a different feature. Theirs answers
  from a document the model itself wrote, so a mistake in the summary becomes a mistake in the
  answer with nothing left to check it against. `modules/extract/ask.ts` asks over the stored
  transcript and requires a verbatim fragment for every claim; `core/domain/askAnswer.ts` looks
  each one up with the same `locateQuote` the gate verifies citations with, takes the
  timestamps from the segment that was found (never from the model), and **keeps a quote it
  could not find, marked**. Dropping it would leave a confident paragraph with one fewer
  footnote and nothing on screen saying anything had gone wrong, which is the exact failure
  DEC-21 exists to make visible. It writes nothing, stores nothing and confirms nothing — a
  read over the log like *Historique* (DEC-25) — and it is not mounted during a call (DEC-23).
  The claimed channel is a **hint**, not a filter: narrowing to it made a real quote whose
  speaker the model mislabelled come back « introuvable », which discredits the evidence
  instead of the mistake.
- **Every control clears 24×24, and it is measured** (`shot.mjs --targets`, WCAG 2.2 Target
  Size). *Not rendered* and *crushed to nothing* are different: the check skips a control with
  no layout box and reports one that has a box of zero, because the second is a field that lost
  a flex fight and is the worst target there is. Forty-odd were under it, all 17–23px tall, and none of them looked wrong in the
  source: `py-1.5` around `--type-ui` resolves to nineteen pixels. `Button` and `Chip` carry
  `min-h-[24px]` with `inline-flex items-center` rather than more padding — padding moves the
  *text*, and these sit on shared baselines beside titles and section headers. The criterion's
  own exceptions are honoured by the check, not claimed by a class: a control inline in a
  sentence is exempt, and a checkbox whose `for`-linked label is big enough is measured by the
  label, because that is what a rep aims at.

- **A gutter is owned by what hangs in it, and geometry is measured, not read.**
  `CompteRenduDocument` sets `GUTTER` itself and no caller passes one: the three surfaces that
  draw a compte-rendu each set their own `pl-6` — 24px, narrower than `### ` — and the session
  pane set none at all, so ten of twenty-three markers were clipped for three review rounds.
  Every one of them was in the accessibility tree and correct in `innerText`; a third of the
  `###` was simply not painted. A DOM test cannot see that, so `shot.mjs --geometry` measures
  every `data-hangs` element against the box it hangs in and prints the tightest clearance, and
  `smoke.mjs` runs it on every stage. Tune the gutter against that number.

- **The prose is checkable too, and only where it claims to be** (DEC-21, DEC-44). The eleven
  typed rows each carried a `[source ▸]` and the compte-rendu beside them carried none — on the
  screen whose whole argument is that a claim must be checkable, about the string VerySwing
  receives. `REGISTRE` licenses « … » for words the client actually said, so a quotation is the
  one part of that prose that claims to be verbatim, and it is the only part made followable.
  **No pre-verification**: the reader already says « introuvable » and seeds its search with the
  fragment, so an invented quotation leads to a screen that says so — and `source ▸` stays a
  thing asked for by a click and never fetched otherwise. `harnessFixture.test.ts` holds the
  fixture to it: every quotation in its compte-rendu must be locatable in its transcript. Two
  were not, and the affordance found them on its first press.

- **`source ▸` leads somewhere** (DEC-21). `review:transcript` reads the stored segments — the
  same rows `spanVerification.ts` checked the quote against — and the gate opens them in the
  column next door, on that turn, highlighted. When the quote is *not* in the record the reader
  says so and seeds its search with the fragment that failed. It is asked for by a click and
  never fetched otherwise, and it is **not** the live transcript pane DEC-38 removed: that was a
  proof of life during a call and is still the input meter's job.
- **Whatever `border-*` can say, `ring-*` and `decoration-*` must say too.**
  Three instances of one shape now: `bg-muted/30` compiled to no rule and the
  meter's below-floor bars were invisible; `ring-card` named a colour `ringColor`
  did not have and `StateDot`'s outline never drew, leaving a hole where the
  splash's other rows have a dot; and `decoration-card` would have fallen through
  the generic `colors` palette to `--bg-card` — a near-white *background* token —
  drawing a dotted underline in the colour of the paper. The class name is right,
  something resolves, the element is silently unstyled, and no screenshot shows
  it. `design/tokens.test.ts` holds the three scales to each other and refuses
  any of them pointing at a `--bg-` token.
- **A mark that carries information by colour alone is measured at 3:1**
  (WCAG 1.4.11), and `--contrast` does it. Everything that check measured was
  *text*, so a graphic was outside it entirely — and one shipped: the onboarding's
  three progress dots drew the completed step at `brand-300` (**1.99:1**) and the
  upcoming one at `bg-subtle` (**1.11:1**) on a `#fdfefe` footer, so a rep saw
  **one** dot and the count the indicator exists to give was the thing it lost.
  The comment above it argued for dots over « étape 2 sur 3 » precisely because
  the count is worth knowing. Opt in with `data-graphic`, which is the honest
  scope: 1.4.11 covers a graphic *required to understand the content*, and a
  `StateDot` is not one — it owns a text label and refuses to render without it.
  The **ring counts as ink**, not only the fill, because `ring-*` is a
  `box-shadow` and a hollow mark says what a filled one says. And the check must
  not reuse `drawn()`: that excludes `aria-hidden`, which is right for text and
  exactly backwards here, since a graphic paired with a labelled parent is
  *supposed* to be hidden from the reader. Reusing it made the check measure
  nothing while reporting green, which is worse than not having it.
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
- **The register is declared, shared by both recipes, and the quoting licence is bounded**
  (DEC-44). `REGISTRE` in `modules/extract/prompt.ts` is what makes the prose *report* rather
  than assert — attribution, hedges kept as spoken, quantities with their original
  approximation. It reaches the two **reduce** prompts only; a 240-character note has no
  register. Two things are load-bearing. **No new markdown**: the document is never rendered
  as markdown anywhere — `CompteRenduPane` draws it `whitespace-pre-wrap`, the gate edits it
  in a textarea, VerySwing gets the same string — so a table or a fact-line block lands as
  literal pipes on every surface a human reads. And **the guillemet guard stays in `REGISTRE`,
  never in `FORBIDDEN`**: `deterministicLeaks.ts` exempts the `citation` *key*, never a
  quotation, so a « … » fragment in the prose can fail the whole extraction — but `FORBIDDEN`
  is also read by the map prompts, whose citations are verbatim transcript and must be allowed
  to contain names (DEC-21). Tune the register with `npm run replay:extract`, not by reading it.
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
- **A quote is attributed to a side, never to a person** (DEC-47). The transcript has two
  channels and that is the whole of what the recording establishes about who spoke; which of
  two client-side people said a sentence is not in the record. `deterministicLeaks.ts` already
  refuses a reply naming a Graph attendee outside a citation, so the rule was enforced before
  it was written down — stating it in `REGISTRE` turns a refused extraction into a usable one.

- **The harness fixture is checked, not trusted** (`modules/extract/__tests__/harnessFixture.test.ts`).
  It has now been caught lying three times, each time flattering the app: four invented
  headings at half the real length; a `degraded` Outlook row and a Whisper download the app
  cannot emit; and a compte-rendu attributing quotes to named attendees, which the real
  composer would have refused outright. The lesson was written in a comment twice and ignored
  twice. The test runs the product's own leak check over the fixture's prose, reads the
  attendee names out of the stub rather than restating them, and guards itself against finding
  nobody.

- **Something happens at 14:30** (DEC-46). `Agenda.onArmed` fires on the arming *edge*, never
  on the thirty-second tick, and `main.ts` raises one OS notification from it. Its click
  restores, shows and focuses the window and broadcasts `session:open` — the only thing in the
  product that navigates without the rep having pressed something inside it. It never starts a
  recording, and a notification that will not show is not a meeting that will not record.

- **Nothing Electron composes reaches a rep's eyes.** `ipcRenderer.invoke` rejects with
  `Error invoking remote method '<channel>': Error: <ours>`, and the renderer prints
  `error.message` into an alert — so every DEC-26 refusal wore an English stack-shaped prefix
  naming an internal channel. `preload.ts` strips it, anchored on the channel and taking one
  leading `<Name>: ` so a sentence containing « Error » or a colon survives. No test in the
  repo could see it: the renderer's tests inject a fake bridge and the harness stubs
  `window.app`. That is what `scripts/e2e.mjs` is for, and it found this on its third day.

- **`npm run test:e2e` starts the actual application.** Everything else tests a slice and all
  of it shared one blind spot: the preload, the real channel names, the Zod validation on both
  sides of them, the SQLite file and the boot sequence were exercised by nothing, so a channel
  renamed on one side of the bridge would ship. **Thirty-seven** steps under Playwright's
  Electron driver on a throwaway `--user-data-dir`, which is also the only way first run is
  reachable — and five of them are the review gate, seeded through the product's own `Store`
  with the app closed, because `review:confirm` is the one thing here that writes into a
  client's CRM and it had no coverage on the real main process anywhere.
  It ends the meeting it starts and never runs the audio trial — twenty seconds of listening
  would raise an OS prompt no headless run can answer. **It launches twice**: every other test
  in the repo, and every step of the first launch, runs against a store created from nothing,
  and a rep does that once — the second launch, on a database a previous process filled, is
  every other day of their working life and nothing had ever exercised it. It reads the real
  diagnostic log back on both launches and fails on an `error` severity, which is how the
  refusal-versus-failure defect was found.

- **A turn is named when the record settles who took it, and never otherwise** (`speakerLabel`
  in `core/contracts/transcript.ts`, DEC-47). Exactly one interlocutor on the far side means
  the far channel *is* that person — the channel is measured by the hardware, the name comes
  from Graph, and the join is a fact. Two or more and it says « Client » and means it: there
  is no diarisation. One rule, three surfaces — the reader in *Historique*, the reader at the
  gate, and *Demander*'s citation labels — because two screens naming the same turn
  differently is two things for a rep to reconcile. It is in `contracts` for the reason
  `meetingAnchor` is: `src/*` may import nothing else.

- **The arming guard measures the *rep*, not the scroller** (DEC-4, DEC-21). It was « the
  bottom has been touched », and the gate opens by jumping the rail to the first `⚠ faible` row
  — which on the ESN document lands at exactly `scrollHeight − clientHeight`, so the flag was
  true before the rep had done anything and reading the document alone armed *Valider* with
  seven of eleven fields never drawn, *Client* among them. The guard was inverted by its own
  good behaviour: the jump only happens when there is something to check. What is recorded is
  the union of the viewports each column has *shown*; a scroll the app performs is marked and
  records where it landed, never the bands it animated past. The page turn is pinned to the
  foot of the **box** — at the foot of the *content* it was reachable for sixteen pixels of a
  1761-pixel scroll — and points up when the unread band is above. Drive it at three viewports
  before touching it; jsdom measures every box as zero, so the renderer's tests can only hold
  the permissive default.

- **The one control that ships is never the rectangle the rep just pressed** (DEC-4). Colour
  was not enough: React reused the same `<button>` at the same tree position, so the page turn
  and *Valider* were the same DOM node in the same 505×37 rectangle, 63 ms apart — a
  double-click on the fourth turn shipped to the CRM, five Enters on the retained focus shipped
  on the fifth, and the first frame of every gate painted the ship's fill under the turn's
  label because the shared `transition` animated one into the other. `POST /v1/crm/tasks` has
  no idempotency key, so none of the three had an undo. The page turn lives at the foot of the
  column it turns; the slot holds the decision or the sentence saying what is left, never a
  greyed copy. Drive it before changing it — the rectangles must not intersect and the turns
  must leave no focus behind.

- **Leaving the gate never discards a correction.** `edits` was component state, so `Échap` —
  one of exactly two shortcuts deliberately allowed while typing, on the one screen with a
  fifty-six-line textarea — threw away a correction with nothing having said so. `PENDING_EDITS`
  holds drafts per meeting for as long as the window and a confirmation clears them; it is
  deliberately not a store write, because a draft persisted to Thursday would reappear over a
  compte-rendu regenerated since.

- **`⚠ faible` is a mark everywhere it appears.** The typesetter learned `**gras**` and
  `_italique_` and not the one token this product invented (DEC-21), so the marker was
  pixel-identical to the prose inside the compte-rendu — the only one of its three renderings
  that leaves the machine. And `--warn` against `--text-muted` is 1.0:1 in luminance, so
  colour alone carries nothing in greyscale or to a deuteranope: every rendering is
  `font-semibold` as well. The string is never rewritten; only the ink changes.

- **A field the gate cannot ship is not an editable field** (DEC-26). `draftIntents` composes
  the nine interpretive rows into the opportunity's description and into nothing else, so an
  opportunity that does not ship — an unmatched account, or the rep unchecking it — left nine
  live textareas over a payload that would never exist. They go read-only, with the reason
  once above them and the place a correction *does* still land. `reviewGate.test.ts` holds
  where the fields ride; a stage photographs the configuration.

- **A declared port that nothing calls is not a feature, and `npm test` cannot
  tell.** Four verbs on `CrmPort` — `resolveAccount`, `listSiblings`,
  `createContact`, `attachTranscript` — were declared, implemented in `VsaCrm`
  and unit-tested, and a grep for them outside `modules/crm` returned **the
  declarations and nothing else**. So `facts.account` was `UNRESOLVED_ACCOUNT` on
  every meeting this product has ever produced, which is not cosmetic:
  `reviewGate.ts`'s `opportunityPossible` reads `edits.accountId !== null`, so the
  opportunity was *structurally impossible*, and `VsaCrm.link()` fell through
  OPPY → COMPANY → FREE to its last branch and created every compte-rendu task as
  an orphan with no `linkType`. `pushSettled` was the same shape: an enum entry,
  the only *guarded* rule in the transition table, and no caller — so no meeting
  ever reached `done`. The suites were green throughout, `IMPLEMENTATION.md`
  marked the step `[x]`, and the screenshot harness photographed a gate whose
  button promised three things of which one could happen. **`npm run check:ports`
  is that grep, run for you**: every method on a port declared in
  `core/contracts/` must be called from outside the module that implements it, or
  be listed in `UNWIRED` with the reason and what wiring it would cost — the
  `check-platform.mjs` shape, including the half that matters most, which is that
  an allowance whose method has since disappeared also fails. Two are listed
  today: `attachTranscript` and `createContact` both *write into the client's
  systems* and belong in the gate's intent list as a decision, not as a side
  effect of extraction.
- **And the same question, asked at every boundary where « declared » and « reached » are
  different files** (`npm run check:surfaces`). The fifteenth round said the check above was
  right and its *scope* was the problem, and named the general form: the repo's prose is being
  trusted as if it were wiring. Four more were found by hand and all four are one shape —
  `transcript:appended` broadcast for every segment of every meeting and subscribed to by no
  window; `diag:appended` subscribed to by Réglages and published by nobody, so the diagnostics
  pane never moved while a rep watched it; `models:state`, an invoke channel with a paragraph
  explaining the bug it was written to fix, called by no renderer and answering exactly what
  `settings:snapshot` already answers; and `vad.rs`, a hundred and forty lines of Rust
  mentioning Google STT and a Swift implementation, never named by a `mod` and therefore never
  compiled since the previous product was demolished. The check is three greps: an invoke
  channel with no caller under `src/`, a broadcast with no publisher under `electron/` **or**
  no subscriber under `src/` — both halves, and they fail differently: no publisher is a screen
  that never updates, no subscriber is work done for nobody — and a `.rs` file no `mod`
  declares. `UNREACHED` is empty today and that is the point: every one of those four was wired
  or deleted rather than excused.
- **A 200 that is not a transcription is a failure, not a silence**
  (`modules/transcribe/RestSttSession.ts`). Every cloud provider here answers `200` with a JSON
  envelope, and every one of them can answer `200` with an envelope that is not a transcript: a
  quota or moderation object, a field renamed between API versions, a corporate proxy's HTML
  interstitial. The adapters returned `''` for all of it — which is exactly what a genuinely
  silent chunk returns — so nothing was emitted, nothing was recorded, and `transcribe` health
  stayed `ok`: a meeting with no transcript from an app saying everything was fine.
  **A string body is not a transcript either**, and that one shipped for a commit: the helper
  answered `data` directly when axios handed back a raw string, which it does for *any* non-JSON
  200 — so a corporate proxy's interstitial, a gateway's plain-text error or a captive-portal
  login page was emitted verbatim as something the client had said, into the transcript the
  compte-rendu is folded from and `[source ▸]` reads. These providers are all asked for JSON and
  all answer an object.
  `extractTranscript` answers `string | null` now, `null` meaning « not a body I know », and
  the session throws on it so the failure lands on the path that already counts errors, moves
  the connector's health and fails a provider over. **Azure's envelope is what is recognised,
  not its field**: `NoMatch` legitimately carries no `DisplayText`, so a body with
  `RecognitionStatus` is understood whether or not it has text. The `upload` test seam answers
  the **body** rather than a finished string, which is what puts every test in the repo through
  the same reading the product does — it was the other way round, and that is precisely where
  this defect lived.
- **Deterministic data never comes from the LLM** (DEC-7). Attendee names, emails, dates and
  account codes come from Graph or VSA. `LlmInterpretation`'s schema has no fields for them.
- **Confidence is measured, not self-reported** (DEC-21). Every interpretive field cites a
  transcript span; the app verifies the span exists. No verifiable span → `⚠ faible`.
- **Never write to the Outlook event body** (DEC-10). It mails attendees and destroys the
  Teams join blob.
- **We create drafts, never send mail** (HR-8). `Mail.ReadWrite`. Never `Mail.Send`.
- **Raw audio is never retained** (DEC-12). Transcribed and discarded.
- **The diagnostics allowlist is an allowlist, and thirty-two is the number.**
  `redactDiagnostics.ts` says of itself that it « cannot be wrong by omission », and at
  `{1,64}` it passed, verbatim, exactly the shapes it exists to catch — a key
  (`sk-proj-…`, 40), a bearer token (44), a URL, a home directory. All four are
  « identifier-shaped with no spaces », and all four went into the bundle whose own button
  reads « Sans contenu de conversation. Peut être envoyé au support. » Nothing leaked,
  because no shipped `detail:` carries a secret — but the stated property was false and it
  failed *toward* shipping one. Thirty-two still admits every identifier this product
  actually puts in `detail:` (a meeting id is 20, a model id 20, an ISO timestamp 24), and
  a URL or a path is rejected outright: `redactMessage` always stripped both from the
  *message* and `redactDetail` never applied it, so the two halves disagreed about the
  same URL.
- **The schema stamp is the receipt for the fold, written after it.** `EventLog`'s
  constructor dropped the projection tables, ran the DDL and stamped the new version — all
  outside a transaction — while the refold lives in `Store` and runs later. A crash, a
  power loss or one unparseable row in between left a new stamp over **empty** projections,
  and the next boot read that as « already upgraded » and never retried.
  `PROJECTION_TABLES` is `meetings` and `outbox`, and `POST /v1/crm/tasks` has no
  idempotency key, so a lost outbox is a lost record of what was already sent — against
  `schema.ts`'s claim that « nothing is lost, including the outbox's remote ids », which
  was true only if the refold completed. Latent until the schema moves, by which point the
  databases hold real meeting history.
- **A window closing does not get to abandon a recording, and a crash does not get to
  strand one.** `before-quit` stopped the agenda, stopped update checks and closed the
  store — and never ended a live meeting. On Windows, the primary platform,
  `window-all-closed` quits, so the ordinary gesture of getting the app out of the way
  during a call ended the call with nothing: the transcriber was never flushed, so the
  tail was lost (`stopRecording`'s own docblock calls it « the part with the next steps
  in it »), and the meeting sat in `recording` for ever. The app already knew how to ask
  — `updateReadiness` refuses a ten-second installer while a call is live, two hundred
  lines above — it just never asked here. The quit is **deferred, not refused**, and
  enhancement is deliberately *not* waited for: it can take minutes and the rep pressed
  close. The meeting lands in `ended`, which is DEC-39's deferred case.
  And the boot sweep covers what no handler can — a crash, a SIGKILL, a battery. A
  meeting found in `recording` at startup has no capture behind it: the device was
  released when the process died, so the session screen drew a recording pill over
  nothing, the gate refused the meeting, `Agenda` would not re-arm it (`arm` is illegal
  from `recording`), and nothing anywhere could end it. `Enhancement.reconcile` cannot do
  this one — its `dispatch` dep is narrowed to the three extraction commands, because
  ending a meeting is the state machine's business, not the recipe's.
- **The capture path has zero network dependencies** (DEC-26). Everything downstream may
  fail; nothing downstream may stop a meeting being recorded. **`Recording.start` was the
  exact inversion of this for as long as it existed**: `transcribe.start()` reaches
  `createSttSession`, which throws for a provider id it has no branch for, and the throw
  escaped into `Orchestrator.startRecording`'s single catch — which sets **capture** down
  and aborts the meeting. A downstream, remote, *optional* subsystem failing at t=0 meant
  the rep pressed *Enregistrer*, nothing was recorded, and the app said the microphone was
  unavailable. Capture had never been asked to start. The order is right and must stay
  (the transcriber listens before the first frame); the throw is contained instead. The
  reachable instance was `deepgram` — declared as the only `streaming: true` row, so
  `selectProvider` *preferred* it the moment a rep opted into a cloud upgrade, with no
  adapter behind it — and a registry test asserted the selector picks it. **A row in
  `STT_PROVIDERS` is an offer the product must be able to honour**: `registry.test.ts`
  holds every id to a constructible session, and the streaming preference is proved
  against `providerRank` rather than against a shipped row, so it can never again be
  satisfied by declaring a provider that cannot start.
- **A channel that produces *nothing* is the one case every other signal misses**
  (`capture/systemAudioHealthClassifier.ts`). `#onFrame` returns early on a
  keepalive — the tap saying « I am alive and there was nothing » — so `#measure`
  is never reached, no `InputLevelWatch` is ever created, and
  `capture.level.tooQuiet` cannot fire. Every instrument in that file is derived
  from a frame, and a silent channel emits none. So the watchdog is fed **before**
  the keepalive guard and on a timer, per channel, and it is the only thing that
  can notice. The failure it catches is the one the product is built around,
  reachable on the *primary* platform through a Sound Settings checkbox rather
  than a permission prompt: the Windows loopback taps the **multimedia** default
  while Teams routes to the **communications** default, which the rep configures
  separately (`speaker/windows.rs` documents that hole itself). `degraded`, never
  `down` — the meeting is recording and half of it is arriving (DEC-32) — and the
  sentence names *which* side, because nothing on `rep` is a microphone and
  nothing on `far` is the system tap, which have opposite fixes (DEC-45).
  **This module existed, tested, for months with no caller**: it was a `.mjs`
  inside `electron/`, therefore outside `tsc` entirely, so nothing could notice.
  A module here carries `.ts` for that reason and not only for the build.
- **The local engine is pooled and outlives the meeting, so its prompt must be set
  unconditionally.** `prewarmLocalEngine()` holds a reference that is never released, and
  `setPrompt` is last-writer-wins — so `if (this.#prompt) engine.setPrompt(…)` meant a
  meeting with no calendar context and no stored terms **never overwrote the previous
  one's**. Whisper's `initial_prompt` biases decoding toward what it is given (§4 measured
  the terms inserting themselves into speech), so a prospect's transcript could acquire a
  different client's company name and surnames — in the transcript the compte-rendu is
  folded from and VerySwing receives. An empty prompt is a statement and has to be made.
  The test asserts the **source shape**, the way `preloadUnwrap.test.ts` does, because
  `acquireEngine` returns a fresh engine whenever a `spawn` is injected: two sessions in a
  test can never share the pooled engine that production always shares.
- **`POST /v1/crm/tasks` has no idempotency key.** The outbox persists the returned `id` in
  the same transaction that drains the intent, and never re-posts a drained one.
- **« Cette machine uniquement » is asked for in the product, and it binds the
  *candidate set*** (DEC-37, `core/domain/residency.ts`). It was
  `SILLAGE_STT_OFFLINE_ONLY=1` and nothing else — an environment variable, on a
  product whose DEC-34 says none is required to run it and whose own decision calls this « the
  rep asking, in the product ». And once asked for, it was bypassable by the most ordinary
  sequence of two settings: both registries honoured it in their **ranking**, and `main.ts`
  takes the rep's explicit provider pick whenever it is configured, so « paste a cloud key,
  press *Utiliser*, then ask for offline only » sent the audio to the cloud anyway. Worse, the
  language model never saw the flag at all — `selectLlm({ configured })` — so the **transcript**
  went to a hosted model, which is the half with the client's name in it. The constraint is
  applied to the candidate set now, before the ranking and before the choice, which is the one
  place every path has to go through. A Réglages switch writes it, the snapshot reads it from
  the same function a meeting reads, and the harness fixture *applies* it rather than flipping a
  flag — a stub that answered the same tables would have photographed the switch's own promise
  being broken in the screenshot that makes it.
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
- **A model download is three separate promises, and all three were broken** (DEC-35).
  **The progress has to arrive**: `main.ts` broadcasts `models:progress` on every change,
  under a comment naming the bug it was written to fix, and the renderer subscribed to
  eleven channels of which that was not one — so a 1.5 GB download read
  « téléchargement · 0 % » beside an *Annuler* button for ever, including after it
  finished. The jsdom test that should have caught it set 38 % *in the snapshot* and
  asserted the row draws it: it proved the row can render a number, never that one
  arrives. **The bytes have to land where the engine looks**: `resolveModelsDir` took the
  first candidate that held *anything*, and a packaged build's `resources/whisper-models`
  is never empty — it ships the default model — so a model downloaded after install sat in
  `userData` where nothing looked, and with `allowRemoteModels: false` the load failed
  telling the rep to download what they had just downloaded. It resolves on **the
  checkpoint asked for** now, with the predicate supplied by the caller so `paths.ts` stays
  free of the catalog; and when nobody holds it the answer is the *writable* directory,
  because « nobody has it » and « put it here » are the same answer. **And it may not run
  during a call**: `ModelDownloads.start` posts `init` straight to its own worker,
  bypassing `acquireLoadSlot` and `memoryVerdict` — the guards `engine.ts` calls the reason
  an ONNX session that cannot allocate « takes the process with it ».
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

## The end-to-end run reaches the gate

`scripts/e2e.mjs` starts the **packaged** application under Playwright's Electron
driver and walks a rep's first ten minutes. For a dozen rounds it stopped short of
the one screen that matters most, for an honest reason: a headless run produces no
audio, so no transcript, so no extraction, so the gate correctly refuses — and the
run asserted exactly that, that the door is not there when it should not be.

Which left `review:confirm` — **the only thing in this product that writes into a
client's CRM** — with no end-to-end coverage at all. The screenshot harness drives
the gate against real layout and a stubbed `window.app`; the renderer's tests drive
it against a fake bridge in jsdom, where every box measures zero and the guard
therefore fails open. Neither had ever seen the real store, the real state machine,
the real field map or the real outbox.

So the log is now seeded **through the product's own `Store`**, with the app
closed — every event validated by its own Zod schema on the way in and folded by
its own `Projections`, from `core/contracts/fixtures.ts` — and the next launch
rehydrates the session from those transitions like any other. Five steps follow:
the gate opens on a rehydrated session, the fields are the stored extraction, a
citation opens the record on a turn that is really there, *Valider* is withheld
until both columns have been shown, and the press lands. **The connector being
absent is the case worth running**: it is the one where something could be lost
silently, and what has to hold is that the intents are in the outbox and an attempt
that could not start stays `pending` with a reason rather than `failed`.

Seed with the app closed. SQLite would take the write from a second connection,
but the running main process holds the session in memory and never re-reads it.

## Commands

```
npm test                  # the suite. prints which tests are deferred, and why
npm run check             # typecheck ×2 + boundaries + CRM + tokens + platform + French + ports + surfaces
npm run test:e2e          # builds, then walks the real application under Electron
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
rendered page; `--geometry`, `--targets`, `--prose`, `--a11y`, `--contrast` and `--scrollers`
are the six measured checks, and each exists because something shipped past a screenshot —
clipped gutter markers, forty controls under 24×24, a measure rendering eighty-one characters,
a control whose only name is « ‹ », a progress indicator that drew as one dot, eleven
textareas clipping their own content inside the two columns the arming guard measures.
`--contrast` is computed from resolved styles **with transitions switched off**:
`getComputedStyle` returns the current *animated* value, which is how the bundled detector
reads a resting 14:1 button as 4.0:1 — and how the first version of this check reproduced the
same false positive at 1.16:1. **A design pass that only reads `src/` has not looked at the
product** — the defects that matter here live in rendered geometry and in the accessibility
tree.

```
node scripts/harness/smoke.mjs                 # every stage × two sizes, all six checks
```

**Both sizes, always.** `smoke.mjs` drives 1280×800 *and* 960×600 — the width
`main.ts` declares as the minimum — because every check passed at the comfortable
size while 960 held a text field crushed to fourteen pixels and a client name
painted over the label beside it.

A stage is held together by the product's own French strings, so a copy change breaks one
silently. That happened twice — the second time it broke six stages at once, including both
features under review — and both times the lesson was written down in a comment. A comment is
not a check.

## What ships

`build.files` in `package.json` decides what lands in an installer, and two
things it used to carry were mistakes rather than choices.

**Sourcemaps with the source inside them.** `build-electron.js` set
`sourcemap: true`, which embeds `sourcesContent` — 82 MB of a 126 MB
`dist-electron`, and `main.js.map` alone held 655 source files, **108 of them
this product's own `DEC-` commentary, verbatim**. A third of the payload was the
original TypeScript, handed to anyone holding the installer. Maps are still
written, because a stack trace that maps to `Recording.ts:135` is worth having
while developing and in a diagnostics bundle; `sourcesContent: false` drops what
a map does not need for that, and `build.files` excludes every map outright, so
what ships has neither. 82 MB → 26 MB locally, zero packaged.

## Updates are verified before they run, or they do not run

`electron-updater` downloads an installer from the release feed and **executes
it**. On Windows it checks that installer's Authenticode signature against an
expected publisher — if the packaging config declares one. `build.win` declares
neither `publisherName` nor `certificateFile`, so the check was *skipped* rather
than failed, and « Installer et redémarrer » ran whatever the feed served, on
the primary platform, with nothing between the rep and a swapped asset but TLS
and a GitHub account.

`core/domain/updateTrust.ts` is the rule and `main.ts` applies it: on an unsigned
Windows build the updater is not constructed at all, and the panel says why —
a stated degradation, never a silent one (DEC-26), with the remedy named. It is
deliberately **not** a build failure: the first deliverable is a demo installer
(DEC-28) and reps are on Windows (HR-2), so refusing to produce an installer
until somebody buys a certificate would stop the product shipping to defend a
feature it does not need yet. What it stops is the unverified *install*.

The signing fields are baked in by `scripts/build-electron.js` as an esbuild
`define`, not read from `package.json` at runtime: electron-builder does not
promise to keep the `build` block in the `package.json` it writes into the asar,
and an updater deciding whether it can verify itself from a field that may have
been stripped would fail **open**. The define key is dotted
(`globalThis.__SILLAGE_WIN_BUILD__`) because a bare one substitutes nothing and
does it silently. Setting `publisherName` and signing is all it takes to lift.

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
