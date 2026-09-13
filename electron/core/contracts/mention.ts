/**
 * **The sentence the rep says to the client, and who owns the words** (US-11, US-19).
 *
 * US-11 put it on the pill: one press, on the clipboard, drawn so the rep can read
 * it out. It shipped as a constant inside `src/widget/mention.ts`, and that was the
 * wrong home for exactly one reason — **the wording is a legal matter and it
 * belongs to the ESN, not to us.** DEC-34 says no environment variable is required
 * to run this app and every setting a deployment needs is declared, stored in the
 * KV store and rendered as a field; a sentence hard-coded in the renderer is the
 * same mistake `SILLAGE_STT_OFFLINE_ONLY` was, and DEC-37 has already paid for that
 * one once.
 *
 * It lives in `contracts` because three surfaces now read it and `src/*` may import
 * nothing else: Réglages edits it, `widget:state` carries it — the widget does not
 * call `settings:snapshot`, and asking it to would be a second round trip on the
 * critical path the window is held off screen for (`MEASURE_DEADLINE_MS`) — and the
 * pill draws it.
 *
 * ## What is configurable and what is not
 *
 * **The sentence is.** It is free text, and this file does not try to police it: the
 * repo's own verdict on free-form text is written in `check:diag`'s prose — « a
 * denylist over free-form text cannot be made safe, only made narrower ». An ESN
 * that writes something this product does not do has written something false, and no
 * rule short of refusing the feature changes that. What is defensible is that the
 * default is true of the product (see `MENTION_SENTENCE_DEFAULT`) and that changing
 * it is a deliberate act in a pane, by somebody who works there.
 *
 * **What the log says is not.** `MENTION_NOTE` stays the product's own words and
 * claims only that the sentence was handed to the rep — never that it was said, and
 * never that anybody agreed. A configurable sentence must not become a configurable
 * *claim*.
 *
 * **Argued debt, stated rather than hidden:** the log row does not quote the
 * sentence, so a deployment that rewords it in March cannot tell from a January row
 * which words were copied. Quoting 168 characters into the rep's own mark list would
 * bury their notes at the gate and in *Historique*, and the row answers « did I tell
 * them », which is the question that gets asked. « What exactly did I say » is a
 * different record — a `mention.offered` event carrying the sentence — and that is a
 * decision, not a default.
 */

/**
 * The default, in French, with the typographic apostrophe (U+2019) `check:french`
 * enforces and *Historique*'s search folding exists for.
 *
 * Every clause is defensible against the shipped product, which is what makes it a
 * safe default for a deployment that never opens Réglages:
 *
 *  · « j’utilise un outil » — the rep is speaking, and the tool is a tool. Not
 *    « Sillage », which means nothing to the person on the call.
 *  · « qui transcrit cet échange » — what happens. Not « enregistre »: the audio is
 *    transcribed and discarded (DEC-12), and a client told they are being *recorded*
 *    has been told something this product does not do.
 *  · « pour en rédiger le compte-rendu » — the purpose, which is the next question.
 *  · « l’audio n’est pas conservé » — DEC-12, said plainly.
 *  · « dites-moi si vous préférez que je l’arrête » — an offer the rep can honour:
 *    *Terminer* is on the same pill (DEC-26 forbids the other kind).
 */
export const MENTION_SENTENCE_DEFAULT =
  'Je vous informe que j’utilise un outil qui transcrit cet échange pour en rédiger le ' +
  'compte-rendu ; l’audio n’est pas conservé. Dites-moi si vous préférez que je l’arrête.'

/**
 * The ceiling, and it is about a window rather than about a database.
 *
 * The card is drawn inside the overlay, which is **sized to its own content**
 * (`widget:resize`) and is frameless, transparent and always on top over the face of
 * the person on the call. So the length of this string is the height of a card the
 * rep cannot alt-tab away from: the default is 168 characters and 145 pixels. Four
 * hundred is about two and a half of those and still leaves the pill reachable at
 * 960×600, which is the width `main.ts` declares as the minimum.
 *
 * It is enforced in the setter's own schema and stated on the field, never applied by
 * truncation — a sentence silently cut in half is a sentence the rep reads out to a
 * client with the end missing.
 */
export const MENTION_MAX_CHARS = 400

/**
 * What the product actually uses, given what is stored.
 *
 * One function, because three places need the same answer and « blank means the
 * default » is the sort of rule that gets written twice and then disagrees. A blank
 * setting is not an instruction to say nothing: a control that copies emptiness is
 * the dead control DEC-26 forbids, and the rep pressing it would get a card with no
 * sentence on it. Whitespace counts as blank for the same reason — a textarea a
 * finger landed in is not a deployment decision.
 *
 * Trimmed on the way out as well, so a sentence pasted out of a Word document does
 * not arrive on the clipboard with a leading newline.
 */
export const resolveMentionSentence = (stored: string | null | undefined): string => {
  const trimmed = (stored ?? '').trim()
  return trimmed.length === 0 ? MENTION_SENTENCE_DEFAULT : trimmed
}
