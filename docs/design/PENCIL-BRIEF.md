# Brief — recreate Sillage's interface in Pencil

Hand this to a fresh session. It assumes nothing about the code.

---

You are rebuilding the interface of **Sillage**, a French desktop meeting notetaker, inside a
Pencil `.pen` file, so that a designer can improve on it. You are **recreating what exists**,
faithfully, not redesigning it. Judgement calls go the way the screenshots go.

## Before anything

1. `mcp__pencil__get_editor_state({ include_schema: true })` — you cannot use any other Pencil
   tool until you have the schema. If it errors with « No handler found », the Pencil app is
   not open; say so and stop.
2. `mcp__pencil__get_guidelines()` to list guides, and load the ones that match this task.
3. Read, in this order:
   - `docs/design/README.md`
   - `docs/design/TOKENS.md` — every colour, size, duration, with exact values
   - `docs/design/SCREENS.md` — nine surfaces, their columns and widths
   - `docs/design/WIDGET.md` — the second window; read this one twice
   - `docs/design/COMPONENTS.md`
4. Look at every PNG in `scratch/design-shots/`. **They are the truth**; the documents describe
   them. They are 2× — a 2560×1600 image is a 1280×800 screen, so halve every pixel you measure.

## What to build

**Set up first:** a variables/tokens set from `TOKENS.md` — colours, the five type sizes, the
two families (Fraunces for display, Inter for body), spacing, radii, the two shadows. Bind
everything to these; do not paste hex values into nodes.

**Then components**, from `COMPONENTS.md`: `Button` in its seven variants and its disabled form
(which always carries a visible French reason), `Chip`, `StateDot`, `SectionHeader`,
`Segmented`, the level meter, a calendar-row, a field-row with its `source ▸`.

**Then the screens**, one frame each at **1280×800**, in this order — earlier ones teach you
the vocabulary for later ones:

1. `agenda` — the home screen
2. `session` and `session-compte-rendu` — two columns, then three
3. `review` — the confirmation gate, two columns in a 1440px max-width container
4. `historique`
5. `reglages` (+ `reglages-transcription`, `reglages-modele`, `reglages-raccourcis`)
6. `onboarding` ×3
7. `splash`
8. **the widget**, all six states, each as its own small frame at its measured size — see the
   table in `WIDGET.md`. Put them on a dark or photographic background, because that is what
   this window is actually drawn over and it is the only way its shadow and its contrast read
   honestly.

Then the variants: `agenda-semaine`, `agenda-liste`, `agenda-empty`, `agenda-client`,
`historique-marque`, `review-valider`, `review-transcription`, `session-demander`.

## How to work

- **Screenshot the frame you just built and compare it to the PNG.** Use
  `mcp__pencil__get_screenshot` on the frame, not the document. Fix what differs. Do this per
  screen, not at the end.
- Use `mcp__pencil__snapshot_layout` for sizing and alignment checks; reserve screenshots for
  colour and type fidelity.
- Keep every French string **exactly** as it appears, including the typographic apostrophe
  (U+2019, not `'`), the guillemets « … », and the non-breaking space before `:` `;` `?` `!`.
  These strings are load-bearing in the real app — its test harness finds screens by them.
- Name layers after what they are in the product (« rail des signaux », « garde de
  validation »), not « Group 14 ».

## Things that are easy to get wrong

- **Orange is only ever a fill or a dot, never text, and it means exactly one thing: armed or
  recording.** Blue means selection and navigation. They never swap.
- **Exactly one control is filled on the agenda.** Everything else is bordered. That is the
  point of the screen.
- **Empty signal slots say « — »** and are not a mistake.
- **The reading columns are narrower than their containers.** That is a deliberate 58ch measure.
- **Nothing is centred** except the gate's 1440px container.
- **No icon set.** Almost everything is text.
- **The grain**: the canvas carries a tiled 64×64 noise PNG at very low opacity. Match the
  screenshot's texture rather than a flat fill.

## Deliverable

One `.pen` file, laid out as a board: components at the top, then screens left to right in the
order above, then the widget states together on their dark background. Report which screens you
consider faithful and, specifically, **anything you could not reproduce** — that list is the
most useful thing you will produce, because it is where the real interface is doing something a
design tool does not have a primitive for.
