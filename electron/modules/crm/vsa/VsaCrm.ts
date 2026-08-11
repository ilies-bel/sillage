/**
 * `CrmPort`, implemented against VerySwing. The only file in the tree that both
 * knows VSA exists and is allowed to (DEC-29).
 *
 * Three properties hold this file together, and each of them is a decision from
 * elsewhere rather than a preference:
 *
 *   - **It never throws for a remote failure.** `app/session/Outbox.ts` needs a
 *     settled `PushResult` either way, and `retryable` is the whole of what it
 *     needs to know. A thrown error would take the Outlook draft down with the
 *     CRM, which DEC-26 forbids.
 *   - **It never creates a prospect account.** `POST /v1/prospect` has thirteen
 *     required fields — address, activity, billing tax — and a meeting produces
 *     none of them. The only way to satisfy it is placeholder data that
 *     permanently pollutes the client's CRM of record, so the endpoint is not
 *     called, is not imported, and has no method here. When the company is
 *     genuinely unknown, the task is linked as `FREE` against the prospect
 *     *contact* instead (DEC-18, `docs/reference/vsa-api.md`).
 *   - **It writes no literal it did not read from the tenant.** Task type,
 *     status, priority, sales stage and probability all come from
 *     `referentials.ts` (DEC-24).
 *
 * `fetch` is injectable and `process.env` is never read here — `config.ts` owns
 * that — so the whole adapter runs in a test with no network and no credentials.
 */
import type {
  AccountCandidate,
  AccountQuery,
  ContactDraft,
  ContactRef,
  CrmPort,
} from '../../../core/contracts/crm.ts'
import type { CompteRenduPayload, OpportunityPayload, PushResult } from '../../../core/contracts/push.ts'
import type { DiagRecorder } from '../../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../../core/contracts/diagnostics.ts'
import type { VsaConfig } from './config.ts'
import { Directory, type DirectoryContact } from './directory.ts'
import { EXT_OPPORTUNITY_FIELDS, EXT_TASK_FIELDS } from './ext/index.ts'
import { columnsFor, OPPORTUNITY_FIELDS, TASK_FIELDS, type FieldRow, type VsaScalar } from './fieldMap.ts'
import { VSA_OPERATIONS } from './generated/operations.ts'
import type { CrmTasksPostResponse } from './generated/schemas.ts'
import { VsaError, VsaSession, type FetchLike } from './http.ts'
import { probeVsa, type ProbeReport } from './probe.ts'
import {
  numericCode,
  pick,
  PICK_HINTS,
  ReferentialCache,
  type ReferentialSet,
} from './referentials.ts'
import { normaliseEmail, rankCandidates, siblingCandidates } from './resolve.ts'

