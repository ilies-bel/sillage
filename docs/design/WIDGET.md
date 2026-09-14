# The widget — the second window

`widget.png`, `widget-ouvert.png`, `widget-refus.png`, `widget-arret.png`,
`widget-attente.png`, `widget-entree.png`.

**This is the most visible thing the product does and the hardest to recreate**, because it is
not a panel inside the app. It is a separate frameless, transparent, always-on-top window
drawn over *another application* — over the face of the person on the call — for the whole
fifty minutes the app exists for.

## The window

| Property | Value |
|---|---|
| Frame | none, transparent |
| Level | `screen-saver`, on every Space |
| Taskbar | **absent** — there is no entry and nothing to alt-tab to |
| Shown with | `showInactive()` — it never steals focus |
| Exists | exactly while a meeting is `recording` |
| Screen share | `setContentProtection(true)` — it is never in a screen recording |
| Default position | bottom centre of the display |
| Moved by | dragging the card itself |

**The window is the size of its own content.** Every transparent pixel that is not the pill is
a pixel of Teams the rep cannot click. The renderer measures itself and asks the main process
to resize.

**The shadow is part of the size.** `getBoundingClientRect` does not include a `box-shadow`,
so sizing the window to the card clipped `--shadow-overlay` to nothing — and that shadow is
the only thing separating a pale card from the video call underneath. The frame reserves the
shadow's extent and gives those pixels back as click-through.

## Measured sizes

| State | Card | Window asked for |
|---|---|---|
| Collapsed pill, no marks | — | **308 × 78** |
| Collapsed pill, 2 marks | — | **313 × 78** |
| `INITIAL_SIZE` (a guess, never drawn if things go right) | — | 232 × 52 |
| Mention card, default sentence | 260 × 145 | 313 × 230 |
| Mention card, 400-char sentence | 260 × 275 | 313 × 360 |
| Panel open + 400-char card | — | 380 × 622 |

The pill sits at the **top** of the content and the panel stacks under it (or above, when the
window is in the lower half of a display). The anchor is the pill, not a window edge —
anchoring the bottom edge moved the control the rep had just pressed by 333 px.

## The states

1. **Collapsed pill** (`widget.png`) — « Enregistrement en cours », a clock, a two-channel
   level meter, a mark counter, a chevron. Two controls appear on hover: *Prévenir le client
   de la transcription* and *Marquer ce moment*, 32px apart.
2. **Panel open** (`widget-ouvert.png`) — the live transcript with speaker sides and the marks
   interleaved, a mark input, and a footer with *Ouvrir Sillage* and *Terminer*.
3. **Refusal** (`widget-refus.png`) — a card saying a mark could not be written. It **outranks
   the mention card**: a refusal is the case where the rep believes something was written and
   it was not.
4. **Stopping** (`widget-arret.png`) — *Terminer* asks for confirmation in a **different
   rectangle** from the label just pressed.
5. **Waiting** (`widget-attente.png`) — « Aucun enregistrement ». This state must never be the
   first frame the rep sees; the window waits for real content before its first show.

## The entrance and the exit — both are specified, both cost defects

**Entrance.** The window does not show until the renderer has measured itself *in the real
font* — asking for the font by name, awaiting the set, then waiting one frame — and until the
first state answer has settled either way. Before that was fixed the pill arrived clipped by
49px and settled in three steps, sliding ~25px sideways over someone's face. Deadlines exist
so that a widget which cannot measure still appears: a widget that never appears is worse than
one that appears wrong, because there is no taskbar entry to recover it.

**Exit.** It fades rather than vanishing between two frames, because the ordinary way a
recording ends is the rep pressing this window's own control while watching it. The renderer
reports the duration **it** resolved from its own computed style and the main process destroys
the window when the renderer says it is done — 150ms at rest, 0ms under
`prefers-reduced-motion`.

## What a redesign must not break

- It is **not an open app** — closing the main window closes it too.
- Its position is **a request, never an instruction**: a saved origin is honoured only if the
  window would land on a real display by at least a quarter of its own area.
- Every control carries a no-drag region; the card itself is the drag handle.
- The mark list changes **only** when the main process broadcasts, never optimistically.
