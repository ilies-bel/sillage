# VISION.md

> Product name: **Sillage** — the wake a boat leaves behind it. The rep has the
> conversation; the app is what the conversation leaves. Chosen because it collides with
> nothing in the product's vocabulary: *brouillon* is already the Revue gate's email
> checkbox, *compte-rendu* is the document itself, and neither could also be the app.
> The name is carried all the way down: the package id `fr.ilies-bel.sillage`, the crate
> `sillage-audio`, and the `SILLAGE_*` development overrides.
> Target user: sales reps ("commerciaux") at a French ESN.
> Status: pre-implementation spec, **design-complete**. 29 decisions taken (§2), no open
> design questions. **First deliverable is a live demo against the public VSA sandbox**
> (DEC-28, §8.1). Build order lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. What this is

A desktop meeting notetaker for ESN sales reps that **never joins the call**. It listens to
the machine's own audio, transcribes locally or via a pluggable STT, produces structured
French notes tuned to ESN sales vocabulary, and — after a human confirms — pushes them to
VerySwing (VSA) and drafts a follow-up email in Outlook.

The rep never types a CRM entry again. That is the whole product.

## 2. Hard requirements

These are non-negotiable. Any design that violates one is wrong.

| # | Requirement |
|---|---|
| HR-1 | **Never joins the meeting.** No bot, no participant, no calendar invite. Audio is captured from the local machine only. |
| HR-2 | **Windows is the primary platform.** macOS is secondary at best. A design that ships macOS-first is rejected. |
| HR-3 | **Microsoft ecosystem.** Outlook/Exchange calendar via Microsoft Graph. Outlook drafts. Entra ID auth. No Google path is required. |
| HR-4 | **Pluggable STT.** At least one fully local engine and at least one cloud engine, swappable without a rebuild. |
| HR-5 | **Pluggable LLM provider.** BYOK plus local (Ollama / OpenAI-compatible endpoint). |
| HR-6 | **French, ESN-native.** Output language is French. Extraction is tuned to ESN sales reality (régie/forfait, TJM, profils, intercontrat, appels d'offres), **not** generic SaaS "deal signals". |
| HR-7 | **One confirmation, then everything ships.** A single post-call review screen. The rep confirms once; the app then writes to VSA *and* creates the Outlook draft. No per-field gating, no second prompt. |
| HR-8 | **The email is never sent by us.** We create a draft in the rep's Drafts folder. They send it from Outlook. |
| HR-9 | **Calendar-driven.** The app knows about meetings before they start and arms itself. |
| HR-10 | **Low friction.** If a rep has to think about the tool during a call, the design failed. |
| ~~HR-11~~ | **Withdrawn (DEC-33), and its remaining half narrowed by DEC-37.** Data residency was a hard requirement enforced in code: a provider without a stated jurisdiction was struck from selection and greyed in Réglages. It is no longer a requirement of the software, and the row no longer names a jurisdiction at all — it declares only whether the audio leaves the machine, which is the part the app can keep true. The id is kept rather than renumbered so the citations in the code still resolve. |

### Explicit non-goals

- **Stealth / invisibility to screen share.** Not required. Any existing content-protection
  code is optional and off by default.
- **Generic revenue-intelligence.** No deal scoring, no talk-ratio coaching, no "sentiment".
- **Meeting bots.** Ever.
- **Multi-CRM abstraction on day one.** VerySwing is the only target. The connector boundary
  exists so a second CRM is possible, not so it ships.
- **Phone calls, v1.** Only Teams meetings that exist in the Outlook calendar are in scope.
  `MeetingDetector` must not be *designed* in a way that forbids audio-only arming later, but
  no work goes into it now.
- **Multi-tenancy, v1.** Built for one client. See DEC-1.

### Decisions taken

| # | Decision | Consequence |
|---|---|---|
| DEC-1 | **One client now, product later.** | Hardcode this client's VSA referentials and vocabulary. Keep `VsaConnector` / `CalendarProvider` / `SttRouter` behind interfaces so a second tenant is possible — but build no config UI, no per-tenant mapping, no onboarding. Register the Entra app as **multi-tenant from day one** anyway: it costs nothing now and avoids a migration later. |
| DEC-2 | ~~**Cloud STT and LLM allowed, region-restricted.**~~ *(Amended by DEC-30, superseded by DEC-33 and DEC-37.)* | Cloud STT and LLM are allowed; the region is neither enforced nor claimed by the software — §5 is a comparison the operator reads, not a shortlist the code applies. |
| DEC-3 | **Teams + calendar meetings only in v1.** | Calendar-driven arming stands as the primary trigger. |
| DEC-4 | **One confirmation gate.** | Confirm once → VSA write + Outlook draft, both. Lives at the foot of the document (DEC-6), not on a separate screen. |
| DEC-5 | **No live writing. No ownership model.** The agent writes once, when the meeting ends. *(Supersedes an earlier decision to write live.)* | We copy Granola exactly: during the call the notepad is the rep's alone. On meeting end the agent enhances automatically. Regeneration afterwards is **user-initiated only**. Rep edits are **fed back into the prompt as context**, never locked or protected — so there is nothing to freeze and no ownership grain to define. Raw notes are kept as a separate permanent layer, so what the rep actually typed is never at risk. |
| DEC-6 | **Two objects, not one.** The **document** is free-form living notes. The **CRM payload** is a form derived once, at meeting end. | The document is never schema-shaped and never renders empty headings. The form is assembled from the full transcript + the finished document + hard facts from Graph, then shown at the foot of the document as the single confirmation (DEC-4). |
| DEC-7 | **Deterministic data never comes from the LLM.** | Anything an API knows for certain is read from that API. The model only ever produces interpretation. See §5.2. |
| DEC-8 | **Editor: raw ProseMirror**, not TipTap. | anarlog's `packages/editor` ports over — note schema, node-views, keymap, `transaction-guard`, tests — which is the whole reason to look at their UI at all. Both are MIT and free for our use; Tiptap's paid bundles (Collaboration/Comments/Cloud, from $49/mo) are irrelevant since we have no networked multi-user editing. Cost: ProseMirror is unforgiving and sits on the critical path. |
| DEC-9 | **End-of-meeting = audio silence + grace period, with a manual *Terminer* button.** | Automatic: system audio silent for a grace window (start at 75s, tune) *and* no output from the meeting process. Manual: a *Terminer la réunion* button short-circuits the grace period and enhances immediately. If audio resumes during the grace window, the countdown is cancelled silently — no prompt, no interruption. Calendar end time is **not** a trigger; sales calls overrun constantly — but it *is* a prior that shortens the grace window once passed (DEC-16). |
| DEC-10 | **Unconfirmed comptes-rendus wait in the in-app list only.** No queue, no badge, no external artefact. | The meeting list shows each call as *prêt à valider* — framed as ready, not as pending. Zero extra scopes. **Rejected:** writing notes into the Outlook event body (`PATCH /me/events/{id}`) — it sends meeting-update mails to attendees, so internal notes on TJM and objections would reach the prospect, and overwriting the body destroys the Teams meeting blob and the join link. Also rejected for v1: a Microsoft To Do task per meeting (`Tasks.ReadWrite`). Open extensions on the event (`/me/events/{id}/extensions`) remain available for *our* bookkeeping only — never for rep-visible content. |
| DEC-11 | **The app is the rep's notepad during the call.** That is why it is open, and why validation has an entry point. | Because the agent writes nothing live *into the document* (DEC-5), the document is **pure notepad, zero AI** — though the screen around it is not (DEC-14). It has to win on being a genuinely good place to type — instant, keyboard-first, no lag, autosaved. This is what makes the ProseMirror investment (DEC-8) worth it. **Largest untested assumption in this document**: nobody has yet watched a real commercial on a real client call to confirm they will type. Cheap to falsify — ship a notepad-only build first and measure whether reps open it. |
| DEC-12 | **Everything is append-only and durable from second one.** | Transcript segments written to SQLite as they arrive. Every ProseMirror transaction persisted on a ~500ms debounce. A crash at minute 40 costs at most half a second of typing. **Raw audio is not retained** — transcribed and discarded, which also removes the most sensitive artefact from the CNIL question. Trade-off accepted: a bad transcription cannot be re-run offline later. |
| DEC-13 | **One fixed compte-rendu shape. No template picker.** *(Amended by DEC-43: two declared recipes, chosen per meeting; still no user-written template.)* | A single *compte-rendu commercial ESN* recipe, auto-applied. Regeneration re-runs the same recipe with the rep's edits as context (DEC-5), rather than switching template as Granola does. Consequence: comparable notes across every rep, one recipe to tune and benchmark in French, nothing for the rep to get wrong. Internal meetings are excluded upstream by the guard in §5.1, not by a template. Client-authored templates are a *product later* question (DEC-1), explicitly not v1. |
| DEC-14 | **In-call AI is visible, but it never touches the rep's document.** *(The transcript surface is withdrawn by DEC-38; the rest stands.)* The screen has the **document** (rep only), an **input meter** (DEC-38), and the **signal rail** (live extraction). | *(Refines DEC-5 and DEC-11, does not reverse them.)* A blank notepad that visibly does nothing for 45 minutes teaches the rep the tool is worthless, and no amount of post-call quality recovers that first impression. So the AI works in plain sight — just never inside the document. Proof that capture is alive is deterministic and carries no LLM — it was the transcript pane, and is the input meter since DEC-38. The signal rail appends chips as facts are said — *TJM 520 € · 2× Dev Java senior · démarrage septembre · objection: délai*. Both are **read-only**: the rep never edits them, so there is still no ownership grain, no caret preservation, no transaction filtering. **DEC-5's deletion list survives intact** — it was about the *document*, not the screen. Gray AI text still enters the document exactly once, at meeting end. Constraint: nothing animates, nothing blinks, chips append at the bottom and never reorder. The rail is proof of life, not a working surface — it competes with the client's face and must lose. |
| DEC-15 | **Outlook is a context source, not just a trigger.** | The calendar event carries most of what the extraction needs and all of it is deterministic (DEC-7): subject, body/agenda, organizer, full attendee list with names, emails and response status, `onlineMeeting` join URL, categories, sensitivity, recurrence and `seriesMasterId`. Beyond the event, the **prior mail thread** with those participants gives the account history for free — already covered by `Mail.ReadWrite`, no new scope. Consequences: the client is resolved before a word is spoken, attendee names never come from the transcript, a recurring series links its calls together, and *n*-th meeting with an account is known rather than inferred. |
| DEC-16 | **Scheduled end bounds the session; silence decides within it.** *(Amends DEC-9.)* | DEC-9 was right that calendar end time is not a trigger — sales calls overrun. But it is an excellent **prior**. New rule: before the scheduled end, silence needs the full grace window (75s) — people mute to take a call, someone shares a screen in silence. After the scheduled end, the grace window shortens (start at 25s, tune), because a silence past the planned finish is far more likely to be the real end. The manual *Terminer* button still short-circuits everything. Session start is likewise bounded: arm at `event.start − 5 min`, never before. |
| DEC-17 | **The STT lexicon is a first-class module, not a provider setting.** | ESN vocabulary is where generic transcription fails hardest and most expensively: *TJM* → "T.J.M." / "tédjéem", *régie* → "régis", *intercontrat* → "inter contrat", *AO* → "a o", plus every client and candidate surname. Two layers. **Boost at the provider** where supported (Azure phrase lists / Custom Speech, Deepgram keyterms, Whisper `initial_prompt`) — capability-detected, never assumed. **Correct after the fact** for providers without boosting: a deterministic fuzzy pass over the lexicon, applied to the transcript before it reaches the LLM. The lexicon is **static ESN terms + per-meeting dynamic terms injected from the Outlook event** (DEC-15): attendee surnames, company name, project names from the agenda. Attendee surnames are the highest-value hotwords in the product and the calendar hands them over for free. |
| DEC-18 | **Entity resolution always pre-fills the best candidate, carrying a confidence marker.** *(Resolves OPEN-1.)* | Low-confidence matches are pre-filled and marked `⚠ faible`; the rep overrides from a searchable list (§5.1) or creates. **Amended in build:** "the rep never faces an empty account field" is withdrawn, because what was keeping it literally true was the string « Client à confirmer » written into the name when *nothing* matched. A stored placeholder is indistinguishable from data: it reached `meetings.client_name`, the session header, the search chips and the lexicon's per-client scope, where terms were learned "for Client à confirmer" and shared across every unresolved meeting. Nothing matched is now **blank**, with the hint beside the field. The `⚠ faible` marker — which is the part of this decision that was doing the work — is unchanged, and so is `accountId: null` making the opportunity undraftable (DEC-20). Consequence accepted knowingly: inside a holding structure a wrong sibling can be confirmed by reflex. Two mitigations, both cheap. (a) When candidates share a domain, all siblings are listed under the field — the rep sees that a choice exists rather than discovering it later. (b) The `⚠ faible` state is recorded in the event log, so a mis-attribution is diagnosable after the fact instead of invisible. **Revised against the real API** (see `docs/reference/vsa-api.md`): `POST /v1/prospect` requires 13 fields including `mainAddr1`, `mainZipcode`, `mainCity`, `mainCountry`, `activity` and `defaultBillingTax` — none of which a meeting produces. Auto-creating an account would mean placeholder data in the CRM of record, permanently. So v1 **does not auto-create prospect accounts**. Three exits: attach to a resolved account; create a prospect *contact* under an existing one (`POST /v1/prospect/{code}/contact`, which needs only name + entities); or `linkType: FREE` with `freeProspectId` when the company is genuinely unknown. Account creation stays a deliberate act in VSA. **Resolution order also revised** — `GET /v1/prospect-contacts?email=` gives exact email lookup, which outranks domain matching and largely defuses INPUT-1. |
| DEC-19 | **Consent is verbal, said by the rep, and not gated by the app.** *(Resolves OPEN-2.)* | The reps are already required to announce it; the app adds no toggle, no checkbox, no blocking state — that would put friction in the first ten seconds of a client call to solve a problem their process already solves. We ship the recommended wording and the technical facts (no audio retained, which provider processes it, retention period) for the client's *registre des traitements*. The client is the data controller; we are not. **Nothing in the app depends on consent having been given** — which is precisely why the wording must be right. |
| DEC-20 | **The gate ships up to three independently selectable intents behind one button.** *(Resolves OPEN-3.)* | Task, opportunity and Outlook draft. All three are drafted automatically; each can be unchecked. Still one *Valider* (DEC-4) — the fan-out varies, the gesture does not. The opportunity is auto-created when the call has deal signals and no linked one exists, pre-filled from the extraction, fully editable in place. **Ordering is a correctness requirement:** the opportunity must be written before the task that carries its `oppyId`, so `PushIntent` has a `dependsOn` edge and the outbox drains as a DAG. If the rep unchecks the opportunity, the task falls back to `linkType: COMPANY`. Auto-creation requires a resolved `tiersCode` — never create an opportunity against an unresolved account. |
| DEC-21 | **Every field is always filled; confidence is measured, never self-reported.** *(Resolves OPEN-4.)* | No blanks — the rep always has a starting point. But "low confidence" is not the model's opinion of itself: every interpretive field must cite the transcript span it was read from, and the app **verifies the span exists in the stored transcript**. That check is code, not trust. Missing span, unverifiable span, or a value not supported by it → `⚠ faible`. This makes the `[source ▸]` affordance already in DEC-6 the enforcement mechanism rather than decoration, and it is the only defence that survives a confident hallucination — which by definition reports high confidence. |
| DEC-22 | **`fr-FR` fixed. French output always. English technical terms preserved verbatim.** *(Resolves OPEN-5.)* | No language detection anywhere — a fixed locale is one less failure mode and the ESN norm is French with English tech mid-sentence. English terms (*backend*, *Kubernetes*, *sprint*, *staffing*, *release*) live in the lexicon (DEC-17) as boost terms and are **never translated** into the compte-rendu. Output is French unconditionally, including for a fully English call: VSA is French and so are the people reading it. Keeps DEC-13's single recipe and single benchmark set intact. |
| DEC-23 | **Never interrupt during a call. One evening nudge. Never auto-push.** *(Resolves OPEN-6.)* | Extraction runs in the background and the row turns *prêt à valider* — nothing is surfaced while `MeetingSession` is in `recording`, ever. One native notification at a configurable hour (default 18h30) listing what is still unvalidated. This is a deliberate softening of DEC-10's "no badge": the list alone risks comptes-rendus quietly rotting, and an empty CRM is the exact outcome the product exists to prevent. **Nothing is ever auto-pushed** — HR-7 means a human confirms or it does not ship, however old it gets. Unvalidated items never expire and never delete. |
| DEC-24 | **VerySwing sits behind an anti-corruption layer with a startup capability probe.** *(Resolves OPEN-7.)* | The typed client is generated from the public sandbox spec now; work does not wait on the client. Every VSA-shaped payload is built in **one** mapping file — domain types never leak into it, so a divergent build costs one file, not a refactor. On first connect the app fetches the client's own `/api/doc`, diffs the ~8 endpoints and the fields we send, and reports precisely what is missing. Drift is found at connect time with a named field, not at push time with a 400. Referentials (task types, statuses, priorities, sales stages, probabilities) are fetched and cached per tenant, never hard-coded. |
| DEC-25 | **Every call is browsable in full, forever.** | An *Historique* screen: every meeting ever captured, searchable, with the complete transcript, the rep's raw notes, the enhanced compte-rendu, the extraction with its source spans, and the push status per intent. This costs almost nothing to build because DEC-12 already stores it — the event log **is** the history, and the screen is a reader over it. It also carries real weight: it is where the rep looks up what a client actually said three months ago, where a mis-attributed account (DEC-18) gets diagnosed, and where a `⚠ faible` extraction gets checked against the passage it came from. Read-only for transcripts; comptes-rendus stay editable and re-validatable. |
| DEC-26 | **Every connector is optional at runtime. Nothing blocks capture.** | VerySwing unreachable, credentials expired, or the DEC-24 probe failing does **not** degrade the app: the meeting is still captured, transcribed, enhanced and reviewable, and the Outlook draft still ships. Only the VSA intents grey out — and a disabled control **always states why**, inline, with the last error and a retry: never a dead button. The work is never lost; the intents stay undrained in the outbox and the row stays *prêt à valider* until VSA returns. The same rule applies in every direction: Graph down → manual start, no arming; cloud STT down → local Whisper takes over mid-session (HR-4); LLM down → transcript and raw notes are still captured and the enhancement is retried later. **The capture path has zero network dependencies.** A rep on a train with no connection loses nothing but timing. |
| DEC-27 | **Errors are events in the same log, with a retention policy and a redacted export.** | Every error, warning, connector failure, probe result, schema-validation rejection and outbox retry is written to the append-only log (DEC-12) — not to a separate file, not to a console nobody reads. Two independent retentions: **diagnostics events default to 90 days** (configurable, purged on a rolling basis); **meeting content never auto-expires** (DEC-23). *Réglages → Diagnostics* exports a single NDJSON bundle. Two modes, and the distinction is not cosmetic: **Diagnostics** (default) carries events, timings, error messages, app/OS/provider/native-arch environment, and **no transcript or note content** — safe to send. **Diagnostic complet** includes content, and says plainly that it will contain client conversation data. A bundle full of prospect transcripts sitting in a support mailbox is a GDPR incident; the safe export must be the effortless one. |
| DEC-28 | **The first deliverable is a live demo against the public sandbox, not a client deployment.** | No client tenant is available, so `automation.playwithvsa.com` is the **target**, not a stand-in. Consequences, and they are large. The build order flips from horizontal layers to **one thin vertical slice through everything including VSA** — a demo that stops before the CRM write has no ending. The sandbox is **seeded** with a plausible French ESN account base (accounts, contacts, referentials) so resolution and writes look real. Entity resolution is tuned against that seed, which makes INPUT-1 and INPUT-2 deferrable rather than blocking. And DEC-11 stops being falsifiable for now: no reps, no field test — the demo is what earns the access needed to run one. Cut from the demo, kept in the design: Historique, Réglages, degradation handling, macOS. |
| DEC-29 | **The CRM is a port with a replaceable adapter and a declarative field map.** | The client will have their own developments on top of VSA — custom fields, custom endpoints, a different referential set. That must be an **adapter change, never a core change**. Three layers: a `CrmPort` interface in `core/contracts` speaking only domain language (`pushCompteRendu`, `resolveAccount`, `createContact`); a `VsaAdapter` implementing it; and a **declarative field map** — data, not code — binding `ExtractionESN` fields to VSA columns. A client-specific field becomes a line in the map. A client-specific endpoint becomes a method on a subclassed adapter. Neither touches `core/`, `app/`, or the renderer. This is also what makes a second CRM possible later without it being a goal now (§ non-goals). |
| DEC-30 | **Local transcription is the default engine, not the fallback.** *(Amends DEC-2 and DEC-26.)* | DEC-26 described cloud STT as the norm and local Whisper as what "takes over" when it dies. That is backwards for this product. The engine that runs on the machine has no network dependency, no per-minute cost, no residency question and no processor contract — which makes it the **floor and the default**, and a cloud engine an opt-in upgrade for accuracy. Consequences: the UI never describes local transcription as *dégradé*; a meeting running locally is a meeting running normally. HR-4 still holds — both engine kinds ship and stay swappable — but the failover *direction* inverts: cloud dying returns to local, which is not a degradation and is not announced as one. HR-11 stops binding STT in the default configuration, because nothing leaves the machine to have a residency. The first-run model download becomes a real state, and it has a screen (§6, screen 0). |
| DEC-31 | **The calendar is a local surface that Outlook enriches.** *(Amends HR-9.)* | HR-9's "calendar-driven" stands: with Graph connected the app still knows about meetings before they start and still arms itself. But the calendar is **not** a rendering of Outlook — it is the app's own, and it is always drawn, including with no Entra registration and on a day with nothing in it. A rep can create a meeting on any day and record it; that meeting lives in the same grid, the same list and the same history as one that came from Graph. An empty grey box where the calendar would be is the specific failure this forbids: it teaches the rep the product is broken when it is merely unconnected. |
| DEC-32 | **One general status, and it only reports what is required.** *(Refines DEC-26.)* | The six-connector footer strip is replaced by a **single status control in the header**, clickable, whose destination is *Réglages → Connecteurs*. What it reports is the load-bearing part: only **capture, transcription and analysis** — the things without which a meeting cannot be recorded — can move it off *Tout fonctionne*. VerySwing, Outlook and the calendar are optional by DEC-26, so an unreachable VerySwing is **not** a degradation of the app and must never be drawn as one; it is a line in Réglages under *Facultatifs*, carrying its reason and its retry. DEC-26's "a disabled control always states why, inline" is untouched — that governs the control the rep is actually trying to use. What collapses is only the *aggregate* strip, which said six things at once during a client call and was therefore read as noise. |
| DEC-33 | **HR-11 is withdrawn. Where a provider runs is surfaced, never enforced.** *(Narrowed by DEC-37.)* | HR-11 was implemented as a filter: a provider whose data-residency row did not name an acceptable jurisdiction was struck from `selectLlm` / `selectProvider` and greyed in Réglages unless an undocumented environment variable was set. That is friction with no beneficiary. A provider only becomes a candidate when someone deliberately supplies a credential for it, so the filter never *prevented* a decision — it overrode one already made, behind a screen that looked identical to a missing key, and sent the person who made it hunting for a flag nobody had written down. Where a client's transcript may be processed depends on the client, the contract and the content. That is a deployment decision, made by whoever signs; the software's job is to state what it knows, not to hold the pen. So: the row stays on screen and refuses nothing. The one switch that still refuses outright is **`offlineOnly`**, because that is the rep asking, inside the product, for this meeting's audio not to leave the machine. Consequences: the two `ALLOW_*` environment variables are deleted, not renamed; ElevenLabs stops being an excluded vendor and becomes an offered one (DEC-35); the provider shortlist in §5 is a comparison, not a whitelist. **DEC-37 then narrowed what the row claims** — it no longer names a jurisdiction at all. |
| DEC-34 | **Credentials are entered in Réglages, not in the environment.** | Provider keys were read from `process.env` at boot, which made every one of them a developer-only feature: a rep cannot set an environment variable, and a packaged app has no `.env`. The screen said so out loud — *"nothing on this screen edits a credential"* — and that sentence was the bug, not the honesty. Réglages gains a **Fournisseurs** section where a provider is selected and its credential supplied, stored in the OS credential store through `SecretVault` (Keychain / Credential Manager, never a file, never the event log, never a diagnostics bundle). Each provider declares **how** it authenticates as data — `oauth`, `apiKey`, `none` — so the screen renders *Se connecter* or a key field from the row rather than from a branch. Entra is the one true `oauth` today (MSAL public client, PKCE, loopback), and the OpenAI Platform API is `apiKey`: it has no third-party OAuth flow, and claiming otherwise in the UI would be a button that cannot work. `process.env` survives as a *development override only* and is documented as such. |
| DEC-35 | **Three ways to transcribe, and the first one needs nothing.** | The STT section offers exactly three kinds of engine, in this order. **(a)** The model **shipped inside the installer** — a Whisper checkpoint bundled at build time, boosted with the ESN's own vocabulary (DEC-17: régie, forfait, TJM, intercontrat, the client's account names). It requires no key, no download and no network, and it is what DEC-30 means by the default. **(b)** Any other checkpoint in the catalogue, **downloaded from Hugging Face on demand**, with visible progress, a cancel, and a disk re-verification before it is ever called ready — a half-written model that reports itself available is how an engine "downloads mid-meeting". **(c)** A **cloud engine**, ElevenLabs Scribe or Azure Speech, on a key entered in Réglages. (b) and (c) are upgrades the rep opts into; neither displaces (a) by existing. |
| DEC-36 | **The ChatGPT subscription is reachable, by borrowing the grant Codex already has.** | DEC-34 said the OpenAI Platform API is `apiKey` because it has no third-party OAuth flow, and that remains true. What is also true is that a great many people already pay for ChatGPT and have `codex login` on their machine, and that grant reaches a real endpoint — `https://chatgpt.com/backend-api/codex/responses`, the one the Codex CLI itself calls. Sillage reads `~/.codex/auth.json`, sends the token with the three headers that endpoint requires, and never writes to the file: refresh tokens rotate on use, so refreshing here would either invalidate the one Codex holds or start two programs racing on one file. Codex rotates it in place; this app re-reads per request, so a rotation is invisible. The row is `auth: 'oauth'` because there is no key to type — which is the only thing that field promises the screen — and its one control is *Vérifier*, since *Se connecter* would have to open a terminal. **Not a flow this app runs**: doing so would mean registering as `codex_cli_rs` to OpenAI's authorization server and putting a second copy of a live credential on disk. Consequences: the adapter learns a second dialect (Responses, streamed, `store: false`, no `max_output_tokens` — all three measured against the live service, not assumed); the model name comes from Codex's own `config.toml`, because the endpoint serves a short account-specific list and refuses everything else; the row's cost is `included`, which is not `free`.
| DEC-37 | **The residency column stops naming a jurisdiction.** *(Refines DEC-33.)* | DEC-33 stopped residency *refusing* anything and kept it on the row as a stated fact: « UE », « hors UE », « sur la machine ». The refusing was the loud half of the problem; the claim is the durable one. `eu` was defined as *contractual EU residency covering the transcript as well as the audio* — a fact about a contract, per vendor, per tier, per client, per year, asserted by a literal in a source file that nobody re-checks when a vendor changes terms. A row that is right on the day it is written and wrong eighteen months later is worse than a row that says nothing: it is read as verified, and it is the sentence someone repeats to a client. The software does not know this and cannot keep it true. What it does know is whether the audio leaves the machine, which it knows because it is the one sending it — and that is precisely the half `offlineOnly` ever acted on. So `Residency` becomes `local | remote`, Réglages shows « sur la machine » or « hors machine », and jurisdiction goes where it belongs: in the contract, next to the signature. Consequences: `eu` and `other` collapse into `remote`; the EU tie-break in `selectLlm` and `selectProvider` is deleted, and a tie now falls to the order written in the registry table; the provider ids `mistral-eu` and `azure-openai-eu` become `mistral` and `azure-openai`; the label « Mistral AI (UE) » becomes « Mistral AI ». Nothing about `offlineOnly` changes. |
| DEC-38 | **The live transcript pane is removed; proof of life becomes an input meter.** *(Refines DEC-14.)* | The pane carried two jobs and did both at the wrong moment. As **proof of life** it was seconds late, blank through every pause, and — the failure that settled this — indistinguishable when broken: a meeting once ran two minutes producing a single line because the machine's input volume was at 37 %, putting every window under the transcriber's speech floor, and the pane looked exactly as it does during a normal silence. As **evidence** it was early: nobody audits a citation while the client is still talking, and DEC-21's span check happens at the review gate, where the transcript still is. So the two jobs split. Proof of life is a **level meter in the header**, drawn from the amplitude already measured on the capture path (`core/domain/inputLevel.ts`), with the transcription floor marked on it — bars above the line are audio that will be transcribed, bars below are audio that will be silently dropped, and a rep raising their input volume watches them cross. It is instant, it answers during a silence, and it distinguishes a quiet room from a dead microphone, which is three things the pane could not do. The transcript itself is unchanged: still captured, still stored, still the only thing a citation may point at. What ends is its claim on the rep's attention during the call. **Both channels, mirrored about a baseline** — the rep's microphone above the line in `--brand-500`, the far end below it in `--brand-700`, and the same floor greys both. It drew the rep alone at first, on the argument that a second *row* of bars turned a 128×16px instrument into a texture; that argument was about density and mirroring does not spend any, since the bars keep their width and only the height is split. What the single row could not answer is *which side* is not being heard, and a rep watching one row go grey has to guess between their own input volume and the call's — two problems with opposite fixes. |
| DEC-39 | **A meeting that ends always says what became of it, and the compte-rendu never depends on Microsoft.** | Two failures with one shape: after « Terminer » the meeting sits in `ended`, a state that draws no control and that the review gate refuses — so when the analysis could not run, the rep watched a recording finish and watched the screen do nothing, with the reason in a diagnostics log they have no cause to open. It could not run for two reasons. The first was a **bug in disguise**: enhancement returned early with no signed-in MSAL account, which made an Entra registration a prerequisite of the one thing the product is for. The address names the rep on the document header and subtracts them from `interlocuteurs` — a compte-rendu without it is missing a line, not missing its point, and DEC-26 already says Microsoft is optional. `DeterministicFacts.repEmail` is therefore nullable, the header line is omitted rather than rendered blank, and nobody is subtracted from the attendee list, which the review gate is already the place to correct. The second is legitimate: **no model configured**. That is now a stated promise rather than a silence — the meeting is remembered as waiting, the session screen says « le compte-rendu sera rédigé dès qu'un modèle sera disponible » beside a *Choisir un modèle* button, and **every** write in Réglages drains what is waiting, because a key, a provider choice, a model choice or a base-URL field can each be the last piece that makes a provider usable. A failed attempt states its reason and offers *Rédiger le compte-rendu*. `EnhancementStatus` is computed, never stored: derived per read from the meeting's state, whether a provider is configured *now*, and whether a run is in flight — so there is no projection column to migrate and no persisted value that can outlive the truth. |
| DEC-40 | **The compte-rendu opens on a « ## Résumé ».** *(Refines DEC-13.)* | The document was complete and unskimmable — which is the same defect the signal rail had before it drew its whole slate. « Contexte » restates the setup, not the outcome, and the « Éléments retenus » recap at the foot is a field list, which says what was extracted rather than what happened. So the fixed recipe gains one leading section: two to four sentences that read on their own — what the client wants, where the exchange stands, what was agreed. It is what a rep reads three weeks later without reopening the rest, and what a manager reads for a meeting they were not in. Still one recipe and still no template picker: this is a section added to the fixed shape, not a choice offered to anyone. |
| DEC-41 | **The model reads a de-duplicated transcript; the store keeps everything it captured.** | On a laptop with its speakers open, the microphone hears the far end — so the client is transcribed twice, once correctly on `far` and once as the rep. Measured on a real call: **24 of 38 rep segments** were the client's words. That turns the extraction prompt's « (commercial) / (client) » marker, which it is told is *une mesure et pas une supposition*, into a wrong measurement — and the fields it corrupts are the ones that reach the CRM: who raised the objection, who committed to the next step, who named the TJM. `core/domain/channelBleed.ts` drops the **rep** copy when the same distinctive words arrive on **far** at the same moment. One direction only, because the bleed has one: nothing carries the rep's voice back into a tap on the speaker output. Both conditions are required — time alone eats every legitimate interruption, words alone eat a rep repeating the client's figure back at them, which is the most ordinary move in a sales call. It is a **read-time filter over what the model is given, never a mutation of the store**: DEC-21 verifies citations against the stored segments and `[source ▸]` points at them, so filtering the archive to tidy a summary would be destroying evidence. Two things this does not do. It does not clean the audio — that is AEC in the native module, now landed as DEC-42, which removes most of the bleed but ducks rather than erases the rep through double-talk, so this filter stays as the backstop for what survives. And where one batch mixes genuine rep speech with bleed, the whole batch goes; a miss keeps a segment and that is the direction the thresholds err in. **The timing test is proximity of arrival, not interval overlap** — `modules/transcribe` sets `startMs === endMs`, both to the instant the batch arrived, because a batch provider cannot report the acoustic time of the words inside it. An intersection test on zero-length intervals requires two independently batched instants to coincide exactly: it passed every unit test and dropped nothing on real data. |
| DEC-42 | **The echo is cancelled by one pure-Rust AEC3 inside the native module, on both platforms. Not by the operating system's canceller.** *(Implements the AEC that DEC-41 defers to.)* | DEC-41 removes the *duplicate transcript*; this removes the *cause*, which is the client's voice physically in the rep's microphone — 62 of 193 rep segments on the measured call, 32 %. Both platforms ship a canceller and neither is the right one to take: macOS has `AUVoiceProcessingIO`, Windows has had the Voice Capture DSP since Vista (the newer Windows 11 AEC APO is vendor-supplied and cannot be required). Neither is reachable through `cpal`, so either would mean **a second microphone path per platform** — an audio unit taking over the device on one side, COM and a media object on the other, two new `check-platform.mjs` allowances, two implementations of one behaviour. The `aec3` crate is the same algorithm as a *filter*: it takes the two streams `modules/capture` already has and returns a cleaned one. No second device, no COM, no C++ toolchain (which is what disqualified `webrtc-audio-processing`: meson, ninja and clang on every machine that runs `npm install`), and **no platform branch at all** — the first thing in this repo that Windows and macOS share whole. It runs **before** silence suppression, because a canceller fed a gated signal cannot hold adaptation and the gated frames are exactly the ones carrying the echo; the far channel passes through untouched as the reference. Measured at 16 kHz over a 60 ms echo path with 120 ms of reverb: **62–67 dB**, converged inside the first second, 8.0 ms of added latency. Two things follow. **The high-pass filter stage is mandatory and nothing documents that** — without it the filter cancels ~66 dB and then permanently diverges, which is only visible against speech with pauses in it and low first formants, so the crate version is pinned exactly and the regression test carries the signal that exposes it. And **DEC-41 stays**: through double-talk the rep is ducked ~9 dB and the residual can still produce a duplicate segment, so the dedup remains the backstop. `capture.channelBleed` going quiet is the acceptance signal, not a number in a bench. |
| DEC-43 | **Two compte-rendu recipes, chosen per meeting: « Prise de besoin commercial » by default, and a free-form one with no trame at all.** *(Amends DEC-13.)* | DEC-13 said one fixed recipe and no template picker, for reasons that still hold *for the default*: comparable notes across every rep, one prompt to tune, one thing to benchmark in French. What it did not survive is the meeting that is not a prise de besoin — a follow-up, a comité de pilotage, a point technique. Forced through the ESN slate those produce a document that is six-sevenths « _non évoqué_ », and a rep reading one cannot tell a field nobody filled from a meeting where the subject never came up. So there are **two declared recipes and no user-editable template**: a template a rep writes is a prompt nobody benchmarks, which is the half of DEC-13 that stands. `core/contracts/recipes.ts` declares a shape and never a fact — headings, field names, labels — and a third recipe is an entry there plus its prompt. The free one extracts **nothing typed**, which is the whole point and has a stated cost: no cited value means **no measured confidence** (DEC-21 has nothing to verify) and **no VerySwing opportunity** — every descriptive column of one is fed by a field this recipe does not produce, so the gate refuses it *with the reason on the row* (DEC-26) rather than shipping a 0 € deal with four empty columns. What it keeps is everything that was never the recipe's: the deterministic header (DEC-7), the leak check on the prose channel, the compte-rendu task, the Outlook draft, and « ## Résumé » as the opening section (DEC-40) — that is a summary of whatever happened, not a slot to fill, and dropping it would make the recipe for irregular meetings the one you cannot skim. **Chosen from the session header, live from the first frame and not in the signal rail** — DEC-14 says nothing in the rail is clickable during a call, and that is worth more than the adjacency. Switching after a compte-rendu exists **regenerates it**, behind an inline confirmation naming what will be replaced; the rep's own notes and the transcript are untouched either way (DEC-5). The choice is an event in the meeting's log, so it survives a restart and a projection rebuild; `LlmInterpretation.recipe` is a defaulted key, so every extraction stored before this decision replays as the ESN one. |
| DEC-44 | **The compte-rendu has a declared register, stated once and shared by both recipes. It reports; it does not assert.** | Everything else about the document was pinned — six headings (DEC-13, DEC-40), a header and a recap rendered by code (DEC-7), a leak check on the prose, a measured confidence per field (DEC-21). The *writing* rested on one sentence, « rédige-le comme le commercial l'aurait écrit », which is the goal restated rather than an instruction — and it is the beat §10 calls the only one that cannot be faked. So the register is declared in `modules/extract/prompt.ts` beside the rules it travels with. What it asks for is the prose obeying in French what the schema already enforces in types: **attribution** (« le client a insisté sur », « le sujet a été évoqué sans être tranché ») so a rep can see which sentences are reported and which are concluded; **hedges kept as spoken** (« à l'étude », « de l'ordre de »), because resolving an ambiguity the meeting left open is the same invention DEC-21 exists to catch, one clause down; **quantities with their original approximation**, unrounded and unconverted; full sentences even in bullets, short paragraphs, English tech terms untranslated (DEC-22), and no appreciation of the model's own — this is a record of what was said, not an argumentaire. **Shared by both recipes**, because voice is orthogonal to whether the plan is fixed: the free one chooses its own headings and owes the rep the same document. **Register only, and deliberately no new markdown** — the compte-rendu is never rendered as markdown anywhere (`CompteRenduPane` draws it `whitespace-pre-wrap`, the gate edits it in a textarea, VerySwing receives the same string), so a table or a fact-line block would land as literal pipes on every surface a human reads. The one bullet that costs something is the licence to quote **a few of the client's own words** when the formulation itself is the finding: `deterministicLeaks.ts` exempts the `citation` *key*, never a quotation, so a « … » fragment in the prose is inspected like any other text and a hit fails the whole extraction. That is why the licence is bounded where it is granted — a few words, never a whole sentence, two or three times at most, reformulated instead of quoted when the passage carries a name, an address, a number or a full date. The guard cannot move into the shared `FORBIDDEN` block, which the *map* prompts also read: their citations are verbatim transcript and have to be allowed to contain names. |

