/**
 * **A surface that is declared and never reached.**
 *
 * `check-ports.mjs` asks this question of every port declared in `core/contracts/`
 * — nine of them, discovered rather than listed. It began with one, `CrmPort`,
 * because that is where it was first asked: four declared verbs, implemented and
 * unit tested, called by nothing, and the VerySwing opportunity was therefore
 * structurally impossible on every meeting the product had ever produced. It stayed
 * at that one for a dozen rounds while its own docblock claimed all of them, which is
 * the same gap between prose and wiring that this check exists to close.
 *
 * The fifteenth adversarial round said the check was right and its scope was
 * the problem, and gave the general form of the defect: **the repo's prose is
 * being trusted as if it were wiring.** A docblock is evidence of intent and
 * never of behaviour, and this codebase's docblocks are good enough to be
 * convincing — so the failures that survive here are exactly the ones where a
 * beautifully argued comment describes a path nothing walks. Four were found by
 * hand in that round and all four are the same shape:
 *
 *   · `transcript:appended` — broadcast for every segment of every meeting
 *     since the orchestrator was written, subscribed to by **no window**;
 *   · `diag:appended` — subscribed to by Réglages, published by **nobody**, so
 *     the diagnostics pane never moved while a rep watched it;
 *   · `models:state` — an invoke channel with a paragraph explaining the bug it
 *     was written to fix, called by **no renderer**, and answering exactly what
 *     `settings:snapshot` already answers;
 *   · `vad.rs` — a hundred and forty lines of Rust, referring to Google STT and
 *     a Swift implementation, never declared as a module and therefore never
 *     compiled since the day the previous product was demolished.
 *
 * So this is that grep, run for you, across the three boundaries where
 * « declared » and « reached » are different files:
 *
 *   1. an **invoke channel** with no caller under `src/` — the renderer is the
 *      only thing that may call one;
 *   2. a **broadcast channel** with no publisher under `electron/`, or no
 *      subscriber under `src/`. Both halves matter and they fail differently:
 *      no publisher is a screen that never updates, no subscriber is work the
 *      main process does for nobody;
 *   3. a **Rust source file** that no `mod` declaration names, which does not
 *      compile and cannot be reached however good its contents are;
 *   4. a **field on an invoke channel's response** that no screen reads — the
 *      same shape one level down, inside a payload instead of on a channel.
 *      `history:search` shipped `scanned` on every answer since the channel
 *      existed, read by a test and by nothing else, while the scan it describes
 *      silently stopped at five hundred meetings and the screen said « Aucun
 *      appel ne correspond » about a call it held. A channel that is called is
 *      reached; a *field* on it need not be, and nothing asked.
 *
 * Same shape as `check-platform.mjs` and `check-ports.mjs`, including the half
 * that matters most: an allowance whose subject has since disappeared also
 * fails, so `UNREACHED` cannot rot into a blanket exemption.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Declared, unreached, and deliberately so — each with the reason.
 *
 * Empty today, and that is the point: every entry the fifteenth round found has
 * been wired or deleted rather than excused. A channel that belongs here is one
 * whose consumer is a decision nobody has taken yet, stated as such.
 */
const UNREACHED = []

/**
 * Response fields that ship and are read by no screen, each with the reason and
 * what wiring it would cost — the `check-ports.mjs` `UNWIRED` shape, because
 * these are the same kind of thing: a declared surface whose consumer is a
 * decision nobody has taken. An entry whose field has since gone also fails.
 */
const UNREAD = [
  {
    subject: 'MeetingSchema.confirmedAt',
    why:
      'MeetingSchema est l’entité du domaine et voyage entière : ces deux ' +
      'colonnes partent parce qu’une réunion les porte, pas parce qu’un écran ' +
      'les a demandées. `confirmedAt` — l’instant où le commercial a validé — ' +
      'vaudrait une ligne « Validée le … » dans Historique ; c’est une décision ' +
      'de produit, et elle n’est pas prise.',
  },
  {
    subject: 'MeetingSchema.updatedAt',
    why:
      'La dernière fois que le journal a touché la ligne, ce qui n’est pas une ' +
      'date : `meetingAnchor` existe précisément parce que trier là-dessus ' +
      'plaçait un appel validé en retard au-dessus d’un appel tenu deux jours ' +
      'après lui. Aucun écran ne doit le lire ; il reste dans le contrat parce ' +
      'que la projection le porte.',
  },
  {
    subject: 'HistoryRecordSchema.overall',
    why:
      'La confiance agrégée de l’extraction (DEC-21). Le lecteur dessine la ' +
      'confiance **par champ**, qui est la seule qui désigne quelque chose à ' +
      'vérifier ; un verdict global au-dessus d’eux dirait « ⚠ faible » sans ' +
      'dire de quoi. Le câbler, c’est choisir cette phrase — décision non prise.',
  },
]

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-electron', 'target', 'vendor'].includes(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(ts|tsx|mjs|rs)$/.test(entry)) files.push(path.relative(ROOT, full))
  }
}
for (const dir of ['electron', 'src', 'scripts', 'native-module/src']) {
  walk(path.join(ROOT, dir))
}

