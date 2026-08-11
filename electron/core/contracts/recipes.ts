/**
 * The compte-rendu recipes — what shape the document takes, declared once
 * (DEC-43, amending DEC-13).
 *
 * DEC-13 said one fixed recipe and no picker, and the reasoning still holds for
 * the *default*: comparable notes across every rep, one prompt to tune, one
 * benchmark. What it did not survive is the meeting that is not a prise de
 * besoin — a follow-up, a steering committee, a technical deep-dive. Forced
 * through the ESN slate those produce a document that is six-sevenths « _non
 * évoqué_ », which is worse than no structure at all: a rep reading it cannot
 * tell an empty field from a meeting where nothing was said.
 *
 * So there are two recipes and there is a hard rule about what a recipe may be:
 *
 *   **A recipe declares a shape. It never declares a fact.**
 *
 * Everything here is a heading, a field name or a label. There is no room in
 * this file for a value, a prompt fragment that asserts something about a
 * client, or a threshold — those live where they already live. Adding a third
 * recipe is an entry in `RECIPES` plus its prompt in `modules/extract/prompt.ts`;
 * it is deliberately *not* a user-editable template, because a template a rep
 * writes is a prompt nobody benchmarks (this is the half of DEC-13 that stands).
 *
 * ## Why the free recipe carries no fields at all
 *
 * `libre` extracts nothing typed — no besoin, no TJM, no profils. That is the
 * whole point of it and it has a stated cost: **no typed field means no measured
 * confidence** (DEC-21), because there is no cited value to verify a span
 * against. The narrative is prose either way and prose was never cited. What is
 * lost is the `⚠ faible` marker and the VerySwing *opportunité*, which
 * `core/domain/reviewGate.ts` refuses to draft rather than draft empty. The
 * transcript is untouched and still the record.
 */
import { z } from 'zod'
import type { SignalKind } from './signals.ts'

export const RecipeIdSchema = z.enum(['besoin-commercial', 'libre'])
export type RecipeId = z.infer<typeof RecipeIdSchema>

/**
 * What a meeting uses unless the rep says otherwise, at every layer that has to
 * pick one: a new meeting, a log written before recipes existed, a stored
 * extraction whose event predates the field.
 *
 * It is the ESN recipe and not the free one on purpose. The product exists for
 * prise de besoin calls; a default of `libre` would quietly stop filling the CRM
 * for every rep who never opens the picker.
 */
export const DEFAULT_RECIPE: RecipeId = 'besoin-commercial'

/**
 * The interpretive fields a recipe can ask for, named exactly as
 * `LlmInterpretation` names them.
 *
 * The same vocabulary `VerificationReport.fields` is keyed by, which is what
 * lets `reviewGate.ts` map a form row to a verified path without a translation
 * table that can drift.
 */
export const InterpretiveFieldSchema = z.enum([
  'besoin',
  'profilsRecherches',
  'modeCollaboration',
  'tjmEvoque',
  'dateDemarrage',
  'dureeMission',
  'contexteTechnique',
  'objections',
  'prochainesEtapes',
])
export type InterpretiveField = z.infer<typeof InterpretiveFieldSchema>

export interface RecipeDescriptor {
  id: RecipeId
  /** One or two words. What the picker in the session header shows. */
  label: string
  /** The full French name, for the places that have room for it. */
  title: string
  /** One line, stating what it does *and* what it costs. Rendered verbatim. */
  description: string
  /**
   * The fixed markdown headings, in order. **Empty means the model chooses**,
   * which is the whole of what makes `libre` free-form — the prompt is told to
   * organise what was said, not to fill a form.
   */
  sections: readonly string[]
  /**
   * The typed fields extracted, verified and offered at the review gate. Empty
   * means none, and then the gate shows the document and the two deterministic
   * rows and nothing else.
   */
  fields: readonly InterpretiveField[]
  /**
   * The signal-rail slate: the rows drawn empty from the first frame, before
   * anybody has said anything (DEC-14, DEC-38).
   *
   * Empty means there is no slate to draw, because the fields are not known
   * before the call. The rail then shows only what has actually landed — which
   * is the honest rendering of « the shape is decided at the end », and is what
   * the rail did before it knew the recipe.
   */
  slate: readonly SignalKind[]
}