---

## 3. Base decision

**Base: the existing Electron/TypeScript codebase.** Not anarlog, not Meetily.

Rationale, in one line each:

- **anarlog** (fastrepl, MIT, Rust/Tauri) — best-in-class STT abstraction, but has **never
  shipped a Windows binary** (releases are macOS `.dmg` only, and 115 crate files are
  macOS-gated), and its **only calendar backend is Apple EventKit** — zero Microsoft code.
  It contributes nothing to HR-2 or HR-3, the two hardest requirements.
- **Meetily** (Zackriya, MIT, Rust/Tauri) — ships Windows, but mixes mic + system audio into
  one stream and therefore *needs* a diarization model to separate rep from prospect;
  diarization is PRO-only in the community build.
- **This repo** — already ships a Windows NSIS installer, already has dual-channel WASAPI
  capture in production, already has a mature summary pipeline. It is ahead on HR-1, HR-2,
  HR-4, HR-5.

## 4. What we take from each

### From this repo (the base)

| Component | Path |
|---|---|
| Dual-channel system + mic capture (WASAPI / CoreAudio) | `native-module/src/speaker/` |
| STT provider set (Deepgram, Soniox, ElevenLabs, Google, OpenAI, local Whisper, REST) | `electron/audio/` |
| Summary pipeline (chunking, recipes, reducer, schema validation, polish) | `electron/services/meeting/` |
| Follow-up draft generation | `electron/services/meeting/FollowUpDraftGenerator.ts` |
| Speaker labelling | `electron/services/meeting/SpeakerLabelService.ts` |
| Calendar OAuth + polling skeleton (to be made provider-agnostic) | `electron/services/CalendarManager.ts` |
| Meeting-app process detection | `native-module/src/process_name.rs` |
| Encrypted storage, secrets, vector search | `better-sqlite3`, `keytar`, `sqlite-vec` |
| Windows packaging | `electron-builder` NSIS + portable targets |