const text = new Map(files.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]))
/*
 * Test code, which is neither a surface to reach nor a caller that reaches one.
 *
 * `src/test/` is in here for the second reason and it took widening this check to
 * `.ts` to notice: `appBridge.ts` is imported by eleven `__tests__` files and by
 * nothing else, so with tests excluded as callers — « a test is not a caller », the
 * rule this whole file exists to enforce — a shared test helper is unreachable by
 * construction. Excusing it in `UNREACHED` would have been the wrong fix: the
 * entry would be true, permanent and meaningless, and the list is for things that
 * *should* be wired and are not.
 */
const isTest = (file) => /__tests__|\.test\.|^src\/test\//.test(file)

/**
 * Where the two channel lists are, and how they are told apart.
 *
 * The contract declares them in one file as two object literals, so the split
 * is the comment between them — which is fragile and is checked: if either
 * list comes back empty, this exits rather than reporting that nothing is
 * unreached, because a check that silently measures nothing is worse than no
 * check (the `--contrast` graphic pass shipped green for a round doing exactly
 * that).
 */
const CONTRACT = 'electron/core/contracts/ipc.ts'
const contract = text.get(CONTRACT)
const split = contract.indexOf('Main → renderer')
/*
 * The channel keys, as the contract spells them.
 *
 * `[a-zA-Z:]+` was the first version and it could not see a digit, a hyphen or
 * an underscore — so `'models:v2progress'` would have been invisible to every
 * rule below and passed in silence, which is the failure mode this whole file
 * exists to end. The class is now everything a JavaScript key can hold short of
 * a quote.
 */
const channelsIn = (slice) => [...slice.matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1])
const invokeChannels = channelsIn(contract.slice(0, split))
const broadcastChannels = channelsIn(contract.slice(split))

const problems = []

if (split < 0 || invokeChannels.length === 0 || broadcastChannels.length === 0) {
  problems.push(
    `${CONTRACT}: aucun canal lu (invoke=${invokeChannels.length}, broadcast=${broadcastChannels.length}) — ` +
      'ce contrôle ne mesure plus rien et doit être mis à jour.',
  )
}

/**
 * Strip line and block comments, crudely and deliberately.
 *
 * A mention is supposed to be a *call*, and this check was satisfied by the
 * channel name appearing anywhere at all — including in a comment. In a
 * codebase whose comments name every channel they reason about, that is not a
 * theoretical hole: `// TODO: re-wire 'transcript:appended'` on its own kept the
 * build green while nothing subscribed. Stripping comments is not parsing, and
 * it does not need to be: a string literal containing `//` survives because the
 * quote comes first, and the worst case of getting it wrong is a false *failure*
 * that somebody reads.
 */
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    /*
     * The guard used to be `[^:'"\`\\]`, meant to spare `https://` and a `//`
     * inside a string — and it spared a great deal more: a `//` written
     * immediately after a quote, a backtick or a colon was left in the code,
     * so `const label = 'rien'// 'meeting:purgeAll' -- à recâbler` passed this
     * check. Only `:` and `\` can precede a *real* `//` that is not a comment
     * (`https://`, a Windows escape); a quote before one closes a string and the
     * rest of the line is a comment like any other.
     */
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')

const bodies = new Map(files.map((file) => [file, code(text.get(file))]))

/** Files that *call* the channel, excluding the contract, tests and comments. */
const mentions = (channel, where) =>
  files.filter(
    (file) =>
      file !== CONTRACT &&
      !isTest(file) &&
      where(file) &&
      (bodies.get(file) ?? '').includes(`'${channel}'`),
  )

const excused = (subject) => UNREACHED.find((entry) => entry.subject === subject)

