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
- **The widget's exit is the one exit that is seen, and the fade must not cost the two
  teardowns that cannot wait** (DEC-49, `Overlay.dismiss()`). Every other surface in this
  product arrives and leaves inside a window the rep chose to look at. The pill is drawn over
  *another application* — over the face of the person on the call — and it was `destroy()`ed
  between two frames at the moment the rep is certainly watching it, because the ordinary way a
  recording ends is them pressing the pill's own control. So `dismiss()` asks the renderer to
  fade (`widget:leave`) and destroys the window when it answers (`widget:left`). Four things,
  and each was a defect waiting in the obvious version. **A fixed wait in the main process is
  wrong in both directions**: too short and a loaded machine — a call being transcribed, the
  only condition this window exists in — never paints the first animated frame, so the rep sees
  exactly the pop the wait was added to remove; and `prefers-reduced-motion` collapses `--motion`
  to `0ms`, so a constant would hold a static pill on screen for a fifth of a second after the
  call ended, for the rep who asked for less motion. The renderer answers with the duration **it**
  resolved off its own computed style, from a layout effect, so the reply precedes the first
  animated frame and the window always outlives the animation rather than approximately matching
  it — measured in Chromium on the shipped stylesheet, `{ afterMs: 150 }` resting and
  `{ afterMs: 0 }` under reduced motion. **The window stops being `#window` first**, because
  `show()` is idempotent on it: a rep taking two calls back to back would otherwise have the
  second recording *adopt* a pill that is fading out, which then destroys itself on its own
  timer and leaves nothing over a live call. **It stops taking the mouse**, with
  `{ forward: false }` and not the pass-through above — a card mid-fade is still a frameless
  always-on-top window, and a leaving one has no interest in the pointer ever again. And
  **`hide()` keeps its own promise and adopts every leaving window**: `before-quit` calls it one
  line before `store.close()` and `mainWindow.on('closed')` calls it because `window-all-closed`
  does not fire while any window is open, so a quit arriving inside the fade would otherwise
  leave a pill whose `moved` handler writes the saved origin through a closed database. The
  fallback timer is armed *before* the renderer is asked and caps the reply it gets back: the
  animation is a courtesy, and a pill that outlives the call it reports is worse than a pill
  that pops. `scripts/e2e.mjs` asserts the window is gone within three seconds rather than
  fifteen — a tolerance that would pass on a handshake nothing completed.
- **And the entrance, which was worse than the exit and had never been looked at**
  (`FIRST_FRAME_MS`, `APPEARANCE_MS`, `MEASURE_DEADLINE_MS`). Polishing the exit is what exposed it: the pill
  faded out beautifully and *arrived* as a card **clipped by 49 pixels** that then settled in
  three steps. `INITIAL_SIZE` is 232×52 and its own docblock calls it « a starting guess and
  never the truth »; the shipped renderer asks for **281×78**, and `showInactive()` fired on
  `ready-to-show`, before anything had measured anything. `placeAroundPill` holds the pill's
  *centre*, so each correction slid the window sideways by half the width delta — measured,
  three asks (239 → 276 → 281) and about 25 px of drift, over the face of the person on the
  call, at the instant the rep presses *Enregistrer*.
  Two halves, both failing open. The window now waits for the renderer's own measurement
  before its first show, with `FIRST_FRAME_MS` as a **deadline and never a requirement** —
  DEC-26, and a widget that does not appear is worse than one that appears wrong, because the
  rep has no taskbar entry and nothing to alt-tab to. And the renderer does not report a size
  measured in the *fallback* face, which is where the largest single jump came from (239 → 276
  when Inter loads, 37 px, 18 of window x).
  **Three of that API's four obvious answers are wrong here, and each was measured before
  being discarded.** `fonts.status === 'loaded'` is true whenever nothing is *pending*, and a
  bundled face no box has asked for yet is not pending. `fonts.ready` has the same shape: it
  resolves when the current set of loads is done, which at that instant can be none. And
  `fonts.check(<computed shorthand>)` answers **true**, correctly and uselessly, because the
  question it asks is whether the *list* can render the text and `-apple-system` at the end of
  it always can. The face has to be asked for by name — the family's first entry, read off the
  element so no font name is written twice — then the set awaited, because `load('1em Inter')`
  triggers the family while the pill draws two weights of it, and then **one frame**, because
  `ready` resolves before the layout it caused has run. 3 asks → **1**, at the right size.
  Result: one measurement, and the first frame the rep sees is the real pill in its real place.
  The `Overlay` test asserts the *order* — bounds before show — because a counter of
  `showInactive` calls cannot tell a correct first frame from a clipped one sliding into place.
  **And waiting for the font was half a gate.** `Pill` draws « Aucun enregistrement » with no
  meter, no clock and no mark button while `widget:state` is in flight, so the measurement the
  main process was waiting for could be a measurement of a pill saying the recording is not
  happening — and the window was then revealed carrying it. Measured in the **packaged** app:
  the placeholder at 619 ms, the real pill at 636 ms. Seventeen milliseconds, which is why the
  first version of this looked correct: the margin was doing the work, not the construction, on
  the machine that is not the primary platform, at the instant `startRecording` is opening two
  audio devices and booting a transcriber. `FONT_DEADLINE_MS` is `MEASURE_DEADLINE_MS` now and
  waits for the type **and** for `widget:state` to settle *either way* — a `{ meeting: null }`
  answer is an answer — with both waits absolute from mount, because content arriving re-arms
  the effect and a restarting deadline would land past the main process's.
  **Four numbers in three files, and they must stay in one order.** The harness's
  `widget:state` latency < `MEASURE_DEADLINE_MS` < `FIRST_FRAME_MS` < `APPEARANCE_MS`, held by
  a test in `harnessFixture.test.ts` that reads all three files. Out of order the handshake is
  decided by the wrong side and every suite stays green: at 120 ms against a 150 ms answer the
  renderer's deadline fired every run, so the wait it guards never happened and the first
  attempt at this fix measured as working while doing nothing; and with the renderer slower
  than the main process it is `INITIAL_SIZE` that gets revealed — the 232×52 guess, carrying
  « Aucun enregistrement » over a live call. `APPEARANCE_MS` is armed at *creation* and closes
  a hole with teeth: Electron does not promise `ready-to-show` for a transparent window, so a
  renderer that was alive and measuring could have been shown never.
  **Two edges on that handshake, both about a timer handle answering a question it cannot.**
  A fired `setTimeout` is `null` and so is one that was never armed, and `ready-to-show`
  arms on `null` — so a renderer that reported its deadline *before* painting had the
  deadline fire against an unpainted window, refuse, clear itself, and then get a **fresh**
  `FIRST_FRAME_MS` out of the paint: measured, a mute renderer shown at **+589 ms** instead
  of +300. An elapsed deadline is elapsed. And **every other field is reset when a window is
  created; the two timers were not** — so a window replaced without `dismiss()` or `hide()`
  (a renderer that crashed, a window the OS closed, which `on('closed')` handles by setting
  `#window = null` and nothing else) left `#reveal` running, the new window's
  `ready-to-show` found it non-null and armed nothing, the stale timer fired against a
  destroyed window, and the only thing left to reveal the live pill was the appearance
  ceiling: **+1 351 ms** against its own 300 ms deadline, at `INITIAL_SIZE`. Two calls back
  to back is the ordinary shape of a rep's afternoon. The test fake emits `closed` from
  `destroy()` now, the way Electron does, because a fake that died silently could not
  reproduce either.
  **And an order between constants is not an order between expiries, because the two were
  armed from two different clocks** (`widget:measuring`, `Overlay.measuring`,
  `FIRST_FRAME_SLACK_MS`). That test read all four numbers, asserted them in order, and could
  never see what they were counted from: `FIRST_FRAME_MS` is armed inside
  `ready-to-show` in the main process and `MEASURE_DEADLINE_MS` from the React mount in the
  renderer, so the hundred milliseconds between them is a hundred *minus the gap between those
  two events* — measured on this Mac at **81 ms and 47 ms** across two launches, leaving 19 and
  53. And it is spent on the critical path of `startRecording`, with two audio devices opening
  and a transcriber booting, for a rep on a Windows laptop (HR-2). Lose that race and the side
  with the *worse* answer decides. So the renderer states its own deadline from its own mount,
  one IPC hop before it arrives, and the main process re-arms from that instant: one origin,
  and the ordering is true by construction rather than by a subtraction nobody had done. Three
  things it must not become, each a test: it never *shortens* a wait already running (a
  bring-forward is the same defect, faster), it is ignored once the window is shown or the
  ceiling has fired, and it is not load-bearing — a renderer that never reports keeps the
  `ready-to-show` deadline and `APPEARANCE_MS` is above both (DEC-26).
  **And `ok: false` is not an answer.** `Overlay.resize` returns `{ ok: false, above: false }`
  when there is no window, and the renderer did `.then((placement) => setAbove(placement.above))`
  — believing a refusal. `above: false` there is a *default*, not a measurement: that is the
  chevron flipping ▴→▾ and half of the 20 px slide on the way out.
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
  **And `--prose` could not see a line of prose split by one inline element, which is
  almost all of it.** The filter was « some child text node longer than ninety
  characters », and `« {excerpt} »` is three nodes, `À :{' '}{to.join(', ')}` is two
  because JSX `{' '}` is its own node, and a `<mark>` around a search hit splits it again.
  Four live surfaces were therefore never measured, green on 108 stagings: *Historique*'s
  search result at **213 characters a line** — two and a half times the ceiling and wider
  than the 130 at the gate this rule was written to end, and its excerpt is « forty
  characters either side of the hit » so it can *never* be ninety in one node; the line
  naming who the Outlook draft goes to, read immediately before the one irreversible press,
  at **90 inside a `.measure` wrapper**, which is the wrapper-versus-element failure this
  paragraph already records at eighty, on the same screen; the gate reader's citation
  header; and a field row's quote. The element's own text is **summed** now, and the floor
  is sixty rather than ninety because the ceiling is seventy-five: an element holding less
  than that cannot demonstrate a line that is too long, and below it the check would be
  reporting a capacity nothing fills. Seven surfaces wear the class as a result.
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
- **A 5xx on a POST is not retryable, and it took saying twice.** `modules/crm/vsa/http.ts`
  carries the rule and the measurement behind it — « 6 POSTs across two drains » — and
  `modules/mail/graph.ts` classified `>= 500` as retryable on a function whose only request is
  `POST /me/messages`. A gateway timeout on a draft create says nothing about whether the draft
  was created, and a 504 from a proxy in front of Graph is routinely a request that landed: the
  rep validated during a ten-minute Graph blip and opened Outlook to three identical follow-ups
  addressed to their client — once per attempt in the drain, and again on every relaunch,
  because the boot re-drains every pending row. `OutlookMail`'s own docblock stated the correct
  rule while the code did the opposite. `429` stays retryable: it is the one status that says
  explicitly that the request was not processed, and it carries `Retry-After`.
