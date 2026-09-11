/**
 * The follow-up draft (HR-8, VISION.md §6.4).
 *
 * `POST /me/messages` creates a message in the rep's own Drafts folder. It
 * appears in Outlook, the rep reads it, edits it, and presses the button
 * themselves. **This module has no way to deliver mail**, and that is a
 * structural property rather than a habit:
 *
 *   - `graph.ts` exposes one URL builder, taking no arguments, so there is no
 *     path this file can steer somewhere else;
 *   - `MAIL_SCOPES` runs through `rejectedScopes()` in the constructor *and*
 *     again before every token request, so a delivery scope cannot arrive by
 *     way of a copied snippet or a mutated array;
 *   - nothing here names the calendar's own resource. Writing an Outlook event
 *     body mails the attendees and destroys the Teams join blob (DEC-10).
 *
 * `modules/mail/__tests__/mail.test.ts` reads this folder's own source and
 * fails if any of that stops being true.
 */
import type { MailDraftPayload, PushResult } from '../../core/contracts/push.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { IdentityPort } from '../../core/contracts/identity.ts'
import { rejectedScopes } from '../../core/contracts/identity.ts'
import { ForbiddenScopeError, GraphError, postDraft, type FetchLike } from './graph.ts'

/**
 * Read-write on the rep's own mailbox, and nothing beyond it. Deliberately a
 * one-element list: every entry here is a permission a rep is asked to grant.
 */
export const MAIL_SCOPES: readonly string[] = ['Mail.ReadWrite']

/**
 * The port `app/` drains through. Domain verb only — one way to create a
 * draft, and no second method for anything else.
 *
 * `PushResult.intentId` comes back empty: the adapter is handed a payload, not
 * an outbox row, and it is `app/session/Outbox.ts` that stamps the intent id
 * onto the settled result. Same shape as `CrmPort`, for the same reason.
 */
export interface MailPort {
  createDraft(payload: MailDraftPayload): Promise<PushResult>
}

export interface OutlookMailOptions {
  identity: IdentityPort
  fetch?: FetchLike
  diagnostics?: DiagRecorder
  /**
   * Overridable so the guard is testable. Every value still passes through
   * `rejectedScopes()`; widening this cannot widen what the app may do.
   */
  scopes?: readonly string[]
}

/** The Graph message body. Plain text, so nothing in the compte-rendu is interpreted as markup. */
const messageBody = (payload: MailDraftPayload): Record<string, unknown> => ({
  subject: payload.subject,
  body: { contentType: 'Text', content: payload.body },
  toRecipients: payload.to.map((address) => ({ emailAddress: { address } })),
})

export class OutlookMail implements MailPort {
  #identity: IdentityPort
  #fetch: FetchLike
  #diagnostics: DiagRecorder
  #scopes: readonly string[]

  constructor(options: OutlookMailOptions) {
    this.#identity = options.identity
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#scopes = options.scopes ?? MAIL_SCOPES
    // Fail at construction, where the stack points at the wiring that asked for
    // it. The same check runs again per request — see `#token()`.
    this.#guardScopes()
  }

  /**
   * Creates the draft. Never throws for a Graph failure: the outbox needs a
   * settled result either way, and `retryable` is the whole of what it needs to
   * know. A forbidden scope is the one exception — it is a bug, not an outage.
   */
  async createDraft(payload: MailDraftPayload): Promise<PushResult> {
    /*
     * **The token, in its own block, and it used to have none at all.**
     *
     * The docstring above says « never throws for a Graph failure », and the one
     * call that reliably *does* throw sat above the `try` enforcing it:
     * `MsalIdentity` raises `InteractionRequiredError` for a token needing a
     * fresh sign-in — an expired refresh, a revoked consent, a laptop offline
     * long enough. The throw escaped to `Outbox.#attempt`, which cannot tell a
     * fault from a decision, so the intent was recorded **`failed`**.
     *
     * `failed` is the one terminal state here: `drainable()` selects `pending`,
     * the row deliberately has no *Réessayer* (the attempt threw, nobody knows
     * whether the record exists), and a boot-time re-drain skips it. A rep who
     * validated on a train lost the follow-up draft permanently.
     *
     * Its own block rather than a wider `catch`, because the distinction is the
     * whole of DEC-26's rule and the wider version would erase it. A failure
     * *here* is a failure **before the request was ever sent** — nothing was
     * created, and `retryable: true` is a fact rather than a hope. A failure
     * below, mid-POST, is the genuinely unknown case, and that one stays
     * terminal: retrying a create whose answer was lost is how a mailbox gets
     * two identical drafts.
     */
    let token: string
    try {
      token = await this.#token()
    } catch (error) {
      /*
       * A forbidden scope in the list is the one exception, and it throws on
       * through: HR-8 says this product creates drafts and never sends, so one
       * reaching `#guardScopes` is a **bug in the code that built this adapter**, not an
       * outage a rep can wait out. Turning it into a retryable push result would
       * bury the one failure here nobody should ever be asked to tolerate.
       */
      if (error instanceof ForbiddenScopeError) throw error
      const reason = error instanceof Error ? error.message : 'jeton Microsoft indisponible'
      this.#diagnostics.record({
        severity: 'warn',
        code: 'mail.token.unavailable',
        module: 'mail',
        message: reason,
        detail: { retryable: true },
      })
      return { ok: false, intentId: '', reason, retryable: true }
    }

    try {
      const created = await postDraft({ token, fetch: this.#fetch, body: messageBody(payload) })
      const id = typeof created?.id === 'string' ? created.id : ''
      if (!id) {
        // The draft probably exists and we cannot name it. Terminal on purpose:
        // posting again would leave two drafts in the rep's mailbox.
        return {
          ok: false,
          intentId: '',
          reason: 'brouillon créé sans identifiant — à vérifier dans Outlook',
          retryable: false,
        }
      }
      this.#diagnostics.record({
        severity: 'info',
        code: 'mail.draft.created',
        module: 'mail',
        message: 'brouillon de relance créé',
        detail: { recipients: payload.to.length },
      })
      return { ok: true, intentId: '', remoteId: id }
    } catch (error) {
      const retryable = error instanceof GraphError ? error.retryable : false
      const retryAfterMs = error instanceof GraphError ? error.retryAfterMs : null
      const reason = error instanceof Error ? error.message : 'brouillon Outlook impossible'
      this.#diagnostics.record({
        severity: 'error',
        code: 'mail.draft.failed',
        module: 'mail',
        message: reason,
        detail: { retryable },
      })
      return { ok: false, intentId: '', reason, retryable, retryAfterMs }
    }
  }

  async #token(): Promise<string> {
    // Re-checked per request rather than trusted from the constructor: the
    // array is `readonly` to the type system and an ordinary array at runtime.
    this.#guardScopes()
    return this.#identity.token(this.#scopes)
  }

  #guardScopes(): void {
    const rejected = rejectedScopes(this.#scopes)
    if (rejected.length > 0) throw new ForbiddenScopeError(rejected)
  }
}