export interface VsaCrmOptions {
  config: VsaConfig
  fetch?: FetchLike
  diagnostics?: DiagRecorder
  now?: () => number
  /** Overridable so the referential and directory windows are testable. */
  referentialTtlMs?: number
  directoryTtlMs?: number
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * The id a create returned, from whichever key the endpoint used.
 *
 * `/v1/crm/tasks` documents `{ success, message, id }`; `/v1/opportunity` and
 * `/v1/prospect/{code}/contact` document a 200 with no body schema at all. This
 * is deliberately forgiving on the way in and strict on the way out: no id means
 * `ok: false`, because the outbox stores `remoteId` to guarantee it never
 * re-posts a drained intent, and a blank one would break that guarantee on an
 * endpoint that has no idempotency key.
 */
const idFrom = (body: unknown): string => {
  const record = asRecord(body)
  const nested = asRecord(record.data)
  for (const candidate of [record.id, record.oppyId, nested.id, record.code, nested.code]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate)
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

const failed = (reason: string, retryable: boolean): PushResult => ({
  ok: false,
  // Stamped by `app/session/Outbox.ts`, which owns the intent — the adapter is
  // handed a payload, not a row. Same shape as `MailPort`, for the same reason.
  intentId: '',
  reason,
  retryable,
})

const errorOf = (error: unknown): { reason: string; retryable: boolean } => {
  if (error instanceof VsaError) return { reason: error.message, retryable: error.retryable }
  return { reason: error instanceof Error ? error.message : 'VerySwing indisponible', retryable: false }
}

export class VsaCrm implements CrmPort {
  protected readonly config: VsaConfig
  protected readonly diagnostics: DiagRecorder
  protected readonly session: VsaSession
  protected readonly directory: Directory
  protected readonly referentials: ReferentialCache

  constructor(options: VsaCrmOptions) {
    this.config = options.config
    this.diagnostics = options.diagnostics ?? NULL_RECORDER
    const fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.session = new VsaSession({
      baseUrl: options.config.baseUrl,
      credentials: {
        login: options.config.login,
        password: options.config.password,
        authType: options.config.authType,
      },
      fetch,
    })
    this.directory = new Directory({
      session: this.session,
      ...(options.now ? { now: options.now } : {}),
      ...(options.directoryTtlMs === undefined ? {} : { ttlMs: options.directoryTtlMs }),
      diagnostics: this.diagnostics,
    })
    this.referentials = new ReferentialCache({
      session: this.session,
      ...(options.now ? { now: options.now } : {}),
      ...(options.referentialTtlMs === undefined ? {} : { ttlMs: options.referentialTtlMs }),
      diagnostics: this.diagnostics,
    })
  }

  // ── seams for `ext/` (subclass, don't fork) ───────────────────────────────

  protected taskFields(): readonly FieldRow<CompteRenduPayload>[] {
    return [...TASK_FIELDS, ...EXT_TASK_FIELDS]
  }

  protected opportunityFields(): readonly FieldRow<OpportunityPayload>[] {
    return [...OPPORTUNITY_FIELDS, ...EXT_OPPORTUNITY_FIELDS]
  }

  // ── connect ───────────────────────────────────────────────────────────────

  /**
   * The capability diff (DEC-24). Referentials are loaded first so the probe can
   * tell "the endpoint is missing" from "the list is empty", which need
   * different sentences in Réglages.
   */
  async probe(): Promise<ProbeReport> {
    let referentials: ReferentialSet | null = null
    try {
      referentials = await this.referentials.all()
    } catch {
      referentials = null
    }
    return probeVsa({ session: this.session, referentials })
  }

  /** *Reconnecter* in Réglages: drop the token and both caches. */
  reconnect(): void {
    this.session.forget()
    this.directory.invalidate()
    this.referentials.invalidate()
  }

  // ── resolution ────────────────────────────────────────────────────────────

  /**
   * Suggests. Never decides, never writes (VISION.md §5.1).
   *
   * The exact `?email=` lookups run live and in parallel — they are the first
   * step of the order and the one that defuses a personal address — while
   * everything after them reads the local snapshot.
   */
  async resolveAccount(query: AccountQuery): Promise<AccountCandidate[]> {
    const snapshot = await this.directory.snapshot()
    const own = new Set(this.config.ownEmailDomains)
    const addresses = query.attendeeEmails
      .map(normaliseEmail)
      .filter((email) => email.includes('@'))
      .filter((email) => !own.has(email.slice(email.lastIndexOf('@') + 1)))

    const exact = new Map<string, DirectoryContact[]>()
    await Promise.all(
      addresses.map(async (email) => {
        try {
          exact.set(email, await this.directory.contactsByEmail(email))
        } catch (error) {
          // One address failing must not lose the other three. The candidate
          // list is a suggestion, and a partial one still beats none.
          this.diagnostics.record({
            severity: 'warn',
            code: 'crm.resolve.lookupFailed',
            module: 'crm',
            message: 'recherche de contact par e-mail impossible',
            detail: { reason: error instanceof Error ? error.message : String(error) },
          })
        }
      }),
    )

    const candidates = rankCandidates({
      attendeeEmails: query.attendeeEmails,
      hint: query.hint,
      snapshot,
      exact,
      ownEmailDomains: this.config.ownEmailDomains,
    })

    // DEC-18: a mis-attribution has to be diagnosable afterwards. The signals
    // and the scores are what make it so, which is why they are logged even
    // when the resolution looks obvious.
    this.diagnostics.record({
      severity: 'info',
      code: 'crm.resolve.ranked',
      module: 'crm',
      message: 'comptes candidats classés',
      detail: {
        attendees: addresses.length,
        candidates: candidates.slice(0, 5).map((candidate) => ({
          accountId: candidate.accountId,
          score: candidate.score,
          confidence: candidate.confidence,
          signals: candidate.signals,
        })),
      },
    })

    return candidates
  }

  async listSiblings(parentAccountId: string): Promise<AccountCandidate[]> {
    return siblingCandidates(await this.directory.snapshot(), parentAccountId)
  }

  // ── writes ────────────────────────────────────────────────────────────────

  async pushCompteRendu(payload: CompteRenduPayload): Promise<PushResult> {
    let body: Record<string, unknown>
    try {
      body = await this.taskBody(payload)
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'compte rendu impossible', true)
    }

    try {
      const operation = VSA_OPERATIONS.createTask
      const answer = (await this.session.request({
        operationPath: operation.path,
        method: operation.method,
        body,
      })) as CrmTasksPostResponse
      if (answer?.success === false) {
        // VSA refused the content. Retrying an unchanged body forever is how a
        // queue jams, so this is terminal and the rep gets the message.
        return failed(answer.message ?? 'compte rendu refusé par VerySwing', false)
      }
      const id = idFrom(answer)
      if (!id) {
        // The task probably exists and we cannot name it. Terminal on purpose:
        // `POST /v1/crm/tasks` has no idempotency key, so posting again is a
        // duplicate compte-rendu in the client's CRM.
        return failed('compte rendu créé sans identifiant — à vérifier dans VerySwing', false)
      }
      this.diagnostics.record({
        severity: 'info',
        code: 'crm.task.created',
        module: 'crm',
        message: 'compte rendu poussé dans VerySwing',
        detail: { remoteId: id, linkType: body.linkType ?? null },
      })
      return { ok: true, intentId: '', remoteId: id }
    } catch (error) {
      const { reason, retryable } = errorOf(error)
      this.diagnostics.record({
        severity: 'error',
        code: 'crm.task.failed',
        module: 'crm',
        message: reason,
        detail: { retryable },
      })
      return failed(reason, retryable)
    }
  }

  async pushOpportunity(payload: OpportunityPayload): Promise<PushResult> {
    let body: Record<string, unknown>
    try {
      body = await this.opportunityBody(payload)
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'opportunité impossible', true)
    }

    try {
      const operation = VSA_OPERATIONS.createOpportunity
      const answer = await this.session.request({
        operationPath: operation.path,
        method: operation.method,
        body,
      })
      const id = idFrom(answer)
      if (!id) return failed('opportunité créée sans identifiant — à vérifier dans VerySwing', false)
      this.diagnostics.record({
        severity: 'info',
        code: 'crm.opportunity.created',
        module: 'crm',
        message: 'opportunité poussée dans VerySwing',
        detail: { remoteId: id },
      })
      return { ok: true, intentId: '', remoteId: id }
    } catch (error) {
      const { reason, retryable } = errorOf(error)
      this.diagnostics.record({
        severity: 'error',
        code: 'crm.opportunity.failed',
        module: 'crm',
        message: reason,
        detail: { retryable },
      })
      return failed(reason, retryable)
    }
  }