- **An empty compte-rendu is not a task** (`core/domain/reviewGate.ts`). `ReviewEdits.compteRendu`
  deliberately has no `min(1)` — a rep who selects the document in « Modifier » and deletes it
  has done something they can undo, and refusing the whole confirmation would discard every
  other correction — and the comment saying so ends « and `draftIntents` already refuses a task
  with no description, on the row, in French ». It did not: `taskPossible` read the *name*.
  « Select all, delete, validate » put an empty `taskDescription` into the client's system of
  record, where there is no idempotency key and no delete verb.
- **An intent nobody can route is settled as far as the *meeting* is concerned, and the
  updater's danger is a POST, not a state.** Two halves of the same trap, one layer above
  `blocked`. `Outbox.#attempt` finds no port, abandons the intent without an attempt event —
  deliberately, so it ships the day the connector is configured — and the row stays `pending`.
  On the **demo build**, which DEC-28 calls the first deliverable and which has no VerySwing
  tenant, that is the ordinary path: one press of *Valider* left `allIntentsSettled` false for
  the life of the database, the calendar read « Envoi… » on that call for ever, and because the
  boot re-drain rehydrates the session on every launch, `liveStates()` carried `pushing` and
  **every future update was refused** with a sentence that was false. `routable` is injected by
  `main.ts`, which is the one place that knows which ports exist; the outbox keeps the queue
  either way, and a real outage — connector present, row retryable — still leaves the meeting
  visibly mid-flight, which is DEC-26's reading. And `updateReadiness` asks whether a push is
  **on the wire** rather than whether a meeting is in `pushing`: the danger its own docblock
  states is a `POST /v1/crm/tasks` interrupted between the request and the commit that stores
  its id, and that lasts as long as the request.
- **`blocked` means a dependency has not settled *yet*, never that it failed.** It meant
  « or has failed » for as long as the DAG existed, and that was a terminal state with no
  exit: `drainable()` is `state = 'pending'`, so no boot re-drain ever named the row again,
  `allIntentsSettled` never counted it, and there was no path out of `blocked` anywhere in the
  product. One VSA 500 on the *opportunity* — an enrichment — permanently cost the
  **compte-rendu**, which is the whole reason this product pushes to a CRM; the meeting sat in
  `pushing` for the life of the database, *Historique* drew « en attente d'un autre envoi »
  over a row nothing would ever attempt, and because `Orchestrator.session()` caches the
  rehydrated session, `liveStates()` carried `pushing` from boot onwards and **the app could
  never install an update again**, on the primary platform. The ordering exists to carry the
  opportunity's remote id into the task, and `#withDependencyRef` already handles a dependency
  that did not drain — the reference stays null and `VsaCrm.link()` falls through to the
  company, which is worth incomparably more than nothing. What blocking protects is untouched:
  a dependant is never sent before its dependency is *decided*, only after it is decided either
  way.
- **A row that was on the wire is reclaimed, and a quit waits for one that still is.**
  `Outbox.#reclaim` settles a row left `draining` by a dead process — « envoi interrompu —
  vérifiez dans l'outil distant avant de relancer » — and it runs as the first line of
  `#drain`, which `main.ts` calls once per meeting named by `drainable()`. `drainable()` is
  `state = 'pending'`. So a meeting whose **only** non-terminal row was `draining` was never
  passed to `drain()`, `#reclaim` ran for nobody, and the row stayed in flight for the life of
  the database: « envoi en cours » on the Historique row for ever, `pushSettled` never fired so
  the meeting never reached `done`, and `updateGate.ts` then refused every installer because a
  push was in flight. `POST /v1/crm/tasks` has no idempotency key, so the rep could not find out
  by sending it again — the one irreversible write in the product, with no way to learn whether
  it landed. `Projections.interrupted()` is the missing half of `drainable()` and the boot sweep
  reads both. **The trigger was not a crash**: `review:confirm` fires the drain without awaiting
  it, deliberately, and on Windows closing the window quits — so « press *Valider*, close the
  window » was enough. `before-quit` asked only whether a meeting was *recording*; it waits for
  the pass now, bounded, and `Outbox.settle` replaced `isDraining`, which answered a question no
  caller asked. The unit test that proves `#reclaim` works calls `drain()` **directly**: it was
  green throughout, and it never asked whether anything calls `drain` for that meeting.
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
- **The guard measures what *ships*, and evidence does not ship — three times now.**
  `data-unmeasured` marks what a column holds but does not send, and `shippedHeight`
  **subtracts every marked subtree wherever it sits** rather than truncating at the first: it
  took the first one's *offset*, which is right for *Demander* — a pane under the document —
  and blind to the rail, where `[source ▸]` opens a panel **inline, inside the row**. So
  opening five sources, which is a rep checking the evidence on five of eleven rows, grew the
  rail past `GROWTH_SLACK`, deleted the coverage and took *Valider* off the screen; closing
  them left the screen pixel-identical to the armed one and still refused, at a cost of two
  page turns at 1280×800 and five at 960×600. Subtracting rather than truncating also keeps the
  scroll arithmetic honest: an expansion in the middle pushes the rest down by exactly what is
  subtracted. `review-garde-sources` is the proof and it **passes at 1440×900** either way —
  run the guard stages at the smoke sizes. The three instances are one sentence: *Demander*
  inside the measurement, the transcript as a measured view, the inline source panel. Each time
  the one feature this product has over a general-purpose notetaker was the only thing on the
  screen being punished for being used.
