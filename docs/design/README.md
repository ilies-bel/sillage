# Design handoff — recreating Sillage's interface in Pencil

This folder exists so the interface can be rebuilt in a design tool **as it actually is**,
and then improved there rather than in the code.

## What is authoritative

| Question | Answer lives in |
|---|---|
| What a screen looks like | `scratch/design-shots/*.png` — real screenshots of the shipped renderer |
| What a colour, size or duration *is* | [TOKENS.md](./TOKENS.md), generated from `src/design/tokens.css` |
| How a screen is laid out | [SCREENS.md](./SCREENS.md) |
| The second window | [WIDGET.md](./WIDGET.md) — the hardest thing to recreate, and the most visible |
| The parts screens are built from | [COMPONENTS.md](./COMPONENTS.md) |
| What to hand another session | [PENCIL-BRIEF.md](./PENCIL-BRIEF.md) |

**The screenshots are the truth, not these documents.** They are taken by
`scripts/harness/shot.mjs` against the running renderer with a stubbed IPC bridge, at
`deviceScaleFactor: 2` — so a 1280×800 screen is a 2560×1600 PNG and every measurement below
can be checked by measuring the image and halving it.

Regenerate them all with the dev server running on 5180:

```
npm run dev -- --port 5180 --strictPort          # in another shell
node scripts/harness/shot.mjs <stage> out.png --no-expand --viewport 1280x800
```

`--no-expand` matters: without it the harness un-clips every textarea and shoots the full
page, which is right for reviewing content and wrong for seeing the window a rep gets.

`scripts/harness/README.md` lists all 63 stages. The 27 captured here are the distinct
screens; the rest are variants that exist to test a rule (a guard refusing, a fixture with no
Microsoft account, an empty day).

## Two sizes, always

- **1280×800** — the default window (`main.ts`).
- **960×600** — the enforced minimum (`minWidth`, `minHeight`). Not a phone: it is the size a
  rep gets when they put the app beside Teams, which is the whole use case.

Every layout decision in this product has to hold at both. Several defects shipped because
they were only ever looked at on the comfortable size — the most recent one this week: a page
title that measured perfectly at 1280×800 and sat at **top −10** at 960×600.

## What this interface is for

A desktop meeting notetaker for sales reps at a French ESN. It never joins the call: it
listens to the machine's own audio, transcribes, writes French notes, and after **one** human
confirmation pushes to a CRM and drafts a follow-up mail.

Three facts shape every screen:

1. **Everything a user reads is French.** Typographic apostrophes (U+2019), French spacing
   (a non-breaking space before `:` `;` `?` `!`), guillemets « … » for quotations.
2. **The rep is on a call.** Most of these screens are looked at while somebody is talking.
3. **One press writes into a client's CRM and cannot be undone.** The review gate is built
   around protecting that press, and its layout is load-bearing rather than decorative.
