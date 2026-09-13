/**
 * `MailPort` — the port `app/` drains the follow-up draft through. Domain verb
 * only: one way to create a draft, and no second method for anything else
 * (HR-8 — `Mail.ReadWrite`, never `Mail.Send`).
 *
 * `PushResult.intentId` comes back empty: the adapter is handed a payload, not
 * an outbox row, and it is `app/session/Outbox.ts` that stamps the intent id
 * onto the settled result. Same shape as `CrmPort`, for the same reason.
 *
 * **It is declared here, beside `CrmPort`, and not in `modules/mail`, because a
 * port declared inside the module that implements it is invisible to
 * `check-ports.mjs`** — which is where the guarantee « no declared verb without
 * a caller » comes from. `check-ports.mjs`'s own docblock named this port as the
 * one exception and called both remedies « larger than this file »; the cost of
 * leaving it was measured instead: a dead `sendNow()` added to `MailPort` and
 * implemented on `OutlookMail` passed `check:ports` (« 27 méthodes vérifiées »,
 * exit 0), `npm run check` and `npm test`, on the port whose own docblock argues
 * that it « has no second verb to grow into a way of sending ». The prose was
 * the only thing holding HR-8 up on this interface; now the check is.
 */
import type { MailDraftPayload, PushResult } from './push.ts'

export interface MailPort {
  createDraft(payload: MailDraftPayload): Promise<PushResult>
}
