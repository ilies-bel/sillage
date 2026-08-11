/**
 * GENERATED FILE — DO NOT HAND-EDIT.
 *
 * Produced by `node scripts/generate-vsa-types.mjs` from
 * `docs/reference/vsa-sandbox-openapi.json`. One descriptor per endpoint the adapter calls.
 *
 * Only the endpoints listed in `docs/reference/vsa-api.md` are generated; the
 * other ~245 paths of the sandbox spec are not part of this product's surface.
 * To add one, add a row to OPERATIONS in the script and re-run it.
 */

/**
 * What the adapter expects a tenant to offer. `probe.ts` diffs a live VSA
 * against this table and reports the difference as data (DEC-24).
 */
export interface VsaOperation {
  readonly id: string
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly summary: string
  /** Query parameter names the spec declares. */
  readonly query: readonly string[]
  /** Placeholders in `path`, in order. */
  readonly pathParams: readonly string[]
  /** Body fields the spec marks required. A missing one is a 400, not a warning. */
  readonly requiredBody: readonly string[]
  /** Component schema name, for cross-referencing `schemas.ts`. */
  readonly bodySchema: string | null
  readonly responseSchema: string | null
}

export const VSA_OPERATIONS = {
  login: {
    id: "login",
    method: "POST",
    path: "/login",
    summary: "Get your auth token",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: "Login",
    responseSchema: "LoginResponse",
  },
  expiration: {
    id: "expiration",
    method: "GET",
    path: "/expiration",
    summary: "Expiration date of the token",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "ExpirationResponse",
  },
  createTask: {
    id: "createTask",
    method: "POST",
    path: "/v1/crm/tasks",
    summary: "Create CRM task",
    query: [],
    pathParams: [],
    requiredBody: ["actionUserId","statusCode","priorityNumber","taskType","salesUsers","taskName","deadlineDate","endDate"],
    bodySchema: "CrmTasks",
    responseSchema: "CrmTasksPostResponse",
  },
  attachToTask: {
    id: "attachToTask",
    method: "POST",
    path: "/v1/crm/tasks/{id}/attach",
    summary: "Attach a document to a CRM Task",
    query: [],
    pathParams: ["id"],
    requiredBody: ["id"],
    bodySchema: "CrmTaskAttach",
    responseSchema: null,
  },
  uploadMedia: {
    id: "uploadMedia",
    method: "POST",
    path: "/v1/media/upload",
    summary: "Upload document",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: null,
  },
  createOpportunity: {
    id: "createOpportunity",
    method: "POST",
    path: "/v1/opportunity",
    summary: "Create an opportunity",
    query: [],
    pathParams: [],
    requiredBody: ["entity","accountType","accountCode","sales","closingDate","title","description","amount","currency","salesStage","probability"],
    bodySchema: "OpportunityIn",
    responseSchema: null,
  },
  createProspectContact: {
    id: "createProspectContact",
    method: "POST",
    path: "/v1/prospect/{code}/contact",
    summary: "Create prospect contact",
    query: [],
    pathParams: ["code"],
    requiredBody: ["actionUserId","lastname","firstname","statusCode","useParentAddr","entities"],
    bodySchema: "ProspectContactAdd",
    responseSchema: null,
  },
  taskTypes: {
    id: "taskTypes",
    method: "GET",
    path: "/v1/crm/task/types",
    summary: "List of sales tasks types",
    query: ["active"],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "TaskTypes[]",
  },
  taskStatuses: {
    id: "taskStatuses",
    method: "GET",
    path: "/v1/crm/task/status",
    summary: "List of sales tasks statuses",
    query: ["active"],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "CrmTasksStatus[]",
  },
  taskPriorities: {
    id: "taskPriorities",
    method: "GET",
    path: "/v1/crm/task/priorities",
    summary: "List of sales tasks priorities",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "CrmTasksPriority[]",
  },
  salesStages: {
    id: "salesStages",
    method: "GET",
    path: "/v1/opportunity/sales/stages",
    summary: "Selling stage",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "OppySalesStage[]",
  },
  successProbabilities: {
    id: "successProbabilities",
    method: "GET",
    path: "/v1/opportunity/success/probabilities",
    summary: "Opportunity success probabilities",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "OppyProbability[]",
  },
  prospectStatuses: {
    id: "prospectStatuses",
    method: "GET",
    path: "/v1/prospect/status",
    summary: "Status of accounts and prospect contacts",
    query: [],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "ProspectStatus[]",
  },
  findProspectContacts: {
    id: "findProspectContacts",
    method: "GET",
    path: "/v1/prospect-contacts",
    summary: "List of all prospect contacts",
    query: ["lastname","firstname","email","parentTiersCode","entityIds","limit","offset","statusCodes"],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "ProspectContactList[]",
  },
  listCustomers: {
    id: "listCustomers",
    method: "GET",
    path: "/v1/crm/customers",
    summary: "Customers list",
    query: ["tiersCode","name","codeDisplay","limit","offset"],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "Customer[]",
  },
  listProspects: {
    id: "listProspects",
    method: "GET",
    path: "/v1/prospects",
    summary: "List of prospect account",
    query: ["code","codeDisplay","name","parentCode","entityIds","limit","offset","statusCodes"],
    pathParams: [],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "ProspectAccountList[]",
  },
  listCustomerContacts: {
    id: "listCustomerContacts",
    method: "GET",
    path: "/v1/crm/customer/{code}/contacts",
    summary: "Customer contacts list",
    query: ["archived","enabled"],
    pathParams: ["code"],
    requiredBody: [],
    bodySchema: null,
    responseSchema: "CustomerContact[]",
  },
} as const satisfies Record<string, VsaOperation>

