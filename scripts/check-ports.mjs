#!/usr/bin/env node
/**
 * **A declared port method that nothing calls is not a feature.**
 *
 * The fourteenth adversarial round stopped reading screens and asked which
 * declared behaviour is actually reached. Four verbs on `CrmPort` —
 * `resolveAccount`, `listSiblings`, `createContact`, `attachTranscript` — were
 * declared, implemented in `VsaCrm`, unit-tested, and a grep for them outside
 * `modules/crm` returned **the declarations and nothing else**.
 *
 * That is not a tidiness problem. `facts.account` was therefore
 * `UNRESOLVED_ACCOUNT` on every meeting the product had ever produced, so
 * `reviewGate.ts`'s `opportunityPossible` — which reads `edits.accountId !==
 * null` — was structurally false: the VerySwing opportunity **could not be
 * created**, and every compte-rendu task shipped as an orphan with no
 * `linkType`. Two of the three things the one button promises could not happen,
 * on the deliverable DEC-28 calls first. Throughout, `npm test` was green,
 * `IMPLEMENTATION.md` marked the step `[x]`, and the screenshot harness
 * photographed a gate that looked finished.
 *
 * A unit test proves a module does what it says. Nothing proved anybody asked.
 *
 * So every method on a port declared in `core/contracts/` has to be called from
 * outside the module that implements it, or be listed below with the reason it
 * is not — the same shape as `check-platform.mjs`, and for the same reason: an
 * exemption you cannot see is an exemption that grows.
 *
 * ## Round 26: it asked that of one port out of nine, and its caller test was
 * satisfied by `async (`
 *
 * `PORTS` was a hand-written list with **one entry**, `CrmPort`, under a docblock
 * and a `CLAUDE.md` paragraph that both say « every method on a port declared in
 * `core/contracts/` ». Applying the check's own question by hand to the rest found
 * exactly the shape it exists for: **`LlmPort.complete`** — declared, implemented
 * in `OpenAiCompatibleLlm`, unit-tested seventeen times, and called from no file
 * in the repo outside its own tests. Not in `UNWIRED`, and never looked at.
 *
 * So the list is **discovered**, not written: every `export interface` in
 * `electron/core/contracts/` that declares at least one method is a port, and one
 * with no `HOMES` entry **fails** with the sentence asking for one. A port added
 * next month is checked the day it is added, which is the only way the hole does
 * not come back. Nine ports, twenty-eight methods, where there was one and six.
 *
 * ### The caller test had to change twice over, and both directions were measured
 *
 * It was `[.\w]${method}\s*\(`, and that is wrong in both directions at once.
 *
 * **False green, and comprehensively.** `[.\w]` lets the method name be the *tail
 * of another identifier*, so `CalendarPort.sync` was satisfied by
 * `readFileSync(`, `execFileSync(` — and, best of all, by **`async (`**. Measured:
 * `sync` matched in **40 files**, of which **2** actually call `calendar.sync(`.
 * `UpdatePort.state` matched an `INSERT INTO app_state (` in `AppState.ts`;
 * `UpdatePort.check` matched `onRecheck(row.id)` in `Reglages.tsx`. Any port verb
 * whose name ends another identifier anywhere in the tree was green for free, and
 * could never go red.
 *
 * **False red, on the verb that matters most.** The regex demands `(` right after
 * the name, and `LlmPort.structured` is generic: every one of its three real
 * callers writes `this.#llm.structured<SignalReply>({`, `this.#llm.structured<T>({`,
 * `llm.structured<AskDraft>({`. Naive hits: **0**. So the moment this check had
 * been pointed at `LlmPort` as written, it would have reported the *live*
 * extraction path — the compte-rendu, the signal rail and *Demander* — as dead
 * code, beside a genuinely dead `complete`. A check that cries wolf about the one
 * path the product cannot run without is a check somebody adds to an ignore list.
 *
 * **What replaced it is a receiver, not a name.** A port is held in something and
 * called on it, so the caller test is « an identifier this tree *types as this
 * port* , followed by a dot, followed by the method ». The receiver names are
 * derived from the type annotations themselves — `llm: LlmPort`, `#crm: CrmPort`,
 * `NULL_CALENDAR: CalendarPort`, `{ port: LlmPort }` — never hand-listed, so they
 * cannot go stale. `!` and `?.` are allowed between (`this.#crm!.pushCompteRendu(`,
 * `updates?.state()`), and so is a type-argument list.
 *
 * That is what makes the three-verb ports checkable at all. `KeyValueStore.get`,
 * `SecretVault.get` and `DiagRecorder.record` are `.get(` and `.record(` — names
 * shared with `Map`, `URLSearchParams` and `z.record(`, matched in 41, 41 and 28
 * files by the old test and therefore measuring nothing. Required to sit on `kv`,
 * `#vault` or `#diagnostics`, they measure something, and they can go red.
 *
 * **Two things this check is deliberately not, argued rather than left implied.**
 * The receiver names are derived from *every* annotation in the tree, tests
 * included, so a test that writes `const spy: IdentityPort = …` contributes `spy`
 * to that port's receiver set and a non-test `spy.token(` would satisfy it. That
 * is a loosening, and it is still incomparably tighter than the name alone —
 * `token` matched six files either way here, and the alternative, deriving
 * receivers from non-test files only, would report a port held solely by a test
 * as uncalled, which is the same finding stated worse. And the scope is
 * `core/contracts/` as the rule says, so a port declared **inside** the module
 * that implements it is invisible to this gate by construction. There is exactly
 * one: `MailPort` in `modules/mail/OutlookMail.ts`. Its single verb is reached
 * (`Outbox.ts:383`), so there is no debt hiding behind it today, and the two ways
 * to bring it in are both larger than this file — move the interface into
 * `core/contracts/` beside `CrmPort`, which is product code, or widen discovery to
 * `electron/modules/**`, which would sweep in every internal interface with a
 * method on it and make this the noisy check nobody keeps.
 *
 * **What a receiver test cannot see, stated rather than implied.** A port called
 * straight off a call expression — `getLlm().structured(…)` — has no named
 * receiver and would read as uncalled. There is no such call in the tree today
 * (every one of the twenty-eight goes through a field or a parameter), and the
 * remedy when one appears is to bind it (`const llm = getLlm()`), not to loosen
 * this back towards `async (`. Two guards keep the check from silently measuring
 * nothing if that ever stops being true: a port whose receiver set comes back
 * **empty** is a finding in its own right, and a `HOMES` entry that is no longer
 * discovered as a port with methods is a finding too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS = 'electron/core/contracts'

/**
 * Where each port's implementation lives — a call from inside the implementing
 * module is not a caller, it is the module talking to itself.
 *
 * This is a **declaration, not the list of what gets checked**: the ports are
 * discovered from `core/contracts/`, and a discovered port missing from here
 * fails, as does an entry here that is no longer a port with methods. Before
 * round 26 the *list itself* was hand-written, which is how eight of nine ports
 * went unasked.
 *
 * A value ending in `/` is a directory prefix; anything else is one file.
 */
