/**
 * **A refusal is not a failure, and the log has to be able to tell them apart.**
 *
 * DEC-26 says a control that cannot work states why, inline, in French — so the
 * app is full of sentences composed *on purpose* for a rep to read: « La réunion
 * est en cours — les questions attendent la fin de l'appel. », « Aucune
 * transcription n'a été enregistrée pour cet appel. », « Le coffre-fort n'est pas
 * disponible sur cette machine ». Each of those crosses the IPC boundary as a
 * thrown `Error`, because that is how a promise says no.
 *
 * And `register.ts` logged every rejection at `error` severity. So a rep asking a
 * question about a call nobody spoke on wrote a red line into the diagnostics
 * bundle, beside the lines that mean the native module would not load. On a
 * support call the bundle is the evidence, and a bundle where the product working
 * correctly and the product broken look identical is a bundle nobody can read —
 * which is the whole of DEC-27's cost with none of its benefit. The end-to-end
 * run found two on a clean first launch, both of them the app behaving exactly
 * as designed.
 *
 * So the distinction is a *type* rather than a convention: a handler that means
 * « I am telling the rep something » throws this, and one that means « something
 * went wrong » throws anything else. Nothing about the renderer changes — it
 * reads `error.message` either way, which is the point: the sentence is the same
 * sentence, and only the log learns the difference.
 *
 * It is in `contracts` because both `app/` and the renderer's type-checking see
 * it, and because it is part of what an IPC channel can answer.
 */

/**
 * A stated reason, thrown. The message is French and is read by a rep.
 *
 * `instanceof` is unreliable across a bundling boundary — esbuild can produce
 * two copies of a class and `err instanceof Refusal` then silently answers no,
 * which would turn every refusal back into an `error` without a test noticing.
 * The brand is what is actually checked; the class is the ergonomic half.
 */
export class Refusal extends Error {
  /** The brand `isRefusal` reads. Present on the instance, not the prototype. */
  readonly refusal = true as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'Refusal'
  }
}

/** Whether a thrown value is a stated reason rather than a fault. */
export const isRefusal = (error: unknown): error is Refusal =>
  typeof error === 'object' &&
  error !== null &&
  (error as { refusal?: unknown }).refusal === true

/** `throw refuse('…')` — shorter at the call site, where there are thirty. */
export const refuse = (message: string, options?: { cause?: unknown }): Refusal =>
  new Refusal(message, options)