- **The guard measures what *ships*, and `data-unmeasured` is how a column says what does
  not.** *Demander*'s answer sits under the compte-rendu, where it belongs — and it is a read
  over the record that writes nothing and confirms nothing (DEC-25). Inside the measurement it
  was 216 pixels of content arriving after the column had been read, so the growth rule deleted
  the coverage and **asking one question cost seven page turns at 1280×800 and ten at 960×600**.
  Following a citation costs nothing, because the transcript is its own view — so the one
  feature this product has over a general-purpose notetaker's chat box was the only thing on the
  screen being punished for being used. The subtree is marked and the measurement stops where it
  starts; measured from the rects and the scroll position, never `offsetTop`, which is relative
  to the nearest *positioned* ancestor and would answer from another coordinate system.
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
- **The transcript is a side view of that column and is measured by nothing.** It is
  another document in the same box, reached by `source ▸`, and it **does not ship** —
  `attachTranscript` is in `check-ports.mjs`'s `UNWIRED` list — while the caption over the
  guard says « tout ce qui part doit avoir été affiché ». Making it a *view* that must be
  covered is what the rule below cost: a rep who followed one citation on a fifty-minute call
  paid **fifty page turns** to get *Valider* back, under a sentence naming the compte-rendu
  while the only control offered named the transcript, with an escape — one click on
  « Lecture » — that nothing on screen mentioned. The one feature this product has over a
  general-purpose notetaker was the only thing on the screen being punished for being used, for
  the second time (the first was *Demander*, inside the measurement, fixed with
  `data-unmeasured`). It contributes no coverage either, which is what still refuses the attack
  below: opening the tab leaves `compte-rendu:<sent>` uncovered, and that is what is asked.
  `review-garde-citation` and `review-garde-transcription` are the pair, and a fix for either
  that breaks the other is the oscillation this guard has already been through twice.
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
- **The way back into a past call is a surface too, and it had had none of the attention.**
  Four defects on one journey, all found in an hour: the search box folded accents and **not
  the apostrophe**, so « appel d'offres » typed on an AZERTY keyboard found nothing while
  everything stored carries U+2019 — `check:french` enforces it in repo prose and
  `terms.fr-esn.ts` ships that very phrase as a Whisper boost term; `history:search` stopped at
  fifty rows and said nothing, under a preview screen promising « l'historique les porte tous »;
  *Historique*'s four panes were bare `max-h-72` boxes hiding **95%** of a fifty-minute
  transcript behind a hard edge; and `DayPane` drew « Aucune réunion ce jour-là » — or, worse,
  « le calendrier n'a pas été interrogé dessus » — *above* the list of that day's calls, on
  every past day of a rep's history, because the empty state was keyed on the **upcoming** half
  of the day while the past list was rendered unconditionally below it.
- **A check that measures nothing is worse than no check, and two did.** `shot.mjs --scrollers`
  scoped itself to `main *, aside *, dialog *` — a landmark list — and *Historique* has no
  landmark, so it visited **zero elements** there and printed « rien de caché » over four
  unmeasured panes. And it was **the only one of the six that never set an exit code**: every
  finding it has ever made was printed into a `smoke.mjs` run that passed, because smoke fails
  on a non-zero exit and on nothing else. Widening it to `#root *` and making it fail surfaced
  a real backlog on the first run — the signal rail, the *Demander* answers and *Historique*'s
  panes all cut content with nothing saying so. The exemptions are declarations, never
  omissions: `data-scrolls` on the notepad and the widget's live log, which hold more than their
  box by definition, and a size guard for `sr-only`, which is a 1×1 clipped box by construction.
  Same shape as the `drawn()` false-green already recorded for `--contrast`.
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
- **An accelerator that means « send » must not fire from the box whose content is
  being sent.** `Ctrl/⌘ Entrée` was allowed while typing, on the argument that it « submits,
  which is what those keys do in every mail client » — and that muscle memory is exactly what
  made it the most dangerous line in this product. The only screen that claims `valider` is the
  review gate, and two of the things a rep types there are **the follow-up mail's subject and
  its body**. In a mail client, `Ctrl Entrée` in a mail body sends that mail; here it fired
  `review:confirm` — the VerySwing task, the opportunity and the Outlook draft — with no
  idempotency key, no delete verb on `CrmPort`, and nothing on screen mentioning the
  accelerator. *Demander*'s input is on the same screen and did the same. It is claimed only
  outside an editable now, and losing it there costs nothing: the rep is one Tab or one click
  from the button, which is the gesture DEC-4 is about.
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
- **`Demander` reads the same transcript the recipe does, and says how much of it it read.**
  Three things were wrong at once on the surface whose whole claim is that every word is
  checkable. It read the **raw** log: `withoutChannelBleed` is imported in one place, for the
  compte-rendu, so on a laptop with open speakers — 24 of 38 rep segments, measured — the
  client's sentence existed twice and `askAnswer`'s blind search resolves `rep` first, so the
  client's price ceiling came back labelled « Moi » and the citation opened on the rep's echo
  (DEC-47). It **truncated silently**: `ASK_MAX_INPUT_CHARS` keeps the tail, 60 065 characters
  of 124 765 on a ninety-minute call, by a *character* slice — so the model's first line was
  half a speaker label — and nothing told the model or the rep, so a question about the first
  twenty minutes answered « la transcription de cet appel ne permet pas de répondre », which is
  a false statement about the recording. `ask.ts`'s own docblock said « when it truncates, the
  answer says so » from the day it was written. And a **blank quote** — which `min(1)` accepts,
  because a model sends a space rather than an empty string — was refused two schemas later by
  `TranscriptSpanSchema`, throwing a raw Zod issue array into a French panel and discarding a
  good verified citation beside it. A blank carries no claim, so it is the one thing dropped
  rather than marked, and dropped *before* the count, so « an answer with no citation is no
  answer » stands.
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

- **There is one lookup, and it is in `contracts` because the reader needs it too.**
  `locateSegments` matches over a **normalised, channel-joined** haystack — accents folded,
  punctuation dropped, turns joined — and `spanVerification.ts` is a thin wrapper over it.
  `TranscriptReader` could not import `core/domain/`, so it wrote its own:
  `segments.find((s) => s.text.includes(quote))`, raw, inside one segment, under a comment
  claiming it was « deliberately the same test `spanVerification.ts` uses ». It was not the
  same test in four ways, and every one of them happens on an ordinary French call — an accent
  the STT dropped, a typographic apostrophe, a trailing full stop the model added, and a quote
  spanning two turns, which fails **by construction** for every quote the channel join exists
  to bridge. So a rep pressed `[source ▸]` on a row the app had just certified and read « Cet
  extrait est introuvable dans la transcription » : this product's one advantage over a
  general-purpose notetaker, calling its own evidence fabricated. The fallback search box folds
  the same way, and `TranscriptFocus` carries the span's **channel** — rep-first on a laptop
  with open speakers finds the client's sentence on the rep's echo (DEC-41) and draws it under
  « Moi ». The property is a test now: whatever `confidenceOf` calls `ok`, `locateSegments`
  finds.
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
- **The AEC's three flags are asserted of the *shipped* constructor, and all three could be
  deleted at once without a single test noticing.** `does_not_cancel_without_the_high_pass_filter`
  built its own pipeline with the flag as a parameter and compared on against off — so it
  measured the **crate**, never `EchoCanceller::new()`, and flipping
  `enable_high_pass_filter(false)`, `enable_noise_suppression(true)` and
  `enable_gain_controller2(true)` in the product left all 31 tests green, including the one
  named after the first of them. The behavioural test drives the shipped canceller now (it
  fails on the flip, measured), and a second reads the three flags off the source, because
  `noise_suppression` and `gain_controller2` reshape the amplitude that `inputLevel.ts`, the VAD
  and DEC-40's too-quiet detector all measure *downstream* — a property of the rest of the
  product that no test of this file can see. Source as evidence, the `preloadUnwrap.test.ts`
  shape.
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

  **And the clock, which the stub's own docblock claimed twice to be checked here and was
  not.** It says, of the timeline it corrected — `startedAt` was `now − 22 min` against a
  14:30 slot and a `now` pinned at 14:35, so 14:13: fifteen minutes before the row was created
  and seventeen before an invite the product can arm five minutes early — « `harnessFixture.test.ts`
  asserts all three, on every meeting, in every scenario ». Nothing in the file mentioned
  `startedAt`, and reverting the hunk left the suite green. A comment is not a check, for the
  fourth time in this one file's prose. Asked now of **every meeting in every scenario on both
  halves of the Entra axis**, because the day the stub stages differs on all three: nothing
  dated after the pinned instant, `createdAt ≤ startedAt ≤ endedAt ≤ confirmedAt`, `startedAt`
  no more than `ARM_LEAD_MS` ahead of its slot, every `receivedAt` and every mark inside its
  own recording's window — and the **density**, which a clock cannot see.
  That last one was wrong in its first version and is the sixth time this fixture has
  flattered the app: it divided the characters by the span of the *turns*, which **excludes
  the silence by construction** — the one thing being asked about — and read 591 characters
  a minute on a transcript that holds 26. Measured against the *recording*: `m-lefort-cv`
  is a 62-minute call whose nineteen turns stop after 2 min 52 and are followed by
  **fifty-nine minutes of nothing**; nine of the day's meetings carried those same nineteen
  turns at 26, 33, 35, 39 and 48 a minute, and `m-lefort-decouverte`'s five turns over
  57 minutes were **8**. A real call measures about 1 386 (124 765 characters over ninety
  minutes). So every judgement about *Historique*'s four panes, `TranscriptReader`'s scroll,
  `ReadingColumn`'s « how much is left », the `--fade` ramp and the citation scroll was made
  against a document up to **fifty times shorter** than the product's. `fillCall` tiles the
  shared turns across each call's own window at `STEP_MS` — the call's own cited turns
  first, keeping their ids so `spanOf` still locates and `MARKS` still pins — and every
  record now runs at ~556 a minute for as long as its recording: `m-lefort-cv` is 413 turns
  and 34 658 characters. **Which found the defect the sparse fixture was hiding, on its
  first run**: *Historique*'s transcript rows, the gate reader's, the widget's and
  *Demander*'s citations all drew turn text with `text-body min-w-0 flex-1` and **no
  `.measure`** — 97 characters a line at 12px in the 599px pane, which is the number that
  class exists to end. `--prose` now prints the first words of the offending run, because
  « span.text-body [hors .measure] » names a class fifteen elements share, and narrowing one
  finding to a file by elimination took three runs of a check that had the string in hand.
  Both readings are
  derived: the scenarios come out of the stub's own branches, and `now` from
  `scripts/harness/pinnedNow.mjs` — extracted because `shot.mjs` and `serve.mjs` each held a
  character-for-character copy, and a test asking « is anything dated after the instant the
  fixture is pinned to » must not be a third. Reverting the hunk now costs 943 findings.
  **And the one axis a density cannot ask about is whether the recording is long enough
  to be a call.** `m-neovia-cadrage` is the flagship — every `session*`, `review*`,
  `widget*` and `session-demander` stage is it — and its slot was 14:30 against a `now`
  pinned at 14:35, so on every scenario where it has *ended* (the gate, the compte-rendu,
  both enhancement cases) it was a **three-minute** sales call that produced eleven typed
  fields, a full ESN compte-rendu, two marks and an Outlook draft. 1 595 characters over
  three minutes is 532 a minute, comfortably inside the band. The slot moves with the state
  now: live it is 14:30 and the pill is five minutes in, which is what the calendar stage
  is for; ended it is 13:45 and the call ran **forty-seven minutes**, finishing three
  minutes before the pinned instant, with `review:transcript` tiled to match — 313 turns,
  26 292 characters, 559 a minute. The gate's reader, `review-garde-transcription`,
  `ReadingColumn`, the `--fade` ramp and the citation scroll had never once been
  photographed against a transcript the product can produce, and this file's own « fifty
  page turns on a fifty-minute call » was unreachable from any stage.
  Two lies it found on its first run. `LEFORT_SEGMENTS` stamped five turns one **minute** apart
  that `startMs` places twelve **seconds** apart — the reader draws `receivedAt` as wall clock
  and the gate draws `span.startMs` as an offset, so the same five turns were a four-minute
  conversation on one screen and a fifty-six-second one on the other, at 115 characters a
  minute. And the fallback record handed *Néovia's* `receivedAt` stamps to every meeting it has
  no entry for, so *Historique* on the 9:01 Sodexial call drew nineteen turns stamped 14:30,
  four and a half hours after the recording being read had stopped. The turns are deliberately
  shared — a generic record is there for *volume* — but when they happened is not shareable.

