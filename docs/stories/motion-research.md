# Motion research for US-3

Gathered by the coordinator, not by the implementing agent. Three sources: the
competitor's shipped stylesheets, a published standard, and this repo's own measured
decisions — which disagree with the standard in one place, and win there.

Reference images are in `ref/` (gitignored).

---

## 1. What Granola 7.543.3 actually ships

Read off the CSS inside their `app.asar`, not off their marketing.

```
--default-transition-duration : .15s
--default-transition-timing   : cubic-bezier(.4, 0, .2, 1)      /* Material standard */
--ease-out-expo               : cubic-bezier(.16, 1, .3, 1)
--join-ease                   : cubic-bezier(.22, 1, .36, 1)    /* == our --ease-out */
overshoot springs             : cubic-bezier(.22, 1.2, .36, 1)
                                cubic-bezier(.25, 1.1, .5, 1)
                                cubic-bezier(.34, 1.56, .64, 1)
durations in use              : 0 · 75ms · .1 · .15 · .2 · .25 · .28 · .3 · .325 · .375 · .5 · .6 · 1s
~60 named keyframes · 15 distinct shadows
```

Two things to take from this. Their base duration is **.15s — the same as our `--motion`**,
and `--join-ease` is byte-identical to our `--ease-out`, named for the moment of joining a
call. The taste is already right; the vocabulary is one note. And they have three
overshoot curves where we have none — overshoot is what makes something *arriving* read
as alive rather than merely fast.

## 2. The published standard

[emilkowalski/skills · review-animations/STANDARDS.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md),
and [7 practical animation tips](https://emilkowal.ski/ui/7-practical-animation-tips).
The concrete rules, kept exact:

**Durations** — button press feedback 100–160 ms · tooltips and small popovers
125–200 ms · dropdowns and selects 150–250 ms · modals and drawers 200–500 ms.
Master rule: **UI animations stay under 300 ms**. A 180 ms dropdown feels more responsive
than a 400 ms one.

**Curves** — built-in CSS easings are too weak; use strong custom ones.

```css
--ease-out:     cubic-bezier(0.23, 1, 0.32, 1);   /* ours is (0.22, 1, 0.36, 1) — the same curve */
--ease-in-out:  cubic-bezier(0.77, 0, 0.175, 1);  /* on-screen movement. We have nothing for this. */
--ease-drawer:  cubic-bezier(0.32, 0.72, 0, 1);   /* iOS drawer, from Ionic */
```

**Frequency decides whether it animates at all** — 100+ times a day: never. Tens of times
a day: remove or drastically reduce. Occasional: standard. Rare or first-time: delight.
And « never animate keyboard-initiated actions ».

**Physicality** — never `scale(0)`; start at `scale(0.9–0.97)` with `opacity: 0`. Popovers
are **origin-aware**: they scale from the trigger, `transform-origin: var(--transform-origin)`,
never from centre; modals are the exception because nothing anchors them. Button press is
`scale(0.97)` on `:active` over 160 ms.

**Properties** — animate `transform` and `opacity` only. Not `height`, `width`, `top`,
`left`, `padding`, `margin`.

**Interruptibility** — CSS transitions retarget mid-flight; keyframes restart from zero.
For anything that can be triggered rapidly, transitions.

**Springs** — Apple's parameterisation is easier to reason about:
`{ duration: 0.5, bounce: 0.2 }`. Keep bounce in 0.1–0.3, and avoid it in most UI.

**Stagger** — 30–80 ms between items, and never blocking interaction while it plays.

**Reduced motion** — « fewer and gentler animations, not zero ».

**Blur as a mask** — when a crossfade feels wrong after trying every easing, a
`filter: blur(2px)` during the transition blends the two states into one. Keep it under
20 px; it is expensive in Safari.

## 3. Where the standard and this repo disagree — and the repo wins

The standard says **« never `ease-in` on UI »**: it starts slow, delaying the moment the
user is watching most closely. That rule is about something *arriving*, and for arrivals
it is right and we already follow it.

Our one exit is not an arrival and not an ordinary element. `CLAUDE.md` records the
measurement: on `.widget-leaving` with `--ease-out` — an expo-out spending 73 % of its
change in the first 35 ms — opacity was above 0.05 for **62 of 150 ms**, the 3 px
translate was spent entirely below 25 % opacity where there is nothing left to see
moving, and the window then held its place over the rep's call for 88 ms fully
transparent. `--ease-in` took it to **147 ms**. And the duration is not only a duration:
the renderer reports it to the main process, which destroys the window when it expires.

So `--ease-in` stays, it stays pinned by its shape, and it applies to **departures only**.
If you think the general rule should override the local measurement, say so and show the
measurement that beats it — do not quietly change the token.

## 4. What the frequency table says about *this* product

This is the part the standard cannot tell you, and it is a finding rather than a rule.

| Surface | How often a rep meets it | Verdict |
|---|---|---|
| The widget arriving over a call | once or twice a day | the polished one. This is where delight belongs. |
| The widget leaving | same | already measured; leave the curve alone |
| Review gate **page turn** | **6–10 presses per gate**, measured | « tens of times a day → remove or drastically reduce ». It is smooth-scrolled today. |
| The six global shortcuts | keyboard-initiated | « never animate keyboard-initiated actions » |
| Signal rail rows filling | continuously during a call | stagger is wrong here; a row appearing must not block |
| Onboarding, first run | once, ever | rare → delight is legitimate |

The page turn is the interesting one, and US-14 measured it: the smooth scroll was charging
by **distance travelled rather than by page**, so a rep who pressed again before it settled
paid **14 presses for a 5-page gate** under a caption promising presses = pages. Instant, a
press is exactly one page at any cadence — 7 and 9 at the two smoke sizes, and the guard
credits the animated sweep with nothing either way. A finding about the gate, not a motion
preference, which is why it was worth measuring rather than assuming.

## 5. Dribbble

Searched, and worth recording honestly: it returned tag pages
([mac-menu-bar](https://dribbble.com/tags/mac_os_menu_bar),
[meeting-widget](https://dribbble.com/tags/meeting-widget),
[micro_interaction](https://dribbble.com/tags/micro_interaction)) and single shots
rather than anything specific to a floating recording pill over a video call. Nothing
there is better evidence than the competitor's own shipped stylesheet, which is the
artefact rather than a picture of one.

The reference that *is* specific is `ref/granola-note.png` — their hover magnifier
appearing on the line under the pointer, their chip row, and their ask bar. Study the
frame, then measure ours.