### From anarlog (MIT — code may be copied with attribution)

| What | Where | Why |
|---|---|---|
| STT provider abstraction **design** | `crates/owhisper-client/src/providers.rs`, `src/adapter/*` | 25 backends behind one enum + adapter shape. Port the design to TypeScript; it is strictly better than our ad-hoc classes. Gets us Speechmatics and Azure Speech (both strong on French) and `pyannote` for far-end diarization. |
| Connector/plugin boundary | `plugins/*` layout | Right seam for VSA and Outlook as swappable connectors. |
| WASAPI capture reference | `crates/audio-actual/src/speaker/windows.rs` | Cross-check our implementation against a second one. |
| Local model lifecycle | `plugins/local-stt/src/download_pollers.rs` | Model download/progress/resume UX we would otherwise get wrong. |

### From Meetily (MIT — code may be copied with attribution)

| What | Where | Why |
|---|---|---|
| **Windows build tooling for whisper.cpp** | `backend/install_dependancies_for_windows.ps1`, `frontend/build.ps1`, `clean_build_windows.bat`, `build_whisper.cmd` | The single most painful part of shipping local STT on Windows, already solved. |
| **Parakeet CPU engine** | `frontend/src-tauri/src/parakeet_engine/` | CPU-only local STT for the many ESN laptops with no usable GPU. Covers French. |
| Audio device selection + diagnostics | `frontend/src-tauri/src/audio/devices/platform/windows.rs`, `device_detection.rs`, `level_monitor.rs`, `diagnostics.rs` | Real-world Windows audio is a swamp; they have the diagnostics we lack. |
| Bluetooth playback handling | `BLUETOOTH_PLAYBACK_NOTICE.md` | Headset mode-switching destroys system-audio capture. Known trap, documented. |
| Transcription-provider settings model | local / self-hosted OpenAI-compatible / cloud | Clean three-tier mental model to copy in Settings. |

