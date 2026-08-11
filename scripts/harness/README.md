# Screenshot harness — Sillage renderer in a plain Chromium

Renders any screen of the app to a PNG, without Electron, without a real audio
device, without Graph, VerySwing or an LLM key — and runs a design detector
inside that same rendered page.

```
node scripts/harness/shot.mjs <screen> <out.png> [--viewport WxH] [--expand] [--scan [out.json]] [--no-png] [--sans-entra]
node scripts/harness/serve.mjs                 # the same app at a URL, for tools that only take one
```

## The two entry points

**`shot.mjs`** drives the screen the way a rep reaches it and shoots it. With
`--scan` it also evaluates impeccable's `detect-antipatterns-browser.js` in the
page and writes the findings as JSON beside the PNG. The scan runs *before*
`--expand`, on the layout the window really draws — unclipping the scrollers is
a lie told to the camera, and told to the detector it would erase every finding
about content below a fold.

**`serve.mjs`** proxies Vite on a second port with the bridge injected and the
CSP meta dropped, so anything that can only be handed an address works:

```
node scripts/harness/serve.mjs &
node ~/.claude/skills/impeccable/scripts/detect.mjs "http://localhost:5181/?scenario=agenda" --viewport 1440x900
```

Pointed at Vite directly (`:5180`) that command scans a spinner and reports
nothing, because `window.app` is missing and every screen renders its error
state. That is why every browser-mode design pass this repo has run came back
empty — not because the screens were clean. `?scenario=` picks the dataset,
`?freeze=0` unpins the clock. Only the entry screens are reachable that way;
anything behind a click needs `shot.mjs`.

## Why it works

The renderer reaches the main process through exactly one object: `window.app`,
put there by `electron/app/preload.ts`. In a browser that object does not exist,
so every screen renders a spinner or an error.

`bridge-stub.mjs` exports one self-contained function that installs the same
two-method shape (`invoke` / `on`), and `shot.mjs` injects it with
`page.addInitScript` — which runs **before** `main.tsx`, so the first
`useInvoke('boot:state')` already has an answer. Nothing in `src/` is patched or
mocked; the app is the app.

Payload shapes are lifted from the renderer's own vitest fixtures
(`src/screens/__tests__/*.test.tsx`), which are typed against
`electron/core/contracts/`. If a channel is renamed there, those tests break
first and this stub is the second thing to fix.

## Requirements

The Vite dev server on **port 5180**:

```
cd <repo root>
npm run dev -- --port 5180 --strictPort
```

Override with `SILLAGE_URL=http://localhost:1234 node shot.mjs …`.

Playwright is resolved out of the repo's own `node_modules` (v1.60), so the
harness can live outside the repo and still run from anywhere.

`--scan` reads the detector from
`~/.claude/skills/impeccable/scripts/detector/detect-antipatterns-browser.js`;
`IMPECCABLE_DETECTOR` overrides the path. The skill's *own* `detect <url>` mode
additionally needs `puppeteer` somewhere Node can resolve it from the skill
directory — `npm install puppeteer --prefix ~/.claude` puts it in
`~/.claude/node_modules`, which survives `npx impeccable update`. Without it
that command exits with "puppeteer is required for URL scanning", which is the
second reason browser-mode passes came back empty.

`page.evaluate` reaches the page over CDP rather than through a `<script>`
element, so `index.html`'s `script-src 'self'` does not apply to `--scan`. It
does apply to anything that injects an overlay by appending a tag — that is
what `serve.mjs` drops the meta for.

## Screens

