#!/usr/bin/env node
/**
 * **Every checkpoint the catalogue offers has been run at least once.**
 *
 * `registry.test.ts` holds every STT *provider* to a constructible session, and
 * that check is why the Deepgram row could not survive: it declared a
 * capability, nothing implemented it, and the test said so. `MODELS` had no
 * equivalent, and the hole cost exactly what the provider hole would have.
 *
 * Whisper Large v3 Turbo shipped in the catalogue, reachable from Réglages
 * through `modelSection` (`main.ts`), throwing `Missing the following inputs:
 * cache_position` on **every** utterance against the pinned transformers. The
 * throw is caught per segment, so selecting it does not crash anything — it
 * transcribes a whole meeting to nothing behind « transcription de l'audio
 * système dégradée », on the engine DEC-30 makes the default. Nobody had run it.
 *
 * ## Why this is not a unit test
 *
 * The subject is gigabytes of weights and a real ONNX session. `npm test` runs
 * on Node type-stripping with no model on disk, and adding a 486 MB download to
 * it would be a worse trade than the bug. So this is a script, run by hand and
 * in a release check, over whatever this machine already has.
 *
 * ## Why a ledger, and not just "run what is cached"
 *
 * **Because the broken model was not cached.** A check that measures only local
 * weights is green on a laptop holding one checkpoint, which is every laptop —
 * and it would have been green for the whole life of the turbo defect. That is
 * the narrow-instrument shape this repo keeps finding: a pass whose question is
 * smaller than the rule it claims to enforce.
 *
 * So the rule has two halves:
 *
 *   1. **Measured here.** A cached checkpoint is *actually run* — one real
 *      inference through the shipped `WhisperEngine`, the shipped worker and the
 *      shipped dtype resolution. Its live verdict must match the ledger. This is
 *      what catches a transformers upgrade that breaks a model that used to work.
 *   2. **Declared there.** A checkpoint this machine does not hold must still
 *      carry a ledger entry, and the entry must say which transformers version
 *      it was measured against. No entry is a failure: « offered and never run »
 *      is the defect itself, and it should be visible in the diff that adds the
 *      row, not in a rep's empty transcript.
 *
 * An entry may say `unverified`, with a reason and the cost of not knowing —
 * the same allowance `check-platform.mjs` and `check-ports.mjs` make, and for
 * the same reason: a rubber stamp someone has to type is still a decision
 * somebody made, and it shows up in review. What it may not be is absent.
 *
 * A `throws` entry **fails**. A row the engine cannot honour is an offer the
 * product cannot keep, and the only two ways out are fixing the export or
 * removing the row — both decisions, neither a cleanup. `ModelStatus` cannot
 * express « offered and broken » (`ready` | `absent` and nothing between), so
 * until one of those happens this check is the only thing that says it.
 *
 *   node scripts/check-models.mjs            measure what is cached, hold the rest to the ledger
 *   node scripts/check-models.mjs --record   write back what this run measured
 *
 * Stale ledger rows are not silently carried: an entry whose `transformers`
 * does not match the pinned major.minor.patch is reported, because turbo's
 * breakage *is* a transformers-version fact and a verdict from another version
 * is a verdict about another product.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href)

const LEDGER = path.join(ROOT, 'scripts', 'whisper-models.verified.json')
const RECORD = process.argv.includes('--record')

/** One second of a 440 Hz tone at 16 kHz. */
const probeAudio = () => {
  const samples = new Float32Array(16_000)
  for (let i = 0; i < samples.length; i += 1) samples[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / 16_000)
  return samples
}

/*
 * The graph is the subject, not the words. A tone transcribes to « (beeping) »
 * or to nothing, and either is a pass: what is being asked is whether ONNX
 * Runtime can build a feed this decoder accepts and return a string. Turbo
 * fails *before* any audio matters — the feed is missing an input the graph
 * declares — so a tone reaches the defect as surely as a sentence would, and
 * costs no fixture, no licence and no real voice.
 */
const runOnce = async (modelId, modelsDir) => {
  const { acquireEngine, forgetEngine } = await load('electron/modules/transcribe/whisper/engine.ts')
  process.env.SILLAGE_WHISPER_MODELS_DIR = modelsDir
  process.env.SILLAGE_WHISPER_WORKER ??= path.join(
    ROOT,
    'dist-electron/electron/modules/transcribe/whisper/worker.js',
  )

  const engine = acquireEngine({ model: modelId })
  const started = Date.now()
  try {
    await engine.retain()
    const text = await engine.transcribe(probeAudio(), 'fr')
    return { verdict: 'runs', ms: Date.now() - started, text: text.trim().slice(0, 40) }
  } catch (error) {
    return { verdict: 'throws', ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      await engine.release()
    } finally {
      forgetEngine(engine)
    }
  }
}

/*
 * The **installed** version, not the range. `^3.8.1` resolves to whatever a
 * later `npm install` picked, and a graph-signature failure is a fact about the
 * version that is actually on disk building the feed — which is the thing the
 * ledger's verdicts are claims about. Reading the range would let a minor bump
 * carry every verdict forward unnoticed, which is the failure this check is
 * for.
 */