### From Amurex — **ideas only, no code**

Amurex is **AGPL-3.0**. Do not copy code. For a commercially deployed desktop app at a client,
AGPL is a licensing landmine. We take only the *concepts*: late-join recap, automated
follow-up drafting.

---

## 5. Architecture

```
┌─ Capture ──────────────────────────────────────────────────────┐
│ native-module: WASAPI loopback (system) + mic, two separate     │
│ streams. Speaker attribution is free from the hardware:         │
│   mic channel  = the rep                                        │
│   system channel = everyone on the far end                      │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─ STT (pluggable) ───────────────────────────────────────────────┐
│ One provider instantiated per channel. Local (Whisper /         │
│ Parakeet) or hosted cloud (see "Provider shortlist").           │
│ French vocabulary boosting: TJM, régie, forfait, intercontrat,  │
│ ESN, AO, portage, ADR, CV anonymisé …                           │
│ Optional pyannote pass to split multiple far-end speakers.      │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─ Notes & extraction ────────────────────────────────────────────┐
│ MeetingSummaryV3 pipeline + a new French ESN recipe.            │
│ Two outputs, always:                                            │
│   1. Compte-rendu (human-readable French notes)                 │
│   2. ExtractionESN (typed object → CRM fields)                  │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─ Review & confirm — ONE gate (DEC-4) ───────────────────────────┐
│ One screen, all fields editable, one button. On confirm both    │
│ connectors fire. If either fails, the outbox retries; the rep   │
│ is not asked twice.                                             │
└──────────┬───────────────────────────────┬──────────────────────┘
           ▼                               ▼
┌─ VSA connector ──────────┐   ┌─ Outlook connector ──────────────┐
│ POST /v1/crm/tasks       │   │ POST /me/messages → draft in the  │
│ POST /v1/opportunity     │   │ rep's Drafts folder. The rep      │
│ POST /v1/prospect[/…]    │   │ sends it from Outlook themselves. │
│ Referential cache + outbox│  │ Mail.ReadWrite only. No Mail.Send.│
└──────────────────────────┘   └───────────────────────────────────┘
           ▲
┌─ Outlook: arming AND context (DEC-15) ──────────────────────────┐
│ Graph GET /me/calendarView/delta (persist @odata.deltaLink).     │
│ Prefer: outlook.timezone="Europe/Paris".                         │
│ Arm at event.start − 5 min AND a meeting app is producing audio. │
│ Skip events with sensitivity = private | confidential.           │
│                                                                  │
│ The event is also the deterministic-fact source (DEC-7):         │
│   subject · body/agenda · organizer · attendees (name, email,    │
│   response) · onlineMeeting · categories · recurrence +          │
│   seriesMasterId · scheduled end → grace window (DEC-16)         │
│ Prior mail thread with the same participants → account history.  │
│ Attendee surnames → STT boost terms (DEC-17).                    │
└─────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Responsibility |
|---|---|
| `CaptureService` | Dual-channel audio, device selection, health/diagnostics |
| `SttRouter` | Provider registry, per-channel instantiation, boost-term injection |
| `LexiconService` | ESN term list + per-meeting dynamic terms; provider boosting where supported, deterministic post-STT correction where not (DEC-17) |
| `CalendarProvider` (interface) → `GraphCalendarProvider` | Delta sync, event normalisation, arming decisions |
| `MeetingContextReader` | Event metadata, attendees, agenda body, recurrence, prior mail thread → `MeetingContext` (DEC-15) |
| `MeetingDetector` | Calendar signal × process signal → "a meeting is happening" |
| `SignalExtractor` | Rolling transcript chunks → read-only chips for the in-call rail (DEC-14). Cheap model, chunk-boundary cadence, never writes to the document |
| `NotesPipeline` | Transcript → compte-rendu + `ExtractionESN` |
| `EntityResolver` | Meeting attendees → VSA prospect/customer/contact. Suggests; never decides. See §5.1 |
| `ReviewGate` | Holds extraction until a human confirms; emits confirmed payloads |
| `VsaConnector` | Typed client (generated from OpenAPI), referential cache, outbox, retry |
| `OutlookConnector` | Draft creation via Graph |
| `AuthService` | MSAL public client + PKCE, WAM broker on Windows, DPAPI cache |

### 5.1 Entity resolution — suggest, never decide

The app proposes a VSA account; the rep always holds the final say. Three exits, always
available, never nested behind a menu:

1. **Accept the suggestion** — one click, the common path.
2. **Override with an existing client** — searchable against the cached VSA account list.
   Selecting an account whose contacts don't yet include the meeting's attendees offers to
   **create those contacts in the ERP** (`POST /v1/crm/customer/{code}/contact` for customers,
   `POST /v1/prospect/{code}/contact` for prospects) as part of the same confirmation.
3. **Attach without an account** — `linkType: FREE` with `freeProspectId`. Used when the
   company is genuinely unknown. v1 does **not** auto-create prospect accounts: the API needs
   address, activity and billing-tax fields a meeting cannot produce (DEC-18, and
   `docs/reference/vsa-api.md`).

Suggestion ranking, best signal first:

| Rank | Signal | Notes |
|---|---|---|
| 1 | Attendee email **exact match** — `GET /v1/prospect-contacts?email=` | Highest confidence, and a real endpoint rather than a local scan. Resolves to `parentTiersCode`. Works for personal addresses, which is what defuses INPUT-1. |
| 2 | Attendee email **domain** → cached `tiersCode` | The bulk case. Ambiguous inside holdings — mitigated by rank 4. |
| 3 | **Other attendees on the same invite** | One colleague on the company domain resolves the whole meeting, including the Gmail-address participant. |
| 4 | **Sibling disambiguation** — group candidates by `parentTiersCode` / `parentCode` | Both customers and prospects carry a parent link, so this is a group-by, not a heuristic. All siblings listed under the field; the rep sees a choice exists. |
| 5 | **Recency** — account touched by this rep in the last 14 days + fuzzy title match | Breaks remaining ties. |
| 6 | **Nothing matched** | The field is blank and says so, `⚠ faible` on the row (DEC-18 as amended). Blank, not a placeholder sentence: ranks 1–5 pre-fill a *candidate*, and there is none here to pre-fill. |

**Internal-meeting guard:** if every attendee is on the ESN's own domain, the app produces
notes and offers no CRM push at all. Silent, no prompt.

**Never auto-create.** A low-confidence suggestion is shown as a suggestion, not written. The
only thing that creates an account or a contact in the ERP is a human clicking confirm.

### 5.2 Deterministic vs interpretive (DEC-7)

The LLM's hallucination surface is exactly the set of fields we let it invent. So we don't.

**Read from an API — the model never sees these as its job:**

| Field | Source |
|---|---|
| `taskName` | Graph event `subject` (editable) |
| `deadlineDate`, `endDate` | Graph event `start` / `end` |
| Interlocuteurs: name, email, role | Graph `attendees[]` + `organizer` |
| `actionUserId`, `salesUsers` | The authenticated rep (MSAL account) |
| `tiersCode` / account | `EntityResolver` against the cached VSA account list (§5.1) |
| `contactsIds`, `contactsProspectsIds` | VSA lookup by attendee email; unmatched attendees become a "create these contacts" offer |
| `linkType`, `oppyId` | Open opportunities on the resolved account (`GET /v1/opportunities`) |
| `statusCode`, `taskType`, `priorityNumber` | Tenant referentials + a fixed default |

**Produced by the model — interpretation only:**

`besoin`, `profilsRecherches[]`, `modeCollaboration`, `tjmEvoque`, `dateDemarrage`,
`dureeMission`, `contexteTechnique`, `objections[]`, `prochainesEtapes[]`, and the rendered
compte-rendu itself.

Every interpretive field carries a transcript span. No span, no field.

### Provider shortlist — a comparison, not a whitelist (DEC-33, DEC-37)

This table used to be a gate: everything in the bottom row was *excluded* and unreachable in
code. It is now what it should always have been — the facts, stated, so whoever configures the
app can weigh them. The software offers every row and refuses none of them (DEC-33).

The *Où* column says one thing and says it because the app can verify it: whether the audio
leaves this machine. It used to name a jurisdiction as well, and DEC-37 removed that — a
contractual term is not something a literal in a source file can keep true, and a stale claim
here is the sentence someone repeats to a client. Everything about a vendor's terms in the
**Note** column is context for a human, not a property the software asserts.

| Provider | Où | French quality | Note |
|---|---|---|---|
| **Whisper, bundled in the installer** | Sur la machine | Good, and boosted with the ESN's own vocabulary (DEC-17) | **The default (DEC-30, DEC-35a).** No key, no download, no network. Nothing downstream can take it away. |
| **Whisper, other checkpoints** | Sur la machine | Better with size | Downloaded from Hugging Face on demand (DEC-35b). Larger is slower, and on a laptop also running Teams that is a real cost. |
| **Azure Speech** (France Central / West Europe) | Hors machine | Good, strong on numbers | Same Entra tenant, same Microsoft DPA the client already signed — the cloud upgrade that adds no new legal surface, because we are already a Microsoft-ecosystem app. Verify the terms against the deployment; the app does not. |
| **ElevenLabs Scribe** | Hors machine | Very good, strong on speaker separation | Offered since DEC-33. Was excluded outright under HR-11. |
| **Gladia** | Hors machine | Good, built for French | French company, built for the language; worth benchmarking head-to-head. Not yet adapted. |
| **Deepgram** | Hors machine | Very good | The only streaming row in the STT registry, which is what makes it the one that could change how live the transcript feels. |
| **OpenAI / Mistral / Anthropic** (LLM) | Hors machine | — | For the extraction step, not STT. |
| **ChatGPT subscription** (LLM) | Hors machine | — | The grant `codex login` already left on the machine (DEC-36). The same destination as the OpenAI row. Costs nothing per meeting and has a plan quota, which is why its cost reads « compris dans l'abonnement » and not « gratuit ». |

### Auth

Two kinds, and each provider declares which one it uses as data on its row (DEC-34), so the
settings screen renders the right control without a branch per vendor.

**`oauth` — Microsoft Entra, and only Entra today.** MSAL Node public client, PKCE, loopback
redirect. **No client secret**, therefore no backend proxy on this path.
`@azure/msal-node-extensions` for DPAPI-encrypted token cache and the Windows WAM broker
(silent SSO on domain-joined machines).

**`oauth` — ChatGPT, by borrowing the grant Codex already holds (DEC-36).** Not a flow this
app runs. `codex login` writes an OAuth grant for a ChatGPT account to `~/.codex/auth.json`;
Sillage reads it and calls `https://chatgpt.com/backend-api/codex/responses`, which is the
endpoint Codex itself calls. Nothing is typed, nothing is written, and no refresh is
attempted — Codex rotates the token in place about every ten days and the app re-reads it per
request. The one control the row offers is *Vérifier*, because *Se connecter* would have to
open a terminal.