- **A call nobody scheduled is still a call** (`core/domain/adHoc.ts`,
  `native-module/src/mic_apps.rs`). Arming was « calendar signal × process signal », so an
  event with attendees was *required* — and a client who rings at 11:05 about yesterday's
  proposal has no event, which for a sales rep is a large share of the day. The second signal
  is now « which application holds a **microphone** », which is what separates « Teams is
  running » from « Teams is in a call » and is the one thing Granola had that this did not.
  Five things are load-bearing. **It is not a new addon**: the rule allows one *third-party*
  native addon and this crate is ours — `cidre` already carries
  `kAudioHardwarePropertyProcessObjectList` and the `windows` crate already carries
  `IAudioSessionManager2`, so the whole cost was three feature flags. **Reading the macOS
  process list does not light the microphone indicator** — measured, `DeviceIsRunningSomewhere`
  stays 0 across 50 polls — which is not obvious, because `abi_probe` exists precisely because
  cpal's device *enumeration* does. **We are on that list ourselves** and genuinely hold the
  microphone during every recording, so `mic_apps.rs` excludes its own pid; a detector that did
  not would report a call in progress for the whole of every call it was already recording.
  **A dwell of twenty-five seconds is the whole safety argument**: a Slack voice message, a
  dictation and « test your microphone » all hold an input stream for a few seconds, and an
  offer per blip is nagging during a client call. And **every branch carries its own horizon,
  including the ones that decide nothing** — they did not, so the caller fell back to the
  calendar's five minutes and a call starting at t=0 was offered at **t=325s** on the build
  with no calendar; it is 55s now. The strong signal also admits what the process list never
  could: a browser tab, a Slack huddle and Aircall are `micOnly`, matched by microphone and
  never by name, because they are open all day.

- **The calendar overwrote its own standing offer, and nothing could name it again**
  (`Agenda.#withdrawCalendar`). Round 25's finding in its **third** direction and the one
  nobody had driven. `#arm` overwrites `#armed`, which is why `#withdrawAdHoc` exists and
  why `#adHocArmed` is its own field; the calendar half was never written. Two invites
  that abut — 14:00–15:00 and 15:00–16:00, the ordinary shape of a rep's day — and at
  15:00 `nextArmable` answers `arm` for the second, so `tick`'s expiry branch is an
  `else if` that never runs. Measured on the shipped class: `["armed","armed"]` at 15:00
  and `["armed","idle"]` at 17:00 — the second withdrew itself, the first could not.
  Three costs, all past a relaunch because the row is in the store: **every installer
  refused** with « une réunion est sur le point de démarrer » about a call that never
  happened; the **ad-hoc detector off for the working day**, because `meetingLive` counts
  that row and `#adHocSpent` latches — one offer for a genuine 17:00 client call on two
  non-adjacent invites and **zero** on two that abut; and a row in *À venir* wearing
  « Prêt », past `entries.ts`'s `isPast`, on a day four days gone. `agenda.test.ts` had
  the ad-hoc → ad-hoc and calendar → ad-hoc directions, both named after this exact harm;
  the calendar → calendar one had no test and a hundred and one tests passed with it live.
  **And `arm` was legal beside a live recording**, because `MeetingSession`'s table is per
  meeting and `dispatch`'s « one recording at a time » guards `start` only. A 14:00 call
  running to 15:05 — what a call that matters does — armed the 15:00 invite beside it:
  `liveStates = ["recording","armed"]`, *verbatim* the string this file names as the
  defect round 24 closed, with a **second OS notification whose click navigates the rep
  off their live recording** (DEC-46). A call under way takes the conversation and the
  calendar waits; the next tick after the rep ends it arms the invite, because `#spent`
  then filters the finished call out.
  **And `armNow` returned whatever was armed, not what the rep pressed.** It read `#armed`
  back on the argument that « the id the renderer should open is whatever the agenda now
  says is armed », which is true of the exits it listed and false of the two it gained:
  a refusal for this event, and a call under way. Measured: `armNow('EV-A')` returned
  EV-B's meeting id, so pressing *Enregistrer* on Sodexial's row opened **Néovia's**
  session screen, where the next press records the Sodexial call into Néovia's meeting —
  its `eventId`, its attendees, its `speakerLabel`, its account, and therefore its
  VerySwing task and its Outlook draft. The round-27 docblock beside `#refused` says
  « `armNow` throws each time, so the rep is told »; it did not throw, it silently named
  the wrong meeting. Shape #7, in prose added the round before.
- **Every claimant, and every candidate — one spent slot took the whole calendar's word
  with it** (`calendarClaims`, `Agenda.#spent`). **Sixth consecutive round on the
  arbitration rule**, and the fifth time the previous fix was right about the axis the
  round before it named. Round 27 gave `#calendarOffersAt` the right question — « is the
  calendar *done* with this conversation » — and asked it of `calendarClaim`, which
  answers **one** event: the earliest. So when that one was spent, the conclusion was « the
  calendar accounts for nothing », discarding the claim of every *other* slot covering the
  same instant. Measured: a 14:00 call the rep ended at 14:20, the rep joining their own
  15:00 Teams invite at 14:50 — the thing round 26 established as what a sales rep does
  before a call that matters — and « Appel non planifié — Teams » armed at **14:50:25**
  with the DEC-46 notification behind it; take that offer and at 15:00:25 `liveStates` is
  `["recording","armed"]`, two rows on the day, a second notification whose click
  navigates the rep off their live recording. Twenty-five minutes wide for every adjacent
  pair of slots, and on the demo build DEC-28 ships first *every* recorded call is `ended`
  for ever (DEC-39), so every slot following one was exposed. What it costs is the whole
  value of having consulted the calendar: no attendees, no objet, « Client » instead of the
  person's name, no account resolution — therefore no opportunity — and a VerySwing task
  titled « Appel non planifié — Teams », with no idempotency key and no delete verb.
  **And the same shape one function over, which fixing the first exposed.** `nextArmable`
  prefers the earliest event whose slot contains `now` and knows nothing about session
  state, so the finished 14:00 call went on winning that comparison until its own slot
  closed while `#arm` refused it — and the 15:00 invite behind it was never reached.
  Measured: offered at **15:00** instead of 14:55, which is DEC-46's « something happens at
  14:30 » and the whole point of `ARM_LEAD_MS`; the notification now fires with the client
  already on the line. `#spent` is the one predicate for both — « has the product finished
  with this conversation », `AFTER_THE_CALL` from `core/contracts/` — and `armed` and
  `recording` are deliberately **not** in it, or the calendar would arm the 15:00 slot
  beside a 14:00 call still recording, which is the defect round 24 closed.
  **Fixing it moved a withdrawal out from under its only caller**, which is worth recording
  on its own: the re-check that drops a standing offer whose call has *ended* lived inside
  `#arm`, reachable only because `nextArmable` kept naming the finished event. Filtering it
  out took that path with it, and a rep who finished at minute 20 of a 60-minute slot kept
  « Prêt » and the day's one filled *Enregistrer* for forty minutes. The tick asks now, so
  the answer does not depend on which event `nextArmable` happened to pick. And the
  `agenda.arm.refused` edge — ninety-four identical rows in round 26 — is no longer
  reachable from the tick at all; it is driven on `armNow`, the rep's own press, because a
  test asserting a rate on a path nothing can take is the first shape on this list.
  Every `calendarClaim` test was single-event and `agenda.test.ts`'s own round-27 test
  stages one event, so nothing in the repo put two slots and a session state together.
