/**
 * GENERATED FILE — DO NOT HAND-EDIT.
 *
 * Produced by `node scripts/generate-vsa-types.mjs` from
 * `docs/reference/vsa-sandbox-openapi.json`. Request and response shapes for those endpoints.
 *
 * Only the endpoints listed in `docs/reference/vsa-api.md` are generated; the
 * other ~245 paths of the sandbox spec are not part of this product's surface.
 * To add one, add a row to OPERATIONS in the script and re-run it.
 */

export interface CrmTaskAttach {
  /** File ID */
  id: string
  /** Define filename - override filename sent during upload */
  filename?: string
}

export interface CrmTasks {
  /** ID of the user creating the task */
  actionUserId: number
  /** Status */
  statusCode: string
  /** Priority */
  priorityNumber: number
  /** Task type */
  taskType: string
  /** Consultant(s) in charge of the task */
  salesUsers: number[]
  /** Task name */
  taskName: string
  /** Start date-Start time, format 'ATOM' 2025-04-15T13:05:02+00:00 */
  deadlineDate: string
  /** End date-End time, format 'ATOM' 2025-04-15T13:05:02+00:00 */
  endDate: string
  /** Link type, optional, if used must be in this list (ORDER=Business, OPPY=Opportunity, COMPANY=Company (customer/prospect, FREE=Free prospect) */
  linkType?: string
  /** orderHeaderId, optional and only used if linkType = ORDER */
  orderHeaderId?: string
  /** oppyId, optional and only used if linkType = OPPY */
  oppyId?: string
  /** Company code, optional and only used if linkType = COMPANY (could be a prospect or a customer) */
  tiersCode?: string
  /** Array of customer contact ids, optional and only used if linkType = COMPANY */
  contactsIds?: number[]
  /** This parameter is deprecated, use freeProspectId when linkType = FREE */
  freeContactsIds?: number[]
  /** Array of prospect contact ids, optional and only used if linkType = COMPANY */
  contactsProspectsIds?: number[]
  /** Free prospect contact required, optional and only used if linkType = FREE */
  freeProspectId?: number
  /** Description / Reporting */
  taskDescription?: string
  /** Task date alert */
  warnActive?: boolean
  /** Send alert by email */
  warnEmail?: boolean
  /** Days before */
  warnDays?: number
}

export interface CrmTasksPostResponse {
  success?: boolean
  /** Message if success is false */
  message?: string
  /** Task ID */
  id?: number
}

export interface CrmTasksPriority {
  /** Priority number - from 1 (low) to 5 (high) */
  priorityNumber?: string
  /** Priority description */
  description?: string
}

export interface CrmTasksStatus {
  /** Status code */
  statusCode?: string
  /** Status description */
  description?: string
  /** Is a cancellation status */
  isCancellation?: boolean
  /** Is editable */
  isEditable?: boolean
  /** Is active */
  active?: boolean
}

export interface Customer {
  /** Supplier code */
  tiersCode?: string
  /** Supplier name */
  name?: string
  /** Description */
  description?: string
  /** Display code */
  codeDisplay?: string
  /** Code du secteur d'activité */
  activity?: string
  /** Libellé du secteur d'activité */
  activityLabel?: string
  /** Company name */
  mainName?: string
  /** Address (line 1) */
  mainAddr1?: string
  /** Address (line 2) */
  mainAddr2?: string
  /** Address (line 3) */
  mainAddr3?: string
  /** Zipcode */
  mainZipcode?: string
  /** City */
  mainCity?: string
  /** Country */
  mainCountry?: string
  /** Linked entities */
  entities?: CustomerEntity[]
  /** Linked salesman */
  salesman?: CustomerSalesman[]
  /** Parent client code */
  parentTiersCode?: string
  /** Country code */
  mainCountryCode?: string
  /** Archive date */
  archiveDate?: string
  /** External references */
  extRefList?: CustomerExtRef[]
}

export interface CustomerContact {
  /** Contract ID */
  id?: number
  /** Genre */
  gender?: string
  /** Name */
  lastname?: string
  /** Firstname */
  firstname?: string
  /** Job */
  job?: string
  /** Email */
  email?: string
  /** Phone number */
  phoneNumber?: string
  /** Mobile phone number */
  mobilePhoneNumber?: string
  /** Fax */
  fax?: string
  /** Address ID */
  addrId?: number
  /** Address Type Code */
  addrCode?: string
  addrLine1?: string
  addrLine2?: string
  addrLine3?: string
  addrZipCode?: string
  addrCity?: string
  addrCountry?: string
  addrCountryCode?: string
  addrTerritory?: string
  addrTerritoryCode?: string
  /** Social network links */
  socialNetwork?: CustomerContactSocialNetwork[]
  /** Description */
  description?: string
  /** Data protection officer */
  dpo?: boolean
  /** RSSI */
  rssi?: boolean
}