/**
 * The fixed section headings of the ESN recipe (DEC-13, DEC-40).
 *
 * Exported by name as well as through the descriptor because it is the single
 * source the prompt and the tests both read, and a heading that drifts between
 * the prompt and the document is how one recipe becomes two.
 */
export const COMPTE_RENDU_SECTIONS = [
  /*
   * First, and the only section written to be read on its own.
   *
   * The rest of the document is complete, which is exactly why it is not
   * skimmable: a rep opening a compte-rendu three weeks later, or a manager
   * opening one they were not in, wants the shape of the meeting before they
   * decide whether to read it. « Contexte » does not do that — it restates the
   * setup, not the outcome. The « Éléments retenus » recap at the foot does not
   * either: it is a field list, and a field list says what was extracted rather
   * than what happened.
   */
  '## Résumé',
  '## Contexte',
  '## Besoin exprimé',
  '## Échanges et points techniques',
  '## Objections et points de vigilance',
  '## Prochaines étapes',
] as const

/**
 * Declaration order, and the order the picker draws them in. The default is
 * first because a control whose default is not the leftmost option is a control
 * people misread at a glance, on a screen they are looking at during a call.
 */
export const RECIPES: readonly RecipeDescriptor[] = [
  {
    id: 'besoin-commercial',
    label: 'Prise de besoin',
    title: 'Prise de besoin commercial',
    description:
      'La trame ESN : besoin, profils, TJM, mode, démarrage, objections, prochaines étapes. Chaque champ est vérifié dans la transcription et alimente VerySwing.',
    sections: COMPTE_RENDU_SECTIONS,
    fields: [
      'besoin',
      'profilsRecherches',
      'modeCollaboration',
      'tjmEvoque',
      'dateDemarrage',
      'dureeMission',
      'contexteTechnique',
      'objections',
      'prochainesEtapes',
    ],
    /**
     * The slate, in the order a rep would work through it: who, how much, how
     * long, from when, how, what is in the way, what happens next.
     *
     * `autre` is deliberately absent — it is the extractor's catch-all, so it
     * has no slot to wait in and appears only once something lands in it.
     */
    slate: ['profil', 'tjm', 'duree', 'demarrage', 'mode', 'objection', 'etape'],
  },
  {
    id: 'libre',
    label: 'Libre',
    title: 'Compte-rendu libre',
    description:
      'Aucune trame : le plan est décidé à la fin, à partir de ce qui a été dit. Pas de champ typé, donc pas de marqueur de confiance ni d’opportunité VerySwing.',
    sections: [],
    fields: [],
    slate: [],
  },
]

const BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]))

/** Declaration order puts the default first, which is what makes this total. */
const FALLBACK: RecipeDescriptor = RECIPES[0] as RecipeDescriptor

/**
 * The descriptor, never undefined.
 *
 * Falls back to the default rather than throwing, because every caller is a
 * render path: a stored id from a future version, or a hand-edited preference,
 * must draw *a* document rather than take down the screen showing it.
 */
export const recipeById = (id: RecipeId | null | undefined): RecipeDescriptor =>
  BY_ID.get(id ?? DEFAULT_RECIPE) ?? FALLBACK

/**
 * True when this recipe extracts nothing typed — the gate and the rail both ask.
 *
 * Nullable for the same reason `recipeById` is: `LlmInterpretation.recipe` is a
 * defaulted key, so an object built in code rather than parsed from the log can
 * carry `undefined` at runtime while the type says otherwise. Absent is the
 * default recipe, which is the ESN one, which is not free-form.
 */
export const isFreeForm = (id: RecipeId | null | undefined): boolean =>
  recipeById(id).fields.length === 0
