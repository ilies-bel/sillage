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
 * ## Where the sentence lives (US-19, shipped)
 *
 * Not here. DEC-34 says every setting a deployment needs is declared, stored and
 * rendered, and the ESN's legal wording is theirs rather than ours — so the default
 * and the « a blank means the default » rule are in `core/contracts/mention.ts`,
 * Réglages edits it, and `widget:state` hands the resolved string to this window.
 * What stays here is what the *product* says about the press, which is not
 * configurable: a configurable sentence must not become a configurable claim.
 */

/*
 * **The sentence itself is not here** (US-19).
 *
 * It was, for one commit. The wording a rep reads to a client is a legal matter and
 * belongs to the ESN, so it is a declared, stored, rendered setting like every other
 * deployment setting (DEC-34) — `electron/core/contracts/mention.ts` holds the default
 * and the one function that decides what a blank value means, Réglages edits it, and
 * `widget:state` carries the resolved string to this window on every answer.
 *
 * There is deliberately **no fallback in this file**. A default written in two places
 * is a default that will stop agreeing with itself, and the one the pill hands to a
 * client is the wrong one to have a second copy of. The control is drawn on the same
 * answer that brings the sentence, so it cannot exist without one.
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