  /**
   * A contact, **under an existing account only** (DEC-18). `ContactDraft`
   * makes `accountId` non-optional precisely so this method cannot be the thing
   * that creates an account as a side effect.
   */
  async createContact(draft: ContactDraft): Promise<ContactRef> {
    const referentials = await this.referentials.all()
    const status = pick(referentials.prospectStatuses, PICK_HINTS.prospectStatuses)
    if (!status) throw new VsaError({ status: 0, message: 'aucun statut de prospect sur ce tenant', retryable: false })

    const operation = VSA_OPERATIONS.createProspectContact
    const answer = await this.session.request({
      operationPath: operation.path,
      method: operation.method,
      params: { code: draft.accountId },
      body: {
        actionUserId: this.config.actionUserId,
        statusCode: status.code,
        // The account already holds the address; copying one out of a meeting
        // would be inventing it (DEC-7).
        useParentAddr: true,
        lastname: draft.lastName,
        firstname: draft.firstName,
        entities: [this.config.entityId],
        ...(draft.email ? { email: draft.email } : {}),
        ...(draft.job ? { job: draft.job } : {}),
      },
    })

    return {
      contactId: idFrom(answer),
      name: `${draft.firstName} ${draft.lastName}`.trim(),
      email: draft.email,
      accountId: draft.accountId,
    }
  }