| screen | what it stages |
|---|---|
| `splash` | screen 0 (DEC-30): base locale ready, audio still pending, the first-run model download at 42 % with its progress bar |
| `agenda` | *Calendrier* on a full day — month grid with marks, two calls ahead, one **Prêt** (armed, HR-7), two under *Passées*, the search bar with client chips, `Tout fonctionne` in the header |
| `agenda-empty` | DEC-31's own case: a day with nothing on it, grid and search bar still drawn. The day is found by its accessible name, not by date, so the shot does not expire |
| `agenda-semaine` | the same day in the **Semaine** view |
| `agenda-liste` | the same day in the **Liste** view |
| `agenda-client` | one client chip pressed — the filter path rather than the typed-query path |
| `agenda-search` | the same screen with `TJM` typed: the day list gives way to *Résultats*, each row carrying the matched excerpt and its push summary |
| `session` | *En réunion* — the rep's own ProseMirror notes filling the frame, the seven-slot signal rail on the right, and the two-channel level meter in the recording pill fed a speech-shaped history over `audio:level` — the rep above the baseline, the far end below, both with bars under the transcription floor — `00:22:00` on the clock |
| `session-attente` | the same meeting **ended with no model configured** (DEC-39) — the notice that used to be a blank screen, stating that the transcript and the notes are safe and that the compte-rendu follows as soon as a model exists, beside *Choisir un modèle* |
| `session-compte-rendu` | the same meeting **after the analysis** — three columns: the rep's own notes, still editable and still theirs (DEC-5), the compte-rendu, and the slate, all drawn at once with nothing pressed. *Relire et valider* is still the only door to the gate (DEC-4) |
| `review` | the gate (DEC-4): the compte-rendu, eleven fields with `⚠ faible` on *Objections*, group-account chips, the Outlook draft, and the three intents above one *Valider* |
| `historique` | the reader (DEC-25): seven calls with per-intent push status, one row expanded into transcript · notes · compte-rendu · extraction · envois |
| `reglages` | *Connecteurs*, opened where the header control lands: **Requis** with one *à vérifier*, **Facultatifs** with VerySwing down and Outlook to check, two *Réessayer*, and the VSA tenant probe |
| `agenda-sans-entra` | the same calendar with **no Entra app registration** — see below |
| `session-sans-entra` | a call recorded with no Microsoft account of any kind |
| `review-sans-entra` | the gate with the Outlook intent greyed and the two VerySwing ones live |
| `reglages-sans-entra` | *Facultatifs* with the Microsoft row inert and stating why |

## `--sans-entra` — the configuration the first demo ships in

The stub used to answer `auth:state` with a signed-in account **on every
screen**, so the only case the harness could photograph was the one that does
not exist yet. There is no Entra app registration — it lives in a tenant we do
not control (DEC-28) — and that is the build a rep will be shown.

`entra: false` is therefore an axis of its own rather than a scenario name: it
crosses all of them. It is not "signed out", which is a rep who has an app to
sign into and has not; it is *there is nothing to sign into*. The stub answers
as the main process does in that state — `auth:state` carries
`AuthState.reason`, `auth:signIn` rejects, `agenda:snapshot` is `EMPTY_AGENDA`,
and calendar and mail are `down` with `retryable: false` and `app/main.ts`'s own
sentences.

```
node scripts/harness/shot.mjs agenda-sans-entra scratch/x.png     # the four staged screens
node scripts/harness/shot.mjs historique scratch/x.png --sans-entra   # or any other screen
http://localhost:5181/?scenario=agenda&entra=0                        # via serve.mjs
```

What the four screens are there to hold to: the grid is drawn and usable
(DEC-31), the header still reads *Tout fonctionne* because only capture,
transcription and analysis may move it (DEC-32), *Nouvelle réunion* records a
call end to end, and no control on any of them is one that cannot work (DEC-26).

`meeting:create` is remembered rather than answered and discarded, so that last
one is actually reachable: the created meeting appears in the grid, opens, and
records.

Every screen except `splash` is reached the way a rep reaches it — a click on a
row, on *Relire et valider*, on *Tout l'historique ›*, on *Réglages*. Nothing is
deep-linked, so a broken route fails the shot instead of hiding behind it.