- **One conversation, one offer — and the question is « does the calendar already account
  for a call happening now », not « is a meeting live »** (`AdHocInput.calendarOffersAt`,
  `calendarClaim`, `AdHocInput.spent`, `Agenda.#adHocArmed`). This rule has been the finding
  in **four consecutive rounds**, and the pattern matters more than any of the instances:
  rounds 23, 24 and 25 each reached for the *predicate* — the horizon, then a hard-coded
  `false`, then two states out of six — and the predicate was never the problem. Round 26
  found that the whole **axis** was wrong.
  **A rep joining their own scheduled Teams call early has no live meeting, no armed meeting
  and a held microphone**, so every version of the live-meeting predicate answered « nothing
  is happening » and the detector offered an unscheduled meeting for a scheduled call. The
  boundary was `ARM_LEAD_MS + AD_HOC_DWELL_MS` — anything from **five and a half minutes**
  early, measured, and joining early is what a sales rep does before a call that matters. Take
  the offer the OS notification points at and at `scheduledStart − 5 min` the calendar arms the
  same conversation again: `liveStates` becomes `["recording","armed"]`, which is *verbatim* the
  string `meetingLive`'s own docblock quotes as the defect round 24 fixed, with two rows on the
  day and a second notification whose click navigates the rep off their live recording.
  `calendarClaim` is the fix and it is a **deferral, not a refusal**: `decideAdHoc` returns
  `none` with the calendar's own offer instant as its horizon, so the rep gets the *better*
  offer — attendees, objet, `speakerLabel`, account resolution — at the first moment it exists.
  `CALENDAR_CLAIM_MS` is 30 minutes and is deliberately **wider than `ARM_LEAD_MS`**: the
  calendar's claim on a conversation reaches further than its readiness to arm one, and
  conflating the two is what made this a four-round bug. The number comes from the asymmetry of
  being wrong — too wide costs a missing offer, which has a remedy the rep already has and
  which is the *fast* route (« Démarrer une réunion »); too narrow costs a duplicate row in a
  client's CRM, where `POST /v1/crm/tasks` has no idempotency key and `CrmPort` has no delete
  verb. It deliberately does **not** widen `ARM_LEAD_MS`, because arming *on* a held microphone
  claims this call is that event, and the further from the slot the weaker that claim is.
- **And the gate is open because the rep opened it, not because the log says so**
  (`Orchestrator.atGate`, called from `review:get`). The narrower set below traded a
  permanent false refusal for a **silent permission**, and only the first half had a test.
  `awaiting_confirmation` blocks an installer because, in `updateGate.ts`'s own words,
  « the rep is at the one human gate (DEC-4) with edits on screen that have not been
  confirmed. Restarting discards their corrections — the single thing the review gate
  exists to preserve. » Nothing *dispatches* when a gate opens: `review:get` reads the
  projection and asks `stateOf`. Measured: launch 1 refuses with « un compte-rendu attend
  votre validation »; launch 2 opens the same gate and answers `{ safe: true }`. So a rep
  who records at 17:00, quits, comes back Friday, corrects the compte-rendu and three of
  the eleven fields — `PENDING_EDITS` is deliberately in memory — is offered « Installer
  et redémarrer », and `updateTick` downloads the installer while they stand there. On the
  demo build DEC-28 ships first every meeting sits in `awaiting_confirmation` until
  validated, so every gate opened the morning after was unprotected. The trigger is the
  gate *opening*, said once, after the availability check — never the stored state, which
  persists for ever with no model (DEC-39) and would refuse every installer for ever,
  which is the defect below.
- **What the process is *doing* is not what it has looked at** (`Orchestrator.#touched`).
  `liveStates()` and `liveIds()` were `#sessions`, and `#sessions` is the **rehydration
  cache**: `session()` loads a meeting from the log on demand and keeps it, so *asking a
  question about a meeting made it live for the rest of the process*. The docblock two
  lines above `liveStates()` stated the property that breaks — « a meeting finished last
  week sits in the log and blocks nothing » — and it was false of every read path in the
  product: `meeting:get`, `review:get`, `history:record` and `Agenda`'s own calendar poll
  all call `stateOf` or `session`. Measured on a store a previous launch filled: boot
  answers `[]` and `{ safe: true }`; **one read of a call that ended yesterday** answers
  `["ended"]` and « un compte-rendu est en cours de rédaction », for the life of the
  process. So opening *Historique* on a past call refused every installer for the rest of
  the session, on the primary platform (HR-2), with a sentence that is false — and on the
  demo build that is every call ever recorded, because `ended` persists indefinitely with
  no model (DEC-39). **Third instance of « the app could never install an update again »**,
  and round 27 made it certain rather than merely likely: `#calendarOffersAt` asks `stateOf`
  on the thirty-second tick, so one tick of an ordinary morning — no conferencing audio,
  nothing armed — was enough. The cache stays a cache, because a `MeetingSession` is the
  writer for its own log and two instances would be two objects appending to it; what was
  wrong was reading it as the answer to a different question. `create` and `dispatch` are
  the only things that mint or move a state, so those two are « work in flight in this
  process » — which covers the boot re-drain, a crash-recovered `recording` and
  `before-quit`'s search for the live call, and excludes a screen that read a row.
  `Orchestrator` had **no test file of its own** for twenty-eight rounds, and
  `agenda.test.ts` could not have caught this by construction: it dispatches into the same
  orchestrator it then questions, so the session is in the acted-on set either way.
- **One recording at a time, and only `dispatch` can say so** (`Orchestrator.dispatch`).
  `MeetingSession`'s transition table is per meeting, so `idle → recording` was legal for every
  session independently and nothing above it asked. Measured: `liveStates =
  ["recording","recording"]` — two `startRecording` calls, **two microphone and two
  system-audio handles on the same devices**, two transcribers, two compte-rendus and two CRM
  pushes for one conversation; and the widget adopts whichever `widget:state`'s `.find()`
  returns, then silently re-points at the other on the next `session:changed`, carrying a
  different `startedAt` and a different mark list. `Orchestrator.recording()` already answered
  this question and had exactly **one** caller — the onboarding dry run, which asks precisely so
  it will not open a second handle on the same devices. The state machine never asked it. The
  guard is in `dispatch` because that is the one chokepoint every route goes through, and it is
  a refusal with a sentence rather than a silent no-op (DEC-26).
- **« Over » means over, and `wait` is not `over`** (`Agenda.#over`). The expiry branch
  withdrew a standing calendar offer on *any* non-`arm` answer from `nextArmable`, and `wait` is
  one of them. Two ordinary things therefore destroyed a good offer. `armNow` — the rep pressing
  *Enregistrer* on an upcoming row, deliberately without consulting `decideArming` because « the
  detector guesses, the rep has said » — was **undone by the very next tick** outside
  `ARM_LEAD_MS`, logging `disarm` with « la réunion est passée sans enregistrement » about a call
  half an hour in the future; and since that control renders only while the row has no meeting,
  and the press creates one, it was gone for the rest of the day: the defect `b497664` added
  that control to end, reachable by pressing the control `b497664` added. The same on the clock
  path, which nobody had noticed — inside the window with no conferencing audio `decideArming`
  answers `wait`, so a rep who closed Teams after the offer appeared lost it. Over means absent
  from the fold, cancelled, or past `scheduledEnd + OVERRUN_GRACE_MS`, which is the boundary
  `decideArming`, `entries.ts`'s `isPast` and `calendarClaim` all already use; the test asserting
  withdrawal at `scheduledEnd + 1ms` was encoding a boundary that contradicted all three.
  And **`armNow` raises no notification**: DEC-46 says the OS notification's click is « the only
  thing in the product that navigates without the rep having pressed something inside it », and
  `armNow` *is* a press inside it.
