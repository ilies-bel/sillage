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
 * It spent one round *in* `UNWIRED` as « declared debt », on the argument that the
 * seventeen tests drove the adapter's HTTP paths through it — and that argument was
 * the finding of the round after: the seventeen were the only thing holding the verb
 * up, and a permissive schema moves them onto `structured` without folding
 * validation into a test about a 429. `LlmPort` has one method now.
 *
 * So the list is **discovered**, not written: every `export interface` in
 * `electron/core/contracts/` that declares at least one method is a port, and one
 * with no `HOMES` entry **fails** with the sentence asking for one. A port added
 * next month is checked the day it is added, which is the only way the hole does
 * not come back. Nine ports, twenty-seven methods, where there was one and six.
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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
  ['AppBridge', 'electron/preload.ts'],
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
/*
 * **`scripts/` is read for ports, and never for callers.** This walked it into one
 * source set, so `check-ports.mjs` was scanned for callers of the ports it checks —
 * and its own docblock contains, as *prose about how the old regex used to be fooled*,
 * the literal strings `calendar.sync(`, `crm.resolveAccount(`,
 * `this.#crm!.pushCompteRendu(`, `spy.token(`, `updates?.state()` and
 * `this.#llm.structured<SignalReply>({`. Every one satisfies the current regex, so the
 * check was certifying **its own sentence explaining that it used to be fooled** as
 * wiring. Proved by deletion: with both `CalendarPort.sync` and `.window` unwired, the
 * gate named only `.window` — `sync` passed, held up by a comment.
 *
 * A caller is product code. `scripts/` holds the harness, the replay tools and this
 * check: none of them is the product reaching a port, and a port whose only caller is a
 * dev script is exactly the « declared but never reached » shape this file exists for.
 */
const CALLER_ROOTS = ['electron', 'src']
for (const dir of CALLER_ROOTS) walk(path.join(ROOT, dir))
/**
 * Which of the two source trees a path is in — the scope an ambient declaration has.
 *
 * `src/` and `electron/` are separate TypeScript projects with separate globals, so a
 * `declare global` in one is invisible to the other. See `ambient`.
 */
const treeOf = (file) => CALLER_ROOTS.find((root) => file.startsWith(`${root}/`)) ?? file
/**
 * **Comments are not code, and this check is about code.**
 *
 * The caller test is a grep, and a grep over a file that documents itself as heavily as
 * this repo does is a grep over prose. That has been a false green twice: `CalendarPort.sync`
 * passed for a dozen rounds on this very file's docblock *about* `CalendarPort.sync`, and
 * when round 29 widened the followers to accept a method taken as a value it reopened the
 * door — its own comment claims « Prose does not follow a method name with `(`, `.bind(`,
 * `)`, `,`, `;`, `]` or `}` », and an enumeration or a parenthetical does exactly that.
 * Measured: a live-looking `CrmPort.closeSession`, implemented and called nowhere, fails
 * the check — and one sentence in `Outbox.ts` reading « Nothing here calls
 * crm.closeSession, and this sentence is the only place the name appears » makes it pass.
 *
 * So comments and string literals are taken out before anything is matched. Narrowing the
 * *followers* could never close this, because the shape of the hole is that the text is
 * prose, not that the punctuation is unusual — every tightening would be one comma away
 * from the next false green. Replaced with spaces of the same length rather than deleted,
 * so nothing downstream that counts or slices is thrown off.
 */