**`apiKey` — every other model provider.** OpenAI, Mistral, Azure, ElevenLabs, Deepgram and
Groq all authenticate with a bearer key or a vendor header. **The OpenAI Platform API has no
third-party OAuth flow**: authentication *is* the key, and the ChatGPT grant above does not
reach `api.openai.com/v1`. A *Se connecter avec OpenAI* button on the Platform row would
therefore be a control that cannot work, which DEC-26 forbids. If a public flow ever ships, it
is one row changing from `apiKey` to `oauth` and no other code.

### Settings that are not secrets (DEC-34)

A credential store is the right home for a key and the wrong home for a URL. Each provider
also declares its **non-secret settings** as data — the self-hosted row's base URL and model,
Azure's endpoint host and deployment, Azure Speech's region, the ChatGPT row's model override
— and Réglages renders them as ordinary text fields. Unlike a key they open with the stored
value in them: a URL nobody can read back is a URL nobody can correct. They live in the app's
key-value store, never the keychain, and the environment stays underneath them as a
development override.

Scopes: `Calendars.Read`, `Mail.ReadWrite`, `User.Read`, `offline_access`. None require admin
consent by default; expect one tenant-wide admin consent click anyway.

### Data model (French, ESN-native)

`ExtractionESN` — the object every downstream consumer speaks:

