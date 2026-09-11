/**
 * **A surface that is declared and never reached.**
 *
 * `check-ports.mjs` asks this question about one interface, `CrmPort`, because
 * that is where it was first asked — four declared verbs, implemented and unit
 * tested, called by nothing, and the VerySwing opportunity was therefore
 * structurally impossible on every meeting the product had ever produced.
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
 *      compile and cannot be reached however good its contents are.
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
const isTest = (file) => /__tests__|\.test\./.test(file)

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
  for (const name of declared) {
    if (RESERVED.has(name)) continue
    methods += 1
    /*
     * **A call, *in a file that knows this class*.**
     *
     * `.${name}(` alone is satisfied by any unrelated receiver, so a method
     * called `push`, `start`, `stop` or `run` would be marked reached by an
     * `array.push(` three files away. Nothing live exploited it, which is
     * exactly when a check is worth tightening. Requiring the caller to import
     * the declaring module is the honest join: an instance reaches a caller
     * either by construction or as a typed dependency, and both are imports.
     */
    const knows = (other) =>
      new RegExp(`from '[^']*${file.split('/').pop()?.replace('.ts', '')}\\.ts'`).test(
        text.get(other) ?? '',
      )
    const called = CALLERS.some(
      (other) =>
        other !== file &&
        knows(other) &&
        new RegExp(`\\.${name}\\s*\\(`).test(bodies.get(other) ?? ''),
    )
    if (called) continue
    if (UNREACHED.some((entry) => entry.subject === `${className}.${name}`)) continue
    problems.push(
      `${file} déclare \`${className}.${name}\` et rien ne l’appelle — ` +
        'un test n’est pas un appelant.',
    )
  }
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

if (problems.length > 0) {
  console.error(`\nsurfaces déclarées et jamais atteintes (${problems.length}):\n`)
  for (const line of problems) console.error(`  ${line}`)
  console.error('')
  process.exit(1)
}

console.log(
  `surfaces ok — ${invokeChannels.length} canal(aux), ${broadcastChannels.length} diffusion(s), ` +
    `${rust.length} fichier(s) Rust, ${methods} méthode(s) de session, ` +
    `${UNREACHED.length} dispense(s) déclarée(s)`,
)
