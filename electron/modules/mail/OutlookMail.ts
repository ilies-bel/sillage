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
    const token = await this.#token()

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
      const reason = error instanceof Error ? error.message : 'brouillon Outlook impossible'
      this.#diagnostics.record({
        severity: 'error',
        code: 'mail.draft.failed',
        module: 'mail',
        message: reason,
        detail: { retryable },
      })
      return { ok: false, intentId: '', reason, retryable }
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