## The fixtures

One day in the life of **Julien Marchand**, commercial at *Synapse IT* (a French
ESN), on the Microsoft account `julien.marchand@synapse-it.fr`. Seven client
accounts — Néovia Santé, Groupe Lefort, Sodexial, Groupe Maréchal, Banque
Delcourt, Nordis Retail, Arkelia Logistique — with real ESN vocabulary (TJM,
régie, profils, démarrage, durée, objections achats) so the type and the layout
are judged on sentences the product will actually hold.

The live meeting is **Néovia Santé — cadrage renfort data**: a data-engineering
staffing conversation that names two confirmed profiles, a lead, September,
twelve months, régie, and a purchasing objection at 550 €. Both the signal rail
and the review gate are folded from that same conversation, so the three screens
agree with each other.

## Determinism

`page.clock.setFixedTime()` pins the clock to **today at 14:35 Paris**, and the
same instant is handed to the stub, so the fixtures and the app agree to the
millisecond: the armed call started five minutes ago, two are behind, two ahead,
and the elapsed clock always reads `00:22:00`. The browser context is
`Europe/Paris` / `fr-FR`, so the app's `atParis()` arithmetic and the stub's
`setHours()` land on the same day. Timers keep running — the search debounce is
200 ms real time and has to fire.

## `--expand`

The app shell never scrolls the document: it is `h-full` with its own inner
`overflow-y-auto` columns, so a `fullPage` shot of it is exactly one viewport
and anything below an inner fold is lost. `review`, `historique` and `reglages`
therefore unclip those scrollers before the shot — the shell's
`.h-full.overflow-hidden` and every `.overflow-y-auto`, never the rounded `List`
whose own clipping is what draws its corners. Width, type, spacing and colour
are untouched; only the clipping is. Pass `--expand` to force it on any screen.

The ones that fit — `splash`, every `agenda*` and `session` — are shot exactly
as the window renders them.

## Output

1440 × 900 viewport by default, `deviceScaleFactor: 2`, `fullPage`. So
`agenda.png` is 2880 × 1800 and `review.png` is 2880 × 3568. `--viewport
1280x800` and `--viewport 1920x1080` are the other two the app is judged at;
that flag is why there is one file here and not five near-identical copies of
it.

`--scan` writes `scratch/scan-<screen>-<width>.json` unless given a path, and
prints one line per finding *type* with a count — the detector reports per
element, and one wrong token is forty elements.

## What the scan finds today

Every screen reports `overused-font` (Inter) and `layout-transition`
(`transition: width`). The recurring one worth a decision is
`undersized-ui-text`: the `label` type step is 10px and the detector's floor for
functional text is 11px, so the calendar's weekday headers, its legend, the
section eyebrows and the *Passées* divider are all flagged. That is a design
call — the ramp is deliberate — but it is now a call made with the count in
front of us rather than one nobody was shown.

## Debugging

- The stub exposes `window.__harness`: `emit(channel, payload)` pushes a
  broadcast as the main process would, `calls` is every invoke, `unanswered` is
  every channel it had no answer for. A non-empty `unanswered` is printed after
  each run — it means a screen asked for something the stub does not know, which
  is usually a channel added to `core/contracts/ipc.ts`.
- A staging failure prints the screen's own text, so « why did the click not
  find *Ouvrir* » is answered without opening a browser.
- Console errors and warnings are reported, minus Vite's own chatter. The one
  that always appears — `'frame-ancestors' is ignored when delivered via a
  <meta> element` — is the app's CSP meta tag and is expected outside Electron.

## Adding a screen

Add an entry to `SCREENS` in `shot.mjs` with the `scenario` its data needs and a
`drive(page)` that clicks its way there. Add data to `bridge-stub.mjs` only if a
channel has no answer — the stub answers all 20 invoke channels of
`core/contracts/ipc.ts` today, and listens on all 8 broadcasts.
