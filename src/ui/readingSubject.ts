/**
 * **What a reading column calls the thing it is scrolling, in both directions.**
 *
 * `ReadingColumn` draws one control with two states, and the two states are two
 * different grammatical frames:
 *
 *     down   Lire la suite **du** compte-rendu      ← genitive
 *     up     Remonter dans **le** compte-rendu      ← nominative
 *
 * It used to take one string and interpolate it into both, so every caller
 * supplied the genitive — which is what the *first* frame a reader meets needs —
 * and the other frame read « Remonter dans **du** compte-rendu ». Six labels, on
 * the most-pressed control of three reading surfaces, and nothing could see it:
 * `--a11y` asks whether a control *has* a name, never whether the name is
 * French, and `check:french` reads prose for the straight apostrophe.
 *
 * So a caller declares the **noun and its determiner**, never a label, and the
 * two frames are derived here. That is what makes the defect unrepresentable
 * rather than merely fixed: there is no longer a string a caller could bend the
 * wrong way, and a caller cannot supply half of a pair it does not write.
 *
 * The determiner set is closed, because French contraction is closed: `de` + the
 * five determiners this product's columns actually need. A sixth is a line in
 * `OF` and a compile error at the call site until it is added — never a silently
 * wrong label.
 *
 * **The verb belongs to the frame, not to the caller.** The review gate writes
 * its own two labels by hand (`Review.tsx`) because its columns are not this
 * component's: the document turn there is the same gesture on the same artefact
 * and reads identically — « Remonter dans le compte-rendu » / « Lire la suite du
 * compte-rendu », which is this function's output for `{ le, compte-rendu }`, and
 * `readingSubject.test.ts` pins the two together — while its rail holds the list
 * of things that will be created rather than prose, which is why that one says
 * « Voir la suite de ce qui part » and why a rail is not a reading column.
 */

/**
 * The determiner a column's noun takes, spelled as it is read.
 *
 * An article is not the only kind. « vos notes » is what *Historique* calls the
 * rep's own notepad and « cette étape » is what the onboarding calls the step a
 * rep is on; `de vos` and `de cette` are uncontracted, which is exactly why the
 * genitive has to be declared per determiner rather than guessed by prefixing
 * « de » — the half of French that does contract is `le` and `les`.
 */
export type ReadingDeterminer = 'le' | 'la' | 'l’' | 'les' | 'vos' | 'cette'

export interface ReadingSubject {
  /** « le », « la », « l’ », « les », « vos », « cette » — read as part of the label. */
  readonly determiner: ReadingDeterminer
  /** « compte-rendu », « fiche », « transcription », « notes », « étape ». */
  readonly noun: string
}

/** `de` + the determiner, contracted. The whole of what the two frames differ by. */
const OF: Record<ReadingDeterminer, string> = {
  le: 'du',
  la: 'de la',
  'l’': 'de l’',
  les: 'des',
  vos: 'de vos',
  cette: 'de cette',
}

/**
 * « l’ » is elided and takes no space; every other determiner does.
 *
 * Written once here rather than inside each label, because the elision applies
 * to `de l’` as well and two copies of one rule is how « de l’ extraction »
 * ships on one frame and not the other.
 */
const join = (determiner: string, noun: string) =>
  determiner.endsWith('’') ? `${determiner}${noun}` : `${determiner} ${noun}`

export interface ReadingTurnLabels {
  /** The label while there is more below: « Lire la suite du compte-rendu ». */
  readonly down: string
  /** The label at the end: « Remonter dans le compte-rendu ». */
  readonly up: string
}

/** Both frames, derived from one declaration, so they cannot disagree. */
export function readingTurnLabels(subject: ReadingSubject): ReadingTurnLabels {
  const { determiner, noun } = subject
  return {
    down: `Lire la suite ${join(OF[determiner], noun)}`,
    up: `Remonter dans ${join(determiner, noun)}`,
  }
}
