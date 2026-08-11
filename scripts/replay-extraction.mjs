#!/usr/bin/env node
/**
 * Drives steps 6–8 from a stored transcript. No audio, no devices, no calendar.
 *
 * `scripts/replay.mjs` covers the other half — audio → transcript. This one
 * starts where that ends: transcript → compte-rendu → extraction → intents,
 * through the same `CompteRenduRecipe` a real meeting uses.
 *
 * It exists for one reason. IMPLEMENTATION.md step 6 says demo beat #3 — "a
 * compte-rendu a salesperson would recognise as their own" — is **the only beat
 * that cannot be faked**, and to budget real time for prompt iteration. Prompt
 * iteration against a live meeting is not iteration; it is waiting for someone
 * to have a call. This makes the loop seconds long and keeps every run
 * comparable, because the input never varies.
 *
 *   node scripts/replay-extraction.mjs [fixture] [options]
 *
 *     --json          the raw ExtractionESN, for diffing two prompt versions
 *     --spans         every field with the quote it was read from
 *     --no-notes      run on the transcript alone (the rep typed nothing)
 *
 * The model comes from the same environment the app reads (`modules/llm/`), so
 * whichever provider is configured is the one being judged. With none
 * configured it says so and exits — a silent fallback would make a bad
 * compte-rendu look like a bad prompt.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const load = (relative) => import(pathToFileURL(resolve(ROOT, relative)).href)

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const fixturePath = args.find((a) => !a.startsWith('--')) ?? 'fixtures/transcript-acme.json'

const bold = (s) => `[1m${s}[0m`
const dim = (s) => `[2m${s}[0m`
const warn = (s) => `[33m${s}[0m`

const main = async () => {
  const fixture = JSON.parse(readFileSync(resolve(ROOT, fixturePath), 'utf8'))

  const llm = await load('electron/modules/llm/index.ts')
  const selection = llm.selectLlm({ configured: llm.configuredLlmProviders() })

  if (!selection.ok) {
    // Stated, never substituted. A fallback here would make a missing key look
    // like a bad prompt, which is the one confusion this script must not add.
    console.error(`\n  Aucun modèle utilisable.\n  ${selection.reason}\n`)
    process.exit(2)
  }

  const endpoint = llm.llmEndpointFor(selection.id)
  const port = new llm.OpenAiCompatibleLlm({
    endpoint,
    structuredOutput: llm.descriptorFor(selection.id)?.structuredOutput ?? false,
  })

  const { CompteRenduRecipe } = await load('electron/modules/extract/index.ts')
  const recipe = new CompteRenduRecipe({ llm: port })

  console.log(`\n${dim(`fixture  ${fixturePath}`)}`)
  console.log(dim(`modèle   ${selection.id} (${endpoint.model})`))
  console.log(dim(`segments ${fixture.segments.length}`))

  const startedAt = Date.now()
  let result
  try {
    result = await recipe.run({
      context: fixture.context,
      transcript: fixture.segments,
      repEmail: fixture.repEmail,
      ...(flag('--no-notes') || !fixture.notes ? {} : { notes: fixture.notes }),
    })
  } catch (error) {
    console.error(`\n  ${warn('Extraction refusée')} — ${error?.message ?? error}\n`)
    if (error?.kind) console.error(dim(`  kind: ${error.kind}\n`))
    process.exit(1)
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

  if (flag('--json')) {
    console.log(JSON.stringify(result.extraction, null, 2))
    return
  }

  console.log(`${dim(`durée    ${elapsed}s`)}\n`)
  console.log(bold('── Compte-rendu ' + '─'.repeat(50)))
  console.log(`\n${result.compteRendu}\n`)

  console.log(bold('── Confiance ' + '─'.repeat(53)))
  const fields = Object.entries(result.verification.fields)
  for (const [key, confidence] of fields) {
    const mark = confidence === 'ok' ? '  ' : warn(' ⚠')
    console.log(`${mark} ${key.padEnd(24)} ${confidence}`)
  }
  const faible = fields.filter(([, c]) => c !== 'ok').length
  console.log(
    `\n  ${faible === 0 ? 'tous les champs vérifiés' : `${faible}/${fields.length} sans citation vérifiable`}` +
      `  ${dim(`(global: ${result.verification.overall})`)}\n`,
  )

  if (flag('--spans')) {
    console.log(bold('── Citations ' + '─'.repeat(53)) + '\n')
    const walk = (value, path = []) => {
      if (!value || typeof value !== 'object') return
      if (typeof value.span === 'object' && value.span?.quote) {
        console.log(`  ${path.join('.')}`)
        console.log(`    ${dim(`« ${value.span.quote} »`)}\n`)
        return
      }
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key])
    }
    walk(result.extraction.interpretation)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