const pinnedTransformers = () => {
  try {
    const installed = path.join(ROOT, 'node_modules', '@huggingface', 'transformers', 'package.json')
    return JSON.parse(fs.readFileSync(installed, 'utf8')).version
  } catch {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    return (pkg.dependencies?.['@huggingface/transformers'] ?? '').replace(/^[\^~>=<\s]+/, '')
  }
}

const readLedger = () => {
  try {
    return JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
  } catch {
    return { transformers: null, models: {} }
  }
}

const { MODELS, isModelCached } = await load('electron/modules/transcribe/whisper/catalog.ts')
const { resolveInferenceConfig } = await load('electron/modules/transcribe/whisper/inference.ts')

const pinned = pinnedTransformers()
const ledger = readLedger()
const dtype = resolveInferenceConfig().dtype

/*
 * Outside Electron there is no `app.getPath`, so `resolveModelsDir` cannot be
 * asked — it throws in this process, which is why `replay.mjs` sets the
 * override rather than calling it. The directories a packaged build would
 * search are named here directly for the same reason. Both host paths are
 * spelled out because a checkpoint downloaded by the running app lands in
 * `userData`, not in `resources/`, and a check that only looked at the bundled
 * directory would report a rep's own model as absent.
 */
const modelsDirs = [
  process.env.SILLAGE_WHISPER_MODELS_DIR,
  path.join(ROOT, 'resources', 'whisper-models'),
  path.join(
    process.env.HOME ?? '',
    'Library',
    'Application Support',
    'sillage',
    'whisper-models',
  ),
  path.join(process.env.APPDATA ?? '', 'sillage', 'whisper-models'),
].filter(Boolean)

const cacheHolding = (modelId) => modelsDirs.find((dir) => isModelCached(dir, modelId, dtype)) ?? null

const failures = []
const notes = []
let measured = 0
let declared = 0

for (const model of MODELS) {
  const entry = ledger.models?.[model.id]
  const dir = cacheHolding(model.id)

  if (!entry) {
    failures.push(
      `${model.id}\n      offert dans le catalogue et jamais exécuté — aucune entrée dans ` +
        `${path.relative(ROOT, LEDGER)}.\n      C'est exactement la forme du défaut turbo : une ligne sélectionnable ` +
        `dans Réglages que personne n'a fait tourner.`,
    )
    continue
  }

  if (entry.verdict === 'throws') {
    failures.push(
      `${model.id}\n      le moteur ne peut pas honorer cette ligne : ${entry.error}\n` +
        `      mesuré le ${entry.at} (${entry.where}). Un rep peut la sélectionner aujourd'hui.\n` +
        `      Deux issues, toutes deux des décisions : réexporter le modèle, ou retirer la ligne.`,
    )
  }

  if (entry.transformers && entry.transformers !== pinned) {
    failures.push(
      `${model.id}\n      verdict « ${entry.verdict} » mesuré contre transformers ${entry.transformers}, ` +
        `la version épinglée est ${pinned}.\n      Une panne de graphe est un fait de version : ce verdict parle ` +
        `d'un autre produit. Relancez avec --record.`,
    )
  }

  if (!dir) {
    declared += 1
    notes.push(
      `  · ${model.id} — pas sur cette machine, tenu par le registre : ` +
        `${entry.verdict}${entry.reason ? ` (${entry.reason})` : ''}`,
    )
    continue
  }

  const live = await runOnce(model.id, dir)
  measured += 1

  if (RECORD) {
    ledger.models[model.id] = {
      ...entry,
      verdict: live.verdict,
      ...(live.error ? { error: live.error } : { error: undefined }),
      transformers: pinned,
      dtype: typeof dtype === 'string' ? dtype : 'per-file',
      at: new Date().toISOString().slice(0, 10),
      where: 'mesuré par scripts/check-models.mjs',
    }
    notes.push(`  · ${model.id} — ${live.verdict} en ${live.ms} ms, enregistré`)
    continue
  }

  if (live.verdict !== entry.verdict) {
    failures.push(
      `${model.id}\n      le registre dit « ${entry.verdict} », cette machine dit « ${live.verdict} »` +
        `${live.error ? ` : ${live.error}` : ''}\n      Les poids sont ici et ils ont vraiment tourné : c'est le ` +
        `registre qui est faux, ou la version qui a bougé.`,
    )
  } else {
    notes.push(`  · ${model.id} — ${live.verdict} en ${live.ms} ms, conforme au registre`)
  }
}

if (RECORD) {
  ledger.transformers = pinned
  fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`)
}

console.log('')
for (const note of notes) console.log(note)
console.log('')

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}\n`)
  console.error(
    `models: ${failures.length} problème(s) sur ${MODELS.length} ligne(s) du catalogue ` +
      `(${measured} exécutée(s) ici, ${declared} tenue(s) par le registre, transformers ${pinned})`,
  )
  process.exit(1)
}

console.log(
  `models ok — ${MODELS.length} ligne(s) de catalogue : ${measured} exécutée(s) sur cette machine, ` +
    `${declared} déclarée(s) au registre, transformers ${pinned}`,
)