  /**
   * The raw transcript, attached to the pushed compte-rendu.
   *
   * Two calls, in this order and no other: the media endpoint takes the bytes
   * and answers with a file id, and the attach endpoint binds that id to the
   * task. Attaching first is not possible, and uploading without attaching
   * leaves an orphan file — so a failure between them is reported as retryable
   * and the second call is never made on its own.
   */
  async attachTranscript(remoteId: string, filename: string, content: string): Promise<PushResult> {
    try {
      const upload = VSA_OPERATIONS.uploadMedia
      const uploaded = await this.session.request({
        operationPath: upload.path,
        method: upload.method,
        raw: {
          contentType: 'application/octet-stream',
          content,
          disposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
        },
      })
      const fileId = idFrom(uploaded)
      if (!fileId) return failed('transcription téléversée sans identifiant de fichier', true)

      const attach = VSA_OPERATIONS.attachToTask
      await this.session.request({
        operationPath: attach.path,
        method: attach.method,
        params: { id: remoteId },
        body: { id: fileId, filename },
      })
      this.diagnostics.record({
        severity: 'info',
        code: 'crm.task.attached',
        module: 'crm',
        message: 'transcription jointe au compte rendu',
        detail: { taskId: remoteId, fileId },
      })
      return { ok: true, intentId: '', remoteId: fileId }
    } catch (error) {
      const { reason, retryable } = errorOf(error)
      return failed(reason, retryable)
    }
  }

  // ── bodies (overridable in `ext/`) ────────────────────────────────────────

  protected async taskBody(payload: CompteRenduPayload): Promise<Record<string, unknown>> {
    const referentials = await this.referentials.all()
    const type = pick(referentials.taskTypes, PICK_HINTS.taskTypes)
    const status = pick(referentials.taskStatuses, PICK_HINTS.taskStatuses)
    const priority = pick(referentials.taskPriorities, PICK_HINTS.taskPriorities)
    if (!type || !status || !priority) {
      // Retryable: an empty referential is usually a transport failure on the
      // referential fetch, and the probe already told Réglages when it is not.
      throw new VsaError({
        status: 0,
        message: 'référentiels VerySwing indisponibles — compte rendu non poussé',
        retryable: true,
      })
    }
    for (const choice of [type, status, priority]) {
      if (choice.why === 'fallback') {
        this.diagnostics.record({
          severity: 'warn',
          code: 'crm.referential.fallback',
          module: 'crm',
          message: `valeur par défaut retenue : « ${choice.label} »`,
          detail: { code: choice.code },
        })
      }
    }

    return {
      actionUserId: this.config.actionUserId,
      statusCode: status.code,
      priorityNumber: numericCode(priority.code),
      taskType: type.code,
      salesUsers: this.config.salesUserIds,
      ...columnsFor(this.taskFields(), payload),
      ...(await this.link(payload)),
    }
  }

