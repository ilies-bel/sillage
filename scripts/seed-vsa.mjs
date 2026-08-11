#!/usr/bin/env node
/**
 * Seeds the public VerySwing sandbox with a plausible French ESN account base.
 *
 * WHY THIS EXISTS
 * ---------------
 * IMPLEMENTATION.md, "Demo preparation": demo beat #4 is *records appear live
 * in VerySwing*. That beat lands on nothing in an empty CRM — and worse, the
 * three beats before it are hollow too, because `resolveAccount` has no field
 * to rank. A resolver with one account in it always answers "that one" at
 * score 1.0; a resolver with a holding, its three subsidiaries on one shared
 * domain, and eight unrelated companies is the only way to *see* DEC-18's
 * `⚠ faible` and its sibling list do their job. So this is not fixture data for
 * a screenshot. It is the input the resolution logic is judged against.
 *
 * DEC-28 says the sandbox is the target, not a stand-in. That makes seeding it
 * an outward-facing act against a shared public tenant that other people also
 * use, which is why the script is built the way it is:
 *
 *   · **`--dry-run` is the default.** Writing is opt-in, spelled `--apply`.
 *   · **Every record is looked up before it is created.** `POST /v1/prospect`
 *     answers `200` with *no body at all* — no id, no code, no idempotency key
 *     — exactly like `POST /v1/crm/tasks` (ARCHITECTURE.md §5.F). There is
 *     nothing on the write side to make a second run safe, so safety has to come
 *     from the read side: list first, match on the account's own code and name,
 *     skip with a note. `POST /v1/crm/customer` is kinder — it returns the code
 *     as a bare string — but it is no more idempotent, so it gets the same
 *     treatment.
 *   · **It never invents a tenant value.** `activity`, `defaultBillingTax`,
 *     `prospectStatusCode` and the country are read from the tenant's own
 *     referentials (DEC-24). None of the six referentials the *product* needs
 *     has a POST in the 261-path spec, so this script cannot populate them —
 *     it verifies them and tells you which ones an admin still has to fill in
 *     the VSA UI. Saying "seeded" about a list we cannot write would be a lie
 *     that only surfaces during the demo.
 *
 * WHY IT DOES NOT USE `generated/operations.ts`
 * --------------------------------------------
 * It reuses everything the adapter already owns — `vsaConfig`, `VsaSession`
 * (login, 401-replay, error mapping), `Directory` (the same lens
 * `resolveAccount` looks through) and `ReferentialCache`. What it does *not* do
 * is add its endpoints to the generated client. `VsaCrm.ts` documents, at
 * length, that the product never calls `POST /v1/prospect`, and a
 * `VSA_OPERATIONS.createProspectAccount` sitting in the typed client is an
 * invitation for someone to call it from `app/` six months from now. The four
 * paths this script needs and the product does not are declared below, in
 * `SEED_PATHS`, where they cannot be mistaken for product surface.
 *
 * USAGE
 * -----
 *   npm run seed:vsa                    # dry run: reads the tenant, writes nothing
 *   npm run seed:vsa -- --apply         # creates what is missing
 *   npm run seed:vsa -- --offline       # prints the plan; no credentials, no network
 *   npm run seed:vsa -- --only=acme     # one group
 *   npm run seed:vsa -- --json          # the plan as JSON
 *
 * Credentials come from `SILLAGE_VSA_*`, read exactly the way
 * `electron/modules/crm/vsa/config.ts` reads them (and `.env` is applied first,
 * the way `app/main.ts` does in development). With none set it names the
 * variables and exits 2 rather than half-running.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const load = (relative) => import(pathToFileURL(resolve(ROOT, relative)).href)

// ── output ───────────────────────────────────────────────────────────────────

const bold = (s) => `[1m${s}[0m`
const dim = (s) => `[2m${s}[0m`
const warn = (s) => `[33m${s}[0m`
const good = (s) => `[32m${s}[0m`
const bad = (s) => `[31m${s}[0m`
const rule = (title) => bold(`── ${title} ${'─'.repeat(Math.max(0, 64 - title.length))}`)

// ── flags ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const OPTIONS = {
  apply: flag('apply'),
  // Accepted and ignored: it is the default. Spelling it out is what lets
  // someone write the safe invocation explicitly instead of trusting a default
  // they have to look up.
  dryRun: flag('dry-run'),
  offline: flag('offline'),
  json: flag('json'),
  only: value('only'),
}

const UNKNOWN = argv.filter(
  (a) => a.startsWith('--') && !['--apply', '--dry-run', '--offline', '--json'].includes(a) && !a.startsWith('--only='),
)
if (UNKNOWN.length > 0) {
  console.error(`\n  unknown option(s): ${UNKNOWN.join(', ')}`)
  console.error('  usage: node scripts/seed-vsa.mjs [--apply|--dry-run|--offline] [--only=<key>] [--json]\n')
  process.exit(64)
}
if (OPTIONS.apply && OPTIONS.dryRun) {
  console.error('\n  --apply and --dry-run contradict each other. Pick one.\n')
  process.exit(64)
}

/**
 * The three modes, stated once.
 *
 * `offline` is not a weaker dry run — it is the review mode: it needs no
 * credentials and touches no network, so the plan can be read and argued about
 * on a machine that has never seen the sandbox. `dry-run` is the rehearsal: it
 * reads the tenant and tells you, record by record, what it *would* create and
 * what is already there. `apply` is the only one that writes.
 */
