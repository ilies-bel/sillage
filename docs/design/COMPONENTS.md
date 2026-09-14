# Components

| Component | Variants / notes |
|---|---|
| `Button` | `bordered` (default), `primary`, `caution`, `danger`, `nav`, `text`, `link`. All ≥24px tall, `inline-flex items-center`. A press moves it 1px down — except `primary`, `caution` and `danger`, deliberately: those are what the CRM ships on. |
| | **A disabled button is only constructible with a reason**, and the reason renders in French *beside* it, in the DOM. Not a tooltip. |
| `Chip` | a bordered pill, plus an uppercase micro-label variant |
| `StateDot` | a coloured dot that **cannot be rendered without its text label** |
| `SectionHeader` | short accent rule, then an uppercase letterspaced muted label. Used only where two things could otherwise be confused. |
| `Segmented` | the `Jour/Semaine/Mois/Liste` and `Lecture/Modifier/Transcription` switches |
| `ReadingColumn` | a scrolling prose column that says how much of itself is left — a fade mask and a page-turn control naming its subject (« Lire la suite du compte-rendu » / « Remonter dans le compte-rendu ») |
| `PageTurn` | the control inside it |
| `CopyButton`, `List`, `EmptyState`, `SectionNav` | as named |
| `CompteRenduDocument` | the typesetter — markers hang in a left gutter, prose beside them |
| `LevelMeter` | two channels mirrored about a baseline; bars below the transcription floor are greyed |

## Rules that shape how these look

- **Whatever `border-*` can say, `ring-*` and `decoration-*` must say too.** Three times a
  class name was right, no rule existed, and the element was silently unstyled.
- **No `/NN` opacity modifier on a design token** — it compiles to no rule at all.
- **A control that cannot work is never offered as a dead button.** Either it is absent, or it
  is present with the reason stated beside it.
- **Colour never carries information alone.** `⚠ faible` is also `font-semibold`; a dot always
  owns a label.
