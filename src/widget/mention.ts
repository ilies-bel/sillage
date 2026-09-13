/**
 * **What the rep says to the client, and what the log says about it** (US-11).
 *
 * Granola ships a consent *subsystem* for this: a native messaging host
 * installed into the browser on both platforms, a named pipe or unix socket per
 * user, a browser extension, and a `coordinated-consent-send` that posts a
 * message into the meeting chat and arbitrates so that two attendees both
 * running it do not post twice. DEC-49 says this product never joins the call,
 * so none of that is available here and none of it is wanted.
 *
 * What is left is the part that was always the point: the rep telling the person
 * on the other end. The widget hands them the sentence — one press, on the
 * clipboard, on screen to read out — and writes down that it did.
 *
 * ## Four things this file is careful about
 *
 * **It never claims consent was obtained.** The product cannot know what the
 * client said, or whether the rep said anything at all; it knows that it put the
 * sentence in front of them. So every string here is about the *sentence*, never
 * about the client's answer, and `MENTION_NOTE` is the strongest claim available:
 * « copiée ».
 *
 * **It is not a gate.** Nothing imports this to decide whether a meeting may
 * record. Refusing to record a call because a sentence was not copied is not this
 * product's call to make, and a rep who never presses the control records exactly
 * as before.
 *
 * **It sends nothing.** There is no transport here — no chat, no mail, no write
 * to the Outlook event body (DEC-10, which mails every attendee and destroys the
 * Teams join blob). The clipboard is the whole mechanism, and the rep stays the
 * one who speaks.
 *
 * **The sentence is true of this product.** « l’audio n’est pas conservé » is
 * DEC-12, not a reassurance; « dites-moi si vous préférez que je l’arrête » is
 * reachable — *Terminer* is on the same pill, two presses away — so it is an
 * offer and not a dead one (DEC-26).
 *
 * ## Where this will live once Réglages can hold it
 *
 * DEC-34 says no environment variable is required to run this app and every
 * provider setting is a declared, stored, rendered field. The sentence belongs
 * in that set: the ESN's legal wording is theirs, not ours. Réglages is another
 * lane and `core/contracts/` belongs to the coordinator, so today the default is
 * declared here, once, and read by one surface. The setting to route is named in
 * the report; nothing in this file has to change shape to accept it, because the
 * widget already reads the sentence through a single import.
 */

/**
 * The sentence, in French, with the typographic apostrophe (U+2019) the rest of
 * this product uses — `check:french` enforces it, and *Historique*'s search
 * folding exists because everything stored here carries it.
 *
 * What each clause is doing, because a sentence a rep reads out to a client is
 * not a place for a word that cannot be defended:
 *
 *  · « j’utilise un outil » — the rep is the one speaking, and the tool is a tool.
 *    Not « Sillage », which means nothing to the person on the call.
 *  · « qui transcrit cet échange » — what actually happens. Not « enregistre »:
 *    the audio is transcribed and discarded (DEC-12), and a client told they are
 *    being *recorded* has been told something this product does not do.
 *  · « pour en rédiger le compte-rendu » — the purpose, which is the question
 *    anyone asks next.
 *  · « l’audio n’est pas conservé » — DEC-12 again, said plainly, because it is
 *    the one fact that changes how the answer feels.
 *  · « dites-moi si vous préférez que je l’arrête » — an offer the rep can
 *    honour: *Terminer* is on this same pill.
 *
 * It claims nothing about the client's answer, and there is deliberately no
 * second string for « the client agreed »: the product has no way to know that
 * and must not carry a field that invites somebody to assert it.
 */
export const MENTION_SENTENCE =
  'Je vous informe que j’utilise un outil qui transcrit cet échange pour en rédiger le ' +
  'compte-rendu ; l’audio n’est pas conservé. Dites-moi si vous préférez que je l’arrête.'

/**
 * What goes in the log, and it is deliberately the weaker of the two claims the
 * press could make.
 *
 * « did I tell them » is a question a rep gets asked months later, and the log is
 * where the answer lives — which is why the press is written down at all. What is
 * written down is what happened *here*: the sentence was handed to the rep. Not
 * that it was said, not that it was read, and certainly not that anybody agreed.
 *
 * Two variants because the clipboard can refuse — a renderer with no
 * `navigator.clipboard`, a browser that will not write to it without focus, and
 * this window is shown with `showInactive()` and is never focused by the app. A
 * single « copiée » would then be a false sentence in the one record that exists
 * to be trusted, so the honest weaker fact is stored instead.
 */
export const MENTION_NOTE = (copied: boolean): string =>
  copied
    ? 'Phrase d’information sur la transcription copiée.'
    : 'Phrase d’information sur la transcription affichée.'

/** The pill's control, named for a screen reader. */
export const MENTION_LABEL = 'Prévenir le client de la transcription'

/**
 * What the card says under the sentence, which is a statement about the
 * *clipboard* and never about the client.
 *
 * The refusal branch is not an error message: reading the sentence out loud is
 * the route the story describes first — « or reads it out, which is what a rep
 * does anyway » — so a clipboard that will not take it costs the rep nothing they
 * were not going to do. It is `caution` rather than silence because the paste
 * they were about to attempt will not work (DEC-26: a stated degradation).
 */
export const MENTION_COPY_STATE = (copied: boolean): string =>
  copied
    ? 'Copiée : collez-la dans la conversation, ou lisez-la à voix haute.'
    : 'Copie impossible : lisez-la à voix haute.'

/** Why the log refused, framed as what the rep has lost. */
export const MENTION_NOT_LOGGED = 'Non inscrit au journal de la réunion.'