const HOMES = new Map([
  ['CalendarPort', 'electron/modules/calendar/'],
  ['CrmPort', 'electron/modules/crm/'],
  ['IdentityPort', 'electron/modules/identity/'],
  ['LlmPort', 'electron/modules/llm/'],
  ['UpdatePort', 'electron/modules/update/'],
  ['DiagRecorder', 'electron/modules/diagnostics/'],
  ['KeyValueStore', 'electron/modules/store/'],
  // `SecretVault`'s two implementations (`keychainVault`, `memoryVault`) live in
  // `modules/identity/vault.ts`, where the keytar I/O is.
  ['SecretVault', 'electron/modules/identity/'],
  // The renderer bridge. `preload.ts` is the implementation; `src/app/bridge.ts`
  // is the caller. Its *channels* are checked by `check-surfaces.mjs`; what is
  // checked here is only that the two verbs carrying them are reached.
  ['AppBridge', 'electron/app/preload.ts'],
])

/**
 * Declared, implemented, and deliberately not wired — each keyed
 * `Interface.method`, with the reason and with what it would take. Delete an
 * entry the day it gets a caller; the check fails on an allowance whose method
 * has since disappeared **and** on one whose method has since acquired a caller,
 * so this list cannot rot into a blanket exemption.
 *
 * Keyed by the interface as well as the method — round 26, the same narrowing
 * `check-platform.mjs`'s allowance needed. A bare `attachTranscript` exempted
 * that name on *every* port, and with nine ports in scope rather than one,
 * `get`, `set`, `delete`, `state` and `check` are names two ports share.
 */