for (const channel of invokeChannels) {
  const callers = mentions(channel, (file) => file.startsWith('src/'))
  if (callers.length === 0 && !excused(channel)) {
    problems.push(
      `le canal « ${channel} » est déclaré et n’est appelé par aucun écran — ` +
        'câble-le, supprime-le, ou déclare-le dans UNREACHED avec la raison.',
    )
  }
  if (callers.length > 0 && excused(channel)) {
    problems.push(`« ${channel} » est déclaré inatteignable et pourtant appelé (${callers[0]}).`)
  }
}

for (const channel of broadcastChannels) {
  // The preload forwards every channel generically, so it is not a publisher.
  const publishers = mentions(
    channel,
    (file) => file.startsWith('electron/') && !file.includes('preload'),
  )
  const subscribers = mentions(channel, (file) => file.startsWith('src/'))
  if (excused(channel)) {
    if (publishers.length > 0 && subscribers.length > 0) {
      problems.push(`« ${channel} » est déclaré inatteignable et pourtant câblé des deux côtés.`)
    }
    continue
  }
  if (publishers.length === 0) {
    problems.push(
      `la diffusion « ${channel} » n’est émise par personne — un écran qui l’écoute ne bougera jamais.`,
    )
  }
  if (subscribers.length === 0) {
    problems.push(
      `la diffusion « ${channel} » n’est écoutée par aucun écran — c’est du travail fait pour personne.`,
    )
  }
}

const rust = files.filter((file) => file.endsWith('.rs'))
const declared = new Set()
for (const file of rust) {
  /*
   * `bodies`, not `text`: this rule read the **raw** source where every other
   * rule reads the comment-stripped one, so `/*\nmod zombie;\n*\/` at the top of
   * `lib.rs` declared a module to this check and to no compiler. The `//` form
   * was caught only by luck — the `^\s*` anchor does not match `// mod x;`.
   */
  for (const match of (bodies.get(file) ?? '').matchAll(/^\s*(?:pub )?mod ([a-z_0-9]+)\s*;/gm)) {
    declared.add(match[1])
  }
}
for (const file of rust) {
  const base = path.basename(file, '.rs')
  // A crate root and a directory's own `mod.rs` are declarations, not modules.
  if (['lib', 'main', 'mod', 'build'].includes(base)) continue
  if (!declared.has(base) && !excused(file)) {
    problems.push(
      `${file} n’est déclaré par aucun \`mod\` — il n’est pas compilé, quoi qu’il contienne.`,
    )
  }
}

/*
 * **The fourth boundary, and the one the nineteenth round found by hand.**
 *
 * The three above ask « declared where, reached where » of an IPC invoke
 * channel, an IPC broadcast and a Rust `mod`; `check:ports` asks it of a method
 * on a port declared in `core/contracts/`. **Neither asks it of a method on a
 * class in `electron/app/session/`** — which is where the state machine, the
 * outbox and the enhancement runner live, and therefore where a method nobody
 * calls costs the most.
 *
 * Three were found there at once, all the same shape and all green in every
 * suite: `Outbox.isDraining` (declared, documented, unit-tested, and the quit
 * path that needed exactly that question asked a different one, so a push in
 * flight was abandoned); `Enhancement.isRunning` (the same question about
 * extraction, which nothing asks); and `EndOfMeetingWatch.manual` — « the rep
 * pressed *Terminer* » — for which there was no *correct* caller either, since
 * `stopRecording` already calls `stop()` on that watch and `manual()` would have
 * fired `onEnd` on a meeting the orchestrator was ending.
 *
 * A public method on a class here is an offer; a test is not a caller. The scope
 * is deliberately narrow — this is the layer where « nobody calls it » is a
 * behaviour that silently does not happen, and a repo-wide version of this rule
 * would be noise.
 */
const SESSION = 'electron/app/session/'
const CALLERS = files.filter((file) => !isTest(file))
const RESERVED = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return'])
let methods = 0

