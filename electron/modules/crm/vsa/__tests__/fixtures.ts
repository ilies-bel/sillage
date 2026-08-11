/**
 * Sandbox-shaped JSON for the CRM tests, and the readers that pick a request
 * body apart again.
 *
 * **This file lives here rather than next to the tests for one reason**: the
 * tests are in `modules/crm/__tests__/`, and `scripts/check-crm-containment.mjs`
 * fails the build on a VerySwing column name anywhere outside
 * `modules/crm/vsa/`. A fixture is made of column names. So the fixtures live
 * inside the boundary and the tests import them — which is the same rule the
 * product code obeys, applied to the tests rather than exempted for them.
 *
 * Not a test file itself (`scripts/run-tests.mjs` only collects `*.test.ts`),
 * and never imported by anything that ships.
 */
import type {
  Customer,
  CrmTasksPriority,
  CrmTasksStatus,
  OppyProbability,
  OppySalesStage,
  ProspectAccountList,
  ProspectContactList,
  ProspectStatus,
  TaskTypes,
} from '../generated/schemas.ts'

// ── rows as VSA returns them ───────────────────────────────────────────────

export const customerRow = (input: {
  code: string
  name: string
  parent?: string
  display?: string
}): Customer => ({
  tiersCode: input.code,
  name: input.name,
  codeDisplay: input.display ?? input.code,
  ...(input.parent === undefined ? {} : { parentTiersCode: input.parent }),
})

export const prospectRow = (input: {
  code: string
  name: string
  parent?: string
  display?: string
}): ProspectAccountList => ({
  code: input.code,
  name: input.name,
  codeDisplay: input.display ?? input.code,
  ...(input.parent === undefined ? {} : { parentCode: input.parent }),
})

export const prospectContactRow = (input: {
  id: number
  firstname: string
  lastname: string
  email?: string
  account?: string
}): ProspectContactList => ({
  prospectId: input.id,
  firstname: input.firstname,
  lastname: input.lastname,
  ...(input.email === undefined ? {} : { email: input.email }),
  ...(input.account === undefined ? {} : { parentTiersCode: input.account }),
})

export const taskTypeRow = (code: string, description: string, active = true): TaskTypes => ({
  typeCode: code,
  description,
  active,
})

export const taskStatusRow = (code: string, description: string, active = true): CrmTasksStatus => ({
  statusCode: code,
  description,
  active,
})

/**
 * Note the type: the referential returns `priorityNumber` as a **string** while
 * the task body wants an **integer**. That asymmetry is in the spec, and
 * `numericCode()` is what bridges it — the fixture keeps the spec's shape so the
 * bridge is actually exercised.
 */
export const taskPriorityRow = (number: number, description: string): CrmTasksPriority => ({
  priorityNumber: String(number),
  description,
})

export const salesStageRow = (code: string, description: string): OppySalesStage => ({
  salesStageCode: code,
  description,
})

export const probabilityRow = (code: string, description: string): OppyProbability => ({
  probabilityCode: code,
  description,
})

export const prospectStatusRow = (code: string, description: string): ProspectStatus => ({
  code,
  description,
})

/** The six referential lists a tenant that is fully set up would return. */
export const REFERENTIAL_BODIES: Record<string, unknown> = {
  '/v1/crm/task/types': [taskTypeRow('RDV', 'Compte rendu de rendez-vous'), taskTypeRow('MAIL', 'E-mail')],
  '/v1/crm/task/status': [taskStatusRow('OPEN', 'À faire'), taskStatusRow('DONE', 'Terminé')],
  '/v1/crm/task/priorities': [taskPriorityRow(1, 'Haute'), taskPriorityRow(2, 'Normale')],
  '/v1/opportunity/sales/stages': [salesStageRow('QUAL', 'Qualification'), salesStageRow('NEGO', 'Négociation')],
  '/v1/opportunity/success/probabilities': [probabilityRow('P25', '25 %'), probabilityRow('P50', '50 %')],
  '/v1/prospect/status': [prospectStatusRow('ACT', 'Actif')],
}

// ── readers, so an assertion never has to spell a column ────────────────────

/** What a posted task links to, in domain words. */
export interface PostedLink {
  type: string | null
  accountId: string | null
  opportunityId: string | null
  freeContactId: number | null
  customerContactIds: number[]
  prospectContactIds: number[]
}

export const linkOf = (body: Record<string, unknown>): PostedLink => ({
  type: typeof body.linkType === 'string' ? body.linkType : null,
  accountId: typeof body.tiersCode === 'string' ? body.tiersCode : null,
  opportunityId: typeof body.oppyId === 'string' ? body.oppyId : null,
  freeContactId: typeof body.freeProspectId === 'number' ? body.freeProspectId : null,
  customerContactIds: Array.isArray(body.contactsIds) ? (body.contactsIds as number[]) : [],
  prospectContactIds: Array.isArray(body.contactsProspectsIds) ? (body.contactsProspectsIds as number[]) : [],
})

/** The compte-rendu's own fields, in domain words. */
export const taskOf = (body: Record<string, unknown>) => ({
  name: body.taskName,
  description: body.taskDescription,
  type: body.taskType,
  status: body.statusCode,
  priority: body.priorityNumber,
  actionUser: body.actionUserId,
  salesUsers: body.salesUsers,
  startsAt: body.deadlineDate,
  endsAt: body.endDate,
})

export const opportunityOf = (body: Record<string, unknown>) => ({
  entity: body.entity,
  accountType: body.accountType,
  accountCode: body.accountCode,
  sales: body.sales,
  stage: body.salesStage,
  probability: body.probability,
  title: body.title,
  description: body.description,
  context: body.contextDescription,
  stack: body.technicalEnvDescription,
  profiles: body.profileDescription,
  amount: body.amount,
  currency: body.currency,
  closingDate: body.closingDate,
  startingDate: body.startingDate,
})

export const contactOf = (body: Record<string, unknown>) => ({
  actionUser: body.actionUserId,
  status: body.statusCode,
  useParentAddress: body.useParentAddr,
  lastName: body.lastname,
  firstName: body.firstname,
  email: body.email,
  job: body.job,
  entities: body.entities,
})

export const attachOf = (body: Record<string, unknown>) => ({
  fileId: body.id,
  filename: body.filename,
})