const MODE = OPTIONS.offline ? 'offline' : OPTIONS.apply ? 'apply' : 'dry-run'

// ── the seed data ────────────────────────────────────────────────────────────

/**
 * SIREN is nine digits with a Luhn check digit, so a random nine digits is not
 * a SIREN — it is a number that fails validation in any French system that
 * looks. Eight digits are declared per account and the ninth is computed, which
 * makes every code in this file structurally valid and visibly synthetic
 * (`9xx` bases are not allocated by INSEE).
 */
const luhnCheckDigit = (base) => {
  let sum = 0
  let double = true
  for (let i = base.length - 1; i >= 0; i--) {
    let digit = Number(base[i])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return String((10 - (sum % 10)) % 10)
}

export const siren = (base8) => `${base8}${luhnCheckDigit(base8)}`

/**
 * The account base.
 *
 * Shaped for what it has to exercise, not for volume:
 *
 *   · **Groupe Acme** — prospects. `Acme Industries` is the company in
 *     `fixtures/transcript-acme.json`, on the domain that fixture's attendee
 *     uses, so `npm run replay:extract` has somewhere real to push. Its sibling
 *     sits on a *different* domain, so the fixture resolves cleanly (DEC-18's
 *     sibling list appears without the fixture itself going ambiguous).
 *   · **Groupe Ravel** — prospects, three subsidiaries on **one shared domain**
 *     and a holding with no contacts of its own. This is INPUT-2: an attendee
 *     on `@ravel.fr` who is not yet in VSA matches all three at the same score,
 *     the margin is 0, and `rankCandidates` returns three `⚠ faible` rows with
 *     the family listed. Nothing else in the base produces that, and it is the
 *     case DEC-18 exists for.
 *   · **Institut Berthelot** carries a contact on a consumer domain. That is
 *     INPUT-1: the exact `?email=` lookup is the only thing that resolves them,
 *     which is the finding that reordered resolution in `resolve.ts`.
 *   · The rest are spread — different sectors, cities and domains — so a
 *     resolution has a field to be right *against*.
 *
 * `kind` decides the endpoint: customers go through `POST /v1/crm/customer`,
 * prospects through `POST /v1/prospect`. Both are seeded because `VsaCrm.link`
 * branches on it — a customer takes `contactsIds`, a prospect
 * `contactsProspectsIds`, and an opportunity's `accountType` differs. A base of
 * only one kind leaves half of that untested at demo time.
 *
 * **Why the fixture's client is a prospect and not a customer.** Measured
 * against a stub tenant seeded with this exact table: an attendee who is a
 * *customer* contact resolves at 0.62–0.68 `⚠ faible` on name matching alone,
 * because `Directory.snapshot()` bulk-loads prospect contacts only —
 * `/v1/prospect-contacts` has no customer twin, and `Directory.customerContacts()`
 * exists but is called by nothing. The same person as a *prospect* contact
 * resolves at 0.95 `ok`. Until that gap is closed, putting the demo's account on
 * the customer side would make demo beat #4 open on a `⚠ faible` row. It is also
 * the truthful shape: the fixture is a first qualification call, which is what a
 * prospect is. `Delaunay & Fils` and `Novaterre Assurances` carry the customer
 * side so the branch is seeded and the gap stays visible.
 */
export const ACCOUNTS = [
  // ── Groupe Acme — the fixture's client ────────────────────────────────────
  {
    key: 'acme',
    kind: 'prospect',
    code: 'ACME',
    name: 'Groupe Acme',
    parent: null,
    domain: 'groupe-acme.fr',
    description: 'Holding industrielle — pilotage des filiales Acme.',
    sector: 'holding',
    siren: siren('91240176'),
    address: { line1: '18 avenue de Wagram', zip: '75008', city: 'Paris' },
    staffSize: 40,
  },
  {
    key: 'acme-industries',
    kind: 'prospect',
    code: 'ACMEIND',
    name: 'Acme Industries',
    parent: 'acme',
    domain: 'acme-industries.fr',
    description: 'Équipementier industriel. Migration du socle applicatif Java/Spring.',
    sector: 'industrie',
    siren: siren('91240184'),
    address: { line1: '42 rue de la Villette', zip: '69003', city: 'Lyon' },
    staffSize: 850,
  },
  {
    key: 'acme-services',
    kind: 'prospect',
    code: 'ACMESRV',
    name: 'Acme Services',
    parent: 'acme',
    domain: 'acme-services.fr',
    description: 'Services partagés du groupe Acme : achats, paie, SI transverse.',
    sector: 'conseil',
    siren: siren('91240192'),
    address: { line1: '7 rue Léon Blum', zip: '69100', city: 'Villeurbanne' },
    staffSize: 210,
  },

  // ── Groupe Ravel — the ambiguity case, as prospects ───────────────────────
  {
    key: 'ravel',
    kind: 'prospect',
    code: 'RAVEL',
    name: 'Groupe Ravel',
    parent: null,
    domain: 'ravel.fr',
    description: 'Holding familiale — industrie, logistique et énergie dans le Grand Ouest.',
    sector: 'holding',
    siren: siren('91307748'),
    address: { line1: '3 quai François Mitterrand', zip: '44000', city: 'Nantes' },
    staffSize: 25,
  },
  {
    key: 'ravel-industrie',
    kind: 'prospect',
    code: 'RAVELIND',
    name: 'Ravel Industrie',
    parent: 'ravel',
    domain: 'ravel.fr',
    description: 'Chaudronnerie et ensembles mécano-soudés pour le naval.',
    sector: 'industrie',
    siren: siren('91307755'),
    address: { line1: '12 boulevard de la Villès-Martin', zip: '44600', city: 'Saint-Nazaire' },
    staffSize: 430,
  },
  {
    key: 'ravel-logistique',
    kind: 'prospect',
    code: 'RAVELLOG',
    name: 'Ravel Logistique',
    parent: 'ravel',
    domain: 'ravel.fr',
    description: 'Entreposage et transport pour l’agroalimentaire.',
    sector: 'transport',
    siren: siren('91307763'),
    address: { line1: '5 rue des Frères Lumière', zip: '44400', city: 'Rezé' },
    staffSize: 310,
  },
  {
    key: 'ravel-energie',
    kind: 'prospect',
    code: 'RAVELENR',
    name: 'Ravel Énergie',
    parent: 'ravel',
    domain: 'ravel.fr',
    description: 'Exploitation de parcs éoliens terrestres.',
    sector: 'energie',
    siren: siren('91307771'),
    address: { line1: '28 rue Crébillon', zip: '44000', city: 'Nantes' },
    staffSize: 95,
  },

  // ── standalones — the field a resolution has to be right *against* ────────
  // The first two are `customer`, which is what makes the customer branch of
  // `VsaCrm.link` (`contactsIds`) and `accountType: CUSTOMER` reachable at all.
  {
    key: 'delaunay',
    kind: 'customer',
    code: 'DELAUNAY',
    name: 'Delaunay & Fils',
    parent: null,
    domain: 'delaunay-fils.fr',
    description: 'Négoce textile, quatrième génération. Refonte de l’ERP en cours.',
    sector: 'distribution',
    siren: siren('91415902'),
    address: { line1: '61 grande rue de l’Épeule', zip: '59100', city: 'Roubaix' },
    staffSize: 180,
  },
  {
    key: 'novaterre',
    kind: 'customer',
    code: 'NOVATERRE',
    name: 'Novaterre Assurances',
    parent: null,
    domain: 'novaterre-assurances.fr',
    description: 'Mutuelle régionale. Digitalisation du parcours sinistre.',
    sector: 'assurance',
    siren: siren('91415910'),
    address: { line1: '9 rue du Bastion', zip: '79000', city: 'Niort' },
    staffSize: 640,
  },
  {
    key: 'cleon',
    kind: 'prospect',
    code: 'CLEONMOB',
    name: 'Cléon Mobilité',
    parent: null,
    domain: 'cleon-mobilite.fr',
    description: 'Opérateur de mobilité urbaine. Plateforme billettique.',
    sector: 'transport',
    siren: siren('91415928'),
    address: { line1: '14 rue Jeanne d’Arc', zip: '76000', city: 'Rouen' },
    staffSize: 270,
  },
  {
    key: 'berthelot',
    kind: 'prospect',
    code: 'BERTHELOT',
    name: 'Institut Berthelot',
    parent: null,
    domain: 'institut-berthelot.fr',
    description: 'Laboratoire d’analyses médicales, 22 sites en Occitanie.',
    sector: 'sante',
    siren: siren('91415936'),
    address: { line1: '3 allée Jules Guesde', zip: '31000', city: 'Toulouse' },
    staffSize: 520,
  },
  {
    key: 'soregis',
    kind: 'prospect',
    code: 'SOREGIS',
    name: 'Sorégis Conseil',
    parent: null,
    domain: 'soregis.fr',
    description: 'Cabinet de conseil en organisation. Client historique en régie.',
    sector: 'conseil',
    siren: siren('91415944'),
    address: { line1: '25 cours du Chapeau Rouge', zip: '33000', city: 'Bordeaux' },
    staffSize: 60,
  },
]

/**
 * The people. `email` is the resolution key, so every one of them is on their
 * own company's domain — except Grégoire Manceau, who is deliberately on a
 * consumer domain (INPUT-1) and is therefore reachable only through the exact
 * `?email=` lookup that `resolve.ts` puts first.
 *
 * Camille Le Roy and Thomas Berger are the two names spoken in
 * `fixtures/transcript-acme.json`. They are here so the replay path pushes into
 * an account whose contacts the compte-rendu can actually be attached to,
 * rather than into an empty shell.
 */
export const CONTACTS = [
  { account: 'acme', gender: 'F', firstName: 'Hélène', lastName: 'Vasseur', job: 'Directrice des systèmes d’information groupe', email: 'helene.vasseur@groupe-acme.fr' },

  { account: 'acme-industries', gender: 'F', firstName: 'Camille', lastName: 'Le Roy', job: 'Responsable de l’équipe plateforme', email: 'camille.leroy@acme-industries.fr' },
  { account: 'acme-industries', gender: 'M', firstName: 'Thomas', lastName: 'Berger', job: 'Manager de l’équipe plateforme', email: 'thomas.berger@acme-industries.fr' },
  { account: 'acme-industries', gender: 'M', firstName: 'Sofiane', lastName: 'Retel', job: 'Directeur technique', email: 'sofiane.retel@acme-industries.fr' },

  { account: 'acme-services', gender: 'F', firstName: 'Nadia', lastName: 'Boukhari', job: 'Responsable achats IT', email: 'nadia.boukhari@acme-services.fr' },

  // No contact on `Groupe Ravel` on purpose: the holding is a shell, so the
  // three subsidiaries are the only thing an `@ravel.fr` address can match.
  { account: 'ravel-industrie', gender: 'M', firstName: 'Bertrand', lastName: 'Lemoine', job: 'Directeur des systèmes d’information', email: 'bertrand.lemoine@ravel.fr' },
  { account: 'ravel-logistique', gender: 'F', firstName: 'Aurélie', lastName: 'Pichon', job: 'Responsable SI', email: 'aurelie.pichon@ravel.fr' },
  { account: 'ravel-energie', gender: 'M', firstName: 'Kévin', lastName: 'Dutertre', job: 'Architecte applicatif', email: 'kevin.dutertre@ravel.fr' },

  { account: 'delaunay', gender: 'F', firstName: 'Marie-Christine', lastName: 'Delaunay', job: 'Directrice générale', email: 'mc.delaunay@delaunay-fils.fr' },
  { account: 'delaunay', gender: 'M', firstName: 'Yann', lastName: 'Corbière', job: 'Responsable informatique', email: 'yann.corbiere@delaunay-fils.fr' },

  { account: 'novaterre', gender: 'M', firstName: 'Philippe', lastName: 'Anselme', job: 'Responsable transformation digitale', email: 'p.anselme@novaterre-assurances.fr' },

  { account: 'cleon', gender: 'F', firstName: 'Inès', lastName: 'Ferrand', job: 'Cheffe de projet SI', email: 'ines.ferrand@cleon-mobilite.fr' },

  // INPUT-1, on purpose. Domain matching cannot reach him; `?email=` can.
  { account: 'berthelot', gender: 'M', firstName: 'Grégoire', lastName: 'Manceau', job: 'Directeur des opérations', email: 'gregoire.manceau@gmail.com' },
  { account: 'berthelot', gender: 'F', firstName: 'Salima', lastName: 'Ouali', job: 'Responsable applicatif', email: 'salima.ouali@institut-berthelot.fr' },

  { account: 'soregis', gender: 'M', firstName: 'Laurent', lastName: 'Vaillant', job: 'Associé', email: 'laurent.vaillant@soregis.fr' },
]

/**
 * Which tenant activity code to prefer per sector, as substrings.
 *
 * Same contract as `PICK_HINTS` in `referentials.ts` and for the same reason: a
 * tenant names its own sectors, so this says *which one to take when it is
 * offered*, never *what the code is*. No match means the tenant's first row,
 * recorded as a fallback.
 */
const SECTOR_HINTS = {
  holding: ['holding', 'siege', 'société', 'societe', 'divers', 'autre'],
  industrie: ['industrie', 'manufactur', 'production', 'mecanique'],
  transport: ['transport', 'logistique', 'mobilite'],
  energie: ['energie', 'utilit', 'environnement'],
  distribution: ['distribution', 'commerce', 'négoce', 'negoce', 'retail'],
  assurance: ['assurance', 'banque', 'finance', 'mutuelle'],
  sante: ['sante', 'santé', 'medical', 'pharma'],
  conseil: ['conseil', 'service', 'tertiaire'],
}

// ── credentials ──────────────────────────────────────────────────────────────

/**
 * The variables `config.ts` requires, with what each one is.
 *
 * `config.ts` is the authority — it is what actually decides, and this table
 * exists only so the refusal names *variables* instead of the French labels
 * `missingVsaSettings()` returns for Réglages. The two are cross-checked below
 * so they cannot drift silently.
 */
const REQUIRED_ENV = [
  ['SILLAGE_VSA_BASE_URL', 'https://automation.playwithvsa.com/api (no trailing slash)'],
  ['SILLAGE_VSA_LOGIN', 'the sandbox login'],
  ['SILLAGE_VSA_PASSWORD', 'the sandbox password'],
  ['SILLAGE_VSA_ACTION_USER_ID', 'integer — the VSA user every write is attributed to'],
  ['SILLAGE_VSA_ENTITY_ID', 'integer — the entity id (`entities[]`)'],
  ['SILLAGE_VSA_ENTITY_CODE', 'string — the entity code (`entity`)'],
]

const refuseWithoutCredentials = (missingLabels) => {
  const unset = REQUIRED_ENV.filter(([name]) => !(process.env[name] ?? '').trim())
  console.error(`\n  ${warn('No VerySwing credentials on this machine.')}`)
  console.error('  Nothing was read and nothing was written.\n')
  for (const [name, what] of unset) console.error(`    ${bold(name)}  ${dim(what)}`)
  if (unset.length !== missingLabels.length) {
    // config.ts grew a requirement this table does not know about.
    console.error(
      `\n  ${warn('note')} config.ts reports ${missingLabels.length} missing setting(s) — ` +
        `${unset.length} named above. Update REQUIRED_ENV in this script.`,
    )
  }
  console.error(`\n  Put them in ${bold('.env')} (see .env.example), or run ${bold('--offline')} to review the plan.\n`)
  process.exit(2)
}

// ── the paths this script needs and the product does not ─────────────────────

/**
 * Four endpoints, kept out of `generated/operations.ts` on purpose — see the
 * header. Everything else goes through the generated table by way of
 * `Directory` and `ReferentialCache`.
 *
 * `POST /v1/prospects/accounts` returns the created code and would be far more
 * convenient than `POST /v1/prospect`, which answers `200` with no body. It is
 * marked **deprecated** in the spec, so the inconvenient one is the one used,
 * and the code is recovered with a re-query.
 */
const SEED_PATHS = {
  activities: { method: 'GET', path: '/v1/crm/activity' },
  taxes: { method: 'GET', path: '/v1/referential/tax' },
  countries: { method: 'GET', path: '/v1/referential/countries' },
  createProspectAccount: { method: 'POST', path: '/v1/prospect' },
  createProspectContact: { method: 'POST', path: '/v1/prospect/{code}/contact' },
  createCustomer: { method: 'POST', path: '/v1/crm/customer' },
  createCustomerContact: { method: 'POST', path: '/v1/crm/customer/{code}/contact' },
  listProspects: { method: 'GET', path: '/v1/prospects' },
  listCustomers: { method: 'GET', path: '/v1/crm/customers' },
}

// ── helpers ──────────────────────────────────────────────────────────────────

const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const asArray = (value) => (Array.isArray(value) ? value : [])
const asText = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/**
 * The seed plan: parents before children, then contacts.
 *
 * A topological pass rather than a hand-written order, so a deeper tree than
 * today's one level still comes out in a creatable order — and a cycle in the
 * table is a refusal here rather than a 400 halfway through a run.
 */
export const planSeed = ({ accounts = ACCOUNTS, contacts = CONTACTS, only = null } = {}) => {
  const wanted = (account) =>
    only === null || account.key.startsWith(only) || (account.parent ?? '').startsWith(only)

  const byKey = new Map(accounts.map((a) => [a.key, a]))
  const selected = new Map()
  for (const account of accounts) {
    if (!wanted(account)) continue
    // A child is meaningless without its parent — pull the ancestors in.
    let cursor = account
    const chain = []
    const seen = new Set()
    while (cursor) {
      if (seen.has(cursor.key)) throw new Error(`cycle in ACCOUNTS at "${cursor.key}"`)
      seen.add(cursor.key)
      chain.unshift(cursor)
      cursor = cursor.parent ? byKey.get(cursor.parent) : null
    }
    for (const link of chain) selected.set(link.key, link)
  }

  const ordered = []
  const placed = new Set()
  let guard = selected.size + 1
  while (placed.size < selected.size && guard-- > 0) {
    for (const account of selected.values()) {
      if (placed.has(account.key)) continue
      if (account.parent && !placed.has(account.parent)) continue
      ordered.push(account)
      placed.add(account.key)
    }
  }
  if (placed.size < selected.size) throw new Error('unresolvable parent chain in ACCOUNTS')

  const steps = ordered.map((account) => ({ type: 'account', account }))
  for (const account of ordered) {
    for (const contact of contacts.filter((c) => c.account === account.key)) {
      steps.push({ type: 'contact', account, contact })
    }
  }
  return steps
}

/** Prints the plan, with the parent/child relationships visible. */
const renderPlan = (steps) => {
  console.log(rule('Plan'))
  console.log()
  let index = 0
  for (const step of steps) {
    index += 1
    const n = dim(String(index).padStart(2, ' '))
    if (step.type === 'account') {
      const a = step.account
      const under = a.parent ? dim(` sous ${a.parent}`) : ''
      const kind = a.kind === 'customer' ? 'client  ' : 'prospect'
      console.log(`  ${n}  ${dim(kind)} ${bold(a.name.padEnd(24))} ${dim(a.code.padEnd(10))} ${dim(a.domain)}${under}`)
      console.log(`      ${dim(`SIREN ${a.siren} · ${a.address.zip} ${a.address.city} · secteur « ${a.sector} »`)}`)
    } else {
      const c = step.contact
      console.log(
        `  ${n}  ${dim('contact ')} ${`${c.firstName} ${c.lastName}`.padEnd(24)} ${dim(c.email.padEnd(38))} ${dim(`→ ${step.account.code}`)}`,
      )
    }
  }
  console.log()
}

// ── the tenant's own values ──────────────────────────────────────────────────

/**
 * Reads the three referentials the *seeder* needs and the product does not:
 * sectors, tax and countries. Plus the prospect status, which it takes from the
 * adapter's own `ReferentialCache` so the choice is made by the same `pick`
 * the product uses.
 *
 * Every one of these is required by a create body. A missing one is refused
 * here, by name, rather than sent as a guess and returned as a 400 nobody can
 * read.
 */
const readTenantValues = async (session, referentials, vsa) => {
  const rows = async (key) => asArray(await session.request({ operationPath: SEED_PATHS[key].path, method: 'GET' }))

  const [activities, taxes, countries] = await Promise.all([rows('activities'), rows('taxes'), rows('countries')])

  const tax = taxes.find((t) => t?.default === true) ?? taxes[0] ?? null

  // `Countries.countryCode2` is declared `integer` in the spec, which cannot be
  // right for an ISO 3166-1 alpha-2 code. Read as text and fall back to `FR`.
  const france = countries.find((c) => fold(c?.country).startsWith('france')) ?? null

  const status = vsa.pick(referentials.prospectStatuses, vsa.PICK_HINTS.prospectStatuses)

  return {
    activities,
    tax,
    country: {
      label: asText(france?.country) || 'FRANCE',
      code: asText(france?.countryCode2) || 'FR',
      resolved: france !== null,
    },
    prospectStatus: status,
    activityFor(sector) {
      const hints = SECTOR_HINTS[sector] ?? []
      for (const hint of hints) {
        const folded = fold(hint)
        const match = activities.find(
          (a) => fold(a?.activity).includes(folded) || fold(a?.description).includes(folded),
        )
        if (match) return { code: asText(match.activity), label: asText(match.description), why: 'preferred' }
      }
      const first = activities[0]
      return first
        ? { code: asText(first.activity), label: asText(first.description), why: 'fallback' }
        : null
    },
  }
}

const reportTenant = (tenant, referentials, vsa) => {
  console.log(rule('Tenant'))
  console.log()
  const line = (label, ok, detail) => console.log(`  ${ok ? good('ok  ') : warn('vide')}  ${label.padEnd(28)} ${dim(detail)}`)
  line('secteurs d’activité', tenant.activities.length > 0, `${tenant.activities.length} valeur(s)`)
  line('taxes', tenant.tax !== null, tenant.tax ? `« ${tenant.tax.description ?? tenant.tax.code} »` : 'aucune')
  line('pays', tenant.country.resolved, `${tenant.country.label} / ${tenant.country.code}${tenant.country.resolved ? '' : ' (défaut)'}`)
  line('statuts de prospect', tenant.prospectStatus !== null, tenant.prospectStatus ? `« ${tenant.prospectStatus.label} » (${tenant.prospectStatus.why})` : 'aucun')

  console.log()
  console.log(`  ${dim('les six référentiels du produit (DEC-24) — lecture seule, aucun POST au spec :')}`)
  for (const spec of vsa.REFERENTIALS) {
    const count = (referentials[spec.id] ?? []).length
    console.log(`  ${count > 0 ? good('ok  ') : warn('vide')}  ${spec.label.padEnd(28)} ${dim(`${count} valeur(s)`)}`)
  }
  const empty = vsa.REFERENTIALS.filter((s) => (referentials[s.id] ?? []).length === 0)
  if (empty.length > 0) {
    console.log()
    console.log(
      `  ${warn('These lists have no POST in the 261-path spec — this script cannot seed them.')}\n` +
        `  ${dim('Fill them in the VerySwing UI, or the compte-rendu push has no status/type/priority to send.')}`,
    )
  }
  console.log()
}

// ── writes ───────────────────────────────────────────────────────────────────

const prospectAccountBody = (account, parentCode, tenant, config) => {
  const activity = tenant.activityFor(account.sector)
  return {
    actionUserId: config.actionUserId,
    prospectStatusCode: tenant.prospectStatus.code,
    codeDisplay: account.code,
    name: account.name,
    description: account.description,
    activity: activity.code,
    mainName: account.name,
    mainAddr1: account.address.line1,
    mainZipcode: account.address.zip,
    mainCity: account.address.city,
    mainCountry: tenant.country.label,
    defaultBillingTax: asText(tenant.tax.code),
    salesUsers: config.salesUserIds,
    entities: [config.entityId],
    ...(parentCode ? { parentTiersCode: parentCode } : {}),
    mainSiren: account.siren,
    website: `https://www.${account.domain}`,
    mainEmail: `contact@${account.domain}`,
    staffSize: account.staffSize,
  }
}

const customerBody = (account, parentCode, tenant, config) => {
  const activity = tenant.activityFor(account.sector)
  return {
    entities: [config.entityId],
    name: account.name,
    description: account.description,
    codeDisplay: account.code,
    activity: activity.code,
    mainName: account.name,
    mainAddr1: account.address.line1,
    mainZipcode: account.address.zip,
    mainCity: account.address.city,
    mainCountry: tenant.country.label,
    mainCountryCode: tenant.country.code,
    salesman: config.salesUserIds,
    siren: account.siren,
    ...(parentCode ? { parentTiersCode: parentCode } : {}),
  }
}

const prospectContactBody = (contact, tenant, config) => ({
  actionUserId: config.actionUserId,
  statusCode: tenant.prospectStatus.code,
  // The account already holds the address — copying one here would be
  // inventing it, the same reason `VsaCrm.createContact` sets this.
  useParentAddr: true,
  lastname: contact.lastName,
  firstname: contact.firstName,
  gender: contact.gender,
  job: contact.job,
  email: contact.email,
  entities: [config.entityId],
})

const customerContactBody = (contact) => ({
  gender: contact.gender,
  lastname: contact.lastName,
  firstname: contact.firstName,
  job: contact.job,
  email: contact.email,
})

// ── existence ────────────────────────────────────────────────────────────────

/**
 * Does this account already exist?
 *
 * Matched on the display code **and** on the name, because VSA documents
 * `codeDisplay` as "valeur reformaté pour l'enregistrement" — what comes back
 * is not guaranteed to be what was sent, and a run that matched on the code
 * alone would happily create `Acme Industries` a second time.
 */
const findAccount = (snapshot, account) => {
  const code = fold(account.code)
  const name = fold(account.name)
  return (
    snapshot.accounts.find(
      (row) => row.kind === account.kind && (fold(row.displayCode) === code || fold(row.name) === name),
    ) ?? null
  )
}

const findProspectContact = (snapshot, email) => {
  const key = email.trim().toLowerCase()
  return snapshot.contacts.find((row) => (row.email ?? '').trim().toLowerCase() === key) ?? null
}

/**
 * The code of a prospect account that was just created.
 *
 * `POST /v1/prospect` answers `200` with no body — no id, no code — so the only
 * way to learn what it made is to ask again. Filtered by name rather than by
 * `codeDisplay` for the reformatting reason above.
 */
const relookupProspect = async (session, account) => {
  const rows = asArray(
    await session.request({
      operationPath: SEED_PATHS.listProspects.path,
      method: 'GET',
      query: { name: account.name },
    }),
  )
  const name = fold(account.name)
  const hit = rows.find((row) => fold(row?.name) === name) ?? null
  return hit ? asText(hit.code) : ''
}

// ── run ──────────────────────────────────────────────────────────────────────

const main = async () => {
  const vsaConfigModule = await load('electron/modules/crm/vsa/config.ts')

  if (!OPTIONS.offline) {
    // `.env` first, exactly as `app/main.ts` does in development — otherwise a
    // login sitting in `.env` reaches nobody and this reads like a missing
    // sandbox rather than a missing import.
    const { loadDevEnv } = await load('electron/app/devEnv.ts')
    loadDevEnv({ isDev: true, root: ROOT })
  }

  const config = OPTIONS.offline ? null : vsaConfigModule.vsaConfig()

  // Refuse first. A run that prints twenty-seven planned rows and *then* says
  // it has no credentials has buried the only sentence that matters.
  if (config === null && !OPTIONS.offline && !OPTIONS.json) {
    refuseWithoutCredentials(vsaConfigModule.missingVsaSettings())
  }

  // Under `--json`, stdout carries the document and nothing else — a banner in
  // front of it makes the flag useless to the pipe it exists for.
  const banner = OPTIONS.json ? () => {} : (line) => console.log(line)

  banner(`\n${dim(`mode     ${MODE}`)}`)
  banner(dim(`base     ${config ? config.baseUrl : '— (offline)'}`))
  if (OPTIONS.only) banner(dim(`only     ${OPTIONS.only}`))

  let steps
  try {
    steps = planSeed({ only: OPTIONS.only })
  } catch (error) {
    console.error(`\n  ${bad('Bad seed table')} — ${error.message}\n`)
    process.exit(1)
  }
  if (steps.length === 0) {
    console.error(`\n  ${warn('Nothing selected')} — no account matches --only=${OPTIONS.only}\n`)
    process.exit(1)
  }

  const accountSteps = steps.filter((s) => s.type === 'account')
  banner(dim(`records  ${accountSteps.length} account(s), ${steps.length - accountSteps.length} contact(s)\n`))

  if (OPTIONS.json) {
    console.log(JSON.stringify(steps, null, 2))
    return
  }

  renderPlan(steps)

  if (OPTIONS.offline) {
    console.log(
      `  ${dim('offline — nothing was read and nothing was written.')}\n` +
        `  ${dim('Run without --offline to check the sandbox, then --apply to create.')}\n`,
    )
    return
  }

  // Already refused above; belt and braces, because everything past this line
  // dereferences `config` and a null here would be a stack trace instead of a
  // sentence.
  if (config === null) refuseWithoutCredentials(vsaConfigModule.missingVsaSettings())

  const { VsaSession, VsaError } = await load('electron/modules/crm/vsa/http.ts')
  const { Directory } = await load('electron/modules/crm/vsa/directory.ts')
  const vsa = await load('electron/modules/crm/vsa/referentials.ts')

  const session = new VsaSession({
    baseUrl: config.baseUrl,
    credentials: { login: config.login, password: config.password, authType: config.authType },
    fetch: globalThis.fetch,
  })

  try {
    await session.token()
  } catch (error) {
    console.error(`\n  ${bad('VerySwing refused the connection')} — ${error?.message ?? error}\n`)
    process.exit(3)
  }

  const cache = new vsa.ReferentialCache({ session })
  const referentials = await cache.all()

  let tenant
  try {
    tenant = await readTenantValues(session, referentials, vsa)
  } catch (error) {
    console.error(`\n  ${bad('Could not read the tenant referentials')} — ${error?.message ?? error}\n`)
    process.exit(3)
  }
  reportTenant(tenant, referentials, vsa)

  const blockers = []
  if (tenant.activities.length === 0) blockers.push('GET /v1/crm/activity is empty — `activity` is required on every account')
  if (tenant.tax === null) blockers.push('GET /v1/referential/tax is empty — `defaultBillingTax` is required on a prospect account')
  if (tenant.prospectStatus === null) blockers.push('GET /v1/prospect/status is empty — `prospectStatusCode` is required')
  if (blockers.length > 0) {
    console.error(`  ${bad('Cannot form a create body on this tenant:')}\n`)
    for (const blocker of blockers) console.error(`    · ${blocker}`)
    console.error(`\n  ${dim('Nothing was written. Fill these in VerySwing and run again.')}\n`)
    process.exit(4)
  }

  const directory = new Directory({ session })
  let snapshot = await directory.snapshot()
  console.log(
    `${dim(`annuaire ${snapshot.accounts.length} compte(s), ${snapshot.contacts.length} contact(s) prospect déjà présents`)}\n`,
  )

  // Customer contacts have no bulk endpoint — only `/v1/crm/customer/{code}/contacts`
  // — so they are pulled per account, and only for the accounts we touch.
  const customerContactCache = new Map()
  const knownCustomerContacts = async (code) => {
    if (!customerContactCache.has(code)) {
      try {
        customerContactCache.set(code, await directory.customerContacts(code))
      } catch {
        customerContactCache.set(code, [])
      }
    }
    return customerContactCache.get(code)
  }

  console.log(rule(MODE === 'apply' ? 'Apply' : 'Dry run — nothing is written'))
  console.log()

  const codes = new Map()
  const tally = { created: 0, skipped: 0, planned: 0, failed: 0 }
  const say = (mark, label, detail) => console.log(`  ${mark}  ${label.padEnd(34)} ${dim(detail)}`)

  for (const step of steps) {
    const account = step.account

    if (step.type === 'account') {
      const existing = findAccount(snapshot, account)
      if (existing) {
        codes.set(account.key, existing.accountId)
        tally.skipped += 1
        say(good('skip  '), account.name, `déjà présent · ${existing.accountId}`)
        continue
      }

      const parentCode = account.parent ? (codes.get(account.parent) ?? null) : null
      if (account.parent && !parentCode && MODE === 'apply') {
        tally.failed += 1
        say(bad('fail  '), account.name, `parent « ${account.parent} » sans code — non créé`)
        continue
      }

      if (MODE !== 'apply') {
        tally.planned += 1
        const under = account.parent ? ` sous ${account.parent}${parentCode ? ` (${parentCode})` : ' (code à l’apply)'}` : ''
        say(warn('create'), account.name, `${account.kind}${under}`)
        continue
      }

      try {
        if (account.kind === 'customer') {
          const answer = await session.request({
            operationPath: SEED_PATHS.createCustomer.path,
            method: 'POST',
            body: customerBody(account, parentCode, tenant, config),
          })
          // Documented as a bare string. Forgiving on the way in all the same.
          const code = typeof answer === 'string' ? answer.trim() : asText(answer?.code ?? answer?.id)
          if (!code) throw new VsaError({ status: 0, message: 'client créé sans code', retryable: false })
          codes.set(account.key, code)
        } else {
          await session.request({
            operationPath: SEED_PATHS.createProspectAccount.path,
            method: 'POST',
            body: prospectAccountBody(account, parentCode, tenant, config),
          })
          const code = await relookupProspect(session, account)
          if (!code) throw new Error('created, but not found on re-query — check VerySwing before running again')
          codes.set(account.key, code)
        }
        tally.created += 1
        say(good('create'), account.name, `${account.kind} · ${codes.get(account.key)}`)
      } catch (error) {
        tally.failed += 1
        say(bad('fail  '), account.name, error?.message ?? String(error))
      }
      continue
    }

    // ── contact ─────────────────────────────────────────────────────────────
    const contact = step.contact
    const label = `${contact.firstName} ${contact.lastName}`
    const code = codes.get(account.key) ?? null

    if (!code) {
      if (MODE === 'apply') {
        tally.failed += 1
        say(bad('fail  '), label, `compte « ${account.key} » sans code`)
      } else {
        tally.planned += 1
        say(warn('create'), label, `${contact.email} → ${account.code} (code à l’apply)`)
      }
      continue
    }

    const already =
      account.kind === 'customer'
        ? (await knownCustomerContacts(code)).some(
            (row) => (row.email ?? '').trim().toLowerCase() === contact.email.toLowerCase(),
          )
        : findProspectContact(snapshot, contact.email) !== null

    if (already) {
      tally.skipped += 1
      say(good('skip  '), label, `déjà présent · ${contact.email}`)
      continue
    }

    if (MODE !== 'apply') {
      tally.planned += 1
      say(warn('create'), label, `${contact.email} → ${code}`)
      continue
    }

    try {
      if (account.kind === 'customer') {
        await session.request({
          operationPath: SEED_PATHS.createCustomerContact.path,
          method: 'POST',
          params: { code },
          body: customerContactBody(contact),
        })
        customerContactCache.set(code, [
          ...(customerContactCache.get(code) ?? []),
          { contactId: '', name: label, email: contact.email, accountId: code, kind: 'customer' },
        ])
      } else {
        await session.request({
          operationPath: SEED_PATHS.createProspectContact.path,
          method: 'POST',
          params: { code },
          body: prospectContactBody(contact, tenant, config),
        })
        // Keep the in-memory snapshot honest so a repeated email later in the
        // same run is skipped rather than created twice.
        snapshot = {
          ...snapshot,
          contacts: [
            ...snapshot.contacts,
            { contactId: '', name: label, email: contact.email, accountId: code, kind: 'prospect' },
          ],
        }
      }
      tally.created += 1
      say(good('create'), label, `${contact.email} → ${code}`)
    } catch (error) {
      tally.failed += 1
      say(bad('fail  '), label, error?.message ?? String(error))
    }
  }

  console.log()
  console.log(rule('Résultat'))
  console.log()
  if (MODE === 'apply') {
    console.log(`  ${good(`${tally.created} créé(s)`)}   ${tally.skipped} déjà présent(s)   ${tally.failed > 0 ? bad(`${tally.failed} échec(s)`) : '0 échec'}`)
  } else {
    console.log(`  ${warn(`${tally.planned} à créer`)}   ${tally.skipped} déjà présent(s)`)
    console.log(`\n  ${dim('Nothing was written. Re-run with --apply to create the rows above.')}`)
  }
  console.log()

  if (tally.failed > 0) process.exit(1)
}

// `node --test` imports this file for `planSeed`; only a direct run seeds.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