- **The three that came before, kept because the sequence is the lesson**
  (`AdHocInput.spent`, `Agenda.#adHocArmed`). Round 23 found the horizon. Round 24 found that
  `calendarArmed` was passed a hard-coded `false`, so the rule it named was never applied at all.
  Round 25 found it broken in two more places, both structural.

  **The withdrawal must not read its target out of the field being overwritten.**
  `#withdrawAdHoc` took the meeting id from `#armed`, and `#arm(event)` *overwrites* `#armed`.
  So a rep pressing *Enregistrer* on an upcoming calendar row while a call was detected left
  the ad-hoc meeting `armed` with nothing in the product able to name it again, and that cost
  three things for the life of the process: `armed` is in `UPDATE_BLOCKING_STATES`, so **every
  installer was refused** with a sentence that was false about a call that had ended;
  `meetingLive` read that row and answered `none` for every subsequent call, so **the detector
  turned itself off for the rest of the working day**, looking exactly like it deciding not to
  offer; and the row sat in *À venir* wearing « Prêt », past `listMeetings`'s filter, which
  deliberately keeps a standing ad-hoc offer because one wants attention. Verbatim the harm
  `#trackHold`'s docblock says it ended for the Teams→Zoom case, reintroduced one caller over.
  `#adHocArmed` is its own field for that reason, and `#arm` withdraws before it overwrites.

  **Suppression is a decision about the conversation, not a pause keyed on an instant.**
  `meetingLive` counted `armed` and `recording`, so the guard held during a recording and
  *released* at `ended` — with the microphone still held by the same call. « Press *Terminer*
  while still on the call », which the widget's own docblock calls an ordinary thing for a
  client to ask, made the detector offer to record the conversation it had **just recorded**,
  with an OS notification whose click navigates the rep off the compte-rendu; the same held at
  `awaiting_confirmation`, the one screen DEC-4 protects. `#adHocSpent` marks the hold at the
  moment the product starts working on a meeting, and it stays marked, because it is the same
  conversation whatever happens to the meeting afterwards.

  **And the obvious fix — widen the state set — is a worse defect than the finding.** The
  round proposed `!['idle','done','aborted'].includes(state)`, which is the list `Agenda`'s
  own comment named, and that comment was the thing that was wrong. `ended` and `extracting`
  persist **indefinitely** when no language model is configured: DEC-39 says the app states
  the case and waits, and that is every meeting on the demo build DEC-28 calls the first
  deliverable — so counting them turns detection off permanently after the first call, which
  is the stranding above by another route, on the build that ships first. It is driven as a
  test (« but a meeting waiting for ever on a model does not deafen the detector »). What
  closes the window is *when* it closes, not how wide it is.

  The horizon survives all of this, and the reason is the unit: a genuinely new call is a new
  **hold**. `#trackHold` clears the latch on a lost hold and on a change of application, and a
  conferencing application releases the microphone when its call ends, so « end one call, take
  another » arrives as a different `heldSince` and is offered. The other half is unchanged — a
  change of held application withdraws the standing offer before the new dwell begins, because
  `#armAdHoc` mints its id from `heldSince`.

- **Ease-out on the way in, ease-in on the way out — and every curve in `:root` being a valid
  curve is why no check could see it** (`--ease-in`, `shot.mjs --motion`, VISION.md §6).
  There was one curve and §6 said « ease-out » flat, so the one exit in the product took it.
  `--ease-out` is `cubic-bezier(0.22, 1, 0.36, 1)`, an expo-out that spends 73% of its change
  in the first 35 ms — exactly what makes something *arriving* feel instant and then settle,
  and on something *leaving* a **blink**: measured on the shipped `.widget-leaving`, opacity
  above 0.05 for **62 of the 150 ms**, the 3 px translate spent entirely below 25% opacity
  where there is nothing left to see moving, and then 88 ms of a fully transparent, frameless,
  always-on-top window still holding its place over the rep's call. `--ease-in` is `--ease-out`
  mirrored through the diagonal, so the two are one curve read in two directions and there is
  no second piece of taste to keep consistent. 62 ms → **147 ms** after the swap.
  Two instrument gaps let it through and both are closed. `--motion` validated that a curve
  *is* a token — and builds that set from `:root`, deliberately, so a new token is honoured the
  moment it is declared — which can never ask which end of the motion the slow part belongs to;
  it now fails an element whose class says it is leaving while it carries the entering curve.
  And **no stage emitted `widget:leave`**, so `.widget-leaving` was visited by none of the eight
  checks on any of the 104 stagings: `widget-sortie` is that stage, and its picture is a blank
  card by construction, because an exit ends at opacity zero and `smoke.mjs` drives every stage
  with `--no-png` anyway. The reasoning that shipped the wrong curve was « the difference is
  imperceptible at 150 ms », which is what reasoning instead of measuring looks like on a
  project whose method is to measure the shipped box.
- **A check's own self-test is a check, and this one measured nothing while reporting green**
  — the fifth instance of that shape in this repo, and the first found *inside* an
  instrument. `SILLAGE_MOTION_ATTACK=1`, offered in `motion()`'s docblock to « anyone touching
  this function », injected its rules at `#root h1` and `h2::after`. The widget renderer has
  no `h1`, so on `widget-sortie` — the one stage that exists to look at the only exit animation
  in the product — the self-test **exited 0**. It injects into `#root` itself now and reports
  five attacks caught with a sixth left deliberately silent as the control, so a pass says what
  it measured.
  **And a ninth probe, for the split-rule spelling**, because the eight before it all wrote
  the endpoint and the motion in one declaration block — which is exactly how the rule they
  were testing came to have that hole.
  **And then the fifth of those five probes was measuring the first one's artefact.** It was
  `persisting.length > 0` with the infinite animation riding on probe 1's element — and that
  element also carries a literal `777ms` *transition*, which survives reduced motion for
  reasons that have nothing to do with probe 5. So deleting `infinite` from the attack outright
  left the self-test reporting « les cinq attaques signalées » with no infinite animation
  anywhere on the page. Measured. Every probe is asserted **by the name of the element it
  creates** now, never by a count: `backwards.length >= 3` could not say *which* of the three
  departure shapes had stopped being seen, so one going quiet while another over-reported held
  the threshold. Eight that must fire, one that must stay silent.
  **The keyframes census read declaration order, so four spellings of one fade-out were
  invisible** — and a keyframes the census does not recognise makes `leavingHere` answer false,
  which switches the direction rule off for that element rather than turning it red. It took
  `cssRules[0]` and `cssRules[last]` and asked `last < (first ?? 1)`, so `{ to { opacity: 0 } }`
  read `0 < 0`; `{ to {…} from {…} }` and its percentage spelling read backwards; and a
  `0%, 100%` `keyText` put two offsets where the code expected one. Rewriting the product's own
  exit as a `to`-only `@keyframes` on `var(--ease-out)` — the exact blink the rule exists to
  end — reported « 0 qui s'en vont … dans le bon sens, 0 @keyframes de sortie » and passed at
  both sizes. `keyText` is parsed now (`from` → 0, `to` → 100, the list split), the frames that
  declare an opacity are sorted by offset, and an endpoint nothing declares is the element's
  own — which is what makes a `to`-only fade-out read as the departure it is, while a
  `0%, 100% { opacity: 1 }` pulse still reads as none. A `to`-only probe joined the attack.
  **And the third of `leavingHere`'s three signals is inline, not computed, and the docblock
  said computed.** A computed zero under a live duration is the reveal-on-hover mark button —
  resting at zero and *arriving* — which is the seven false findings that rule was rebuilt to
  lose. The code was right; the prose describing it was one word too broad.
  **And the escape test was wrong in three ways at once, two silent and one crying wolf.**
  The `opacity: 0` half was fixed in the stylesheet and left demanding the pair *inline*,
  so `style={{ opacity: leaving ? 0 : 1 }}` with the transition in a class took the exit
  out of the rule exactly as the split-rule spelling had — the same mistake one level down.
  Any non-zero opacity under a state counted as an escape, so an ordinary
  `.pill:hover { opacity: .85 }` **permanently exempted that element's departure**: an
  escape from invisible is a restore to *visible*, and a hover that merely dims says
  nothing, so the threshold is `1`. And only *pseudo-class* states counted, so every reveal
  gated on a class or an attribute — `.is-shown`, `[data-open]`, `[aria-expanded]`, which
  is how anything driven by JavaScript rather than by the pointer is written — was reported
  as a blink on correct code; the pseudo-classes are stripped globally and then the
  trailing simple selectors of the last compound are peeled one at a time, so an element
  the reveal is *for* is recognised while `.group .x` never degrades to « anything inside
  `.group` ». Eleven probes now, two of which must stay silent.
  **And « the endpoint and the motion are declared in the same block » was the wrong
  discriminator, defeated by the most ordinary way to write an exit.** That rule was
  measured and it was right about the seven mark buttons on `widget-ouvert` —
  `opacity-0 transition group-hover:opacity-100`, an affordance in the layout at all times
  that fades *in* on hover — and it was wrong about the property. Split the product's own
  exit the way almost everyone writes a state-class exit — `transition` on
  `.widget-shell`, `opacity: 0` on `.widget-leaving` — and the widget leaves the direction
  rule entirely: « 0 sélecteur(s) « opacity: 0 », 0 qui s'en vont, dans le bon sens »,
  exit **0** at both sizes, twelve gates green, 130 renderer tests green — on `--ease-out`,
  the 83 %-front-loaded curve, which is the exact blink the rule exists to end. The
  self-test could not see it either: all its fade probes declared the pair in one block.
  What actually separates the two is **whether the transparency has an escape**. A
  reveal-on-hover is escaped by a state, and the rule granting the opacity back carries
  `:hover`, `:focus` or one of their family in its own selector; a departure has no such
  rule, because the element is going away and nothing the rep can do brings it back. So the
  question is asked of the element with the state stripped off the selector — « does this
  element have a hover that lights it up » — which needs no opinion about Tailwind, about
  class names, or about which end of a block something was written in. Measured across all
  108 stagings: no false positive, and `widget-ouvert` still reports zero departures over
  twelve animated elements.
  Three more holes in the direction rule, all one round old and none found by its author.
  Renaming `--ease-out` turned the whole rule **off** rather than red, because `enterCurve`
  became `''` and `allowedEase.has('')` is false. An `SVGElement`'s `className` is an
  `SVGAnimatedString`, so `.toString()` is the literal `"[object SVGAnimatedString]"` and an SVG
  could never say it was leaving. And `tailwind.config.js` ships the utility class `ease-out`,
  which the word-boundary regex matched as `out` — a false positive one keystroke from a
  developer writing an ordinary class name, and a false positive here is worse than the hole,
  because a check people work around is gone.