const withoutProse = (source) => {
  /*
   * A single pass, not a regex: an alternation carrying `[\s\S]*?` took this check from
   * 1.5 s to 16.5 s on the same tree, measured.
   *
   * And the stripped characters are **dropped**, not spaced over. Blanking them to spaces
   * left thousand-character runs of whitespace inside the docblocks this repo is made of,
   * and the caller pattern is `receiver \s* !? \s* \?? . \s* method` — so every failed
   * match backtracked across the whole run. Same 16 s, for the opposite reason. Newlines
   * survive so a line count still means something; columns were never reported.
   */
  const out = Array.from(source)
  const blank = (from, to) => {
    for (let at = from; at < to; at += 1) if (out[at] !== '\n') out[at] = ''
  }
  let at = 0
  while (at < source.length) {
    const two = source.slice(at, at + 2)
    if (two === '//') {
      const end = source.indexOf('\n', at)
      blank(at, end === -1 ? source.length : end)
      at = end === -1 ? source.length : end
      continue
    }
    if (two === '/*') {
      const end = source.indexOf('*/', at + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(at, stop)
      at = stop
      continue
    }
    const ch = source[at]
    if (ch === "'" || ch === '"' || ch === '`') {
      let cursor = at + 1
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2
          continue
        }
        if (source[cursor] === ch) break
        // An unterminated single- or double-quoted string cannot cross a line.
        if (ch !== '`' && source[cursor] === '\n') break
        cursor += 1
      }
      blank(at, Math.min(cursor + 1, source.length))
      at = Math.min(cursor + 1, source.length)
      continue
    }
    at += 1
  }
  return out.join('')
}
const text = new Map(
  sources.map((file) => [file, withoutProse(readFileSync(path.join(ROOT, file), 'utf8'))]),
)

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
  /**
   * Receivers a `.d.ts` or an ambient `declare` makes available — **mapped to the tree
   * that can see them**, not to the whole repo.
   *
   * It was a flat set, and `src/vite-env.d.ts` declares `app: AppBridge` inside
   * `declare global`, so `app` counted as a receiver of `AppBridge` in **every** file —
   * including `electron/app/main.ts`, where `app` is *Electron's* `App` object. Measured
   * (`scratch/r28-ports-callers.mjs`): `AppBridge.on` reported five callers, four of them
   * `app.on('before-quit')`, `app.on('second-instance')`, `app.on('window-all-closed')`
   * and `app.on('activate')`. The verb is genuinely wired today by the fifth, so it was a
   * measurement hole rather than a live false green — and it could never have gone red
   * while `main.ts` registers an Electron lifecycle handler, which it always will.
   *
   * The same shape round 27 scoped per file to stop `port.close(` in a whisper worker
   * adopting a dead `CrmPort.close`, reopened by the one escape hatch that had to exist.
   * An ambient declaration is scoped by the *project* that includes it — `src/` and
   * `electron/` have separate tsconfigs, and the renderer's globals are not the main
   * process's — so the tree of the declaring file is the honest scope.
   */
  const ambient = new Map()
  /**
   * Receivers **per file**, because a bare name is not a port.
   *
   * They were collected into one flat tree-wide set and matched in every file, with no
   * requirement that the calling file hold the port. `port` was therefore a receiver of
   * `CrmPort`, `LlmPort` *and* `KeyValueStore`, harvested from three test files — and in
   * the product it is a `MessagePort` and a `--port` CLI string. So a brand-new
   * `CrmPort.close()` implemented nowhere passed, adopted by `port.close(` in a whisper
   * worker, and `CrmPort.indexOf` would have passed on `port.indexOf(`.
   *
   * A name counts where its own file says what it holds. A `.d.ts` or an ambient
   * `declare` is the exception and counts everywhere, because that is exactly what those
   * files are for — `window.app` is declared once and used across the renderer.
   */
  const perFile = new Map()
  const annotation = new RegExp(
    `(#?[A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*(?:readonly\\s+)?${port.interface}\\b`,
    'g',
  )
  for (const [file, source] of text) {
    const here = new Set()
    for (const hit of source.matchAll(annotation)) {
      here.add(hit[1])
      receivers.add(hit[1])
      if (/\.d\.ts$/.test(file) || /declare\s+(?:global|module|const|let|var)/.test(source)) {
        ambient.set(hit[1], treeOf(file))
      }
    }
    perFile.set(file, here)
  }
  if (receivers.size === 0) {
    problems.push(
      `${port.interface} n’est le type d’aucune variable, champ ou paramètre du dépôt — ` +
        'personne n’en tient un, donc la question « qui appelle ses méthodes » ne peut ' +
        'pas être posée. Câble-le, ou supprime le port.',
    )
    continue
  }
  /**
   * The alternation each file is matched with, and the compiled patterns, built once.
   *
   * The per-file scoping above arrived as a fresh `RegExp` *inside* the method loop —
   * twenty-eight methods over two hundred files, and most files hold an identical small
   * receiver set, so the same pattern was compiled some hundreds of times for no reason.
   * The key is the sorted set, so files that hold the same receivers share one pattern,
   * and a file whose text does not contain the method's name anywhere is never matched
   * at all. Measured over the whole tree: 6.2 s → 1.5 s.
   */
  const alternationOf = new Map()
  for (const file of sources) {
    const tree = treeOf(file)
    const here = [
      ...(perFile.get(file) ?? []),
      // Only the ambient names this file's own project can see — see `ambient`.
      ...[...ambient].filter(([, where]) => where === tree).map(([name]) => name),
    ]
    if (here.length === 0) continue
    alternationOf.set(file, here.sort().map((r) => r.replace(/\$/g, '\\$')).join('|'))
  }
  const compiled = new Map()

  for (const method of port.methods) {
    checked += 1
    const key = `${port.interface}.${method}`
    const exempt = UNWIRED.find((entry) => entry.method === key)
    const callers = sources.filter((file) => {
      if (file === port.file) return false
      if (inHome(file, home)) return false
      if (isTest(file)) return false
      // The receivers this file itself declares, plus the ambient ones — see `perFile`.
      const alternation = alternationOf.get(file)
      if (alternation === undefined) return false
      const source = text.get(file)
      if (!source.includes(method)) return false
      const cacheKey = `${alternation}|${method}`
      let scoped = compiled.get(cacheKey)
      if (scoped === undefined) {
        /*
         * `receiver` `!`? `?`? `.` `method` `<…>`? and then **either a call or a
         * reference** — `crm.resolveAccount(`, `this.#crm!.pushCompteRendu(`,
         * `updates?.state()`, `this.#llm.structured<SignalReply>({`, and also
         * `updates.install.bind(x)` or `updates.install)` passed as a callback.
         *
         * The paren used to be required adjacent, and that made the check fail on an
         * ordinary respelling of **live** code: replacing
         * `(await deps.updates?.install()) ?? false` with a `.bind` and a call through the
         * bound reference type-checks clean (`tsc` exit 0) and took `check:ports` to exit
         * 1 — « UpdatePort.install n'est appelé nulle part ». The remedy its own sentence
         * names is an `UNWIRED` entry, which is standing permission on working code and
         * exactly the rot that list is documented to prevent. A method taken as a value
         * *is* the port being reached.
         *
         * The followers are enumerated rather than dropped, because « anything » would
         * re-admit the false green round 27 closed: a docblock in a caller file writing
         * `updates.install` inside backticks would satisfy a bare word boundary, which is
         * the shape that let `CalendarPort.sync` pass on prose about `CalendarPort.sync`.
         * Prose does not follow a method name with `(`, `.bind(`, `)`, `,`, `;`, `]` or `}`.
         */
        scoped = new RegExp(
          `(?:${alternation})\\s*!?\\s*\\??\\.\\s*${method}\\s*(?:<[^<>;={}]*>\\s*)?` +
            '(?:\\(|\\.(?:bind|call|apply)\\s*\\(|[),;\\]}])',
        )
        compiled.set(cacheKey, scoped)
      }
      return scoped.test(source)
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
for (const [name, home] of HOMES) {
  /*
   * **A home that is not there is not a home** — and this table named
   * `electron/app/preload.ts`, which has never existed: the preload is
   * `electron/preload.ts`. So `inHome` excluded nothing, the *implementation* was
   * scanned as a caller of its own port, and the sentence a failure prints pointed at a
   * file nobody could open. The `check-platform.mjs` half that matters most is that an
   * allowance whose target has gone fails rather than quietly widening; this table had no
   * such rule, and a wrong path here loosens the check in exactly the direction it must
   * not loosen.
   */
  const target = path.join(ROOT, home)
  if (!existsSync(target)) {
    problems.push(
      `HOMES place ${name} dans ${home}, qui n’existe pas — un dossier d’implémentation ` +
        'introuvable n’exclut rien, donc le fichier qui implémente le port est compté ' +
        'parmi ses appelants et la phrase d’échec désigne un fichier inexistant.',
    )
  }
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