for (const file of files.filter((f) => f.startsWith(SESSION) && !isTest(f))) {
  const body = bodies.get(file)
  // The class body only: an `interface` in the same file declares members that
  // are implemented elsewhere and called through the interface, not on a class.
  const opened = /export class (\w+)[^{]*\{/.exec(body)
  if (!opened) continue
  const className = opened[1]
  const declared = new Set(
    [...body.slice(opened.index).matchAll(/^ {2}(?:static )?(?:async )?(\w+)\s*(?:<[^>]*>)?\(/gm)].map(
      (m) => m[1],
    ),
  )
  /**
   * **The identifiers this tree has a reason to believe hold an instance of this
   * class, per caller file — because « the file imports the module » was not a join.**
   *
   * `knows(other)` used to ask « does `other` import the declaring module », and that
   * is satisfied by a file importing it for *anything*: a type, a constant, a sibling
   * class. `electron/app/main.ts` imports every module in this folder and contains
   * `store.close()`, `agenda?.stop()`, `session.start()` and `downloads.state()` — so
   * **any** method on **any** session class named `close`, `stop`, `start` or `state`
   * was reached for free. Measured on the shipped check: four dead methods added to
   * `Outbox` under exactly those names took the count from 38 to **42** and the check
   * to exit **0**, every one of them reported as called. `Outbox.isDraining` — the
   * defect this rule exists for, where the quit path asked a different question and a
   * POST in flight was abandoned — would have been invisible had it been spelled
   * `close`.
   *
   * So the join is a receiver, the `check-ports.mjs` shape: derived from the tree's
   * own annotations rather than listed, so it cannot go stale. Four derivations, and
   * the last two exist because two of these seven classes are held in **no** typed
   * variable at all:
   *
   *   · an annotation — `#outbox: Outbox`, `agenda?: Agenda`;
   *   · a construction — `const outbox = new Outbox(`;
   *   · a **collection** of them — `#recordings = new Map<MeetingId, Recording>()` and
   *     `#endWatch = new Map<MeetingId, EndOfMeetingWatch>()`, which is how `Recording`
   *     and `EndOfMeetingWatch` are held and the only way either is ever reached. A
   *     collection is called through one access, so `this.#endWatch.get(id)?.stop()`
   *     counts and `store.close()` does not;
   *   · a local bound out of one — `const recording = this.#recordings.get(id)` — or
   *     **aliased** from one, `const loop = agenda`, which is the only way
   *     `Agenda.start` is ever called (`main.ts:2585`, so a `void (async () => …)`
   *     closure can hold it past a narrowing);
   *   · **the class itself**, in a file that imports it, because three of these
   *     thirty-eight are `static` — `MeetingSession.create`, `MeetingSession.load`,
   *     `Recording.start`. That is the old import join, kept for the one receiver it
   *     states precisely: `MeetingSession.create(` cannot be satisfied by
   *     `store.close()`.
   *
   * An empty receiver set is itself a finding, for the reason `check-ports.mjs` gives:
   * a class nobody holds cannot be asked who calls it, and a check that quietly
   * measures nothing is worse than no check.
   */
  const ACCESS = '(?:\\.(?:get|pop|shift|at|find)\\s*\\([^()]*\\)\\s*\\??)'
  const escape = (receiver) => receiver.replace(/\$/g, '\\$')
  /*
   * Compiled once per class, not once per class per file: the first version built
   * three `RegExp`s inside the file loop — seven classes over three hundred and
   * seventy files — and took this check from 0.15 s to 1.31 s. With the patterns
   * hoisted and a file whose text never mentions the class skipped outright, 0.25 s.
   * Same shape as `alternationOf` in `check-ports.mjs`, and the same measurement.
   */
  const ANNOTATED = new RegExp(
    `(#?[A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*(?:readonly\\s+)?${className}\\b(?!\\[)`,
    'g',
  )
  const CONSTRUCTED = new RegExp(`(#?[A-Za-z_$][\\w$]*)\\s*=\\s*new ${className}\\s*[(<]`, 'g')
  const COLLECTED = new RegExp(
    `(#?[A-Za-z_$][\\w$]*)\\s*\\??\\s*(?:` +
      `:\\s*(?:readonly\\s+)?(?:Readonly)?(?:Map|Set|Array)<[^<>]*\\b${className}\\b[^<>]*>` +
      `|:\\s*(?:readonly\\s+)?${className}\\[\\]` +
      `|=\\s*new (?:Map|Set)<[^<>]*\\b${className}\\b[^<>]*>` +
      `)`,
    'g',
  )
  const receiversIn = (source) => {
    const named = new Set()
    const holders = new Set()
    const add = (set, hit) => set.add(hit[1])
    if (!source.includes(className)) return { named, holders }
    for (const hit of source.matchAll(ANNOTATED)) add(named, hit)
    for (const hit of source.matchAll(CONSTRUCTED)) add(named, hit)
    for (const hit of source.matchAll(COLLECTED)) add(holders, hit)
    if (holders.size > 0) {
      const from = [...holders].map(escape).join('|')
      for (const hit of source.matchAll(
        new RegExp(
          `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(?:this\\.)?(?:${from})${ACCESS}`,
          'g',
        ),
      ))
        named.add(hit[1])
    }
    /*
     * Aliases, to a fixed point — three passes, because `const signedIn = identity`
     * beside `const loop = agenda` is one hop and nothing in this tree is two. An
     * alias is only ever seeded by a receiver, so widening it cannot admit a name the
     * file does not already type.
     */
    for (let pass = 0; pass < 3 && named.size > 0; pass += 1) {
      const before = named.size
      const from = [...named].map(escape).join('|')
      for (const hit of source.matchAll(
        new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:this\\.)?(?:${from})\\s*$`, 'gm'),
      ))
        named.add(hit[1])
      if (named.size === before) break
    }
    return { named, holders }
  }

  /**
   * `from '…/MeetingSession.ts'` — what makes the class name itself a receiver.
   *
   * Asked of `bodies`, not `text`: a commented-out import is not an import, and every
   * other rule in this file reads the comment-stripped source for exactly that reason.
   */
  const imports = new RegExp(`from '[^']*${path.basename(file, '.ts')}\\.ts'`)

  const receivers = new Map()
  for (const other of CALLERS) {
    if (other === file) continue
    const { named, holders } = receiversIn(bodies.get(other) ?? '')
    if (imports.test(bodies.get(other) ?? '')) named.add(className)
    if (named.size + holders.size === 0) continue
    receivers.set(
      other,
      [...[...named].map(escape), ...[...holders].map((r) => `${escape(r)}${ACCESS}`)].join('|'),
    )
  }
  if (receivers.size === 0) {
    problems.push(
      `${file}: ${className} n’est le type d’aucune variable, champ ou collection hors de ` +
        'son propre fichier — personne n’en tient une instance, donc « qui appelle ses ' +
        'méthodes » ne peut pas être posée. Câble-la, ou supprime la classe.',
    )
  }

  for (const name of declared) {
    if (RESERVED.has(name)) continue
    methods += 1
    /*
     * **A call, on a receiver this file types as this class.** `.${name}(` alone is
     * satisfied by any unrelated receiver — `array.push(` three files away — and
     * requiring only the import was satisfied by `store.close()` in a file that
     * imports every module in the folder. `!` and `?.` are allowed between, as
     * `check-ports.mjs` allows them, because `this.#outbox!.drain(` and
     * `agenda?.stop()` are both the instance being reached.
     */
    const called = CALLERS.some((other) => {
      const alternation = receivers.get(other)
      if (alternation === undefined) return false
      const source = bodies.get(other) ?? ''
      if (!source.includes(name)) return false
      return new RegExp(
        `(?:${alternation})\\s*!?\\s*\\??\\.\\s*${name}\\s*(?:<[^<>;={}]*>\\s*)?\\(`,
      ).test(source)
    })
    /*
     * **What this rule *saw*, printed on demand** — `SILLAGE_SESSION_DUMP=1`, one line
     * per method. « The gate still passes » is not evidence that a tightening changed
     * nothing: the join below went from an import to a receiver, and the only honest
     * way to say no live method went red was to diff the thirty-eight lines before
     * against the thirty-eight after. Three did on the first attempt, all `static`.
     */
    if (process.env.SILLAGE_SESSION_DUMP === '1') {
      console.log(`SESS ${className}.${name} ${called ? 'appelé' : 'RIEN'}`)
    }
    if (called) continue
    if (UNREACHED.some((entry) => entry.subject === `${className}.${name}`)) continue
    problems.push(
      `${file} déclare \`${className}.${name}\` et rien ne l’appelle — ` +
        'un test n’est pas un appelant.',
    )
  }
}

/**
 * **The fourth shape: a field that ships and is read by nobody.**
 *
 * Scoped to the **response** schema of an invoke channel, which is the one place
 * a payload's shape and its reader are guaranteed to be different files — main
 * writes it, `src/` reads it, and the contract between them is a `z.object`.
 * Nested schemas are not walked: what is asked is « does this channel ship a
 * top-level field nobody looks at », and a shape reached through another field
 * is already covered by that field being read.
 *
 * The join is the field **name as an identifier** anywhere under `src/`, which is
 * deliberately weak in one direction and strong in the other. A generic name
 * (`state`, `rows`, `query`) will always match something, so this rule has false
 * *negatives* by the handful — and it has no false positives worth the word: a
 * name that occurs nowhere in the renderer is a name nothing can be reading. A
 * check that invents findings is worse than one that finds little, because the
 * finding gets acted on.
 */
const RESPONSE_SCHEMA = /response:\s*([A-Za-z0-9_]+)/
const CONTRACTS = files.filter((file) => file.startsWith('electron/core/contracts/'))
const SCREENS = files.filter((file) => file.startsWith('src/') && !isTest(file))

/** A `z.object({ … })` declared in `core/contracts/`, brace-matched, or null. */
const schemaBody = (name) => {
  for (const file of CONTRACTS) {
    const body = bodies.get(file) ?? ''
    const declared = body.indexOf(`export const ${name} = z.object({`)
    if (declared < 0) continue
    const start = body.indexOf('{', body.indexOf('z.object(', declared))
    let depth = 0
    for (let at = start; at < body.length; at += 1) {
      if (body[at] === '{') depth += 1
      else if (body[at] === '}') {
        depth -= 1
        if (depth === 0) return body.slice(start + 1, at)
      }
    }
  }
  return null
}

const fieldsOf = (schema) => {
  const body = schemaBody(schema)
  return body === null ? [] : [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9_]*):/gm)].map((m) => m[1])
}

const channelBlocks = [
  ...contract.slice(0, split).matchAll(/^ {2}'([^']+)':\s*\{([\s\S]*?)^ {2}\},/gm),
]
let fieldsChecked = 0
const unreadSeen = new Set()

for (const [, channel, block] of channelBlocks) {
  const schema = RESPONSE_SCHEMA.exec(code(block))?.[1]
  if (!schema) continue
  for (const field of fieldsOf(schema)) {
    fieldsChecked += 1
    const subject = `${schema}.${field}`
    const read = SCREENS.some((file) => new RegExp(`\\b${field}\\b`).test(bodies.get(file) ?? ''))
    const excused = UNREAD.find((entry) => entry.subject === subject)
    if (read) {
      if (excused) {
        problems.push(`« ${subject} » est déclaré non lu et pourtant lu par un écran.`)
        unreadSeen.add(subject)
      }
      continue
    }
    unreadSeen.add(subject)
    if (excused) continue
    problems.push(
      `« ${channel} » renvoie ${subject} et aucun écran ne le lit — ` +
        'câble-le, supprime-le du contrat, ou déclare-le dans UNREAD avec la raison.',
    )
  }
}

if (channelBlocks.length === 0 || fieldsChecked === 0) {
  problems.push(
    'aucun champ de réponse lu dans le contrat — ce contrôle ne mesure plus rien.',
  )
}

for (const entry of UNREAD) {
  if (unreadSeen.has(entry.subject)) continue
  problems.push(
    `UNREAD mentionne « ${entry.subject} », qui n’est plus un champ de réponse — ` +
      'une dispense dont le sujet a disparu est une dispense qui pourrit.',
  )
}

for (const entry of UNREACHED) {
  const known =
    invokeChannels.includes(entry.subject) ||
    broadcastChannels.includes(entry.subject) ||
    files.includes(entry.subject) ||
    // `Class.method`, for the session rule above: still declared somewhere.
    (entry.subject.includes('.') &&
      files.some((file) =>
        new RegExp(`^ {2}(?:static )?(?:async )?${entry.subject.split('.')[1]}\\s*\\(`, 'm').test(
          text.get(file) ?? '',
        ),
      ))
  if (!known) {
    problems.push(
      `UNREACHED mentionne « ${entry.subject} », qui n’existe plus — ` +
        'une dispense dont le sujet a disparu est une dispense qui pourrit.',
    )
  }
}

/**
 * **A renderer file nothing imports.**
 *
 * The fourth boundary where « declared » and « reached » are different files,
 * and the one that had no check at all. `src/components/ui/AccordionSection.tsx`
 * was the only file under `src/components/`, had **zero** importers anywhere,
 * and its dead `import { AnimatePresence, motion } from 'framer-motion'` kept a
 * **5.5 MB** dependency in `dependencies` — where `build.files` takes
 * `node_modules` whole and electron-builder prunes only devDependencies, so it
 * shipped inside the installer. The thirty-ninth of the answer assistant's
 * leftovers, surviving three rounds of review because one dead `.tsx` kept the
 * import alive and nothing asked whether the `.tsx` itself was reached.
 *
 * The rule is the file, not the export, and that is deliberate. Asking « is this
 * *component* used » means reasoning about barrels, re-exports and default
 * exports, and would answer « no » for half of `src/ui/`. Asking « does anything
 * import this file » is one grep, has no false positives that are not real, and
 * catches exactly the defect: a module kept alive only by its own imports.
 *
 * Entry points are named rather than inferred — the two files the bundler
 * reaches directly, which nothing in the tree imports by construction.
 */
const ENTRY = new Set(['src/main.tsx', 'src/App.tsx'])
/*
 * **`.ts` as well as `.tsx`, because the dead code was never in the components.**
 *
 * This filter said `.tsx` for as long as it existed, and the twenty-third review
 * round walked straight through the gap: `src/editor/note/title-layout.ts`,
 * `transaction-guard.ts`, `markdown.ts` and its three `markdown/*` — **1 147
 * lines with 48 green tests and zero product callers**, every one of them marked
 * `[x]` and "Complete" in IMPLEMENTATION.md, and all of them invisible here
 * because none of them ends in an `x`.
 *
 * A renderer's dead weight is far likelier to be a helper than a component: a
 * component that nothing renders tends to get noticed because somebody looks for
 * it on a screen, while a parser nobody parses with looks exactly like a parser.
 * `markdown.ts` even carried a documented divergence from upstream justified by a
 * call chain that did not exist.
 *
 * `.d.ts` is excluded: an ambient declaration file is consumed by the compiler,
 * never imported, so the question this check asks does not apply to it.
 */
const renderer = files.filter(
  (file) =>
    file.startsWith('src/') &&
    /\.tsx?$/.test(file) &&
    !file.endsWith('.d.ts') &&
    !isTest(file) &&
    !ENTRY.has(file),
)
for (const file of renderer) {
  // `src/screens/review/TranscriptReader.tsx` is imported as
  // `./review/TranscriptReader.tsx`, `../review/TranscriptReader.tsx`, and so
  // on — the stem is the part every spelling shares.
  const stem = file.slice(file.lastIndexOf('/') + 1).replace(/\.tsx?$/, '')
  /*
   * **The extension is optional, and requiring it nearly deleted a live file.**
   *
   * `electron/` carries `.ts` on every relative import — that is what lets one
   * source tree run under `node --test`, esbuild and `tsc` with no build step
   * between — but `src/` goes through Vite and does not have to. The first
   * version of this pattern demanded `\\.tsx?` and reported
   * `src/editor/editor-error-boundary.tsx` as unreached, because `Session.tsx`
   * imports it as `'../editor/editor-error-boundary'`. That file is the last
   * thing standing between a ProseMirror crash and a rep who is in a call.
   *
   * A check that invents findings is worse than one that finds nothing, because
   * the finding gets acted on. The match still ends at a quote or at an optional
   * extension and never mid-name, so `Review` cannot be satisfied by an import
   * of `ReviewGate`.
   */
  const imported = CALLERS.some(
    (other) =>
      other !== file &&
      new RegExp(`from\\s+['"\`][^'"\`]*/${stem}(\\.tsx?)?['"\`]`).test(bodies.get(other) ?? ''),
  )
  if (!imported && !excused(file)) {
    problems.push(
      `${file}: aucun fichier ne l’importe — un composant que rien n’atteint n’est pas une fonctionnalité, ` +
        'et ses propres imports gardent ses dépendances en vie (framer-motion: 5,5 Mo dans l’installeur).',
    )
  }
}

if (problems.length > 0) {
  console.error(`\nsurfaces déclarées et jamais atteintes (${problems.length}):\n`)
  for (const line of problems) console.error(`  ${line}`)
  console.error('')
  process.exit(1)
}

console.log(
  `surfaces ok — ${invokeChannels.length} canal(aux), ${broadcastChannels.length} diffusion(s), ` +
    `${rust.length} fichier(s) Rust, ${methods} méthode(s) de session, ` +
    `${renderer.length} composant(s) de rendu, ${fieldsChecked} champ(s) de réponse, ` +
    `${UNREACHED.length + UNREAD.length} dispense(s) déclarée(s)`,
)