- **`--ease-in` is pinned by its *shape*, not its string** (`tokens.test.ts`). Redefining it to
  `cubic-bezier(0.22, 1, 0.36, 0.99)` restores the blink and passed every check, because the
  allowed-curve set is built from `:root` — deliberately, so a new token is honoured the moment
  it is declared — and nothing asked what the curve *does*. Two assertions now, and the second
  is the one that matters: the property is **rotation by 180° about the midpoint**, which is
  what reversing an easing actually is, and there is a trap in the obvious version worth
  recording — naively reversing `(0.22, 1, 0.36, 1)` gives `(1, 0.22, 1, 0.36)`, which is not
  the mirror and not `--ease-in`. Beside it, a behavioural test: an exit curve must be
  **back-loaded**, measured as progress at an early fraction of the duration, so *any*
  front-loaded curve fails and not only the one that shipped.

- **A synthesised end is not a scheduled end** (`Orchestrator.#startEndWatch`). `graceFor`
  shortens the end-of-meeting grace from 75 s to 25 s once the silence begins past
  `scheduledEnd`, and that reasoning is entirely about a *calendar* slot. Both paths that
  create a meeting without an invite invent that number — `adHocContext` writes
  `heldSince + 1h` under a docblock saying « it is not a claim about when the call will end »,
  and `manualContext` writes `endedAt ?? updatedAt`, which for a live meeting is roughly *now*.
  So a 25-second pause at minute 61 of an unscheduled call ended the recording, and a manual
  one ran on the short grace from its first second. `eventId === null` is the fact that
  separates them, and it restores the rule stated above — « a session with no calendar entry
  always gets the full grace » — which had a test named after it that passed because it
  supplied a null *context*, not a context carrying a synthesised end.

- **Detection does not require Microsoft** (DEC-28, DEC-26). `Agenda` was constructed only
  inside the Entra branch of `main.ts`, under a comment arguing that arming with no event was
  « structurally impossible rather than merely unimplemented ». That was true of every rule the
  product had and is false of `adHoc.ts`, so the gate had started costing the thing it
  protected — on the **demo build**, which DEC-28 calls the first deliverable and which is the
  one configuration where nobody has completed an Entra registration. It is built over
  `NULL_CALENDAR` in both branches now, with **no `onHealth` in the null one**: a calendar that
  is absent must never be reported as a calendar that is well. The no-Entra health sentence
  names what is actually lost — the calendar, the five-minute anticipation, the attendees, the
  objet — and no longer claims that nothing will be offered, because that stopped being true.

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
  an allowance whose method has since disappeared also fails.

  **And for a dozen rounds it asked that of one port out of nine**, while this
  paragraph and its own docblock both said « every method on a port declared in
  `core/contracts/` ». `PORTS` was a hand-written list with `CrmPort` in it, « because
  that is where it was first asked ». Ports are **discovered** now — every
  `export interface` in `core/contracts/` with at least one method, and a discovered
  port with no declared home fails, so the list cannot rot back into one entry — which
  took it from 6 methods to 28 and surfaced `LlmPort.complete`, declared, implemented,
  unit-tested seventeen times and called by nothing.

  **And it failed on an ordinary respelling of live code, which is the worse direction.**
  The caller test demanded `(` adjacent to the method name, so replacing
  `(await deps.updates?.install()) ?? false` with a `.bind` and a call through the bound
  reference type-checks clean and took the check to exit 1: « UpdatePort.install n'est
  appelé nulle part ». The remedy its own sentence names is an `UNWIRED` entry — standing
  permission on working code, the exact rot that list is documented to prevent. A method
  taken as a value *is* the port being reached, so `.bind(`, `.call(`, `.apply(` and being
  passed as an argument count. The followers are **enumerated** rather than dropped,
  because a bare word boundary would re-admit the false green: a docblock in a caller file
  writing `` `updates.install` `` inside backticks would satisfy it, which is the shape that
  let `CalendarPort.sync` pass on prose about `CalendarPort.sync`. Both directions are
  driven — a dead method still fails, and prose naming a method does not satisfy it.

  **And the one escape hatch the per-file scoping had to keep reopened it for the one name
  that collides with an Electron global.** `ambient` — receivers a `.d.ts` or a
  `declare global` makes available — was a flat set, and `src/vite-env.d.ts` declares
  `app: AppBridge`, so `app` counted as a receiver of `AppBridge` in **every** file,
  including `electron/app/main.ts` where `app` is Electron's own `App`. Measured:
  `AppBridge.on` reported five callers, four of them `app.on('before-quit')`,
  `app.on('second-instance')`, `app.on('window-all-closed')` and `app.on('activate')`. The
  verb is genuinely wired by the fifth, so it was a measurement hole rather than a live
  false green — and it could never have gone red while `main.ts` registers a lifecycle
  handler, which it always will. An ambient declaration is scoped by the *project* that
  includes it, and `src/` and `electron/` have separate tsconfigs, so the tree of the
  declaring file is the honest scope. **And `HOMES` named `electron/app/preload.ts`, which
  has never existed** — the preload is `electron/preload.ts` — so `inHome` excluded nothing,
  the implementation was scanned as a caller of its own port, and the sentence a failure
  prints pointed at a file nobody could open. A home that is not on disk fails now, which is
  the `check-platform.mjs` half that matters most.

  Two things about the *caller* test were worse than its scope, and both are the shape
  this repo keeps finding. It was `[.\w]${method}\s*\(`, which lets the method name be
  the **tail of another identifier**: `CalendarPort.sync` matched forty files, of which
  two really call it, satisfied by `readFileSync(`, `execFileSync(` — and by **`async (`**.
  A port method was therefore reported as wired because the file contained the word
  `async`. And it demanded `(` immediately after the name, so every generic call was
  invisible: all three real callers of `LlmPort.structured` write `.structured<T>({`, so
  turning the widened check on unchanged would have reported the live compte-rendu, the
  signal rail and *Demander* as dead code — a false positive that gets working code
  deleted, which is worse than the hole it was fixing. The test is receiver-aware now,
  with the receivers derived from the tree's own `: PortName` annotations, and an empty
  receiver set is itself a finding.

  Two are listed today, and there were three. `attachTranscript` and `createContact`
  both *write into the client's systems* and belong in the gate's intent list as a
  decision, not as a side effect of extraction.

  **`LlmPort.complete` was the third, listed as « declared debt rather than pending
  work », and the entry was itself the defect.** The argument for keeping it was that
  `OpenAiCompatibleLlm`'s HTTP-error tests drive `#chat` *through* it, and that moving
  them onto `structured` « folds schema parsing into tests whose whole job is to check
  that a 429 becomes a `quota` error ». Both halves were wrong. The seventeen calls were
  **all in that one test file**, so the tests were the only thing holding the verb up —
  a declaration kept alive by its own coverage, which is `check:ports`' own finding one
  layer up. And the schema can be permissive: `ANY` is `z.unknown()`, so the transport
  tests still measure the status, the stream and the deadline, and the schema tests next
  to them keep a shape that bites. `LlmPort` has one verb now, the cost the entry named
  is gone — `llm.ts` no longer documents « two verbs, because there are exactly two
  jobs » to every adapter, and there is no un-schema'd prose channel to send a model's
  unvalidated text down. The empty-reply guard moved from `complete` into `#chat`, where
  it is **stronger** than it was: `structured` used to turn a 200 with nothing in it into
  a `LlmSchemaError` — `retryable: false`, a statement about the shape of a reply there
  was none of — and abandoned an extraction on a blip the outbox would have cleared.
  `LlmSchemaError extends LlmError`, so the test that was there could not tell the two
  apart and the new one asserts against it.