export type VsaOperationId = keyof typeof VSA_OPERATIONS

/**
 * The property names of each schema, at **runtime**.
 *
 * `schemas.ts` is types, and types are erased — so `probe.ts` could not
 * otherwise ask "does this tenant's task really have the column `fieldMap.ts`
 * writes to?". This is that question's data. A client column that the spec does
 * not know about shows up in the probe report as a gap rather than as a 400 on
 * the one click the product is judged on.
 */
export const VSA_SCHEMA_COLUMNS: Record<string, readonly string[]> = {
  CrmTaskAttach: ["id","filename"],
  CrmTasks: ["actionUserId","statusCode","priorityNumber","taskType","salesUsers","taskName","deadlineDate","endDate","linkType","orderHeaderId","oppyId","tiersCode","contactsIds","freeContactsIds","contactsProspectsIds","freeProspectId","taskDescription","warnActive","warnEmail","warnDays"],
  CrmTasksPostResponse: ["success","message","id"],
  CrmTasksPriority: ["priorityNumber","description"],
  CrmTasksStatus: ["statusCode","description","isCancellation","isEditable","active"],
  Customer: ["tiersCode","name","description","codeDisplay","activity","activityLabel","mainName","mainAddr1","mainAddr2","mainAddr3","mainZipcode","mainCity","mainCountry","entities","salesman","parentTiersCode","mainCountryCode","archiveDate","extRefList"],
  CustomerContact: ["id","gender","lastname","firstname","job","email","phoneNumber","mobilePhoneNumber","fax","addrId","addrCode","addrLine1","addrLine2","addrLine3","addrZipCode","addrCity","addrCountry","addrCountryCode","addrTerritory","addrTerritoryCode","socialNetwork","description","dpo","rssi"],
  CustomerContactSocialNetwork: ["id","link","typeId","typeName"],
  CustomerEntity: ["id"],
  CustomerExtRef: ["code","label","value"],
  CustomerSalesman: ["salemanId"],
  Error: ["error","message","data"],
  ExpirationResponse: ["expiration"],
  Login: ["login","password","authType"],
  LoginResponse: ["token"],
  OpportunityIn: ["entity","accountType","accountCode","sales","closingDate","closingAlertActive","closingAlertEmail","closingAlertDays","reference","title","description","contextDescription","technicalEnvDescription","profileDescription","startingDate","endingDate","timeSlot","origin","originDescription","amount","currency","salesStage","probability"],
  OppyProbability: ["probabilityCode","description"],
  OppySalesStage: ["salesStageCode","description"],
  ProspectAccountList: ["code","codeDisplay","name","description","parentCode","entityIds","prospectStatusCode","prospectStatusLabel"],
  ProspectContactAdd: ["actionUserId","statusCode","useParentAddr","lastname","firstname","gender","job","email","phone","mobile","fax","addr1","addr2","addr3","zipcode","city","country","territory","entities","parentTiersCode","description","originCode","originDescription","userId","socialNetworks"],
  ProspectContactList: ["prospectId","lastname","firstname","email","statusCode","statusLabel","parentTiersCode"],
  ProspectContactSocialNetwork: ["type","link"],
  ProspectStatus: ["code","description"],
  TaskTypes: ["typeCode","description","isEmail","isMeeting","active"],
}