```
compteRendu          texte structuré (FR)
client               { nom, code VSA résolu | null, confiance }
interlocuteurs[]     { nom, rôle, email }
besoin               description du besoin exprimé
profilsRecherches[]  { intitulé, séniorité, stack, nombre }
modeCollaboration    régie | forfait | assistance technique | inconnu
tjmEvoque            { montant, devise, fourchette } | null
dateDemarrage        date | null
dureeMission         texte | null
contexteTechnique    texte
objections[]         { objection, réponse apportée | null }
prochainesEtapes[]   { action, responsable, échéance }
confianceGlobale     0..1
```

Every field carries provenance back to a transcript span. If we cannot cite it, we do not
extract it.

---

## 6. UI / UX

### Interaction model — sequential authorship (DEC-5)

One note document per meeting, but **only one author at a time**. This is Granola's model and
we copy it deliberately, having considered and rejected concurrent authorship.

| Phase | Who writes | Behaviour |
|---|---|---|
| During the call | **Rep only** | The agent writes nothing. Audio and transcript are captured silently in the background. The notepad is a notepad. |
| Meeting ends | **Agent, once** | Enhancement fires automatically on end-of-meeting detection. The document is structured from transcript + the rep's raw notes. |
| After | **Rep, then agent on request** | The rep edits freely. Regeneration happens **only when they ask for it** — never automatically, never behind their back. |

Rules:

- **Nothing is ever locked.** On regeneration the rep's edits are passed to the model as
  context — *"take these edits into consideration"* — rather than mechanically preserved.
  There is no ownership grain, no frozen block, no conflict resolution. Nothing to invent.
- **Raw notes are a permanent separate layer.** What the rep typed is stored untouched and is
  always retrievable, whatever the agent does. A *Mes notes / Enrichi* toggle exposes it.
