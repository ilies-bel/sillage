# VerySwing (VSA) API — what we actually use

Extracted from the public sandbox spec, vendored at
[`vsa-sandbox-openapi.json`](./vsa-sandbox-openapi.json) (261 paths).
Source: `https://automation.playwithvsa.com/api/doc` — the spec is embedded inline in the
page HTML as `"spec":{"openapi":"3.0.0"…}`.

Under **DEC-28 the sandbox is the target**, not a stand-in. Under **DEC-29** everything
below is confined to `modules/crm/vsa/` and reached only through `CrmPort`.

---

## Auth

```
POST /login   { login, password, authType: "api" | "real" }  →  { token }
GET  /expiration                                             →  { expiration }
```

Bearer JWT on every other call. No refresh endpoint — re-login on expiry.

---

## Writes

### `POST /v1/crm/tasks` — the compte-rendu lands here

| | Field | Notes |
|---|---|---|
| **REQ** | `actionUserId` | integer, the VSA user creating it |
| **REQ** | `statusCode` | from `/v1/crm/task/status` |
| **REQ** | `priorityNumber` | integer, from `/v1/crm/task/priorities` |
| **REQ** | `taskType` | from `/v1/crm/task/types` |
| **REQ** | `salesUsers` | array |
| **REQ** | `taskName` | |
| **REQ** | `deadlineDate` | ATOM — `2025-04-15T13:05:02+00:00` |
| **REQ** | `endDate` | ATOM |
| | `linkType` | `ORDER` \| `OPPY` \| `COMPANY` \| `FREE` |
| | `oppyId` | only when `linkType = OPPY` |
| | `tiersCode` | only when `linkType = COMPANY` |
| | `contactsIds[]` | customer contacts |
| | `contactsProspectsIds[]` | prospect contacts |
| | `freeProspectId` | only when `linkType = FREE` |
| | `taskDescription` | **"Description / Reporting" — the rendered compte-rendu goes here** |
| | `warnActive` / `warnEmail` / `warnDays` | |

→ `{ success, message, id }`

**No idempotency key.** See ARCHITECTURE.md §5.F — the outbox must persist the returned
`id` in the same transaction that drains the intent, and never re-post a drained one.

### `POST /v1/opportunity`

**REQ:** `entity`, `accountType` (`CUSTOMER`\|`PROSPECT`\|`PROSPECTCONTACT`), `accountCode`,
`sales`, `closingDate` (`yyyy-mm-dd`), `title`, `description`, `amount`, `currency` (ISO
4217), `salesStage`, `probability`.

**Optional and directly useful to us** — these are why the ESN recipe maps so cleanly:

| Field | Fed from |
|---|---|
| `contextDescription` | the client's situation |
| `technicalEnvDescription` | stack discussed |
| `profileDescription` | *2× Dev Java senior* |
| `startingDate` / `endingDate` | *démarrage septembre* |
| `origin` / `originDescription` / `reference` | |

Note `closingDate` is `yyyy-mm-dd` here while tasks use ATOM. Easy to get wrong.

### `POST /v1/prospect/{code}/contact`

**REQ:** `actionUserId`, `statusCode`, `useParentAddr`, `lastname`, `firstname`, `entities`.
Optional: `gender` (`F`\|`M`), `job`, `email`, `phone`, `mobile`, address block,
`socialNetworks[]`.

### `POST /v1/crm/tasks/{id}/attach`

**REQ:** `id` (file ID from the media upload endpoint), optional `filename`.
This is where the raw transcript is attached.

### ⚠ `POST /v1/prospect` — heavier than DEC-18 assumed

**13 required fields:** `actionUserId`, `prospectStatusCode`, `codeDisplay`, `name`,
`description`, `activity`, `mainName`, `mainAddr1`, `mainZipcode`, `mainCity`,
`mainCountry`, `defaultBillingTax`, `salesUsers[]`, `entities[]`.

**A meeting produces none of the address, activity or tax fields.** DEC-18 said "first call
with no account → create a prospect account", and this endpoint makes that impossible to do
honestly — the only way to satisfy it is placeholder data, which permanently pollutes the
CRM of record.

**Revision (see DEC-18 note):** v1 does not auto-create prospect *accounts*. Three exits:
attach to a resolved account; create a prospect *contact* under an existing account; or use
`linkType: FREE` with `freeProspectId` when the company is genuinely unknown. Full account
creation stays a deliberate act in VSA.

---

## Reads — referentials

Fetch once per session, cache per tenant, never hard-code (DEC-24).

```
GET /v1/crm/task/types
GET /v1/crm/task/status
GET /v1/crm/task/priorities
GET /v1/opportunity/sales/stages
GET /v1/opportunity/success/probabilities
GET /v1/prospect/status
```

---

## Reads — entity resolution

Two findings here changed the design in §5.1 of VISION.md.

### 1. Exact email lookup exists — it is the primary key, not the domain

```
GET /v1/prospect-contacts?email=<exact>
  → prospectId, lastname, firstname, email, statusCode, statusLabel, parentTiersCode
```

Also filterable by `lastname`, `firstname`, `parentTiersCode`, `entityIds`, `statusCodes`.

This outranks domain matching and it **defuses INPUT-1**: a prospect on `@gmail.com` still
resolves if they exist in VSA at all. Resolution order becomes:

1. `?email=` exact → `parentTiersCode`
2. domain of the address → account
3. **other attendees on the same invite** — one colleague on the company domain resolves
   the whole meeting
4. `⚠ faible` best candidate + sibling list (DEC-18)

### 2. `parentTiersCode` makes holding siblings directly queryable

```
GET /v1/crm/customers?tiersCode=&name=&codeDisplay=&limit=&offset=
  → tiersCode, name, description, codeDisplay, activity, activityLabel,
    mainName, mainAddr1..3, mainZipcode, mainCity, mainCountry,
    entities, salesman, parentTiersCode, mainCountryCode, archiveDate, extRefList

GET /v1/prospects?code=&codeDisplay=&name=&parentCode=&entityIds=&statusCodes=
  → code, codeDisplay, name, description, parentCode,
    entityIds, prospectStatusCode, prospectStatusLabel

GET /v1/crm/customer/{code}/contacts
  → id, gender, lastname, firstname, job, email, phoneNumber, mobilePhoneNumber,
    addr*, socialNetwork, description, dpo, rssi
```

Both customers and prospects carry a parent link (`parentTiersCode` / `parentCode`), so the
DEC-18 sibling list is a group-by rather than a heuristic. **INPUT-2 becomes measurable
directly from the API** instead of needing a client export.

Pagination: `limit` / `offset` query params, or `X-Paginate-Limit` / `X-Paginate-Offset`
headers.

### Caching strategy

Pull accounts + contacts once at connect and hold them locally. Resolution then runs
offline, instantly, and can do fuzzy matching and sibling grouping without round-trips —
which is what makes the `⚠ faible` UI feel immediate rather than laggy. Refresh on a timer
and on explicit reconnect.