const UNWIRED = [
  {
    method: 'CrmPort.attachTranscript',
    why:
      'Attacher la transcription verbatim d’un appel client à une tâche VerySwing ' +
      'partagée est une divulgation, pas une amélioration : la transcription est ' +
      'la preuve que le produit conserve (DEC-12 ne jette que l’audio), et la ' +
      'pousser dans le CRM du client change qui peut la lire. Cela vaut une ' +
      'quatrième intention dans la liste du gate — visible, décochable, jamais ' +
      'cochée par défaut (DEC-4, DEC-20) — et cette décision n’est pas prise.',
  },
  {
    method: 'CrmPort.createContact',
    why:
      'Créer un contact dans le CRM du client depuis un participant du calendrier ' +
      'écrit une fiche que personne n’a relue. Même argument : une intention au ' +
      'gate, pas un effet de bord de l’extraction.',
  },
  {
    /**
     * Found by round 26, by asking this check's own question of the eight ports
     * it was not asking it of. Genuinely unreached — 0 callers under the naive
     * regex, under a receiver-aware one, and under a bare grep for `complete`
     * anywhere in `electron/` or `src/` — and unreached *for a stated reason*,
     * which is what makes it an `UNWIRED` entry rather than a bug.
     *
     * `core/contracts/llm.ts` points `complete` at `modules/signals/` by name
     * (« ~1 call per minute *during* a live call »). `SignalExtractor`'s docblock
     * then has a section headed « ## Why `structured` and not `complete` » that
     * rejects it: « a reply this small is not slower for being schema-held, and
     * the alternative is parsing prose — a guess rendered as a fact, on a surface
     * with no room for a caveat ». `modules/extract/__tests__/recipe.test.ts:134`
     * goes further and stubs it to *reject*: « the recipe must not use
     * complete() ».
     *
     * So this is not debt waiting on wiring, and the honest resolution is the
     * opposite of wiring: **delete `complete` from `LlmPort` and from
     * `OpenAiCompatibleLlm`**, which is product code and outside the scope that
     * found it. It is declared here meanwhile because the cost of leaving it is
     * not nothing: `llm.ts`'s own docblock — « Two verbs, because there are
     * exactly two jobs » — is now false documentation of the contract every
     * adapter is written against, and an un-schema'd prose channel on the port is
     * standing permission to send a model's unvalidated text somewhere, against
     * « Zod schemas for every LLM output ».
     */
    method: 'LlmPort.complete',
    why:
      'Le canal prose du port, que son seul consommateur prévu a refusé par écrit : ' +
      '`core/contracts/llm.ts` désigne `modules/signals/` pour `complete`, et ' +
      '`SignalExtractor` appelle `structured` à la place — « analyser de la prose, ' +
      'c’est une supposition présentée comme un fait, sur une surface qui n’a pas ' +
      'la place d’une réserve ». `recipe.test.ts` va plus loin et le fait échouer ' +
      'exprès : « the recipe must not use complete() ». Le câbler serait donc une ' +
      'décision contre la règle « un schéma Zod pour toute sortie de modèle » ; la ' +
      'résolution honnête est de le **supprimer** de `LlmPort` et de ' +
      '`OpenAiCompatibleLlm`, ce qui est du code produit. Déclaré ici en attendant, ' +
      'parce que le laisser n’est pas gratuit : le docblock de `llm.ts` (« deux ' +
      'verbes, parce qu’il y a exactement deux métiers ») décrit désormais un ' +
      'contrat faux à tout adaptateur qui l’implémente.',
  },
]

const sources = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-electron') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(ts|tsx|mjs)$/.test(entry)) sources.push(path.relative(ROOT, full))
  }
}
for (const dir of ['electron', 'src', 'scripts']) walk(path.join(ROOT, dir))
const text = new Map(sources.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]))

const isTest = (file) => /__tests__|\.test\.|\.spec\./.test(file)
const inHome = (file, home) => (home.endsWith('/') ? file.startsWith(home) : file === home)

/**
 * Every `export interface` in `core/contracts/` that declares at least one
 * method, with those methods.
 *
 * A method is `name(`, `name?(` or `name<T>(` at two spaces of indent — which is
 * how they are written here, and the generic form is the one the old method regex
 * could not read. An interface with **no** methods is data (`DiagInput`,
 * `CredentialState`, `AppStatus`, `LlmRequest`, `RecipeDescriptor`, `EssaiLine`),
 * and data is checked by `tsc`, not by asking who calls it.
 */