export interface CustomerContactSocialNetwork {
  /** ID */
  id?: number
  /** Social Network Link */
  link?: string
  /** Social Network Id */
  typeId?: number
  /** Social Network name */
  typeName?: string
}

export interface CustomerEntity {
  id?: number
}

export interface CustomerExtRef {
  /** Type code */
  code?: string
  /** libellé de la référence externe */
  label?: string
  /** Valeur de la référence */
  value?: string
}

export interface CustomerSalesman {
  salemanId?: number
}

export interface Error {
  error?: boolean
  message?: string
  data?: string[]
}

export interface ExpirationResponse {
  expiration?: string
}

/** Authentification */
export interface Login {
  /** User login */
  login?: string
  /** User Password */
  password?: string
  /** Authentication type, 'api' for API users or 'real' for real VSA/VSP/VSE users */
  authType?: string
}

/** Authentification */
export interface LoginResponse {
  token?: string
}

export interface OpportunityIn {
  /** Entity Code (VSA) */
  entity: string
  /** Type of account : CUSTOMER */
  accountType: string
  /** Account code */
  accountCode: string
  /** Sale login (VSA) */
  sales: string
  /** Date (yyyy-mm-dd) */
  closingDate: string
  /** Alert on the closing date */
  closingAlertActive?: boolean
  /** If alert is active, alert can be sent by email */
  closingAlertEmail?: boolean
  /** If alert is active, alert will be active N days before the closing date */
  closingAlertDays?: number
  /** Reference */
  reference?: string
  /** Title / Name */
  title: string
  /** Description */
  description: string
  /** Context */
  contextDescription?: string
  /** Technical environnement */
  technicalEnvDescription?: string
  /** Profile */
  profileDescription?: string
  /** Starting date (yyyy-mm-dd) */
  startingDate?: string
  /** Ending date (yyyy-mm-dd) */
  endingDate?: string
  /** Time slot */
  timeSlot?: string
  /** Origin */
  origin?: string
  /** Origin description */
  originDescription?: string
  /** Target Amount */
  amount: number
  /** Currency code (ISO 4217) - define in your environment */
  currency: string
  /** Sales stage code */
  salesStage: string
  /** Success probibality code */
  probability: string
}

export interface OppyProbability {
  /** Probability code */
  probabilityCode?: string
  /** Description */
  description?: string
}

export interface OppySalesStage {
  /** Sales stage code */
  salesStageCode?: string
  /** Description */
  description?: string
}

export interface ProspectAccountList {
  /** Account code */
  code?: string
  /** Account code display */
  codeDisplay?: string
  /** Account name */
  name?: string
  /** Account description */
  description?: string
  /** Account parent code */
  parentCode?: string
  /** Account entity ids */
  entityIds?: number[]
  /** Account status code */
  prospectStatusCode?: string
  /** Account status description */
  prospectStatusLabel?: string
}

export interface ProspectContactAdd {
  /** Application User Id */
  actionUserId: number
  statusCode: string
  useParentAddr: boolean
  lastname: string
  firstname: string
  /** Gender (F: Female, M: Male) */
  gender?: string
  job?: string
  email?: string
  phone?: string
  mobile?: string
  fax?: string
  addr1?: string
  addr2?: string
  addr3?: string
  zipcode?: string
  city?: string
  country?: string
  territory?: string
  /** Required if contact is FREE */
  entities: number[]
  /** Use to change the account link (NULL change nothing, FREE to move contact as free contact, Prospect Account Code to bind to another) */
  parentTiersCode?: string
  description?: string
  originCode?: string
  originDescription?: string
  userId?: number
  socialNetworks?: ProspectContactSocialNetwork[]
}

export interface ProspectContactList {
  /** Contact ID */
  prospectId?: number
  /** Contact lastname */
  lastname?: string
  /** Contact firstname */
  firstname?: string
  /** Contact email */
  email?: string
  /** Contact status code */
  statusCode?: string
  /** Contact status description */
  statusLabel?: string
  /** Contact parent tiers code */
  parentTiersCode?: string
}

export interface ProspectContactSocialNetwork {
  type?: string
  link?: string
}

export interface ProspectStatus {
  /** Code */
  code?: string
  /** Description */
  description?: string
}

export interface TaskTypes {
  /** Task type technical code, to be used in this API */
  typeCode?: string
  /** Task type description in the request locale language */
  description?: string
  /** 'true' if this task type can send an email */
  isEmail?: boolean
  /** 'true' if this task type is a meeting and send an invitation */
  isMeeting?: boolean
  /** 'true' if this task type is available */
  active?: boolean
}