  protected async opportunityBody(payload: OpportunityPayload): Promise<Record<string, unknown>> {
    const referentials = await this.referentials.all()
    const stage = pick(referentials.salesStages, PICK_HINTS.salesStages)
    const probability = pick(referentials.successProbabilities, PICK_HINTS.successProbabilities)
    if (!stage || !probability) {
      throw new VsaError({
        status: 0,
        message: 'référentiels VerySwing indisponibles — opportunité non poussée',
        retryable: true,
      })
    }

    return {
      entity: this.config.entityCode,
      accountType: await this.accountType(payload.accountId),
      accountCode: payload.accountId,
      sales: this.config.salesLogin,
      salesStage: stage.code,
      probability: probability.code,
      ...columnsFor(this.opportunityFields(), payload),
    }
  }

  /** `CUSTOMER` or `PROSPECT`, read from the directory rather than assumed. */
  protected async accountType(accountId: string): Promise<string> {
    const snapshot = await this.directory.snapshot()
    const account = snapshot.accounts.find((entry) => entry.accountId === accountId)
    return account?.kind === 'customer' ? 'CUSTOMER' : 'PROSPECT'
  }

  /**
   * How the task hangs off the rest of the CRM — the one place `linkType` is
   * decided, and the reason no prospect account is ever created.
   *
   * In order:
   *
   *   - an opportunity was pushed first → `OPPY`, the task carries its id. The
   *     outbox guarantees that order (`dependsOn`), which is why this branch can
   *     trust `opportunityRef`.
   *   - an account resolved → `COMPANY`, with the known contacts attached to
   *     whichever of the two contact arrays matches the account's kind.
   *   - **neither** → `FREE` against a prospect *contact*. This is DEC-18's
   *     revision in one line: the meeting still lands somewhere retrievable,
   *     and no account is invented to hold it.
   *   - not even a contact → no link at all. The compte-rendu is created
   *     unlinked rather than lost, and a diagnostic says so. Nothing downstream
   *     may stop a meeting being recorded, and nothing here may lose one.
   */
  protected async link(payload: CompteRenduPayload): Promise<Record<string, VsaScalar | number[]>> {
    if (payload.opportunityRef) {
      return { linkType: 'OPPY', oppyId: payload.opportunityRef }
    }

    // `Number.isFinite` is not the filter this needs. `Number('')` is 0, and a
    // blank id is exactly what `createContact` returns when VSA answers 200 with
    // no body — which its own 200 is documented to allow. Zero would then be
    // posted as `contactsProspectsIds: [0]`: a link to a contact that does not
    // exist, on an endpoint with no idempotency key. Refused or mis-attached,
    // both are worse than an unlinked compte-rendu.
    const contactIds = payload.contactIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)

    if (payload.accountId) {
      const kind = await this.accountType(payload.accountId)
      return {
        linkType: 'COMPANY',
        tiersCode: payload.accountId,
        ...(contactIds.length === 0
          ? {}
          : kind === 'CUSTOMER'
            ? { contactsIds: contactIds }
            : { contactsProspectsIds: contactIds }),
      }
    }

    const free = contactIds[0]
    if (free !== undefined) {
      this.diagnostics.record({
        severity: 'info',
        code: 'crm.task.freeLink',
        module: 'crm',
        message: 'aucun compte résolu — compte rendu rattaché au contact libre',
        detail: { contactId: free },
      })
      return { linkType: 'FREE', freeProspectId: free }
    }

    this.diagnostics.record({
      severity: 'warn',
      code: 'crm.task.unlinked',
      module: 'crm',
      message: 'compte rendu créé sans rattachement — ni compte ni contact connus',
      detail: {},
    })
    return {}
  }
}
