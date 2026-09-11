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
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The ports this checks, and where their implementations live — a call from
 * inside the implementing module is not a caller, it is the module talking to
 * itself.
 */
const PORTS = [
  { file: 'electron/core/contracts/crm.ts', interface: 'CrmPort', home: 'electron/modules/crm/' },
]

/**
 * Declared, implemented, and deliberately not wired — each with the reason and
 * with what it would take. Delete an entry the day it gets a caller; the check
 * fails on an allowance whose method has since disappeared, so this list cannot
 * rot into a blanket exemption.
 */
const UNWIRED = [
  {
    method: 'attachTranscript',
    why:
      'Attacher la transcription verbatim d’un appel client à une tâche VerySwing ' +
      'partagée est une divulgation, pas une amélioration : la transcription est ' +
      'la preuve que le produit conserve (DEC-12 ne jette que l’audio), et la ' +
      'pousser dans le CRM du client change qui peut la lire. Cela vaut une ' +
      'quatrième intention dans la liste du gate — visible, décochable, jamais ' +
      'cochée par défaut (DEC-4, DEC-20) — et cette décision n’est pas prise.',
  },
  {
    method: 'createContact',
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
for (const dir of ['electron', 'src', 'scripts']) walk(path.join(ROOT, dir))

const problems = []
let checked = 0

for (const port of PORTS) {
  const text = readFileSync(path.join(ROOT, port.file), 'utf8')
  const body = new RegExp(`interface ${port.interface}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(text)?.[1]
  if (!body) {
    problems.push(`${port.interface} introuvable dans ${port.file} — ce contrôle a besoin d’une mise à jour`)
    continue
  }

  // `name(` at the head of a line, which is how a method is declared here.
  const methods = [...body.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*)\(/gm)].map((m) => m[1])
  for (const method of methods) {
    checked += 1
    const exempt = UNWIRED.find((e) => e.method === method)
    const callers = sources.filter((file) => {
      if (file === port.file) return false
      if (file.startsWith(port.home)) return false
      if (/__tests__|\.test\./.test(file)) return false
      return new RegExp(`[.\\w]${method}\\s*\\(`).test(readFileSync(path.join(ROOT, file), 'utf8'))
    })

    if (callers.length === 0 && !exempt) {
      problems.push(
        `${port.interface}.${method} n’est appelé nulle part hors de ${port.home} — ` +
          'câble-le, ou déclare-le dans UNWIRED avec la raison.',
      )
    }
    if (callers.length > 0 && exempt) {
      problems.push(
        `${port.interface}.${method} est déclaré non câblé et pourtant appelé ` +
          `(${callers[0]}) — retire l’entrée de UNWIRED.`,
      )
    }
  }

  for (const entry of UNWIRED) {
    if (!methods.includes(entry.method)) {
      problems.push(
        `UNWIRED mentionne ${port.interface}.${entry.method}, qui n’existe plus — ` +
          'une dispense dont la méthode a disparu est une dispense qui pourrit.',
      )
    }
  }
}

if (problems.length > 0) {
  console.error(`\nports declared and never called (${problems.length}):\n`)
  for (const line of problems) console.error(`  ${line}`)
  console.error('')
  process.exit(1)
}

console.log(
  `ports ok — ${checked} méthode(s) de port vérifiées, ${UNWIRED.length} non câblée(s) et déclarée(s)`,
)