- **Provenance by colour**, Granola's convention: rep text in `--text-strong` (#1a1a1a), agent
  text in `--text-muted` (#8a8270). No badges, no icons — colour alone.
- Typing during the call is **supported, never required**. With raw notes present they steer
  the enhancement and are quoted verbatim. With none, the recipe runs on the transcript alone.

**What this decision deletes**, and it is a lot: block ownership, freeze-on-touch, agent
transaction filtering, caret and scroll preservation under remote insertion, selection mapping,
`addToHistory:false` bookkeeping, and superseded-fact reconciliation. None of it was present
in any reference implementation. All of it is now out of scope.

It does **not** delete in-call inference entirely. DEC-14 reinstates a bounded amount for the
signal rail: a cheap model on chunk boundaries (~1 call/minute), producing read-only chips
that never enter the document. The expensive thing DEC-5 killed was *continuous regeneration
of the document*, not *any model running during the call*.

### Document, then form (DEC-6)

Two objects with different lifetimes. Conflating them was a mistake.

**The document — during the meeting.** Free-form, and the rep's alone (DEC-5). It opens nearly
empty: the meeting title, the resolved client (already correct before a word is spoken, from
the calendar invite), and a cursor. No headings, no sections, no AI. The rep types wherever
they want, or types nothing at all. Nothing here is a field; nothing here is binding.

**The form — at meeting end.** One pass over the full transcript plus the finished document
produces the CRM payload, and it appears as a panel at the foot of the document:

```
┌ Prêt à envoyer ────────────────────────────────────┐
│ Client        [Acme SA          ▾]  ← résolu, modifiable
│ Interlocuteurs  M. Dupont, Mme Le Roy  (+1 à créer)
│ Besoin        …                        [source ▸]
│ Profils       2× Dev Java senior       [source ▸]
│ Mode          régie                    [source ▸]
│ TJM           520 €                    [source ▸]
│ Démarrage     septembre                [source ▸]
│ Objections    …                        [source ▸]
│ Prochaines étapes …                    [source ▸]
│ ── Email de relance (aperçu, modifiable) ──         │
│                                    [ Valider ]      │
└────────────────────────────────────────────────────┘
```

Because the form is built once, at the end, from everything: no superseded facts, no frozen
blocks, no mid-call contradiction to resolve. The rep's live edits inform the extraction
rather than fighting it.

What lands in VSA on *Valider*: the rendered markdown of the document into `taskDescription`,
the typed fields into their VSA columns, contacts created where the rep accepted the offer,
and the raw transcript attached via `POST /v1/crm/tasks/{id}/attach`. Simultaneously the
Outlook draft is created.

Everything else follows HR-10: one window, no modal chrome, keyboard-first, nothing blinks.

### Screens

0. **Démarrage** — the splash. Wordmark, and three boot lines that name what is actually being
   opened: the local database, the audio devices, the transcription model. It is honest about
   the one slow case — on first run the local model downloads, with a progress bar and the
   sentence that it happens once and then stays on this machine (DEC-30). Nothing optional is
   waited on: the calendar, VerySwing and Outlook connect in the background and never hold the
   window shut (DEC-26).
1. **Calendrier** — the home screen; there is no dashboard. Two columns: **the calendar on the
   left, the day's meetings on the right.**

   It opens on today, and it is *not* named for it. The grid pages to any month and DEC-31
   lets a rep create and record a meeting on any day, so a heading reading *Aujourd'hui* over
   a grid showing *Mars 2027* would be false — and the back link out of every other screen,
   which this document already writes as *‹ Calendrier* (screen 4), would promise a
   destination it does not deliver. *Aujourd'hui* survives as the button that jumps the grid
   back to today, which is the one thing on the screen that is only ever about today.

   The calendar is **always drawn** — with Graph connected, with no Entra registration at all,
   and on a day with nothing in it (DEC-31). Month grid with `Jour · Semaine · Mois · Liste`,
   dots under the days that carry something: blue for a captured meeting, orange for armed.
   Meetings created in the app sit in the same grid as meetings from Outlook.

   Above the list is **the search**, and it is the product's only entry into the past: a field
   over clients, subjects, transcripts and notes, plus filter chips (client, période, statut,
   intention). *Historique* is **not** in the navigation — it is where this search goes when
   the rep wants the full record (DEC-25 unchanged, its entry point moved). Past meetings also
   appear inline under a `Passées` divider with their state and push result.

   Armed meetings show a quiet accent dot and the word *Prêt*; an unarmed row is information
   and carries no button. The header holds the single status control (DEC-32), *Réglages*, and
   *Nouvelle réunion* — which is permanent, because without Graph it is the only way in.
2. **En réunion** — the notepad, a meter and a rail (DEC-14 as amended by DEC-38):

   ```
   ┌ header ─────────────────────────────────────────────────────────┐
   │ ‹ Calendrier │ ● ENREGISTREMENT 12:04 ▁▃▅▂▇▃▁ │ Néovia Santé    │
   └──────────────────────────────────────┬──────────────────────────┘
                                          └ proof of life
   ┌ Mes notes ──────────────────────────────────┬ Signaux ─────────┐
   │                                             │ Profil  2× Dev   │
   │   the rep types here.                       │ TJM     520 €    │
   │   nothing else writes here                  │ Durée   —        │
   │   until the call ends.                      │ Démarr. septembre│
   │                                             │ Mode    —        │
   │   ← the only editable surface on this       │ Object. délai    │
   │     screen                                  │ Étape   —        │
   └─────────────────────────────────────────────┴──────────────────┘
              the reason it's open                  proof of value
   ```

   The centre column is the widest and the only one with a cursor.

   **The meter is the proof the tool is working** — deterministic, no model, no latency, and
   it answers during a silence, which the transcript pane it replaces could not. It draws the
   amplitude already measured on the capture path and marks the transcriber's speech floor on
   it: bars above the line will be transcribed, bars below will be silently dropped. It lives
   inside the recording pill, so it cannot keep moving after the meeting ends.

   **The rail shows the whole slate from the first frame**, empty rows included. The ESN
   compte-rendu is written from a fixed set of fields (DEC-13), so the fields are known before
   the call starts and hiding them bought nothing: an empty column is indistinguishable from a
   broken one, and « Durée — » is something a rep can act on while the client is still on the
   line. A slot stays empty for as long as nobody says the thing — filling one is the exact
   failure DEC-21 exists to prevent. Nothing reorders, because with fixed slots there is
   nothing to reorder past; nothing animates; nothing makes a sound. The rail is collapsible
   and its state persists; a rep who finds it distracting runs the pure notepad of DEC-11 and
   loses nothing, since the signals are still extracted and still there at the review gate.
   A recipe with no slate (DEC-43) has no rows to draw in advance, so the rail shows only what
   has landed and says so in the footer — « le plan du compte-rendu sera décidé à la fin » —
   rather than drawing seven rows the document will never contain.

   **Once a compte-rendu exists it is a third column, not a second tab.** It appears between
   the notes and the rail, and the rail stays exactly where the rep has been glancing at it
   for the length of the call. The two were briefly a two-tab switch in one pane, which made
   the one comparison the screen is for cost a click and a memory: judging the document
   against the slate means seeing « Durée — » empty *and* the prose silent about it in the
   same glance. Side by side rather than stacked, because the slate wants a height it never
   has to scroll and the prose wants every line it can get — stacked, the compte-rendu showed
   six lines under a full slate. The notepad keeps its floor: 320 + 210 of rail still leaves
   it 430 at the app's minimum window. Both panes go away together on one word in the header,
   and a rep who puts them away loses nothing (DEC-11) — the signals are still extracted and
   both surfaces are still at the gate.

   **The header carries the recipe picker** (DEC-43): « Prise de besoin » / « Libre », live
   from the first frame and locked while an extraction runs. It is in the header and not in
   the rail because nothing in the rail is clickable during a call. Once a compte-rendu
   exists, switching arms an inline confirmation naming the document that will be replaced;
   the rep's own notes never change.

3. **Revue** — post-call, and the only gate (DEC-4). Compte-rendu left, extracted CRM fields
   right, each field editable, each with a "source" affordance revealing the transcript span
   it came from. The email draft is previewed inline below, also editable. **One button:
   *Valider*** — it writes the VSA task and creates the Outlook draft together. The rep is
   never asked a second time; failures go to the outbox and retry silently.
4. **Historique** (DEC-25) — every call ever captured, searchable across transcripts and
   notes. A row expands into the full record: transcript with speaker channels, the rep's raw
   notes, the enhanced compte-rendu, the extraction with each field's source span, and the
   push status of each intent. This is the reader over the event log — no separate storage.

   **Reached from the calendar's search, not from a nav link.** It is the expanded form of the
   same query — the same field, the same filter chips, carried over — so the back link reads
   *‹ Calendrier*. A rep looking for what a client said in March starts by typing the client's
   name on the home screen, which is where they already are.

   ```
   ┌ Historique ──────────────── ⌕ « TJM » ─────────────────┐
   │ 12 mars   Acme SA        validé ✓   tâche · oppy · mail│
   │ 08 mars   Nordis         validé ✓   tâche · mail       │
   │ 05 mars   Groupe Lefort  prêt       ⚠ VSA indisponible │
   │  └ Transcript · Mes notes · Compte-rendu · Extraction  │
   └────────────────────────────────────────────────────────┘
   ```

5. **Réglages** — a two-pane screen (section list left, content right), and the destination of
   the header status control. Three-tier provider model (local / self-hosted / cloud) for STT
   and LLM, **local listed first because it is the default** (DEC-30); a provider that cannot
   be used is never dropped from the table, it is shown with its reason and where it runs.

   **This is where a provider is chosen and its credential supplied (DEC-34).** The row says
   how it authenticates and the control follows from that: an `apiKey` provider shows a key
   field, a `none` provider shows neither, and an `oauth` provider shows whatever its flow
   actually is — *Se connecter* for Entra, *Vérifier* for the ChatGPT row, whose grant is
   obtained by a command run elsewhere (DEC-36). A key goes to the OS credential store and
   never to a file, the event log or a diagnostics bundle; once stored it is never read back to
   the screen, which shows only that it is there and offers to replace or forget it.

   A provider's **non-secret settings** are on the same row and behave the opposite way: a base
   URL, an Azure deployment, a region — declared by the provider, rendered as plain text
   fields, and opened with the stored value in them, because a URL nobody can read back is a
   URL nobody can correct. No environment variable is required to use this app.

   Under *Transcription*, the **models** are managed as well as the providers (DEC-35): the
   bundled checkpoint is present and needs nothing; every other checkpoint in the catalogue
   lists its size, speed and accuracy, and downloads from Hugging Face on demand with visible
   progress and a cancel. A model is *not* offered as usable until the bytes on disk have been
   re-verified — the failure this prevents is a half-written checkpoint that reports itself
   ready and then aborts mid-meeting.

   Connectors are split into two groups and the split is the point (DEC-32): **Requis** —
   audio, transcription, analysis, the three that drive the general status — and
   **Facultatifs** — calendar, VerySwing, Outlook, which carry their own state and retry and
   *never* move the general status. The top of the section restates, in French, what the header
   chip means and what can change it. The DEC-24 probe result lives under *VerySwing*.

   A **Diagnostics** panel (DEC-27) shows recent errors, the retention setting, and two export
   buttons — *Diagnostics* (redacted, safe to send) and *Diagnostic complet* (includes client
   conversation content, and says so on the button).

### Visual language

Calm, low-contrast, paper-like — the opposite of a dashboard. Cool paper rather than the
earlier cream, because the brand is a cool blue and cyan on warm cream fights itself.

Built on the client's own brand values, read off objectware.fr: blue `#4dc2fb`
(their `.bg-blue`), pale blue `#c9eafb` (their `.bg-light_grey`), orange `#ff8500`
(their `.bg-orange`).

**`#4dc2fb` is 2.01:1 on white and cannot carry text, icons, borders or a status dot.** It is
a fill and a wash, nothing else. Everything that has to be read comes from the ramp below —
same hue (200°), darkened, ratios measured against white.

```css
/* brand ramp — hue 200. Every ratio names the surface it was measured against;
   a ratio with an implied reference is a ratio nobody can re-check. */
--brand-50:       #ebf8ff;   /*  1.08:1 on #ffffff — page wash, selected row */
--brand-100:      #c9eafb;   /*  1.26:1 on #ffffff — their tint: section fills, chips */
--brand-300:      #4dc2fb;   /*  2.01:1 on #ffffff — their blue: large fills ONLY, never text */
--brand-500:      #059ce5;   /*  3.05:1 on #ffffff — borders, focus rings, non-text UI, dots */
--brand-700:      #036696;   /*  6.28:1 on #ffffff — links, selected labels, brand text */
--brand-900:      #02334b;   /* 13.31:1 on #ffffff — headings on a brand tint */

/* canvas & surfaces — cool paper, not white */
--bg-canvas:      #f7f9fb;
--bg-card:        #fdfefe;
--bg-card-soft:   #f9fbfd;
--bg-inner:       #ffffff;
--bg-subtle:      #eef3f7;
--border-subtle:  #e2e9ef;
--border-card:    #d3dee6;

/* text — measured against #ffffff, then against #eef3f7, the darkest surface
   any of them lands on. The second ratio is the one that decides. */
--text-strong:    #14202a;   /* 16.54:1 on #ffffff · 14.80:1 on #eef3f7 */
--text-body:      #4a5a67;   /*  7.12:1 on #ffffff ·  6.37:1 on #eef3f7 */
--text-muted:     #62707b;   /*  5.09:1 on #ffffff ·  4.56:1 on #eef3f7 */

/* semantic */
--accent:         #ff8500;   /*  2.44:1 on #ffffff — their orange, ONE meaning: armed /
                                 recording. Fill and dot only; it cannot carry text. */
--success:        #2f855a;   /*  4.54:1 on #ffffff ·  4.07:1 on #eef3f7 — dot only */
--warn:           #b45309;   /*  5.02:1 on #ffffff ·  4.50:1 on #eef3f7 */
--danger:         #c53030;   /*  5.47:1 on #ffffff ·  4.90:1 on #eef3f7 */

/* spacing — five steps, each named after what it spaces. Derived from what the
   screens already repeat, not from a generic 4/8/16 ladder. */
--space-tight:    6px;
--space-inline:   12px;
--space-row:      16px;
--space-block:    20px;
--space-gutter:   32px;

/* type scale — Inter, the five sizes actually on screen. `--type-ui` is the
   workhorse; `--type-label` is the uppercase letterspaced section header;
   `--type-display` is where Fraunces and the -1.5px tracking start applying.
   Times, durations and money are tabular-nums at any of these sizes. */
--type-label:     10px;
--type-meta:      11px;
--type-ui:        12px;
--type-copy:      14px;
--type-display:   28px;
```

`--text-muted` was `#7d8c98` in the first draft of this palette. It measures 3.27:1 on
`--bg-canvas` and 3.09:1 on `--bg-subtle` — below AA at every size it is used, and it is also
`--ink-agent`, the colour the whole compte-rendu is written in (DEC-5). `#62707b` is the
lightest value on the same hue that clears 4.5:1 on all five surfaces.

Two accents, two jobs, and they must not be confused: **orange means "this meeting is armed or
recording" and nothing else** — never a selected tab, a primary button or a link. Brand blue
marks selection and navigation. A screen showing an orange dot beside a blue selection is
correct.

Provenance by colour survives the repaint unchanged (DEC-5): what the rep typed is
`--text-strong`, what the agent wrote at meeting end is `--text-muted`. No badges, no icons.

Type: serif display + neutral sans body. **Fraunces** (display, `weight 500`,
`letter-spacing -1.5px` at large sizes) and **Inter** (body). Both open-licensed; do not ship
Gelica or SN Pro, which are the commercial faces this pairing substitutes for.

Rules:
- Radius 10–14px. Borders 1px, `--border-subtle`. Shadows barely there (`0 1px 2px rgb(0 0 0 / 8%)`).
- Section headers: short accent rule + uppercase, letterspaced, muted label.
- Rows, not cards, for lists. Density over decoration.
- Motion: ≤150ms, ease-out, opacity and 2–4px translate only. Nothing bounces.
- No illustration inside the app. The calm comes from the palette, not from art. The one
  exception is a paper grain (`--grain`, a 64px tiled noise image at most −9/255 of
  luminance) on quiet surfaces only — splash, empty transcript pane, empty signal rail,
  empty-state panels. Never on dense text, chips, dots, progress bars, or anything that
  repaints during a call: a noise layer re-rasterising as the transcript scrolls is GPU work
  on the capture path.
- **No footer status strip.** One status control in the header, and it opens Réglages (DEC-32).
- Every foreground/background pair used for text carries its measured contrast ratio in the
  token file. A colour that has not been measured has not been approved.

There is no dark theme and there is not going to be one — the palette *is* the product's
temperature, and a second one would be a second design to keep honest.

---

## 7. Open questions

**All seven design questions are resolved** — OPEN-1 → DEC-18, OPEN-2 → DEC-19, OPEN-3 →
DEC-20, OPEN-4 → DEC-21, OPEN-5 → DEC-22, OPEN-6 → DEC-23, OPEN-7 → DEC-24. Nothing in this
document blocks implementation.

What remains is **data to gather, not decisions to take**. Each is designed around rather
than waited on, so none is on the critical path:

- **[INPUT-1] Address mix.** *Unknown, and deferred.* What share of their pipeline uses
  personal addresses, where domain matching gives nothing? Under DEC-28 the demo runs against
  seeded sandbox data, so this only matters at deployment. Design for the middle case:
  secondary signals built (exact contact email, then the other attendees on the invite),
  picker good but not optimised. One VSA contact export settles it in an afternoon.
- **[INPUT-2] Holding structures.** *Unknown — and the mitigation ships anyway.* The DEC-18
  sibling list costs one query and one line of UI, and it is the only defence against the
  failure mode DEC-18 knowingly accepts. Building it unconditionally is cheaper than finding
  out we needed it.
- **[INPUT-3] The client's `/api/doc`.** **Resolved as out of scope** — no client tenant is
  available (DEC-28). The public sandbox is the target, not a stand-in. DEC-24's probe stops
  being deployment insurance and becomes the mechanism that makes their eventual instance a
  configuration exercise rather than a rewrite (DEC-29).

The one thing genuinely unvalidated is not a question but an assumption: **DEC-11**. Nobody
has watched a real commercial on a real client call. It is not falsifiable before the demo —
the demo is what earns the access needed to test it.

---

## 8. Definition of done

### 8.1 The demo — first deliverable (DEC-28)

One real meeting, run live, end to end, landing visibly in the public sandbox.

A real Teams call happens. The app already knew about it from the Outlook calendar and armed
itself. During the call the transcript scrolls, the signal rail fills with *TJM 520 € ·
2× Dev Java senior*, and someone types — or doesn't — in the middle pane. The call ends; no
one clicks anything. Seconds later a French compte-rendu exists that reads like a
salesperson wrote it, with a filled CRM form beneath it and a follow-up email drafted. One
*Valider*. The audience then watches the task, the opportunity and the contacts appear in
VerySwing, and the draft appear in Outlook.

The demo is judged on four beats, in order of how much they convince:

| Beat | Why it lands |
|---|---|
| It armed itself from the calendar | Proves it belongs in their workflow, not beside it |
| *TJM*, *régie*, *intercontrat* transcribed correctly | Proves it understands *their* business, not meetings in general |
| The compte-rendu reads French and commercial | The only beat that cannot be faked or hand-waved |
| The VSA records appear live | Proves it is a product, not a prototype |

Explicitly **not** required for the demo: their tenant, real accounts, Historique, Réglages,
degradation handling, macOS, multi-tenancy.

### 8.2 v1 at the client

A rep at the client finishes a Teams call, opens the app, reads a French compte-rendu they
would have written themselves, corrects at most two fields, clicks twice, and finds a CRM task
in VSA and a ready-to-send draft in Outlook — having typed nothing during the call and having
never installed anything into the meeting.
