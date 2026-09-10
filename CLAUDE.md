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
  Size). Forty-odd were under it, all 17–23px tall, and none of them looked wrong in the
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

- **`source ▸` leads somewhere** (DEC-21). `review:transcript` reads the stored segments — the
  same rows `spanVerification.ts` checked the quote against — and the gate opens them in the
  column next door, on that turn, highlighted. When the quote is *not* in the record the reader
  says so and seeds its search with the fragment that failed. It is asked for by a click and
  never fetched otherwise, and it is **not** the live transcript pane DEC-38 removed: that was a
  proof of life during a call and is still the input meter's job.
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

- **`npm run test:e2e` starts the actual application.** Everything else tests a slice and all
  of it shared one blind spot: the preload, the real channel names, the Zod validation on both
  sides of them, the SQLite file and the boot sequence were exercised by nothing, so a channel
  renamed on one side of the bridge would ship. Sixteen steps under Playwright's Electron
  driver on a throwaway `--user-data-dir`, which is also the only way first run is reachable.
  It ends the meeting it starts and never runs the audio trial — twenty seconds of listening
  would raise an OS prompt no headless run can answer.

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
rendered page and `--geometry` measures every element that hangs outside its box against the
box that clips it. **A design pass that only reads `src/` has not looked at the product** — the
defects that matter here live in rendered geometry and in the accessibility tree.

```
node scripts/harness/smoke.mjs                 # every stage, driven, with the geometry check
```

A stage is held together by the product's own French strings, so a copy change breaks one
silently. That happened twice — the second time it broke six stages at once, including both
features under review — and both times the lesson was written down in a comment. A comment is
not a check.

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