const discovered = []
for (const file of readdirSync(path.join(ROOT, CONTRACTS))) {
  if (!file.endsWith('.ts')) continue
  const rel = `${CONTRACTS}/${file}`
  const source = text.get(rel)
  if (source === undefined) continue
  for (const match of source.matchAll(
    /^export interface ([A-Za-z]\w*)(?:<[^>]*>)?\s*(?:extends [^{]*)?\{/gm,
  )) {
    const start = match.index + match[0].length
    const end = source.indexOf('\n}', start)
    const body = source.slice(start, end === -1 ? undefined : end)
    const methods = [
      ...body.matchAll(/^ {2}(?:readonly\s+)?([a-zA-Z]\w*)\??\s*(?:<[^<>]*>)?\s*\(/gm),
    ].map((m) => m[1])
    if (methods.length > 0) discovered.push({ interface: match[1], file: rel, methods })
  }
}

const problems = []
let checked = 0

for (const port of discovered) {
  const home = HOMES.get(port.interface)
  if (home === undefined) {
    problems.push(
      `${port.interface} (${port.file}) déclare ${port.methods.length} méthode(s) et n’est pas ` +
        'dans HOMES de scripts/check-ports.mjs — dis où il est implémenté pour qu’on puisse ' +
        'demander qui l’appelle. Un port qu’on n’interroge pas est le défaut que ce contrôle existe pour attraper.',
    )
    continue
  }

  // Receivers: every identifier this tree annotates with the port's type. Derived
  // rather than listed, so they cannot go stale.
  const receivers = new Set()
  const annotation = new RegExp(
    `(#?[A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*(?:readonly\\s+)?${port.interface}\\b`,
    'g',
  )
  for (const source of text.values()) {
    for (const hit of source.matchAll(annotation)) receivers.add(hit[1])
  }
  if (receivers.size === 0) {
    problems.push(
      `${port.interface} n’est le type d’aucune variable, champ ou paramètre du dépôt — ` +
        'personne n’en tient un, donc la question « qui appelle ses méthodes » ne peut ' +
        'pas être posée. Câble-le, ou supprime le port.',
    )
    continue
  }
  const receiverAlternation = [...receivers].map((r) => r.replace(/\$/g, '\\$')).join('|')

  for (const method of port.methods) {
    checked += 1
    const key = `${port.interface}.${method}`
    const exempt = UNWIRED.find((entry) => entry.method === key)
    // `receiver` `!`? `?`? `.` `method` `<…>`? `(` — the shapes the tree actually
    // writes: `crm.resolveAccount(`, `this.#crm!.pushCompteRendu(`,
    // `updates?.state()`, `this.#llm.structured<SignalReply>({`.
    const call = new RegExp(
      `(?:${receiverAlternation})\\s*!?\\s*\\??\\.\\s*${method}\\s*(?:<[^<>;={}]*>\\s*)?\\(`,
    )
    const callers = sources.filter((file) => {
      if (file === port.file) return false
      if (inHome(file, home)) return false
      if (isTest(file)) return false
      return call.test(text.get(file))
    })

    if (callers.length === 0 && !exempt) {
      problems.push(
        `${key} n’est appelé nulle part hors de ${home} — câble-le, ou déclare-le dans UNWIRED avec la raison.`,
      )
    }
    if (callers.length > 0 && exempt) {
      problems.push(
        `${key} est déclaré non câblé et pourtant appelé (${callers[0]}) — retire l’entrée de UNWIRED.`,
      )
    }
  }
}

const declaredMethods = new Set(
  discovered.flatMap((port) => port.methods.map((method) => `${port.interface}.${method}`)),
)
for (const entry of UNWIRED) {
  if (!declaredMethods.has(entry.method)) {
    problems.push(
      `UNWIRED mentionne ${entry.method}, qui n’est pas une méthode d’un port découvert — ` +
        'une dispense dont la méthode a disparu est une dispense qui pourrit.',
    )
  }
}
for (const [name] of HOMES) {
  if (!discovered.some((port) => port.interface === name)) {
    problems.push(
      `HOMES déclare ${name}, que ce contrôle ne trouve plus comme port à méthodes dans ` +
        `${CONTRACTS}/ — soit il a été supprimé et l’entrée doit partir, soit ses méthodes ne ` +
        'sont plus lisibles par ce scanner, et un port qu’on ne lit plus est un port qu’on ne vérifie plus.',
    )
  }
}

if (problems.length > 0) {
  console.error(`\nports declared and never called (${problems.length}):\n`)
  for (const line of problems) console.error(`  ${line}`)
  console.error('')
  process.exit(1)
}

console.log(
  `ports ok — ${discovered.length} port(s) découvert(s) dans ${CONTRACTS}/, ` +
    `${checked} méthode(s) vérifiées, ${UNWIRED.length} non câblée(s) et déclarée(s)`,
)
