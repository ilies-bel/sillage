/**
 * **What became of one push, in one vocabulary, agreeing with the noun it is
 * printed beside.**
 *
 * Two screens one click apart named the same five outbox states, in two tables
 * neither of which knew the gender of the noun it was about. Measured on the
 * shipped surfaces, three intents all `drained`:
 *
 *     Historique, la ligne     tâche envoyée · opportunité envoyée · mail envoyée
 *     Historique, « Envois »   Tâche compte-rendu (VerySwing) envoyé
 *                              Opportunité (VerySwing) envoyé
 *                              Brouillon de relance (Outlook) envoyé
 *
 * Four of those six rows disagree with their own subject, and they disagree in
 * opposite directions: the row summary was feminine for everything, so « mail
 * envoyée »; the ledger was masculine for everything, so « Tâche … envoyé » and
 * « Opportunité … envoyé ». A participle cannot be a constant in French, and
 * both tables had written one down as one.
 *
 * The other three states differed too, with no defect behind the difference and
 * no way for a rep to know the two screens meant the same thing: `blocked` was
 * « en attente » on the row and « en attente d'un autre envoi » in the ledger,
 * `draining` « envoi… » and « envoi en cours », `failed` « en échec » and
 * « échec ». The ledger's `blocked` is the one that says what the state means —
 * a dependency that has not settled *yet*, never one that failed — so it is the
 * one kept, and the row's `failed` likewise, because `counted()` two files away
 * already says « 1 envoi en échec » and a third spelling of the state a rep
 * scans for is a third thing to reconcile. `draining` is neither of the two:
 * both were written to follow the row's bare noun (« tâche envoi en cours »),
 * and the ledger prints the gate's full label in front of it — « Tâche
 * compte-rendu (VerySwing) envoi en cours » is two nouns in a row. « en cours
 * d'envoi » is the same fact as a complement, so it reads after either.
 *
 * **One gender table serves both surfaces**, which is not a coincidence worth
 * relying on silently: the short noun and the gate's label happen to agree per
 * kind — « tâche » beside « Tâche compte-rendu », « opportunité » beside
 * « Opportunité », « mail » beside « Brouillon de relance » — and
 * `pushWords.test.tsx` drives both shipped
 * surfaces and asserts they print the same word, so the day a label is reworded
 * into the other gender the test says so rather than the rep.
 */
import type { PushIntentKind, OutboxState } from '../../../electron/core/contracts/push.ts'

/**
 * The rep's words, not the CRM's.
 *
 * This said « oppy » — not an abbreviation anybody speaks, but the spelling the
 * VerySwing schema uses for its opportunity column, worn as a French label. The
 * CRM boundary (DEC-29) exists so that vocabulary stops inside the adapter, and
 * a renderer that contracts a domain noun into the adapter's spelling walks it
 * straight back out — `check-crm-containment.mjs` fails on exactly that.
 * « opportunité » is the word the review gate already uses for the same thing,
 * and a row that named it differently would make the rep check which one to
 * believe.
 */
export const INTENT_SHORT: Record<PushIntentKind, string> = {
  'crm.task': 'tâche',
  'crm.opportunity': 'opportunité',
  'mail.draft': 'mail',
}

/**
 * The gender of the thing each push creates, for the one state word that
 * inflects.
 *
 * Declared per kind rather than derived from the string: there is no rule that
 * reads a gender off a French noun, and a heuristic over final letters would
 * get *mail* wrong in exactly the case that shipped wrong.
 */
const FEMININE: Record<PushIntentKind, boolean> = {
  'crm.task': true,
  'crm.opportunity': true,
  'mail.draft': false,
}

/*
 * `…` is not available as a state mark, whatever it means.
 *
 * It read as a truncation: « opportunité… » beside « tâche✓ » is exactly what a
 * clipped label looks like, so a rep could not tell a push still in flight from
 * a word the column had run out of room for — and on the one surface whose job
 * is to say whether the CRM actually received something, those two readings
 * have opposite consequences.
 *
 * Words, and no glyph key to learn. This was `✓ / ↻ / ⚠` — three symbols with
 * no legend anywhere in the product, on the one column that says whether the
 * client's CRM actually received anything. `✓` is guessable; `↻` is not. A rep
 * should not have to learn a private alphabet to find out that a push failed.
 */
const INVARIABLE: Record<Exclude<OutboxState, 'drained'>, string> = {
  pending: 'en attente',
  blocked: 'en attente d’un autre envoi',
  draining: 'en cours d’envoi',
  failed: 'en échec',
}

/** What became of this push, agreeing with what it was going to create. */
export const pushWord = (state: OutboxState, kind: PushIntentKind): string =>
  state === 'drained' ? (FEMININE[kind] ? 'envoyée' : 'envoyé') : INVARIABLE[state]

/**
 * Which application a rep has to open to find out what really happened.
 *
 * Read off the intent's own `kind`, never off the screen that is drawing it:
 * « À vérifier dans VerySwing » under a failed *Outlook* draft sends the rep to
 * the wrong application, and two surfaces now say this — *Historique*'s row and
 * the session screen's notice.
 */
export const WHERE_TO_LOOK: Record<PushIntentKind, string> = {
  'crm.task': 'VerySwing',
  'crm.opportunity': 'VerySwing',
  'mail.draft': 'Outlook',
}

/**
 * The applications a set of pushes touched, named once each, in the order the
 * gate drafts them.
 *
 * « VerySwing et Outlook » and not « VerySwing, VerySwing et Outlook »: the task
 * and the opportunity are the same application and a rep opens it once.
 */
export const applicationsFor = (kinds: readonly PushIntentKind[]): string[] => [
  ...new Set(kinds.map((kind) => WHERE_TO_LOOK[kind])),
]