- **And the fourth boundary is a class method in `app/session/`, where it costs most.**
  The nineteenth round said the check below asks the right question at three places and
  `check:ports` at a fourth, and that **none of them asks it of a method on a class in
  `electron/app/session/`** — which is where the state machine, the outbox and the enhancement
  runner live. Three were found there at once, all the same shape, all green in every suite.
  `Outbox.isDraining` answered « is a push in flight » and the quit path that needed exactly
  that question asked a different one, so « press *Valider*, close the window » abandoned a
  POST. `Enhancement.isRunning` answered the same question about extraction, which nothing
  asks. And `EndOfMeetingWatch.manual` — « the rep pressed *Terminer* » — had no *correct*
  caller either: `stopRecording` already calls `stop()` on that watch, so `manual()` would
  have fired `onEnd` on a meeting the orchestrator was ending. A public method here is an
  offer, and **a test is not a caller**. The scope stays narrow deliberately: this is the layer
  where « nobody calls it » is a behaviour that silently does not happen.
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
- **A term the rep's calls keep producing outranks one added once** (`Lexicon.observe`,
  DEC-17). `correct()` has always returned `applied` — « the enrichment signal for `hits` », in
  its own docblock — and the corrector in `main.ts` threw it into a diagnostic line and nowhere
  else. So `hits` was zero on every row of every install, `forClient`'s `ORDER BY hits DESC`
  ranked nothing, and the truncation that decides which terms reach a Whisper prompt fell back
  to `created_at`. `observe` was declared, implemented and unit-tested, with its test as its
  only caller: the shape `check:ports` exists to catch, one layer below where that check looks.
  Only rows this meeting loaded are counted — `applied` also carries the shipped ESN list, which
  lives in code and has no row — and the write happens inside the try/catch that exists so a
  correction table can never cost the sentence (DEC-26).
- **Deterministic data never comes from the LLM** (DEC-7). Attendee names, emails, dates and
  account codes come from Graph or VSA. `LlmInterpretation`'s schema has no fields for them.
- **Confidence is measured, not self-reported** (DEC-21). Every interpretive field cites a
  transcript span; the app verifies the span exists. No verifiable span → `⚠ faible`.
- **Never write to the Outlook event body** (DEC-10). It mails attendees and destroys the
  Teams join blob.
- **We create drafts, never send mail** (HR-8). `Mail.ReadWrite`. Never `Mail.Send`.
- **Raw audio is never retained** (DEC-12). Transcribed and discarded.
- **A message the product did not write is declared, not cleaned** (`npm run check:diag`).
  `redactMessage` is a denylist over free-form text and it leaked in **four** consecutive
  rounds — a Windows home directory, a vendor API key, a client's name inside a quotation, and
  then a client's name that quoting *published*: ASCII `'` was a self-closing delimiter, so an
  odd count (an English possessive, a French elision — what a foreign string is made of) ate
  the gaps, and `recipient 'Jean-Pierre Dupont' for 'Sodexial'` came out as
  `recipient [quoted] for [quoted]Sodexial'`, bare, with the innocent English deleted instead.
  The verdict after the third round was already written down: **a denylist over free-form text
  cannot be made safe, only made narrower** — « Néovia Santé » is an ordinary capitalised
  French word and no rule separates it from « Windows Defender ». So the narrowing stopped.
  `DiagEvent.origin` is `'foreign'` when the text is not a literal this product wrote, and the
  redacted bundle carries `[message:N]`; `code` and `detail` already hold what a support reader
  needs. **A declaration nobody is obliged to make is a comment**, so `check:diag` obliges it:
  a `.record({…})` whose `message:` is anything but a string literal must declare `'authored'`
  or `'foreign'`. Forty-eight sites declare, twenty-six of them foreign. The four private
  `#record` helpers in `app/session/` take `origin` as a **required parameter**, because a grep
  can only see the one `.record({…})` at the bottom of a fan-in.
- **`detail` is an allowlist over *shapes*, and a word is not a shape.** `redactDiagnostics.ts`
  claimed to be unable to be « wrong by omission », and it has been wrong by **admission**
  three times: at `{1,64}` it passed a key (`sk-proj-…`, 40), a bearer token (44), a URL and a
  home directory verbatim; at `{1,32}` it passed an Azure key, which is exactly 32. The bound
  is on the **segment** now, and `redactDiagnostics.test.ts` asserts refusal at *every* length
  from 21 to 64 for every credential alphabet, so no single number can again be one over.
  A capitalised word was then refused only when **alone** — for `detail: { subject }`, a
  meeting's objet, which is the client's name most days — and `isSafeString` short-circuited on
  `segments.length > 1`, so **one hyphen defeated it**: `Sodexial-staffing`, `Dupont-Marechal`,
  `CR-Sodexial` all passed. PASCAL is out of the segment set entirely; the one capitalised word
  this product mints is admitted by *position*, the vendor half of `Xenova/whisper-small`.
  What remains, stated rather than implied: a proper noun somebody **lowercased** or shouted in
  caps passes, because `far`, `rep`, `whisper` and `sodexial` are one shape and no tightening
  short of refusing `channel: 'far'` changes that. So `detail` is **not** where a foreign string
  goes to be safe — it belongs there as a count or a length, never as itself.
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
- **A change of output route during the call is said out loud**
  (`modules/capture/index.ts`, `AudioDevices.getDefaultOutputDeviceId`). That function existed
  for months carrying a docblock — « polled during a meeting: when it changes, the system
  capture has to be rebuilt or the tap keeps recording the old device — which is silence, not an
  error » — and **nothing polled it**. Plugging in a headset mid-call, or Teams moving itself to
  the communications device, silences the far channel for the rest of the meeting. The watchdog
  above notices the silence four seconds later; what it cannot do is say *why*, and « rien
  n'arrive de l'audio de votre ordinateur » and « la sortie audio a changé pendant l'appel »
  lead a rep to two different actions. So the route is read when the tap opens and on every
  tick, and a change is **reported, not repaired**: restarting a live capture is a bigger
  promise than can be kept on a platform this cannot be tested on from here. Said once per
  meeting — switching to headphones and back would otherwise say it twice, and the second says
  nothing new — `degraded` and never `down` (DEC-32), and `null` from an older binary means « we
  cannot tell », which is never reported as a change (DEC-45).
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
npm run check             # typecheck ×2 + boundaries + CRM + tokens + platform + French + ports + surfaces + reasons + diag + motion
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

Third-party native addons are **one** — `keytar` — and that was a claim before it was a
fact: `better-sqlite3` sat in `dependencies` for months, unimported since the store moved to
`node:sqlite`, rebuilt by `node-gyp` on every `npm install` and shipped inside the installer
because `build.files` takes `node_modules` whole. It went with the previous product's other
leftovers.

Thirty-eight of them, 700 MB of `node_modules`: `@deepgram/sdk`, `@google-cloud/speech`,
`@google/genai`, `openai`, `groq-sdk`, `@anthropic-ai/sdk` and both ElevenLabs clients (this
product reaches every provider over plain HTTP through `RestSttSession` and
`OpenAiCompatibleLlm` — no vendor SDK), `three`, `react-icons`, `jspdf`, `tesseract.js`,
`mammoth`, `pdf-parse`, `katex`, `qrcode`, `screenshot-desktop`, `liquid-glass-react` and the
rest of the answer assistant's surface. `onnxruntime-node` and `sharp` stay: nothing in `src/`
or `electron/` imports them and `@huggingface/transformers` requires both at runtime, which is
the one case the import scan cannot see.

Adding a native addon back is a decision, not a dependency: Adding a second is a decision, not a
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
